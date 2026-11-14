//! The signed-chunk upload body (`X-Amz-Content-SHA256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`), which the engine
//! refuses (`400 PayloadSigningNotSupported`, D4).

use crate::support::aws::{Call, Payload};
use crate::support::body::seeded;

pub const SIGNED_CHUNKS: &str = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";

/// `body` in `aws-chunked` encoding with a `chunk-signature` on every chunk and on the final empty chunk:
/// `<hex size>;chunk-signature=<64 hex>\r\n<data>\r\n … 0;chunk-signature=<64 hex>\r\n\r\n`. The signatures are
/// well-formed 64-hex values; the engine never verifies a client's signature (D1), so they are not computed.
pub fn aws_chunked_signed(body: &[u8], chunk: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 256);
    let mut n = 0u64;
    let mut signature = || {
        n += 1;
        seeded(0xc4a1_0000 + n, 32)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    for part in body.chunks(chunk) {
        out.extend_from_slice(
            format!("{:x};chunk-signature={}\r\n", part.len(), signature()).as_bytes(),
        );
        out.extend_from_slice(part);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(format!("0;chunk-signature={}\r\n\r\n", signature()).as_bytes());
    out
}

/// A header-signed `PUT <path>` with a signed-chunk body of `decoded`, as the AWS SDKs send it.
pub fn signed_chunk_put(path: &str, decoded: &[u8]) -> Call {
    Call::s3("PUT", path)
        .payload(Payload::Literal(SIGNED_CHUNKS.to_owned()))
        .header("Content-Encoding", "aws-chunked")
        .header("X-Amz-Decoded-Content-Length", &decoded.len().to_string())
        .body(aws_chunked_signed(decoded, 64 * 1024))
}
