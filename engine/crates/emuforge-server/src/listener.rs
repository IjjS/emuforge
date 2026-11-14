//! The engine's listener: every accepted client connection is wrapped in [`IdleWrite`], so a client that accepts
//! no byte of a response for [`CLIENT_WRITE_IDLE`] has its connection closed and the response body dropped (L1,
//! D6), which frees its in-flight permit and aborts the upstream exchange with it.

use std::io;
use std::time::Duration;

use axum::serve::Listener;
use emuforge_core::IdleWrite;

/// How long a write to a client may make no progress.
pub const CLIENT_WRITE_IDLE: Duration = Duration::from_secs(60);

/// A [`Listener`] whose connections fail a write that makes no progress for `idle`.
pub struct IdleListener<L> {
    inner: L,
    idle: Duration,
}

impl<L: Listener> IdleListener<L> {
    pub fn new(inner: L, idle: Duration) -> IdleListener<L> {
        IdleListener { inner, idle }
    }
}

impl<L: Listener> Listener for IdleListener<L> {
    type Io = IdleWrite<L::Io>;
    type Addr = L::Addr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        let (io, addr) = self.inner.accept().await;
        (IdleWrite::new(io, self.idle), addr)
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.inner.local_addr()
    }
}
