Issue-Id: 17
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: owner
Issue-Key: studio|i18n|multi-language
Issue-Check-Ids:
Issue-Commit: b318cf77a386eb150667b8ef2ffda8af1a0c1ba7

# Let Studio be used in more than one language

> Identified against commit `b318cf77a386eb150667b8ef2ffda8af1a0c1ba7`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Studio can be used in one language only. Every piece of text a user reads is an English string written inline in
the component that shows it: Studio's own screens (frame, home, connection status, "no screen yet", "page not
found"), the labels handed to Cloudscape components (`ariaLabel`, `i18nStrings`), and the document itself
(`<html lang="en">`). There is no message catalogue, no notion of a current language and no way to choose one.
`studio/AGENTS.md` fixes this as a rule: "UI text is English".

The owner wants Studio to support several languages. A user picks a language (or Studio follows the browser's),
and Studio's text, dates and numbers follow it.

Which languages ship first is not decided here. It is an owner decision the `plan` asks for at the requirement
stage, together with what happens to the text of an AWS console screen: the AWS console is itself translated,
and the reference specs of `studio/references/console-reference.md` record its English labels only.

Order: after issue #16. That issue replaces Studio's frame and moves the AWS screens into a provider area, so
the text this issue moves into catalogues is written there first.

Reference: the AWS console's own language setting, for how a provider area behaves when the language changes.
Studio's own screens have no reference.

## Evidence

```
$ grep -n "lang=" studio/index.html
2:<html lang="en">
$ sed -n 71p studio/AGENTS.md
- UI text is English and follows the wording of the screen's reference spec. Do not paraphrase AWS's labels.
$ grep -rn -i -E "i18n|locale|navigator\.language" studio/src studio/package.json | grep -v i18nStrings
$ grep -rn "Intl\." studio/src
studio/src/features/home/connection-state.ts:9:const TIME = new Intl.DateTimeFormat(undefined, {
```

No localisation library is a dependency and no source file reads or stores a language. The one `Intl` use
formats a time in the browser's locale while every word around it stays English.

## Steps to Reproduce

1. Build and serve Studio (`cd studio && bun run build && bun run serve`).
2. Set the browser's preferred language to anything other than English and open `/`.
3. Every label, message and navigation entry is English, and no control changes the language.

## Expected

- Studio has a current language. It starts from the browser's preferred language when that language is
  supported, falls back to English otherwise, can be changed by the user in Studio, and the choice survives a
  reload.
- All text of Studio's own screens comes from per-language message catalogues, not from inline strings. A
  message missing in a language falls back to English and is caught by a check, not found by a user.
- The document's `lang` attribute, dates, times and numbers follow the current language.
- Inside a provider area the behaviour is the one decided at the requirement stage (translated like the
  provider's own console, or kept in the reference spec's wording), and the structure score of a `console`
  screen stays computable in every supported language.
- The languages the owner names are complete at the time this issue closes: no screen mixes two languages.
- Adding a further language is adding a catalogue, with no change to screen code.
- The guides say the same thing as the code: `studio/AGENTS.md` no longer says UI text is English only, and
  the Studio references say where text lives, how a new string is added and how captures and scores treat
  language.

## Out of scope

- Right-to-left layout, unless a language the owner names needs it.
- Translating engine and CLI output, error text that comes from the emulator, and resource names or data.
- Translating repository documents; they stay English (root `AGENTS.md`, Writing).
- Translating by machine at run time.
