# Critique

How a Studio screen is judged. No person picks or approves a design: the screen's UI and UX are its worker's to
shape, and the impeccable critique alone judges them, once, on the built app (owner, 2026-11-18: "Ui/ux는 강제성 없이
자율성과 impeccable critique에 의존하고싶고"). There is no other score and no reference to match.

## The point

| Point | Target | When |
|---|---|---|
| `final` | each screen the issue changed, in the built app of the issue branch | once every unit is merged, each on its fast check, and before the whole check, which runs only when the last `final` of each screen has no P0, P1 or P2 (owner, 2026-11-19 and 2026-11-20) |
| `mock` | an HTML mock, only when the plan asks for one (`workflow.md`, Design) | before the build |

- Every P0, P1 and P2 finding of `final` is fixed in the issue by the worker that owns the screen; then `crit`
  critiques it once more (owner, 2026-11-20: "크리틱 P2도 반영하자"). A fix the whole check calls for that changes a
  screen has that screen alone critiqued once more, and a P0, P1 or P2 it finds is fixed the same way.
- A P2 is left unfixed only when fixing it would change the requirement or a confirmed check, or go against a rule of
  the area or a decision already made: the plan sends it to the `pm` as a decision (`lead.md`, Critique), and only the
  `pm` lets it stand. A P0 or P1 is never left.
- A P3 is the plan's to adopt or not: fixed in the issue, filed as an issue of its own, or recorded in `decisions.md`
  under `## Review decisions` with one reason.
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
  into the issue's `critique-scores.json`. The impeccable skill's frontmatter counts P0 and P1 only, so `crit` adds
  `"p2_count":<n>` to its `IMPECCABLE_CRITIQUE_META`; `record` refuses a `final` snapshot without it.
- `pm-critique check <issue>` fails while the last `final` of any screen (each `--label`) holds a P0, P1 or P2, less
  the P2 the `pm` let stand on that `final` with `pm-critique leave`. An issue whose last `final` was recorded before
  this rule is judged on P0 and P1 until its next `final`.
- The issue's report carries the table (`pm-critique table`).
- Scores are a working measure of this project's own screens. They are never published as a measure of
  compatibility with AWS.
