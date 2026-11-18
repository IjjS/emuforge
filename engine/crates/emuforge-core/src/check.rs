//! A target's test: whether its emulator's files are there, whether something listens on its endpoint, whether
//! that speaks TLS with a certificate from the emulator's own `ca.pem`, whether its health route answers, and
//! whether it accepts a request signed with the emulator's key.
//!
//! The `credentials` step sends one STS `GetCallerIdentity` (issue 485, decisions.md "Plan decisions"): it changes
//! no state, names no resource and every account answers it. Only its status is read, never its body. It is the
//! one place the engine knows a particular service's operation.

use std::fmt;
use std::io;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use http::header::{AUTHORIZATION, CONTENT_TYPE, HOST, HeaderName, HeaderValue};
use http::{Method, Request, StatusCode};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;
use ring::digest;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;

use crate::connect::{connect, from_files, handshake};
use crate::health::{BODY_CAP, exchange, http_failed};
use crate::sigv4::{ALGORITHM, Scope, UriMode, canonical_request, scope_text, signature, string_to_sign};
use crate::{Credentials, Emulator, EmulatorFiles, Reason, client_config};

/// The body of the `credentials` step's request: STS `GetCallerIdentity` in the Query protocol.
pub const CREDENTIALS_BODY: &str = "Action=GetCallerIdentity&Version=2011-06-15";
/// The content type of that body.
pub const CREDENTIALS_CONTENT_TYPE: &str = "application/x-www-form-urlencoded; charset=utf-8";
/// The service and region the request is signed for.
const SERVICE: &str = "sts";
const REGION: &str = "us-east-1";
const AMZ_DATE: HeaderName = HeaderName::from_static("x-amz-date");

/// One step of a target's test, in the order they run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Files,
    Connection,
    Tls,
    Health,
    Credentials,
}

impl Step {
    pub const ALL: [Step; 5] = [
        Step::Files,
        Step::Connection,
        Step::Tls,
        Step::Health,
        Step::Credentials,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Step::Files => "files",
            Step::Connection => "connection",
            Step::Tls => "tls",
            Step::Health => "health",
            Step::Credentials => "credentials",
        }
    }
}

impl fmt::Display for Step {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// What became of one step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Passed,
    Failed(Reason),
    /// An earlier step failed, so this one was not tried.
    NotRun,
}

impl Outcome {
    /// `passed`, `failed` or `not_run`.
    pub fn status(&self) -> &'static str {
        match self {
            Outcome::Passed => "passed",
            Outcome::Failed(_) => "failed",
            Outcome::NotRun => "not_run",
        }
    }

    pub fn reason(&self) -> Option<&Reason> {
        match self {
            Outcome::Failed(reason) => Some(reason),
            _ => None,
        }
    }
}

impl fmt::Display for Outcome {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Outcome::Failed(reason) => write!(f, "failed: {reason}"),
            other => f.write_str(other.status()),
        }
    }
}

/// Every step, in order, with its outcome. Holds nothing read from the emulator's files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestReport {
    pub checks: Vec<(Step, Outcome)>,
}

impl TestReport {
    /// Whether every step passed.
    pub fn passed(&self) -> bool {
        self.checks
            .iter()
            .all(|(_, outcome)| *outcome == Outcome::Passed)
    }
}

impl fmt::Display for TestReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, (step, outcome)) in self.checks.iter().enumerate() {
            if index > 0 {
                f.write_str(", ")?;
            }
            write!(f, "{step} {outcome}")?;
        }
        Ok(())
    }
}

/// Runs the five steps against `emulator`, each within `deadline`; the first failure stops the test and the
/// steps after it are [`Outcome::NotRun`]. `now` dates the signed request of the `credentials` step.
pub async fn test(emulator: &Emulator, deadline: Duration, now: SystemTime) -> TestReport {
    let failure = run(emulator, deadline, now).await.err();
    let failed_at = failure.as_ref().map_or(Step::ALL.len(), |(step, _)| *step as usize);
    let mut reason = failure.map(|(_, reason)| reason);
    let checks = Step::ALL
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let outcome = if index < failed_at {
                Outcome::Passed
            } else if let Some(reason) = reason.take() {
                Outcome::Failed(reason)
            } else {
                Outcome::NotRun
            };
            (*step, outcome)
        })
        .collect();
    TestReport { checks }
}

