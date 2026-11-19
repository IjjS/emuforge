use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};

use crate::target::Endpoint;

/// The local emulator at one loopback address and port. Its address is always loopback: it is `127.0.0.1`, or
/// the IP of an [`Endpoint`], which only holds a loopback IP literal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Emulator {
    ip: IpAddr,
    port: NonZeroU16,
    dir: PathBuf,
}

impl Emulator {
    /// The emulator on `127.0.0.1:<port>`, whose files are under `<home>/.aws/emulator/<port>/`.
    pub fn new(home: &Path, port: NonZeroU16) -> Emulator {
        Emulator::at(home, Ipv4Addr::LOCALHOST.into(), port)
    }

    /// The emulator a target's endpoint names, whose files are under `<home>/.aws/emulator/<port>/`.
    pub fn for_endpoint(home: &Path, endpoint: &Endpoint) -> Emulator {
        Emulator::at(home, endpoint.ip(), endpoint.port())
    }

    fn at(home: &Path, ip: IpAddr, port: NonZeroU16) -> Emulator {
        let dir = home.join(".aws").join("emulator").join(port.to_string());
        Emulator { ip, port, dir }
    }

    /// The loopback IP: the address connected to and the TLS server name.
    pub fn ip(&self) -> IpAddr {
        self.ip
    }

    pub fn port(&self) -> NonZeroU16 {
        self.port
    }

    /// The directory the emulator writes its files to.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// `https://<ip>:<port>`, the IPv6 address in brackets.
    pub fn endpoint(&self) -> String {
        format!("https://{}", self.socket_addr())
    }

    /// `<ip>:<port>`, the IPv6 address in brackets.
    pub fn socket_addr(&self) -> SocketAddr {
        SocketAddr::new(self.ip, self.port.get())
    }
}
