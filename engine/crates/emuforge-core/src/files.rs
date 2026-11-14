use std::fmt;
use std::io;
use std::path::Path;

use rustls::pki_types::CertificateDer;
use rustls::pki_types::pem::PemObject;
use tokio::io::AsyncReadExt;

use crate::{Emulator, Error};

/// The emulator's certificate file, the only trust root for its TLS.
pub const CA_FILE: &str = "ca.pem";
/// The emulator's key file: `[default]` with `aws_access_key_id` and `aws_secret_access_key`.
pub const CREDENTIALS_FILE: &str = "emulator_credentials";
/// No emulator file is read past this many bytes.
pub const FILE_CAP: u64 = 64 * 1024;

/// A value that must never be printed. `Debug` and `Display` show `[redacted]`.
pub struct Secret(String);

impl Secret {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

/// The emulator's keys, read from its `emulator_credentials`.
#[derive(Debug)]
pub struct Credentials {
    pub access_key_id: Secret,
    pub secret_access_key: Secret,
}

/// The two emulator files the engine uses, read and checked.
pub struct EmulatorFiles {
    ca: Vec<CertificateDer<'static>>,
    credentials: Credentials,
}

impl fmt::Debug for EmulatorFiles {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EmulatorFiles")
            .field("ca_certificates", &self.ca.len())
            .field("credentials", &self.credentials)
            .finish()
    }
}

impl EmulatorFiles {
    /// Reads `ca.pem` and `emulator_credentials` from the emulator's directory, each through [`FILE_CAP`].
    /// Nothing else is opened.
    pub async fn read(emulator: &Emulator) -> Result<EmulatorFiles, Error> {
        let ca = read_capped(emulator.dir(), CA_FILE).await?;
        let credentials = read_capped(emulator.dir(), CREDENTIALS_FILE).await?;
        Ok(EmulatorFiles {
            ca: parse_ca(&ca)?,
            credentials: parse_credentials(&credentials)?,
        })
    }

    pub fn credentials(&self) -> &Credentials {
        &self.credentials
    }

    pub(crate) fn ca(&self) -> &[CertificateDer<'static>] {
        &self.ca
    }
}

async fn read_capped(dir: &Path, file: &'static str) -> Result<Vec<u8>, Error> {
    let unreadable = |error: io::Error| match error.kind() {
        io::ErrorKind::NotFound => Error::FilesMissing { file },
        kind => Error::FileUnreadable { file, kind },
    };
    let handle = tokio::fs::File::open(dir.join(file))
        .await
        .map_err(unreadable)?;
    let mut bytes = Vec::new();
    handle
        .take(FILE_CAP + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(unreadable)?;
    if bytes.len() as u64 > FILE_CAP {
        return Err(Error::FileUnreadable {
            file,
            kind: io::ErrorKind::FileTooLarge,
        });
    }
    Ok(bytes)
}

fn parse_ca(bytes: &[u8]) -> Result<Vec<CertificateDer<'static>>, Error> {
    let malformed = || Error::FileMalformed { file: CA_FILE };
    let certificates = CertificateDer::pem_slice_iter(bytes)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| malformed())?;
    if certificates.is_empty() {
        return Err(malformed());
    }
    Ok(certificates)
}

/// `[default]` with both keys present and non-empty; other sections, other keys, blank lines and comments are
/// ignored, and whitespace around `=` is trimmed.
fn parse_credentials(bytes: &[u8]) -> Result<Credentials, Error> {
    let malformed = || Error::FileMalformed {
        file: CREDENTIALS_FILE,
    };
    let text = std::str::from_utf8(bytes).map_err(|_| malformed())?;
    let mut in_default = false;
    let mut access_key_id = None;
    let mut secret_access_key = None;
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(section) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            in_default = section.trim() == "default";
            continue;
        }
        if !in_default {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "aws_access_key_id" => access_key_id = Some(value.trim()),
            "aws_secret_access_key" => secret_access_key = Some(value.trim()),
            _ => {}
        }
    }
    match (access_key_id, secret_access_key) {
        (Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Ok(Credentials {
            access_key_id: Secret(id.to_owned()),
            secret_access_key: Secret(secret.to_owned()),
        }),
        _ => Err(malformed()),
    }
}
