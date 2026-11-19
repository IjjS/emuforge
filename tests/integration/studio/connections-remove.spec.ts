// `studio.connections-remove-connection` (issue 486, test-criteria.md, Integration): the engine holds `local` (→ `A`, the
// target) and `<p>b` (→ `B`), and `B` holds `<p>-on-b`. Cancel keeps the connection; Remove takes it out of the
// engine's list and leaves `B` and its bucket alone; the target's "Remove" is unavailable with its reason.

import { expect, OwnEmulator, startStack, test } from './support';
import {
  addTarget,
  bucketsOn,
  createBucketOn,
  endpointOf,
  expectResult,
  listTargets,
  openConnections,
  row,
} from './support/connections';
import { ACTION } from './support/frame';
import { checkPrefix } from './support/service-screens';

const UNAVAILABLE = "The target can't be removed. Make another connection the target first.";

test('studio.connections-remove-connection', async ({ page, ctx }) => {
  const p = checkPrefix(ctx, 'rm');
  const stack = await startStack(ctx);
  const engine = stack.engine.port;
  const b = await OwnEmulator.start(ctx);
  const second = `${p}b`;
  const onB = `${p}-on-b`;
  await createBucketOn(ctx, b.port, onB);
  await addTarget(engine, second, endpointOf(b.port));
  await openConnections(page, ['local', second]);
  const names = async () => (await listTargets(engine, 'now')).targets.map((t) => t.name);
  const dialog = page.getByRole('dialog', { name: `Remove ${second}?` });

  await test.step('Remove, then Cancel: the connection stays', async () => {
    await row(page, second).getByRole('button', { name: `Remove ${second}`, exact: true }).click(ACTION);
    await expect(dialog).toBeVisible(ACTION);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(ACTION);
    await expect(dialog).toHaveCount(0, ACTION);
    await expect(row(page, second)).toBeVisible(ACTION);
    expect(await names()).toContain(second);
  });

  await test.step('Remove, then Remove: gone from the engine, B and its bucket untouched', async () => {
    await row(page, second).getByRole('button', { name: `Remove ${second}`, exact: true }).click(ACTION);
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click(ACTION);
    await expectResult(page, `${second} was removed.`);
    await expect(row(page, second)).toHaveCount(0, ACTION);
    expect(await names()).not.toContain(second);
    expect(await bucketsOn(ctx, b.port), 'B still holds its bucket').toContain(onB);
  });

  await test.step("The target's Remove is unavailable with its reason", async () => {
    const remove = row(page, 'local').getByRole('button', { name: 'Remove local', exact: true });
    await expect(remove).toHaveAttribute('aria-disabled', 'true', ACTION);
    await expect(remove).toHaveAccessibleDescription(UNAVAILABLE, ACTION);
    await remove.click({ ...ACTION, force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0, ACTION);
    const list = await listTargets(engine, 'after the unavailable Remove');
    expect(list.active).toBe('local');
    expect(list.targets.map((t) => t.name)).toContain('local');
  });
});
