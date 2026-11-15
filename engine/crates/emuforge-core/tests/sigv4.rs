#![cfg(test)]

use std::collections::HashMap;
use std::fs;
use std::num::NonZeroU16;
use std::path::PathBuf;

use emuforge_core::sigv4::{
    Auth, ClientAuth, Scope, UriMode, canonical_request, canonical_trailer, chunk_signature, classify,
    sign_with, signature, signing_key, string_to_sign, trailer_signature,
};
use emuforge_core::{CA_FILE, CREDENTIALS_FILE, Emulator, EmulatorFiles};
use http::header::{HeaderMap, HeaderName, HeaderValue};
use http::request::Parts;
use http::{Method, Request};

/// The AWS document vectors (design §8), one per file.
const DOCUMENT_VECTORS: [&str; 6] = [
    "iam-list-users.txt",
    "s3-get-object.txt",
    "s3-put-object.txt",
    "s3-get-bucket-lifecycle.txt",
    "s3-list-objects.txt",
    "s3-presigned-get-object.txt",
];
/// The two signed-chunk vectors (design §8), one per file.
const CHUNK_VECTORS: [&str; 2] = ["s3-signed-chunks.txt", "s3-signed-chunks-trailer.txt"];
const EMPTY_HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ANY_SIGNATURE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

fn section<'a>(sections: &'a HashMap<String, String>, name: &str, file: &str) -> &'a str {
    sections
        .get(name)
        .unwrap_or_else(|| panic!("{file}: no section {name}"))
}

fn header_map(lines: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    for line in lines.lines() {
        let (name, value) = line.split_once(':').unwrap();
        headers.append(
            HeaderName::from_bytes(name.as_bytes()).unwrap(),
            HeaderValue::from_str(value.trim_start()).unwrap(),
        );
    }
    headers
}

