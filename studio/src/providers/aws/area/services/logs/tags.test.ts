import { expect, it } from 'vitest';

import { tagChanges, validateTags } from './tags';

it.each([
  { row: { key: '', value: '' }, error: { key: 'Enter a key of 1 to 128 characters.' } },
  { row: { key: 'a'.repeat(129), value: '' }, error: { key: 'Enter a key of 1 to 128 characters.' } },
  { row: { key: 'aws:team', value: '' }, error: { key: 'A tag key cannot start with aws:.' } },
  { row: { key: 'team', value: 'a'.repeat(257) }, error: { value: 'Enter a value of up to 256 characters.' } },
])('reports the rule for an invalid tag', ({ row, error }) => {
  expect(validateTags([row])).toEqual({ rows: [error], limit: undefined });
});

it('reports the duplicate key even when the values differ', () => {
  expect(
    validateTags([
      { key: 'team', value: '' },
      { key: 'team', value: 'core' },
    ]),
  ).toEqual({
    rows: [{}, { key: 'Enter a unique tag key.' }],
    limit: undefined,
  });
});

it('accepts 50 tags with an empty value and rejects a 51st tag', () => {
  const tags = Array.from({ length: 50 }, (_, index) => ({
    key: `tag-${index.toString()}`,
    value: index === 0 ? '' : 'a'.repeat(256),
  }));
  expect(validateTags(tags)).toEqual({ rows: Array.from({ length: 50 }, () => ({})), limit: undefined });
  expect(validateTags([...tags, { key: 'extra', value: '' }]).limit).toBe('You can add up to 50 tags.');
});

it('removes missing keys and puts only new or changed values', () => {
  expect(
    tagChanges({ removed: 'old', changed: 'old', same: 'keep' }, { changed: 'new', same: 'keep', added: '' }),
  ).toEqual({ remove: ['removed'], put: { changed: 'new', added: '' } });
});
