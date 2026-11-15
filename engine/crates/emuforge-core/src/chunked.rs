//! The `aws-chunked` body of a signed-chunk upload, re-signed with the emulator's key. [`ChunkSigner`] is a pure
//! state machine over the body's bytes: no I/O, no clock, no runtime. It replaces, in place, the 64-character
//! signature of every chunk header and of the trailer it recognizes, and writes every other byte unchanged, so the
//! output has the input's length. From the first byte that does not fit the framing, the rest passes unchanged.

use std::fmt;

use bytes::BytesMut;

use crate::sigv4::{Scope, SigningKey, canonical_trailer, chunk_signature, trailer_signature};

/// Most chunk data held at once.
pub const CHUNK_DATA_CAP: u64 = 1_048_576;
/// Longest chunk header line, `\r\n` included.
pub const HEADER_LINE_CAP: usize = 4096;
/// Longest trailer section, from the byte after the final chunk's header line to its closing empty line included.
pub const TRAILER_CAP: usize = 16384;

/// The extension that carries a chunk's signature, `=` included.
const CHUNK_SIGNATURE: &[u8] = b"chunk-signature=";
/// The trailing header that carries the trailer's signature, `:` included.
const TRAILER_SIGNATURE: &[u8] = b"x-amz-trailer-signature:";
/// Length of a signature in lower-case hex.
const SIGNATURE_LEN: usize = 64;
const LINE_END: &[u8] = b"\r\n";

/// What one body's chain is signed with. `Debug` prints the date, the scope and whether a trailer is expected;
/// never the key or the seed.
#[derive(Clone)]
pub struct ChunkSigning {
    key: SigningKey,
    amz_date: String,
    scope: Scope,
    seed: String,
    trailer: bool,
}

impl ChunkSigning {
    /// `key` signs the chain, `amz_date` and `scope` are the request's, `seed` is the signature of the request's
    /// head, and `trailer` says whether a signed trailer follows the final chunk.
    pub fn new(
        key: SigningKey,
        amz_date: String,
        scope: Scope,
        seed: String,
        trailer: bool,
    ) -> ChunkSigning {
        ChunkSigning {
            key,
            amz_date,
            scope,
            seed,
            trailer,
        }
    }
}

impl fmt::Debug for ChunkSigning {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ChunkSigning")
            .field("amz_date", &self.amz_date)
            .field("scope", &self.scope)
            .field("trailer", &self.trailer)
            .finish_non_exhaustive()
    }
}

/// A recognized chunk header declared more than [`CHUNK_DATA_CAP`] bytes.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("a chunk of the aws-chunked body is larger than {CHUNK_DATA_CAP} bytes")]
pub struct ChunkTooLarge;

/// Where the signer is in the body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// Holding a chunk header line, at most [`HEADER_LINE_CAP`] bytes.
    Header,
    /// Holding a recognized header line of `header_len` bytes, whose signature starts at `signature_at`, and the
    /// chunk's data so far, until `size` data bytes are held.
    Data {
        header_len: usize,
        signature_at: usize,
        size: usize,
    },
    /// Holding at most the `\r` of the `\r\n` that ends a chunk's data.
    DataEnd,
    /// Holding the trailer section so far, at most [`TRAILER_CAP`] bytes; the line being read starts at
    /// `line_start`.
    Trailer { line_start: usize },
    /// Every byte passes unchanged.
    Raw,
    /// A chunk above the cap was refused; nothing more is taken.
    TooLarge,
}

/// Re-signs one `aws-chunked` body as it streams. Holds one chunk header line and that chunk's data, or the trailer
/// section, until it is complete; every byte that is ready is written to the caller's buffer.
pub struct ChunkSigner {
    signing: ChunkSigning,
    /// The signature the next chunk (or the trailer) chains from: the seed, then each chunk's new signature.
    previous: String,
    state: State,
    held: Vec<u8>,
}

impl ChunkSigner {
    pub fn new(signing: ChunkSigning) -> ChunkSigner {
        let previous = signing.seed.clone();
        ChunkSigner {
            signing,
            previous,
            state: State::Header,
            held: Vec::new(),
        }
    }

