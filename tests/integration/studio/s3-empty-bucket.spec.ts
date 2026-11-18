// "Empty bucket" and its status in the built app served by `bun run serve`, in front of a real engine started for that
// Studio and the run's emulator (test-criteria.md, issue 256, Flow checks; requirement R8, R9.4): an emptied bucket
// holds no version and no delete marker, read directly; what the emulator refuses to delete is reported and stays;
// leaving the page stops the emptying.
//
// `studio.s3-empty-bucket-deletes-everything`, `studio.s3-empty-bucket-reports-what-could-not-be-deleted`,
// `studio.s3-empty-bucket-stops-when-the-page-is-left`.
//
// Each check names its buckets with its own prefix `<p>` and reads them back directly by name; every bucket is made
// by `Seeded`, so whatever the page did, it is emptied of every version (its legal holds taken off) and removed when
// the check ends. The 1000 objects are put directly, 16 at a time. A request is held back in the browser
// (`EngineHold`): delayed, never answered by the check. Words and readers: `support/s3-bucket-actions.ts`; direct
// calls and `Seeded`: `support/s3.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { crumbLink } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  BUCKETS_PATH,
  bucketNamesDirect,
  deleteItemsDirect,
  EMPTY,
  expectNames,
  filterFor,
  H1,
  objectKeysDirect,
  objectVersionsDirect,
  openList,
  REFRESH,
  screen,
  Seeded,
} from './services/s3/s3';
import { EngineHold } from './services/s3/s3-bucket-page';
import {
  DELETE_H1,
  deletedCount,
  deletedItem,
  deletePage,
  deletePath,
  EMPTY_H1,
  emptiedResult,
  emptyPage,
  emptyPath,
  EngineAnswers,
  expectFlash,
  expectPageShows,
  failedResult,
  FAILURES_TITLE,
  failureRows,
  ITEM_MEANS,
  NOT_EMPTY,
  openEmptyPage,
  pageShowsError,
  startEmptying,
  STATUS_H1,
} from './services/s3/s3-bucket-actions';

/** Waits for the bucket list. */
async function expectList(page: Page): Promise<void> {
  await expect(page).toHaveURL(addressOf(BUCKETS_PATH));
  await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
}

