import { describe, expect, it } from 'vitest';

import {
  checkDescription,
  checkHandler,
  checkMemory,
  checkTimeout,
  checkVariableRows,
  variablesOf,
} from './configuration-form';

// The checks of the "Edit" dialogs (issue 516, test criteria "Unit s3 — configuration-form.test.ts").

describe('memory', () => {
  it('128 and 10240 are accepted; 127, 10241, 1.5, empty and abc are refused', () => {
    expect(checkMemory('128')).toEqual({ value: 128 });
    expect(checkMemory('10240')).toEqual({ value: 10240 });
    for (const text of ['127', '10241', '1.5', '', 'abc']) {
      expect(checkMemory(text)).toEqual({ error: 'Enter a whole number from 128 to 10240.' });
    }
  });
});

describe('timeout', () => {
  it('1 and 900 are accepted; 0, 901, 2.5 and empty are refused', () => {
    expect(checkTimeout('1')).toEqual({ value: 1 });
    expect(checkTimeout('900')).toEqual({ value: 900 });
    for (const text of ['0', '901', '2.5', '']) {
      expect(checkTimeout(text)).toEqual({ error: 'Enter a whole number from 1 to 900.' });
    }
  });
});

describe('description', () => {
  it('256 characters are accepted; 257 are refused', () => {
    expect(checkDescription('d'.repeat(256))).toEqual({ value: 'd'.repeat(256) });
    expect(checkDescription('d'.repeat(257))).toEqual({
      error: 'The description can have up to 256 characters.',
    });
  });
});

describe('handler', () => {
  it('empty, 129 characters, a space or a tab are refused with the rule that failed', () => {
    expect(checkHandler('')).toEqual({ error: 'Enter a handler.' });
    expect(checkHandler('h'.repeat(129))).toEqual({ error: 'The handler can have up to 128 characters.' });
    expect(checkHandler('index .handler')).toEqual({ error: 'The handler cannot contain spaces.' });
    expect(checkHandler('index\t.handler')).toEqual({ error: 'The handler cannot contain spaces.' });
  });

  it('pkg/mod.handler and 128 characters are accepted', () => {
    expect(checkHandler('pkg/mod.handler')).toEqual({ value: 'pkg/mod.handler' });
    expect(checkHandler('h'.repeat(128))).toEqual({ value: 'h'.repeat(128) });
  });
});

describe('variable rows', () => {
  it('a row without a key: "Enter a key." on that row', () => {
    expect(
      checkVariableRows([
        { key: 'A', value: '1' },
        { key: '', value: '2' },
      ]),
    ).toEqual([undefined, 'Enter a key.']);
  });

  it('the same key twice: "This key is already used." on the later row', () => {
    expect(
      checkVariableRows([
        { key: 'A', value: '1' },
        { key: 'B', value: '2' },
        { key: 'A', value: '3' },
      ]),
    ).toEqual([undefined, undefined, 'This key is already used.']);
  });

  it('an empty value, a key beginning with a digit and a key with a hyphen are accepted', () => {
    expect(
      checkVariableRows([
        { key: 'EMPTY', value: '' },
        { key: '1ST', value: 'x' },
        { key: 'WITH-HYPHEN', value: 'y' },
      ]),
    ).toEqual([undefined, undefined, undefined]);
  });

  it('rows give the map sent, in the rows’ order', () => {
    expect(
      variablesOf([
        { key: 'Z', value: 'last-letter' },
        { key: 'A', value: '' },
      ]),
    ).toEqual([
      { key: 'Z', value: 'last-letter' },
      { key: 'A', value: '' },
    ]);
    expect(variablesOf([])).toEqual([]);
  });
});
