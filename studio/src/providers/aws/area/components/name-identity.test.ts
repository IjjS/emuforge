import { describe, expect, it } from 'vitest';

import { holdsHiddenWhiteSpace, identityOption, nameIdentity, optionMatches } from './name-identity';

describe('the exact identity of a name', () => {
  it.each([
    ['a b', 'a b', false],
    ['a  b', 'a\\u0020\\u0020b', true],
    ['a   b', 'a\\u0020\\u0020\\u0020b', true],
    [' a', '\\u0020a', true],
    ['a ', 'a\\u0020', true],
    [' ', '\\u0020', true],
    ['a\tb', 'a\\tb', true],
    ['a\r\nb', 'a\\r\\nb', true],
    ['a\rb', 'a\\rb', true],
    ['a\nb', 'a\\nb', true],
    ['a\u2028b', 'a\\u2028b', true],
    ['a\u2029b', 'a\\u2029b', true],
    ['a\\u0020\\u0020b', 'a\\\\u0020\\\\u0020b', false],
    ['a\u00a0b\u200bc', 'a\u00a0b\u200bc', false],
  ])('writes %j as %j', (name, identity, hidden) => {
    expect(holdsHiddenWhiteSpace(name)).toBe(hidden);
    expect(nameIdentity(name)).toBe(identity);
    expect(nameIdentity(name)).not.toMatch(/[\t\r\n\u2028\u2029]| {2}|^ | $/);
  });

  const option = { value: 'id-123', label: 'a  b', description: 'example resource', tags: ['region: local'] };

  it('changes only the label, returning the original option if the label is its own identity', () => {
    expect(identityOption(option)).toEqual({ ...option, label: 'a\\u0020\\u0020b' });
    const ordinary = { ...option, label: 'a b' };
    expect(identityOption(ordinary)).toBe(ordinary);
  });

  it.each(['a  b', 'A  B', '  b', 'id-123', 'RESOURCE', 'region: local', 'a\\u0020\\u0020b'])(
    'finds %j in the option',
    (text) => {
      expect(optionMatches(option, text)).toBe(true);
    },
  );

  it('does not find an absent text', () => {
    expect(optionMatches(option, 'a b')).toBe(false);
  });
});
