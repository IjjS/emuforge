//! A stream wrapper whose writes fail when the peer accepts no byte for a while. Reads are not timed.

use std::io::{self, IoSlice};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::time::{Sleep, sleep};

/// Wraps a stream so that a write or flush which stays pending for `idle` fails with
/// [`io::ErrorKind::TimedOut`] and sets the stalled flag. The idle timer starts at the first pending write or
/// flush and is disarmed by any completed one; reads and shutdown pass through.
pub struct IdleWrite<S> {
    inner: S,
    idle: Duration,
    sleep: Option<Pin<Box<Sleep>>>,
    stalled: Arc<AtomicBool>,
}

impl<S> IdleWrite<S> {
    pub fn new(inner: S, idle: Duration) -> Self {
        IdleWrite {
            inner,
            idle,
            sleep: None,
            stalled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// The flag set when a write or flush timed out. It stays set.
    pub fn stalled_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.stalled)
    }

    /// Disarms the timer on progress; on a pending inner call, arms it and fails once it fires.
    fn watch<T>(&mut self, cx: &mut Context<'_>, poll: Poll<io::Result<T>>) -> Poll<io::Result<T>> {
        if poll.is_ready() {
            self.sleep = None;
            return poll;
        }
        let idle = self.idle;
        let timer = self.sleep.get_or_insert_with(|| Box::pin(sleep(idle)));
        if timer.as_mut().poll(cx).is_pending() {
            return Poll::Pending;
        }
        self.sleep = None;
        self.stalled.store(true, Ordering::Release);
        Poll::Ready(Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "the peer accepted no byte within the idle bound",
        )))
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for IdleWrite<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for IdleWrite<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let poll = Pin::new(&mut self.inner).poll_write(cx, buf);
        self.watch(cx, poll)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        let poll = Pin::new(&mut self.inner).poll_write_vectored(cx, bufs);
        self.watch(cx, poll)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let poll = Pin::new(&mut self.inner).poll_flush(cx);
        self.watch(cx, poll)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
