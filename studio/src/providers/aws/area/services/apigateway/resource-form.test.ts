import { expect, it } from 'vitest';

import { PATH_PART_RULE, pathPartError } from './resource-form';

it.each(['Orders19._-:', '{id}', '{proxy+}'])('allows %s as a path part', (part) => {
  expect(pathPartError(part)).toBeUndefined();
});

it.each(['', 'two words', 'child/path'])('rejects %j with the constraint text', (part) => {
  expect(pathPartError(part)).toBe(PATH_PART_RULE);
});