/** Waits until the status and the flash both show the success `result`. */
async function expectEmptied(page: Page, result: string, timeout = 30_000): Promise<void> {
  await expectPageShows(page, result, `the status shows "${result}"`, timeout);
  await expectFlash(page, 'success', result);
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-empty-bucket-deletes-everything', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'empty-all');
  const seeded = new Seeded(ctx, port);
  const e = emptyPage(page);

  /** Every item of `name`, directly; `[]` when it holds none. */
  const itemsOf = async (name: string) => (await objectVersionsDirect(ctx, port, name)) ?? [];

  await lines.line(
    'With an unversioned bucket of five objects whose keys hold a space, Hangul, `&<>`, `//` and `?#%`, select it in the list, "Empty", type the name, "Empty" → `h1` "Empty bucket: Status", then "Bucket “<name>” is empty. 5 items deleted from the local emulator." in the status and the flash; a direct `ListObjectVersions` returns nothing',
    async () => {
      const name = `${p}-keys`;
      await seeded.bucket(name);
      const keys = ['with space.txt', '한글 이름.txt', 'a&<>b.txt', 'dir//double.txt', 'odd?#%.txt'];
      for (const key of keys) await seeded.object(name, key, key);
      expect((await objectKeysDirect(ctx, port, name)).sort(), `the five keys of ${name}, directly`).toEqual(
        [...keys].sort(),
      );
      await openList(page);
      await filterFor(page, name);
      await expectNames(page, [name], `the rows under the filter ${name}`);
      await screen(page).radio(name).check(ACTION);
      await screen(page).action(EMPTY).click(ACTION);
      await expect(page).toHaveURL(addressOf(emptyPath(name)));
      await expect(e.h1, `the empty page's h1 "${EMPTY_H1}"`).toBeVisible();
      await e.field.fill(name, ACTION);
      await e.empty.click(ACTION);
      await expect(e.statusH1, `the h1 "${STATUS_H1}"`).toBeVisible();
      await expectEmptied(page, emptiedResult(name, 5));
      expect(await itemsOf(name), `a direct ListObjectVersions of ${name}`).toEqual([]);
    },
  );

  await lines.line(
    'With a versioned bucket of three versions of one key, two other objects and a delete marker → "6 items deleted", and directly no version and no delete marker',
    async () => {
      const name = `${p}-versions`;
      await seeded.bucket(name);
      await seeded.configure(name, { versioning: 'Enabled' });
      for (const body of ['one', 'two', 'three']) await seeded.object(name, 'many.txt', body);
      await seeded.object(name, 'other-1.txt', 'other');
      await seeded.object(name, 'other-2.txt', 'other');
      await seeded.deleteMarker(name, 'other-2.txt');
      expect((await itemsOf(name)).length, `the six items of ${name}, directly`).toBe(6);
      await openEmptyPage(page, name);
      await startEmptying(page, name);
      await expectEmptied(page, emptiedResult(name, 6));
      await expectPageShows(page, deletedCount(6), '"6 items deleted"');
      expect(await itemsOf(name), `a direct ListObjectVersions of ${name}`).toEqual([]);
    },
  );

  await lines.line(
    'With a bucket whose versioning was suspended after two versions and one object written since → all three gone directly',
    async () => {
      const name = `${p}-suspended`;
      await seeded.bucket(name);
      await seeded.configure(name, { versioning: 'Enabled' });
      await seeded.object(name, 'kept.txt', 'first');
      await seeded.object(name, 'kept.txt', 'second');
      await seeded.configure(name, { versioning: 'Suspended' });
      await seeded.object(name, 'since.txt', 'since');
      expect((await itemsOf(name)).length, `the three items of ${name}, directly`).toBe(3);
      await openEmptyPage(page, name);
      await startEmptying(page, name);
      await expectEmptied(page, emptiedResult(name, 3));
      expect(await itemsOf(name), `a direct ListObjectVersions of ${name}`).toEqual([]);
    },
  );

  await lines.line('With a bucket of 1000 objects → "1000 items deleted" and nothing left directly', async () => {
    const name = `${p}-thousand`;
    await seeded.bucket(name);
    await seeded.objects(
      name,
      Array.from({ length: 1000 }, (_, i) => `object-${String(i).padStart(4, '0')}.txt`),
      'x',
    );
    expect((await itemsOf(name)).length, `the 1000 items of ${name}, directly`).toBe(1000);
    await openEmptyPage(page, name);
    await startEmptying(page, name);
    await expectEmptied(page, emptiedResult(name, 1000), 60_000);
    await expectPageShows(page, deletedCount(1000), '"1000 items deleted"');
    expect(await itemsOf(name), `a direct ListObjectVersions of ${name}`).toEqual([]);
  });

  await lines.line('With an empty bucket → "Bucket “<name>” was already empty."', async () => {
    const name = `${p}-none`;
    await seeded.bucket(name);
    await openEmptyPage(page, name);
    await startEmptying(page, name);
    await expectEmptied(page, emptiedResult(name, 0));
  });

  await lines.line(
    'On the status, "Delete bucket" → the delete page of that bucket without the alert; delete it → gone directly',
    async () => {
      const name = `${p}-then-delete`;
      await seeded.bucket(name);
      await seeded.object(name, 'one.txt', 'one');
      await openEmptyPage(page, name);
      await startEmptying(page, name);
      await expectEmptied(page, emptiedResult(name, 1));
      await expectPageShows(page, ITEM_MEANS, `"${ITEM_MEANS}"`);
      await e.deleteLink.click(ACTION);
      await expect(page).toHaveURL(addressOf(deletePath(name)));
      const d = deletePage(page);
      await expect(d.h1, `the delete page's h1 "${DELETE_H1}"`).toBeVisible();
      await expect(d.field, 'the confirmation field').toBeEnabled();
      await expect(d.alert, `the alert "${NOT_EMPTY}"`).toHaveCount(0);
      await d.field.fill(name, ACTION);
      await d.delete.click(ACTION);
      await expectList(page);
      await expectFlash(page, 'success', deletedItem(name));
      expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets under ${name}`).not.toContain(name);
    },
  );

  await lines.line(
    'Before "Empty": a wrong text leaves "Empty" disabled; "Cancel" → the list and the objects still exist directly',
    async () => {
      const name = `${p}-cancel`;
      await seeded.bucket(name);
      await seeded.object(name, 'a.txt', 'a');
      await seeded.object(name, 'b.txt', 'b');
      await openEmptyPage(page, name);
      await e.field.fill(`${name}x`, ACTION);
      await expect(e.empty, '"Empty" with a wrong text').toBeDisabled();
      await e.cancel.click(ACTION);
      await expectList(page);
      expect((await objectKeysDirect(ctx, port, name)).sort(), `the objects of ${name}, directly`).toEqual([
        'a.txt',
        'b.txt',
      ]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-empty-bucket-reports-what-could-not-be-deleted', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'empty-held');
  const name = `${p}-lock`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name, 'us-east-1', { objectLock: true });
  const held = await seeded.object(name, 'held.txt', 'held');
  await seeded.object(name, 'free.txt', 'free');
  expect(held, 'the version id of held.txt').not.toBeNull();
  await seeded.legalHold(name, 'held.txt', held!, 'ON');

  await lines.line(
    'With an Object Lock bucket holding two objects, one under a legal hold → an error in the status and the flash, "1 item could not be deleted from bucket “<name>”. 1 item deleted.", and the table "Could not be deleted" with the held key, its version id and the emulator\'s code and message; directly, only the held version remains',
    async () => {
      const result = failedResult(name, 1, 1);
      await openEmptyPage(page, name);
      await startEmptying(page, name);
      await expect
        .poll(() => pageShowsError(page, result), { timeout: 30_000, message: `an error in the status: "${result}"` })
        .toBe(true);
      await expectFlash(page, 'error', result);
      await expectPageShows(page, FAILURES_TITLE, `the table "${FAILURES_TITLE}"`);
      const left = (await objectVersionsDirect(ctx, port, name)) ?? [];
      expect(
        left.map((i) => [i.key, i.versionId]),
        `directly, only the held version of ${name} remains`,
      ).toEqual([['held.txt', held]]);
      // The emulator's own code and message for that version: a direct `DeleteObjects` of it, which it refuses again.
      const refused = await deleteItemsDirect(ctx, port, name, [{ key: 'held.txt', versionId: held! }]);
      ctx.log(`direct DeleteObjects of the held version: ${JSON.stringify(refused)}`);
      expect(refused.length, 'the emulator refuses the held version directly').toBe(1);
      await expect
        .poll(() => failureRows(page), { message: `the rows of "${FAILURES_TITLE}"` })
        .toEqual([
          { Key: 'held.txt', 'Version ID': held, Error: `${refused[0]?.code ?? ''}: ${refused[0]?.message ?? ''}` },
        ]);
    },
  );

  await lines.line(
    'Take the hold off directly, open the empty page again and empty → "1 item deleted" and nothing left directly',
    async () => {
      // The Given: only the held version is left, whatever the line before did.
      const others = ((await objectVersionsDirect(ctx, port, name)) ?? []).filter((i) => i.key !== 'held.txt');
      if (others.length > 0) await deleteItemsDirect(ctx, port, name, others);
      await seeded.legalHold(name, 'held.txt', held!, 'OFF');
      await openEmptyPage(page, name);
      await startEmptying(page, name);
      await expectPageShows(page, deletedCount(1), '"1 item deleted" in the status', 30_000);
      await expectFlash(page, 'success', deletedCount(1));
      expect((await objectVersionsDirect(ctx, port, name)) ?? [], `a direct ListObjectVersions of ${name}`).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-empty-bucket-stops-when-the-page-is-left', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'empty-left');
  const name = `${p}-b`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  const keys = ['one.txt', 'two.txt', 'three.txt'];
  for (const key of keys) await seeded.object(name, key, key);
  const answers = EngineAnswers.attach(ctx, context, stack.engine.url);

  await lines.line(
    'With a bucket of three objects, start the emptying with its first listing held back (delayed, not answered by the check), leave for the list, let the request go → no `DeleteObjects` leaves the page, and directly the three objects are still there',
    async () => {
      await openEmptyPage(page, name);
      const e = emptyPage(page);
      await e.field.fill(name, ACTION);
      const hold = await EngineHold.attach(ctx, context, page, stack.engine.url, (op) => op === 'ListObjectVersions');
      try {
        await e.empty.click(ACTION);
        await expect.poll(() => hold.count(), { message: 'the first ListObjectVersions is held' }).toBeGreaterThan(0);
        await crumbLink(page, 'Buckets').click(ACTION);
        await expectList(page);
        await hold.release();
        // The held listing ends (answered, or aborted by the page), then one more round trip of the list: a
        // `DeleteObjects` that its answer would have started leaves before the list's next request is answered.
        await answers.settle('the held listing ends');
        const before = answers.of('ListBuckets').filter((c) => c.status !== null).length;
        await screen(page).action(REFRESH).click(ACTION);
        await expect
          .poll(() => answers.of('ListBuckets').filter((c) => c.status !== null).length, {
            message: 'the list is read again',
          })
          .toBeGreaterThan(before);
        await answers.settle('every request of the page ends');
      } finally {
        await hold.dispose();
      }
      answers.log();
      expect(answers.of('ListObjectVersions', name).length, 'the emptying started (a listing left)').toBeGreaterThan(0);
      expect(answers.of('DeleteObjects', name), 'DeleteObjects requests of the page').toEqual([]);
      expect((await objectKeysDirect(ctx, port, name)).sort(), `the objects of ${name}, directly`).toEqual(
        [...keys].sort(),
      );
    },
  );

  lines.end();
});