    /// Takes the next body bytes; appends to `out` every byte that is ready to forward. After `Err`, every later
    /// call returns `Err` and takes nothing.
    pub fn push(&mut self, input: &[u8], out: &mut BytesMut) -> Result<(), ChunkTooLarge> {
        if self.state == State::TooLarge {
            return Err(ChunkTooLarge);
        }
        let mut input = input;
        while !input.is_empty() {
            input = match self.state {
                State::Raw => {
                    out.extend_from_slice(input);
                    &[]
                }
                State::TooLarge => return Err(ChunkTooLarge),
                State::Header => self.header(input, out)?,
                State::Data {
                    header_len,
                    signature_at,
                    size,
                } => self.data(input, out, header_len, signature_at, size),
                State::DataEnd => self.data_end(input, out),
                State::Trailer { line_start } => self.trailer(input, out, line_start),
            };
        }
        Ok(())
    }

    /// The client body ended: appends what is held, unchanged.
    pub fn finish(&mut self, out: &mut BytesMut) {
        self.pass_held(out);
    }

    /// True when nothing is held.
    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    /// Writes what is held unchanged; every later byte passes unchanged.
    fn pass_held(&mut self, out: &mut BytesMut) {
        out.extend_from_slice(&self.held);
        self.held.clear();
        if self.state != State::TooLarge {
            self.state = State::Raw;
        }
    }

    fn header<'a>(
        &mut self,
        input: &'a [u8],
        out: &mut BytesMut,
    ) -> Result<&'a [u8], ChunkTooLarge> {
        let room = HEADER_LINE_CAP - self.held.len();
        let window = &input[..input.len().min(room)];
        let Some(end) = window.iter().position(|&byte| byte == b'\n') else {
            self.held.extend_from_slice(window);
            if self.held.len() == HEADER_LINE_CAP {
                self.pass_held(out);
            }
            return Ok(&input[window.len()..]);
        };
        self.held.extend_from_slice(&window[..=end]);
        self.header_line(out)?;
        Ok(&input[end + 1..])
    }

    /// A complete header line is held (it ends with `\n`).
    fn header_line(&mut self, out: &mut BytesMut) -> Result<(), ChunkTooLarge> {
        let Some((size, signature_at)) = recognize_header(&self.held) else {
            self.pass_held(out);
            return Ok(());
        };
        let within_cap = size.filter(|&size| size <= CHUNK_DATA_CAP);
        let Some(size) = within_cap.and_then(|size| usize::try_from(size).ok()) else {
            self.held.clear();
            self.state = State::TooLarge;
            return Err(ChunkTooLarge);
        };
        let header_len = self.held.len();
        if size == 0 {
            self.sign_chunk(header_len, signature_at);
            out.extend_from_slice(&self.held);
            self.held.clear();
            self.state = if self.signing.trailer {
                State::Trailer { line_start: 0 }
            } else {
                State::Raw
            };
        } else {
            self.held.reserve_exact(size);
            self.state = State::Data {
                header_len,
                signature_at,
                size,
            };
        }
        Ok(())
    }

    fn data<'a>(
        &mut self,
        input: &'a [u8],
        out: &mut BytesMut,
        header_len: usize,
        signature_at: usize,
        size: usize,
    ) -> &'a [u8] {
        let missing = header_len + size - self.held.len();
        let (taken, rest) = input.split_at(input.len().min(missing));
        self.held.extend_from_slice(taken);
        if self.held.len() == header_len + size {
            self.sign_chunk(header_len, signature_at);
            out.extend_from_slice(&self.held);
            self.held.clear();
            self.state = State::DataEnd;
        }
        rest
    }

    /// Signs the data held after the header line and writes the signature into the header line.
    fn sign_chunk(&mut self, header_len: usize, signature_at: usize) {
        let signing = &self.signing;
        let signature = chunk_signature(
            &signing.key,
            &signing.amz_date,
            &signing.scope,
            &self.previous,
            &self.held[header_len..],
        );
        self.held[signature_at..signature_at + SIGNATURE_LEN].copy_from_slice(signature.as_bytes());
        self.previous = signature;
    }

    fn data_end<'a>(&mut self, input: &'a [u8], out: &mut BytesMut) -> &'a [u8] {
        let expected = LINE_END[self.held.len()];
        if input[0] != expected {
            self.pass_held(out);
            return input;
        }
        self.held.push(input[0]);
        if self.held == LINE_END {
            out.extend_from_slice(LINE_END);
            self.held.clear();
            self.state = State::Header;
        }
        &input[1..]
    }

    fn trailer<'a>(&mut self, input: &'a [u8], out: &mut BytesMut, line_start: usize) -> &'a [u8] {
        let room = TRAILER_CAP - self.held.len();
        let window = &input[..input.len().min(room)];
        let Some(end) = window.iter().position(|&byte| byte == b'\n') else {
            self.held.extend_from_slice(window);
            if self.held.len() == TRAILER_CAP {
                self.pass_held(out);
            }
            return &input[window.len()..];
        };
        self.held.extend_from_slice(&window[..=end]);
        if &self.held[line_start..] == LINE_END {
            self.trailer_section(out);
        } else if self.held.len() == TRAILER_CAP {
            self.pass_held(out);
        } else {
            self.state = State::Trailer {
                line_start: self.held.len(),
            };
        }
        &input[end + 1..]
    }

    /// The trailer section is held up to its closing empty line.
    fn trailer_section(&mut self, out: &mut BytesMut) {
        if let Some((signature_at, canonical)) = recognize_trailer(&self.held) {
            let signing = &self.signing;
            let signature = trailer_signature(
                &signing.key,
                &signing.amz_date,
                &signing.scope,
                &self.previous,
                &canonical,
            );
            self.held[signature_at..signature_at + SIGNATURE_LEN]
                .copy_from_slice(signature.as_bytes());
        }
        self.pass_held(out);
    }
}

