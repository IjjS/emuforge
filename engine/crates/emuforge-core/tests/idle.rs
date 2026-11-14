#![cfg(test)]

use std::io;
use std::sync::atomic::Ordering;
use std::time::Duration;

use emuforge_core::IdleWrite;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::time::Instant;

const IDLE: Duration = Duration::from_secs(60);
/// The duplex buffer; every write below is larger, so each one waits for the reader at least once.
const BUFFER: usize = 16;
const CHUNK: [u8; 64] = [7; 64];

/// An `IdleWrite` over one end of a duplex; the test holds the other end.
fn idle_pair() -> (IdleWrite<DuplexStream>, DuplexStream) {
    let (ours, peer) = tokio::io::duplex(BUFFER);
    (IdleWrite::new(ours, IDLE), peer)
}

/// Reads and discards everything until the writer closes.
async fn drain(mut peer: DuplexStream) {
    let mut sink = [0u8; BUFFER];
    while peer.read(&mut sink).await.unwrap() > 0 {}
}

#[tokio::test(start_paused = true)]
async fn poll_write_with_a_reading_peer_completes_and_never_stalls() {
    let (mut writer, peer) = idle_pair();
    let stalled = writer.stalled_flag();
    let reader = tokio::spawn(drain(peer));
    let start = Instant::now();
    while start.elapsed() < 2 * IDLE {
        writer.write_all(&CHUNK).await.unwrap();
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    writer.shutdown().await.unwrap();
    drop(writer);
    reader.await.unwrap();
    assert!(!stalled.load(Ordering::Acquire));
}

#[tokio::test(start_paused = true)]
async fn poll_write_with_a_full_buffer_fails_timed_out_at_the_idle_bound() {
    let (mut writer, _peer) = idle_pair();
    let stalled = writer.stalled_flag();
    let start = Instant::now();
    let write = tokio::spawn(async move {
        let result = writer.write_all(&CHUNK).await;
        (result, Instant::now())
    });

    tokio::time::sleep(IDLE - Duration::from_millis(1)).await;
    assert!(!write.is_finished(), "still pending at 60 s - 1 ms");
    assert!(!stalled.load(Ordering::Acquire));

    tokio::time::sleep(Duration::from_millis(1)).await;
    let (result, failed_at) = write.await.unwrap();
    assert_eq!(
        result.map_err(|error| error.kind()),
        Err(io::ErrorKind::TimedOut)
    );
    assert_eq!(failed_at - start, IDLE);
    assert!(stalled.load(Ordering::Acquire));
}

#[tokio::test(start_paused = true)]
async fn poll_write_with_a_peer_that_resumes_within_the_bound_completes() {
    let (mut writer, peer) = idle_pair();
    let stalled = writer.stalled_flag();
    let start = Instant::now();
    let reader = tokio::spawn(async move {
        tokio::time::sleep(IDLE - Duration::from_secs(1)).await;
        drain(peer).await;
    });

    writer.write_all(&CHUNK).await.unwrap();
    assert_eq!(start.elapsed(), IDLE - Duration::from_secs(1));
    assert!(!stalled.load(Ordering::Acquire));
    drop(writer);
    reader.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn poll_read_from_a_silent_peer_stays_pending_without_error() {
    let (mut reader, _peer) = idle_pair();
    let stalled = reader.stalled_flag();
    let read = tokio::spawn(async move {
        let mut buf = [0u8; BUFFER];
        reader.read(&mut buf).await
    });

    tokio::time::sleep(2 * IDLE).await;
    assert!(!read.is_finished(), "still pending after 120 s");
    assert!(!stalled.load(Ordering::Acquire));
    read.abort();
}
