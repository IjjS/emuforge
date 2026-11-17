// The S3 bucket list's states in the built app served by `bun run serve`, in front of a real engine and a real
// emulator (test-criteria.md, issue 56, Flow checks; requirement R4, R7): an emulator without buckets, pages that
// follow the emulator's tokens, the emulator stopped and started again, the engine stopped and started again, and
// the loading state while the list's request is held back.
//
// `studio.s3-bucket-list-empty-emulator-says-no-buckets`, `studio.s3-bucket-list-pages-follow-the-emulator`,
// `studio.s3-bucket-list-follows-emulator-stop-and-restart`, `studio.s3-bucket-list-says-when-the-engine-stops-answering`,
// `studio.s3-bucket-list-shows-loading-until-the-answer`.
//
// The checks that need the whole list (empty, paging, restart) start their own emulator; the others make their
// buckets on the run's emulator with their own prefix `<p>` and compare under the filter `<p>`. "Within two
// connection checks" is the emulator line's bound (`LINE_CHANGE_BOUND_MS`). The loading check holds the request in
// the browser (`ListBucketsHold`); nothing answers it but the engine. Words and readers: `support/s3.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, engineNotAnswering, expectLine, LINE_CHANGE_BOUND_MS, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, expectHome } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';
import { appeared, checkPrefix, watchText } from './support/service-screens';
import {
  bucketNamesDirect,
  counter,
  CREATE,
  expectNames,
  filterFor,
  ListBucketsHold,
  LOADING,
  NO_BUCKETS,
  NOT_READ,
  openList,
  REFRESH,
  RETRY,
  screen,
  Seeded,
  setPreferences,
  shownNames,
  shownPreferences,
  pageSizeOption,
  TABLE_TITLE,
  titleText,
} from './services/s3/s3';

/** The emulator line's "Connection status" link, here the one inside the table. */
const CONNECTION_STATUS = 'Connection status';

/** How long a screen may take to read again by itself once the connection is back: the line's bound, twice. */
const BACK_BOUND_MS = 2 * LINE_CHANGE_BOUND_MS;

