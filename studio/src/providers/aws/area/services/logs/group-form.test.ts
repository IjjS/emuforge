import { expect, it } from 'vitest';

import { createGroupInput, INITIAL_GROUP_FORM, logGroupNameError } from './group-form';

it.each([
  ['', '1 to 512 characters'],
  ['a'.repeat(513), '1 to 512 characters'],
  ['a b', 'letters, digits and . - _ / #'],
  ['a:b', 'letters, digits and . - _ / #'],
  ['aws/group', 'cannot start with aws/'],
])('rejects %j with its failed rule', (name, rule) => {
  expect(logGroupNameError(name)).toContain(rule);
});

it('accepts 512 allowed characters', () => {
  const name = '/A#z-_.0'.repeat(64);
  expect(name).toHaveLength(512);
  expect(logGroupNameError(name)).toBeUndefined();
});

it('includes the chosen class and only sends protection and tags when set', () => {
  const form = {
    ...INITIAL_GROUP_FORM,
    name: '/app#cold',
    logClass: 'INFREQUENT_ACCESS',
    retention: 7,
  } as const;
  expect(createGroupInput({ ...form, deletionProtection: true, tags: [{ key: 'team', value: '' }] })).toEqual({
    logGroupName: '/app#cold',
    logGroupClass: 'INFREQUENT_ACCESS',
    deletionProtectionEnabled: true,
    tags: { team: '' },
  });
  expect(createGroupInput(form)).toEqual({
    logGroupName: '/app#cold',
    logGroupClass: 'INFREQUENT_ACCESS',
  });
});
