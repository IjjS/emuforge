Issue-Id: 461
Issue-Severity: LOW
Issue-Module: engine
Issue-Kind: gap
Issue-Source: plan
Issue-Key: engine|aws-error.head|rest-xml-refusal-carries-no-code
Issue-Check-Ids:
Issue-Commit: 5df2a35d79626da430c2392adf6d858f6c964408

# Carry the code of the engine's own refusal of an S3 HEAD request where a client can read it

> Identified against commit `5df2a35d79626da430c2392adf6d858f6c964408`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The engine answers a request it cannot relay (the emulator stopped or not answering in time) itself, in the
request's protocol, with the code `EmulatorUnavailable` or `EmulatorTimeout`. For a `HEAD` request the answer has
no body. In the JSON protocols the code is also in the header `x-amzn-errortype`, so a client still reads it. In
the S3 protocol (REST with XML bodies) the code is only in the body, so the engine's answer to `HeadBucket` or
`HeadObject` carries no code at all: the AWS SDK rejects with the name `Unknown` and status 503, and Studio
cannot tell "the emulator did not answer" from any other 503.

The reference is the same request with `GET` (`GetBucketTagging`), whose rejection carries
`Code: EmulatorUnavailable` and the engine's message. Studio's session refusal already solves the same problem for
`HEAD` with the `WWW-Authenticate` header (`studio/src/lib/aws/client-factory.ts`, `isSessionRefusal`).

## Evidence

Probe of issue 445 (`.pm/issue-445/probe/probe-2.ts`, `probe-2-emulator-stopped.log`), `@aws-sdk/client-s3`
3.1161.0 made by Studio's client factory, through the engine of `main` with the emulator's container stopped:

```
## emulator-stopped: S3Client GetBucketTaggingCommand
  < 503 "Service Unavailable"
  < content-type: application/xml
  < body: <Error><Code>EmulatorUnavailable</Code><Message>the emulator at https://127.0.0.1:9545 is not reachable (not_started): …</Message></Error>
  rejected: {"class":"S3ServiceException","name":"EmulatorUnavailable","Code":"EmulatorUnavailable","$fault":"server","status":503,…}
## emulator-stopped: S3Client HeadBucketCommand
  < 503 "Service Unavailable"
  < content-type: application/xml
  < body:
  rejected: {"class":"S3ServiceException","name":"Unknown","$fault":"server","status":503,"attempts":3,"reason":"Service Unavailable","message":"UnknownError",…}
```

`engine/crates/emuforge-server/src/aws_error.rs`, `render`: `Protocol::RestXml` sets no `x-amzn-errortype`
(the unit case `render_rest_xml_is_an_escaped_s3_error` asserts its absence), and a head-only answer has an empty
body.

## Steps to Reproduce

1. Start the engine with `--emulator-port` of a port where no emulator runs.
2. Send `HeadBucket` for any bucket through the engine with an AWS SDK S3 client configured as Studio's.
3. The rejection's name is `Unknown`; nothing in the answer says `EmulatorUnavailable`.

## Expected

- The engine's own refusal of an S3 `HEAD` request carries its code where a client can read it without a body
  (a header), for `EmulatorUnavailable` and `EmulatorTimeout`.
- Studio's shared mapping of a failed request (issue 445) reads it, so a `HEAD` request to a stopped emulator is
  "the emulator did not answer".

## Out of scope

- The emulator's own `HEAD` answers, which the engine relays unchanged.
- The session refusal, which already has its header.
