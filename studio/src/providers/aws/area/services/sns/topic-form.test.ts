import { describe, expect, it } from 'vitest';

import {
  DISPLAY_NAME_TOO_LONG,
  displayNameMessage,
  FIFO_NAME_ENDING,
  NAME_CHARACTERS,
  NAME_EMPTY,
  NAME_TOO_LONG,
  STANDARD_NAME_ENDING,
  topicNameMessage,
} from './topic-form';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

/** `length` characters of letters, digits, `-` and `_`. */
function nameOf(length: number): string {
  return ALPHABET.repeat(Math.ceil(length / ALPHABET.length)).slice(0, length);
}

describe('topicNameMessage, a standard topic', () => {
  it.each([
    ['empty', '', NAME_EMPTY],
    ['257 characters', nameOf(257), NAME_TOO_LONG],
    ['a space', 'my topic', NAME_CHARACTERS],
    ['a period', 'my.topic', NAME_CHARACTERS],
    ['é', 'café', NAME_CHARACTERS],
    ['ending .fifo', 'orders.fifo', STANDARD_NAME_ENDING],
  ])('%s → its message', (_, name, message) => {
    expect(topicNameMessage(name, 'standard')).toBe(message);
  });

  it('256 letters, digits, - and _ → none', () => {
    const name = nameOf(256);
    expect(name).toHaveLength(256);
    expect(name).toMatch(/-/);
    expect(name).toMatch(/_/);
    expect(topicNameMessage(name, 'standard')).toBeUndefined();
  });
});

describe('topicNameMessage, a FIFO topic', () => {
  it.each([
    ['not ending .fifo', 'orders', FIFO_NAME_ENDING],
    ['a character outside the alphabet before .fifo', 'my orders.fifo', NAME_CHARACTERS],
    ['a period before .fifo', 'my.orders.fifo', NAME_CHARACTERS],
    ['257 characters with the ending', `${nameOf(252)}.fifo`, NAME_TOO_LONG],
  ])('%s → its message', (_, name, message) => {
    expect(topicNameMessage(name, 'fifo')).toBe(message);
  });

  it('a.fifo → none; 256 characters with the ending → none', () => {
    expect(topicNameMessage('a.fifo', 'fifo')).toBeUndefined();
    expect(topicNameMessage(`${nameOf(251)}.fifo`, 'fifo')).toBeUndefined();
  });

  it('empty → "Enter a name."', () => {
    expect(topicNameMessage('', 'fifo')).toBe(NAME_EMPTY);
  });
});

describe('displayNameMessage', () => {
  it('101 characters → its message; 100 and empty → none', () => {
    expect(displayNameMessage('x'.repeat(101))).toBe(DISPLAY_NAME_TOO_LONG);
    expect(displayNameMessage('x'.repeat(100))).toBeUndefined();
    expect(displayNameMessage('')).toBeUndefined();
  });
});
