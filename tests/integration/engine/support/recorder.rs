//! The exact request heads a check sends, and replaying one of them.
//!
//! `Call::send` signs as it sends and keeps the signed headers to itself. A check that must know the
//! `Authorization` value or presigned query string the engine received records them first: a `RequestRecorder`
//! takes the engine's port before the engine starts and answers every request `200` with an empty body, and the
//! check sends it the same calls it later sends to the engine, signed at a fixed time (`Call::at`). Signing is a
//! function of the call, the key, the host and the time, so the heads the engine later receives are the recorded
//! ones; `record` sends each call twice and fails with `Env` if the two heads differ.
//!
//! `HeldResponse` replays a recorded head to the engine and reads only the response head, so a download stays
//! open for as long as the check holds it.

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::support::aws::{Call, Endpoint, Key};
use crate::support::check::{Ctx, Env};
use crate::support::net::connect;

/// How long the recorder waits for the rest of a request it has started to read.
const READ_BOUND: Duration = Duration::from_secs(5);

/// A listener on `127.0.0.1:<port>` that records the head of every request and answers `200`, empty.
pub struct RequestRecorder {
    pub port: u16,
    heads: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl RequestRecorder {
    /// Takes `127.0.0.1:<port>`; `Env` when it is not free.
    pub fn start(port: u16) -> Result<RequestRecorder, Env> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
            .map_err(|e| Env::new(format!("cannot bind the request recorder on {port}: {e}")))?;
        let heads = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (sink, done) = (heads.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if done.load(Ordering::SeqCst) {
                    break;
                }
                if let Ok(head) = stream.and_then(answer) {
                    sink.lock().unwrap_or_else(|e| e.into_inner()).push(head);
                }
            }
        });
        Ok(RequestRecorder {
            port,
            heads,
            stop,
            thread: Some(thread),
        })
    }

    /// Sends `call` signed with `key` to the recorder twice and returns the head it received; `Env` when the two
    /// heads differ (the call is not signed at a fixed time) or the recorder received none.
    pub fn record(&self, ctx: &Ctx, what: &str, call: &Call, key: &Key) -> Result<String, Env> {
        let mut heads = Vec::new();
        for _ in 0..2 {
            let before = self.heads.lock().unwrap_or_else(|e| e.into_inner()).len();
            call.send(ctx, &Endpoint::Engine(self.port), key)
                .map_err(|e| {
                    Env::new(format!("{what}: the request recorder gave no answer: {e}"))
                })?;
            let recorded = self.heads.lock().unwrap_or_else(|e| e.into_inner());
            let head = recorded.get(before).cloned().ok_or_else(|| {
                Env::new(format!("{what}: the request recorder recorded no head"))
            })?;
            heads.push(head);
        }
        if heads[0] != heads[1] {
            return Err(Env::new(format!(
                "{what}: two sends of the same call produced different heads; the call must be signed at a fixed time"
            )));
        }
        Ok(heads.swap_remove(0))
    }
}

impl Drop for RequestRecorder {
    fn drop(&mut self) {
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

/// Reads one request (head, `100 Continue` when asked for, `Content-Length` body bytes), answers `200` with an
/// empty body and returns the head.
fn answer(mut stream: TcpStream) -> io::Result<String> {
    stream.set_read_timeout(Some(READ_BOUND))?;
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    let end = loop {
        if let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            break end;
        }
        let n = stream.read(&mut buf)?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "no head"));
        }
        raw.extend_from_slice(&buf[..n]);
    };
    let head = String::from_utf8_lossy(&raw[..end + 4]).into_owned();
    if header_value(&head, "expect").is_some_and(|v| v.eq_ignore_ascii_case("100-continue")) {
        stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n")?;
    }
    let length: usize = header_value(&head, "content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = raw.len() - (end + 4);
    while body < length {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        body += n;
    }
    stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
    Ok(head)
}

/// The value of the first header `name` (case-insensitive) in a request or response head.
pub fn header_value(head: &str, name: &str) -> Option<String> {
    head.split("\r\n").skip(1).find_map(|line| {
        let (n, v) = line.split_once(':')?;
        n.trim()
            .eq_ignore_ascii_case(name)
            .then(|| v.trim().to_owned())
    })
}

/// The request target (path and query) of a request head.
pub fn request_target(head: &str) -> String {
    head.split(' ').nth(1).unwrap_or_default().to_owned()
}

/// The value of query parameter `name` in a request target, as sent (still percent-encoded).
pub fn query_value(target: &str, name: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (n, v) = pair.split_once('=')?;
        (n == name).then(|| v.to_owned())
    })
}

/// A response whose head has been read and whose body is left unread on the open connection.
pub struct HeldResponse {
    pub status: u16,
    pub head: String,
    stream: TcpStream,
}

impl HeldResponse {
    /// Sends a recorded request head to `127.0.0.1:<port>` and reads until the end of the response head.
    pub fn open(ctx: &Ctx, port: u16, head: &str) -> io::Result<HeldResponse> {
        let mut stream = connect(ctx, SocketAddr::from((Ipv4Addr::LOCALHOST, port)))?;
        stream.write_all(head.as_bytes())?;
        stream.set_read_timeout(Some(READ_BOUND))?;
        let mut raw = Vec::new();
        let mut byte = [0u8; 1];
        // One byte at a time, so nothing of the body is read.
        while !raw.ends_with(b"\r\n\r\n") {
            if stream.read(&mut byte)? == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "closed before the end of the response head",
                ));
            }
            raw.push(byte[0]);
        }
        let head = String::from_utf8_lossy(&raw).into_owned();
        let status = head
            .split(' ')
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "malformed status line"))?;
        ctx.log(format!("held response: status {status}, body left unread"));
        Ok(HeldResponse {
            status,
            head,
            stream,
        })
    }

    /// Closes the connection.
    pub fn close(self) {
        drop(self.stream);
    }
}
