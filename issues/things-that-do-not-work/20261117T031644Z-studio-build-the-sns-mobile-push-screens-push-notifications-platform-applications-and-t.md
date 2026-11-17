Issue-Id: 383
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|sns|mobile-push
Issue-Check-Ids:
Issue-Commit: 0f126ade4b492e21e67ee63033c46bdaed352679

# Build the SNS mobile push screens: "Push notifications", platform applications and their endpoints

> Identified against commit `0f126ade4b492e21e67ee63033c46bdaed352679`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The console's navigation group "Mobile" has the entry "Push notifications" (capture `05-push-notifications`); Studio has no screen for it. The emulator answers the platform application operations, but the probe could not create one: it refused the made-up credentials. This issue's requirement first finds out by calling whether the emulator can hold a platform application at all.

Reference: the AWS console's Amazon SNS screens for structure and vocabulary (the owner's captures under `docs/aws-console/sns/` in the main checkout, outside git, and the Amazon SNS Developer Guide). Built to the AWS screen policy (`studio/AGENTS.md`) the way the topic screens of issue 78 are: `console` screens of the area, a reference spec each under `studio/references/console/sns/`, calls through the engine, the states the policy names. Before anything is designed, the requirement calls the emulator again for every operation it uses.

## Evidence
Called on aws-emulator 1.0.481 (release 2026.11.16), started with `infra/aws-emulator/docker-compose.yml`, signed with the emulator's own files, while planning issue 78 (the full output was kept in that plan's probe logs):

```
$ aws sns list-platform-applications   -> 200, empty
$ aws sns create-platform-application --name a --platform GCM --attributes PlatformCredential=<made up>   -> 400, "Platform credentials are invalid"
$ aws sns list-endpoints-by-platform-application / create-platform-endpoint / get-platform-application-attributes   -> answered with a 4xx of their own for an application that does not exist, none 501
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator.
2. Open `/aws/sns/mobile/push-notifications`.
3. The page says there is no screen yet.

## Expected
- The requirement states which platform application the emulator accepts, by calling it. If it can hold one: the list, an application's page with its endpoints, create, edit and delete exist. If it cannot: the part is recorded as left out with the calls that show it, and nothing is built.
- Resources made outside Studio appear; every read goes to the emulator through the engine, never a browser cache.
- Loading, empty, the emulator not reachable and an operation answered 501 each have their own state in EmuForge's own words.
- Each screen's structure score against its reference spec and its critique pass (`studio/references/critique.md`).

## Out of scope
Sending a push notification to a device. Any engine change. Anything sent to real AWS.
