# Languages of Studio's own layer

Read this when a unit adds or changes a text of Studio's own layer, or a language. The rules of the layer itself are
in `own-layer.md`.

Studio's own layer is shown in one current language at a time; the AWS area is English in every language. The
languages are the catalogue files in `i18n/messages/`, today twelve: `en` (the source and the fallback), `ko`, `ja`,
`es`, `pt-BR`, `fr`, `de`, `ru`, `it`, `pl`, `vi`, `th`. Every page is left to right; `dir` is never set.

## Where text lives

- Every text a user reads or hears in Studio's own layer comes from a catalogue, never from a string written in a
  component: visible text, the document title, the skip link, `aria-label`s and other accessible names,
  screen-reader-only text, live-region announcements, the names of commands and command groups. A component reads
  it with `useLanguage()` (`i18n/language-context.ts`): `t(key, values)` for a message, `plural(key, count, values)`
  for a counted one.
- No file under `app/`, `ui/` or `features/` holds a language tag other than `lang="en"`; `bun run test:unit` fails
  on one. What depends on a language is in `i18n/` or in CSS by `:lang()`.
- A catalogue is `i18n/messages/<tag>.json`, named by the language's BCP 47 tag: a flat JSON object from message key
  to text, or, for a counted message, to an object from plural category to text. Keys name the part of the screen
  they belong to (`connection.title`, `notice.startStep`). Two reserved entries sit beside the messages: `@name`,
  the language's own name ("Deutsch"), and `@sameAsEnglish`, the keys whose text is intentionally the same as
  English. A message key never starts with `@`.
- English (`en.json`) is the source: its keys are the full set. At run time a message missing from the current
  catalogue shows the English text; the catalogue check keeps that from happening on `main`.
- The catalogues are bundled (`i18n/bundled.ts`, every file imported eagerly), so the first render and a change of
  language need no request. Nothing else lists the languages.

## Adding a string

- A new text is a key in `en.json`, with the requirement's English wording, and the same key in every other
  catalogue, in the same unit. A text is never left in English in another catalogue to be translated later.
- Each catalogue keeps one register throughout, the polite one of software interfaces in that language (German
  "Sie", French "vous", Korean 합니다체, Japanese です・ます), and one term per concept. The shared terms are fixed in
  `i18n/glossary.json`: per English term ("engine", "emulator", "Refresh", "Home", "Studio", "command", "port") its
  English `forms`, the message keys where it is `exempt`, and per language the `stems` every inflected form of it
  holds. A text that contains a glossary term uses that language's stem. A new shared term adds an entry with a stem
  for every language. `rev` reviews the register in its review of the whole.
- A text that is correctly the same as English in a language (a word the language borrows) is listed in that
  catalogue's `@sameAsEnglish`; that list is the only exemption.
- `bun run test:unit` runs the catalogue check (`i18n/catalogue-check.ts`) on every catalogue and fails, naming the
  catalogue and the key, on a key of English the catalogue lacks, a key English lacks, a placeholder dropped or
  renamed, a plural category the language needs and lacks, a text equal to English that `@sameAsEnglish` does not
  list, a glossary term without its stem, and a form of a counted message in which an ordinary space (U+0020)
  directly follows `{count}` ("Placeholders and plurals").

## Adding a language

- A language whose script already has a face (`DESIGN.md`, Typography) is one catalogue file
  `i18n/messages/<tag>.json`, with every key of English and its `@name`, and its stem in every term of
  `glossary.json`. It changes no screen code; the language control offers it from the file.
- A language in a script without a face also adds that script's face (`ui/fonts/`, its rule in `ui/fonts.css`, the
  font stack in `ui/tokens.css`) and its entry in `DESIGN.md`, Typography. A right-to-left language is not added
  without an issue of its own: Studio has no right-to-left layout.
- Removing a language is removing its file and its glossary stems.

## Placeholders and plurals

- A sentence that holds a value or an element (an origin, a port, a path, inline code, a count) is one message with
  a named placeholder, `{name}`, so each language places the value where its grammar needs it. A sentence is never
  assembled from separately translated pieces, and punctuation between a value and a text is part of the message
  (`"{code}: {message}"`).
- A placeholder's value is text or a React element (`InlineCode`, the engine's text), inserted as it is; never HTML.
- A counted message gives a form for every plural category its language has in `Intl.PluralRules`: English and
  German `one`, `other`; French, Spanish, Italian and Portuguese `one`, `many`, `other`; Russian and Polish `one`,
  `few`, `many`, `other`; Korean, Japanese, Vietnamese and Thai `other` only. `plural()` picks the form and fills
  `{count}` with the count formatted in that language. A category the browser asks for that the catalogue lacks
  shows that language's `other` form, never English.
- In every form of a counted message, a space between `{count}` and its unit is U+00A0 NO-BREAK SPACE, so a line
  never parts the count from its unit (`"{count}\u00a0seconds"`); a language with no space there (Korean) keeps none.
  In the `many` forms of Spanish, French, Italian and Portuguese ("{count} de segundos") the space after "de" or "di"
  is U+00A0 as well. A catalogue spells it as the escape `\u00a0`, never the character itself, so it shows in the
  file and in a diff; an editor or a heredoc may turn a typed escape into the character, so read the file back after
  editing it.

