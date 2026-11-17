Issue-Id: 467
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: gap
Issue-Source: finder
Issue-Key: studio|aws-area|critique-repeats
Issue-Check-Ids:
Issue-Commit: da8a77f737cfd63121821cc5e1f63d0e962b2152

# Settle in the guide what four critiques of AWS screens repeat, and correct S3, Lambda and IAM to it

> Identified against commit `da8a77f737cfd63121821cc5e1f63d0e962b2152`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Four final critiques of AWS screens passed between 25 and 28 of 40 with no P0 or P1 (issue 56, the S3 bucket
list, 28; issue 84, Lambda, 28; issue 82, IAM, 25; issue 256, the S3 bucket's screens, 26), and from the
second on they repeat the same findings. The fourth compared them itself (`review-final.md` of issue 256,
"Earlier findings these screens repeat"). They come from the area's pattern and the guide, not from one
screen, so every later service would repeat them (the owner decided that every service the emulator supports
gets its screens).

What repeats:

1. "Local, not in an AWS account" is said three times above a page's content (the emulator line, the notice,
   the page's or step's description); a list also states its endpoint again. At 390 wide the content starts
   below the first screen (Lambda's first row at y 770 of 844).
2. A name's rules (length, alphabet) show only after a failed submit; no constraint text from the start.
3. Nothing copies an ARN, a URL or a key id.
4. A long word is broken anywhere (`overflow-wrap: anywhere`, introduced on 2026-11-17 against cells that pushed
   the page sideways): names and ARNs break at arbitrary characters, in every table cell on the bucket's page.
   The overflow must stay solved; how a value breaks (an ARN at its colons and slashes, a name whole where it
   fits) is the question.
5. "Cancel" of a create form or wizard leaves at once and loses what was entered.

A sixth, the "no screen yet" page saying a service has no screen under a service that has screens, is issue 57
and not part of this.

For each: decide the rule from the AWS screen policy (`studio/AGENTS.md`: the console's structure and
vocabulary, EmuForge's own sentences, always saying it is the local emulator) and write it into the guide where
a screen issue's plan reads it; then correct the screens on `main` (S3 list and bucket screens, Lambda, IAM)
and their reference specs and checks where they pin what changes. The policy's "always says it is the local
emulator" stands: the question of 1 is how often and where, not whether.

## Evidence

`.pm/archive/critique-snapshots/` in the main checkout: `84-final.md`, `84-review-final.md`, `82-final.md`,
`82-review-final.md`, `256-final.md`, `256-review-final.md` (the last holds the comparison). Issue 56's
critique text was not kept; its score is in `.pm/archive/56/`.

## Steps to Reproduce

1. Open `/aws/lambda`, `/aws/iam` or `/aws/s3` at 390 wide: three statements of the local emulator before the
   first row.
2. Open a create form: no rule under the name until a submit fails.

## Expected

- The guide states a rule for each of the five, with its reason, and a screen issue's plan is pointed at them.
- The screens on `main` follow them; their structure scores do not fall, and their critique no longer lists
  these findings.
- No screen stops saying that it shows the local emulator.

## Out of scope

- Issue 57 (the "no screen yet" page).
- New screens.
