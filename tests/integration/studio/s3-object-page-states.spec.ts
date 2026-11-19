// An object's page (issue 480, task 2) across an emulator restart, in the built app served by `bun run serve`
// (test-criteria.md, Integration): `studio.s3-object-page-follows-emulator-restart`.
//
// The check has its own emulator (`own-emulator`): it stops and starts it, and a restarted emulator holds no bucket.
// Words and readers of the page: `services/s3/s3-object-page.ts`; `Seeded`: `services/s3/s3.ts`.

import { expect, startStack, test } from './support';
import { connectedAt, expectLine, LINE_CHANGE_BOUND_MS, notStartedOn } from './support/aws-area';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import { Seeded } from './services/s3/s3';
import { headObjectDirect, objectAddress, objectPage, OVERVIEW } from './services/s3/s3-object-page';
import { noBucket } from './services/s3/s3-objects';

test('studio.s3-object-page-follows-emulator-restart', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'object-restart');
  const name = `${p}-or`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await seeded.object(name, 'x.txt', 'before the restart');
  const shown = objectPage(page);

  await lines.line(
    'With an own emulator holding bucket `<p>-or` with `x.txt`, and `x.txt`\'s page open, stop and start the emulator → once the emulator line reads "Connected" again, the page shows "No bucket `<p>-or`", not the old values',
    async () => {
      await page.goto(objectAddress(name, 'x.txt'));
      await expect(shown.section(OVERVIEW), `"${OVERVIEW}"`).toBeVisible(ACTION);
      await expectLine(page, connectedAt(port));
      const etag = ((await headObjectDirect(ctx, port, name, 'x.txt')).etag ?? '').replace(/"/g, '');
      expect(etag, 'the old ETag, read directly').not.toBe('');
      await expect(page.getByRole('main'), 'the old ETag shown before the restart').toContainText(etag, ACTION);
      await emulator.stop();
      await expectLine(page, notStartedOn(port));
      await emulator.startAgain();
      await expectLine(page, connectedAt(port), LINE_CHANGE_BOUND_MS * 2);
      await expect(page.getByRole('main').getByText(noBucket(name), { exact: true })).toBeVisible(ACTION);
      await expect(shown.section(OVERVIEW), `no "${OVERVIEW}"`).toHaveCount(0);
      await expect(page.getByRole('main'), 'not the old ETag').not.toContainText(etag);
    },
  );

  lines.end();
});
