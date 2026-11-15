Issue-Id: 9
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: feature
Issue-Source: plan
Issue-Key: engine|relay.signed-chunk-upload|missing
Issue-Check-Ids: engine.relay-s3-signed-chunk-put-matches-direct,engine.relay-s3-signed-chunk-trailer-put-matches-direct,engine.relay-s3-signed-chunk-upload-part-matches-direct,engine.relay-s3-signed-chunk-malformed-matches-direct,engine.relay-s3-ecdsa-chunk-modes-pass-unchanged,engine.relay-s3-signed-chunk-above-cap-refused,engine.relay-s3-signed-chunk-put-survives-emulator-restart,engine.relay-s3-unsigned-trailer-upload-stored,engine.relay-no-secret-in-output
Issue-Commit: 5d2272d5f0fce6922055a084780221cf8885e7e9

# Relay S3 uploads that sign each chunk

> Identified against commit `5d2272d5f0fce6922055a084780221cf8885e7e9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Some AWS SDKs upload S3 objects with signed chunks: `X-Amz-Content-SHA256` is
`STREAMING-AWS4-HMAC-SHA256-PAYLOAD` (or its `-TRAILER` or ECDSA variants), and the `aws-chunked` body carries a
`chunk-signature` per chunk, chained from the header signature. Issue #2's relay re-signs the header with the
emulator's key, so the chain in the body no longer matches, and the emulator verifies that chain. Issue #2 answers
such uploads with `400 PayloadSigningNotSupported` and sends nothing to the emulator
(`.pm/issue-2/requirement.md` §4, decision D4). Relaying them needs the chunk signatures re-computed in the stream
with the emulator's key, which changes body bytes and needs a recorded decision against
`engine/references/relay-fidelity.md` ("does not parse, re-encode or re-chunk").

Reference behavior: the same upload sent straight to aws-emulator, signed with the emulator's key and a correctly
chained chunk signature sequence, is stored.

## Evidence

`.pm/issue-2/evidence/emulator-calls.txt` section E, emulator 1.0.364 (commit
7496e0fe6a47c52c476745eafdf5f7a45815a659), `PUT /<bucket>/<key>` with 70000 bytes in 64 KiB chunks:

```
chunk signatures chained correctly from the header signature: 200
chunk signatures all zero:                                   403 SignatureDoesNotMatch, object absent (HeadObject 404)
chunk signatures correct but chained from another seed:     403 SignatureDoesNotMatch
```

## Steps to Reproduce

1. Start the emulator and the engine with issue #2 merged.
2. Through the engine, send an S3 `PutObject` with `X-Amz-Content-SHA256: STREAMING-AWS4-HMAC-SHA256-PAYLOAD`,
   `Content-Encoding: aws-chunked`, `X-Amz-Decoded-Content-Length` and a body of signed chunks, signed with any key.
3. The engine answers `400 PayloadSigningNotSupported`; the object is not stored.

## Expected

- A signed-chunk upload through the engine stores the same object, and returns the same status, headers that
  matter and body, as the same upload sent straight to the emulator with the emulator's key.
- The data bytes of every chunk reach the emulator unchanged and streamed; nothing is buffered beyond one chunk
  with a checked size cap.
- A malformed chunk framing is answered in the S3 error shape, and nothing partial is stored.

## Out of scope

- Verifying the client's chunk signatures (caller identification belongs to the IAM issues).
- Every payload mode issue #2 already relays.
