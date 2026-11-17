import { describe, expect, it } from 'vitest';

import { RUNTIMES, starterCode } from './starter-code';

// The runtimes the create form offers and the starter code of each (issue 84, requirement R6.2, R6.5).

describe('the runtimes offered', () => {
  it('are Node.js 24.x, Node.js 22.x, Python 3.14 and Python 3.13, in that order, with their identifiers', () => {
    expect(RUNTIMES).toEqual([
      { label: 'Node.js 24.x', value: 'nodejs24.x' },
      { label: 'Node.js 22.x', value: 'nodejs22.x' },
      { label: 'Python 3.14', value: 'python3.14' },
      { label: 'Python 3.13', value: 'python3.13' },
    ]);
  });
});

describe('the starter code', () => {
  it.each(['nodejs24.x', 'nodejs22.x'])('of %s is index.mjs with the handler index.handler', (runtime) => {
    expect(starterCode(runtime)).toMatchObject({ fileName: 'index.mjs', handler: 'index.handler' });
  });

  it.each(['python3.14', 'python3.13'])(
    'of %s is lambda_function.py with the handler lambda_function.lambda_handler',
    (runtime) => {
      expect(starterCode(runtime)).toMatchObject({
        fileName: 'lambda_function.py',
        handler: 'lambda_function.lambda_handler',
      });
    },
  );

  it('is none for a runtime the form does not offer', () => {
    expect(starterCode('java21')).toBeUndefined();
  });

  it.each(RUNTIMES.map(({ value }) => value))(
    'of %s holds "Hello from EmuForge Studio!" and no other sentence a user reads',
    (runtime) => {
      const text = starterCode(runtime)?.text ?? '';
      expect(text).toContain('Hello from EmuForge Studio!');
      // Every string literal of the file: the greeting is the only one.
      const literals = [...text.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)].map(([literal]) =>
        literal.slice(1, -1),
      );
      const sentences = literals.filter((literal) => /[A-Za-z]{2,}\s+[A-Za-z]/.test(literal));
      expect(sentences).toEqual(['Hello from EmuForge Studio!']);
      // No comment either.
      expect(text).not.toMatch(/(^|\s)(#|\/\/)/m);
    },
  );
});