/// Runs the steps in order; the first failure is returned with its step.
async fn run(emulator: &Emulator, deadline: Duration, now: SystemTime) -> Result<(), (Step, Reason)> {
    let at = |step: Step| move |reason: Reason| (step, reason);

    let files = within(deadline, async {
        EmulatorFiles::read(emulator).await.map_err(from_files)
    })
    .await
    .map_err(at(Step::Files))?;

    let tcp = within(deadline, async {
        TcpStream::connect(emulator.socket_addr())
            .await
            .map_err(from_connect)
    })
    .await
    .map_err(at(Step::Connection))?;

    let tls = within(deadline, async {
        let config = client_config(&files).map_err(from_files)?;
        handshake(tcp, emulator.ip(), config).await
    })
    .await
    .map_err(at(Step::Tls))?;

    within(deadline, exchange(tls, emulator))
        .await
        .map_err(at(Step::Health))?;

    within(deadline, async {
        let request = credentials_request(emulator, files.credentials(), now)?;
        let upstream = connect(emulator, &files, deadline, deadline).await?;
        match send_once(upstream.stream, request).await? {
            StatusCode::OK => Ok(()),
            StatusCode::FORBIDDEN => Err(Reason::CredentialsRejected),
            other => Err(Reason::UnexpectedResponse {
                status: other.as_u16(),
            }),
        }
    })
    .await
    .map_err(at(Step::Credentials))
}

async fn within<T>(
    deadline: Duration,
    step: impl Future<Output = Result<T, Reason>>,
) -> Result<T, Reason> {
    tokio::time::timeout(deadline, step)
        .await
        .unwrap_or(Err(Reason::Timeout))
}

fn from_connect(error: io::Error) -> Reason {
    match error.kind() {
        io::ErrorKind::ConnectionRefused => Reason::ConnectionRefused,
        kind => Reason::ConnectionFailed {
            kind: kind.to_string(),
        },
    }
}

/// The `credentials` step's request: `POST /` to `emulator`, `Host` its `<ip>:<port>`, the STS
/// `GetCallerIdentity` body, signed with `credentials` for `sts`/`us-east-1` at `now` (header form, signed headers
/// `content-type;host;x-amz-date`, the payload hash of the body).
pub fn credentials_request(
    emulator: &Emulator,
    credentials: &Credentials,
    now: SystemTime,
) -> Result<Request<Full<Bytes>>, Reason> {
    let amz_date = amz_date(now);
    let scope = Scope {
        date: amz_date[..8].to_owned(),
        region: REGION.to_owned(),
        service: SERVICE.to_owned(),
    };
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/")
        .header(HOST, emulator.socket_addr().to_string())
        .header(CONTENT_TYPE, CREDENTIALS_CONTENT_TYPE)
        .header(AMZ_DATE, amz_date.as_str())
        .body(Full::new(Bytes::from_static(CREDENTIALS_BODY.as_bytes())))
        .map_err(|_| http_failed())?;
    let signed = [CONTENT_TYPE, HOST, AMZ_DATE];
    let payload_hash = hex(digest::digest(&digest::SHA256, CREDENTIALS_BODY.as_bytes()).as_ref());
    let canonical = canonical_request(
        &Method::POST,
        "/",
        "",
        request.headers(),
        &signed,
        &payload_hash,
        UriMode::EncodeSegments,
    );
    let signature = signature(
        &credentials.secret_access_key,
        &scope,
        &string_to_sign(&amz_date, &scope, &canonical),
    );
    let authorization = format!(
        "{ALGORITHM} Credential={}/{}, SignedHeaders=content-type;host;x-amz-date, Signature={signature}",
        credentials.access_key_id.expose(),
        scope_text(&scope),
    );
    let value = HeaderValue::from_str(&authorization).map_err(|_| http_failed())?;
    request.headers_mut().insert(AUTHORIZATION, value);
    Ok(request)
}

/// Sends `request` and returns the status of its answer, whose body is read through [`BODY_CAP`] only to end the
/// exchange and never looked at. One request, never a second: a redirect is a status like any other.
async fn send_once<S>(tls: S, request: Request<Full<Bytes>>) -> Result<StatusCode, Reason>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(tls))
        .await
        .map_err(|_| http_failed())?;
    let answer = async move {
        let response = sender
            .send_request(request)
            .await
            .map_err(|_| http_failed())?;
        let status = response.status();
        // The body is drained, not read: a longer one or a broken one changes nothing.
        let _ = Limited::new(response.into_body(), BODY_CAP).collect().await;
        Ok(status)
    };
    // Driven here, not spawned, so dropping the test drops the connection with it.
    tokio::pin!(answer, connection);
    tokio::select! {
        result = &mut answer => result,
        _ = &mut connection => answer.await,
    }
}

/// `yyyymmddThhmmssZ` of `now` in UTC; a time before the Unix epoch is the epoch.
fn amz_date(now: SystemTime) -> String {
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    let (days, of_day) = (seconds / 86_400, seconds % 86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        of_day / 3600,
        of_day % 3600 / 60,
        of_day % 60
    )
}

/// The proleptic Gregorian date of a count of days since 1970-01-01 (H. Hinnant, "chrono-Compatible Low-Level
/// Date Algorithms", `civil_from_days`, for non-negative day counts).
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

fn hex(bytes: &[u8]) -> String {
    use fmt::Write;
    bytes.iter().fold(String::new(), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    })
}
