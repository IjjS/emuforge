Issue-Id: 60
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: finder
Issue-Key: studio|home|address-cut-with-five-digit-port
Issue-Check-Ids: studio.addresses-stay-whole-with-five-digit-ports studio.korean-words-stay-whole
Issue-Commit: 3fe1072bb359e60a3c71e72169eebb96dd1dc3a9

# Keep the engine and emulator addresses whole at 320 wide when the port has five digits

> Identified against commit `3fe1072bb359e60a3c71e72169eebb96dd1dc3a9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On Home at 320 wide, the address of the engine or the emulator is cut when its port has five digits:
`https://127.0.0.1:36245` is wider than its box, is clipped and ends in an ellipsis. Every local run uses a
four-digit port (8300 and 9300 upward), so the check that measures this, `studio.korean-words-stay-whole`
(issue #32; its line "no text is drawn outside its control or panel, and no label is cut"), never saw it. The
runner of issue #53's workflow picks a free port, which has five digits, and the line fails there with 38
findings.

It is a defect of the screen, not of the runner: a user may give Studio's engine or emulator a five-digit port.

Found by the first run of issue #53's workflow. The check is in `.github/not-run.json` under this issue until
fixed, although the cause is the product: it fails on every run of the runner and would hide every other
result.

## Evidence

GitHub Actions run 43861083645 (branch `feat/53-h2`, 2026-11-16), saved at
`.pm/issue-53/ci/run-43861083645-failed.log` (main checkout, local):

```
studio: failed  studio.korean-words-stay-whole (18.5s)  Error: 1 of 10 criteria lines failed:
line failed: The same pages at the same widths → no page scrolls sideways, no text is drawn outside its control or panel, and no label is cut
"ko / connected 320: \"https://127.0.0.1:36245\" is wider than its box span.st-addr (115-299 in 115-287)",
"ko / connected 320: \"https://127.0.0.1:36245\" is cut by span.st-addr",
"ko / connected 320: \"https://127.0.0.1:36245\" is cut with an ellipsis in span.st-addr",
```

## Steps to Reproduce

1. Start the engine on a five-digit port (`--port 36245`) with Studio pointed at it.
2. Open `/` at 320 wide in Korean: the address is cut with an ellipsis.

## Expected

- At 320 wide and above an address with a five-digit port is whole in every language and state: it wraps or the
  row gives it the width, and nothing scrolls sideways.
- A check opens Home with five-digit ports whatever ports the run was given, so the case is measured on every
  machine; the entry leaves `.github/not-run.json`.
- The screen keeps its critique pass.

## Out of scope

- The AWS area's emulator line (it is Cloudscape's; if it has the same defect that is its own issue).
