//! A target: one emulator connection by name, on a loopback endpoint, and the settings that hold the targets and
//! the name of the active one. Everything here is validated on construction; nothing touches the disk.

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::num::NonZeroU16;

use serde::{Serialize, Serializer};
use serde_json::{Map, Value};

/// No settings hold more targets than this.
pub const MAX_TARGETS: usize = 32;
/// The longest target name.
pub const NAME_MAX: usize = 64;

/// Why a target or a change of the settings is refused. No variant holds a value read from an emulator's files.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TargetError {
    #[error("the target field {field} is not valid: {why}")]
    Invalid { field: String, why: String },
    #[error(
        "the endpoint is not a loopback address: use https://<IP in 127.0.0.0/8 or [::1]>:<port>; host names, localhost included, are not accepted"
    )]
    NotLoopback,
    #[error("a target named {name} already exists; choose another name")]
    Exists { name: String },
    #[error("there are already {MAX_TARGETS} targets, the most there can be; remove one first")]
    Limit,
    #[error("there is no target named {name}")]
    NotFound { name: String },
    #[error("the target {name} is the active one; use another target first")]
    Active { name: String },
}

fn invalid(field: &str, why: impl Into<String>) -> TargetError {
    TargetError::Invalid {
        field: field.to_owned(),
        why: why.into(),
    }
}

/// A target's name: 1 to 64 characters of `a-z`, `0-9`, `-` and `_`, starting with a letter or a digit.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TargetName(String);

impl TargetName {
    pub fn parse(text: &str) -> Result<TargetName, TargetError> {
        let allowed = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_';
        let starts_well = text
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
        if text.is_empty() || text.len() > NAME_MAX || !starts_well || !text.chars().all(allowed) {
            return Err(invalid(
                "name",
                format!(
                    "a name is 1 to {NAME_MAX} characters of a-z, 0-9, - and _, starting with a letter or a digit"
                ),
            ));
        }
        Ok(TargetName(text.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for TargetName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for TargetName {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

/// `https://` + an IP literal in `127.0.0.0/8` or `[::1]` + an explicit port. No name is ever resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Endpoint {
    ip: IpAddr,
    port: NonZeroU16,
}

impl Endpoint {
    /// Accepts `https://<loopback IP>:<port>` with at most a lone trailing `/`. A host that is not a loopback IP
    /// literal is [`TargetError::NotLoopback`]; any other fault is [`TargetError::Invalid`] for `endpoint`.
    pub fn parse(text: &str) -> Result<Endpoint, TargetError> {
        let field = "endpoint";
        let rest = text
            .strip_prefix("https://")
            .ok_or_else(|| invalid(field, "the scheme must be https://"))?;
        if rest.contains('@') {
            return Err(invalid(field, "an endpoint holds no user info"));
        }
        if rest.contains('?') || rest.contains('#') {
            return Err(invalid(field, "an endpoint holds no query or fragment"));
        }
        let (authority, path) = match rest.find('/') {
            Some(at) => rest.split_at(at),
            None => (rest, ""),
        };
        if !(path.is_empty() || path == "/") {
            return Err(invalid(field, "an endpoint holds no path"));
        }
        let (host, port) = if let Some(bracketed) = authority.strip_prefix('[') {
            let (host, after) = bracketed
                .split_once(']')
                .ok_or_else(|| invalid(field, "an IPv6 address is closed with ]"))?;
            let port = after
                .strip_prefix(':')
                .ok_or_else(|| invalid(field, "the port is missing"))?;
            (Host::V6(host), port)
        } else {
            let (host, port) = authority
                .rsplit_once(':')
                .ok_or_else(|| invalid(field, "the port is missing"))?;
            (Host::Other(host), port)
        };
        let port = parse_port(port)?;
        let ip = host.loopback_ip()?;
        Ok(Endpoint { ip, port })
    }

    pub fn ip(&self) -> IpAddr {
        self.ip
    }

    pub fn port(&self) -> NonZeroU16 {
        self.port
    }
}

enum Host<'a> {
    V6(&'a str),
    Other(&'a str),
}

impl Host<'_> {
    fn loopback_ip(&self) -> Result<IpAddr, TargetError> {
        match self {
            Host::V6(text) => match text.parse::<Ipv6Addr>() {
                Ok(ip) if ip == Ipv6Addr::LOCALHOST => Ok(ip.into()),
                _ => Err(TargetError::NotLoopback),
            },
            Host::Other(text) => match text.parse::<Ipv4Addr>() {
                Ok(ip) if ip.is_loopback() => Ok(ip.into()),
                _ => Err(TargetError::NotLoopback),
            },
        }
    }
}

fn parse_port(text: &str) -> Result<NonZeroU16, TargetError> {
    let refused = || invalid("endpoint", "the port is a number from 1 to 65535");
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(refused());
    }
    text.parse::<NonZeroU16>().map_err(|_| refused())
}

/// The normalized form: `https://127.0.0.1:9297`, `https://[::1]:9297`.
impl fmt::Display for Endpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "https://{}", SocketAddr::new(self.ip, self.port.get()))
    }
}

