use std::net::{Ipv4Addr, SocketAddr};
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};

/// The local emulator for one port. Its address is always loopback: no setting names a host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Emulator {
    port: NonZeroU16,
    dir: PathBuf,
}

impl Emulator {
    /// The emulator on `port`, whose files are under `<home>/.aws/emulator/<port>/`.
    pub fn new(home: &Path, port: NonZeroU16) -> Emulator {
        let dir = home.join(".aws").join("emulator").join(port.to_string());
        Emulator { port, dir }
    }

    pub fn port(&self) -> NonZeroU16 {
        self.port
    }

    /// The directory the emulator writes its files to.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// `https://127.0.0.1:<port>`.
    pub fn endpoint(&self) -> String {
        format!("https://{}", self.socket_addr())
    }

    /// `127.0.0.1:<port>`.
    pub fn socket_addr(&self) -> SocketAddr {
        SocketAddr::new(Ipv4Addr::LOCALHOST.into(), self.port.get())
    }
}
