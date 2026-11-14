//! Ports and listeners on loopback.

use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::support::check::{Ctx, Env};
use crate::support::emulator::emulator_dir;

/// A loopback port nothing listens on now (bound to `127.0.0.1:0`, read, released).
pub fn free_port() -> Result<u16, Env> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|e| Env::new(format!("cannot bind a free loopback port: {e}")))?;
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| Env::new(format!("cannot read the free port: {e}")))
}

/// A free loopback port whose `$HOME/.aws/emulator/<port>/` does not exist, so no emulator ran there and a
/// guard may remove that directory later without touching another emulator's files.
pub fn free_port_without_emulator(home: &Path) -> Result<u16, Env> {
    for _ in 0..20 {
        let port = free_port()?;
        if !emulator_dir(home, port).exists() {
            return Ok(port);
        }
    }
    Err(Env::new(
        "no free loopback port without an emulator directory after 20 tries",
    ))
}

/// Fails with `Env` when something already listens on `127.0.0.1:<port>`: a check must own the port its
/// engine is about to take, or what it observes is not the engine.
pub fn ensure_port_free(port: u16) -> Result<(), Env> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .map(drop)
        .map_err(|e| Env::new(format!("127.0.0.1:{port} is not free: {e}")))
}

/// Connects to `addr` after the destination rule allowed it.
pub fn connect(ctx: &Ctx, addr: SocketAddr) -> io::Result<TcpStream> {
    ctx.refuse_foreign_destination(addr.ip());
    TcpStream::connect_timeout(&addr, Duration::from_secs(2))
}

/// This host's first non-loopback IPv4 interface address; `Env` when it has none.
pub fn non_loopback_ipv4() -> Result<Ipv4Addr, Env> {
    let interfaces =
        if_addrs::get_if_addrs().map_err(|e| Env::new(format!("cannot list interfaces: {e}")))?;
    interfaces
        .iter()
        .find_map(|i| match i.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() && !ip.is_link_local() => {
                Some(ip)
            }
            _ => None,
        })
        .ok_or_else(|| Env::new("this host has no non-loopback IPv4 address"))
}

/// A check-owned listener on a free loopback port that counts the connections it accepts.
pub struct CountingListener {
    pub port: u16,
    accepted: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl CountingListener {
    pub fn start() -> Result<CountingListener, Env> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|e| Env::new(format!("cannot bind a counting listener: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| Env::new(format!("cannot read its port: {e}")))?
            .port();
        let accepted = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (count, done) = (accepted.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if done.load(Ordering::SeqCst) {
                    break;
                }
                if stream.is_ok() {
                    count.fetch_add(1, Ordering::SeqCst);
                }
            }
        });
        Ok(CountingListener {
            port,
            accepted,
            stop,
            thread: Some(thread),
        })
    }

    pub fn accepted(&self) -> usize {
        self.accepted.load(Ordering::SeqCst)
    }
}

impl Drop for CountingListener {
    fn drop(&mut self) {
        // Wake the accept loop with one connection it does not count, then let it end.
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(
            &SocketAddr::from((Ipv4Addr::LOCALHOST, self.port)),
            Duration::from_secs(1),
        );
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