impl Serialize for Endpoint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

/// The cloud the emulator stands in for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum Provider {
    #[default]
    #[serde(rename = "aws")]
    Aws,
}

/// The emulator program.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum EmulatorKind {
    #[default]
    #[serde(rename = "aws-emulator")]
    AwsEmulator,
}

/// Where the target's keys are: the emulator's own folder for the endpoint's port, `~/.aws/emulator/<port>/`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum CredentialsRef {
    #[default]
    #[serde(rename = "emulator-files")]
    EmulatorFiles,
}

/// What the target's certificate is verified against: the `ca.pem` of that same folder, for the endpoint's IP.
/// There is no value that turns verification off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub enum TlsTrust {
    #[default]
    #[serde(rename = "emulator-ca")]
    EmulatorCa,
}

/// A field with one accepted value: left out or that value gives the default, anything else is refused.
fn only<T: Default>(text: Option<&str>, field: &str, accepted: &str) -> Result<T, TargetError> {
    match text {
        None => Ok(T::default()),
        Some(value) if value == accepted => Ok(T::default()),
        Some(_) => Err(invalid(
            field,
            format!("the only accepted value is {accepted}"),
        )),
    }
}

/// One emulator connection by name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Target {
    name: TargetName,
    provider: Provider,
    emulator: EmulatorKind,
    endpoint: Endpoint,
    credentials: CredentialsRef,
    tls: TlsTrust,
}

/// The fields a target is read from, as text; `provider`, `emulator`, `credentials` and `tls` may be left out.
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TargetForm {
    name: String,
    provider: Option<String>,
    emulator: Option<String>,
    endpoint: String,
    credentials: Option<String>,
    tls: Option<String>,
}

const FIELDS: [&str; 6] = [
    "name",
    "provider",
    "emulator",
    "endpoint",
    "credentials",
    "tls",
];

impl TargetForm {
    pub(crate) fn into_target(self) -> Result<Target, TargetError> {
        Ok(Target {
            name: TargetName::parse(&self.name)?,
            provider: only(self.provider.as_deref(), "provider", "aws")?,
            emulator: only(self.emulator.as_deref(), "emulator", "aws-emulator")?,
            endpoint: Endpoint::parse(&self.endpoint)?,
            credentials: only(self.credentials.as_deref(), "credentials", "emulator-files")?,
            tls: only(self.tls.as_deref(), "tls", "emulator-ca")?,
        })
    }
}

impl Target {
    /// A target with the one accepted value of every other field.
    pub fn new(name: TargetName, endpoint: Endpoint) -> Target {
        Target {
            name,
            provider: Provider::default(),
            emulator: EmulatorKind::default(),
            endpoint,
            credentials: CredentialsRef::default(),
            tls: TlsTrust::default(),
        }
    }

