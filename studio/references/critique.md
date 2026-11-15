# Critique

How Studio screens are scored and what score lets a screen through. No person picks or approves a design; the
scores and the rules below decide, and where a rule leaves room the `pm` decides and records why.

## Two scores

| Score | Measures | Applies to | How |
|---|---|---|---|
| Structure | The screen has the same parts as the provider's console screen | `console` screens | `references/console-reference.md`, computed, `/100` |
| Design health | The screen is a good screen: Nielsen heuristics | `console` and `native` screens | the `impeccable` critique, `/40` or its renormalized maximum |

Both are recorded per issue with the commit, so the points below can be compared on one scale.

## Captures

Same every time, so scores are comparable:

- Viewports 1280x800 and 390x844, light and dark.
- Against a seeded emulator, so tables have rows; and once against an empty emulator, for the empty states.
- From the built app, never from the dev server.
- In English, unless a language is asked for (below).

Only `crit` and `rev` look at captures, once per round.

### Captures and languages

`pm-capture` sets no locale, but its headless Chromium reports `en-US` whatever the machine's language, and it
stores nothing, so a capture is in English. A language is captured with
`--storage-state FILE`, a Playwright storage state that holds the language choice for Studio's origin, and `--name`
naming the language, for example `output/captures/lang-de.json`:

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

- A `native` screen of Studio's own layer is scored on its English captures, and its critique also reads captures
  in German (long words) and in Thai (a script of its own) at 1280 and 390. A finding in them counts the same as one
  in English.
- A screen inside a provider area is captured in English only: the area is English in every language of Studio
  (`studio/AGENTS.md`), so another language changes only the frame around it.

## `console` screens

There are no candidates; the reference spec is the design.

| Point | Target | When |
|---|---|---|
| `baseline` | the current screen on `main`, if it exists | before implementation |
| `final` | the implemented screen | after implementation |

A `final` passes when all of these hold:

- structure score is 90 or more, and no unmatched item is the title, the primary action or a table column, in
  every run the spec requires (seeded, and empty when the spec has empty-state items; `console-reference.md`)
- design health has no P0 or P1 finding
- design health is not more than 2 points below `baseline`, when there is a baseline

A finding that the screen would be "better" arranged differently from the provider's console is not a finding on
a `console` screen. The reference wins; the critique judges what the reference leaves open.

## `native` screens

EmuForge's own screens have no reference, so design health decides and the `pm` has the last word.

| Point | Target | When |
|---|---|---|
| `baseline` | the current screen on `main`, if it exists | before the mock |
| `mock` | an HTML mock built from the design system of the screen's layer (below) | Screen stage |
| `revised` | the mock after fixing its findings | each revision round, three at most |
| `final` | the implemented screen | after implementation |

- The mock shows the states the requirement names: at least loading, empty and error, not only the filled one.
- One mock, revised. Alternative candidates are made only when the first mock still has a P1 after three
  rounds; then the `pm` picks by score and records the pick in `decisions.md`.
- The Screen stage passes when `revised` has no P0 or P1.
- A `final` passes when it has no P0 or P1 and is not more than 2 points below `revised`.

A native screen follows the design system of the layer it is in (`studio/AGENTS.md`, "Two layers"):

- In Studio's own layer it is built from Studio's own design system (`studio/DESIGN.md`, product context in
  `studio/PRODUCT.md`), original and not imitating any provider's console. Its mock is not built from Cloudscape. A
  difference from a provider's console is not a finding; the critique judges it as Studio's own design.
- Inside a provider area (the area's index, "no screen yet", the area's "Page not found") it is built from that
  provider's design system and follows that console's conventions wherever one applies: the same layout shell, the
  same table, form and flash patterns. It is new content in a familiar frame, not a new visual language.
- A page of Studio's own layer that holds a provider area is mocked with the area as a region in the provider's
  design system, inside Studio's own frame.

## Below the pass line

One rework by the owning worker, then one more critique. If it still fails, the `pm` decides between a second
rework, splitting the failing part into its own issue, or taking the screen as it is with the reason in
`decisions.md`. A structure failure on the title, the primary action or a table column is never taken as it is.

## Records

- Scores go in through the harness scripts, never by hand: design health into the issue's `critique-scores.json`
  with `pm-critique record`, structure scores into the issue's `structure-scores.json` with
  `pm-structure --record`, one row per run.
- The issue's report carries both score tables (`pm-critique table`, `pm-structure --table`).
- Scores are a working measure of this project's own screens. They are never published as a measure of
  compatibility with AWS.
