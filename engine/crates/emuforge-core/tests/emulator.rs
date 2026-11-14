use std::net::{Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;
use std::path::Path;

use emuforge_core::Emulator;

fn port(value: u16) -> NonZeroU16 {
    NonZeroU16::new(value).unwrap()
}

#[test]
fn emulator_new_places_dir_under_home_aws_emulator_port() {
    let home = Path::new("/home/someone");
    let emulator = Emulator::new(home, port(9297));
    assert_eq!(
        emulator.dir(),
        Path::new("/home/someone/.aws/emulator/9297")
    );
}

#[test]
fn emulator_endpoint_is_https_loopback_with_port() {
    for (name, value) in [("lowest", 1), ("default", 9297), ("highest", 65535)] {
        let emulator = Emulator::new(Path::new("/h"), port(value));
        assert_eq!(
            emulator.endpoint(),
            format!("https://127.0.0.1:{value}"),
            "case {name}"
        );
    }
}

#[test]
fn emulator_socket_addr_is_loopback_with_port() {
    for (name, value) in [("lowest", 1), ("default", 9297), ("highest", 65535)] {
        let emulator = Emulator::new(Path::new("/h"), port(value));
        assert_eq!(
            emulator.socket_addr(),
            SocketAddr::new(Ipv4Addr::LOCALHOST.into(), value),
            "case {name}"
        );
    }
}
