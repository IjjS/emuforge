#![cfg(test)]

use std::collections::HashMap;
use std::fs;
use std::num::NonZeroU16;
use std::path::PathBuf;

use bytes::BytesMut;
use emuforge_core::chunked::{
    CHUNK_DATA_CAP, ChunkSigner, ChunkSigning, ChunkTooLarge, HEADER_LINE_CAP, TRAILER_CAP,
};
use emuforge_core::sigv4::{Scope, signing_key};
use emuforge_core::{CA_FILE, CREDENTIALS_FILE, Emulator, EmulatorFiles};

const CHUNK_VECTOR: &str = "s3-signed-chunks.txt";
const TRAILER_VECTOR: &str = "s3-signed-chunks-trailer.txt";
const CHUNK_SIGNATURE: &str = ";chunk-signature=";
const TRAILER_SIGNATURE: &str = "x-amz-trailer-signature:";

fn zero() -> String {
    "0".repeat(64)
}

/// Sections of a vector file: `== name ==` lines, each followed by its text verbatim; `#` lines before the first
/// section name the source.
fn sections(file: &str) -> HashMap<String, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/vectors")
        .join(file);
    let text = fs::read_to_string(&path).unwrap();
    let mut sections = HashMap::new();
    let mut current: Option<(String, Vec<&str>)> = None;
    for line in text.lines() {
        if let Some(name) = line.strip_prefix("== ").and_then(|l| l.strip_suffix(" ==")) {
            if let Some((name, lines)) = current.take() {
                sections.insert(name, lines.join("\n"));
            }
            current = Some((name.to_owned(), Vec::new()));
        } else if let Some((_, lines)) = current.as_mut() {
            lines.push(line);
        }
    }
    if let Some((name, lines)) = current {
        sections.insert(name, lines.join("\n"));
    }
    sections
}

/// Emulator files whose secret key is `secret`: the only way the crate hands out a `Secret` is reading them from
/// a temp home.
async fn files_with_secret(secret: &str) -> EmulatorFiles {
    let home = tempfile::tempdir().unwrap();
    let emulator = Emulator::new(home.path(), NonZeroU16::new(9391).unwrap());
    fs::create_dir_all(emulator.dir()).unwrap();
    let ca = rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_owned()])
        .unwrap()
        .cert
        .pem();
    fs::write(emulator.dir().join(CA_FILE), ca).unwrap();
    fs::write(
        emulator.dir().join(CREDENTIALS_FILE),
        format!(
            "[default]\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\naws_secret_access_key = {secret}\n"
        ),
    )
    .unwrap();
    EmulatorFiles::read(&emulator).await.unwrap()
}

fn scope(text: &str) -> Scope {
    let parts: Vec<&str> = text.split('/').collect();
    assert_eq!(parts.len(), 4, "scope {text}");
    assert_eq!(parts[3], "aws4_request");
    Scope {
        date: parts[0].to_owned(),
        region: parts[1].to_owned(),
        service: parts[2].to_owned(),
    }
}

/// One of the two signed-chunk vectors, as its file gives it.
struct Vector {
    secret: String,
    amz_date: String,
    scope: Scope,
    seed: String,
    byte: u8,
    sizes: Vec<usize>,
    signatures: Vec<String>,
    /// The trailing header lines and the trailer signature, for the trailer vector.
    trailer: Option<(Vec<String>, String)>,
    content_length: usize,
}

impl Vector {
    fn load(file: &str) -> Vector {
        let vector = sections(file);
        let get = |name: &str| {
            vector
                .get(name)
                .unwrap_or_else(|| panic!("{file}: no section {name}"))
                .clone()
        };
        let trailer = vector.get("trailing-headers").map(|lines| {
            (
                lines.lines().map(str::to_owned).collect(),
                get("trailer-signature"),
            )
        });
        Vector {
            secret: get("secret"),
            amz_date: get("amz-date"),
            scope: scope(&get("scope")),
            seed: get("seed-signature"),
            byte: get("data-byte").as_bytes()[0],
            sizes: get("chunk-sizes")
                .lines()
                .map(|size| size.parse().unwrap())
                .collect(),
            signatures: get("chunk-signatures").lines().map(str::to_owned).collect(),
            trailer,
            content_length: get("content-length").parse().unwrap(),
        }
    }

