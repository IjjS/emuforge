#![cfg(test)]

use std::net::{Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;

use clap::error::ErrorKind;
use clap::{CommandFactory, Parser};
use emuforge_server::{Config, Error, listen_addr};

fn parse(args: &[&str]) -> Result<Config, clap::Error> {
    Config::try_parse_from(std::iter::once("emuforge-server").chain(args.iter().copied()))
}

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

#[test]
fn config_parses_both_ports() {
    let config = parse(&["--port", "8400", "--emulator-port", "9400"]).unwrap();
    assert_eq!(config.port, port(8400));
    assert_eq!(config.emulator_port, port(9400));
}

#[test]
fn config_accepts_lowest_and_highest_ports() {
    let cases = [
        (
            "--port 1",
            ["--port", "1", "--emulator-port", "9400"],
            1,
            9400,
        ),
        (
            "--port 65535",
            ["--port", "65535", "--emulator-port", "9400"],
            65535,
            9400,
        ),
        (
            "--emulator-port 1",
            ["--port", "8400", "--emulator-port", "1"],
            8400,
            1,
        ),
        (
            "--emulator-port 65535",
            ["--port", "8400", "--emulator-port", "65535"],
            8400,
            65535,
        ),
    ];
    for (name, args, engine, emulator) in cases {
        let config = parse(&args).unwrap_or_else(|error| panic!("case {name}: {error}"));
        assert_eq!(
            (config.port, config.emulator_port),
            (port(engine), port(emulator)),
            "case {name}"
        );
    }
}

#[test]
fn config_rejects_bad_port_naming_the_flag() {
    for value in ["0", "65536", "abc"] {
        let cases = [
            ("--port", ["--port", value, "--emulator-port", "9400"]),
            (
                "--emulator-port",
                ["--port", "8400", "--emulator-port", value],
            ),
        ];
        for (flag, args) in cases {
            let error = parse(&args).unwrap_err();
            let text = error.to_string();
            assert_eq!(
                error.kind(),
                ErrorKind::ValueValidation,
                "case {flag} {value}: {text}"
            );
            assert!(
                text.contains(&format!("'{flag} ")),
                "case {flag} {value}: {text}"
            );
        }
    }
}

#[test]
fn config_rejects_an_address_flag_as_unknown() {
    for flag in ["--bind", "--host"] {
        let error =
            parse(&["--port", "8400", "--emulator-port", "9400", flag, "0.0.0.0"]).unwrap_err();
        assert_eq!(
            error.kind(),
            ErrorKind::UnknownArgument,
            "case {flag}: {error}"
        );
    }
}

#[test]
fn config_help_shows_defaults_and_variables() {
    let help = Config::command().render_help().to_string();
    let line = |flag: &str| {
        help.lines()
            .find(|line| line.trim_start().starts_with(flag))
            .unwrap_or_else(|| panic!("no help line for {flag}: {help}"))
            .to_owned()
    };
    let engine = line("--port ");
    assert!(engine.contains("[default: 8297]"), "{engine}");
    assert!(engine.contains("EMUFORGE_ENGINE_PORT"), "{engine}");
    let emulator = line("--emulator-port ");
    assert!(emulator.contains("[default: 9297]"), "{emulator}");
    assert!(emulator.contains("EMULATOR_PORT"), "{emulator}");
}

#[test]
fn config_validate_same_ports_is_same_port_naming_both_flags() {
    let config = parse(&["--port", "9400", "--emulator-port", "9400"]).unwrap();
    let error = config.validate().unwrap_err();
    assert!(matches!(error, Error::SamePort { port: 9400 }), "{error:?}");
    let text = error.to_string();
    assert!(
        text.contains("--port") && text.contains("--emulator-port"),
        "{text}"
    );
}

#[test]
fn config_validate_different_ports_is_ok() {
    let config = parse(&["--port", "8400", "--emulator-port", "9400"]).unwrap();
    assert!(config.validate().is_ok());
}

#[test]
fn listen_addr_is_loopback_with_the_engine_port() {
    for (name, value) in [("lowest", 1), ("default", 8297), ("highest", 65535)] {
        let config = Config {
            port: port(value),
            emulator_port: port(9400),
            studio_port: port(8296),
        };
        assert_eq!(
            listen_addr(&config),
            SocketAddr::new(Ipv4Addr::LOCALHOST.into(), value),
            "case {name}"
        );
    }
}
