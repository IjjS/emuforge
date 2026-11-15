// The catalogue check (requirement R4.7, R1.4), run by `bun run test:unit`: what makes a catalogue incomplete or
// inconsistent with English, the source. Each problem is one line that names the catalogue's tag and the key.

import {
  placeholdersOf,
  textsOf,
  withoutPlaceholders,
  NAME_ENTRY,
  PLURAL_CATEGORIES,
  SAME_AS_ENGLISH_ENTRY,
  type Catalogue,
  type Message,
} from './catalogue';
import glossaryFile from './glossary.json';

/** One shared term of the glossary (R1.4): its English forms and, per language, the stem every form of it holds. */
export interface GlossaryTerm {
  /** The term as the glossary names it ("command"). */
  readonly term: string;
  /** Its English forms; any of them is found ("command", "commands"). */
  readonly forms: readonly string[];
  /** Message keys whose correct translation does not use the term; the only other exemption. */
  readonly exempt: readonly string[];
  /** The stem each language uses, by tag (Russian `движ` for "engine"). */
  readonly stems: ReadonlyMap<string, string>;
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The glossary from the parsed JSON of `glossary.json`: `{ term: { forms, exempt, stems: { tag: stem } } }`. */
export function parseGlossary(json: unknown): GlossaryTerm[] {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('The glossary is a JSON object from term to its entry.');
  }
  return Object.entries(json).map(([term, entry]: [string, unknown]) => {
    const { forms, exempt = [], stems = {} } = (entry ?? {}) as Record<string, unknown>;
    if (!isStrings(forms) || forms.length === 0 || !isStrings(exempt)) {
      throw new Error(`Glossary "${term}": "forms" lists its English forms and "exempt" lists message keys.`);
    }
    if (typeof stems !== 'object' || stems === null || Array.isArray(stems)) {
      throw new Error(`Glossary "${term}": "stems" is an object from language tag to stem.`);
    }
    const byTag = new Map<string, string>();
    for (const [tag, stem] of Object.entries(stems)) {
      if (typeof stem !== 'string' || stem === '') {
        throw new Error(`Glossary "${term}": the stem for ${tag} is a non-empty text.`);
      }
      byTag.set(tag, stem);
    }
    return { term, forms, exempt, stems: byTag };
  });
}

/** Studio's glossary, `glossary.json`. */
export const GLOSSARY: readonly GlossaryTerm[] = parseGlossary(glossaryFile);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether the English `text` holds one of `forms` as a whole word (R1.4): once its placeholders are removed,
 * case-insensitively, neither preceded nor followed by a letter, a digit, `-`, `_` or `/`. So "port" is not found in
 * "reported", nor "emulator" in `aws-emulator` or `--emulator-port`.
 */
export function holdsTerm(text: string, forms: readonly string[]): boolean {
  const plain = withoutPlaceholders(text);
  return forms.some((form) =>
    new RegExp(`(?<![\\p{L}\\p{N}_/-])${escapeRegExp(form)}(?![\\p{L}\\p{N}_/-])`, 'iu').test(plain),
  );
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function placeholdersOfMessage(message: Message): string[] {
  return [...new Set(textsOf(message).flatMap(placeholdersOf))].sort();
}

/** The plural categories of `tag` in this runtime (R4.7). */
function categoriesOf(tag: string): readonly Intl.LDMLPluralRule[] {
  return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
}

function pluralProblems(tag: string, key: string, message: Message): string[] {
  if (typeof message === 'string') {
    return [];
  }
  return categoriesOf(tag)
    .filter((category) => message[category] === undefined)
    .map((category) => `${tag}: "${key}" lacks the plural form "${category}".`);
}

/** Whether a text of `message` is identical to the English one of the same form. */
function sameAsEnglish(message: Message, english: Message): boolean {
  if (typeof message === 'string' || typeof english === 'string') {
    return textsOf(message).some((text) => textsOf(english).includes(text));
  }
  return PLURAL_CATEGORIES.some((category) => {
    const text = message[category];
    return text !== undefined && (text === english[category] || text === english.other);
  });
}

function glossaryProblems(
  catalogue: Catalogue,
  key: string,
  message: Message,
  english: Message,
  glossary: readonly GlossaryTerm[],
  unknownStems: Set<string>,
): string[] {
  const problems: string[] = [];
  for (const term of glossary) {
    if (term.exempt.includes(key) || !textsOf(english).some((text) => holdsTerm(text, term.forms))) {
      continue;
    }
    const stem = term.stems.get(catalogue.tag);
    if (stem === undefined) {
      unknownStems.add(term.term);
      continue;
    }
    const lowerStem = stem.toLocaleLowerCase(catalogue.tag);
    const lacking = textsOf(message).some(
      (text) => !withoutPlaceholders(text).toLocaleLowerCase(catalogue.tag).includes(lowerStem),
    );
    if (lacking) {
      problems.push(`${catalogue.tag}: "${key}" holds the term "${term.term}" in English but not its stem "${stem}".`);
    }
  }
  return problems;
}

/**
 * Every problem of `catalogue` against `source` (English) and `glossary`: a key of English it lacks, a key English
 * lacks, a placeholder dropped or renamed, a counted message that is not one or lacks a plural category of its
 * language, a text identical to English whose key is not listed as intentionally the same, a glossary term without
 * the language's stem. English itself is checked for its plural categories only. An empty list: the catalogue
 * passes.
 */
export function catalogueProblems(
  source: Catalogue,
  catalogue: Catalogue,
  glossary: readonly GlossaryTerm[] = GLOSSARY,
): string[] {
  const tag = catalogue.tag;
  if (catalogue === source || tag === source.tag) {
    return [...catalogue.messages].flatMap(([key, message]) => pluralProblems(tag, key, message));
  }
  const problems: string[] = [];
  const unknownStems = new Set<string>();
  for (const [key, english] of source.messages) {
    const message = catalogue.messages.get(key);
    if (message === undefined) {
      problems.push(`${tag}: "${key}" is missing; English has it.`);
      continue;
    }
    if ((typeof message === 'string') !== (typeof english === 'string')) {
      problems.push(
        `${tag}: "${key}" is ${typeof english === 'string' ? 'a text' : 'a counted message'} in English and not here.`,
      );
      continue;
    }
    const expected = placeholdersOfMessage(english);
    const mismatched = textsOf(message).some((text) => !sameSet(placeholdersOf(text).sort(), expected));
    if (mismatched) {
      problems.push(`${tag}: "${key}" does not hold the placeholders of English, ${expected.join(', ') || 'none'}.`);
    }
    problems.push(...pluralProblems(tag, key, message));
    if (!catalogue.sameAsEnglish.includes(key) && sameAsEnglish(message, english)) {
      problems.push(`${tag}: "${key}" is the same as English and not listed in "${SAME_AS_ENGLISH_ENTRY}".`);
    }
    problems.push(...glossaryProblems(catalogue, key, message, english, glossary, unknownStems));
  }
  for (const key of catalogue.messages.keys()) {
    if (!source.messages.has(key)) {
      problems.push(`${tag}: "${key}" is not a key of English.`);
    }
  }
  for (const key of catalogue.sameAsEnglish) {
    if (!source.messages.has(key)) {
      problems.push(`${tag}: "${SAME_AS_ENGLISH_ENTRY}" lists "${key}", which is not a key of English.`);
    }
  }
  for (const term of unknownStems) {
    problems.push(`${tag}: the glossary gives no stem of "${term}" for this language.`);
  }
  if (catalogue.name === source.name) {
    problems.push(`${tag}: "${NAME_ENTRY}" is English's own name.`);
  }
  return problems;
}
