//! Values that must never reach a log, a verdict file or the test output: the keys and certificate lines of
//! every emulator a check has seen. Everything support writes passes through `redact` first, and the panic hook
//! installed by `check` redacts assertion messages, so a defective engine that echoes a key cannot make the
//! harness print it.

use std::sync::Mutex;

static SECRETS: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub const REDACTED: &str = "[redacted]";

/// Remembers values to be redacted from everything support writes from now on.
pub fn register<I, S>(values: I)
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut secrets = SECRETS.lock().unwrap_or_else(|e| e.into_inner());
    for value in values {
        let value = value.into();
        if !value.is_empty() && !secrets.contains(&value) {
            secrets.push(value);
        }
    }
    // Longest first, so a value that contains another is replaced whole.
    secrets.sort_by_key(|s| std::cmp::Reverse(s.len()));
}

/// The text with every registered value replaced by `[redacted]`.
pub fn redact(text: &str) -> String {
    let secrets = SECRETS.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = text.to_owned();
    for secret in secrets.iter() {
        if out.contains(secret.as_str()) {
            out = out.replace(secret.as_str(), REDACTED);
        }
    }
    out
}
