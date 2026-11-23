Issue-Id: 638
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|kms-custom-key-stores|service-screens
Issue-Check-Ids:
Issue-Commit: e373ef54b8556fff03d08d8003d188d8dbbb7782

# Manage supported KMS custom key stores in Studio

> Identified against commit `e373ef54b8556fff03d08d8003d188d8dbbb7782`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Custom key stores are a separate KMS resource group from the customer-managed keys in issue 83. Determine the CloudHSM and external store workflows supported by the local emulator.

## Evidence

On emulator 1.0.588 (8ed8c28), DescribeCustomKeyStores returned 200 and an empty collection. CreateCustomKeyStore with external-store test inputs returned 400 ValidationException. No successful creation or connection was established.

## Steps to Reproduce

Open KMS in Studio on an isolated local emulator and compare its available screens with the DescribeCustomKeyStores response. There is no store inventory screen.

## Expected

After the specialized key group (#637), probe valid local fixtures for each store type and establish which list, detail, create, update, connect, disconnect and delete operations work. Show the supported resource tasks and record any limitations with evidence.

## Out of scope

Real external key proxies, real AWS infrastructure and the key lifecycle work in issues 83 and 637.
