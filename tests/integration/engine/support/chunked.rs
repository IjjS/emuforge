//! Signed-chunk uploads (`X-Amz-Content-SHA256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD` and `-PAYLOAD-TRAILER`,
//! test-criteria.md, issue 9) in two forms of the same framing:
//!
//! - **through the engine**: header-signed with the check key, every chunk and trailer signature 64 `0`
//!   characters (the engine never verifies them);
//! - **reference upload**: header-signed with the emulator's key, its chunk chain (and trailer signature)
//!   computed by the reference signer (`aws-sigv4` 1.6.5 `sign::v4::sign_chunk` / `sign_trailer`) seeded with the
//!   head's own signature, sent straight to the emulator.
//!
//! A chunk's signature covers the `<size>` bytes after its header line, whatever they are: for a well-formed body
//! that is the chunk's data.

use std::borrow::Cow;
use std::ops::Range;
use std::time::SystemTime;

use aws_credential_types::Credentials;
use aws_sigv4::http_request::{
    PayloadChecksumKind, PercentEncodingMode, SignableBody, SignableRequest, SignatureLocation,
    SigningSettings, UriPathNormalizationMode, sign,
};
use aws_sigv4::sign::v4;
use aws_smithy_runtime_api::http::Headers;

use crate::support::aws::{Call, Endpoint, Key, Payload, REGION};
use crate::support::body::crc32_header;
use crate::support::check::{Ctx, Env};
use crate::support::emulator::{EmulatorFiles, emulator_dir};
use crate::support::pair::Pair;

pub const SIGNED_CHUNKS: &str = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
pub const SIGNED_CHUNKS_TRAILER: &str = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";
pub const ECDSA_CHUNKS: &str = "STREAMING-AWS4-ECDSA-P256-SHA256-PAYLOAD";

/// The signature value every chunk and trailer of an upload through the engine carries.
pub const ZERO_SIGNATURE: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// How the framing departs from the well-formed one; applied alike to both forms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Malformed {
    /// Well-formed.
    None,
    /// The first chunk's size written as this text instead of its hex length.
    FirstSize(&'static str),
    /// The first chunk's data one byte shorter than the size its header declares.
    FirstDataShort,
    /// The first chunk header without its `chunk-signature` extension.
    FirstNoSignature,
    /// `X-Amz-Decoded-Content-Length` one more than the data.
    DecodedLengthPlusOne,
}

/// One signed-chunk `PUT`: its target, mode, data and how the data is cut into chunks.
#[derive(Clone)]
pub struct SignedChunkUpload {
    /// Path and query, exactly as sent.
    pub target: String,
    pub mode: &'static str,
    pub data: Vec<u8>,
    /// The data length of each data chunk, in order; the final empty chunk is not listed.
    pub sizes: Vec<usize>,
    /// A `x-amz-checksum-crc32` trailer with `X-Amz-Trailer: x-amz-checksum-crc32`.
    pub trailer: bool,
    pub malformed: Malformed,
}

enum Slot {
    /// A chunk header's signature (at `at`, when the header carries one) and the bytes it covers.
    Chunk {
        at: Option<usize>,
        covers: Range<usize>,
    },
    /// The trailer signature, at `at`, over the trailing header.
    Trailer {
        at: usize,
        name: String,
        value: String,
    },
}

/// A framed body with every signature `ZERO_SIGNATURE`, and where each signature goes.
struct Framed {
    body: Vec<u8>,
    slots: Vec<Slot>,
}

impl SignedChunkUpload {
    /// `PUT <target>` in `SIGNED_CHUNKS` mode, `data` cut into chunks of `chunk` bytes (the last may be shorter).
    pub fn put(target: &str, data: Vec<u8>, chunk: usize) -> SignedChunkUpload {
        let sizes = data.chunks(chunk.max(1)).map(<[u8]>::len).collect();
        SignedChunkUpload {
            target: target.to_owned(),
            mode: SIGNED_CHUNKS,
            data,
            sizes,
            trailer: false,
            malformed: Malformed::None,
        }
    }

