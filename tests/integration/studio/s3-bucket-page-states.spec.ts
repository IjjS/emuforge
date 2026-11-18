// A bucket's page while its reads are on their way, in the built app served by `bun run serve`, in front of a real
// engine started for that Studio and the run's emulator (test-criteria.md, issue 256, Flow checks; requirement R5.1,
// R11.1, R11.3).
//
// `studio.s3-bucket-page-shows-loading-until-the-answer`.
//
// A request is held back in the browser (`EngineHold`, a CDP `Fetch` session): delayed, never answered by the check;
// once let go the engine answers it. The bucket is made with the check's own prefix `<p>` on the run's emulator.
// Words and readers: `support/s3-bucket-page.ts`; direct calls and `Seeded`: `support/s3.ts`.

import { expect, startStack, test } from './support';
import { Lines } from './support/lines';
import { checkPrefix, SEOUL } from './support/service-screens';
import { bucketPropertiesDirect, listBucketsDirect, Seeded } from './services/s3/s3';
import {
  bucketPath,
  EngineHold,
  expectBucketPage,
  expectedSections,
  expectSections,
  LOADING_BUCKET,
  readSection,
  SECTION_LOADING,
  SECTIONS,
  shownSectionTitles,
  TABS,
  tab,
  VERSIONING,
} from './services/s3/s3-bucket-page';

test.use({ timezoneId: SEOUL.timeZone });

test('studio.s3-bucket-page-shows-loading-until-the-answer', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'page-loading');
  const name = `${p}-b`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  const direct = (await listBucketsDirect(ctx, port, name)).find((b) => b.name === name);
  expect(direct, `a direct ListBuckets lists ${name}`).toBeDefined();
  const expected = expectedSections(direct!, await bucketPropertiesDirect(ctx, port, name), SEOUL);

  await lines.line(
    'Open a bucket\'s page with the `ListBuckets` request held back → "Loading bucket", no tabs and no section; let it go → the tabs and sections',
    async () => {
      const hold = await EngineHold.attach(ctx, context, page, stack.engine.url, (op) => op === 'ListBuckets');
      try {
        await page.goto(bucketPath(name));
        await expect(page.getByText(LOADING_BUCKET, { exact: true }), `"${LOADING_BUCKET}"`).toBeVisible();
        await expect.poll(() => hold.count(), { message: 'a ListBuckets request is held' }).toBeGreaterThan(0);
        for (const t of TABS) await expect(tab(page, t), `the tab "${t}" while loading`).toHaveCount(0);
        expect(await shownSectionTitles(page), 'sections while loading').toEqual([]);
        await hold.release();
        await expectBucketPage(page, name);
        for (const t of TABS) await expect(tab(page, t), `the tab "${t}"`).toBeVisible();
        await expect
          .poll(async () => [...(await shownSectionTitles(page))].sort(), { message: 'the sections shown' })
          .toEqual([...SECTIONS].sort());
        await expect(page.getByText(LOADING_BUCKET, { exact: true }), `"${LOADING_BUCKET}" once answered`).toHaveCount(
          0,
        );
      } finally {
        await hold.dispose();
      }
    },
  );

  await lines.line(
    'Open it with the `GetBucketVersioning` request held back → "Loading" in "Bucket Versioning" while the other sections show their values; let it go → its value',
    async () => {
      const hold = await EngineHold.attach(ctx, context, page, stack.engine.url, (op) => op === 'GetBucketVersioning');
      try {
        await page.goto(bucketPath(name));
        await expectBucketPage(page, name);
        await expect.poll(() => hold.count(), { message: 'a GetBucketVersioning request is held' }).toBeGreaterThan(0);
        await expect
          .poll(async () => (await readSection(page, VERSIONING))?.lines.includes(SECTION_LOADING) ?? false, {
            message: `"${SECTION_LOADING}" in "${VERSIONING}"`,
          })
          .toBe(true);
        const others = Object.fromEntries(Object.entries(expected).filter(([title]) => title !== VERSIONING));
        await expectSections(page, others, 'the other sections show their values while versioning is read');
        expect(hold.count(), 'the GetBucketVersioning request is still held').toBeGreaterThan(0);
        await hold.release();
        await expectSections(page, { [VERSIONING]: expected[VERSIONING] }, `"${VERSIONING}" once answered`);
        expect((await readSection(page, VERSIONING))?.lines ?? [], `"${SECTION_LOADING}" once answered`).not.toContain(
          SECTION_LOADING,
        );
      } finally {
        await hold.dispose();
      }
    },
  );

  lines.end();
});
