Issue-Id: 637
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|kms-special-key-configurations|service-screens
Issue-Check-Ids:
Issue-Commit: e373ef54b8556fff03d08d8003d188d8dbbb7782

# Manage specialized KMS keys, imported material and regional replicas

> Identified against commit `e373ef54b8556fff03d08d8003d188d8dbbb7782`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 83 covers the ordinary single-Region symmetric key lifecycle. Developers also need to inspect and manage supported specialized key configurations, regional replicas and imported key material on the local emulator.

## Evidence

On emulator 1.0.588 (8ed8c28), CreateKey with MultiRegion enabled and ReplicateKey to us-west-2 returned 200. UpdatePrimaryRegion on the probed key returned KMSInvalidStateException. CreateKey with EXTERNAL origin and GetParametersForImport returned 200. These calls establish partial support. Material import and primary promotion need successful probes before designing their flows.

## Steps to Reproduce

Create a multi-Region key in an isolated local emulator, replicate it to another Region, and open KMS in Studio. Look for a way to inspect and manage its replica relationship.

## Expected

After issue 83, inventory the supported key specifications, origins, usages and replica operations. Provide the management tasks that work locally, with observable results checked directly against the emulator. Keep sensitive material out of browser responses.

## Out of scope

Basic key lifecycle covered by issue 83, custom key stores and application data-plane cryptography.
