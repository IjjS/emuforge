// A bucket's tab "Objects" (issue 480, task 1) in the built app served by `bun run serve`, in front of a real engine
// and the run's emulator (test-criteria.md, Integration): it shows what an app wrote, folder by folder; it pages
// through the emulator's answer; it says so when the bucket is gone.
//
// `studio.s3-objects-show-what-an-app-wrote`, `studio.s3-objects-page-through-the-emulator-answer`,
// `studio.s3-objects-of-a-bucket-that-is-gone`.
//
// "The test's client" is the check's own signed requests to the emulator (`Seeded`, `listObjectsDirect`), standing
// for the developer's app or the AWS CLI. Every bucket carries the check's prefix `<p>`. Words and readers of the tab:
// `services/s3/s3-objects.ts`; its address: `services/s3/s3-bucket-page.ts`; the bucket list and `Seeded`:
// `services/s3/s3.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix, SEOUL } from './support/service-screens';
import { H1 as BUCKETS_H1, openList, screen, Seeded } from './services/s3/s3';
import { EngineRecord, expectBucketPage, OBJECTS, openObjectsTab } from './services/s3/s3-bucket-page';
import {
  crumb,
  crumbsShown,
  expectedFolderRow,
  expectedObjectRow,
  expectKeys,
  listObjectsDirect,
  NO_MATCHES,
  noBucket,
  objectsAddress,
  objectsTab,
  objectsTitleText,
  shownObjectRows,
} from './services/s3/s3-objects';

test.describe(() => {
  // "Last modified" reads in the zone the check sets on its browser context.
  test.use({ timezoneId: SEOUL.timeZone });

  test('studio.s3-objects-show-what-an-app-wrote', async ({ ctx, page }) => {
    const stack = await startStack(ctx);
    const port = stack.emulatorPort;
    const lines = new Lines(ctx);
    const p = checkPrefix(ctx, 'objects-app');
    const name = `${p}-app`;
    const seeded = new Seeded(ctx, port);
    await seeded.bucket(name);
    await seeded.object(name, 'a.txt', 'twelve bytes');
    for (const key of ['q?#%.txt', 'logs/2026/x.json', 'logs/2026/y.json', '한글/파일.txt']) {
      await seeded.object(name, key, `{"key":${JSON.stringify(key)}}`);
    }
    const tab = objectsTab(page);

    await lines.line(
      'Choose the bucket\'s name in the bucket list → the address is `/aws/s3/buckets/<p>-app`, the tab "Objects" is selected, and the rows are the folders `logs/` and `한글/` then the objects `a.txt` and `q?#%.txt`, each object with its size and last-modified time as `ListObjectsV2` reports them',
      async () => {
        await openList(page);
        await screen(page).filter.fill(name);
        await screen(page).nameLink(name).click(ACTION);
        await expect(page).toHaveURL(addressOf(objectsAddress(name)));
        await expectBucketPage(page, name, OBJECTS);
        const direct = await listObjectsDirect(ctx, port, name);
        ctx.log(`direct ListObjectsV2: ${JSON.stringify(direct)}`);
        expect(direct.folders, 'the direct answer: its folders').toEqual(['logs/', '한글/']);
        expect(
          direct.objects.map((o) => o.key),
          'the direct answer: its objects',
        ).toEqual(['a.txt', 'q?#%.txt']);
        expect(direct.objects[0]?.size, 'the direct answer: a.txt holds 12 bytes').toBe(12);
        await expect
          .poll(() => shownObjectRows(page), { message: 'the rows', ...ACTION })
          .toEqual([
            ...direct.folders.map((f) => expectedFolderRow(f, '')),
            ...direct.objects.map((o) => expectedObjectRow(o, '', SEOUL)),
          ]);
      },
    );

    await lines.line(
      "Open `logs/`, then `2026/` → the rows are `x.json` and `y.json` and the last crumbs are `<p>-app` > `logs` > `2026`, the last not a link; choose the crumb `logs` → the rows are `2026/`; the browser's Back → `x.json` and `y.json` again",
      async () => {
        await openObjectsTab(page, name);
        await tab.keyLink('logs/').click(ACTION);
        await expect(page).toHaveURL(addressOf(objectsAddress(name, 'logs/')));
        await tab.keyLink('2026/').click(ACTION);
        await expect(page).toHaveURL(addressOf(objectsAddress(name, 'logs/2026/')));
        await expectKeys(page, ['x.json', 'y.json'], 'the rows in logs/2026/');
        await expect
          .poll(async () => (await crumbsShown(page)).slice(-3), { message: 'the last three crumbs', ...ACTION })
          .toEqual([
            { text: name, link: true },
            { text: 'logs', link: true },
            { text: '2026', link: false },
          ]);
        await crumb(page, 'logs').click(ACTION);
        await expect(page).toHaveURL(addressOf(objectsAddress(name, 'logs/')));
        await expectKeys(page, ['2026/'], 'the rows in logs/');
        await page.goBack();
        await expect(page).toHaveURL(addressOf(objectsAddress(name, 'logs/2026/')));
        await expectKeys(page, ['x.json', 'y.json'], 'the rows in logs/2026/ after Back');
      },
    );

    await lines.line(
      'In `logs/2026/`, type `x` in "Find objects by prefix" → only `x.json`; type `z` → "No matches"',
      async () => {
        await openObjectsTab(page, name, 'logs/2026/');
        await expectKeys(page, ['x.json', 'y.json'], 'the rows in logs/2026/');
        await tab.find.fill('x');
        await expectKeys(page, ['x.json'], 'the rows found by "x"');
        await tab.find.fill('z');
        await expectKeys(page, [], 'no row found by "z"');
        await expect(tab.table.getByText(NO_MATCHES, { exact: true }), `"${NO_MATCHES}"`).toBeVisible();
      },
    );

    await lines.line(
      'Put `b.txt` with the test\'s client while the tab is open, then "Refresh" → `b.txt` is a row',
      async () => {
        await openObjectsTab(page, name);
        await expectKeys(page, ['logs/', '한글/', 'a.txt', 'q?#%.txt'], 'the rows at the root');
        await seeded.object(name, 'b.txt', 'put while the tab is open');
        await tab.refresh.click(ACTION);
        await expectKeys(page, ['logs/', '한글/', 'a.txt', 'b.txt', 'q?#%.txt'], 'the rows after "Refresh"');
      },
    );

    lines.end();
  });
});

