// A bucket's page in the built app served by `bun run serve`, in front of a real engine started for that Studio and
// the run's emulator (test-criteria.md, issue 256, Flow checks; requirement R4, R5, R9, R10): every property a bucket
// made directly holds, a bucket with nothing set, the reads on opening and on "Refresh", and where its tabs and
// buttons lead.
//
// `studio.s3-bucket-page-shows-the-bucket-properties`, `studio.s3-bucket-page-of-a-plain-bucket-shows-nothing-set`,
// `studio.s3-bucket-page-rereads-on-open-and-refresh`, `studio.s3-bucket-page-controls-lead-to-their-routes`.
//
// Other checks make buckets on the run's emulator at the same time, so each check names its buckets with its own
// prefix `<p>` and reads them by name. What a section should show is written from direct reads of the same bucket
// (`expectedSections`). Words and readers: `support/s3-bucket-page.ts`; direct calls and `Seeded`: `support/s3.ts`.

import { expect, startStack, test } from './support';
import { connectedAt, crumbLink, crumbs, emulatorLine, endpointPattern, expectLine } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';
import {
  bucketPropertiesDirect,
  checkPrefix,
  expectNames,
  filterFor,
  H1,
  listBucketsDirect,
  NOTICE,
  openList,
  regionText,
  screen,
  Seeded,
  SEOUL,
} from './support/s3';
import {
  ABAC,
  ACCELERATION,
  bucketPath,
  ENCRYPTION,
  EVENTBRIDGE,
  EVENTBRIDGE_FIELD,
  expectBucketPage,
  expectedSections,
  expectSections,
  LOGGING,
  NO_CONFIGURATIONS,
  NO_NOTIFICATIONS,
  NO_TAGS,
  NOTIFICATIONS,
  OBJECT_LOCK,
  openBucketPage,
  OTHER_TABS,
  OVERVIEW,
  PROPERTIES,
  propertiesPath,
  readSection,
  REFRESH,
  REQUESTER_PAYS,
  SECTION_BUTTONS,
  sectionButton,
  SECTIONS,
  shownSectionTitles,
  SSE_S3,
  tab,
  tabPath,
  TAGS,
  TIERING,
  VERSIONING,
  WEBSITE,
} from './support/s3-bucket-page';

/** The page's notice region, as the area names it. */
const NOTICE_REGION = 'Local emulator notice';

/** The direct `ListBuckets` entry of `name`; the check's Given fails without it. */
async function directBucket(ctx: Parameters<typeof listBucketsDirect>[0], port: number, name: string) {
  const bucket = (await listBucketsDirect(ctx, port, name)).find((b) => b.name === name);
  expect(bucket, `a direct ListBuckets lists ${name}`).toBeDefined();
  return bucket!;
}

// ---------------------------------------------------------------------------------------------------------------

