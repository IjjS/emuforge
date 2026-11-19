// Given sources of `case-bounds.test.ts` (issue 469): test-file text that raises the bound of many cases at once,
// refused wherever it stands. They are strings, never run as cases.

/** A suite given a timeout. */
export const SUITE_TIMEOUT = `import { describe, expect, it } from 'vitest';

describe('slow cases', { timeout: 9000 }, () => {
  it('runs', () => {
    expect(1).toBe(1);
  });
});
`;

/** The same, with `// Bound: <reason>` above. */
export const SUITE_TIMEOUT_COMMENTED = `import { describe, expect, it } from 'vitest';

// Bound: every case here compiles the project (issue 14).
describe('slow cases', { timeout: 9000 }, () => {
  it('runs', () => {
    expect(1).toBe(1);
  });
});
`;

/** The Vitest setting of the default bound changed for a file. */
export const SET_CONFIG = `import { expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 9000 });

it('runs', () => {
  expect(1).toBe(1);
});
`;

/** The same, with `// Bound: <reason>` above. */
export const SET_CONFIG_COMMENTED = `import { expect, it, vi } from 'vitest';

// Bound: every case here compiles the project (issue 14).
vi.setConfig({ testTimeout: 9000 });

it('runs', () => {
  expect(1).toBe(1);
});
`;

/** The setting's name anywhere else in a file. */
export const SETTING_NAMED = `import { expect, it } from 'vitest';

const options = { testTimeout: 9000 };

it('runs', () => {
  expect(options).toBeDefined();
});
`;