test('studio.s3-objects-page-through-the-emulator-answer', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'objects-many');
  const name = `${p}-many`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  const keys = Array.from({ length: 120 }, (_, i) => `k/${String(i).padStart(3, '0')}.txt`);
  await seeded.objects(name, keys, 'one of many');
  const record = EngineRecord.attach(ctx, context, stack.engine.url);
  const tab = objectsTab(page);
  const shown = (from: number, to: number) => keys.slice(from, to).map((k) => k.slice('k/'.length));

  await lines.line(
    'Open `k/` with the page size 100 → 100 rows and the counter shows more remain; the next page → the other 20; the previous page → the first 100 again; every `ListObjectsV2` Studio sent asked at most 100 keys',
    async () => {
      await openObjectsTab(page, name, 'k/');
      await expectKeys(page, shown(0, 100), 'the first page: 100 rows');
      await expect.poll(() => objectsTitleText(page), { message: 'the counter', ...ACTION }).toBe('Objects (100+)');
      await tab.nextPage.click(ACTION);
      await expectKeys(page, shown(100, 120), 'the next page: the other 20');
      await tab.previousPage.click(ACTION);
      await expectKeys(page, shown(0, 100), 'the previous page: the first 100 again');
      const lists = record.requests.filter((r) => r.bucket === name && r.query['list-type'] === '2');
      record.log();
      expect(lists.length, 'Studio sent ListObjectsV2').toBeGreaterThan(0);
      expect(
        lists.filter((r) => !(Number(r.query['max-keys']) > 0 && Number(r.query['max-keys']) <= 100)),
        'ListObjectsV2 that asked more than 100 keys, or named no limit',
      ).toEqual([]);
    },
  );

  lines.end();
});

test('studio.s3-objects-of-a-bucket-that-is-gone', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'objects-gone');
  const gone = `${p}-gone`;
  const never = `${p}-never`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(gone);
  const tab = objectsTab(page);

  await lines.line(
    'Open its Objects tab, delete the bucket with the test\'s client, "Refresh" → "No bucket `<p>-gone`" with "Go to Buckets"; open `/aws/s3/buckets/<p>-never` → the same state for that name',
    async () => {
      await openObjectsTab(page, gone);
      await expect(tab.refresh, '"Refresh"').toBeEnabled(ACTION);
      await seeded.remove(gone);
      await tab.refresh.click(ACTION);
      await expect(page.getByRole('main').getByText(noBucket(gone), { exact: true })).toBeVisible(ACTION);
      await expect(tab.goToBuckets, '"Go to Buckets"').toBeVisible();
      await tab.goToBuckets.click(ACTION);
      await expect(heading(page, BUCKETS_H1), `the bucket list's h1 "${BUCKETS_H1}"`).toBeVisible(ACTION);

      await page.goto(objectsAddress(never));
      await expect(page.getByRole('main').getByText(noBucket(never), { exact: true })).toBeVisible(ACTION);
      await expect(tab.goToBuckets, '"Go to Buckets"').toBeVisible();
    },
  );

  lines.end();
});
