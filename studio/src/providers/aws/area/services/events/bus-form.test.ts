import { expect, it } from 'vitest';

import { busDescriptionError, busNameError, createBusInput } from './bus-form';

it.each([
  ['', 'Enter a name of 1 to 256 characters.'],
  ['a'.repeat(257), 'Enter a name of 1 to 256 characters.'],
  ['order events', 'Use only letters, digits and . - _.'],
  ['orders/eu', 'The name cannot contain /.'],
  ['aws.orders', 'The name cannot start with aws.'],
  ['.', undefined],
  ['..', undefined],
  ['Ab.0-_'.repeat(42) + 'abcd', undefined],
])('checks the event bus name %j', (name, error) => {
  expect(busNameError(name)).toBe(error);
});

it('checks the description length', () => {
  expect(busDescriptionError('x'.repeat(513))).toBe('Enter a description of up to 512 characters.');
  expect(busDescriptionError('x'.repeat(512))).toBeUndefined();
});

it('sends exactly the name and the fields that are present', () => {
  const tags = [{ key: 'team', value: '' }];
  expect(createBusInput({ name: 'Orders', description: 'Routes orders', tags })).toStrictEqual({
    Name: 'Orders',
    Description: 'Routes orders',
    Tags: [{ Key: 'team', Value: '' }],
  });
  expect(createBusInput({ name: 'Orders', description: '', tags })).toStrictEqual({
    Name: 'Orders',
    Tags: [{ Key: 'team', Value: '' }],
  });
  expect(createBusInput({ name: 'Orders', description: 'Routes orders', tags: [] })).toStrictEqual({
    Name: 'Orders',
    Description: 'Routes orders',
  });
  expect(createBusInput({ name: 'Orders', description: '', tags: [] })).toStrictEqual({ Name: 'Orders' });
});
