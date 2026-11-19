// The names a DynamoDB table can have, and where a filtered listing starts (issue 72, requirement R2, R4.7, R5.5).
// `ListTables` has no filter, but it returns names in code point order and starts after any name it is given, so the
// names that start with a text are one run of the list: the first page is asked for after the greatest name that
// sorts before the least name starting with the text, and cut at the first name that does not start with it.

/** The characters of a table name, in code point order (R2): `-` < `.` < digits < upper case < `_` < lower case. */
export const NAME_ALPHABET = '-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

/** The shortest and the longest name a table can have. */
export const MIN_NAME_LENGTH = 3;
export const MAX_NAME_LENGTH = 255;

const LEAST = '-';
const GREATEST = 'z';

function inAlphabet(text: string): boolean {
  return [...text].every((character) => NAME_ALPHABET.includes(character));
}

/** `name` is one a table can have: 3 to 255 characters of the name alphabet. The emulator reads no other (R2). */
export function isTableName(name: string): boolean {
  return name.length >= MIN_NAME_LENGTH && name.length <= MAX_NAME_LENGTH && inAlphabet(name);
}

/** Where the first page of a listing filtered by a text starts. */
export type FilterStart =
  /** No name can start with the text (R4.7): nothing is asked for. */
  | { kind: 'matches-nothing' }
  /** The least name there is starts with the text: the page is asked for from the start of the list. */
  | { kind: 'from-start' }
  /** The page is asked for after `name`, sent as `ExclusiveStartTableName`. */
  | { kind: 'after'; name: string };

/**
 * Where the first page of the names that start with `text` begins (R4.7). Let P be the text filled with `-` to 3
 * characters, the least name that starts with it. P longer than 3 and ending with `-`: P without its last character.
 * Otherwise P without its trailing `-`, its last character replaced by the one before it in the alphabet and filled
 * with `z` to 255 characters; nothing at all when no character remains. A text longer than 255 characters, or with
 * a character outside the name alphabet, matches nothing.
 */
export function filterStart(text: string): FilterStart {
  if (text.length > MAX_NAME_LENGTH || !inAlphabet(text)) {
    return { kind: 'matches-nothing' };
  }
  const least = text.padEnd(MIN_NAME_LENGTH, LEAST);
  if (least.length > MIN_NAME_LENGTH && least.endsWith(LEAST)) {
    return { kind: 'after', name: least.slice(0, -1) };
  }
  const kept = least.replace(/-+$/, '');
  if (kept === '') {
    return { kind: 'from-start' };
  }
  const last = kept.charAt(kept.length - 1);
  const before = NAME_ALPHABET.charAt(NAME_ALPHABET.indexOf(last) - 1);
  return { kind: 'after', name: `${kept.slice(0, -1)}${before}`.padEnd(MAX_NAME_LENGTH, GREATEST) };
}

/** `name` is in the run of names a filter by `text` shows: it starts with the text, upper and lower case apart. */
export function matchesFilter(name: string, text: string): boolean {
  return name.startsWith(text);
}
