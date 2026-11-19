# Critique

How a Studio screen is judged. No person picks or approves a design: the screen's UI and UX are its worker's to
shape, and the impeccable critique alone judges them, once, on the built app (owner, 2026-11-18: "Ui/ux는 강제성 없이
자율성과 impeccable critique에 의존하고싶고"). There is no other score and no reference to match.

## The point

| Point | Target | When |
|---|---|---|
| `final` | each screen the issue changed, in the built app of the issue branch | once every unit is merged, each on its fast check, and before the whole check, which runs only when the last `final` has no P0 or P1 (owner, 2026-11-19) |
| `mock` | an HTML mock, only when the plan asks for one (`workflow.md`, Design) | before the build |

- Every P0 and P1 finding of `final` is fixed by the worker that owns the screen; then `crit` critiques it once
  more. A fix the whole check calls for that changes a screen has that screen alone critiqued once more. A P2 or P3 is fixed or recorded in `decisions.md` under `## Review decisions`, one reason each.
- The score (`/40`) is recorded and told in the issue's report. It decides nothing: no pass line, no comparison with
  an earlier point.
- A `mock` is critiqued the same way; what the plan takes from it is the plan's, and it holds nothing back.
- Whether a screen resembles the AWS console is not a finding either way (`aws-area.md`, "AWS screen policy"). What
  the policy requires is: an emulator line that is missing, or can be closed or hidden, is a P1; so are the console's
  descriptive or help text used as the screen's own text, a part shown that the emulator lacks, and a statement the
  engine does not know (an endpoint written as a constant, a claim about the emulator no check shows).

## Captures

Same every time, so critiques compare:

- Viewports 1280x800 and 390x844, light and dark.
- Against a seeded emulator, so tables have rows; and once against an empty emulator, for the empty states.
- From the built app, never from the dev server.
- In English, unless a language is asked for (below).

Only `crit` and `rev` look at captures, once per round.

### Captures and languages

`pm-capture` sets no locale, but its headless Chromium reports `en-US` whatever the machine's language, and it
stores nothing, so a capture is in English. A language is captured with `--storage-state FILE`, a Playwright
storage state that holds the language choice for Studio's origin, and `--name` naming the language, for example
`output/captures/lang-de.json`:

```json
{
  "cookies": [],
  "origins": [
    {
      "origin": "http://127.0.0.1:<studio port>",
      "localStorage": [{ "name": "emuforge.studio.language", "value": "de" }]
    }
  ]
}
```

- A screen of Studio's own layer is critiqued on its English captures and also on captures in German (long words)
  and in Thai (a script of its own) at 1280 and 390. A finding in them counts the same as one in English.
- A screen inside a provider area is captured in English only: the area is English in every language of Studio
  (`aws-area.md`), so another language changes only the frame around it.

## Design systems

- A screen of Studio's own layer is Studio's own design (`studio/DESIGN.md`, product context in `studio/PRODUCT.md`),
  original and not imitating any provider's console. A difference from a provider's console is not a finding.
- A screen inside a provider area is built from that provider's design system in its published patterns, and
  carries the area's frame parts (`aws-area.md`). It is new content in a familiar frame, not a new visual language.

## Records

- Scores go in through the harness script, never by hand: `pm-critique record <issue> final <snapshot>` (or `mock`)
  into the issue's `critique-scores.json`; `pm-critique check <issue>` fails while the last `final` has a P0 or P1.
- The issue's report carries the table (`pm-critique table`).
- Scores are a working measure of this project's own screens. They are never published as a measure of
  compatibility with AWS.
