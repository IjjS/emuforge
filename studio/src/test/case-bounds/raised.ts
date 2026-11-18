// Given sources of `case-bounds.test.ts` (issue 469): test-file text with a case bound above the default, in each
// form Studio's test files write one. They are strings, never run as cases.

/** A case closed by `}, 20_000);`, nothing above its `it(`. */
export const CLOSING_LINE = `import { expect, it } from 'vitest';

it('waits long', async () => {
  expect(1).toBe(1);
}, 20_000);
`;

/** The same case with `// Bound: <reason>` on the line directly above its `it(`. */
export const CLOSING_LINE_COMMENTED = `import { expect, it } from 'vitest';

// Bound: the area loads in a cold worker (issue 20).
it('waits long', async () => {
  expect(1).toBe(1);
}, 20_000);
`;

/** A case whose bound `10000,` stands on a line of its own before `);`. */
export const OWN_LINE = `import { expect, it } from 'vitest';

it(
  'waits long',
  async () => {
    expect(1).toBe(1);
  },
  10000,
);
`;

/** The same with `// Bound: <reason>` directly above. */
export const OWN_LINE_COMMENTED = `import { expect, it } from 'vitest';

// Bound: the compiler reads the whole project (issue 14).
it(
  'waits long',
  async () => {
    expect(1).toBe(1);
  },
  10000,
);
`;

/** An options object as the second argument, with a number. */
export const OPTIONS = `import { expect, it } from 'vitest';

it('waits long', { timeout: 60_000 }, async () => {
  expect(1).toBe(1);
});
`;

/** The same with `// Bound: <reason>` directly above. */
export const OPTIONS_COMMENTED = `import { expect, it } from 'vitest';

// Bound: fifty rows render one by one (issue 82).
it('waits long', { timeout: 60_000 }, async () => {
  expect(1).toBe(1);
});
`;

/** An options object whose bound is a name. */
export const OPTIONS_NAMED = `import { expect, it } from 'vitest';

const SLOW = 60_000;

it('waits long', { timeout: SLOW }, async () => {
  expect(1).toBe(1);
});
`;

/** A case closed by `}, SLOW);`: a name as the third argument. */
export const CLOSING_LINE_NAMED = `import { expect, it } from 'vitest';

const SLOW = 20_000;

it('waits long', async () => {
  expect(1).toBe(1);
}, SLOW);
`;

/** A raised bound under a comment that is not `// Bound:`. */
export const OTHER_COMMENT = `import { expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/require-await
it('waits long', async () => {
  expect(1).toBe(1);
}, 20_000);
`;

/** `// Bound: <reason>` with a blank line between it and the `it(`. */
export const COMMENT_APART = `import { expect, it } from 'vitest';

// Bound: the area loads in a cold worker (issue 20).

it('waits long', async () => {
  expect(1).toBe(1);
}, 20_000);
`;
