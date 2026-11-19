import { describe, expect, it } from 'vitest';

import { filterStart, isTableName, matchesFilter, type FilterStart } from './start-name';

// The start name of a filtered first page (issue 72, requirement R4.7), one case per row of its table.

function after(name: string): FilterStart {
  return { kind: 'after', name };
}

function filled(head: string): string {
  return head.padEnd(255, 'z');
}

describe('the start name of a filter’s text', () => {
  it('is abb followed by 252 z for abc', () => {
    const start = filterStart('abc');

    expect(start).toEqual(after(`abb${'z'.repeat(252)}`));
    expect(start.kind === 'after' && start.name.length).toBe(255);
  });

  it('is abc for abc-', () => {
    expect(filterStart('abc-')).toEqual(after('abc'));
  });

  it('is abc- for abc--: only the last of several trailing hyphens is dropped', () => {
    expect(filterStart('abc--')).toEqual(after('abc-'));
  });

  it('is aa followed by 253 z for ab- and for ab', () => {
    const expected = after(`aa${'z'.repeat(253)}`);

    expect(filterStart('ab-')).toEqual(expected);
    expect(filterStart('ab')).toEqual(expected);
  });

  it('is _ followed by 254 z for a', () => {
    expect(filterStart('a')).toEqual(after(`_${'z'.repeat(254)}`));
  });

  it('takes the character before the last one in the alphabet’s order: a., a0, aA, a_, aa', () => {
    expect(filterStart('a.')).toEqual(after(`a-${'z'.repeat(253)}`));
    expect(filterStart('a0')).toEqual(after(`a.${'z'.repeat(253)}`));
    expect(filterStart('aA')).toEqual(after(filled('a9')));
    expect(filterStart('a_')).toEqual(after(filled('aZ')));
    expect(filterStart('aa')).toEqual(after(filled('a_')));
  });

  it('is none for -, -- and ---, and --- for ----', () => {
    expect(filterStart('-')).toEqual({ kind: 'from-start' });
    expect(filterStart('--')).toEqual({ kind: 'from-start' });
    expect(filterStart('---')).toEqual({ kind: 'from-start' });
    expect(filterStart('----')).toEqual(after('---'));
  });

  it('is the text with a for its last character for a text of 255 characters ending with b', () => {
    const text = `${'q'.repeat(254)}b`;

    const start = filterStart(text);

    expect(start).toEqual(after(`${'q'.repeat(254)}a`));
    expect(start.kind === 'after' && start.name.length).toBe(255);
  });

  it('is the first 254 characters of a text of 255 characters ending with -', () => {
    const text = `${'q'.repeat(254)}-`;

    expect(filterStart(text)).toEqual(after('q'.repeat(254)));
  });

  it('matches nothing for a text of 256 characters, and for texts holding a space, /, é or 한', () => {
    for (const text of ['q'.repeat(256), 'ab c', 'ab/c', 'abé', '한']) {
      expect(filterStart(text)).toEqual({ kind: 'matches-nothing' });
    }
  });

  it('leaves out no name that starts with the text, among names sorted in code point order', () => {
    const names = ['aa-', 'ab-', 'abb', 'abc', 'abc-', 'abc--', 'abc--x', 'abd'].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const texts = [
      'abc',
      'abc-',
      'abc--',
      'ab-',
      'ab',
      'a',
      'a.',
      'a0',
      'aA',
      'a_',
      'aa',
      '----',
      `${'q'.repeat(254)}b`,
      `${'q'.repeat(254)}-`,
    ];

    for (const text of texts) {
      const start = filterStart(text);
      expect(start.kind).toBe('after');
      const name = start.kind === 'after' ? start.name : '';
      const shown = names.filter((candidate) => candidate > name && matchesFilter(candidate, text));
      expect(shown).toEqual(names.filter((candidate) => candidate.startsWith(text)));
    }
  });
});

describe('a name a table can have', () => {
  it('is 3 to 255 characters of the name alphabet', () => {
    expect(isTableName('abc')).toBe(true);
    expect(isTableName('A-z_.0')).toBe(true);
    expect(isTableName('q'.repeat(255))).toBe(true);
  });

  it('is not one of 2 or of 256 characters, or one holding a space, / or é', () => {
    for (const name of ['ab', 'q'.repeat(256), 'a b', 'a/b', 'abé', '']) {
      expect(isTableName(name)).toBe(false);
    }
  });
});
