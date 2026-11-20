Issue-Id: 617
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|aws-area.value-text|hyphen-break
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Keep the area's free text from breaking after a hyphen while the word fits

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The area's one way of breaking a value (`studio/src/providers/aws/area/components/value-text.css`, used by every
service) says of free text that it "breaks at spaces; a word longer than its line breaks anywhere". The browser also
breaks a word after a hyphen, which the rule does not stop: the impeccable critique of issue 575 (final r4) saw
`registry-` / `1.docker.io` on ECS's task page at 1280, a word broken though it fits a line of its own. The reference
is the area's rule (`studio/AGENTS.md`, "What every AWS screen does", entry 4): a value is never broken inside while
it fits.

## Evidence
The critique's finding (final r4, on `feat/575` `c3a3d43b`; the captures are the critic's run and are not kept in the
repository):

```
- [studio/src/providers/aws/area/components/value-text.css] Area-wide: free text breaks after a hyphen while the word
  fits (`registry-` / `1.docker.io` on S5 at 1280) → the area's value part, not ECS.
```

The rule for free text at `ed00e3ee`, which leaves the break after a hyphen to the browser:

```
.aws-area-value-text {
  overflow-wrap: break-word;
}
```

## Steps to Reproduce
1. On a fresh emulator run an ECS task that stops with a reason holding a hyphenated host name (an image that cannot be pulled from `registry-1.docker.io`).
2. Open the task's page at 1280 and read the stopped reason where the line ends near the host name.

## Expected
- A word of free text that holds a hyphen and fits a line is not broken at the hyphen; it moves to the next line whole.
- A word longer than its line still breaks, and text still breaks at spaces.
- The value's text is unchanged, character for character.

## Out of scope
- Addresses, names and fixed words, which have their own rules in the same file.
