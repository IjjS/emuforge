Issue-Id: 494
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|home-providers-section|stale-count-text
Issue-Check-Ids: studio.home-providers-line-counts-services-with-a-screen
Issue-Commit: 7cb0b1cddc40e1c3903deb81e6513f9e6bc57dc8

# Make Home's providers section count the services that have a Studio screen

> Identified against commit `7cb0b1cddc40e1c3903deb81e6513f9e6bc57dc8`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Home's "Providers" section says, under the AWS provider, "19 services · no Studio screen yet", while several of those
services already have Studio screens (S3's bucket list at `/aws/s3/buckets`, IAM roles, Lambda functions, SQS). The
text counts every service of the provider and states that none has a screen, which is no longer true. Found by the
impeccable critique of issue 486 on the built app (`.pm/issue-486/review-final.md`, P2); it predates issue 486.

## Evidence

- `studio/src/i18n/messages/en.json`, `providers.services`: `"{count} services · no Studio screen yet"` (and the same
  claim in the other eleven catalogues).
- `studio/src/features/home/providers-section.tsx`, `ProviderEntry`: `plural('providers.services',
  provider.services.length)`, the number of every service in the list, with no regard to which have screens.
- Capture of `/` in `emuforge-486/output/captures/final-seeded/` (crit, issue 486): "19 services · no Studio screen
  yet" above a list whose S3 entry links to a working bucket list.

## Steps to Reproduce

1. Start Studio and the engine in front of a running emulator.
2. Open `/` and read the AWS entry of "Providers".
3. Follow its S3 link: the bucket list opens, although the entry said no service has a Studio screen.

## Expected

The entry's line tells the truth about the provider's services: how many there are and how many have a Studio screen
(or no claim about screens at all), in every language.

## Out of scope

The services' own screens and the providers list itself; Home's connection status (issue 486).
