Issue-Id: 367
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|iam|access-reports
Issue-Check-Ids:
Issue-Commit: 33aff70325c3014dd960a1dbd161ad56a11d72b4

# Build the IAM "Access reports" screens: Credential report, Policy simulator, the Access Analyzer entries

> Identified against commit `33aff70325c3014dd960a1dbd161ad56a11d72b4`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's IAM navigation has a group "Access reports" (Access Analyzer, Resource analysis, Unused access, Analyzer settings, Policy simulator, Credential report); Studio has no screen for any of them. The emulator answers the credential report, the policy simulation and IAM Access Analyzer's list.

Reference: the AWS console's IAM screens for structure and vocabulary (the owner's captures under `docs/aws-console/iam/` in the main checkout, outside git, and the IAM User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the role screens of issue 82 are: `console` screens of the area, a reference spec each under `studio/references/console/iam/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses. No name of a role, user or policy of the owner's captures is written anywhere.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 82 (the full output was kept in that plan's probe logs):

```
$ aws iam generate-credential-report / get-credential-report   -> answered (200 or a 4xx of its own), none 501
$ aws iam simulate-principal-policy --policy-source-arn <role> --action-names s3:ListAllMyBuckets   -> 200 with EvaluationResults
$ aws accessanalyzer list-analyzers   -> 200
Not called: create-analyzer, list-findings.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/iam/credential-report`.
3. The page says there is no screen yet.


## Expected
- The credential report can be generated and read; the policy simulator sends a simulation to the emulator and shows its results as the emulator's; the requirement finds out by calling what the emulator's Access Analyzer creates and keeps, and its entries get screens for that.
- The policy simulator is the console's screen fed by the emulator; it is not EmuForge's own IAM simulation.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
EmuForge's own IAM simulation (a screen of Studio's own layer). Any engine change. Anything sent to real AWS.