    async fn signing(&self) -> ChunkSigning {
        let files = files_with_secret(&self.secret).await;
        ChunkSigning::new(
            signing_key(&files.credentials().secret_access_key, &self.scope),
            self.amz_date.clone(),
            self.scope.clone(),
            self.seed.clone(),
            self.trailer.is_some(),
        )
    }

    /// The sizes as the page writes them, in lower-case hex.
    fn hex_sizes(&self) -> Vec<String> {
        self.sizes.iter().map(|size| format!("{size:x}")).collect()
    }

    /// The vector's body with the page's signatures.
    fn body(&self) -> Vec<u8> {
        let trailer = self
            .trailer
            .as_ref()
            .map(|(_, signature)| signature.as_str());
        let body = self.encode(&self.hex_sizes(), &self.signatures, trailer);
        assert_eq!(body.len(), self.content_length, "the page's Content-Length");
        body
    }

    /// The vector's body with every chunk and trailer signature 64 `0` characters.
    fn zeroed(&self) -> Vec<u8> {
        self.zeroed_with(&zero())
    }

    fn zeroed_with(&self, signature: &str) -> Vec<u8> {
        let signatures = vec![signature.to_owned(); self.sizes.len()];
        let trailer = self.trailer.as_ref().map(|_| signature);
        self.encode(&self.hex_sizes(), &signatures, trailer)
    }

    /// The chunks with the given size texts and signatures, then `\r\n` alone or, for the trailer vector, its
    /// trailing header lines, the trailer signature line and the empty line.
    fn encode(&self, sizes: &[String], signatures: &[String], trailer: Option<&str>) -> Vec<u8> {
        let mut body = Vec::new();
        for ((text, size), signature) in sizes.iter().zip(&self.sizes).zip(signatures) {
            body.extend_from_slice(format!("{text}{CHUNK_SIGNATURE}{signature}\r\n").as_bytes());
            if *size > 0 {
                body.extend(std::iter::repeat_n(self.byte, *size));
                body.extend_from_slice(b"\r\n");
            }
        }
        match (&self.trailer, trailer) {
            (Some((lines, _)), Some(signature)) => {
                body.extend_from_slice(trailer_section(lines, signature).as_bytes());
            }
            _ => body.extend_from_slice(b"\r\n"),
        }
        body
    }

    /// Length of everything up to the end of the final chunk's header line.
    fn chunks_len(&self) -> usize {
        let body = self.zeroed();
        let section = match &self.trailer {
            Some((lines, _)) => trailer_section(lines, &zero()).len(),
            None => 2,
        };
        body.len() - section
    }

    /// Length of the first chunk: its header line, its data and `\r\n`.
    fn first_chunk_len(&self) -> usize {
        format!("{:x}{CHUNK_SIGNATURE}", self.sizes[0]).len() + 64 + 2 + self.sizes[0] + 2
    }
}

fn trailer_section(lines: &[String], signature: &str) -> String {
    let mut section = String::new();
    for line in lines {
        section.push_str(line);
        section.push_str("\r\n");
    }
    section.push_str(&format!("{TRAILER_SIGNATURE}{signature}\r\n\r\n"));
    section
}

/// Every byte the signer writes for `pieces` pushed in turn, then `finish`.
fn run(signing: &ChunkSigning, pieces: &[&[u8]]) -> Vec<u8> {
    let mut signer = ChunkSigner::new(signing.clone());
    let mut out = BytesMut::new();
    for piece in pieces {
        signer.push(piece, &mut out).unwrap();
    }
    signer.finish(&mut out);
    out.to_vec()
}

/// The ranges of the 64 characters after each `chunk-signature=` and `x-amz-trailer-signature:` of `body`.
fn signature_ranges(body: &[u8]) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    for marker in ["chunk-signature=", TRAILER_SIGNATURE] {
        let marker = marker.as_bytes();
        for (at, window) in body.windows(marker.len()).enumerate() {
            if window == marker {
                let start = at + marker.len();
                ranges.push(start..start + 64);
            }
        }
    }
    ranges
}