    /// A target from a JSON object of its fields. A value that is not an object is [`TargetError::Invalid`] for
    /// `target`; a missing, unknown or non-text field is [`TargetError::Invalid`] naming that field, and every
    /// field is then checked as [`TargetName::parse`] and [`Endpoint::parse`] do.
    pub fn from_json(value: &Value) -> Result<Target, TargetError> {
        let object = value
            .as_object()
            .ok_or_else(|| invalid("target", "a target is a JSON object"))?;
        if let Some(unknown) = object.keys().find(|key| !FIELDS.contains(&key.as_str())) {
            return Err(invalid(unknown, "the field is not known"));
        }
        let required = |field: &str| {
            text_field(object, field)?.ok_or_else(|| invalid(field, "the field is missing"))
        };
        TargetForm {
            name: required("name")?,
            provider: text_field(object, "provider")?,
            emulator: text_field(object, "emulator")?,
            endpoint: required("endpoint")?,
            credentials: text_field(object, "credentials")?,
            tls: text_field(object, "tls")?,
        }
        .into_target()
    }

    pub fn name(&self) -> &TargetName {
        &self.name
    }

    pub fn provider(&self) -> Provider {
        self.provider
    }

    pub fn emulator(&self) -> EmulatorKind {
        self.emulator
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    pub fn credentials(&self) -> CredentialsRef {
        self.credentials
    }

    pub fn tls(&self) -> TlsTrust {
        self.tls
    }
}

fn text_field(object: &Map<String, Value>, field: &str) -> Result<Option<String>, TargetError> {
    match object.get(field) {
        None => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(invalid(field, "the field is text")),
    }
}

/// The targets and the active one. Always 1 to [`MAX_TARGETS`] targets with unique names, the active one among
/// them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// The index of the active target in `targets`.
    active: usize,
    targets: Vec<Target>,
}

impl Settings {
    /// One target, active.
    pub fn seed(name: TargetName, endpoint: Endpoint) -> Settings {
        Settings {
            active: 0,
            targets: vec![Target::new(name, endpoint)],
        }
    }

    /// Settings from their parts, checked: 1 to [`MAX_TARGETS`] targets, unique names, `active` one of them.
    pub fn new(active: &TargetName, targets: Vec<Target>) -> Result<Settings, TargetError> {
        if targets.is_empty() {
            return Err(invalid("targets", "there is at least one target"));
        }
        if targets.len() > MAX_TARGETS {
            return Err(TargetError::Limit);
        }
        for (index, target) in targets.iter().enumerate() {
            if targets[..index].iter().any(|seen| seen.name == target.name) {
                return Err(TargetError::Exists {
                    name: target.name.to_string(),
                });
            }
        }
        let active = position(&targets, active)?;
        Ok(Settings { active, targets })
    }

    pub fn active(&self) -> &Target {
        &self.targets[self.active]
    }

    pub fn targets(&self) -> &[Target] {
        &self.targets
    }

    pub fn get(&self, name: &TargetName) -> Result<&Target, TargetError> {
        Ok(&self.targets[position(&self.targets, name)?])
    }

    /// Adds `target`; the active target is unchanged.
    pub fn add(&mut self, target: Target) -> Result<(), TargetError> {
        if self.targets.iter().any(|held| held.name == target.name) {
            return Err(TargetError::Exists {
                name: target.name.to_string(),
            });
        }
        if self.targets.len() >= MAX_TARGETS {
            return Err(TargetError::Limit);
        }
        self.targets.push(target);
        Ok(())
    }

    /// Makes `name` the active target. Returns whether that changed anything.
    pub fn use_target(&mut self, name: &TargetName) -> Result<bool, TargetError> {
        let index = position(&self.targets, name)?;
        let changed = index != self.active;
        self.active = index;
        Ok(changed)
    }

    /// Removes `name`, which must not be the active target.
    pub fn remove(&mut self, name: &TargetName) -> Result<(), TargetError> {
        let index = position(&self.targets, name)?;
        if index == self.active {
            return Err(TargetError::Active {
                name: name.to_string(),
            });
        }
        self.targets.remove(index);
        if index < self.active {
            self.active -= 1;
        }
        Ok(())
    }
}

fn position(targets: &[Target], name: &TargetName) -> Result<usize, TargetError> {
    targets
        .iter()
        .position(|target| &target.name == name)
        .ok_or_else(|| TargetError::NotFound {
            name: name.to_string(),
        })
}
