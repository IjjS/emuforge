// A bucket's tab "Objects" (issue 480, task 1) across an emulator restart, in the built app served by
// `bun run serve` (test-criteria.md, Integration): `studio.s3-objects-follow-emulator-restart`.
//
// The check has its own emulator (`own-emulator`): it stops and starts it, and a restarted emulator holds no bucket.
// Words and readers of the tab: `services/s3/s3-objects.ts`; `Seeded`: `services/s3/s3.ts`.

import { expect, startStack, test } from './support';
import { connectedAt, expectLine, LINE_CHANGE_BOUND_MS, notStartedOn } from './support/aws-area';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import { Seeded } from './services/s3/s3';
import { openObjectsTab } from './services/s3/s3-bucket-page';
import { expectKeys, noBucket, shownKeys } from './services/s3/s3-objects';

test('studio.s3-objects-follow-emulator-restart', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'objects-restart');
  const name = `${p}-r`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await seeded.object(name, 'a.txt', 'before the restart');

  await lines.line(
    'With an own emulator holding bucket `<p>-r` with `a.txt`, and its Objects tab open, stop and start the emulator → once the emulator line reads "Connected" again, the tab shows "No bucket `<p>-r`" (the restarted emulator holds none), not the old rows',
    async () => {
      await openObjectsTab(page, name);
      await expectKeys(page, ['a.txt'], 'the rows before the restart');
      await expectLine(page, connectedAt(port));
      await emulator.stop();
      await expectLine(page, notStartedOn(port));
      await emulator.startAgain();
      await expectLine(page, connectedAt(port), LINE_CHANGE_BOUND_MS * 2);
      await expect(page.getByRole('main').getByText(noBucket(name), { exact: true })).toBeVisible(ACTION);
      expect(await shownKeys(page), 'the old rows are gone').toEqual([]);
    },
  );

  lines.end();
});
