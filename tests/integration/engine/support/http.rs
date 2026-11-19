//! Raw HTTP/1.1 over `std::net::TcpStream`, so a check sets or omits `Host` and `Origin` exactly as it means
//! to. One request per connection (`Connection: close`).

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

use crate::support::check::Ctx;
use crate::support::net::connect;

/// Every request is answered within this bound or the helper gives up (`TimedOut`).
pub const ANSWER_BOUND: Duration = Duration::from_secs(5);

pub struct Request {
    method: String,
    path: String,
    /// `None` sends no `Host` header at all.
    host: Option<String>,
    headers: Vec<(String, String)>,
    /// Sent after the head with its `Content-Length` (also `0` for an empty `POST` or `PUT`).
    body: Vec<u8>,
}

impl Request {
    /// A request with `Host: 127.0.0.1:<port>` of the address it is sent to.
    pub fn new(method: &str, path: &str) -> Request {
        Request {
            method: method.to_owned(),
            path: path.to_owned(),
            host: Some(String::new()),
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    pub fn get(path: &str) -> Request {
        Request::new("GET", path)
    }

    pub fn head(path: &str) -> Request {
        Request::new("HEAD", path)
    }

    /// Sends `Host: <host>` instead of the address's own.
    pub fn host(mut self, host: &str) -> Request {
        self.host = Some(host.to_owned());
        self
    }

    pub fn header(mut self, name: &str, value: &str) -> Request {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    /// A JSON body with `Content-Type: application/json` (issue 485's targets API).
    pub fn json(mut self, body: &serde_json::Value) -> Request {
        self.headers
            .push(("Content-Type".to_owned(), "application/json".to_owned()));
        self.body = body.to_string().into_bytes();
        self
    }

    /// Sends the request to `127.0.0.1:<port>` and reads the whole answer.
    pub fn send(&self, ctx: &Ctx, port: u16) -> io::Result<Response> {
        self.send_to(ctx, SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
    }

    pub fn send_to(&self, ctx: &Ctx, addr: SocketAddr) -> io::Result<Response> {
        let started = Instant::now();
        let mut stream = connect(ctx, addr)?;
        let mut head = format!("{} {} HTTP/1.1\r\n", self.method, self.path);
        match &self.host {
            Some(h) if h.is_empty() => head.push_str(&format!("Host: {addr}\r\n")),
            Some(h) => head.push_str(&format!("Host: {h}\r\n")),
            None => {}
        }
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        if !self.body.is_empty() || matches!(self.method.as_str(), "POST" | "PUT") {
            head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        }
        head.push_str("Connection: close\r\n\r\n");
        stream.write_all(head.as_bytes())?;
        stream.write_all(&self.body)?;

        let mut raw = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let left = ANSWER_BOUND
                .checked_sub(started.elapsed())
                .filter(|d| !d.is_zero());
            let Some(left) = left else {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "no complete answer within 5 s",
                ));
            };
            stream.set_read_timeout(Some(left))?;
            match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => raw.extend_from_slice(&buf[..n]),
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) =>
                {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "no complete answer within 5 s",
                    ));
                }
                Err(e) if e.kind() == io::ErrorKind::ConnectionReset && !raw.is_empty() => break,
                Err(e) => return Err(e),
            }
        }
        let mut response = Response::parse(&raw, self.method == "HEAD")?;
        response.elapsed = started.elapsed();
        ctx.log(format!(
            "{} {} (Host {:?}) -> {} in {} ms",
            self.method,
            self.path,
            self.host
                .as_deref()
                .map(|h| if h.is_empty() { "own" } else { h }),
            response.status,
            response.elapsed.as_millis()
        ));
        Ok(response)
    }
}

pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub elapsed: Duration,
}

impl Response {
    fn parse(raw: &[u8], head_request: bool) -> io::Result<Response> {
        let bad = |what: &str| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("malformed answer: {what}"),
            )
        };
        let end = raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or_else(|| bad("no end of headers"))?;
        let head = std::str::from_utf8(&raw[..end]).map_err(|_| bad("headers are not UTF-8"))?;
        let mut lines = head.split("\r\n");
        let status_line = lines.next().ok_or_else(|| bad("no status line"))?;
        let status = status_line
            .split(' ')
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .filter(|_| status_line.starts_with("HTTP/1."))
            .ok_or_else(|| bad("status line"))?;
        let headers: Vec<(String, String)> = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(n, v)| (n.trim().to_ascii_lowercase(), v.trim().to_owned()))
            .collect();
        let rest = &raw[end + 4..];
        let chunked = headers
            .iter()
            .any(|(n, v)| n == "transfer-encoding" && v.eq_ignore_ascii_case("chunked"));
        let body = if head_request || !chunked {
            rest.to_vec()
        } else {
            dechunk(rest).ok_or_else(|| bad("chunks"))?
        };
        Ok(Response {
            status,
            headers,
            body,
            elapsed: Duration::ZERO,
        })
    }

    /// The first value of a header, by case-insensitive name.
    pub fn header(&self, name: &str) -> Option<&str> {
        let name = name.to_ascii_lowercase();
        self.headers
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v.as_str())
    }

    /// The body as JSON; panics (verdict `failed`) when it is not.
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| {
            panic!(
                "status {} body is not JSON ({e}): {}",
                self.status,
                self.text()
            )
        })
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn dechunk(mut rest: &[u8]) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        let line_end = rest.windows(2).position(|w| w == b"\r\n")?;
        let size_text = std::str::from_utf8(&rest[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        rest = &rest[line_end + 2..];
        if size == 0 {
            return Some(body);
        }
        body.extend_from_slice(rest.get(..size)?);
        rest = rest.get(size + 2..)?;
    }
}
