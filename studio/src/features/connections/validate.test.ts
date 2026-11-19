import { describe, expect, it } from 'vitest';

import { BUNDLED_CATALOGUES } from '../../i18n/bundled';
import { messagesFor } from '../../i18n/messages';
import { endpointProblem, nameProblem } from './validate';

const { t } = messagesFor(BUNDLED_CATALOGUES, 'en');

function said(key: ReturnType<typeof nameProblem>): string | undefined {
  return key === undefined ? undefined : t(key);
}

describe('the name', () => {
  it('empty → "Enter a name."', () => {
    expect(said(nameProblem(''))).toBe('Enter a name.');
  });

  it.each(['Bad Name', '-x', 'a'.repeat(65), '_x', 'aB'])('%s → the rule', (name) => {
    expect(said(nameProblem(name))).toBe('Use 1 to 64 of a–z, 0–9, - and _, starting with a letter or a digit.');
  });

  it.each(['a', 'x_1-2', 'a'.repeat(64), '9lives'])('%s → valid', (name) => {
    expect(nameProblem(name)).toBeUndefined();
  });
});

describe('the endpoint', () => {
  it('empty → "Enter an endpoint."', () => {
    expect(said(endpointProblem(''))).toBe('Enter an endpoint.');
  });

  it.each(['http://127.0.0.1:9', '127.0.0.1:9302', 'ftp://x:1'])(
    '%s → "Start the endpoint with https://."',
    (value) => {
      expect(said(endpointProblem(value))).toBe('Start the endpoint with https://.');
    },
  );

  it.each(['https://127.0.0.1', 'https://[::1]', 'https://127.0.0.1/', 'https://[::1]9302', 'https://127.0.0.1:'])(
    '%s → "Add the port: https://127.0.0.1:<port>."',
    (value) => {
      expect(said(endpointProblem(value))).toBe('Add the port: https://127.0.0.1:<port>.');
    },
  );

  it.each([
    'https://127.0.0.1:9302',
    'https://[::1]:9302',
    'https://localhost:9302',
    'https://127.0.0.1:99999',
    'https://127.0.0.1:9302/',
  ])('%s → valid here (the engine judges the rest)', (value) => {
    expect(endpointProblem(value)).toBeUndefined();
  });
});
