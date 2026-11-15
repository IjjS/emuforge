Issue-Id: 26
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws-client.http-cache|stale-answer
Issue-Check-Ids:
Issue-Commit: 37f568848d80f32259e69837fae525c1ce89940c

# Make Studio's AWS reads show the emulator's current state, not a browser-cached answer

> Identified against commit `37f568848d80f32259e69837fae525c1ce89940c`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's AWS SDK clients (`studio/src/lib/aws/client-factory.ts`) send their requests with the browser's default
fetch cache mode, so Chromium may answer a read from its HTTP cache instead of sending it to the engine. An S3
`GetObject` answer carries `Last-Modified` and, unless the object was stored with `Cache-Control`, no freshness
header, so Chromium treats it as fresh for a tenth of the time since `Last-Modified` (heuristic freshness): an
object last written ten minutes ago is read from the cache for a minute after each read. A change made meanwhile
by another client (the AWS CLI, Terraform, another tab) is not shown, and Studio shows a body the emulator no longer
holds. An object stored with `Cache-Control: max-age=<n>` is read from the cache for `n` seconds. The reference, the
same `GetObject` sent straight to aws-emulator by the AWS CLI, always returns the current object.

Issue #24 makes the engine's answers to Studio such that a cached answer is never reused for a request without the
current token, and keeps the emulator's caching headers as they come; Studio's own reads with the same token can
still be answered from the cache, which is this issue.

## Evidence

Found while planning issue #24 (main at `37f5688`), with a probe in a headless Chromium page at Studio's origin,
calling the engine the way `engine.studio-browser-reads-relayed-s3-answer` does (header-signed `fetch` with the
session token, default cache mode), against a fresh aws-emulator:

- Three runs of: `PUT /<bucket>/k` with `version-1`; 12 s later `GET /<bucket>/k` (answer `Last-Modified` 12 s
  before `Date`); `PUT /<bucket>/k` with `version-2` straight to the emulator; `GET /<bucket>/k` again, 7-8 ms later,
  with the same token. All three second reads returned `version-1`; Chrome DevTools Protocol reported each from the
  disk cache (`fromDiskCache: true`), and the engine's debug log shows one relayed `GET` per run, not two.
- With `cache: 'no-store'` on `fetch`, 300 of 300 reads of the same flow reached the engine.

## Steps to Reproduce

1. Start a fresh emulator, the engine and Studio's built app; open Studio in Chromium.
2. From Studio's origin, read an object that was written more than about ten seconds ago through an S3 client made
   by `client-factory.ts` (`GetObject`).
3. Overwrite the object straight through the emulator (AWS CLI with the emulator's key).
4. Read it again from Studio within a tenth of the object's age: the old body is returned and no request reaches the
   engine.

## Expected

- A read Studio sends through a client of `client-factory.ts`, after the object was changed by another client,
  returns what the emulator holds then, on every run.
- Every AWS request a client of `client-factory.ts` sends reaches the engine (none is answered from the browser's
  HTTP cache).

## Out of scope

- The engine's answers and their headers; whether a request without the session token is refused (issue #24).
- An object's stored `Cache-Control` metadata, which Studio shows as the emulator returns it.
