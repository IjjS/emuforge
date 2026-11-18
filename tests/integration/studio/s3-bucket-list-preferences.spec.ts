// The S3 bucket list's "Preferences" dialog across a connection check, in the built app served by `bun run serve`, in
// front of a real engine and the run's emulator (test-criteria.md, issue 462, "Flow —
// studio.s3-bucket-list-preferences-keeps-focus-across-a-connection-check"; requirement R1, R3, R4): every answer of
// the engine's connection status (`GET /__emuforge/health`, about every 5 seconds) re-renders the page around the
// open dialog, and the dialog must stay where it is, with its choice and its focus.
//
// `studio.s3-bucket-list-preferences-keeps-focus-across-a-connection-check`.
//
// "The dialog found before" and "the choice found before" are the elements themselves, held as handles before the
// answer and read with `isConnected` after it, never found again. The answer is waited for as it reaches the page,
// then its body, then two frames (`settled`), so the page has rendered what it carried. The check makes its bucket
// on the run's emulator with its own prefix `<p>` and compares under the filter `<p>`. Words and readers:
// `services/s3/s3.ts`.

import type { ElementHandle } from '@playwright/test';

import { expect, startStack, test } from './support';
import { hasFocus, settled } from './support/focus';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import { HEALTH_PATH } from './support/traffic';
import {
  bucketNamesDirect,
  CONFIRM,
  expectNames,
  filterFor,
  openList,
  pageSizeOption,
  PREFERENCES,
  screen,
  Seeded,
} from './services/s3/s3';

/** The bound for the next connection answer: two of its 5-second periods. */
const ANSWER_BOUND_MS = 10_000;

test('studio.s3-bucket-list-preferences-keeps-focus-across-a-connection-check', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'prefs');
  const bucket = `${p}-a`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(bucket);

  const dialog = page.getByRole('dialog', { name: PREFERENCES });
  const fifty = dialog.getByRole('radio', { name: pageSizeOption(50), exact: true });

  await lines.line(
    'With a bucket of the run in the emulator, open `/aws/s3/buckets`, "Preferences", choose "50 buckets" with the arrow keys, and wait for the next answer of the engine\'s connection status → the "Preferences" dialog found before is still in the page, "50 buckets" has focus and is chosen (regression)',
    async () => {
      await openList(page);
      await screen(page).preferences.click(ACTION);
      await expect(dialog, `the dialog "${PREFERENCES}"`).toBeVisible();

      // The page size the list starts with is "25 buckets"; the arrow key after it chooses "50 buckets".
      const twentyFive = dialog.getByRole('radio', { name: pageSizeOption(25), exact: true });
      await expect(twentyFive, `"${pageSizeOption(25)}" is chosen when the dialog opens`).toBeChecked();
      await twentyFive.focus(ACTION);
      await page.keyboard.press('ArrowDown');
      await expect(fifty, `"${pageSizeOption(50)}" is chosen with the arrow key`).toBeChecked();
      expect(await hasFocus(fifty), `"${pageSizeOption(50)}" has focus after the arrow key`).toBe(true);

      const dialogBefore = (await dialog.elementHandle(ACTION)) as ElementHandle<HTMLElement>;
      const fiftyBefore = (await fifty.elementHandle(ACTION)) as ElementHandle<HTMLInputElement>;

      const answer = await page.waitForResponse((r) => new URL(r.url()).pathname === HEALTH_PATH, {
        timeout: ANSWER_BOUND_MS,
      });
      await answer.finished();
      await settled(page);
      ctx.log(`connection answer after the choice: ${String(answer.status())}`);

      expect(
        await dialogBefore.evaluate((el) => el.isConnected),
        `the "${PREFERENCES}" dialog found before the answer is still in the page`,
      ).toBe(true);
      expect(
        await fiftyBefore.evaluate((el) => el.isConnected),
        `"${pageSizeOption(50)}" found before the answer is still in the page`,
      ).toBe(true);
      expect(
        await fiftyBefore.evaluate((el) => el === document.activeElement),
        `"${pageSizeOption(50)}" found before the answer has focus`,
      ).toBe(true);
      expect(
        await fiftyBefore.evaluate((el) => el.checked),
        `"${pageSizeOption(50)}" found before the answer is chosen`,
      ).toBe(true);
    },
  );

  await lines.line(
    'Then "Confirm" → the dialog closes, focus is on "Preferences", and the list shows the run\'s bucket as `ListBuckets`, asked directly, reports it',
    async () => {
      await dialog.getByRole('button', { name: CONFIRM, exact: true }).click(ACTION);
      await expect(dialog, `the dialog "${PREFERENCES}" closes`).toHaveCount(0);
      await expect
        .poll(() => hasFocus(screen(page).preferences), { message: `focus is on "${PREFERENCES}"` })
        .toBe(true);
      await filterFor(page, p);
      const direct = await bucketNamesDirect(ctx, port, p);
      expect(direct, 'a direct ListBuckets with the prefix <p> lists the bucket of the run').toEqual([bucket]);
      await expectNames(page, direct, 'the rows under the filter <p>');
    },
  );

  lines.end();
});
