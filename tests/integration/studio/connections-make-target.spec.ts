// `studio.connections-make-target-switches-aws-screens` (issue 486, test-criteria.md, Integration): emulator `A` (the
// run's) holds `<p>-on-a` and emulator `B` (the check's own) holds `<p>-on-b`, each made by a direct signed call; the
// engine holds `local` (→ `A`, the target) and `<p>b` (→ `B`), added through its API as the CLI adds it. Making `<p>b`
// the target on `/connections` switches what every AWS screen reads, and Home names it. A connection removed elsewhere
// after the page read its list is refused and changes nothing.

import { expect, OwnEmulator, startStack, test } from './support';
import { connectedAt, expectLine, lineText } from './support/aws-area';
import {
  addTarget,
  BUCKETS_PATH,
  bucketsOn,
  createBucketOn,
  endpointOf,
  expectResult,
  listTargets,
  openConnections,
  followConnections,
  removeTarget,
  row,
  rowText,
  shownBuckets,
  studioNav,
} from './support/connections';
import { ACTION, heading } from './support/frame';
import { checkPrefix } from './support/service-screens';

test('studio.connections-make-target-switches-aws-screens', async ({ page, ctx }) => {
  const p = checkPrefix(ctx, 'mt');
  const stack = await startStack(ctx);
  const a = stack.emulatorPort;
  const b = await OwnEmulator.start(ctx);
  const onA = `${p}-on-a`;
  const onB = `${p}-on-b`;
  await createBucketOn(ctx, a, onA);
  await createBucketOn(ctx, b.port, onB);
  const second = `${p}b`;
  const gone = `${p}g`;
  await addTarget(stack.engine.port, second, endpointOf(b.port));
  await addTarget(stack.engine.port, gone, endpointOf(b.port));

  await test.step('Open the bucket list on local, then make <p>b the target on /connections', async () => {
    await page.goto(BUCKETS_PATH);
    await expectLine(page, connectedAt(a));
    await expect.poll(() => shownBuckets(page, [onA, onB]), ACTION).toEqual([onA]);
    await followConnections(page, ['local', second, gone]);
    await row(page, second).getByRole('button', { name: `Make ${second} the target`, exact: true }).click(ACTION);
    await expectResult(page, `${second} is now the target. Studio's screens read its emulator.`);
    await expect.poll(() => rowText(page, second), ACTION).toMatch(new RegExp(`^Name ${second} Target `));
    expect((await listTargets(stack.engine.port, 'after Make target')).active).toBe(second);
  });

  await test.step('Go back to the bucket list in the same document: B\'s buckets, never A\'s', async () => {
    await page.goBack(ACTION);
    await expect(page).toHaveURL(new RegExp(`${BUCKETS_PATH}$`), ACTION);
    await expectLine(page, connectedAt(b.port));
    await expect.poll(async () => (await lineText(page)) ?? '', ACTION).toContain(`Target ${second}`);
    await expect.poll(() => shownBuckets(page, [onA, onB]), ACTION).toEqual([onB]);
    expect(await bucketsOn(ctx, b.port), 'B still holds its bucket').toContain(onB);
  });

  await test.step('Home names the target and links to /connections', async () => {
    await studioNav(page).getByRole('link', { name: 'Home', exact: true }).click(ACTION);
    await expect(heading(page, 'Home')).toBeVisible(ACTION);
    await expect(page.getByRole('main').getByText(`Target ${second}`, { exact: true })).toBeVisible(ACTION);
    await page.getByRole('main').getByRole('link', { name: 'Manage connections', exact: true }).click(ACTION);
    await expect(page).toHaveURL(/\/connections$/, ACTION);
    await expect(heading(page, 'Connections')).toBeVisible(ACTION);
  });

  await test.step('Failure: Make target on a connection removed elsewhere after the page read its list', async () => {
    await openConnections(page, ['local', second, gone]);
    await removeTarget(stack.engine.port, gone);
    await row(page, gone).getByRole('button', { name: `Make ${gone} the target`, exact: true }).click(ACTION);
    await expectResult(page, `${gone} is no longer a connection; it was removed elsewhere.`);
    await expect(row(page, gone)).toHaveCount(0, ACTION);
    expect((await listTargets(stack.engine.port, 'after the refused Make target')).active).toBe(second);
  });
});
