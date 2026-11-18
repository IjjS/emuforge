#![cfg(test)]

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;

use clap::error::ErrorKind;
use clap::{Args, FromArgMatches};
use emuforge_server::{Config, Error, LISTEN_IP, engine_addr, listen_warning, studio_addr};

/// `Config` augmented onto a command, as a binary flattens it.
fn command() -> clap::Command {
    Config::augment_args(clap::Command::new("emuforge-server"))
}

fn parse(args: &[&str]) -> Result<Config, clap::Error> {
    let matches = command()
        .try_get_matches_from(std::iter::once("emuforge-server").chain(args.iter().copied()))?;
    Config::from_arg_matches(&matches)
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
    let help = command().render_help().to_string();
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
            listen_address: IpAddr::V4(LISTEN_IP),
        };
        assert_eq!(
            engine_addr(&config),
            SocketAddr::new(Ipv4Addr::LOCALHOST.into(), value),
            "case {name}"
        );
    }
}

fn address(text: &str) -> IpAddr {
    text.parse().unwrap()
}

fn config_at(listen_address: IpAddr) -> Config {
    Config {
        port: port(8400),
        emulator_port: port(9400),
        studio_port: port(8396),
        listen_address,
    }
}

#[test]
fn listen_address_absent_is_127_0_0_1() {
    assert_eq!(parse(&[]).unwrap().listen_address, address("127.0.0.1"));
}

#[test]
fn listen_address_ip_is_that_address() {
    for value in ["0.0.0.0", "192.0.2.1", "::1"] {
        let config = parse(&["--listen-address", value])
            .unwrap_or_else(|error| panic!("case {value}: {error}"));
        assert_eq!(config.listen_address, address(value), "case {value}");
    }
}

#[test]
fn listen_address_not_an_ip_is_a_usage_error_naming_the_flag() {
    for (name, value) in [
        ("localhost", "localhost"),
        ("example.com", "example.com"),
        ("with a port", "0.0.0.0:80"),
        ("empty", ""),
    ] {
        let error = parse(&["--listen-address", value]).unwrap_err();
        let text = error.to_string();
        assert_eq!(
            error.kind(),
            ErrorKind::ValueValidation,
            "case {name}: {text}"
        );
        assert!(text.contains("--listen-address"), "case {name}: {text}");
    }
}

/// Set in the child process of `listen_address_variable_without_the_flag_is_127_0_0_1`.
const CHILD_MARKER: &str = "EMUFORGE_TEST_LISTEN_ADDRESS_CHILD";
const CHILD_TEST: &str = "listen_address_parsed_in_the_child_process_is_printed";

/// Runs only as the child process of the test below, whose environment it has; elsewhere it does nothing.
#[test]
fn listen_address_parsed_in_the_child_process_is_printed() {
    if std::env::var_os(CHILD_MARKER).is_none() {
        return;
    }
    let config = parse(&[]).unwrap();
    println!("listen_address={}", config.listen_address);
}

/// The process environment cannot be changed from a test (`set_var` is unsafe), so this test runs its own
/// binary again, for the one test above, with `EMUFORGE_LISTEN_ADDRESS` set.
#[test]
fn listen_address_variable_without_the_flag_is_127_0_0_1() {
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([CHILD_TEST, "--exact", "--nocapture", "--test-threads=1"])
        .env(CHILD_MARKER, "1")
        .env("EMUFORGE_LISTEN_ADDRESS", "0.0.0.0")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{stdout}");
    assert!(stdout.contains("listen_address=127.0.0.1\n"), "{stdout}");
}

#[test]
fn config_help_shows_listen_address_default_without_a_variable() {
    let help = command().render_help().to_string();
    let line = help
        .lines()
        .find(|line| line.trim_start().starts_with("--listen-address "))
        .unwrap_or_else(|| panic!("no help line for --listen-address: {help}"));
    assert!(line.contains("[default: 127.0.0.1]"), "{line}");
    assert!(!line.contains("env:"), "{line}");
    assert!(!help.contains("always on 127.0.0.1"), "{help}");
}

#[test]
fn config_validate_same_ports_names_both_flags_both_variables_and_the_number() {
    let error = parse(&["--port", "9400", "--emulator-port", "9400"])
        .unwrap()
        .validate()
        .unwrap_err();
    assert!(matches!(error, Error::SamePort { port: 9400 }), "{error:?}");
    let text = error.to_string();
    for part in [
        "--port",
        "EMUFORGE_ENGINE_PORT",
        "--emulator-port",
        "EMULATOR_PORT",
        "9400",
    ] {
        assert!(text.contains(part), "{part}: {text}");
    }
}

#[test]
fn config_validate_studio_port_collision_names_both_flags_both_variables_and_the_number() {
    let cases = [
        (
            "--port",
            [
                "--port",
                "8400",
                "--emulator-port",
                "9400",
                "--studio-port",
                "8400",
            ],
            "EMUFORGE_ENGINE_PORT",
            "8400",
        ),
        (
            "--emulator-port",
            [
                "--port",
                "8400",
                "--emulator-port",
                "9400",
                "--studio-port",
                "9400",
            ],
            "EMULATOR_PORT",
            "9400",
        ),
    ];
    for (name, args, variable, number) in cases {
        let error = parse(&args).unwrap().validate().unwrap_err();
        assert!(
            matches!(error, Error::StudioPortCollides { .. }),
            "case {name}: {error:?}"
        );
        let text = error.to_string();
        for part in [
            "--studio-port",
            "EMUFORGE_STUDIO_PORT",
            name,
            variable,
            number,
        ] {
            assert!(text.contains(part), "case {name}, {part}: {text}");
        }
    }
}

#[test]
fn listen_warning_loopback_is_none() {
    assert_eq!(listen_warning(address("127.0.0.1")), None);
}

#[test]
fn listen_warning_other_address_names_it_and_the_flag() {
    for value in ["0.0.0.0", "192.0.2.1", "::1"] {
        let warning =
            listen_warning(address(value)).unwrap_or_else(|| panic!("case {value}: no warning"));
        for part in [value, "not on loopback", "--listen-address"] {
            assert!(warning.contains(part), "case {value}, {part}: {warning}");
        }
    }
}

#[test]
fn engine_and_studio_addr_take_the_listen_address() {
    let config = config_at(address("0.0.0.0"));
    assert_eq!(engine_addr(&config), "0.0.0.0:8400".parse().unwrap());
    assert_eq!(studio_addr(&config), "0.0.0.0:8396".parse().unwrap());
}

#[test]
fn bind_error_names_the_address_the_os_error_and_the_listeners_flag_and_variable() {
    let addr: SocketAddr = "0.0.0.0:8400".parse().unwrap();
    let os_error = || std::io::Error::new(std::io::ErrorKind::AddrInUse, "Address already in use");
    let cases = [
        (
            "engine",
            Error::engine_bind(addr, os_error()),
            "--port",
            "EMUFORGE_ENGINE_PORT",
        ),
        (
            "studio",
            Error::studio_bind(addr, os_error()),
            "--studio-port",
            "EMUFORGE_STUDIO_PORT",
        ),
    ];
    for (name, error, flag, variable) in cases {
        let text = error.to_string();
        for part in ["0.0.0.0:8400", "Address already in use", flag, variable] {
            assert!(text.contains(part), "case {name}, {part}: {text}");
        }
    }
}