    /// The same upload with its data cut at these sizes; they must add up to the data's length.
    pub fn sizes(mut self, sizes: &[usize]) -> SignedChunkUpload {
        assert_eq!(
            sizes.iter().sum::<usize>(),
            self.data.len(),
            "chunk sizes must add up to the data length"
        );
        self.sizes = sizes.to_vec();
        self
    }

    /// The same upload in `-PAYLOAD-TRAILER` mode with a CRC32 trailer.
    pub fn with_trailer(mut self) -> SignedChunkUpload {
        self.mode = SIGNED_CHUNKS_TRAILER;
        self.trailer = true;
        self
    }

    pub fn mode(mut self, mode: &'static str) -> SignedChunkUpload {
        self.mode = mode;
        self
    }

    pub fn malformed(mut self, malformed: Malformed) -> SignedChunkUpload {
        self.malformed = malformed;
        self
    }

    /// The same upload to another target.
    pub fn to(&self, target: &str) -> SignedChunkUpload {
        let mut upload = self.clone();
        upload.target = target.to_owned();
        upload
    }

    /// The data bytes the body carries (one fewer than the data with `FirstDataShort`).
    pub fn sent_data(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.data.len());
        let mut at = 0;
        for (i, size) in self.sizes.iter().enumerate() {
            let part = &self.data[at..at + size];
            at += size;
            if i == 0 && self.malformed == Malformed::FirstDataShort {
                out.extend_from_slice(&part[..part.len().saturating_sub(1)]);
            } else {
                out.extend_from_slice(part);
            }
        }
        out
    }

    fn decoded_length(&self) -> usize {
        let n = self.sent_data().len();
        if self.malformed == Malformed::DecodedLengthPlusOne {
            n + 1
        } else {
            n
        }
    }

    /// The headers both forms send and sign besides the signature's own.
    fn headers(&self) -> Vec<(String, String)> {
        let mut headers = vec![
            ("Content-Encoding".to_owned(), "aws-chunked".to_owned()),
            (
                "X-Amz-Decoded-Content-Length".to_owned(),
                self.decoded_length().to_string(),
            ),
        ];
        if self.trailer {
            headers.push((
                "X-Amz-Trailer".to_owned(),
                "x-amz-checksum-crc32".to_owned(),
            ));
        }
        headers
    }

    fn frame(&self) -> Framed {
        let mut body = Vec::with_capacity(self.data.len() + 128 * (self.sizes.len() + 2));
        let mut slots = Vec::new();
        let mut at = 0;
        for (i, size) in self.sizes.iter().enumerate() {
            let part = &self.data[at..at + size];
            at += size;
            let first = i == 0;
            let size_text = match self.malformed {
                Malformed::FirstSize(text) if first => text.to_owned(),
                _ => format!("{size:x}"),
            };
            let signature_at = if first && self.malformed == Malformed::FirstNoSignature {
                body.extend_from_slice(format!("{size_text}\r\n").as_bytes());
                None
            } else {
                body.extend_from_slice(format!("{size_text};chunk-signature=").as_bytes());
                let signature_at = body.len();
                body.extend_from_slice(format!("{ZERO_SIGNATURE}\r\n").as_bytes());
                Some(signature_at)
            };
            let start = body.len();
            if first && self.malformed == Malformed::FirstDataShort {
                body.extend_from_slice(&part[..part.len().saturating_sub(1)]);
            } else {
                body.extend_from_slice(part);
            }
            body.extend_from_slice(b"\r\n");
            slots.push(Slot::Chunk {
                at: signature_at,
                covers: start..start + size,
            });
        }
        body.extend_from_slice(b"0;chunk-signature=");
        let final_at = body.len();
        body.extend_from_slice(format!("{ZERO_SIGNATURE}\r\n").as_bytes());
        slots.push(Slot::Chunk {
            at: Some(final_at),
            covers: body.len()..body.len(),
        });
        if self.trailer {
            let value = crc32_header(&self.sent_data());
            body.extend_from_slice(format!("x-amz-checksum-crc32:{value}\r\n").as_bytes());
            body.extend_from_slice(b"x-amz-trailer-signature:");
            let trailer_at = body.len();
            body.extend_from_slice(format!("{ZERO_SIGNATURE}\r\n").as_bytes());
            slots.push(Slot::Trailer {
                at: trailer_at,
                name: "x-amz-checksum-crc32".to_owned(),
                value,
            });
        }
        body.extend_from_slice(b"\r\n");
        // A short chunk's signature covers the bytes after its header line up to its declared size.
        let len = body.len();
        for slot in &mut slots {
            if let Slot::Chunk { covers, .. } = slot {
                covers.end = covers.end.min(len);
                covers.start = covers.start.min(covers.end);
            }
        }
        Framed { body, slots }
    }

    /// The framed body with every signature `ZERO_SIGNATURE`.
    pub fn zeroed_body(&self) -> Vec<u8> {
        self.frame().body
    }

    /// The upload as a client sends it through the engine: zero signatures, header-signed by `send` with
    /// whatever key it is given (the check key).
    pub fn zeroed_call(&self) -> Call {
        let mut call =
            Call::s3("PUT", &self.target).payload(Payload::Literal(self.mode.to_owned()));
        for (name, value) in self.headers() {
            call = call.header(&name, &value);
        }
        call.body(self.zeroed_body())
    }

    /// The reference upload for the emulator on `port`: the head header-signed now with its key, the chunk chain
    /// and trailer signature from the reference signer seeded with the head's signature. The returned call carries
    /// its signature headers as they are; `send` adds nothing to them.
    pub fn reference_call(&self, ctx: &Ctx, port: u16) -> Result<Call, Env> {
        let files = EmulatorFiles::read(&emulator_dir(&ctx.home, port)).ok_or_else(|| {
            Env::new(format!(
                "the files of the emulator on port {port} are missing or incomplete"
            ))
        })?;
        let identity = Credentials::new(
            files.access_key_id.clone(),
            files.secret_access_key.clone(),
            None,
            None,
            "emuforge-integration",
        )
        .into();
        let at = SystemTime::now();
        let invalid =
            |e: &dyn std::fmt::Display| Env::new(format!("cannot sign the reference upload: {e}"));

        let mut settings = SigningSettings::default();
        settings.signature_location = SignatureLocation::Headers;
        settings.payload_checksum_kind = PayloadChecksumKind::XAmzSha256;
        settings.percent_encoding_mode = PercentEncodingMode::Single;
        settings.uri_path_normalization_mode = UriPathNormalizationMode::Disabled;
        let head_params = v4::SigningParams::builder()
            .identity(&identity)
            .region(REGION)
            .name("s3")
            .time(at)
            .settings(settings)
            .build()
            .map_err(|e| invalid(&e))?
            .into();
        let host = Endpoint::emulator_on(ctx, port).host();
        let headers = self.headers();
        let mut signed: Vec<(&str, &str)> = vec![("host", host.as_str())];
        signed.extend(headers.iter().map(|(n, v)| (n.as_str(), v.as_str())));
        let uri = format!("http://{host}{}", self.target);
        let request = SignableRequest::new(
            "PUT",
            Cow::Owned(uri),
            signed.into_iter(),
            SignableBody::Precomputed(self.mode.to_owned()),
        )
        .map_err(|e| invalid(&e))?;
        let (instructions, seed) = sign(request, &head_params)
            .map_err(|e| invalid(&e))?
            .into_parts();
        let (signature_headers, _) = instructions.into_parts();
        let signature_headers: Vec<(String, String)> = signature_headers
            .iter()
            .map(|h| (h.name().to_owned(), h.value().to_owned()))
            .collect();

        let chain_params = v4::SigningParams::builder()
            .identity(&identity)
            .region(REGION)
            .name("s3")
            .time(at)
            .settings(())
            .build()
            .map_err(|e| invalid(&e))?;
        let Framed { mut body, slots } = self.frame();
        let mut running = seed;
        for slot in &slots {
            let (at, signature) = match slot {
                Slot::Chunk { at, covers } => {
                    let bytes = bytes::Bytes::copy_from_slice(&body[covers.clone()]);
                    let signature = v4::sign_chunk(&bytes, &running, &chain_params)
                        .map_err(|e| invalid(&e))?
                        .into_parts()
                        .1;
                    (*at, signature)
                }
                Slot::Trailer { at, name, value } => {
                    let mut trailing = Headers::new();
                    trailing.insert(name.clone(), value.clone());
                    let signature = v4::sign_trailer(&trailing, &running, &chain_params)
                        .map_err(|e| invalid(&e))?
                        .into_parts()
                        .1;
                    (Some(*at), signature)
                }
            };
            if signature.len() != ZERO_SIGNATURE.len() {
                return Err(Env::new(format!(
                    "the reference signer gave a signature of {} characters",
                    signature.len()
                )));
            }
            if let Some(at) = at {
                body[at..at + signature.len()].copy_from_slice(signature.as_bytes());
            }
            running = signature;
        }

        let mut call = Call::new("s3", "PUT", &self.target).unsigned();
        for (name, value) in &headers {
            call = call.header(name, value);
        }
        for (name, value) in &signature_headers {
            call = call.unsigned_header(name, value);
        }
        Ok(call.body(body))
    }
}

