// `studio.connections-target-changed-outside-studio` (issue 486, test-criteria.md, Integration): the bucket list is open
// on `local` (→ `A`) with focus on its "Refresh"; the target is made `<p>b` (→ `B`) through the engine's API, as
// `emuforge target use` would. With no action in the page and no route change, within the area's next check (5 s after
// its last answer, plus that check's own 5 s limit), the page reads `B` in place, the line names the target, the flash
// says so, and focus is on the page's content target, not on `body`.

import { expect, OwnEmulator, startStack, test } from './support';
import { connectedAt, expectLine, lineText } from './support/aws-area';
import {
  addTarget,
  BUCKETS_PATH,
  createBucketOn,
  endpointOf,
  shownBuckets,
  useTarget,
} from './support/connections';
import { ACTION } from './support/frame';
import { checkPrefix } from './support/service-screens';

/** The area's next check: 5 s after its last answer, plus that check's own 5 s limit (requirement R3). */
const NEXT_CHECK_MS = 10_000;

test('studio.connections-target-changed-outside-studio', async ({ page, ctx }) => {
  const p = checkPrefix(ctx, 'out');
  const stack = await startStack(ctx);
  const a = stack.emulatorPort;
  const b = await OwnEmulator.start(ctx);
  const onA = `${p}-on-a`;
  const onB = `${p}-on-b`;
  await createBucketOn(ctx, a, onA);
  await createBucketOn(ctx, b.port, onB);
  const second = `${p}b`;
  await addTarget(stack.engine.port, second, endpointOf(b.port));

  await page.goto(BUCKETS_PATH);
  await expectLine(page, connectedAt(a));
  await expect.poll(() => shownBuckets(page, [onA, onB]), ACTION).toEqual([onA]);
  const refresh = page.getByRole('main').getByRole('button', { name: 'Refresh Buckets', exact: true }).first();
  await refresh.focus(ACTION);
  const path = new URL(page.url()).pathname;

  await useTarget(stack.engine.port, second);

  await expect
    .poll(() => shownBuckets(page, [onA, onB]), { timeout: NEXT_CHECK_MS, message: 'the list reads B in place' })
    .toEqual([onB]);
  await expectLine(page, connectedAt(b.port), NEXT_CHECK_MS);
  await expect.poll(async () => (await lineText(page)) ?? '', ACTION).toContain(`Target ${second}`);
  // The flash list; Cloudscape also copies the text into a live region outside it.
  await expect(
    page.getByRole('list', { name: 'Notifications', exact: true }).getByText(
      new RegExp(`The target is now\\s*${second}\\.\\s*This page now reads from it\\.`),
    ),
    'the flash says the target changed',
  ).toBeVisible(ACTION);
  expect(new URL(page.url()).pathname, 'no route change').toBe(path);
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return 'body';
    if (active.closest('main') === null) return `outside main: ${active.tagName}`;
    return active.matches('h1') || active.querySelector('h1') !== null ? 'content target' : `other: ${active.tagName}`;
  });
  expect(focus, "focus is on the page's content target").toBe('content target');
});
