//! The host names the user allows at start (`--allow-host`), and the `Host` headers Studio's port accepts: its own
//! loopback address and those names (issue 503). The list is fixed for the life of the process; nothing learned
//! from a request, a file or a route adds to it (B2).

use std::fmt;
use std::num::NonZeroU16;
use std::str::FromStr;

use axum::http::HeaderMap;
use axum::http::header::HOST;

/// The longest host name, without a trailing dot (RFC 1035).
const NAME_MAX: usize = 253;
/// The longest label of a host name.
const LABEL_MAX: usize = 63;

/// One value of `--allow-host`: a host name or an IPv4 address, lower-cased, and an optional port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowedHost {
    name: String,
    port: Option<NonZeroU16>,
}

impl AllowedHost {
    /// Whether `name` and `port`, both as a `Host` header gives them and lower-cased, are this value: the name
    /// byte for byte, and the port, when this value names one, equal to it.
    fn matches(&self, name: &str, port: Option<NonZeroU16>) -> bool {
        self.name == name && self.port.is_none_or(|own| port == Some(own))
    }
}

/// Why a value of `--allow-host` was refused; the text names the value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "{value:?} is not a host name or IPv4 address with an optional :<port>: {reason}; give a name such as my-machine.example.ts.net or my-machine.example.ts.net:8296"
)]
pub struct AllowedHostError {
    value: String,
    reason: &'static str,
}

impl FromStr for AllowedHost {
    type Err = AllowedHostError;

    /// `<name>` or `<name>:<port>`: `<name>` at most 253 ASCII characters, labels of 1 to 63 letters, digits and
    /// `-` separated by `.`, none starting or ending with `-`; `<port>` 1 to 65535 in decimal digits without a
    /// leading zero.
    fn from_str(value: &str) -> Result<AllowedHost, AllowedHostError> {
        let refuse = |reason| AllowedHostError {
            value: value.to_owned(),
            reason,
        };
        let (name, port) = match value.split_once(':') {
            Some((name, port)) => (name, Some(parse_port(port).ok_or_else(|| refuse(PORT))?)),
            None => (value, None),
        };
        if let Some(reason) = name_fault(name) {
            return Err(refuse(reason));
        }
        Ok(AllowedHost {
            name: name.to_ascii_lowercase(),
            port,
        })
    }
}

impl fmt::Display for AllowedHost {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.port {
            Some(port) => write!(f, "{}:{port}", self.name),
            None => f.write_str(&self.name),
        }
    }
}

const PORT: &str = "the port must be 1 to 65535 in decimal digits without a leading zero";

/// What is wrong with `name` as a host name, or `None`.
fn name_fault(name: &str) -> Option<&'static str> {
    if name.is_empty() {
        return Some("the name is empty");
    }
    if name.len() > NAME_MAX {
        return Some("the name is longer than 253 characters");
    }
    for label in name.split('.') {
        if label.is_empty() {
            return Some("a label is empty (two dots in a row, or a dot at either end)");
        }
        if label.len() > LABEL_MAX {
            return Some("a label is longer than 63 characters");
        }
        if !label
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Some(
                "a name holds only ASCII letters, digits, '-' and '.' (no scheme, path, wildcard, brackets or space)",
            );
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Some("a label starts or ends with '-'");
        }
    }
    None
}

/// 1 to 65535 in decimal digits without a leading zero.
fn parse_port(text: &str) -> Option<NonZeroU16> {
    if text.is_empty() || text.starts_with('0') || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// The `Host` headers Studio's port accepts: `127.0.0.1:<studio port>` and every allowed value.
#[derive(Debug, Clone)]
pub struct AcceptedHosts {
    loopback: String,
    allowed: Vec<AllowedHost>,
}

/// A `Host` the Studio port accepted, as sent and lower-cased.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedHost {
    host: String,
    allowed_name: bool,
}

impl AcceptedHost {
    /// The `Host` header, lower-cased.
    pub fn as_str(&self) -> &str {
        &self.host
    }

    /// Whether it matched a name allowed with `--allow-host`; `false` for `127.0.0.1:<studio port>`.
    pub fn is_allowed_name(&self) -> bool {
        self.allowed_name
    }
}

impl AcceptedHosts {
    pub fn new(studio_port: NonZeroU16, allowed: Vec<AllowedHost>) -> AcceptedHosts {
        AcceptedHosts {
            loopback: format!("127.0.0.1:{studio_port}"),
            allowed,
        }
    }

    /// `127.0.0.1:<studio port>`.
    pub fn loopback(&self) -> &str {
        &self.loopback
    }

