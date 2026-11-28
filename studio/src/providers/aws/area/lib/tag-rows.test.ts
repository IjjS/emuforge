import { expect, it } from 'vitest';

import { checkTagRows } from './tag-rows';

it('has no errors or tags with no rows', () => {
  expect(checkTagRows([])).toEqual({ errors: [], firstInvalid: undefined, tags: [] });
});

it('requires a key when the row has a value', () => {
  expect(checkTagRows([{ key: '', value: 'test' }])).toEqual({
    errors: ['Enter a key.'],
    firstInvalid: 0,
    tags: [],
  });
});

it('marks only the later use of a key', () => {
  const first = { key: 'env', value: 'dev' };
  expect(checkTagRows([first, { key: 'env', value: 'prod' }])).toEqual({
    errors: [undefined, 'This key is already used.'],
    firstInvalid: 1,
    tags: [first],
  });
});

it('drops a row with both fields empty', () => {
  expect(checkTagRows([{ key: '', value: '' }])).toEqual({
    errors: [undefined],
    firstInvalid: undefined,
    tags: [],
  });
});

it('counts a reserved first key when checking for duplicates', () => {
  expect(checkTagRows([{ key: 'Name', value: 'app' }], 'Name')).toEqual({
    errors: ['This key is already used.'],
    firstInvalid: 0,
    tags: [],
  });
});

it('keeps tag order and empty values', () => {
  const rows = [
    { key: 'team', value: '' },
    { key: 'env', value: 'dev' },
  ];
  expect(checkTagRows(rows)).toEqual({ errors: [undefined, undefined], firstInvalid: undefined, tags: rows });
});
