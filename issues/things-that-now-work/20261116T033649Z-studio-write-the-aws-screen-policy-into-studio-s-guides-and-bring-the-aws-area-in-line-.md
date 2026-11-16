Issue-Id: 45
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|aws-area|screen-policy
Issue-Check-Ids: studio.aws-area-breadcrumbs-start-at-emuforge studio.aws-area-emulator-line-shows-connected-endpoint studio.aws-area-emulator-line-follows-emulator-stop-and-start studio.aws-area-emulator-line-shows-engine-unreachable studio.aws-area-emulator-line-keyboard-and-layout
Issue-Commit: f91e23282a1e0377835ed9b76e716013d162b259

# Write the AWS screen policy into Studio's guides and bring the AWS area in line with it

> Identified against commit `f91e23282a1e0377835ed9b76e716013d162b259`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio's guides tell an AWS screen to look like the AWS console (`studio/AGENTS.md`: the AWS area "looks like
the AWS console"), and a `console` screen is scored on having every part of the console's screen. The owner has
decided that an AWS screen must not be a copy of the console: it keeps the console's information structure and
flow, built from Cloudscape (Apache 2.0) and Cloudscape's published patterns, and differs in what it shows and
says. The reason is AWS's trademark guidelines on imitating the look and feel of its sites, and honesty: a copy
shows panels, tabs and navigation for things a local emulator does not have.

The owner decided this on a sample of one screen, the S3 bucket list, made three ways and scored by `crit`
(reviews kept outside git at `.initial-refs/policy/aws-screen-sample-review-r1.md` and `-r2.md` in the main
checkout; the sample's sources at `.pm/policy-sample/` there):

| Sample | Design health | Same as the console, of 55 items |
|---|---|---|
| A, the console mirrored part for part (today's rule) | 22/40 | 52 |
| B draft, labels and controls renamed too | 25/40 | 11 |
| B, the policy below (the owner's choice) | 27/40 | 26 |

The policy, as the owner set it:

1. An AWS screen follows the console's information structure and flow.
2. Control labels, column names, action names and their arrangement follow the console word for word: they are
   the service's vocabulary.
3. Descriptions, help, and empty, loading and error states are EmuForge's own words. They say that this is a
   local emulator and not AWS, with the endpoint that is really connected, in a place that cannot be dismissed,
   and they say only what the engine knows.
4. A part (panel, tab, navigation entry, badge) is on a screen only if the emulator really has it.
5. Cloudscape and its default theme are used; layout follows Cloudscape's published patterns, the one that
   keeps the console's flow. EmuForge's own states use Cloudscape's patterns too (Flashbar for an action's
   result, an error status with a retry for a failed load).
6. Breadcrumbs in the AWS area start at EmuForge: `EmuForge > AWS > S3 > ...`.
7. No AWS logo and no AWS service icon. Service and resource names are written as text.
8. The README says EmuForge is independent of AWS: not affiliated with, endorsed by or sponsored by it.
9. Captures of the real console are reference for structure only. They stay under `docs/aws-console/`, which is
   not in git; nothing of them (markup, styles, scripts, images) is copied into the repository.
10. Studio's own layer keeps its own design tokens and components, shaped by the critique (as today).

Open points the plan puts to the owner at the requirement stage, each with a recommendation:

- An action the emulator answers 501 for: keep the console's action and report the 501 (recommended; BRD
  principle 4), or hide it. Point 4 would then remove parts, never an action on a resource the emulator has.
- Resource icons (a bucket, a table): the owner asked whether they may be used. AWS's own icon sets are AWS's
  artwork under AWS's terms, which nobody here has verified for use inside another product's interface; the
  recommendation is Cloudscape's own icons or none.
- The exact text of the first two crumbs and whether the frame's provider tab changes with them.

Order: before the first AWS service screen. Issue #46 (the structure score) goes with it.

Reference: for structure, the console (the owner's captures and the AWS user guide); for everything else, none.

## Evidence

```
$ sed -n 10p studio/AGENTS.md
looks and behaves like that provider's console: the AWS area, at `/aws`, looks like the AWS console where an AWS
$ grep -n "AWS_NAME\|AWS_SHORT_NAME" studio/src/providers/aws/identity.ts
4:export const AWS_NAME = 'Amazon Web Services';
7:export const AWS_SHORT_NAME = 'AWS';
$ sed -n 5p README.md
calls one that is already running. It is not an AWS project.
```

The area's breadcrumb root is "Amazon Web Services" today, and the README's statement of independence is one
clause.

## Steps to Reproduce

1. Read `studio/AGENTS.md`, `studio/references/critique.md` and `console-reference.md`: an AWS screen is to
   mirror the console and is scored on the console's parts; nothing says what must differ.
2. Open `/aws/s3` in Studio: the breadcrumbs start at "Amazon Web Services".

## Expected

- `studio/AGENTS.md`, `studio/references/workflow.md`, `critique.md`, `console-reference.md` and
  `studio/PRODUCT.md` state the policy above and no longer ask an AWS screen to look like the console. They say
  which words follow the console and which are EmuForge's, how a part the emulator lacks is left out, how the
  connected endpoint is shown, and how the real console's captures may be used.
- The AWS area as built follows it: breadcrumbs start `EmuForge > AWS > ...` on every area page, the area shows
  the connected emulator's endpoint where every screen can carry it, and the area's index, "no screen yet" and
  "Page not found" pages use EmuForge's own wording.
- `README.md` carries the statement of independence and the trademark line.
- The existing checks keep passing, rewritten by a recorded decision where a crumb or a sentence they name
  changes; flow checks cover the crumbs and the endpoint line.
- The AWS area's pages keep their critique pass.

## Out of scope

- Any AWS service screen; the first one (S3 buckets) is its own issue and is built to this policy.
- The structure score tool: issue #46.
- Legal advice; the policy is the owner's decision.