    /// The accepted host of a request with exactly one `Host` header that is `127.0.0.1:<studio port>` or matches
    /// an allowed value, both sides compared after ASCII lower-casing: `<name>` matches `<name>` and
    /// `<name>:<port>` for any port by the grammar of `--allow-host`; `<name>:<port>` matches only itself.
    pub fn accept(&self, headers: &HeaderMap) -> Option<AcceptedHost> {
        let mut hosts = headers.get_all(HOST).iter();
        let (Some(host), None) = (hosts.next(), hosts.next()) else {
            return None;
        };
        let host = host.to_str().ok()?.to_ascii_lowercase();
        if host == self.loopback {
            return Some(AcceptedHost {
                host,
                allowed_name: false,
            });
        }
        let (name, port) = match host.split_once(':') {
            Some((name, port)) => (name, Some(parse_port(port)?)),
            None => (host.as_str(), None),
        };
        self.allowed
            .iter()
            .any(|allowed| allowed.matches(name, port))
            .then(|| AcceptedHost {
                host: host.clone(),
                allowed_name: true,
            })
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    fn label(length: usize) -> String {
        "a".repeat(length)
    }

    /// A name of exactly `length` characters: labels of 63 `a` separated by `.`, the last one shorter.
    fn name_of(length: usize) -> String {
        let mut name = String::new();
        while name.len() + LABEL_MAX < length {
            name.push_str(&label(LABEL_MAX));
            name.push('.');
        }
        name.push_str(&label(length - name.len()));
        assert_eq!(name.len(), length);
        name
    }

    #[test]
    fn allowed_host_from_str_valid_values_are_accepted_and_display_lower_cased() {
        let cases = [
            "name.test".to_owned(),
            "Name.Test".to_owned(),
            "a-b.c1.test".to_owned(),
            "100.64.0.9".to_owned(),
            "name.test:8296".to_owned(),
            "name.test:1".to_owned(),
            "name.test:65535".to_owned(),
            format!("{}.test", label(63)),
            name_of(253),
        ];
        for value in cases {
            let host: AllowedHost = value
                .parse()
                .unwrap_or_else(|error| panic!("case {value}: {error}"));
            assert_eq!(host.to_string(), value.to_ascii_lowercase(), "case {value}");
        }
    }

    #[test]
    fn allowed_host_from_str_invalid_values_are_an_error_naming_the_value() {
        let cases = [
            ("empty", String::new()),
            ("scheme", "http://name.test".to_owned()),
            ("path", "name.test/x".to_owned()),
            ("wildcard", "*.name.test".to_owned()),
            ("IPv6 literal", "[::1]".to_owned()),
            ("space", "name test".to_owned()),
            ("non-ASCII letter", "nämé.test".to_owned()),
            ("empty label", "name..test".to_owned()),
            ("trailing dot", "name.test.".to_owned()),
            ("label starting with -", "-name.test".to_owned()),
            ("label ending with -", "name-.test".to_owned()),
            ("64-character label", format!("{}.test", label(64))),
            ("254 characters", name_of(254)),
            ("port 0", "name.test:0".to_owned()),
            ("port 65536", "name.test:65536".to_owned()),
            ("port 080", "name.test:080".to_owned()),
            ("empty port", "name.test:".to_owned()),
            ("port not a number", "name.test:x".to_owned()),
        ];
        for (name, value) in cases {
            let error = value
                .parse::<AllowedHost>()
                .expect_err(&format!("case {name}"));
            assert!(
                error.to_string().contains(&format!("{value:?}")),
                "case {name}: {error}"
            );
        }
    }

    fn hosts(allowed: &[&str]) -> AcceptedHosts {
        AcceptedHosts::new(
            NonZeroU16::new(8296).unwrap(),
            allowed.iter().map(|value| value.parse().unwrap()).collect(),
        )
    }

    fn with_hosts(values: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for value in values {
            headers.append(HOST, HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    #[test]
    fn accepted_hosts_accept_loopback_and_allowed_names() {
        let accepted = hosts(&["name.test", "fixed.test:9000"]);
        let cases = [
            ("127.0.0.1:8296", "127.0.0.1:8296", false),
            ("name.test", "name.test", true),
            ("name.test:443", "name.test:443", true),
            ("NAME.test:8296", "name.test:8296", true),
            ("fixed.test:9000", "fixed.test:9000", true),
        ];
        for (host, expected, allowed_name) in cases {
            let got = accepted
                .accept(&with_hosts(&[host]))
                .unwrap_or_else(|| panic!("case {host}: not accepted"));
            assert_eq!(got.as_str(), expected, "case {host}");
            assert_eq!(got.is_allowed_name(), allowed_name, "case {host}");
        }
    }

    #[test]
    fn accepted_hosts_accept_other_hosts_are_not_accepted() {
        let accepted = hosts(&["name.test", "fixed.test:9000"]);
        let cases: [(&str, &[&str]); 14] = [
            ("absent", &[]),
            ("twice", &["name.test", "name.test"]),
            ("loopback without port", &["127.0.0.1"]),
            ("engine port", &["127.0.0.1:8297"]),
            ("localhost", &["localhost:8296"]),
            ("other", &["other.test"]),
            ("prefixed", &["xname.test"]),
            ("suffixed", &["name.test.evil.test"]),
            ("fixed without port", &["fixed.test"]),
            ("fixed other port", &["fixed.test:9001"]),
            ("empty port", &["name.test:"]),
            ("port not a number", &["name.test:x"]),
            ("port out of range", &["name.test:99999"]),
            ("port with leading zero", &["name.test:080"]),
        ];
        for (name, values) in cases {
            assert_eq!(accepted.accept(&with_hosts(values)), None, "case {name}");
        }
    }

    #[test]
    fn accepted_hosts_accept_without_allowed_values_refuses_a_name() {
        assert_eq!(hosts(&[]).accept(&with_hosts(&["name.test:8296"])), None);
    }
}
