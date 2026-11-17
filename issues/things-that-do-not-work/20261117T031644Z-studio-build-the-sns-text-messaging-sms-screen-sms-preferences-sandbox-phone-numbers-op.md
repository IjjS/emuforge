Issue-Id: 384
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns|text-messaging-sms
Issue-Check-Ids:
Issue-Commit: 0f126ade4b492e21e67ee63033c46bdaed352679

# Build the SNS "Text messaging (SMS)" screen: SMS preferences, sandbox phone numbers, opted-out numbers

> Identified against commit `0f126ade4b492e21e67ee63033c46bdaed352679`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's navigation group "Mobile" has the entry "Text messaging (SMS)" (capture `06-text-messaging-sms`); Studio has no screen for it. The emulator answers the SMS operations, except that publishing to a phone number answers 501.

Reference: the AWS console's Amazon SNS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sns/` in the main checkout, outside git, and the Amazon SNS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the topic screens of issue 78 are: `console` screens of the area, a reference spec each under `studio/references/console/sns/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 78 (the full output was kept in that plan's probe logs):

```
$ aws sns get-sms-attributes / set-sms-attributes   -> 200
$ aws sns get-sms-sandbox-account-status   -> 200
$ aws sns create-sms-sandbox-phone-number / list-sms-sandbox-phone-numbers / delete-sms-sandbox-phone-number   -> 200
$ aws sns list-phone-numbers-opted-out / check-if-phone-number-is-opted-out   -> 200
$ aws sns list-origination-numbers   -> 200
$ aws sns publish --phone-number +1...   -> 501 NotImplemented, "operation Publish to a PhoneNumber is scaffolded but not implemented in this emulator"
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/sns/mobile/text-messaging`.
3. The page says there is no screen yet.

## Expected
- The screen shows the emulator's SMS preferences, the sandbox's phone numbers and the opted-out numbers, and each can be changed where the emulator answers.
- "Publish text message" stays on the screen and reports "Not implemented by the emulator" for as long as the emulator answers 501.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Origination numbers bought from AWS, which the emulator has no resource for unless the requirement's calls show one. Any engine change. Anything sent to real AWS.
