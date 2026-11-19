import { describe, expect, it } from 'vitest';

import { RUNTIMES } from './runtimes';
import { starterCode } from './starter-code';

// The starter code of each runtime offered, one file per language (issue 516, test criteria "Unit s1 —
// starter-code.test.ts"; issue 84, requirement R6.5).

const NODE = RUNTIMES.filter(({ value }) => value.startsWith('nodejs')).map(({ value }) => value);
const PYTHON = RUNTIMES.filter(({ value }) => value.startsWith('python')).map(({ value }) => value);

describe('the starter code', () => {
  it('covers the four Node.js runtimes and the six Python ones', () => {
    expect(NODE).toEqual(['nodejs24.x', 'nodejs22.x', 'nodejs20.x', 'nodejs18.x']);
    expect(PYTHON).toEqual(['python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3.9']);
  });

  it.each(NODE)('of %s is index.mjs with the handler index.handler', (runtime) => {
    expect(starterCode(runtime)).toMatchObject({ fileName: 'index.mjs', handler: 'index.handler' });
  });

  it.each(PYTHON)('of %s is lambda_function.py with the handler lambda_function.lambda_handler', (runtime) => {
    expect(starterCode(runtime)).toMatchObject({
      fileName: 'lambda_function.py',
      handler: 'lambda_function.lambda_handler',
    });
  });

  it.each(['java21', 'nodejs16.x', 'python3.8', 'provided.al2023', ''])(
    'is none for a runtime outside the ten (%s)',
    (runtime) => {
      expect(starterCode(runtime)).toBeUndefined();
    },
  );

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