/// Sends `direct` as a reference upload to the run's emulator, then `engine` zeroed through the engine with the
/// check key. `Env` when the emulator gives no answer; a failed assertion when the engine gives none.
pub fn signed_chunk_pair(
    ctx: &Ctx,
    what: &str,
    engine: &SignedChunkUpload,
    direct: &SignedChunkUpload,
) -> Result<Pair, Env> {
    let reference = direct.reference_call(ctx, ctx.emulator_port)?;
    let direct = reference
        .send(
            ctx,
            &Endpoint::emulator(ctx),
            &Key::of_emulator(ctx, ctx.emulator_port)?,
        )
        .map_err(|e| Env::new(format!("{what}: the emulator gave no answer directly: {e}")))?;
    let engine = engine
        .zeroed_call()
        .send(ctx, &Endpoint::engine(ctx), &Key::check())
        .unwrap_or_else(|e| panic!("{what}: the engine gave no answer: {e}"));
    Ok(Pair { direct, engine })
}

/// A header-signed `PUT <path>` with a signed-chunk body of `decoded` in 64 KiB chunks and zero signatures, as
/// a client sends it through the engine.
pub fn signed_chunk_put(path: &str, decoded: &[u8]) -> Call {
    SignedChunkUpload::put(path, decoded.to_vec(), 64 * 1024).zeroed_call()
}

/// The lower-case hex MD5 of `bytes` (RFC 1321): the `ETag` S3 gives an object or a part put in one request.
pub fn md5_hex(bytes: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64)
        .map(|i| ((i as f64 + 1.0).sin().abs() * 4_294_967_296.0) as u32)
        .collect();
    let mut message = bytes.to_vec();
    let bits = (bytes.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bits.to_le_bytes());
    let mut state: [u32; 4] = [0x6745_2301, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476];
    for block in message.chunks(64) {
        let m: Vec<u32> = block
            .chunks(4)
            .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
            .collect();
        let [mut a, mut b, mut c, mut d] = state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let rotated = a
                .wrapping_add(f)
                .wrapping_add(k[i])
                .wrapping_add(m[g])
                .rotate_left(S[i]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(rotated);
        }
        state = [
            state[0].wrapping_add(a),
            state[1].wrapping_add(b),
            state[2].wrapping_add(c),
            state[3].wrapping_add(d),
        ];
    }
    state
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .map(|b| format!("{b:02x}"))
        .collect()
}