## Dates and numbers

- Times, counts and durations of Studio's own layer are formatted in the current language through `i18n/format.ts`
  (the language's `formatTime` and `formatNumber`): a time of day with `Intl.DateTimeFormat`, hours 00 to 23, hour,
  minute and second; a count or a duration with `Intl.NumberFormat`. A formatted value changes with the language,
  not only when it is next computed.
- Ports, addresses, paths and HTTP status codes are literal text, put into a message as the text they are, never
  through `formatNumber`: port 9297 is "9297" in German, never "9.297".

## What is not translated

The same in every language, put into a message as a placeholder's value or shown beside it, never in a catalogue as
text to translate:

- the names "EmuForge" and "EmuForge Studio" (the wordmark and the document title's suffix), a provider's names
  ("Amazon Web Services", "AWS") and its service labels on Home (`providers/aws/services.ts`);
- commands, addresses, origins, ports, paths, container names, HTTP status codes and the engine's error codes;
- the engine's `message`, shown as it came, in an element with `lang="en"`;
- an area page's title where Studio's own layer shows or announces it, in an element with `lang="en"`; on a page of
  the area the document title stays `<area page title> | EmuForge Studio`, in English;
- a language's own name, the same in every language, in an element with that language's `lang`.

The engine's and the emulator's codes, reasons and messages do not depend on the browser's language; Studio maps a
`code` or a `reason` to its own words from the catalogues and shows a `message` as it came.

## `lang` attributes

- `<html lang>` is the current language's tag. `main.tsx` resolves the current language and sets it before the first
  render, so nothing is ever shown in English first; `LanguageProvider` keeps it in step after each change.
  `index.html` keeps `<html lang="en">` and the title "EmuForge Studio", which hold only until that first render.
- Text in another language than the page carries its own `lang`: the engine's message and an area page title
  `lang="en"`, a language's own name `lang="<tag>"`. The AWS area's root carries `lang="en"`.
- An element with its own `lang` is drawn in its own language's face and gets `hyphens: manual`, so it is never
  hyphenated by the page's rules.

## The current language and its storage

- Resolved once, at start (`i18n/language.ts`): a stored choice, else the first of the browser's preferred languages
  (`navigator.languages`, or `navigator.language` when that list is empty) that equals a catalogue's tag ignoring
  case or has its primary subtag (`de-AT` → `de`, `pt-PT` → `pt-BR`, `es-419` → `es`), else English. A change of the
  browser's languages, or a choice made in another tab, applies at the next load.
- A choice is stored in `localStorage` under the key `emuforge.studio.language`, its value the language's tag.
  "Browser language" removes the key; a stored value that is not a catalogue's tag is ignored and removed. When
  storage is blocked the choice still applies to the open page and nothing shows an error. That key is the only
  thing Studio stores.
- A change of language re-renders Studio's own layer in place, in one step: same path, no reload, no request to the
  engine, focus, scroll position and what is open kept. The AWS area is not re-rendered from scratch.

## Faces and layout in every language

- Faces per script are recorded in `DESIGN.md`, Typography: Latin runs in Instrument Sans in every language, each
  other script's runs in the face recorded for it, Vietnamese wholly in its own face, the wordmark in Instrument Sans,
  the code face unchanged. A system face is used only where the check environment draws every character of the
  language's catalogue with it; any other face is served from the app's own origin.
- The font stack is the `--st-font-ui` token, set per language with `:lang()` in `ui/tokens.css`. Every inherited
  text property that depends on a language (font stack, hyphenation, wrapping, line height, letter spacing) is set
  on `.st-bar` and `.st-main` or inside them, per language as `.st-main:lang(th)` or through a
  `--st-*` token read there; never on `html`, `body`, Studio's root or the area's holder (`own-layer.md`, "No leak either way"). A
  `--st-*` token on `:root` is a custom property, not such a property.
- Every text of Studio's own layer hyphenates where its language allows or breaks inside its box (`hyphens: auto`,
  `overflow-wrap: break-word`); commands keep their unbroken lines. Thai, Korean and Japanese text has no negative
  letter spacing.
- Korean text breaks a line only at white space, never inside a word: `word-break: keep-all` by `:lang(ko)` on
  `.st-bar` and `.st-main` or inside them (a Korean bar or page, and an element with `lang="ko"` on a page in another
  language), and `word-break: normal` on an element inside them whose `lang` is another language. The long-word
  guard still breaks a Korean word wider than its box. Korean text of the page has `text-wrap: pretty`, and a
  notice's heading in Korean `text-wrap: balance`.
- At 390 wide the top bar shows the wordmark, every navigation link and the language control (the globe alone at
  480 and below). Whether a page holds in a language (long German words, Thai) is for the critique, which reads
  German and Thai captures of a screen of this layer (`critique.md`).
