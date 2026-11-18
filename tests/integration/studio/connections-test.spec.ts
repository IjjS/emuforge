// `studio.connections-test-connection` (issue 486, test-criteria.md, Integration): the engine holds `local` (→ `A`,
// running) and `<p>n` (→ a port where no emulator runs: the check's own emulator, stopped, so its files are gone). A
// test of `local` passes its five checks; a test of `<p>n` fails at "Emulator files" and the row says "Not started"
// with the engine's message; once an emulator runs on that port again, "Refresh" and a test show it connected.

import { expect, OwnEmulator, startStack, test } from './support';
import { addTarget, endpointOf, listTargets, openConnections, row, rowText } from './support/connections';
import { ACTION } from './support/frame';
import { checkPrefix } from './support/service-screens';

const CHECKS = ['Emulator files', 'Connection', 'TLS certificate', 'Health', 'Credentials'];

/** Each check's name and status, in order, as the row's test result shows them. */
async function checksOf(page: import('@playwright/test').Page, name: string): Promise<string[]> {
  return row(page, name)
    .locator('ol li')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
}

test('studio.connections-test-connection', async ({ page, ctx }) => {
  const p = checkPrefix(ctx, 'tst');
  const stack = await startStack(ctx);
  const engine = stack.engine.port;
  const n = await OwnEmulator.start(ctx);
  await n.stop();
  const none = `${p}n`;
  await addTarget(engine, none, endpointOf(n.port));
  await openConnections(page, ['local', none]);
  const before = await listTargets(engine, 'before the tests');

  await test.step('Test local: passed, five checks passed, nothing changed', async () => {
    await row(page, 'local').getByRole('button', { name: 'Test local', exact: true }).click(ACTION);
    await expect(row(page, 'local').getByText('Test passed', { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await checksOf(page, 'local')).toEqual(CHECKS.map((c) => `${c} Passed`));
    expect(await listTargets(engine, 'after testing local')).toEqual(before);
  });

  await test.step('Test <p>n: failed at Emulator files, the others not run; the row reads Not started', async () => {
    await row(page, none).getByRole('button', { name: `Test ${none}`, exact: true }).click(ACTION);
    await expect(row(page, none).getByText('Test failed: Emulator files', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const checks = await checksOf(page, none);
    expect(checks[0]).toMatch(new RegExp(`^Emulator files Failed .*${String(n.port)}`));
    expect(checks.slice(1)).toEqual(CHECKS.slice(1).map((c) => `${c} Not run`));
    await expect.poll(() => rowText(page, none), ACTION).toMatch(new RegExp(`Not started .*${String(n.port)}`));
  });

  await test.step('Start an emulator on that port, Refresh, Test: connected and passed', async () => {
    await n.startAgain();
    await page.getByRole('main').getByRole('button', { name: 'Refresh', exact: true }).first().click(ACTION);
    await expect.poll(() => rowText(page, none), ACTION).toMatch(/Emulator Connected/);
    await row(page, none).getByRole('button', { name: `Test ${none}`, exact: true }).click(ACTION);
    await expect(row(page, none).getByText('Test passed', { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