/// `output` has `input`'s length and differs from it only in the 64 characters after each `chunk-signature=` and
/// `x-amz-trailer-signature:`, each of which was replaced.
fn assert_only_signatures_replaced(input: &[u8], output: &[u8], case: &str) {
    assert_eq!(output.len(), input.len(), "{case}: length");
    let ranges = signature_ranges(input);
    assert!(!ranges.is_empty(), "{case}: no signature in the input");
    for (at, (a, b)) in input.iter().zip(output).enumerate() {
        if a != b {
            assert!(
                ranges.iter().any(|range| range.contains(&at)),
                "{case}: byte {at} changed outside a signature"
            );
        }
    }
    for range in ranges {
        assert_ne!(
            &output[range.clone()],
            &input[range.clone()],
            "{case}: signature at {} not replaced",
            range.start
        );
    }
}

// Given a ChunkSigner for the vector in use

#[tokio::test]
async fn push_zeroed_chunk_vector_whole_writes_the_vector_body() {
    let vector = Vector::load(CHUNK_VECTOR);
    let output = run(&vector.signing().await, &[&vector.zeroed()]);
    assert!(output == vector.body(), "output is not the vector body");
}

#[tokio::test]
async fn push_zeroed_chunk_vector_in_two_pieces_at_each_offset_or_byte_by_byte_writes_the_vector_body()
 {
    let vector = Vector::load(CHUNK_VECTOR);
    let signing = vector.signing().await;
    let (zeroed, body) = (vector.zeroed(), vector.body());
    for offset in 0..=zeroed.len() {
        let (first, second) = zeroed.split_at(offset);
        let output = run(&signing, &[first, second]);
        assert!(output == body, "split at offset {offset}");
    }
    let bytes: Vec<&[u8]> = zeroed.chunks(1).collect();
    assert!(run(&signing, &bytes) == body, "one byte at a time");
}

#[tokio::test]
async fn push_chunk_vector_with_other_client_signatures_writes_the_vector_body() {
    let vector = Vector::load(CHUNK_VECTOR);
    let signing = vector.signing().await;
    for (case, signature) in [("1 x 64", "1".repeat(64)), ("f x 64", "f".repeat(64))] {
        let output = run(&signing, &[&vector.zeroed_with(&signature)]);
        assert!(output == vector.body(), "{case}");
    }
}

#[tokio::test]
async fn push_zeroed_trailer_vector_with_trailer_writes_the_trailer_vector_body() {
    let vector = Vector::load(TRAILER_VECTOR);
    let output = run(&vector.signing().await, &[&vector.zeroed()]);
    assert!(
        output == vector.body(),
        "output is not the trailer vector body"
    );
}

#[tokio::test]
async fn push_sizes_with_leading_zeros_get_the_vector_signatures() {
    let vector = Vector::load(CHUNK_VECTOR);
    let sizes: Vec<String> = ["0010000", "0400", "00"].map(str::to_owned).to_vec();
    let zeros = vec![zero(); 3];
    let input = vector.encode(&sizes, &zeros, None);
    let expected = vector.encode(&sizes, &vector.signatures, None);
    let output = run(&vector.signing().await, &[&input]);
    assert!(output == expected, "leading zeros");
}

#[tokio::test]
async fn push_size_in_lower_or_upper_case_hex_differs_only_in_that_character() {
    let signing = Vector::load(CHUNK_VECTOR).signing().await;
    let body = |size: &str| {
        let mut body = format!("{size}{CHUNK_SIGNATURE}{}\r\n", zero()).into_bytes();
        body.extend_from_slice(&[b'a'; 26]);
        body.extend_from_slice(format!("\r\n0{CHUNK_SIGNATURE}{}\r\n\r\n", zero()).as_bytes());
        body
    };
    let (lower, upper) = (body("1a"), body("1A"));
    let (lower_out, upper_out) = (run(&signing, &[&lower]), run(&signing, &[&upper]));
    let differing: Vec<usize> = (0..lower_out.len())
        .filter(|&at| lower_out[at] != upper_out[at])
        .collect();
    assert_eq!(lower_out.len(), upper_out.len(), "lengths");
    assert_eq!(
        differing,
        vec![1],
        "the outputs differ only in the size character"
    );
    assert_only_signatures_replaced(&lower, &lower_out, "1a");
    assert_only_signatures_replaced(&upper, &upper_out, "1A");
}

// Given the zeroed chunk vector body with its second chunk header altered

