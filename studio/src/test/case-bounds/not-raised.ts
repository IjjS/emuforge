// Given sources of `case-bounds.test.ts` (issue 469): test-file text whose cases have no bound above the default,
// although calls inside them end the way a raised case would. They are strings, never run as cases.

/** A `setTimeout(() => { … }, 20_000);` of several lines inside a case that has no bound. */
export const INNER_TIMER = `import { expect, it } from 'vitest';

it('starts a timer', () => {
  setTimeout(() => {
    expect(1).toBe(1);
  }, 20_000);
});
`;

/** A `vi.waitFor(async () => { … }, AREA_LOAD);` of several lines inside a case that has no bound. */
export const INNER_WAIT_FOR = `import { expect, it, vi } from 'vitest';

const AREA_LOAD = 20_000;

it('waits for the area', async () => {
  await vi.waitFor(async () => {
    expect(await Promise.resolve(1)).toBe(1);
  }, AREA_LOAD);
});
`;

/** Cases with the default bound written out, in both forms. */
export const AT_DEFAULT = `import { expect, it } from 'vitest';

it('closes at the default', async () => {
  expect(1).toBe(1);
}, 5000);

it('opts at the default', { timeout: 5_000 }, async () => {
  expect(1).toBe(1);
});
`;

/** A wait inside a case given its own `{ timeout }`: `findBy…` and `waitFor`. */
export const INNER_FIND_AND_WAIT = `import { screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';

it('finds the heading', async () => {
  await screen.findByRole('heading', {}, { timeout: 10_000 });
  await waitFor(() => {
    expect(1).toBe(1);
  }, { timeout: 10_000 });
});
`;
