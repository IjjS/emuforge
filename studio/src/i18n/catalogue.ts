// The catalogue format (requirement R4.6): one file per language, `messages/<tag>.json`, a flat JSON object from
// message key to text, or, for a counted message, an object from plural category to text. Placeholders are written
// `{name}`. Two reserved entries sit beside the messages: the language's own name and the keys whose text is
// intentionally the same as English.

import type english from './messages/en.json';

/** The language every other one falls back to, and the source of the full set of keys. */
export const SOURCE_TAG = 'en';

/** The reserved entry that holds the language's own name ("Deutsch"). */
export const NAME_ENTRY = '@name';

/** The reserved entry that lists the keys whose text is intentionally the same as English (R4.7). */
export const SAME_AS_ENGLISH_ENTRY = '@sameAsEnglish';

/** Every plural category `Intl.PluralRules` can give. */
export const PLURAL_CATEGORIES: readonly Intl.LDMLPluralRule[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** A counted message: one text per plural category the catalogue gives. */
export type PluralForms = Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;

/** A message: a text, or the forms of a counted message. */
export type Message = string | PluralForms;

/** One language's catalogue, read from its file. */
export interface Catalogue {
  /** The language's BCP 47 tag, the file's name without `.json`. */
  readonly tag: string;
  /** The language's own name, the same in every language (R1.1, R1.3). */
  readonly name: string;
  /** Keys whose text is intentionally the same as English; the only exemption of that rule (R4.7). */
  readonly sameAsEnglish: readonly string[];
  /** Every message, by key; reserved entries are not among them. */
  readonly messages: ReadonlyMap<string, Message>;
}

/** The keys of Studio's messages: the English catalogue's, reserved entries aside. */
export type MessageKey = Exclude<keyof typeof english, `@${string}`>;

/** The catalogues Studio has: English, the source, and every other language, by tag. */
export interface Catalogues {
  readonly source: Catalogue;
  /** Every catalogue, English included, by tag. */
  readonly byTag: ReadonlyMap<string, Catalogue>;
}

/** A catalogue file that is not in the format of R4.6. */
export class CatalogueFormatError extends Error {
  override name = 'CatalogueFormatError';
}

/** A `{name}` placeholder; its name is the first group. */
export const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** The names of the `{name}` placeholders of `text`, in order, each once. */
export function placeholdersOf(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1] ?? ''))];
}

/** `text` with each `{name}` placeholder replaced by `replacement`. */
export function withoutPlaceholders(text: string, replacement = ''): string {
  return text.replace(PLACEHOLDER, replacement);
}

/** The texts of a message: the text itself, or each form of a counted message. */
export function textsOf(message: Message): string[] {
  return typeof message === 'string' ? [message] : Object.values(message).filter((text) => text !== undefined);
}

function isPluralCategory(name: string): name is Intl.LDMLPluralRule {
  return (PLURAL_CATEGORIES as readonly string[]).includes(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMessage(tag: string, key: string, value: unknown): Message {
  if (typeof value === 'string') {
    return value;
  }
  if (!isRecord(value)) {
    throw new CatalogueFormatError(`${tag}: "${key}" is neither a text nor an object of plural forms.`);
  }
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> = {};
  for (const [category, text] of Object.entries(value)) {
    if (!isPluralCategory(category)) {
      throw new CatalogueFormatError(`${tag}: "${key}" has "${category}", which is not a plural category.`);
    }
    if (typeof text !== 'string') {
      throw new CatalogueFormatError(`${tag}: "${key}" form "${category}" is not a text.`);
    }
    forms[category] = text;
  }
  return forms;
}

/** The catalogue of `tag` from the parsed JSON of its file; throws a `CatalogueFormatError` when it is not one. */
export function parseCatalogue(tag: string, json: unknown): Catalogue {
  if (!isRecord(json)) {
    throw new CatalogueFormatError(`${tag}: a catalogue is a JSON object.`);
  }
  const name = json[NAME_ENTRY];
  if (typeof name !== 'string' || name === '') {
    throw new CatalogueFormatError(`${tag}: "${NAME_ENTRY}" holds the language's own name.`);
  }
  const same = json[SAME_AS_ENGLISH_ENTRY] ?? [];
  if (!Array.isArray(same) || !same.every((key): key is string => typeof key === 'string')) {
    throw new CatalogueFormatError(`${tag}: "${SAME_AS_ENGLISH_ENTRY}" is a list of message keys.`);
  }
  const messages = new Map<string, Message>();
  for (const [key, value] of Object.entries(json)) {
    if (key === NAME_ENTRY || key === SAME_AS_ENGLISH_ENTRY) {
      continue;
    }
    if (key.startsWith('@')) {
      throw new CatalogueFormatError(`${tag}: "${key}" is not a reserved entry; a message key does not start with @.`);
    }
    messages.set(key, parseMessage(tag, key, value));
  }
  return { tag, name, sameAsEnglish: same, messages };
}

/** The set of `catalogues`, by tag; throws when two share a tag or English is not among them. */
export function catalogueSet(catalogues: readonly Catalogue[]): Catalogues {
  const byTag = new Map<string, Catalogue>();
  for (const catalogue of [...catalogues].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))) {
    if (byTag.has(catalogue.tag)) {
      throw new CatalogueFormatError(`${catalogue.tag}: two catalogues have this tag.`);
    }
    byTag.set(catalogue.tag, catalogue);
  }
  const source = byTag.get(SOURCE_TAG);
  if (source === undefined) {
    throw new CatalogueFormatError(`There is no English catalogue, messages/${SOURCE_TAG}.json.`);
  }
  return { source, byTag };
}