#[tokio::test]
async fn push_unrecognized_second_chunk_header_passes_the_rest_unchanged() {
    let vector = Vector::load(CHUNK_VECTOR);
    let signing = vector.signing().await;
    let first = vector.first_chunk_len();
    let second = format!("400{CHUNK_SIGNATURE}{}\r\n", zero());
    let cases = [
        ("no extension", "400\r\n".to_owned()),
        (
            "extension chunk-signature2",
            format!("400;chunk-signature2={}\r\n", zero()),
        ),
        (
            "63 hex and x",
            format!("400{CHUNK_SIGNATURE}{}x\r\n", "0".repeat(63)),
        ),
        (
            "upper-case signature",
            format!(
                "400{CHUNK_SIGNATURE}{}\r\n",
                vector.signatures[1].to_ascii_uppercase()
            ),
        ),
        (
            ";x=y after the signature",
            format!("400{CHUNK_SIGNATURE}{};x=y\r\n", zero()),
        ),
        ("size 40g", format!("40g{CHUNK_SIGNATURE}{}\r\n", zero())),
    ];
    let zeroed = vector.zeroed();
    let body = vector.body();
    for (case, header) in cases {
        let mut input = zeroed[..first].to_vec();
        input.extend_from_slice(header.as_bytes());
        input.extend_from_slice(&zeroed[first + second.len()..]);
        let output = run(&signing, &[&input]);
        assert!(
            output[..first] == body[..first],
            "{case}: first chunk is not the vector's"
        );
        assert!(
            output[first..] == input[first..],
            "{case}: the rest changed"
        );
    }
}

// Given the zeroed chunk vector body with the two bytes after the first chunk's data replaced by XX

#[tokio::test]
async fn push_bytes_other_than_crlf_after_chunk_data_pass_unchanged() {
    let vector = Vector::load(CHUNK_VECTOR);
    let end = vector.first_chunk_len() - 2;
    let mut input = vector.zeroed();
    input[end..end + 2].copy_from_slice(b"XX");
    let output = run(&vector.signing().await, &[&input]);
    let body = vector.body();
    assert!(
        output[..end] == body[..end],
        "first chunk header does not carry the vector's signature"
    );
    assert!(output[end..] == input[end..], "bytes from XX on changed");
}

// Given the zeroed chunk vector body cut inside the second chunk's data

#[tokio::test]
async fn finish_after_a_body_cut_inside_chunk_data_writes_the_held_bytes_unchanged() {
    let vector = Vector::load(CHUNK_VECTOR);
    let first = vector.first_chunk_len();
    let cut = first + format!("400{CHUNK_SIGNATURE}").len() + 64 + 2 + 500;
    let input = &vector.zeroed()[..cut];
    let output = run(&vector.signing().await, &[input]);
    let body = vector.body();
    assert!(
        output[..first] == body[..first],
        "first chunk is not the vector's"
    );
    assert!(output[first..] == input[first..], "held bytes changed");
}

// Given the zeroed chunk vector body followed by junk, trailer false

#[tokio::test]
async fn push_bytes_after_the_final_chunk_pass_unchanged() {
    let vector = Vector::load(CHUNK_VECTOR);
    let mut input = vector.zeroed();
    input.extend_from_slice(b"junk");
    let mut expected = vector.body();
    expected.extend_from_slice(b"junk");
    let output = run(&vector.signing().await, &[&input]);
    assert!(output == expected, "output is not the vector body and junk");
}

// Given the zeroed trailer vector body with its trailer altered

#[tokio::test]
async fn push_unrecognized_trailer_passes_it_unchanged() {
    let vector = Vector::load(TRAILER_VECTOR);
    let signing = vector.signing().await;
    let chunks = vector.chunks_len();
    let crc = "x-amz-checksum-crc32c:sOO8/Q==\r\n";
    let cases = [
        (
            "signature line not last",
            format!(
                "{crc}{TRAILER_SIGNATURE}{}\r\nx-amz-meta-x:y\r\n\r\n",
                zero()
            ),
        ),
        (
            "63 hex and x",
            format!("{crc}{TRAILER_SIGNATURE}{}x\r\n\r\n", "0".repeat(63)),
        ),
        (
            "a line without a colon",
            format!(
                "x-amz-checksum-crc32c sOO8/Q==\r\n{TRAILER_SIGNATURE}{}\r\n\r\n",
                zero()
            ),
        ),
        (
            "longer than TRAILER_CAP with no empty line",
            format!(
                "x-amz-meta-pad:{}\r\n{crc}{TRAILER_SIGNATURE}{}\r\n\r\n",
                "a".repeat(TRAILER_CAP),
                zero()
            ),
        ),
    ];
    let body = vector.body();
    for (case, section) in cases {
        let mut input = vector.zeroed()[..chunks].to_vec();
        input.extend_from_slice(section.as_bytes());
        let output = run(&signing, &[&input]);
        assert!(
            output[..chunks] == body[..chunks],
            "{case}: chunks are not the trailer vector's"
        );
        assert!(
            output[chunks..] == input[chunks..],
            "{case}: trailer changed"
        );
    }
}

