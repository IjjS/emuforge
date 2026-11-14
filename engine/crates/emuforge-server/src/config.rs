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
#[allow(
    clippy::expect_used,
    reason = "a constant, checked when the crate compiles"
)]
pub const DEFAULT_STUDIO_PORT: NonZeroU16 = NonZeroU16::new(8296).expect("8296 is not zero");
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
    /// Port Studio is served on; the engine serves browsers only from http://127.0.0.1:<port> and never listens
    /// on it
    #[arg(long = "studio-port", env = "EMUFORGE_STUDIO_PORT", default_value_t = DEFAULT_STUDIO_PORT)]
    pub studio_port: NonZeroU16,
}

impl Config {
    /// The engine port must differ from the emulator port, and the studio port from both.
    pub fn validate(&self) -> Result<(), Error> {
        if self.port == self.emulator_port {
            return Err(Error::SamePort {
                port: self.port.get(),
            });
        }
        for (other, port) in [
            ("--port", self.port),
            ("--emulator-port", self.emulator_port),
        ] {
            if self.studio_port == port {
                return Err(Error::StudioPortCollides {
                    port: port.get(),
                    other,
                });
            }
        }
        Ok(())
    }
}

/// `127.0.0.1:<port>`: the one address `serve` binds.
pub fn listen_addr(config: &Config) -> SocketAddr {
    SocketAddr::new(LISTEN_IP.into(), config.port.get())
}

#[cfg(test)]
mod tests {
    use clap::error::ErrorKind;
    use clap::{CommandFactory, Parser};

    use super::*;

    fn parse(args: &[&str]) -> Result<Config, clap::Error> {
        Config::try_parse_from(std::iter::once("emuforge-server").chain(args.iter().copied()))
    }

    fn port(value: u16) -> NonZeroU16 {
        NonZeroU16::new(value).unwrap()
    }

    fn ports(engine: u16, emulator: u16, studio: u16) -> Config {
        Config {
            port: port(engine),
            emulator_port: port(emulator),
            studio_port: port(studio),
        }
    }

    #[test]
    fn studio_port_absent_is_8296() {
        assert_eq!(parse(&[]).unwrap().studio_port, port(8296));
    }

    #[test]
    fn studio_port_in_range_is_that_value() {
        for value in ["1", "8100", "65535"] {
            let config = parse(&["--studio-port", value])
                .unwrap_or_else(|error| panic!("case {value}: {error}"));
            assert_eq!(config.studio_port.to_string(), value, "case {value}");
        }
    }

    #[test]
    fn studio_port_out_of_range_or_not_a_number_is_a_usage_error_naming_the_flag() {
        for (name, value) in [
            ("0", "0"),
            ("65536", "65536"),
            ("abc", "abc"),
            ("empty", ""),
        ] {
            let error = parse(&["--studio-port", value]).unwrap_err();
            let text = error.to_string();
            assert_eq!(
                error.kind(),
                ErrorKind::ValueValidation,
                "case {name}: {text}"
            );
            assert!(text.contains("--studio-port"), "case {name}: {text}");
        }
    }

    #[test]
    fn studio_port_help_shows_default_and_variable() {
        let help = Config::command().render_help().to_string();
        let line = help
            .lines()
            .find(|line| line.trim_start().starts_with("--studio-port "))
            .unwrap_or_else(|| panic!("no help line for --studio-port: {help}"));
        assert!(line.contains("[default: 8296]"), "{line}");
        assert!(line.contains("EMUFORGE_STUDIO_PORT"), "{line}");
    }

    #[test]
    fn validate_studio_port_equal_to_another_port_is_studio_port_collides_naming_both() {
        let cases = [
            ("--port", ports(8400, 9400, 8400), 8400),
            ("--emulator-port", ports(8400, 9400, 9400), 9400),
        ];
        for (flag, config, value) in cases {
            let error = config.validate().unwrap_err();
            assert!(
                matches!(error, Error::StudioPortCollides { port, other } if port == value && other == flag),
                "case {flag}: {error:?}"
            );
            let text = error.to_string();
            assert!(
                text.contains("--studio-port") && text.contains(flag),
                "case {flag}: {text}"
            );
        }
    }

    #[test]
    fn validate_three_different_ports_is_ok() {
        assert!(ports(8400, 9400, 8296).validate().is_ok());
    }
}
