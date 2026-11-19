import { FIFO_SUFFIX } from './format';

// What S2, "Create topic", checks before it sends `CreateTopic` (issue 536, design task 4 step 3): the requirement's
// rules and messages, the first that fails per field. A name is 1 to 256 characters of letters, digits, hyphens and
// underscores; a FIFO topic's name ends with `.fifo`, those five characters counted, and a standard topic's does not.

/** A topic's type as the form holds it. */
export type TopicKind = 'standard' | 'fifo';

/** The longest name the emulator accepts, `.fifo` counted. */
export const NAME_MAX = 256;

/** The longest display name the form keeps. */
export const DISPLAY_NAME_MAX = 100;

export const NAME_EMPTY = 'Enter a name.';
export const NAME_TOO_LONG = 'A name can have up to 256 characters.';
export const NAME_CHARACTERS = 'A name can hold letters, digits, hyphens and underscores only.';
export const FIFO_NAME_ENDING = "A FIFO topic's name ends with .fifo.";
export const STANDARD_NAME_ENDING = "A standard topic's name does not end with .fifo.";
export const DISPLAY_NAME_TOO_LONG = 'The display name can have up to 100 characters.';

const ALPHABET = /^[A-Za-z0-9_-]+$/;

/** What is wrong with `name` for a topic of `kind`, or `undefined` when nothing is. */
export function topicNameMessage(name: string, kind: TopicKind): string | undefined {
  if (name === '') {
    return NAME_EMPTY;
  }
  if (kind === 'fifo') {
    if (!name.endsWith(FIFO_SUFFIX)) {
      return FIFO_NAME_ENDING;
    }
    if (!ALPHABET.test(name.slice(0, -FIFO_SUFFIX.length))) {
      return NAME_CHARACTERS;
    }
  } else {
    if (name.endsWith(FIFO_SUFFIX)) {
      return STANDARD_NAME_ENDING;
    }
    if (!ALPHABET.test(name)) {
      return NAME_CHARACTERS;
    }
  }
  if (name.length > NAME_MAX) {
    return NAME_TOO_LONG;
  }
  return undefined;
}

/** What is wrong with a display name, or `undefined` when nothing is (an empty one is not sent). */
export function displayNameMessage(displayName: string): string | undefined {
  return displayName.length > DISPLAY_NAME_MAX ? DISPLAY_NAME_TOO_LONG : undefined;
}