/// Reads a trailer section held up to its closing empty line: when every line is `<name>:<value>\r\n` and the
/// last before the empty line is `x-amz-trailer-signature:<64 lower-case hex>\r\n`, where the signature starts
/// and the canonical form of the other lines.
fn recognize_trailer(section: &[u8]) -> Option<(usize, Vec<u8>)> {
    let section = section.strip_suffix(LINE_END)?;
    let mut lines = Vec::new();
    let mut rest = section;
    while !rest.is_empty() {
        let end = rest.windows(2).position(|pair| pair == LINE_END)?;
        lines.push(&rest[..end]);
        rest = &rest[end + LINE_END.len()..];
    }
    let (last, others) = lines.split_last()?;
    let mut headers = Vec::with_capacity(others.len());
    for line in others {
        headers.push(split_header(line)?);
    }
    let signature = last.strip_prefix(TRAILER_SIGNATURE)?;
    is_signature(signature).then(|| {
        (
            section.len() - LINE_END.len() - SIGNATURE_LEN,
            canonical_trailer(&headers),
        )
    })
}

/// `<name>:<value>` with a non-empty name and no `\r` or `\n` in the line.
fn split_header(line: &[u8]) -> Option<(&[u8], &[u8])> {
    if line.iter().any(|&byte| byte == b'\r' || byte == b'\n') {
        return None;
    }
    let colon = line.iter().position(|&byte| byte == b':')?;
    let (name, value) = (&line[..colon], &line[colon + 1..]);
    (!name.is_empty()).then_some((name, value))
}

/// Reads a complete header line `<hex digits>;chunk-signature=<64 lower-case hex>\r\n`: the declared size by value
/// (`None` when it overflows `u64`) and where the signature starts.
fn recognize_header(line: &[u8]) -> Option<(Option<u64>, usize)> {
    let line = line.strip_suffix(LINE_END)?;
    let semicolon = line.iter().position(|&byte| byte == b';')?;
    let (digits, extension) = (&line[..semicolon], &line[semicolon + 1..]);
    if digits.is_empty() || !digits.iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    let signature = extension.strip_prefix(CHUNK_SIGNATURE)?;
    if !is_signature(signature) {
        return None;
    }
    let size = digits.iter().try_fold(0_u64, |size, &digit| {
        let value = u64::from(char::from(digit).to_digit(16)?);
        size.checked_mul(16)?.checked_add(value)
    });
    Some((size, semicolon + 1 + CHUNK_SIGNATURE.len()))
}

/// Exactly 64 lower-case hex characters.
fn is_signature(value: &[u8]) -> bool {
    value.len() == SIGNATURE_LEN
        && value
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}
