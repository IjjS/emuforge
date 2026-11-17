Issue-Id: 416
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|rds|captures-pending
Issue-Check-Ids:
Issue-Commit: 39a97fc6be2d56e35e8a9e37f248a6511d210a29

# Replace the provisional parts of the database screens once captures of them exist

> Identified against commit `39a97fc6be2d56e35e8a9e37f248a6511d210a29`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Three parts of the database screens of issue 245 were written without a capture of the console, from the user guide and the API's model, and are marked provisional in `studio/references/console/rds/` and its plan: a DB instance's page (the title "Summary" and its fields, the section title "Connectivity & security", the labels "Endpoint" and "Port", the order of the tabs, the header's "Refresh" and the missing "Actions"), the create form (the sections of "DB instance class" and "Allocated storage", the heading's place, "Credential Settings"), and the delete dialog (its title and the confirmation field's label). The list's "Actions" and "Create database" menus are closed in the one capture, `docs/aws-console/rds/03-databases`.

Reference: the AWS console's Aurora and RDS screens for structure and vocabulary (the owner's captures under `docs/aws-console/rds/` in the main checkout, outside git, and the Amazon RDS User Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the database screens of issue 245 are: `console` screens of the area, a reference spec each under `studio/references/console/rds/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 245 (the full output was kept in that plan's probe logs; `ok` is the AWS CLI's exit 0, an error is named by its code):

```
$ ls docs/aws-console/rds/   -> 00-landing … 19-certificate-update, one capture per navigation entry; none of a DB instance's page, of "Create database", of the delete dialog or of an open menu
The plan of issue 245 (`decisions-needed.md`, questions 3 to 5 and 8 to 10) lists each provisional item with the source it was written from.
```

## Steps to Reproduce
1. Open `docs/aws-console/rds/` in the main checkout.
2. No capture shows a DB instance's page, the create form, the delete dialog, or the list with "Actions" or "Create database" open.

## Expected
- Once the owner adds those captures, each provisional item of the three specs is checked against them and the `pm` changes the specs where they differ; the screens follow and their structure scores pass against the changed specs.
- "Create database" becomes the console's menu if the capture shows entries the emulator can serve.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Anything the captures show that another issue of this service builds. Any engine change. Anything sent to real AWS.
