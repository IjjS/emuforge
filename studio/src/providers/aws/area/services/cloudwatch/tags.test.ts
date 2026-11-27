import { expect, it } from 'vitest';

import { changesOwed, tagChanges, tagsAddedOutside, validateTags } from './tags';

it('validates each field and the row limit without altering input', () => {
  const characters = 'Use only letters, digits, spaces, and + - = . _ : / @.';
  const keyLength = 'Use 1 to 128 characters for a key.';
  expect(
    validateTags([
      { key: '', value: '' },
      { key: 'k'.repeat(129), value: 'v'.repeat(257) },
      { key: 'AwS:reserved', value: '' },
      { key: 'bad<', value: 'bad\t' },
      { key: 'duplicate', value: '' },
      { key: 'duplicate', value: '' },
      { key: 'k'.repeat(128), value: 'v'.repeat(256) },
      { key: ' é9 +-=._:/@ ', value: '' },
    ]),
  ).toEqual({
    limit: undefined,
    rows: [
      { key: keyLength },
      { key: keyLength, value: 'Use up to 256 characters for a value.' },
      { key: 'A key must not start with aws:.' },
      { key: characters, value: characters },
      {},
      { key: 'Use each key only once.' },
      {},
      {},
    ],
  });
  const rows = Array.from({ length: 51 }, (_, index) => ({ key: String(index), value: '' }));
  expect(validateTags(rows).limit).toBe('An alarm can have up to 50 tags.');
  expect(validateTags(rows.slice(1)).limit).toBeUndefined();
});

it('computes the developer’s changes from the opened tags', () => {
  const opened = [
    { key: 'a', value: '1' },
    { key: 'b', value: '2' },
    { key: 'c', value: '3' },
  ];
  const draft = [
    { key: 'b', value: 'changed' },
    { key: 'd', value: '' },
    { key: 'c', value: '3' },
  ];
  expect(tagChanges(opened, draft)).toEqual({ remove: ['a'], put: draft.slice(0, 2) });
  expect(tagChanges(opened, [...opened].reverse())).toEqual({ remove: [], put: [] });
});

it('subtracts applied changes, keeps edits to tags changed outside, and identifies outside additions', () => {
  const opened = [
    { key: 'removed', value: '1' },
    { key: 'still-here', value: '1' },
    { key: 'changed', value: '1' },
    { key: 'already-changed', value: '1' },
  ];
  const draft = [
    { key: 'changed', value: '2' },
    { key: 'already-changed', value: '2' },
    { key: 'added', value: '' },
    { key: 'yet-to-add', value: '' },
  ];
  const outside = { key: 'outside', value: '3' };
  const latest = [{ key: 'still-here', value: '3' }, { key: 'changed', value: '3' }, draft[1]!, draft[2]!, outside];
  expect(changesOwed(tagChanges(opened, draft), latest)).toEqual({
    remove: ['still-here'],
    put: [draft[0], draft[3]],
  });
  expect(tagsAddedOutside(opened, draft, latest)).toEqual([outside]);
});