// Given a 64-byte chunk, the final chunk and a trailer section padded to length, zero signatures, trailer true

/// The body and the offset of its trailer section, the section `section_len` bytes long.
fn padded_trailer_body(section_len: usize) -> (Vec<u8>, usize) {
    let mut body = format!("40{CHUNK_SIGNATURE}{}\r\n", zero()).into_bytes();
    body.extend_from_slice(&[b'a'; 64]);
    body.extend_from_slice(format!("\r\n0{CHUNK_SIGNATURE}{}\r\n", zero()).as_bytes());
    let start = body.len();
    let fixed = format!("x-amz-meta-pad:\r\n{TRAILER_SIGNATURE}{}\r\n\r\n", zero()).len();
    let pad = "a".repeat(section_len - fixed);
    body.extend_from_slice(
        format!(
            "x-amz-meta-pad:{pad}\r\n{TRAILER_SIGNATURE}{}\r\n\r\n",
            zero()
        )
        .as_bytes(),
    );
    assert_eq!(body.len() - start, section_len, "section length");
    (body, start)
}

async fn trailer_signing() -> ChunkSigning {
    let vector = Vector::load(TRAILER_VECTOR);
    vector.signing().await
}

#[tokio::test]
async fn push_trailer_section_of_exactly_the_cap_is_signed() {
    let (input, _) = padded_trailer_body(TRAILER_CAP);
    let output = run(&trailer_signing().await, &[&input]);
    assert_only_signatures_replaced(&input, &output, "trailer at TRAILER_CAP");
}

#[tokio::test]
async fn push_trailer_section_one_past_the_cap_passes_unchanged() {
    let (input, start) = padded_trailer_body(TRAILER_CAP + 1);
    let output = run(&trailer_signing().await, &[&input]);
    assert_eq!(output.len(), input.len(), "length");
    assert!(output[start..] == input[start..], "trailer section changed");
}

// Given chunk headers at the limits, zero signatures, trailer false

async fn chunk_signing() -> ChunkSigning {
    Vector::load(CHUNK_VECTOR).signing().await
}

/// A chunk whose header writes its size as `size_text`, `size` bytes of `a`, `\r\n`, the final chunk and `\r\n`.
fn one_chunk_body(size_text: &str, size: usize) -> Vec<u8> {
    let mut body = format!("{size_text}{CHUNK_SIGNATURE}{}\r\n", zero()).into_bytes();
    body.extend(std::iter::repeat_n(b'a', size));
    body.extend_from_slice(format!("\r\n0{CHUNK_SIGNATURE}{}\r\n\r\n", zero()).as_bytes());
    body
}

#[tokio::test]
async fn push_chunk_data_of_exactly_the_cap_is_signed() {
    let size = usize::try_from(CHUNK_DATA_CAP).unwrap();
    let input = one_chunk_body("100000", size);
    let mut signer = ChunkSigner::new(chunk_signing().await);
    let mut out = BytesMut::new();
    assert_eq!(signer.push(&input, &mut out), Ok(()));
    signer.finish(&mut out);
    assert_only_signatures_replaced(&input, &out, "1048576 bytes");
}

