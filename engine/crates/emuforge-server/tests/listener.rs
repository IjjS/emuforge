#![cfg(test)]

//! `Drain` through `IdleListener` (issue 22): what a connection does when hyper shuts it down after an answer.

use std::collections::VecDeque;
use std::future::poll_fn;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::serve::Listener;
use emuforge_server::{CLIENT_WRITE_IDLE, DRAIN_BOUND, IdleListener, MAX_DRAINING};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream, ReadBuf};
use tokio::time::Instant;

/// A listener that hands out the given streams, one per `accept`, then none.
struct Streams<S>(VecDeque<S>);

impl<S: AsyncRead + AsyncWrite + Unpin + Send + 'static> Listener for Streams<S> {
    type Io = S;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (S, SocketAddr) {
        match self.0.pop_front() {
            Some(stream) => (stream, ([127, 0, 0, 1], 50000).into()),
            None => std::future::pending().await,
        }
    }

    fn local_addr(&self) -> io::Result<SocketAddr> {
        Ok(([127, 0, 0, 1], 8297).into())
    }
}

type Io<S> = <IdleListener<Streams<S>> as Listener>::Io;

/// `count` connections accepted through `IdleListener`, each with its peer.
async fn accepted(count: usize, buffer: usize) -> Vec<(Io<DuplexStream>, DuplexStream)> {
    let (peers, servers): (Vec<_>, Vec<_>) = (0..count).map(|_| tokio::io::duplex(buffer)).unzip();
    let mut listener = IdleListener::new(Streams(servers.into()), CLIENT_WRITE_IDLE);
    let mut connections = Vec::new();
    for peer in peers {
        let (io, _) = listener.accept().await;
        connections.push((io, peer));
    }
    connections
}

/// One connection accepted through `IdleListener` over a scripted stream.
async fn accepted_scripted(stream: Scripted) -> Io<Scripted> {
    let mut listener = IdleListener::new(Streams(VecDeque::from([stream])), CLIENT_WRITE_IDLE);
    listener.accept().await.0
}

/// One poll of `poll_shutdown`, as hyper makes it.
async fn shutdown_once<S: AsyncWrite + Unpin>(io: &mut S) -> Poll<io::Result<()>> {
    poll_fn(|cx| Poll::Ready(Pin::new(&mut *io).poll_shutdown(cx))).await
}

/// A stream whose reads and shutdown are scripted, counting its reads.
struct Scripted {
    read: ReadScript,
    shutdown_fails: bool,
    reads: Arc<AtomicUsize>,
}

#[derive(Clone, Copy)]
enum ReadScript {
    /// Every read fails.
    Fail,
    /// Every read returns data at once.
    Endless,
}

impl Scripted {
    fn new(read: ReadScript, shutdown_fails: bool) -> (Scripted, Arc<AtomicUsize>) {
        let reads = Arc::new(AtomicUsize::new(0));
        let stream = Scripted {
            read,
            shutdown_fails,
            reads: Arc::clone(&reads),
        };
        (stream, reads)
    }
}

impl AsyncRead for Scripted {
    fn poll_read(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        match self.read {
            ReadScript::Fail => Poll::Ready(Err(io::ErrorKind::ConnectionReset.into())),
            ReadScript::Endless => {
                let n = buf.remaining().min(1024);
                buf.put_slice(&vec![b'x'; n]);
                Poll::Ready(Ok(()))
            }
        }
    }
}

impl AsyncWrite for Scripted {
    fn poll_write(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Poll::Ready(Ok(buf.len()))
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.shutdown_fails {
            Poll::Ready(Err(io::ErrorKind::NotConnected.into()))
        } else {
            Poll::Ready(Ok(()))
        }
    }
}

const MIB: usize = 1024 * 1024;
const WRITE: usize = 64 * 1024;

#[tokio::test(start_paused = true)]
async fn idle_listener_io_before_shutdown_passes_bytes_both_ways_unchanged() {
    let (mut io, mut peer) = accepted(1, 1024).await.pop().unwrap();
    io.write_all(b"answer bytes").await.unwrap();
    peer.write_all(b"request bytes").await.unwrap();
    let mut from_io = [0; 12];
    peer.read_exact(&mut from_io).await.unwrap();
    assert_eq!(&from_io, b"answer bytes");
    let mut from_peer = [0; 13];
    io.read_exact(&mut from_peer).await.unwrap();
    assert_eq!(&from_peer, b"request bytes");
}

#[tokio::test(start_paused = true)]
async fn shutdown_peer_that_writes_1_mib_and_closes_writes_everything_reads_eof_and_ends_ok() {
    let (mut io, mut peer) = accepted(1, 8 * 1024).await.pop().unwrap();
    let shutdown = tokio::spawn(async move {
        let result = io.shutdown().await;
        (result, io)
    });
    let chunk = vec![b'x'; WRITE];
    for write in 0..MIB / WRITE {
        peer.write_all(&chunk)
            .await
            .unwrap_or_else(|error| panic!("peer write {write} failed: {error}"));
    }
    let mut rest = Vec::new();
    assert_eq!(peer.read_to_end(&mut rest).await.unwrap(), 0, "not EOF");
    assert!(
        !shutdown.is_finished(),
        "the drain ended before the peer closed"
    );
    peer.shutdown().await.unwrap();
    let (result, _io) = shutdown.await.unwrap();
    result.unwrap();
}