fn names(list: &str) -> Vec<HeaderName> {
    list.split(';')
        .map(|name| HeaderName::from_bytes(name.as_bytes()).unwrap())
        .collect()
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

/// The vector's canonical request built from its inputs.
fn canonical_from_vector(file: &str) -> (String, String) {
    let vector = sections(file);
    let request_line = section(&vector, "request-line", file);
    let (method, target) = request_line.split_once(' ').unwrap();
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let mode = match section(&vector, "uri-mode", file) {
        "as-sent" => UriMode::AsSent,
        "encode-segments" => UriMode::EncodeSegments,
        other => panic!("{file}: unknown uri-mode {other}"),
    };
    let built = canonical_request(
        &Method::from_bytes(method.as_bytes()).unwrap(),
        path,
        query,
        &header_map(section(&vector, "headers", file)),
        &names(section(&vector, "signed-headers", file)),
        section(&vector, "payload-hash", file),
        mode,
    );
    (
        built,
        section(&vector, "canonical-request", file).to_owned(),
    )
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

fn parts(head: &str) -> Parts {
    let mut lines = head.lines();
    let request_line = lines.next().unwrap();
    let mut words = request_line.split(' ');
    let (method, target) = (words.next().unwrap(), words.next().unwrap());
    let mut builder = Request::builder().method(method).uri(target);
    for line in lines {
        let (name, value) = line.split_once(':').unwrap();
        builder = builder.header(name, value.trim_start());
    }
    builder.body(()).unwrap().into_parts().0
}

fn cli_head(name: &str) -> String {
    let heads = sections("cli-heads.txt");
    section(&heads, name, "cli-heads.txt").to_owned()
}

fn canonical_lines(
    path: &str,
    query: &str,
    headers: &HeaderMap,
    signed: &[&str],
    mode: UriMode,
) -> Vec<String> {
    let signed: Vec<HeaderName> = signed.iter().map(|name| names(name)[0].clone()).collect();
    canonical_request(
        &Method::GET,
        path,
        query,
        headers,
        &signed,
        EMPTY_HASH,
        mode,
    )
    .split('\n')
    .map(str::to_owned)
    .collect()
}

fn host_only() -> HeaderMap {
    header_map("Host: 127.0.0.1:9391")
}

fn client_auth(
    access_key_id: &str,
    service: &str,
    amz_date: &str,
    signed: &str,
    expires: Option<&str>,
) -> ClientAuth {
    ClientAuth {
        access_key_id: access_key_id.to_owned(),
        scope: Scope {
            date: amz_date[..8].to_owned(),
            region: "us-east-1".to_owned(),
            service: service.to_owned(),
        },
        amz_date: amz_date.to_owned(),
        signed_headers: names(signed),
        expires: expires.map(str::to_owned),
    }
}

// Given the fixed vectors under tests/vectors/

#[test]
fn canonical_request_of_each_document_vector_equals_its_text() {
    for file in DOCUMENT_VECTORS {
        let (built, expected) = canonical_from_vector(file);
        assert_eq!(built, expected, "{file}");
    }
}

#[test]
fn string_to_sign_of_each_document_vector_equals_its_text() {
    for file in DOCUMENT_VECTORS {
        let vector = sections(file);
        let built = string_to_sign(
            section(&vector, "amz-date", file),
            &scope(section(&vector, "scope", file)),
            section(&vector, "canonical-request", file),
        );
        assert_eq!(built, section(&vector, "string-to-sign", file), "{file}");
    }
}

#[tokio::test]
async fn signature_of_each_document_vector_equals_its_signature() {
    for file in DOCUMENT_VECTORS {
        let vector = sections(file);
        let files = files_with_secret(section(&vector, "secret", file)).await;
        let built = signature(
            &files.credentials().secret_access_key,
            &scope(section(&vector, "scope", file)),
            section(&vector, "string-to-sign", file),
        );
        assert_eq!(built, section(&vector, "signature", file), "{file}");
    }
}

#[tokio::test]
async fn sign_with_of_each_document_vector_equals_its_signature() {
    for file in DOCUMENT_VECTORS {
        let vector = sections(file);
        let files = files_with_secret(section(&vector, "secret", file)).await;
        let key = signing_key(
            &files.credentials().secret_access_key,
            &scope(section(&vector, "scope", file)),
        );
        let built = sign_with(&key, section(&vector, "string-to-sign", file));
        assert_eq!(built, section(&vector, "signature", file), "{file}");
    }
}

// Given the chunk vector and the trailer vector

#[tokio::test]
async fn chunk_signature_of_each_vector_chunk_equals_its_signature() {
    for file in CHUNK_VECTORS {
        let vector = sections(file);
        let files = files_with_secret(section(&vector, "secret", file)).await;
        let scope = scope(section(&vector, "scope", file));
        let key = signing_key(&files.credentials().secret_access_key, &scope);
        let byte = section(&vector, "data-byte", file).as_bytes()[0];
        let sizes = section(&vector, "chunk-sizes", file).lines();
        let signatures = section(&vector, "chunk-signatures", file).lines();
        let mut previous = section(&vector, "seed-signature", file).to_owned();
        for (size, expected) in sizes.zip(signatures) {
            let size: usize = size.parse().unwrap();
            let case = match size {
                0 => format!("{file}: final empty chunk"),
                _ => format!("{file}: chunk of {size} bytes"),
            };
            let built = chunk_signature(
                &key,
                section(&vector, "amz-date", file),
                &scope,
                &previous,
                &vec![byte; size],
            );
            assert_eq!(built, expected, "{case}");
            previous = built;
        }
    }
}

#[tokio::test]
async fn trailer_signature_of_the_trailer_vector_equals_its_signature() {
    let file = "s3-signed-chunks-trailer.txt";
    let vector = sections(file);
    let files = files_with_secret(section(&vector, "secret", file)).await;
    let scope = scope(section(&vector, "scope", file));
    let key = signing_key(&files.credentials().secret_access_key, &scope);
    let headers: Vec<(&[u8], &[u8])> = section(&vector, "trailing-headers", file)
        .lines()
        .map(|line| {
            let (name, value) = line.split_once(':').unwrap();
            (name.as_bytes(), value.as_bytes())
        })
        .collect();
    let canonical = canonical_trailer(&headers);
    let hash = ring::digest::digest(&ring::digest::SHA256, &canonical);
    let hash: String = hash.as_ref().iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hash, section(&vector, "trailer-hash", file), "trailer hash");
    let final_chunk = section(&vector, "chunk-signatures", file)
        .lines()
        .last()
        .unwrap();
    let built = trailer_signature(
        &key,
        section(&vector, "amz-date", file),
        &scope,
        final_chunk,
        &canonical,
    );
    assert_eq!(built, section(&vector, "trailer-signature", file));
}

// Given trailing headers

#[test]
fn canonical_trailer_sorts_by_lower_cased_name_and_trims_values() {
    let headers: [(&[u8], &[u8]); 2] = [
        (b"X-Amz-Checksum-SHA256", b" b "),
        (b"x-amz-checksum-crc32", b"a"),
    ];
    assert_eq!(
        canonical_trailer(&headers),
        b"x-amz-checksum-crc32:a\nx-amz-checksum-sha256:b\n"
    );
}

#[test]
fn canonical_trailer_of_no_header_is_empty() {
    assert_eq!(canonical_trailer(&[]), b"");
}

// Given a secret whose text is the AWS example key

#[tokio::test]
async fn signing_key_debug_is_redacted() {
    let files = files_with_secret("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY").await;
    let key = signing_key(
        &files.credentials().secret_access_key,
        &scope("20130524/us-east-1/s3/aws4_request"),
    );
    assert_eq!(format!("{key:?}"), "[redacted]");
}

// Given a raw path and query

#[test]
fn canonical_request_as_sent_keeps_the_raw_path() {
    let lines = canonical_lines(
        "/b/a%20b/%C3%BC%2Bc",
        "",
        &host_only(),
        &["host"],
        UriMode::AsSent,
    );
    assert_eq!(lines[1], "/b/a%20b/%C3%BC%2Bc");
}

#[test]
fn canonical_request_encode_segments_encodes_each_segment_again() {
    let lines = canonical_lines(
        "/2015-03-31/functions/arn%3Aaws%3Alambda/configuration",
        "",
        &host_only(),
        &["host"],
        UriMode::EncodeSegments,
    );
    assert_eq!(
        lines[1],
        "/2015-03-31/functions/arn%253Aaws%253Alambda/configuration"
    );
}

#[test]
fn canonical_request_encode_segments_percent_encodes_reserved_characters() {
    let cases = [
        ("colon", "/f/a:b", "/f/a%3Ab"),
        ("equals", "/f/a=b", "/f/a%3Db"),
        ("plus", "/f/a+b", "/f/a%2Bb"),
        ("dollar", "/f/a$b", "/f/a%24b"),
    ];
    for (name, path, expected) in cases {
        let lines = canonical_lines(path, "", &host_only(), &["host"], UriMode::EncodeSegments);
        assert_eq!(lines[1], expected, "{name}");
    }
}

#[test]
fn canonical_request_query_is_sorted_by_name_then_value_with_empty_values() {
    let lines = canonical_lines(
        "/",
        "b=2&a=1&a=0&c",
        &host_only(),
        &["host"],
        UriMode::AsSent,
    );
    assert_eq!(lines[2], "a=0&a=1&b=2&c=");
}

#[test]
fn canonical_request_query_is_decoded_then_encoded_with_the_unreserved_set() {
    let lines = canonical_lines(
        "/",
        "tilde=%7E&plus=a+b&space=a%20b",
        &host_only(),
        &["host"],
        UriMode::AsSent,
    );
    assert_eq!(lines[2], "plus=a%2Bb&space=a%20b&tilde=~");
}

#[test]
fn canonical_request_header_values_are_trimmed_collapsed_and_joined() {
    let mut headers = host_only();
    headers.append(
        "x-amz-meta-a",
        HeaderValue::from_static("  one   two  three  "),
    );
    headers.append("x-amz-meta-a", HeaderValue::from_static("four"));
    let lines = canonical_lines(
        "/",
        "",
        &headers,
        &["host", "x-amz-meta-a"],
        UriMode::AsSent,
    );
    assert_eq!(lines[3], "host:127.0.0.1:9391");
    assert_eq!(lines[4], "x-amz-meta-a:one two three,four");
    assert_eq!(lines[6], "host;x-amz-meta-a");
}

// Given request heads (classify)

#[test]
fn classify_each_cli_header_set_is_header_form() {
    let akid = "EMUKEYID000000000001";
    let client = "AKIACLIENTKEY0000001";
    let cases = [
        (
            "s3 list-buckets",
            client_auth(
                akid,
                "s3",
                "20261114T162914Z",
                "host;x-amz-content-sha256;x-amz-date",
                None,
            ),
        ),
        (
            "s3 put-object",
            client_auth(
                akid,
                "s3",
                "20261114T162915Z",
                "host;x-amz-checksum-crc64nvme;x-amz-content-sha256;x-amz-date;x-amz-sdk-checksum-algorithm",
                None,
            ),
        ),
        (
            "s3 get-object",
            client_auth(
                akid,
                "s3",
                "20261114T162915Z",
                "host;x-amz-checksum-mode;x-amz-content-sha256;x-amz-date",
                None,
            ),
        ),
        (
            "dynamodb list-tables",
            client_auth(
                client,
                "dynamodb",
                "20261114T162917Z",
                "content-type;host;x-amz-date;x-amz-target",
                None,
            ),
        ),
        (
            "sqs list-queues",
            client_auth(
                client,
                "sqs",
                "20261114T162917Z",
                "content-type;host;x-amz-date;x-amz-target;x-amzn-query-mode",
                None,
            ),
        ),
        (
            "iam list-users",
            client_auth(
                client,
                "iam",
                "20261114T162918Z",
                "content-type;host;x-amz-date",
                None,
            ),
        ),
        (
            "lambda list-functions",
            client_auth(
                client,
                "lambda",
                "20261114T162918Z",
                "host;x-amz-date",
                None,
            ),
        ),
    ];
    for (name, expected) in cases {
        assert_eq!(
            classify(&parts(&cli_head(name))),
            Auth::Header(expected),
            "{name}"
        );
    }
}

#[test]
fn classify_query_signed_get_is_query_form() {
    let expected = client_auth(
        "EMUKEYID000000000001",
        "s3",
        "20261114T162916Z",
        "host",
        Some("300"),
    );
    assert_eq!(
        classify(&parts(&cli_head("s3 presign"))),
        Auth::Query(expected)
    );
}

#[test]
fn classify_unsigned_or_another_scheme_is_other() {
    let cases = [
        ("no signature", "GET /b1/k1 HTTP/1.1\nHost: 127.0.0.1:8297"),
        (
            "bearer",
            "GET /b1/k1 HTTP/1.1\nHost: 127.0.0.1:8297\nAuthorization: Bearer abc",
        ),
        (
            "sigv2",
            "GET /b1/k1 HTTP/1.1\nHost: 127.0.0.1:8297\nDate: Sat, 14 Nov 2026 16:29:14 GMT\n\
             Authorization: AWS AKIACLIENTKEY0000001:frJIUN8DYpKDtOLCwo//yllqDzg=",
        ),
    ];
    for (name, head) in cases {
        assert_eq!(classify(&parts(head)), Auth::Other, "{name}");
    }
}

/// A header-signed head for service s3 with the given `Authorization` value and date headers.
fn header_signed(authorization: &str, dates: &str) -> String {
    format!("GET / HTTP/1.1\nHost: 127.0.0.1:8297\n{dates}Authorization: {authorization}")
}

#[test]
fn classify_malformed_or_incomplete_sigv4_header_is_other() {
    let credential = "Credential=AKIACLIENTKEY0000001/20261114/us-east-1/s3/aws4_request";
    let signed = "SignedHeaders=host;x-amz-date";
    let signature = format!("Signature={ANY_SIGNATURE}");
    let amz_date = "X-Amz-Date: 20261114T162914Z\n";
    let auth = |parts: &[&str]| format!("AWS4-HMAC-SHA256 {}", parts.join(", "));
    let well_formed = header_signed(&auth(&[credential, signed, &signature]), amz_date);
    assert!(
        matches!(classify(&parts(&well_formed)), Auth::Header(_)),
        "the well-formed base is header form"
    );
    let cases = [
        (
            "no Credential",
            header_signed(&auth(&[signed, &signature]), amz_date),
        ),
        (
            "no SignedHeaders",
            header_signed(&auth(&[credential, &signature]), amz_date),
        ),
        (
            "no Signature",
            header_signed(&auth(&[credential, signed]), amz_date),
        ),
        (
            "4-part credential",
            header_signed(
                &auth(&[
                    "Credential=AKIACLIENTKEY0000001/20261114/us-east-1/aws4_request",
                    signed,
                    &signature,
                ]),
                amz_date,
            ),
        ),
        (
            "63 hex signature",
            header_signed(
                &auth(&[
                    credential,
                    signed,
                    &format!("Signature={}", &ANY_SIGNATURE[1..]),
                ]),
                amz_date,
            ),
        ),
        (
            "non-hex signature",
            header_signed(
                &auth(&[
                    credential,
                    signed,
                    &format!("Signature=g{}", &ANY_SIGNATURE[1..]),
                ]),
                amz_date,
            ),
        ),
        (
            "SignedHeaders without host",
            header_signed(
                &auth(&[credential, "SignedHeaders=x-amz-date", &signature]),
                amz_date,
            ),
        ),
        (
            "no X-Amz-Date",
            header_signed(&auth(&[credential, signed, &signature]), ""),
        ),
        (
            "X-Amz-Date not yyyymmddThhmmssZ",
            header_signed(
                &auth(&[credential, signed, &signature]),
                "X-Amz-Date: 2026-11-14T16:29:14Z\n",
            ),
        ),
        (
            "X-Amz-Date date other than the scope date",
            header_signed(
                &auth(&[credential, signed, &signature]),
                "X-Amz-Date: 20261115T162914Z\n",
            ),
        ),
        (
            "Date and no X-Amz-Date",
            header_signed(
                &auth(&[credential, "SignedHeaders=date;host", &signature]),
                "Date: Sat, 14 Nov 2026 16:29:14 GMT\n",
            ),
        ),
    ];
    for (name, head) in cases {
        assert_eq!(classify(&parts(&head)), Auth::Other, "{name}");
    }
}

#[test]
fn classify_header_signature_and_query_signature_together_is_other() {
    let head = format!(
        "GET /b1/k1?X-Amz-Signature={ANY_SIGNATURE} HTTP/1.1\nHost: 127.0.0.1:8297\n\
         X-Amz-Date: 20261114T162914Z\n\
         Authorization: AWS4-HMAC-SHA256 Credential=AKIACLIENTKEY0000001/20261114/us-east-1/s3/aws4_request, \
         SignedHeaders=host;x-amz-date, Signature={ANY_SIGNATURE}"
    );
    assert_eq!(classify(&parts(&head)), Auth::Other);
}

#[test]
fn classify_query_without_or_with_a_repeated_parameter_is_other() {
    let presign = cli_head("s3 presign");
    let request_line = presign.lines().next().unwrap();
    let target = request_line.split(' ').nth(1).unwrap();
    let (path, query) = target.split_once('?').unwrap();
    let pairs: Vec<&str> = query.split('&').collect();
    let head = |pairs: &[&str]| {
        format!(
            "GET {path}?{} HTTP/1.1\nHost: 127.0.0.1:8297",
            pairs.join("&")
        )
    };
    assert!(
        matches!(classify(&parts(&head(&pairs))), Auth::Query(_)),
        "the captured base is query form"
    );
    let parameters = [
        "X-Amz-Algorithm",
        "X-Amz-Credential",
        "X-Amz-Date",
        "X-Amz-Expires",
        "X-Amz-SignedHeaders",
        "X-Amz-Signature",
    ];
    for parameter in parameters {
        let prefix = format!("{parameter}=");
        let position = pairs
            .iter()
            .position(|pair| pair.starts_with(&prefix))
            .unwrap();
        let mut without = pairs.clone();
        without.remove(position);
        assert_eq!(
            classify(&parts(&head(&without))),
            Auth::Other,
            "without {parameter}"
        );
        let mut twice = pairs.clone();
        twice.push(pairs[position]);
        assert_eq!(
            classify(&parts(&head(&twice))),
            Auth::Other,
            "{parameter} twice"
        );
    }
}
