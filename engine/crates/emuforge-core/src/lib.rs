//! The emulator connection: where the local aws-emulator for a port is, what its files hold, and whether it
//! answers its health route over TLS verified against its own `ca.pem`.

#![forbid(unsafe_code)]

mod emulator;
mod files;
pub mod health;
pub mod sigv4;
pub mod tls;

use std::io;

pub use emulator::Emulator;
pub use files::{CA_FILE, CREDENTIALS_FILE, Credentials, EmulatorFiles, FILE_CAP, Secret};
pub use health::{Health, PROBE_DEADLINE, Reason, probe, probe_on};
pub use tls::client_config;

/// What can go wrong while reading the emulator's files and building trust from them.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the emulator file {file} does not exist; start the emulator on this port")]
    FilesMissing { file: &'static str },
    #[error("the emulator file {file} cannot be read ({kind}); restart the emulator on this port")]
    FileUnreadable {
        file: &'static str,
        kind: io::ErrorKind,
    },
    #[error(
        "the emulator file {file} is not in the expected form; restart the emulator on this port"
    )]
    FileMalformed { file: &'static str },
    #[error(
        "a certificate in {CA_FILE} cannot be trusted as a root; restart the emulator on this port"
    )]
    TrustStore,
    #[error("the TLS client configuration cannot be built; this is an engine defect")]
    TlsConfig,
}