#[tokio::test(start_paused = true)]
async fn shutdown_peer_silent_and_open_is_pending_until_the_drain_bound() {
    let (mut io, _peer) = accepted(1, 1024).await.pop().unwrap();
    let started = Instant::now();
    let early = tokio::time::timeout(DRAIN_BOUND - Duration::from_millis(1), io.shutdown()).await;
    assert!(
        early.is_err(),
        "the shutdown completed before the drain bound"
    );
    io.shutdown().await.unwrap();
    assert_eq!(started.elapsed(), DRAIN_BOUND);
}

#[tokio::test(start_paused = true)]
async fn shutdown_peer_that_never_stops_writing_ends_ok_at_the_drain_bound() {
    let (mut io, mut peer) = accepted(1, 8 * 1024).await.pop().unwrap();
    let started = Instant::now();
    let shutdown = tokio::spawn(async move {
        let result = io.shutdown().await;
        (result, Instant::now(), io)
    });
    // The peer reads EOF once the shutdown has begun, and with it the drain.
    assert_eq!(peer.read(&mut [0; 1]).await.unwrap(), 0, "not EOF");
    let writer = tokio::spawn(async move {
        let chunk = vec![b'x'; WRITE];
        while peer.write_all(&chunk).await.is_ok() {}
    });
    tokio::time::advance(DRAIN_BOUND - Duration::from_millis(1)).await;
    assert!(!shutdown.is_finished(), "the drain ended before the bound");
    tokio::time::advance(Duration::from_millis(1)).await;
    let (result, ended, io) = shutdown.await.unwrap();
    result.unwrap();
    assert_eq!(ended - started, DRAIN_BOUND);
    drop(io);
    writer.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn shutdown_with_data_ready_for_more_than_16_reads_yields_to_another_task() {
    let (stream, reads) = Scripted::new(ReadScript::Endless, false);
    let mut io = accepted_scripted(stream).await;
    let draining = tokio::spawn(async move { io.shutdown().await });
    let other_ran = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&other_ran);
    let other = tokio::spawn(async move { flag.store(true, Ordering::SeqCst) });
    other.await.unwrap();
    assert!(other_ran.load(Ordering::SeqCst));
    assert!(
        reads.load(Ordering::SeqCst) >= 16,
        "the other task ran before the drain started: {reads:?} reads"
    );
    assert!(!draining.is_finished(), "the drain ended before the bound");
    tokio::time::advance(DRAIN_BOUND).await;
    draining.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn shutdown_read_failing_while_draining_ends_ok_at_once() {
    let (stream, reads) = Scripted::new(ReadScript::Fail, false);
    let mut io = accepted_scripted(stream).await;
    assert!(matches!(shutdown_once(&mut io).await, Poll::Ready(Ok(()))));
    assert_eq!(reads.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn shutdown_of_the_stream_failing_is_returned_without_a_read() {
    let (stream, reads) = Scripted::new(ReadScript::Endless, true);
    let mut io = accepted_scripted(stream).await;
    match shutdown_once(&mut io).await {
        Poll::Ready(Err(error)) => assert_eq!(error.kind(), io::ErrorKind::NotConnected),
        other => panic!("not the stream's error: {other:?}"),
    }
    assert_eq!(reads.load(Ordering::SeqCst), 0);
}

/// Shuts down `connections` one after another; each must be draining (pending with its peer open).
async fn drain_all(connections: &mut [(Io<DuplexStream>, DuplexStream)]) {
    for (index, (io, _)) in connections.iter_mut().enumerate() {
        assert!(
            shutdown_once(io).await.is_pending(),
            "connection {index} did not drain"
        );
    }
}

/// The connection's shutdown completes at once and leaves the byte its peer wrote unread.
async fn closes_at_once_without_a_read(io: &mut Io<DuplexStream>, peer: &mut DuplexStream) {
    peer.write_all(b"x").await.unwrap();
    assert!(
        matches!(shutdown_once(io).await, Poll::Ready(Ok(()))),
        "the shutdown did not complete at once"
    );
    let mut byte = [0; 1];
    assert_eq!(
        io.read(&mut byte).await.unwrap(),
        1,
        "the peer's byte was read"
    );
}

#[tokio::test(start_paused = true)]
async fn shutdown_past_max_draining_ends_ok_at_once_without_a_read() {
    let mut connections = accepted(MAX_DRAINING + 1, 1024).await;
    let (mut last, mut last_peer) = connections.pop().unwrap();
    drain_all(&mut connections).await;
    closes_at_once_without_a_read(&mut last, &mut last_peer).await;
}

#[tokio::test(start_paused = true)]
async fn shutdown_after_a_drain_ended_drains_again() {
    let mut connections = accepted(MAX_DRAINING + 1, 1024).await;
    let (mut last, _last_peer) = connections.pop().unwrap();
    drain_all(&mut connections).await;
    let (io, peer) = &mut connections[0];
    peer.shutdown().await.unwrap();
    assert!(
        matches!(shutdown_once(io).await, Poll::Ready(Ok(()))),
        "the drain did not end at the peer's close"
    );
    assert!(
        shutdown_once(&mut last).await.is_pending(),
        "the next connection did not drain"
    );
}

#[tokio::test(start_paused = true)]
async fn shutdown_after_a_draining_connection_was_dropped_drains_again() {
    let mut connections = accepted(MAX_DRAINING + 1, 1024).await;
    let (mut last, _last_peer) = connections.pop().unwrap();
    drain_all(&mut connections).await;
    drop(connections.remove(0));
    assert!(
        shutdown_once(&mut last).await.is_pending(),
        "the next connection did not drain"
    );
}
