// The five rules every AWS screen follows, on S3's five bucket screens, in the built app served by `bun run serve`, in
// front of a real engine and the run's emulator (test-criteria.md, issue 467, "Flow checks, new"; requirement R3 to
// R6): the pages say where the buckets are once, "Create bucket" states the name's rule before a submit, a bucket's
// ARN and its KMS key have copy controls, and a long value breaks where it can be read.
//
// `studio.s3-screens-say-where-once`, `studio.s3-create-bucket-states-the-name-rules`,
// `studio.s3-bucket-page-copies-arn-and-kms-key`, `studio.s3-values-break-where-they-can-be-read`.
//
// Other checks make buckets on the run's emulator at the same time, so each check names its buckets with its own
// prefix `<p>` and reads its own buckets by name; the list is read under a filter that only the check's buckets
// match. Buckets and keys are made and read directly with `Seeded` and the direct readers of `support/s3.ts`; a
// bucket the form may make is tracked, so it is removed when the check ends. The check of how values break needs
// names of 24 and 36 characters that start with `<p>`, so its prefix is `shortPrefix`; its bucket of 63 characters
// without a hyphen is that prefix with its hyphens left out, which no other check's name starts with. The readers of
// the rules (drawn lines, the clipboard, how often a text is on the page, the header, a field's texts, a pair's
// value, a table's cell): `support/screen-rules.ts`.

import type { Locator, Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, emulatorLine, endpointPattern, expectLine } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix, scrollsSideways } from './support/service-screens';
import {
  BUCKETS_PATH,
  bucketNamesDirect,
  bucketPropertiesDirect,
  expectNames,
  filterFor,
  H1,
  listBucketsDirect,
  openList,
  screen,
  Seeded,
  shownPreferences,
} from './services/s3/s3';
import { emptySentence, deleteSentence, openDeletePage, openEmptyPage, pageShows } from './services/s3/s3-bucket-actions';
import {
  propertiesPath,
  ENCRYPTION,
  form,
  MESSAGES,
  openBucketPage,
  openForm,
  sectionBox,
  SSE_S3,
  TAGS,
  VERSIONING,
} from './services/s3/s3-bucket-page';
import {
  breakAfterProblems,
  breakAtSpacesProblems,
  cellUnder,
  cellUnderRowWith,
  clipboardText,
  copiedText,
  copyControl,
  drawnLines,
  fieldTexts,
  grantClipboard,
  nameOfLength,
  oneLineProblems,
  pageHeader,
  pairValueOf,
  scrollRegionProblems,
  setClipboard,
  shortPrefix,
  timesOnPage,
} from './support/screen-rules';

// ---------------------------------------------------------------------------------------------------------------
// The screens' words (issue 256's screens; issue 467 requirement R4, R5; English).
// ---------------------------------------------------------------------------------------------------------------

const F_BUCKET_NAME = 'Bucket name';
const F_BUCKET_ARN = 'Bucket ARN';
const F_KMS_KEY = 'AWS KMS key';
const F_ENCRYPTION_TYPE = 'Encryption type';
const COL_NAME = 'Name';

/** The constraint text under "Bucket name" (R4). */
const NAME_RULE =
  '3 to 63 characters: lowercase letters (a-z), digits, periods (.) and hyphens (-). Begins and ends with a letter or digit.';

/** How long "Create bucket" may take to the list. */
const CREATE_BOUND_MS = 20_000;

// ---------------------------------------------------------------------------------------------------------------
// The screens.
// ---------------------------------------------------------------------------------------------------------------

async function sizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
}

/** The copy control of the field `label` in the page's main (R5). */
function copy(page: Page, label: string): Locator {
  return page.getByRole('main').getByRole('button', { name: copyControl(label), exact: true });
}

/**
 * Opens the page of `name` and waits until it is read: the `h1`, "Bucket ARN" showing `arn`, and "Default
 * encryption" showing its type. The `h1` and the first tab show while the sections are still read.
 */
async function openRead(page: Page, name: string, arn: string): Promise<void> {
  await openBucketPage(page, name);
  await expect(pairValueOf(page, F_BUCKET_ARN), `"${F_BUCKET_ARN}" of ${name}`).toContainText(arn);
  await expect(pairValueOf(page, F_ENCRYPTION_TYPE), `"${F_ENCRYPTION_TYPE}" of ${name} is read`).not.toHaveText(
    /^\s*$/,
  );
}

