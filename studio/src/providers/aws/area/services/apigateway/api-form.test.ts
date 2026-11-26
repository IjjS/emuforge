import { expect, it } from 'vitest';

import { apiFormChanged, apiNameError, initialApiForm } from './api-form';

it.each([
  ['REST', 512],
  ['HTTP', 128],
] as const)('validates %s names against the kind’s length rule', (kind, limit) => {
  const rule = `1 to ${limit} characters.`;
  expect(apiNameError('', kind)).toBe(rule);
  expect(apiNameError('x'.repeat(limit + 1), kind)).toBe(rule);
  expect(apiNameError('x'.repeat(limit), kind)).toBeUndefined();
});

it('detects changes to each field and treats a restored value as unchanged', () => {
  const form = { ...initialApiForm };
  expect(apiFormChanged(form)).toBe(false);
  expect(apiFormChanged({ ...form, kind: 'REST' })).toBe(true);
  expect(apiFormChanged({ ...form, description: 'Local description' })).toBe(true);
  expect(apiFormChanged({ ...form, endpointType: 'PRIVATE' })).toBe(true);
  expect(apiFormChanged({ ...form, defaultStage: 'skip' })).toBe(true);
  form.name = 'local API';
  expect(apiFormChanged(form)).toBe(true);
  form.name = '';
  expect(apiFormChanged(form)).toBe(false);
});
