Issue-Id: 2
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: feature
Issue-Source: owner
Issue-Key: engine|relay|missing
Issue-Check-Ids:
Issue-Commit: e55940995ba32d732a9dbc77a3796d54bd3a1ef7

# Relay AWS requests to the emulator with re-signing

> Identified against commit `e55940995ba32d732a9dbc77a3796d54bd3a1ef7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The engine must behave as an AWS endpoint: a client signs a request for the engine, the engine forwards it to the
emulator signed with the emulator's own key, and the client gets back what the emulator answered. Nothing of this
exists. Studio and the CLI both depend on it, and so does every later IAM decision, because the engine is where a
request can be allowed or denied before it reaches the emulator.

Reference behavior: the same request sent straight to aws-emulator with the emulator's key. The measure is
`engine/references/relay-fidelity.md`: for paired requests, direct and through the engine, status, headers that
matter and body are the same.

Known facts about the emulator that the relay has to live with (found by calling it, v1.0.364):

- one HTTPS endpoint for all services, SigV4 required, account `000000000000`;
- an unimplemented operation answers `501` with `NotImplemented`; that answer must reach the client unchanged;
- some responses carry AWS host names, for example SQS returns `QueueUrl` as
  `https://sqs.us-east-1.amazonaws.com/000000000000/<name>`. A client that follows such a URL must still end up
  at the engine and never at AWS.

## Evidence

```
$ ls engine
AGENTS.md  CLAUDE.md  README.md  references
```

No engine binary exists, so there is nothing to send a request through. Direct calls with the emulator's key
succeed today (S3, DynamoDB, SQS, IAM and CloudFormation were exercised by hand on 2026-11-14 against v1.0.364).

## Steps to Reproduce

1. Start the emulator and the engine (issue #1).
2. Point an AWS SDK or the AWS CLI at the engine's address and list S3 buckets.
3. The engine has no route that accepts the request.

## Expected

- A signed AWS request sent to the engine returns the status, the headers that matter and the body the emulator
  returns for the same request sent directly; covered for at least one service of each wire protocol the emulator
  speaks (REST-XML, JSON, query, REST-JSON) and for a streamed S3 object upload and download.
- The emulator's `501 NotImplemented` and its service errors reach the client unchanged.
- The request that reaches the emulator is signed with the emulator's key; the client never needs that key and
  never receives it.
- When the emulator is unreachable the client gets a clear error from the engine, not a hang.
- No request leaves loopback: with the engine as endpoint, nothing connects to an `amazonaws.com` host, including
  after a response that contains such a host name.
- The relay fidelity figure is produced by the checks and recorded; later units may not lower it.
- Every row of `engine/references/security-review.md` that the relay touches is kept.

## Out of scope

- How the engine identifies the caller and any allow or deny decision (IAM issues, later).
- The CLI wrapper and the downloaded AWS CLI.
- Rewriting response bodies beyond what a recorded decision requires.
- Operations the emulator itself does not implement.
