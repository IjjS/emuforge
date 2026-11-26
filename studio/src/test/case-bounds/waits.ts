export const FIND_BY = `
it('opens the area', async () => {
  await screen.findByRole('heading', { level: 1, name }, { timeout: 10_000 });
});
`;

export const NAMED_OPTIONS = `
const AREA_LOAD = { timeout: 10_000, interval: 20 };
it('opens the area', async () => {
  await vi.waitFor(async () => { await advance(); }, AREA_LOAD);
});
`;

export const NAMED_TIMEOUT = `
const AREA_LOAD_MS = 10_000;
it('opens the area', async () => {
  await screen.findByRole('heading', {}, { timeout: AREA_LOAD_MS });
});
`;

export const SHADOWED_TIMEOUT = `
const TIMEOUT = 10_000;
it('uses the file timeout', async () => {
  await vi.waitFor(ready, TIMEOUT);
});
it('uses a local timeout', async () => {
  const TIMEOUT = 4000;
  await vi.waitFor(ready, TIMEOUT);
});
`;

export const HELPER = `
async function heading(name) {
  return screen.findByRole('heading', { name }, { timeout: 10_000 });
}
`;

export const HOOK = `
beforeAll(async () => {
  await screen.findByRole('heading', {}, { timeout: 10_000 });
});
`;

export const WAIT_FOR = `
await waitFor(() => { expect(ready).toBe(true); }, { timeout: 10_000 });
`;

export const QUOTED_TIMEOUT = `
await waitFor(ready, { 'timeout': 10_000 });
`;

export const FIND_ALL_BY = `
await screen.findAllByRole('link', { name }, { timeout: 10_000 });
`;

export const QUERY_OPTIONS = `
import { findByRole, findAllByRole, queries, screen } from '@testing-library/react';
const query = { name: 'Orders', timeout: 10_000 };
await screen.findByRole('heading', query);
await screen.findAllByRole('heading', query);
await findByRole(container, 'heading', query);
await findAllByRole(container, 'heading', query);
await queries.findByRole(container, 'heading', query);
await queries.findAllByRole(container, 'heading', query);
`;

export const UNBOUND_QUERY = `
import { findByRole } from '@testing-library/react';
await findByRole(container, 'heading', {}, { timeout: 10_000 });
`;

export const IMPORTED_QUERIES = `
import { queries, queries as localQueries, screen as boundQueries } from '@testing-library/react';
import * as testing from '@testing-library/dom';
await queries.findByRole(container, 'heading', {}, { timeout: 10_000 });
await localQueries.findAllByRole(container, 'heading', {}, { timeout: 10_000 });
await testing.queries.findByRole(container, 'heading', {}, { timeout: 10_000 });
await boundQueries.findAllByRole('heading', {}, { timeout: 10_000 });
`;

export const WAIT_FOR_REMOVAL = `
await waitForElementToBeRemoved(() => screen.queryByText('Loading'), { timeout: 10_000 });
`;

export const DIRECT_TIMEOUT = `
const AREA_LOAD_MS = 10_000;
await vi.waitFor(async () => { await advance(); }, 10_000);
await vi.waitFor(async () => { await advance(); }, AREA_LOAD_MS);
`;

export const WRAPPED_TIMEOUTS = `
const options = { timeout: 10_000 } as const;
const number = (10_000 satisfies number);
const alias = number!;
await waitFor(ready, options);
await vi.waitFor(ready, (10_000));
await vi.waitFor(ready, <number>10_000);
await waitFor(ready, ({ timeout: alias! }) satisfies { timeout: number });
await waitForElementToBeRemoved(ready, ({ timeout: 10_000 } as const)!);
await vi.waitFor(ready, ((alias as number)!));
`;

export const LITERAL_KEYS = `
await vi['waitFor'](ready, { ['timeout']: 10_000 });
await screen['findByRole']('heading', {}, { timeout: 10_000 });
`;

export const SHORT_WAITS = `
const SHORT = 4_000;
await screen.findByRole('heading', {}, { timeout: 5000 });
await screen.findByRole('heading', {}, { timeout: 4_000 });
await screen.findByRole('heading', {}, { timeout: SHORT });
await screen.findByRole('heading');
`;

export const OTHER_TIMEOUTS = `
setTimeout(() => work(), 20_000);
doWork({ timeout: 10_000 });
expect(value).toEqual({ timeout: 30_000 });
`;
