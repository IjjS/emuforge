Issue-Id: 632
Issue-Severity: HIGH
Issue-Module: engine
Issue-Kind: bug
Issue-Source: finder
Issue-Key: engine|relay-signs-with-emulator-key|direct-refusal
Issue-Check-Ids: engine.relay-signs-with-emulator-key
Issue-Commit: 8544099f786c92303d86c2504f1b331da9b8107b

# Reconcile the relay signing check with the emulator's direct ListBuckets refusal

> Identified against commit `8544099f786c92303d86c2504f1b331da9b8107b`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The direct ListBuckets request signed with the test key receives HTTP 403 from emulator 1.0.569. Its XML error code is InvalidAccessKeyId. The scenario expects a particular English sentence and stops before evaluating the relayed ListBuckets result.

## Evidence

The main check for 8544099f7 records the failure in output/checks/2026-11-23T015520.json. See .pm/run/main-image-1.0.569.log and output/integration/logs/engine.relay-signs-with-emulator-key.log. The status assertion passed and the refusal-body assertion failed in tests/integration/engine/tests/relay_safety.rs.

The [GitHub Actions run for 54f5f5c1b](https://github.com/IjjS/emuforge/actions/runs/45045315186) covered every service with emulator 1.0.569. The local CI log is `.pm/run/ci-54f5f5c1b.log`.

## Steps to Reproduce

1. Use the local loopback emulator 1.0.569 and select engine.relay-signs-with-emulator-key with pm-check.
2. Compare the direct test-key refusal with the scenario's expected refusal, then inspect the existing relay signing checks.

## Expected

The check verifies that a direct request with the test key is rejected for its credentials, and independently verifies that the relayed request succeeds and matches the direct request signed with the emulator key. The existing credential isolation assertions still apply.

## Out of scope

SQS queue URLs, RDS inventory, and requests to real AWS.