#[tokio::test]
async fn push_header_above_the_data_cap_is_too_large_at_its_line_end() {
    let cases = [
        ("100001", "100001".to_owned()),
        ("40 f digits", "f".repeat(40)),
        (
            "100001 after 4000 leading zeros",
            format!("{}100001", "0".repeat(4000)),
        ),
    ];
    let signing = chunk_signing().await;
    for (case, size) in cases {
        let line = format!("{size}{CHUNK_SIGNATURE}{}", zero());
        assert!(line.len() + 2 <= HEADER_LINE_CAP, "{case}: within the cap");
        let mut signer = ChunkSigner::new(signing.clone());
        let mut out = BytesMut::new();
        assert_eq!(signer.push(line.as_bytes(), &mut out), Ok(()), "{case}");
        assert_eq!(signer.push(b"\r\n", &mut out), Err(ChunkTooLarge), "{case}");
        assert!(out.is_empty(), "{case}: bytes written");
    }
}

#[tokio::test]
async fn push_header_line_of_exactly_the_cap_is_signed() {
    let fixed = format!("{CHUNK_SIGNATURE}{}\r\n", zero()).len();
    let size = format!("{}40", "0".repeat(HEADER_LINE_CAP - fixed - 2));
    let input = one_chunk_body(&size, 64);
    let output = run(&chunk_signing().await, &[&input]);
    assert_eq!(
        input.iter().position(|&byte| byte == b'\n'),
        Some(HEADER_LINE_CAP - 1),
        "header line length"
    );
    assert_only_signatures_replaced(&input, &output, "header line at HEADER_LINE_CAP");
}

#[tokio::test]
async fn push_header_line_one_past_the_cap_passes_unchanged() {
    let fixed = format!("{CHUNK_SIGNATURE}{}\r\n", zero()).len();
    let size = format!("{}40", "0".repeat(HEADER_LINE_CAP + 1 - fixed - 2));
    let input = one_chunk_body(&size, 64);
    assert_eq!(
        input.iter().position(|&byte| byte == b'\n'),
        Some(HEADER_LINE_CAP),
        "header line length"
    );
    let output = run(&chunk_signing().await, &[&input]);
    assert!(output == input, "output is not the input");
}

// Given a recognized header of size 1048576 and 524288 of its data bytes pushed

#[tokio::test]
async fn push_half_of_a_cap_chunk_writes_nothing_and_holds_it() {
    let header = format!("100000{CHUNK_SIGNATURE}{}\r\n", zero());
    let mut signer = ChunkSigner::new(chunk_signing().await);
    let mut out = BytesMut::new();
    signer.push(header.as_bytes(), &mut out).unwrap();
    signer.push(&[b'a'; 524_288], &mut out).unwrap();
    assert!(out.is_empty(), "bytes written");
    assert!(!signer.is_empty(), "nothing held");
}

#[tokio::test]
async fn push_rest_of_a_cap_chunk_writes_its_header_line_and_data() {
    let header = format!("100000{CHUNK_SIGNATURE}{}\r\n", zero());
    let mut signer = ChunkSigner::new(chunk_signing().await);
    let mut out = BytesMut::new();
    signer.push(header.as_bytes(), &mut out).unwrap();
    signer.push(&[b'a'; 524_288], &mut out).unwrap();
    signer.push(&[b'a'; 524_288], &mut out).unwrap();
    assert_eq!(out.len(), header.len() + 1_048_576, "length written");
    assert!(out[header.len()..].iter().all(|&byte| byte == b'a'), "data");
    let mut input = header.into_bytes();
    input.extend_from_slice(&[b'a'; 1_048_576]);
    assert_only_signatures_replaced(&input, &out, "cap chunk");
}

// Given ChunkSigning::new with the chunk vector's key, date, scope and seed

#[tokio::test]
async fn chunk_signing_debug_shows_date_scope_and_trailer_only() {
    let vector = Vector::load(CHUNK_VECTOR);
    let text = format!("{:?}", vector.signing().await);
    assert!(text.contains("20130524T000000Z"), "{text}: date");
    assert!(
        text.contains(&format!("{:?}", vector.scope)),
        "{text}: scope"
    );
    assert!(text.contains("trailer: false"), "{text}: trailer");
    let hex_run = text
        .as_bytes()
        .windows(64)
        .any(|window| window.iter().all(u8::is_ascii_hexdigit));
    assert!(!hex_run, "{text}: a 64-hex substring");
    assert!(!text.contains(&vector.seed), "{text}: the seed");
    assert!(!text.contains("redacted"), "{text}: the key");
    assert!(!text.contains(&vector.secret), "{text}: the secret");
}