/** The failure state's parts inside the table: its status text, "The bucket list could not be read." and "Retry". */
async function expectFailure(page: Page, status: RegExp, withConnectionStatus: boolean): Promise<void> {
  const table = screen(page).table;
  await expect(table.getByText(status), `the table shows ${String(status)}`).toBeVisible({
    timeout: LINE_CHANGE_BOUND_MS,
  });
  await expect(table.getByText(NOT_READ, { exact: true }), `"${NOT_READ}"`).toBeVisible();
  await expect(table.getByRole('button', { name: RETRY, exact: true }), `"${RETRY}"`).toBeVisible();
  if (withConnectionStatus) {
    await expect(
      table.getByRole('link', { name: CONNECTION_STATUS, exact: true }),
      `"${CONNECTION_STATUS}"`,
    ).toBeVisible();
  }
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-empty-emulator-says-no-buckets', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'empty');
  const seeded = new Seeded(ctx, port);
  const s = screen(page);

  await lines.line(
    'Open `/aws/s3/buckets` on an emulator without buckets → "No buckets", the heading "General purpose buckets (0)", and a direct `ListBuckets` returns none',
    async () => {
      await openList(page);
      await expect(s.empty.getByText(NO_BUCKETS, { exact: true }), `"${NO_BUCKETS}"`).toBeVisible();
      await expect.poll(() => titleText(page), { message: "the table's title" }).toBe(`${TABLE_TITLE} (0)`);
      expect(await bucketNamesDirect(ctx, port), 'a direct ListBuckets').toEqual([]);
    },
  );

  await lines.line(
    'Choose the empty state\'s "Create bucket" → the address is `/aws/s3/bucket/create` and a direct `ListBuckets` still returns none',
    async () => {
      await s.empty.getByRole('button', { name: CREATE, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws/s3/bucket/create'));
      expect(await bucketNamesDirect(ctx, port), 'a direct ListBuckets').toEqual([]);
    },
  );

  await lines.line(
    'Make one bucket directly, go back, choose "Refresh Buckets" → one row with its name, and the heading ends "(1)"',
    async () => {
      await seeded.bucket(`${p}-only`);
      await page.goBack();
      await expect(s.h1).toBeVisible();
      await s.action(REFRESH).click(ACTION);
      await expectNames(page, [`${p}-only`], 'the rows after "Refresh Buckets"');
      await expect.poll(() => titleText(page), { message: "the table's title" }).toMatch(/\(1\)$/);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-pages-follow-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'pages');
  const seeded = new Seeded(ctx, port);
  const made = Array.from({ length: 12 }, (_, i) => `${p}-${String(i + 1).padStart(2, '0')}`);
  for (const name of made) await seeded.bucket(name);
  const direct = await bucketNamesDirect(ctx, port);
  expect([...direct].sort(), 'a direct ListBuckets lists the twelve buckets').toEqual([...made].sort());
  const s = screen(page);

  await lines.line(
    'Open the screen, set the page size to "10 buckets" → ten rows, the first ten names of a direct `ListBuckets`, the heading ends "(10+)"',
    async () => {
      await openList(page);
      await expectNames(page, direct, 'the rows at the start (page size 25)');
      await setPreferences(page, { pageSize: 10 });
      await expectNames(page, direct.slice(0, 10), 'the rows with the page size 10');
      await expect.poll(() => counter(page), { message: 'the counter' }).toBe('10+');
    },
  );

  await lines.line(
    '"Next page" → the two remaining names, the heading ends "(12)", "Next page" is disabled',
    async () => {
      await s.nextPage.click(ACTION);
      await expectNames(page, direct.slice(10), 'the rows of page 2');
      await expect.poll(() => counter(page), { message: 'the counter' }).toBe('12');
      await expect(s.nextPage, '"Next page" on the last page').toBeDisabled();
    },
  );

  await lines.line('"Previous page" → the first ten again', async () => {
    await s.previousPage.click(ACTION);
    await expectNames(page, direct.slice(0, 10), 'the rows of page 1');
  });

  await lines.line('Set the page size to "25 buckets" → all twelve on one page, the heading ends "(12)"', async () => {
    await setPreferences(page, { pageSize: 25 });
    await expectNames(page, direct, 'the rows with the page size 25');
    await expect.poll(() => counter(page), { message: 'the counter' }).toBe('12');
  });

  await lines.line(
    'Set the page size to "10 buckets" and "Wrap lines" off, then read the storage of Studio\'s origin → `localStorage` holds no key but `emuforge.studio.language`, `sessionStorage` and IndexedDB hold nothing, and none of the twelve bucket names is in any stored value',
    async () => {
      await setPreferences(page, { pageSize: 10, wrapLines: false });
      await expectNames(page, direct.slice(0, 10), 'the rows with the page size 10');
      const storage = await page.evaluate(async () => {
        const databases: string[] = [];
        const rows: string[] = [];
        for (const info of await indexedDB.databases()) {
          if (!info.name) continue;
          databases.push(info.name);
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(info.name!);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          for (const store of db.objectStoreNames) {
            const all = await new Promise<unknown[]>((resolve, reject) => {
              const request = db.transaction(store, 'readonly').objectStore(store).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            for (const row of all) rows.push(`${info.name}/${store}: ${JSON.stringify(row)}`);
          }
          db.close();
        }
        return {
          local: Object.entries(localStorage),
          session: Object.entries(sessionStorage),
          databases,
          rows,
        };
      });
      ctx.log(
        `storage: localStorage keys ${JSON.stringify(storage.local.map(([k]) => k))}, sessionStorage keys ${JSON.stringify(storage.session.map(([k]) => k))}, IndexedDB ${JSON.stringify(storage.databases)}`,
      );
      expect(
        storage.local.map(([k]) => k).filter((k) => k !== 'emuforge.studio.language'),
        'localStorage keys but emuforge.studio.language',
      ).toEqual([]);
      expect(storage.session, 'sessionStorage').toEqual([]);
      expect(storage.databases, 'IndexedDB databases').toEqual([]);
      expect(storage.rows, 'IndexedDB rows').toEqual([]);
      const values = [...storage.local, ...storage.session].map(([k, v]) => `${k}=${v}`).concat(storage.rows);
      expect(
        values.filter((v) => made.some((name) => v.includes(name))),
        'stored values that hold a bucket name',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Reload → all twelve rows on one page, and "Preferences" shows "25 buckets" selected and "Wrap lines" on',
    async () => {
      await page.reload();
      await expect(s.h1).toBeVisible();
      await expectNames(page, direct, 'the rows after the reload');
      expect(await shownPreferences(page), '"Preferences" after the reload').toEqual({
        pageSize: pageSizeOption(25),
        wrapLines: true,
      });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-follows-emulator-stop-and-restart', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'restart');
  const kept = `${p}-kept`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(kept);
  const s = screen(page);

  await openList(page);
  await expectNames(page, [kept], 'the rows before the emulator stops');
  await markPage(page);

  await lines.line(
    'Stop the emulator and choose "Refresh Buckets" → within two connection checks the table shows "Not started on port `<port>`", as the emulator line does, with "The bucket list could not be read.", "Connection status" and "Retry"; the bucket\'s row is gone',
    async () => {
      await emulator.stop();
      await s.action(REFRESH).click(ACTION);
      await expectFailure(page, notStartedOn(port), true);
      await expectLine(page, notStartedOn(port));
      expect(await shownNames(page), "the bucket's row").toEqual([]);
      await expect(s.table.getByText(kept, { exact: true })).toHaveCount(0);
    },
  );

  await lines.line('"Connection status" → Home; Back → the same state', async () => {
    await s.table.getByRole('link', { name: CONNECTION_STATUS, exact: true }).click(ACTION);
    await expectHome(page);
    await page.goBack();
    await expect(s.h1).toBeVisible();
    await expectFailure(page, notStartedOn(port), true);
    expect(await shownNames(page), "the bucket's row").toEqual([]);
  });

  await lines.line(
    'Start an emulator on the same port → without a reload and without any action the table shows "No buckets" (the restarted emulator holds none, as a direct `ListBuckets` confirms) and never the earlier bucket',
    async () => {
      await watchText(page, kept);
      await emulator.startAgain();
      await expect(s.empty.getByText(NO_BUCKETS, { exact: true }), `"${NO_BUCKETS}" by itself`).toBeVisible({
        timeout: BACK_BOUND_MS,
      });
      expect(await bucketNamesDirect(ctx, port), 'a direct ListBuckets of the restarted emulator').toEqual([]);
      expect(await appeared(page, kept), `${kept} appeared after the restart`).toBe(false);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-says-when-the-engine-stops-answering', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const engine = stack.engine;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'engine');
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(`${p}-a`);
  const s = screen(page);
  let running = true;

  await openList(page);
  await filterFor(page, p);
  await expectNames(page, [`${p}-a`], 'the rows under the filter <p>');
  await markPage(page);

  await lines.line(
    'Stop the engine and choose "Refresh Buckets" → within two connection checks the table shows "The EmuForge engine at `<engine origin>` is not answering", as the emulator line does, with "The bucket list could not be read." and "Retry"',
    async () => {
      await engine.stop();
      running = false;
      await s.action(REFRESH).click(ACTION);
      await expectFailure(page, engineNotAnswering(engine.url), false);
      await expectLine(page, engineNotAnswering(engine.url));
    },
  );

  await lines.line(
    'Start the engine again → without a reload the rows return (the filter `<p>` lists what a direct `ListBuckets` returns)',
    async () => {
      if (running) await engine.stop();
      await engine.startAgain();
      await expectLine(page, connectedAt(port));
      const direct = await bucketNamesDirect(ctx, port, p);
      if ((await s.filter.inputValue(ACTION)) !== p) await filterFor(page, p);
      await expectNames(page, direct, 'the rows under the filter <p> once the engine answers', BACK_BOUND_MS);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-shows-loading-until-the-answer', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'loading');
  const seeded = new Seeded(ctx, stack.emulatorPort);
  await seeded.bucket(`${p}-a`);
  const s = screen(page);
  const hold = await ListBucketsHold.attach(ctx, context, page, stack.engine.url);

  await lines.line(
    'Open the screen with the `ListBuckets` request held back (delayed, not answered by the check) → "Loading buckets", no counter after the heading, and the filter disabled',
    async () => {
      await openList(page);
      await expect.poll(() => hold.count(), { message: 'a ListBuckets request is held' }).toBeGreaterThan(0);
      await expect(s.table.getByText(LOADING, { exact: true }), `"${LOADING}"`).toBeVisible();
      expect(await titleText(page), "the table's title, without a counter").toBe(TABLE_TITLE);
      await expect(s.filter, 'the filter while loading').toBeDisabled();
    },
  );

  await lines.line('Let the request go → the rows, a counter, and the filter enabled', async () => {
    await hold.release();
    await expect.poll(async () => (await shownNames(page)).length, { message: 'rows are shown' }).toBeGreaterThan(0);
    await expect.poll(() => counter(page), { message: 'the counter' }).not.toBeNull();
    await expect(s.filter, 'the filter once loaded').toBeEnabled();
  });

  await hold.stop();
  lines.end();
});
