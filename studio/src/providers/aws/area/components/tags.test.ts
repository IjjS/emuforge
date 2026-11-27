import { expect, it } from 'vitest';

import { tagChanges, tagsToRecord, validateTags } from './tags';

it.each([
  ['', 'Enter a key of 1 to 128 characters.'],
  ['a'.repeat(129), 'Enter a key of 1 to 128 characters.'],
  ['aws:managed', 'A tag key cannot start with aws:.'],
])('rejects an invalid key %j', (key, error) => {
  expect(validateTags([{ key, value: '' }])).toEqual({ rows: [{ key: error }], limit: undefined });
});

it('reports a long value and the second occurrence of a key', () => {
  expect(
    validateTags([
      { key: 'env', value: 'a'.repeat(257) },
      { key: 'env', value: '' },
    ]),
  ).toEqual({
    rows: [{ value: 'Enter a value of up to 256 characters.' }, { key: 'Enter a unique tag key.' }],
    limit: undefined,
  });
});

it('allows 50 tags with empty values and gives a limit error at 51', () => {
  const tags = Array.from({ length: 50 }, (_, index) => ({ key: String(index), value: '' }));
  expect(validateTags(tags)).toEqual({ rows: tags.map(() => ({})), limit: undefined });
  expect(validateTags([...tags, { key: 'extra', value: '' }]).limit).toBe('You can add up to 50 tags.');
});

it('keeps only the tags to put and the keys to remove', () => {
  const after = tagsToRecord([
    { key: 'same', value: 'before' },
    { key: 'changed', value: 'after' },
    { key: 'new', value: '' },
  ]);
  expect(tagChanges({ same: 'before', changed: 'before', removed: 'before' }, after)).toEqual({
    remove: ['removed'],
    put: { changed: 'after', new: '' },
  });
});
