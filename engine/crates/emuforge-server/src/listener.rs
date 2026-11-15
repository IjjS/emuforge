//! The engine's listener: every accepted client connection is wrapped in [`IdleWrite`], so a client that accepts
//! no byte of a response for [`CLIENT_WRITE_IDLE`] has its connection closed and the response body dropped (L1,
//! D6), which frees its in-flight permit and aborts the upstream exchange with it.
//!
//! Outside it, [`Drain`] ends each connection the way the emulator does after an early answer (issue 22): when
//! hyper shuts the connection down after writing an answer, the write side is ended first and what the client
//! still sends is read and discarded, so the client's unread bytes do not turn the close into a reset that
//! erases the answer.

use std::future::Future;
use std::io::{self, IoSlice};
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll, ready};
use std::time::Duration;

use axum::serve::Listener;
use emuforge_core::IdleWrite;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::{Sleep, sleep};

use crate::config::MAX_IN_FLIGHT;

/// How long a write to a client may make no progress.
pub const CLIENT_WRITE_IDLE: Duration = Duration::from_secs(60);

/// How long a connection whose answer is written keeps reading what the client still sends (requirement §4.2,
/// D2).
pub const DRAIN_BOUND: Duration = Duration::from_secs(5);

/// How many connections may drain at once (requirement §4.2, D4): the in-flight bound's number, a separate count.
pub const MAX_DRAINING: usize = MAX_IN_FLIGHT;

/// The most reads one poll of a drain makes before it yields.
const DRAIN_READS_PER_POLL: usize = 16;

/// The size of the one buffer a draining connection reads into.
const DRAIN_BUFFER: usize = 8 * 1024;

/// A [`Listener`] whose connections fail a write that makes no progress for `idle` and drain on shutdown.
pub struct IdleListener<L> {
    inner: L,
    idle: Duration,
    slots: Arc<Semaphore>,
}

impl<L: Listener> IdleListener<L> {
    pub fn new(inner: L, idle: Duration) -> IdleListener<L> {
        IdleListener {
            inner,
            idle,
            slots: Arc::new(Semaphore::new(MAX_DRAINING)),
        }
    }
}

impl<L: Listener> Listener for IdleListener<L> {
    type Io = Drain<IdleWrite<L::Io>>;
    type Addr = L::Addr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        let (io, addr) = self.inner.accept().await;
        let io = Drain {
            inner: IdleWrite::new(io, self.idle),
            slots: Arc::clone(&self.slots),
            state: State::Open,
        };
        (io, addr)
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.inner.local_addr()
    }
}

/// A client connection that, when shut down, ends its write side and then reads and discards what the client
/// still sends, until the client's EOF, a read error or [`DRAIN_BOUND`], before it reports the shutdown done.
/// Reads, writes and flushes pass through. With [`MAX_DRAINING`] connections already draining, a shutdown ends
/// the write side and is done at once.
pub struct Drain<S> {
    inner: S,
    slots: Arc<Semaphore>,
    state: State,
}

enum State {
    Open,
    Draining {
        _slot: OwnedSemaphorePermit,
        until: Pin<Box<Sleep>>,
        buf: Box<[u8; DRAIN_BUFFER]>,
    },
    Done,
}

/// Reads into `buf` and discards what it read until the drain ends: `until` has fired (checked before every
/// read), a read returns EOF or a read fails. Pending on a pending read, with the read and `until` registered to
/// wake it, and after [`DRAIN_READS_PER_POLL`] reads that all returned data, having woken itself, so one poll never
/// runs unbounded.
fn poll_drained<S: AsyncRead + Unpin>(
    inner: &mut S,
    until: &mut Pin<Box<Sleep>>,
    buf: &mut [u8],
    cx: &mut Context<'_>,
) -> Poll<()> {
    for _ in 0..DRAIN_READS_PER_POLL {
        if until.as_mut().poll(cx).is_ready() {
            return Poll::Ready(());
        }
        let mut read = ReadBuf::new(buf);
        match Pin::new(&mut *inner).poll_read(cx, &mut read) {
            Poll::Pending => return Poll::Pending,
            Poll::Ready(Ok(())) if !read.filled().is_empty() => {}
            // EOF or a read error: the client is done either way.
            Poll::Ready(_) => return Poll::Ready(()),
        }
    }
    cx.waker().wake_by_ref();
    Poll::Pending
}

impl<S: AsyncRead + Unpin> AsyncRead for Drain<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin> AsyncWrite for Drain<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = &mut *self;
        if let State::Open = this.state {
            match Pin::new(&mut this.inner).poll_shutdown(cx) {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(error)) => {
                    this.state = State::Done;
                    return Poll::Ready(Err(error));
                }
                Poll::Ready(Ok(())) => {}
            }
            this.state = match Arc::clone(&this.slots).try_acquire_owned() {
                Ok(slot) => State::Draining {
                    _slot: slot,
                    until: Box::pin(sleep(DRAIN_BOUND)),
                    buf: Box::new([0; DRAIN_BUFFER]),
                },
                Err(_) => State::Done,
            };
        }
        if let State::Draining { until, buf, .. } = &mut this.state {
            ready!(poll_drained(&mut this.inner, until, &mut buf[..], cx));
        }
        // Drops the slot, the sleep and the buffer of a drain that ended.
        this.state = State::Done;
        Poll::Ready(Ok(()))
    }
}