/** The bucket list under the filter `text`, connected to the emulator on `port`, its rows exactly `names`. */
async function listUnder(page: Page, port: number, text: string, names: string[]): Promise<void> {
  await openList(page);
  await expectLine(page, connectedAt(port), 20_000);
  await filterFor(page, text);
  await expectNames(page, names, `the rows under the filter ${text}`);
}

/** The direct `ListBuckets` `BucketArn` of `name`; the check's Given fails without it. */
async function arnOf(ctx: Parameters<typeof listBucketsDirect>[0], port: number, name: string): Promise<string> {
  const arn = (await listBucketsDirect(ctx, port, name)).find((b) => b.name === name)?.arn ?? null;
  expect(arn, `a direct ListBuckets gives the BucketArn of ${name}`).not.toBeNull();
  return arn ?? '';
}

/** Whether `cell`'s content is wider than the cell's own box. */
async function widerThanItsCell(cell: Locator): Promise<boolean> {
  return cell.first().evaluate((el) => el.scrollWidth > el.clientWidth + 1, undefined, ACTION);
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-screens-say-where-once', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ssr-where');
  const seeded = new Seeded(ctx, port);
  const name = `${p}-a`;
  await seeded.bucket(name);
  const arn = await arnOf(ctx, port, name);
  const endpoint = endpointPattern(port);

  const screens: { name: string; open: () => Promise<void> }[] = [
    { name: 'the list', open: () => listUnder(page, port, p, [name]) },
    {
      name: "a bucket's page",
      open: async () => {
        await openRead(page, name, arn);
        await expectLine(page, connectedAt(port), 20_000);
      },
    },
    {
      name: 'the create form',
      open: async () => {
        await openForm(page);
        await expectLine(page, connectedAt(port), 20_000);
      },
    },
  ];

  await lines.line(
    "Open the list, a bucket's page and the create form, connected → on each the endpoint the emulator line shows is on the page once and the `h1` has no description",
    async () => {
      const found: string[] = [];
      for (const screenOf of screens) {
        await screenOf.open();
        const times = await timesOnPage(page, endpoint);
        if (times !== 1) found.push(`${screenOf.name}: the endpoint is on the page ${String(times)} times`);
        const header = await pageHeader(page);
        ctx.log(`${screenOf.name}: header ${JSON.stringify(header)}`);
        if (header === null) found.push(`${screenOf.name}: no h1`);
        else if (header.description !== null) {
          found.push(`${screenOf.name}: the h1 has the description ${JSON.stringify(header.description)}`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Open "Empty bucket" and "Delete bucket" of a bucket made directly → the endpoint is in the emulator line and in the sentence that says what is removed, and nowhere else on the page',
    async () => {
      const found: string[] = [];
      const pages = [
        { name: '"Empty bucket"', open: () => openEmptyPage(page, name), sentence: emptySentence(name, port) },
        { name: '"Delete bucket"', open: () => openDeletePage(page, name), sentence: deleteSentence(name, port) },
      ];
      for (const at of pages) {
        await at.open();
        await expectLine(page, connectedAt(port), 20_000);
        await expect
          .poll(() => pageShows(page, at.sentence), { message: `${at.name}: the sentence that says what is removed` })
          .toBe(true);
        await expect(emulatorLine(page), `${at.name}: the emulator line holds the endpoint`).toContainText(
          new RegExp(endpoint),
        );
        const times = await timesOnPage(page, endpoint);
        if (times !== 2) {
          found.push(
            `${at.name}: the endpoint is on the page ${String(times)} times, not in the line and the sentence`,
          );
        }
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-create-bucket-states-the-name-rules', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ssr-name');
  const seeded = new Seeded(ctx, port);
  const f = form(page);
  // A digit, a period and a hyphen after the prefix; the fill ends it with a letter.
  const longest = nameOfLength(`${p}.0-`, 63);
  const tooLong = nameOfLength(`${p}-long-`, 64);
  seeded.track(longest);
  seeded.track(tooLong);

  await lines.line(
    'Open the form → under "Bucket name": "3 to 63 characters: lowercase letters (a-z), digits, periods (.) and hyphens (-). Begins and ends with a letter or digit."; no message is shown',
    async () => {
      await openForm(page);
      await expect(f.name, `"${F_BUCKET_NAME}"`).toBeVisible();
      const texts = await fieldTexts(page, F_BUCKET_NAME);
      ctx.log(`"${F_BUCKET_NAME}": ${JSON.stringify(texts)}`);
      expect(texts, `what "${F_BUCKET_NAME}" shows under it`).toEqual({
        fields: 1,
        constraint: NAME_RULE,
        error: null,
      });
    },
  );

  await lines.line(
    'A name of 63 characters starting with `<p>` that holds a digit, a period and a hyphen, "Create bucket" → the list; a direct `ListBuckets` holds that name',
    async () => {
      expect(longest.length, 'the name is 63 characters long').toBe(63);
      expect(/[0-9]/.test(longest) && longest.includes('.') && longest.includes('-'), `${longest}`).toBe(true);
      await openForm(page);
      await f.name.fill(longest, ACTION);
      await f.create.click(ACTION);
      await expect(page, 'the list opens').toHaveURL(addressOf(BUCKETS_PATH), { timeout: CREATE_BOUND_MS });
      await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
      expect(await bucketNamesDirect(ctx, port, longest), `a direct ListBuckets of ${longest}`).toEqual([longest]);
    },
  );

  await lines.line(
    'A name of 64 characters, "Create bucket" → the message about the length beside the constraint text; a direct `ListBuckets` holds no such name',
    async () => {
      expect(tooLong.length, 'the name is 64 characters long').toBe(64);
      await openForm(page);
      await f.name.fill(tooLong, ACTION);
      await f.create.click(ACTION);
      await expect
        .poll(() => fieldTexts(page, F_BUCKET_NAME), { message: `what "${F_BUCKET_NAME}" shows under it` })
        .toEqual({ fields: 1, constraint: NAME_RULE, error: MESSAGES.length });
      await expect(f.h1, 'the form stays').toBeVisible();
      expect(await bucketNamesDirect(ctx, port, tooLong), `a direct ListBuckets of ${tooLong}`).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-page-copies-arn-and-kms-key', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ssr-copy');
  const seeded = new Seeded(ctx, port);
  const withKey = `${p}-kms`;
  const plain = `${p}-plain`;
  await seeded.bucket(withKey);
  const key = await seeded.kmsKey();
  await seeded.configure(withKey, { encryption: { algorithm: 'aws:kms', keyId: key } });
  await seeded.bucket(plain);
  await grantClipboard(context, stack.studio.origin);

  await lines.line(
    'On the page of a bucket made directly with default encryption by a KMS key made directly, press "Copy Bucket ARN" → "Bucket ARN copied" and the clipboard\'s text equals the `BucketArn` a direct `ListBuckets` gives for it',
    async () => {
      const arn = await arnOf(ctx, port, withKey);
      await openRead(page, withKey, arn);
      await setClipboard(page, 'before');
      await copy(page, F_BUCKET_ARN).click(ACTION);
      await expect(page.getByText(copiedText(F_BUCKET_ARN), { exact: true }).first()).toBeVisible();
      await expect.poll(() => clipboardText(page), { message: "the clipboard's text" }).toBe(arn);
    },
  );

  await lines.line(
    'Press "Copy AWS KMS key" → "AWS KMS key copied" and the clipboard\'s text equals the `KMSMasterKeyID` a direct `GetBucketEncryption` returns',
    async () => {
      const keyId = (await bucketPropertiesDirect(ctx, port, withKey)).encryption?.keyId ?? null;
      expect(keyId, `a direct GetBucketEncryption ${withKey} gives a KMSMasterKeyID`).not.toBeNull();
      if (!addressOf(propertiesPath(withKey)).test(page.url())) {
        await openRead(page, withKey, await arnOf(ctx, port, withKey));
      }
      await expect(sectionBox(page, ENCRYPTION), `"${ENCRYPTION}" shows the key`).toContainText(keyId ?? '');
      await setClipboard(page, 'before');
      await copy(page, F_KMS_KEY).click(ACTION);
      await expect(page.getByText(copiedText(F_KMS_KEY), { exact: true }).first()).toBeVisible();
      await expect.poll(() => clipboardText(page), { message: "the clipboard's text" }).toBe(keyId);
    },
  );

  await lines.line(
    'On the page of a bucket made directly without a KMS key → "Copy Bucket ARN" is there and no "Copy AWS KMS key"',
    async () => {
      await openRead(page, plain, await arnOf(ctx, port, plain));
      await expect(pairValueOf(page, F_ENCRYPTION_TYPE), `"${F_ENCRYPTION_TYPE}" of ${plain}`).toHaveText(SSE_S3);
      await expect(copy(page, F_BUCKET_ARN), `"${copyControl(F_BUCKET_ARN)}"`).toBeVisible();
      await expect(copy(page, F_KMS_KEY), `"${copyControl(F_KMS_KEY)}"`).toHaveCount(0);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-values-break-where-they-can-be-read', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = shortPrefix(ctx, 'sv');
  const seeded = new Seeded(ctx, port);
  const name = nameOfLength(`${p}-`, 36);
  const reports = `${p}-reports`;
  const hyphenless = nameOfLength(p.replace(/-/g, ''), 63);
  const tagKey = 'archive-reports';
  const tagValue = 'kept for one year';
  await seeded.bucket(name);
  await seeded.configure(name, { tags: [[tagKey, tagValue]], versioning: 'Enabled' });
  await seeded.bucket(reports);
  await seeded.bucket(hyphenless);

  await lines.line(
    'On the page of a bucket made directly, its name 36 characters starting with `<p>`, with a tag `archive-reports` = `kept for one year` and versioning enabled → "Bucket ARN" is drawn on more than one line and every line of it but the last ends with `:`; in "Tags" the key is on one line and the value breaks only at spaces; "Enabled" under "Bucket Versioning" is on one line — 390 wide',
    async () => {
      expect(name.length, 'the name is 36 characters long').toBe(36);
      const arn = await arnOf(ctx, port, name);
      await sizeTo(page, 390);
      await openRead(page, name, arn);
      const tags = sectionBox(page, TAGS).locator('table').first();
      await expect(tags, `"${TAGS}" shows the tag`).toContainText(tagValue);
      await expect(pairValueOf(page, VERSIONING), `"${VERSIONING}"`).toHaveText('Enabled');
      const shownArn = await drawnLines(pairValueOf(page, F_BUCKET_ARN), arn);
      const shownKey = await drawnLines(await cellUnderRowWith(tags, tagKey, 'Key'), tagKey);
      const shownValue = await drawnLines(await cellUnderRowWith(tags, tagKey, 'Value'), tagValue);
      const enabled = await drawnLines(pairValueOf(page, VERSIONING), 'Enabled');
      ctx.log(
        `drawn: ARN ${JSON.stringify(shownArn)}; key ${JSON.stringify(shownKey)}; value ${JSON.stringify(shownValue)}; "Enabled" ${JSON.stringify(enabled)}`,
      );
      await sizeTo(page, 1280);
      expect([
        ...breakAfterProblems(shownArn, [':'], `"${F_BUCKET_ARN}"`),
        ...oneLineProblems(shownKey, "the tag's key"),
        ...breakAtSpacesProblems(shownValue, tagValue, "the tag's value"),
        ...oneLineProblems(enabled, `"Enabled" under "${VERSIONING}"`),
      ]).toEqual([]);
    },
  );

  await lines.line(
    'The bucket list under the filter `<p>-reports` with a bucket `<p>-reports` (at most 24 characters) made directly → the name is on one line — 1280 and 390 wide',
    async () => {
      expect(reports.length, `${reports} is at most 24 characters long`).toBeLessThanOrEqual(24);
      const found: string[] = [];
      for (const width of [1280, 390]) {
        await sizeTo(page, width);
        await listUnder(page, port, reports, [reports]);
        const cell = await cellUnder(screen(page).table, reports, COL_NAME);
        found.push(...oneLineProblems(await drawnLines(cell, reports), `${String(width)} wide: the name`));
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'The bucket list under the filter of a bucket made directly whose name is 63 characters without a hyphen, "Wrap lines" on as at the start → the name is drawn on more than one line inside its cell, the cell inside the table\'s own scroll region, and the page does not scroll sideways — 390 wide',
    async () => {
      expect({ length: hyphenless.length, hyphen: hyphenless.includes('-') }, `${hyphenless}`).toEqual({
        length: 63,
        hyphen: false,
      });
      await sizeTo(page, 390);
      await listUnder(page, port, hyphenless, [hyphenless]);
      expect((await shownPreferences(page)).wrapLines, '"Wrap lines" as at the start').toBe(true);
      const cell = await cellUnder(screen(page).table, hyphenless, COL_NAME);
      const drawn = await drawnLines(cell, hyphenless);
      // The table scrolls within itself at 390 (decisions.md, PM 2026-11-18 05:40, item 12).
      const region = await scrollRegionProblems(cell, screen(page).table);
      ctx.log(`the name drawn ${JSON.stringify(drawn)}; against the table's scroll region ${JSON.stringify(region)}`);
      const found: string[] = [];
      if (drawn === null) found.push('the name: not shown');
      else if (drawn.lines.length < 2) found.push(`the name is drawn on one line: ${JSON.stringify(drawn.lines)}`);
      if (await widerThanItsCell(cell)) found.push('the name is wider than its cell');
      found.push(...region);
      if (await scrollsSideways(page)) found.push('the page scrolls sideways');
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  lines.end();
});
