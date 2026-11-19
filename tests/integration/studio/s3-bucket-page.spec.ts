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
//
// Issue 467 rewrote one step of `studio.s3-bucket-page-shows-the-bucket-properties` (its test-criteria.md, "Flow checks,
// changed"; requirement R9, rule 1): what the notice, the `h1`'s description and the page say of where the bucket is.
// Readers of those: `support/screen-rules.ts`.

import { expect, startStack, test } from './support';
import { connectedAt, crumbLink, crumbs, emulatorLine, endpointPattern, expectLine } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';
import { checkPrefix, SEOUL } from './support/service-screens';
import {
  bucketPropertiesDirect,
  expectNames,
  filterFor,
  H1,
  listBucketsDirect,
  NOTICE,
  openList,
  regionText,
  screen,
  Seeded,
} from './services/s3/s3';
import {
  bucketPath,
  ENCRYPTION,
  expectBucketPage,
  expectedSections,
  expectSections,
  NO_NOTIFICATIONS,
  NO_TAGS,
  NOTIFICATIONS,
  OBJECTS,
  openBucketPage,
  OVERVIEW,
  PROPERTIES,
  propertiesPath,
  readSection,
  REFRESH,
  SECTION_BUTTONS,
  sectionButton,
  SECTIONS,
  shownSectionTitles,
  SSE_S3,
  tab,
  TAGS,
  VERSIONING,
  WEBSITE,
} from './services/s3/s3-bucket-page';
import { NOTICE_BODY, noticeBody, pageHeader, pairValueOf, timesOnPage } from './support/screen-rules';

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
      'With a bucket made directly with Object Lock, two tags, ABAC on, default encryption SSE-KMS with a key made directly and the bucket key on, an Intelligent-Tiering configuration, logging to a second bucket, an event notification to a queue, EventBridge on, acceleration on, a default retention of 1 day in governance mode, requester pays and a website configuration, open its name in the list → `h1` the name, "Objects" selected (issue 480: the bare route is the tab "Objects"); choose "Properties" → the address is `/properties` and each of the six sections kept shows what direct reads of the same properties return, in the words of R5.3',
      async () => {
        await openList(page);
        await filterFor(page, name);
        await expectNames(page, [name], `the rows under the filter ${name}`);
        await screen(page).nameLink(name).click(ACTION);
        await expect(page).toHaveURL(addressOf(bucketPath(name)));
        await expectBucketPage(page, name, OBJECTS);
        await tab(page, PROPERTIES).click(ACTION);
        await expect(page).toHaveURL(addressOf(propertiesPath(name)));
        await expectBucketPage(page, name);
        const props = await bucketPropertiesDirect(ctx, port, name);
        ctx.log(`direct properties of ${name}: ${JSON.stringify(props)}`);
        const expected = expectedSections(await directBucket(ctx, port, name), props, SEOUL);
        ctx.log(`expected sections: ${JSON.stringify(expected)}`);
        await expectSections(page, expected, 'every section shows what the direct reads return');
      },
    );

    // Issue 467 (requirement R9, rule 1) replaced "the notice … names the endpoint the emulator line shows" with the
    // notice's body of R3, no description under the `h1`, and the endpoint drawn once.
    await lines.line(
      'The crumbs read EmuForge, AWS, S3, Buckets and the name; the notice reads "These buckets are in your local emulator" with the body of R3; the `h1` has no description; the endpoint the emulator line shows is on the page once',
      async () => {
        await openBucketPage(page, name);
        await expect
          .poll(() => crumbs(page), { message: 'the crumbs' })
          .toEqual(['EmuForge', 'AWS', 'S3', 'Buckets', name]);
        await expectLine(page, connectedAt(port));
        const notice = page.getByRole('region', { name: NOTICE_REGION, exact: true });
        await expect(notice.getByText(NOTICE, { exact: true }), `the notice "${NOTICE}"`).toBeVisible();
        await expect(emulatorLine(page)).toContainText(new RegExp(endpointPattern(port)));
        await expect.poll(() => noticeBody(page), { message: "the notice's body" }).toBe(NOTICE_BODY);
        // The bucket is read (its ARN shown), so the header shows what it shows for a loaded bucket.
        await expect(pairValueOf(page, 'Bucket ARN'), '"Bucket ARN" shows the bucket\'s ARN').toContainText(name);
        const header = await pageHeader(page);
        ctx.log(`the h1's header ${JSON.stringify(header)}`);
        expect(header?.description ?? null, 'the description under the h1').toBeNull();
        expect(
          await timesOnPage(page, endpointPattern(port)),
          `how often https://127.0.0.1:${String(port)} is on the page`,
        ).toBe(1);
      },
    );

    await lines.line(
      'Open `/aws/s3/buckets/<name>/properties` → the same page, and the address stays as opened (issue 480: six sections)',
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
      'With a bucket made directly and nothing set → "Disabled" for versioning and website hosting, SSE-S3 with "Bucket Key" "Disabled", and "No tags", "No event notifications" (issue 480: ABAC, logging, acceleration, Object Lock, requester pays, EventBridge and Intelligent-Tiering went)',
      async () => {
        await openBucketPage(page, plain);
        await expectSections(
          page,
          {
            [VERSIONING]: { fields: { [VERSIONING]: 'Disabled' } },
            [WEBSITE]: { fields: { [WEBSITE]: 'Disabled' } },
            [ENCRYPTION]: { fields: { 'Encryption type': SSE_S3, 'Bucket Key': 'Disabled' } },
            [TAGS]: { rows: [], empty: NO_TAGS },
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

  await lines.line(
    'Put two tags directly, leave for the list and open the bucket again, then its "Properties" (issue 480: the name opens "Objects") → the two tags',
    async () => {
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
      await expectBucketPage(page, name, OBJECTS);
      await tab(page, PROPERTIES).click(ACTION);
      await expectBucketPage(page, name);
      await expectSections(
        page,
        { [TAGS]: { rows: tags.map(([Key, Value]) => ({ Key, Value })) } },
        '"Tags" after opening the bucket again',
      );
    },
  );

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

  /** Every control of the first line: the tab "Objects", the five section buttons, then "Properties" (issue 480). */
  const controls = 1 + SECTION_BUTTONS.length + 1;
  /** The controls pressed by the last `pressEach`, so the second line knows its Given held. */
  let pressed = 0;

  /** Presses each control in turn from the bucket's page, `check` after each press, and goes back after each. */
  async function pressEach(check: (what: string, path: string) => Promise<void>): Promise<void> {
    pressed = 0;
    await openBucketPage(page, name);
    await markPage(page);
    await tab(page, OBJECTS).click(ACTION);
    pressed++;
    await check(`the tab "${OBJECTS}"`, bucketPath(name));
    await back();
    for (const { section, button, path } of SECTION_BUTTONS) {
      await sectionButton(page, section, button).click(ACTION);
      pressed++;
      await check(`"${button}" of "${section}"`, path(name));
      await back();
    }
    await tab(page, PROPERTIES).click(ACTION);
    pressed++;
    await check(`the tab "${PROPERTIES}"`, propertiesPath(name));
    await expectBucketPage(page, name);
  }

  await lines.line(
    'On a bucket\'s "Properties", the tab "Objects" → `/aws/s3/buckets/<name>`; each "Edit" (Bucket Versioning, Tags, Default encryption, Static website hosting) and "Create event notification" → the address of R10 for that bucket, without a document reload; "Properties" → `/aws/s3/buckets/<name>/properties` and the page (issue 480: the tabs Metadata, Permissions, Metrics, Management and the dropped sections\' buttons went)',
    async () => {
      await pressEach(async (what, path) => {
        await expect(page, what).toHaveURL(addressOf(path));
        expect(await stillSamePage(page), `${what}: no document was loaded`).toBe(true);
      });
    },
  );

  await lines.line("Afterwards direct reads of the bucket's properties return what they returned before", async () => {
    // The Given: every control was pressed, whether or not the line before held.
    if (pressed < controls) await pressEach(async () => undefined);
    expect(pressed, 'controls pressed').toBe(controls);
    expect(await bucketPropertiesDirect(ctx, port, name), `direct reads of ${name}`).toEqual(before);
  });

  lines.end();
});
