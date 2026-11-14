//! Request bodies: bytes generated from a seed, the checksum headers the AWS CLI sends with them, and the
//! `aws-chunked` encoding with an unsigned CRC32 trailer (`STREAMING-UNSIGNED-PAYLOAD-TRAILER`).

/// `len` bytes from a seed (xorshift64*), the same for the same seed on every run.
pub fn seeded(seed: u64, len: usize) -> Vec<u8> {
    let mut state = seed | 1;
    let mut out = Vec::with_capacity(len + 8);
    while out.len() < len {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        out.extend_from_slice(&state.wrapping_mul(0x2545_F491_4F6C_DD1D).to_le_bytes());
    }
    out.truncate(len);
    out
}

/// Standard base64 with padding, as `x-amz-checksum-*` headers carry it.
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for group in bytes.chunks(3) {
        let b = [
            group[0],
            *group.get(1).unwrap_or(&0),
            *group.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= group.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// CRC-64/NVME (reflected polynomial 0x9A6C9329AC4BC9B5, initial value and final XOR all ones), the
/// checksum of `x-amz-checksum-crc64nvme`.
pub fn crc64nvme(bytes: &[u8]) -> u64 {
    const POLY: u64 = 0x9A6C_9329_AC4B_C9B5;
    let mut table = [0u64; 256];
    for (i, entry) in table.iter_mut().enumerate() {
        let mut crc = i as u64;
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ POLY
            } else {
                crc >> 1
            };
        }
        *entry = crc;
    }
    let mut crc = u64::MAX;
    for byte in bytes {
        crc = table[((crc ^ u64::from(*byte)) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}

/// The `x-amz-checksum-crc64nvme` header value of `bytes`.
pub fn crc64nvme_header(bytes: &[u8]) -> String {
    base64(&crc64nvme(bytes).to_be_bytes())
}

/// The `x-amz-checksum-crc32` header value of `bytes`.
pub fn crc32_header(bytes: &[u8]) -> String {
    base64(&crc32fast::hash(bytes).to_be_bytes())
}

/// `body` in `aws-chunked` encoding with chunks of `chunk` bytes, a final empty chunk and the trailer
/// `x-amz-checksum-crc32:<base64>`, for `X-Amz-Content-SHA256: STREAMING-UNSIGNED-PAYLOAD-TRAILER` with
/// `X-Amz-Trailer: x-amz-checksum-crc32` and `X-Amz-Decoded-Content-Length: <body length>`.
pub fn aws_chunked_unsigned_trailer(body: &[u8], chunk: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 128);
    for part in body.chunks(chunk) {
        out.extend_from_slice(format!("{:x}\r\n", part.len()).as_bytes());
        out.extend_from_slice(part);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"0\r\n");
    out.extend_from_slice(format!("x-amz-checksum-crc32:{}\r\n", crc32_header(body)).as_bytes());
    out.extend_from_slice(b"\r\n");
    out
}
