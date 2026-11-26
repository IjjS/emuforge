import { expect, it } from 'vitest';

import { METHOD_START, methodChanged, validateMethod } from './method-form';

const resource = { id: 'one', path: '/' };

it('names missing input for each integration kind and the resource', () => {
  expect(validateMethod(METHOD_START, undefined)).toEqual({
    errors: { resource: 'Choose a resource.', function: 'Choose a Lambda function.' },
  });
  expect(validateMethod({ ...METHOD_START, kind: 'http', address: ' ' }, resource)).toEqual({
    errors: { address: 'Enter an HTTP address.' },
  });
  expect(validateMethod({ ...METHOD_START, kind: 'mock', body: '' }, resource)).toEqual({
    errors: { body: 'Enter a response body.' },
  });
});

it('counts differences from the opened form with or without a linked resource', () => {
  expect(methodChanged(METHOD_START, undefined, undefined)).toBe(false);
  expect(methodChanged(METHOD_START, resource, resource)).toBe(false);
  expect(methodChanged(METHOD_START, resource, undefined)).toBe(true);
  expect(methodChanged(METHOD_START, { id: 'two', path: '/' }, resource)).toBe(true);
  expect(methodChanged({ ...METHOD_START, method: 'POST' }, resource, resource)).toBe(true);
  expect(methodChanged({ ...METHOD_START, allow: false }, resource, resource)).toBe(true);
  expect(methodChanged({ ...METHOD_START, function: { name: 'test', arn: 'arn:test' } }, resource, resource)).toBe(
    true,
  );
});
