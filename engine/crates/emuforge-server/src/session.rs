use std::fmt;
use std::hint::black_box;

use crate::Error;

/// Random bytes in a token; written as twice as many lowercase hexadecimal characters.
const TOKEN_BYTES: usize = 32;
const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";

/// The engine's session token: created once per process from the operating system's random source and held in
/// memory only. `Debug` and `Display` print `[redacted]`; it has no `Clone`, `Serialize` or `PartialEq`.
pub struct SessionToken(String);

impl SessionToken {
    /// 32 bytes from the operating system's random source as 64 lowercase hexadecimal characters.
    pub fn generate() -> Result<SessionToken, Error> {
        let mut bytes = [0u8; TOKEN_BYTES];
        getrandom::getrandom(&mut bytes).map_err(|error| Error::SessionToken {
            kind: error.to_string(),
        })?;
        let mut hex = String::with_capacity(TOKEN_BYTES * 2);
        for byte in bytes {
            hex.push(char::from(HEX_DIGITS[usize::from(byte >> 4)]));
            hex.push(char::from(HEX_DIGITS[usize::from(byte & 0x0f)]));
        }
        Ok(SessionToken(hex))
    }

    /// Whether `candidate` is the token byte for byte. Every byte is compared whatever the first difference, so
    /// the time taken does not tell where a guess went wrong.
    pub fn matches(&self, candidate: &[u8]) -> bool {
        let expected = self.0.as_bytes();
        if candidate.len() != expected.len() {
            return false;
        }
        let mut difference = 0u8;
        for (a, b) in expected.iter().zip(candidate) {
            difference = black_box(difference | (a ^ b));
        }
        difference == 0
    }

    /// The token itself. Only the session route's `200` answer shows it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl fmt::Display for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token() -> SessionToken {
        SessionToken::generate().unwrap()
    }

    #[test]
    fn generate_when_called_is_64_lowercase_hex() {
        let token = token();
        let value = token.expose();
        assert_eq!(value.len(), 64, "length of the token");
        assert!(
            value
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
            "a character outside 0-9a-f"
        );
    }

    #[test]
    fn generate_called_twice_gives_different_tokens() {
        assert_ne!(token().expose(), token().expose());
    }

    #[test]
    fn matches_own_value_is_true() {
        let token = token();
        assert!(token.matches(token.expose().as_bytes()));
    }

    #[test]
    fn matches_changed_value_is_false() {
        let token = token();
        let value = token.expose().as_bytes().to_vec();
        let changed = |at: usize| {
            let mut bytes = value.clone();
            bytes[at] = if bytes[at] == b'0' { b'1' } else { b'0' };
            bytes
        };
        let mut upper = value.to_ascii_uppercase();
        if upper == value {
            // A token of digits only has no upper case form; change one byte so the case still differs.
            upper[0] = b'A';
        }
        let mut longer = value.clone();
        longer.push(b'0');
        let cases: [(&str, Vec<u8>); 7] = [
            ("first character changed", changed(0)),
            ("middle character changed", changed(32)),
            ("last character changed", changed(63)),
            ("upper case", upper),
            ("one character shorter", value[..63].to_vec()),
            ("one character longer", longer),
            ("empty", Vec::new()),
        ];
        for (name, candidate) in cases {
            assert!(!token.matches(&candidate), "case {name}");
        }
    }

    #[test]
    fn debug_and_display_of_token_are_redacted() {
        let token = token();
        let value = token.expose();
        for (name, shown) in [
            ("Debug", format!("{token:?}")),
            ("Display", format!("{token}")),
        ] {
            assert_eq!(shown, "[redacted]", "case {name}");
            for run in value.as_bytes().windows(9) {
                let run = std::str::from_utf8(run).unwrap();
                assert!(
                    !shown.contains(run),
                    "case {name}: shows a run of the token"
                );
            }
        }
    }
}