test.describe(() => {
  // "Creation date" is written in the browser's zone, which the check sets.
  test.use({ timezoneId: SEOUL.timeZone });

  test('studio.s3-bucket-page-shows-the-bucket-properties', async ({ ctx, page }) => {
    const stack = await startStack(ctx);
    const port = stack.emulatorPort;
    const lines = new Lines(ctx);
    const p = checkPrefix(ctx, 'page-props');
    const name = `${p}-full`;
    const logs = `${p}-logs`;
    const seeded = new Seeded(ctx, port);
    await seeded.bucket(logs);
    await seeded.bucket(name, 'us-east-1', { objectLock: true });
    const key = await seeded.kmsKey();
    const queue = await seeded.queue(`${p}-queue`);
    await seeded.configure(name, {
      abac: 'Enabled',
      tags: [
        ['env', 'check'],
        ['team', 'emuforge'],
      ],
      encryption: { algorithm: 'aws:kms', keyId: key, bucketKey: true },
      intelligentTiering: [
        { id: 'archive', status: 'Enabled', prefix: 'cold/', archiveDays: 90, deepArchiveDays: 180 },
      ],
      logging: { targetBucket: logs, targetPrefix: 'access/' },
      notifications: {
        queues: [{ id: 'created', queueArn: queue, events: ['s3:ObjectCreated:*'], prefix: 'in/', suffix: '.txt' }],
        eventBridge: true,
      },
      accelerate: 'Enabled',
      defaultRetention: { mode: 'GOVERNANCE', days: 1 },
      requestPayer: 'Requester',
      website: { indexDocument: 'index.html', errorDocument: 'error.html' },
    });

    await lines.line(
      'With a bucket made directly with Object Lock, two tags, ABAC on, default encryption SSE-KMS with a key made directly and the bucket key on, an Intelligent-Tiering configuration, logging to a second bucket, an event notification to a queue, EventBridge on, acceleration on, a default retention of 1 day in governance mode, requester pays and a website configuration, open its name in the list → `h1` the name, "Properties" selected, and every section shows what direct reads of the same properties return, in the words of R5.3',
      async () => {
        await openList(page);
        await filterFor(page, name);
        await expectNames(page, [name], `the rows under the filter ${name}`);
        await screen(page).nameLink(name).click(ACTION);
        await expect(page).toHaveURL(addressOf(bucketPath(name)));
        await expectBucketPage(page, name);
        const props = await bucketPropertiesDirect(ctx, port, name);
        ctx.log(`direct properties of ${name}: ${JSON.stringify(props)}`);
        const expected = expectedSections(await directBucket(ctx, port, name), props, SEOUL);
        ctx.log(`expected sections: ${JSON.stringify(expected)}`);
        await expectSections(page, expected, 'every section shows what the direct reads return');
      },
    );

    await lines.line(
      'The crumbs read EmuForge, AWS, S3, Buckets and the name; the notice reads "These buckets are in your local emulator" and names the endpoint the emulator line shows',
      async () => {
        await openBucketPage(page, name);
        await expect
          .poll(() => crumbs(page), { message: 'the crumbs' })
          .toEqual(['EmuForge', 'AWS', 'S3', 'Buckets', name]);
        await expectLine(page, connectedAt(port));
        const notice = page.getByRole('region', { name: NOTICE_REGION, exact: true });
        await expect(notice.getByText(NOTICE, { exact: true }), `the notice "${NOTICE}"`).toBeVisible();
        await expect(emulatorLine(page)).toContainText(new RegExp(endpointPattern(port)));
        await expect(notice, 'the notice names the endpoint the line shows').toContainText(
          new RegExp(endpointPattern(port)),
        );
      },
    );

    await lines.line(
      'Open `/aws/s3/buckets/<name>/properties` → the same page, and the address stays as opened',
      async () => {
        await openBucketPage(page, name, propertiesPath(name));
        const expected = expectedSections(
          await directBucket(ctx, port, name),
          await bucketPropertiesDirect(ctx, port, name),
          SEOUL,
        );
        await expectSections(page, expected, 'every section at /properties shows what the direct reads return');
        await expect(page).toHaveURL(addressOf(propertiesPath(name)));
      },
    );

    lines.end();
  });

  test('studio.s3-bucket-page-of-a-plain-bucket-shows-nothing-set', async ({ ctx, page }) => {
    const stack = await startStack(ctx);
    const port = stack.emulatorPort;
    const lines = new Lines(ctx);
    const p = checkPrefix(ctx, 'page-plain');
    const plain = `${p}-plain`;
    const seoul = `${p}-seoul`;
    const seeded = new Seeded(ctx, port);
    await seeded.bucket(plain);
    await seeded.bucket(seoul, 'ap-northeast-2');

    await lines.line(
      'With a bucket made directly and nothing set → "Disabled" for versioning, ABAC, logging, acceleration, Object Lock, requester pays and website hosting, "Off" for EventBridge, SSE-S3 with "Bucket Key" "Disabled", and "No tags", "No configurations", "No event notifications"',
      async () => {
        await openBucketPage(page, plain);
        await expectSections(
          page,
          {
            [VERSIONING]: { fields: { [VERSIONING]: 'Disabled' } },
            [ABAC]: { fields: { [ABAC]: 'Disabled' } },
            [LOGGING]: { fields: { [LOGGING]: 'Disabled' } },
            [ACCELERATION]: { fields: { [ACCELERATION]: 'Disabled' } },
            [OBJECT_LOCK]: { fields: { [OBJECT_LOCK]: 'Disabled' } },
            [REQUESTER_PAYS]: { fields: { [REQUESTER_PAYS]: 'Disabled' } },
            [WEBSITE]: { fields: { [WEBSITE]: 'Disabled' } },
            [EVENTBRIDGE]: { fields: { [EVENTBRIDGE_FIELD]: 'Off' } },
            [ENCRYPTION]: { fields: { 'Encryption type': SSE_S3, 'Bucket Key': 'Disabled' } },
            [TAGS]: { rows: [], empty: NO_TAGS },
            [TIERING]: { rows: [], empty: NO_CONFIGURATIONS },
            [NOTIFICATIONS]: { rows: [], empty: NO_NOTIFICATIONS },
          },
          'the sections of a bucket with nothing set',
        );
      },
    );

    await lines.line(
      'With a bucket made directly in `ap-northeast-2` → "AWS Region" reads "Asia Pacific (Seoul) ap-northeast-2" and every section is shown',
      async () => {
        const direct = await directBucket(ctx, port, seoul);
        expect(direct.region, `a direct ListBuckets puts ${seoul} in ap-northeast-2`).toBe('ap-northeast-2');
        await openBucketPage(page, seoul);
        await expect
          .poll(async () => (await readSection(page, OVERVIEW, ['AWS Region']))?.fields['AWS Region'] ?? null, {
            message: '"AWS Region" of "Bucket overview"',
          })
          .toBe(regionText('ap-northeast-2'));
        await expect
          .poll(async () => [...(await shownSectionTitles(page))].sort(), { message: 'the sections shown' })
          .toEqual([...SECTIONS].sort());
        // Shown, not failed or still reading: each section holds what the direct reads of the bucket return.
        const props = await bucketPropertiesDirect(ctx, port, seoul);
        await expectSections(page, expectedSections(direct, props, SEOUL), 'every section of the bucket in Seoul');
      },
    );

    lines.end();
  });
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-page-rereads-on-open-and-refresh', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'page-reread');
  const name = `${p}-b`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);

  await lines.line(
    'With a plain bucket\'s page shown, enable versioning directly and choose "Refresh" → "Enabled"',
    async () => {
      await openBucketPage(page, name);
      await expectSections(
        page,
        { [VERSIONING]: { fields: { [VERSIONING]: 'Disabled' } } },
        '"Bucket Versioning" before',
      );
      await seeded.configure(name, { versioning: 'Enabled' });
      expect((await bucketPropertiesDirect(ctx, port, name)).versioning, 'a direct GetBucketVersioning').toBe(
        'Enabled',
      );
      await page.getByRole('button', { name: REFRESH, exact: true }).click(ACTION);
      await expectSections(
        page,
        { [VERSIONING]: { fields: { [VERSIONING]: 'Enabled' } } },
        '"Bucket Versioning" after "Refresh"',
      );
    },
  );

  await lines.line('Put two tags directly, leave for the list and open the bucket again → the two tags', async () => {
    await openBucketPage(page, name);
    await expectSections(page, { [TAGS]: { rows: [], empty: NO_TAGS } }, '"Tags" before');
    await seeded.configure(name, {
      tags: [
        ['first', 'one'],
        ['second', 'two'],
      ],
    });
    const tags = (await bucketPropertiesDirect(ctx, port, name)).tags ?? [];
    expect(tags.length, 'a direct GetBucketTagging returns two tags').toBe(2);
    await crumbLink(page, 'Buckets').click(ACTION);
    await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
    await filterFor(page, name);
    await expectNames(page, [name], `the rows under the filter ${name}`);
    await screen(page).nameLink(name).click(ACTION);
    await expectBucketPage(page, name);
    await expectSections(
      page,
      { [TAGS]: { rows: tags.map(([Key, Value]) => ({ Key, Value })) } },
      '"Tags" after opening the bucket again',
    );
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-page-controls-lead-to-their-routes', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'page-controls');
  const name = `${p}-b`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  const before = await bucketPropertiesDirect(ctx, port, name);

  /** Back to the bucket's page, waiting for its sections. */
  async function back(): Promise<void> {
    await page.goBack();
    await expectBucketPage(page, name);
  }

  await lines.line(
    'On a bucket\'s page, each of the tabs "Objects", "Metadata", "Permissions", "Metrics", "Management", each "Edit", "Create configuration" and "Create event notification" → the address of R10 for that bucket, without a document reload; "Properties" → `/aws/s3/buckets/<name>/properties` and the page',
    async () => {
      await openBucketPage(page, name);
      await markPage(page);
      for (const { tab: label, slug } of OTHER_TABS) {
        await tab(page, label).click(ACTION);
        await expect(page, `the tab "${label}"`).toHaveURL(addressOf(tabPath(name, slug)));
        expect(await stillSamePage(page), `"${label}": no document was loaded`).toBe(true);
        await back();
      }
      for (const { section, button, path } of SECTION_BUTTONS) {
        await sectionButton(page, section, button).click(ACTION);
        await expect(page, `"${button}" of "${section}"`).toHaveURL(addressOf(path(name)));
        expect(await stillSamePage(page), `"${button}" of "${section}": no document was loaded`).toBe(true);
        await back();
      }
      await tab(page, PROPERTIES).click(ACTION);
      await expect(page, `the tab "${PROPERTIES}"`).toHaveURL(addressOf(propertiesPath(name)));
      await expectBucketPage(page, name);
      expect(await stillSamePage(page), `"${PROPERTIES}": no document was loaded`).toBe(true);
    },
  );

  await lines.line("Afterwards direct reads of the bucket's properties return what they returned before", async () => {
    expect(await bucketPropertiesDirect(ctx, port, name), `direct reads of ${name}`).toEqual(before);
  });

  lines.end();
});
