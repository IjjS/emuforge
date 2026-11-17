// The filter of the function list (issue 84, requirement R4.7). `ListFunctions` has no filter, but it returns names
// in code point order and starts after any `Marker` it is given, so the names that start with a text are one run of
// the list: the first page of a filtered listing asks with a marker just below the text, and every page is cut at
// the first name that does not start with it.

/** The longest name the emulator accepts (R0, R2). */
export const NAME_MAX_LENGTH = 64;

/** The characters of a function's name (R0): `a-z`, `A-Z`, `0-9`, `-`, `_`. */
const NAME_ALPHABET = /^[A-Za-z0-9_-]+$/;

/** Above every character of the name alphabet in code point order. */
const ABOVE_EVERY_NAME_CHARACTER = '~';

/** A filter text that can match some name: of the name alphabet, 1 to 64 characters. */
export function canMatch(text: string): boolean {
  return text.length <= NAME_MAX_LENGTH && NAME_ALPHABET.test(text);
}

/**
 * The `Marker` of a filtered listing's first page, or `undefined` when the text matches nothing by its form (a
 * character outside the name alphabet, more than 64 characters, or no character), so that no request is made.
 *
 * It is the text without its last character, then the character one code point before that last one, then `~`:
 * greater than every name that sorts before the text, and smaller than the text itself.
 */
export function firstPageMarker(text: string): string | undefined {
  if (!canMatch(text)) {
    return undefined;
  }
  const last = text.charCodeAt(text.length - 1);
  return `${text.slice(0, -1)}${String.fromCharCode(last - 1)}${ABOVE_EVERY_NAME_CHARACTER}`;
}

/** The leading names that start with `text`, and whether a name that does not came after them. */
export function cutAtText<T extends { name: string }>(items: readonly T[], text: string): { kept: T[]; cut: boolean } {
  const end = items.findIndex((item) => !item.name.startsWith(text));
  return end === -1 ? { kept: [...items], cut: false } : { kept: items.slice(0, end), cut: true };
}
