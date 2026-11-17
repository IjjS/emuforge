Issue-Id: 460
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: plan
Issue-Key: engine|aws-error.protocol|route53-refusal-in-json
Issue-Check-Ids:
Issue-Commit: 5df2a35d79626da430c2392adf6d858f6c964408

# Answer the engine's own refusal of a Route 53 request in XML, so the SDK can read its code

> Identified against commit `5df2a35d79626da430c2392adf6d858f6c964408`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The engine answers a request it cannot relay itself, in the request's protocol, so that an AWS SDK client reads
the engine's code (`EmulatorUnavailable`, `EmulatorTimeout`, and its other refusals). It decides the protocol in
`Protocol::detect` (`engine/crates/emuforge-server/src/aws_error.rs`): `x-amz-target` is JSON, a credential scope
of the service `s3` is REST with XML bodies, a form `POST` or an `Action` parameter is the query protocol, and
everything else is REST with JSON bodies.

Route 53 is REST with XML bodies and its credential scope is `route53`, so the engine answers a Route 53 request
in JSON. The AWS SDK's Route 53 client parses an error answer as XML and fails on it: the rejection is a plain
`Error` named `Error`, with the message "@aws-sdk XML parse error: unexpected content. …" and no code. Studio
cannot show "the emulator did not answer" on a Route 53 screen (issue 71's hosted zones), and the SDK's own retry
of a 503 does not apply either.

The reference is the same engine's answer to an S3 request, which the S3 client reads
(`Code: EmulatorUnavailable`). CloudFront is REST with XML bodies as well; Studio has no client for it today.

## Evidence

Probe of issue 445 (`.pm/issue-445/probe/probe-2.ts`, `probe-2-emulator-stopped.log`), `@aws-sdk/client-route-53`
3.1161.0 made by Studio's client factory, through the engine of `main` with the emulator's container stopped:

```
## emulator-stopped: Route53Client GetHostedZoneCommand
  > GET /2013-04-01/hostedzone/Z445MISSING
  < 503 "Service Unavailable"
  < content-type: application/json
  < x-amzn-errortype: EmulatorUnavailable
  < body: {"__type":"EmulatorUnavailable","message":"the emulator at https://127.0.0.1:9545 is not reachable (not_started): …"}
  rejected: {"class":"Error","name":"Error","status":503,"attempts":3,"reason":"Service Unavailable","message":"@aws-sdk XML parse error: unexpected content.\n  Deserialization error: to see the raw response, inspect the hidden field {error}.$response on this object.","keys":["$metadata"]}
```

With the emulator running, the emulator's own Route 53 refusal is XML and is read (`probe-2-running.log`:
`<ErrorResponse …><Error><Type>Sender</Type><Code>NoSuchHostedZone</Code>…`, rejected with
`Code: NoSuchHostedZone`). The other 25 requests of the probe, of nineteen more clients, were each rejected with
the engine's code.

## Steps to Reproduce

1. Start the engine with `--emulator-port` of a port where no emulator runs.
2. Send `GetHostedZone` (or `ListHostedZones`) through the engine with an AWS SDK Route 53 client configured as
   Studio's.
3. The answer is `application/json`; the rejection is an XML parse error without a code.

## Expected

- The engine's own refusal of a Route 53 request is XML in the shape the Route 53 protocol uses for an error, and
  an AWS SDK Route 53 client rejects with the engine's code and message.
- The same holds for every service Studio has a client for whose protocol is REST with XML bodies.

## Out of scope

- The emulator's own answers, which the engine relays unchanged.
- Studio's mapping of an answer it cannot read (issue 445 shows it as its status line).
