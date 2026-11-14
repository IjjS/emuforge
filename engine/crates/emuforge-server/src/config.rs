use std::net::{Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;

use crate::Error;

#[allow(
    clippy::expect_used,
    reason = "a constant, checked when the crate compiles"
)]
pub const DEFAULT_ENGINE_PORT: NonZeroU16 = NonZeroU16::new(8297).expect("8297 is not zero");
#[allow(
    clippy::expect_used,
    reason = "a constant, checked when the crate compiles"
)]
pub const DEFAULT_EMULATOR_PORT: NonZeroU16 = NonZeroU16::new(9297).expect("9297 is not zero");
/// Requests in flight across every route; one more is answered `503 Busy` at once.
pub const MAX_IN_FLIGHT: usize = 32;
/// The only address the engine listens on. No setting changes it.
pub const LISTEN_IP: Ipv4Addr = Ipv4Addr::LOCALHOST;

/// The engine's settings. A flag wins over its environment variable.
#[derive(Debug, Clone, PartialEq, Eq, clap::Parser)]
#[command(name = "emuforge-server", about = "The EmuForge engine, on 127.0.0.1")]
pub struct Config {
    /// Port the engine listens on, always on 127.0.0.1
    #[arg(long, env = "EMUFORGE_ENGINE_PORT", default_value_t = DEFAULT_ENGINE_PORT)]
    pub port: NonZeroU16,
    /// Port of the local aws-emulator, reached at https://127.0.0.1:<port>
    #[arg(long = "emulator-port", env = "EMULATOR_PORT", default_value_t = DEFAULT_EMULATOR_PORT)]
    pub emulator_port: NonZeroU16,
}

impl Config {
    /// The engine port must differ from the emulator port.
    pub fn validate(&self) -> Result<(), Error> {
        if self.port == self.emulator_port {
            return Err(Error::SamePort {
                port: self.port.get(),
            });
        }
        Ok(())
    }
}

/// `127.0.0.1:<port>`: the one address `serve` binds.
pub fn listen_addr(config: &Config) -> SocketAddr {
    SocketAddr::new(LISTEN_IP.into(), config.port.get())
}
