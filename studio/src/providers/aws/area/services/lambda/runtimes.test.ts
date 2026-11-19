import { describe, expect, it } from 'vitest';

import { RUNTIMES, runtimeOptions } from './runtimes';

// The one list of runtimes Studio offers (issue 516, test criteria "Unit s1 — runtimes.test.ts").

const TEN = [
  { label: 'Node.js 24.x', value: 'nodejs24.x', language: 'nodejs' },
  { label: 'Node.js 22.x', value: 'nodejs22.x', language: 'nodejs' },
  { label: 'Node.js 20.x', value: 'nodejs20.x', language: 'nodejs' },
  { label: 'Node.js 18.x', value: 'nodejs18.x', language: 'nodejs' },
  { label: 'Python 3.14', value: 'python3.14', language: 'python' },
  { label: 'Python 3.13', value: 'python3.13', language: 'python' },
  { label: 'Python 3.12', value: 'python3.12', language: 'python' },
  { label: 'Python 3.11', value: 'python3.11', language: 'python' },
  { label: 'Python 3.10', value: 'python3.10', language: 'python' },
  { label: 'Python 3.9', value: 'python3.9', language: 'python' },
];

const TEN_OPTIONS = TEN.map(({ label, value }) => ({ label, value }));

describe('the runtimes offered', () => {
  it('are the ten, Node.js 24.x to 18.x then Python 3.14 to 3.9, each with its label and identifier', () => {
    expect(RUNTIMES).toEqual(TEN);
  });
});

describe('the options of a runtime field', () => {
  it.each(['nodejs24.x', 'python3.9', undefined, ''])('for a function of %s are the ten', (runtime) => {
    expect(runtimeOptions(runtime)).toEqual(TEN_OPTIONS);
  });

  it('for a function of java21 are the ten and java21, shown as the emulator names it', () => {
    expect(runtimeOptions('java21')).toEqual([...TEN_OPTIONS, { label: 'java21', value: 'java21' }]);
  });
});
