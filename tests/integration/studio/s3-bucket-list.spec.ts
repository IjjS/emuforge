// The S3 bucket list in the built app served by `bun run serve`, in front of a real engine started for that Studio
// and the run's emulator (test-criteria.md, issue 56, Flow checks; requirement R3 to R8): what the emulator holds,
// read again on every opening and refresh, the filter, the actions and where they lead, "Copy ARN", the help panel
// and the notice.
//
// `studio.s3-bucket-list-shows-what-the-emulator-holds`, `studio.s3-bucket-list-rereads-on-open-and-refresh`,
// `studio.s3-bucket-list-filter-matches-the-start-of-a-name`, `studio.s3-bucket-list-actions-lead-to-their-routes`,
// `studio.s3-bucket-list-copy-arn-copies-the-emulators-arn`, `studio.s3-bucket-list-help-and-notice`.
//
// Other checks make buckets on the run's emulator at the same time, so each check names its buckets with its own
// prefix `<p>` and compares the screen with a direct `ListBuckets` under the filter `<p>`. Words and readers:
// `support/s3.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { CacheRecord } from './support/aws-clients';
import { connectedAt, crumbLink, crumbs, expectLine } from './support/aws-area';
import { hasFocus } from './support/focus';
import { ACTION, addressOf, heading, providersSection, SIDE_NAVIGATION, SIDE_NAVIGATION_ACTIVE } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';
import {
  ABOUT,
  appeared,
  ARN_COPIED,
  BUCKETS_PATH,
  bucketNamesDirect,
  CLEAR_FILTER,
  checkPrefix,
  COPY_ARN,
  CREATE,
  creationDateText,
  CRUMBS,
  DELETE,
  descriptionAt,
  EMPTY,
  expectNames,
  filterFor,
  H1,
  HELP_CLOSE,
  INFO,
  ListBucketsRecord,
  listBucketsDirect,
  LOADING,
  NAV_DIRECTORY,
  NAV_GENERAL,
  NAV_HEADER,
  NO_MATCHES,
  noMatchSentence,
  NOTICE,
  objectKeysDirect,
  openList,
  REFRESH,
  regionText,
  S3_PATH,
  screen,
  Seeded,
  SELECTION_ACTIONS,
  SEOUL,
  SERVICE_LABEL,
  shownNames,
  shownRows,
  TAB_DIRECTORY,
  TABLE_TITLE,
  TOOLS,
  watchText,
} from './support/s3';

const AWS = 'Amazon Web Services';

/** The side navigation as shown: every link's text in order, and the current one(s). */
async function navigation(page: Page): Promise<{ links: string[]; current: string[] }> {
  const nav = page.locator(SIDE_NAVIGATION);
  const norm = (texts: string[]) => texts.map((t) => t.replace(/\s+/g, ' ').trim());
  return {
    links: norm(await nav.getByRole('link').allInnerTexts()),
    current: norm(await page.locator(SIDE_NAVIGATION_ACTIVE).allInnerTexts()),
  };
}

/** The bucket list's frame at `path`: the address, the `h1` and the table's title. */
async function expectListAt(page: Page, path: string): Promise<void> {
  await expect(page).toHaveURL(addressOf(path));
  await expect(heading(page, H1), `the h1 "${H1}"`).toBeVisible();
  await expect(screen(page).title, `the table's title "${TABLE_TITLE}"`).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------

test.describe(() => {
  // The date line reads "Creation date" in the zone the check sets on its browser context.
  test.use({ timezoneId: SEOUL.timeZone });

  test('studio.s3-bucket-list-shows-what-the-emulator-holds', async ({ ctx, page }) => {
    const stack = await startStack(ctx);
    const port = stack.emulatorPort;
    const lines = new Lines(ctx);
    const p = checkPrefix(ctx, 'shows');
    const seeded = new Seeded(ctx, port);
    await seeded.bucket(`${p}-a`);
    await seeded.bucket(`${p}-b`, 'ap-northeast-2');
    await seeded.bucket(`${p}-c`);

    await lines.line(
      'With three buckets `<p>-…` made directly, one of them in `ap-northeast-2`, open `/` and choose "Amazon Simple Storage Service" → the address is `/aws/s3`, the `h1` is "Buckets", the crumbs are "EmuForge", "AWS", "S3", "Buckets", and the side navigation\'s link "General purpose buckets" is current',
      async () => {
        await page.goto('/');
        await providersSection(page).getByRole('link', { name: SERVICE_LABEL, exact: true }).click(ACTION);
        await expect(page).toHaveURL(addressOf(S3_PATH));
        await expect(heading(page, H1), `the h1 "${H1}"`).toBeVisible();
        await expect.poll(() => crumbs(page), { message: 'the crumbs' }).toEqual(CRUMBS);
        await expect
          .poll(async () => (await navigation(page)).current, { message: 'the current link' })
          .toEqual([NAV_GENERAL]);
      },
    );

    await lines.line(
      'Type `<p>` into "Find buckets by name" → the rows\' names, in order, equal the names a direct `ListBuckets` with that prefix returns',
      async () => {
        await filterFor(page, p);
        const direct = await bucketNamesDirect(ctx, port, p);
        expect(direct, 'a direct ListBuckets with the prefix lists the three buckets').toEqual([
          `${p}-a`,
          `${p}-b`,
          `${p}-c`,
        ]);
        await expectNames(page, direct, 'the rows under the filter <p>');
      },
    );

    await lines.line(
      'Each of those rows → its "AWS Region" is the Region name and the code the direct answer gives for that bucket, and its "Creation date" is that answer\'s date in the form of R4.2 in the zone the check sets on its browser context, Asia/Seoul, ending "(UTC+09:00)"',
      async () => {
        const direct = await listBucketsDirect(ctx, port, p);
        ctx.log(
          `direct: ${JSON.stringify(direct.map((b) => ({ name: b.name, region: b.region, date: b.creationDate })))}`,
        );
        expect(direct.find((b) => b.name === `${p}-b`)?.region, 'the direct answer puts <p>-b in ap-northeast-2').toBe(
          'ap-northeast-2',
        );
        const expected = direct.map((b) => ({
          name: b.name,
          region: regionText(b.region),
          date: creationDateText(b.creationDate, SEOUL),
        }));
        await expect
          .poll(() => shownRows(page), { message: 'the rows: name, AWS Region, Creation date' })
          .toEqual(expected);
        for (const row of expected) expect(row.date.endsWith('(UTC+09:00)'), `${row.date}`).toBe(true);
      },
    );

    await lines.line(
      'Open `/aws/s3/buckets` directly, then reload → the same screen both times, the address unchanged',
      async () => {
        await page.goto(BUCKETS_PATH);
        await expectListAt(page, BUCKETS_PATH);
        await page.reload();
        await expectListAt(page, BUCKETS_PATH);
      },
    );

    await lines.line(
      'On the screen → the side navigation has the header "Amazon S3" and the links "General purpose buckets" (current) and "Directory buckets"; the emulator line reads "Connected at `<endpoint>`", the notice reads "These buckets are in your local emulator", and the description names the same endpoint',
      async () => {
        await expectListAt(page, BUCKETS_PATH);
        await expect
          .poll(() => navigation(page), { message: 'the side navigation' })
          .toEqual({ links: [NAV_HEADER, NAV_GENERAL, NAV_DIRECTORY], current: [NAV_GENERAL] });
        await expectLine(page, connectedAt(port));
        await expect(screen(page).notice, `the notice "${NOTICE}"`).toBeVisible();
        await expect(page.getByText(descriptionAt(`https://127.0.0.1:${String(port)}`), { exact: true })).toBeVisible();
      },
    );

    lines.end();
  });
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-rereads-on-open-and-refresh', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'reread');
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(`${p}-first`);
  const record = ListBucketsRecord.attach(ctx, context, stack.engine.url);
  const cache = await CacheRecord.attach(ctx, context, page, stack.engine.url);
  const fresh = `${p}-new`;
  let openings = 0;
  let refreshes = 0;

  await lines.line(
    'With the filter `<p>` shown, make a bucket `<p>-new` directly → it is not on screen until "Refresh Buckets", and is after it',
    async () => {
      const before = record.answered();
      await openList(page);
      openings++;
      await record.answeredAfter(before, 'the opening sent a ListBuckets the engine answered');
      await filterFor(page, p);
      await expectNames(page, [`${p}-first`], 'the rows under the filter <p>');
      await seeded.bucket(fresh);
      // A condition, not a time: two of the emulator line's health checks (every 5 s, R4.4 of issue 45) pass.
      for (let i = 0; i < 2; i++) {
        await page.waitForResponse((r) => new URL(r.url()).pathname === '/__emuforge/health', { timeout: 10_000 });
      }
      expect(await shownNames(page), `${fresh} is not on screen before "Refresh Buckets"`).toEqual([`${p}-first`]);
      const n = record.answered();
      await screen(page).action(REFRESH).click(ACTION);
      refreshes++;
      await record.answeredAfter(n, 'the refresh sent a ListBuckets the engine answered');
      await expectNames(page, [`${p}-first`, fresh], 'the rows after "Refresh Buckets"');
    },
  );

  await lines.line(
    'Delete that bucket directly, leave for `/aws` by the "AWS" crumb and come back by the browser\'s Back → the screen shows "Loading buckets" or the fresh rows, never the deleted bucket, and the filter `<p>` then lists what a direct `ListBuckets` returns',
    async () => {
      // The Given: the bucket of the line before exists, whether or not that line held.
      if (!seeded.has(fresh)) await seeded.bucket(fresh);
      await seeded.remove(fresh);
      await crumbLink(page, 'AWS').click(ACTION);
      await expect(heading(page, AWS)).toBeVisible();
      await watchText(page, fresh);
      const n = record.answered();
      await page.goBack();
      openings++;
      await expect(heading(page, H1)).toBeVisible();
      await record.answeredAfter(n, 'coming back sent a ListBuckets the engine answered');
      await filterFor(page, p);
      const direct = await bucketNamesDirect(ctx, port, p);
      expect(direct, 'a direct ListBuckets with the prefix no longer lists the deleted bucket').toEqual([`${p}-first`]);
      await expectNames(page, direct, 'the rows under the filter <p>');
      expect(await appeared(page, fresh), `${fresh} appeared on the screen after coming back`).toBe(false);
    },
  );

  await lines.line(
    "Each opening and each refresh → the engine received a `ListBuckets` request for it (none answered from the browser's cache)",
    async () => {
      record.log();
      const answers = (await cache.all()).filter((a) => a.method === 'GET' && a.path === '/');
      const fromCache = answers.filter((a) => a.fromCache);
      expect(fromCache, 'ListBuckets answers the browser served from its own cache').toEqual([]);
      // Each opening and each refresh sent one without a prefix; typing the filter sent the others.
      const unfiltered = record.requests.filter((r) => r.status !== null && r.query.prefix === undefined).length;
      expect(
        unfiltered,
        `ListBuckets answered without a prefix, for ${String(openings)} openings and ${String(refreshes)} refresh`,
      ).toBeGreaterThanOrEqual(openings);
      expect(answers.length, 'ListBuckets answers that reached the page from the network').toBeGreaterThanOrEqual(
        openings + refreshes,
      );
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-filter-matches-the-start-of-a-name', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'filter');
  const seeded = new Seeded(ctx, port);
  for (const suffix of ['alpha', 'alto', 'beta']) await seeded.bucket(`${p}-${suffix}`);
  const record = ListBucketsRecord.attach(ctx, context, stack.engine.url);
  await openList(page);

  await lines.line(
    'With buckets `<p>-alpha`, `<p>-alto` and `<p>-beta` made directly, type `<p>-al` → exactly the first two, and "2 matches"',
    async () => {
      await filterFor(page, `${p}-al`);
      await expectNames(page, [`${p}-alpha`, `${p}-alto`], 'the rows under the filter <p>-al');
      await expect(page.getByText('2 matches', { exact: true })).toBeVisible();
    },
  );

  await lines.line(
    'Type `<p>-zzz` → "No matches" and the sentence with that text; "Clear filter" → the filter is empty and rows are shown',
    async () => {
      await filterFor(page, `${p}-zzz`);
      await expect(screen(page).empty.getByText(NO_MATCHES, { exact: true })).toBeVisible();
      await expect(screen(page).empty.getByText(noMatchSentence(`${p}-zzz`), { exact: true })).toBeVisible();
      await screen(page).empty.getByRole('button', { name: CLEAR_FILTER, exact: true }).click(ACTION);
      await expect(screen(page).filter).toHaveValue('');
      await expect.poll(async () => (await shownNames(page)).length, { message: 'rows are shown' }).toBeGreaterThan(0);
    },
  );

  await lines.line('Type `alpha` (a part of a name that is not its start) → no row named `<p>-alpha`', async () => {
    await filterFor(page, 'alpha');
    await expect
      .poll(() => record.requests.some((r) => r.query.prefix === 'alpha' && r.status !== null), {
        message: 'a ListBuckets with the prefix "alpha" was answered',
      })
      .toBe(true);
    await expect(screen(page).table.getByText(LOADING)).toHaveCount(0);
    expect(await shownNames(page), 'rows under the filter "alpha"').not.toContain(`${p}-alpha`);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-actions-lead-to-their-routes', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'actions');
  const one = `${p}-one`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(one);
  await seeded.object(one, 'kept.txt', 'kept');
  const keysBefore = await objectKeysDirect(ctx, port, one);
  const s = screen(page);

  /** The list under the filter `<p>`, with `one` as its only row. */
  async function listed(): Promise<void> {
    await expect(heading(page, H1)).toBeVisible();
    await filterFor(page, p);
    await expectNames(page, [one], 'the rows under the filter <p>');
  }

  /** Goes Back and waits for the bucket list. */
  async function back(): Promise<void> {
    await page.goBack();
    await expectListAt(page, BUCKETS_PATH);
  }

  await lines.line(
    'With one bucket `<p>-one` made directly and the filter `<p>`, nothing selected → "Copy ARN", "Empty" and "Delete" are disabled; select `<p>-one` → they are enabled',
    async () => {
      await openList(page);
      await listed();
      for (const name of SELECTION_ACTIONS)
        await expect(s.action(name), `"${name}" with nothing selected`).toBeDisabled();
      await s.radio(one).check(ACTION);
      for (const name of SELECTION_ACTIONS)
        await expect(s.action(name), `"${name}" with ${one} selected`).toBeEnabled();
    },
  );

  await lines.line(
    '"Empty" → the address is `/aws/s3/bucket/<p>-one/empty` without a document load; Back → the bucket list',
    async () => {
      await markPage(page);
      await s.action(EMPTY).click(ACTION);
      await expect(page).toHaveURL(addressOf(`/aws/s3/bucket/${one}/empty`));
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
      await back();
    },
  );

  await lines.line(
    '"Delete" (after selecting again) → `/aws/s3/bucket/<p>-one/delete`; Back; the name\'s link → `/aws/s3/buckets/<p>-one`; Back; "Create bucket" → `/aws/s3/bucket/create`; Back; the tab "Directory buckets" → `/aws/s3/directory-buckets`',
    async () => {
      await listed();
      await s.radio(one).check(ACTION);
      await s.action(DELETE).click(ACTION);
      await expect(page).toHaveURL(addressOf(`/aws/s3/bucket/${one}/delete`));
      await back();
      await listed();
      await s.nameLink(one).click(ACTION);
      await expect(page).toHaveURL(addressOf(`/aws/s3/buckets/${one}`));
      await back();
      await s.action(CREATE).click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws/s3/bucket/create'));
      await back();
      await s.tab(TAB_DIRECTORY).click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws/s3/directory-buckets'));
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  await lines.line(
    "After all of them → a direct `ListBuckets` still returns `<p>-one`, and a direct `ListObjectsV2` of it is unchanged (one object put before the check's first step is still there)",
    async () => {
      expect(await bucketNamesDirect(ctx, port, p), 'a direct ListBuckets with the prefix').toEqual([one]);
      expect(keysBefore, 'the object put before the first step').toEqual(['kept.txt']);
      expect(await objectKeysDirect(ctx, port, one), `a direct ListObjectsV2 of ${one}`).toEqual(keysBefore);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-copy-arn-copies-the-emulators-arn', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'copyarn');
  const bucket = `${p}-arn`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(bucket);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: stack.studio.origin });
  const s = screen(page);

  // With a bucket `<p>-arn` this check makes directly and the filter `<p>-arn`, select it and choose "Copy ARN" → the
  // clipboard's text equals the `BucketArn` a direct `ListBuckets` gives for it, and "ARN copied" is shown.
  const direct = await listBucketsDirect(ctx, port, bucket);
  const arn = direct.find((b) => b.name === bucket)?.arn ?? null;
  expect(arn, `a direct ListBuckets gives a BucketArn for ${bucket}`).not.toBeNull();
  await openList(page);
  await filterFor(page, bucket);
  await expectNames(page, [bucket], 'the rows under the filter <p>-arn');
  // Something else on the clipboard first, so the check sees the copy and not what was there.
  await page.evaluate(() => navigator.clipboard.writeText('before'));
  await s.radio(bucket).check(ACTION);
  await s.action(COPY_ARN).click(ACTION);
  await expect(page.getByText(ARN_COPIED, { exact: true }).first(), `"${ARN_COPIED}"`).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { message: "the clipboard's text" })
    .toBe(arn);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-list-help-and-notice', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);
  const s = screen(page);
  await openList(page);

  /** Whether focus is inside the help panel. */
  const focusInPanel = () =>
    page.evaluate((selector) => {
      const panel = document.querySelector(selector);
      return panel !== null && document.activeElement !== null && panel.contains(document.activeElement);
    }, TOOLS);

  await lines.line(
    'Choose "Info" → the help panel is open with the heading "Buckets" and focus inside it; close it → focus is on "Info"',
    async () => {
      await s.info.first().click(ACTION);
      await expect(s.tools.getByRole('heading', { name: H1, exact: true }), "the help panel's heading").toBeVisible();
      await expect.poll(focusInPanel, { message: 'focus is inside the help panel' }).toBe(true);
      await page.getByRole('button', { name: HELP_CLOSE, exact: true }).click(ACTION);
      await expect.poll(() => hasFocus(s.info.first()), { message: `focus is on "${INFO}"` }).toBe(true);
    },
  );

  await lines.line(
    'Close the notice with "Close the local emulator notice" → it is gone and focus is on "About the local emulator"; activate that control → the notice is back and focused',
    async () => {
      await expect(s.notice).toBeVisible();
      await s.noticeClose.click(ACTION);
      await expect(s.notice, 'the notice').toHaveCount(0);
      await expect.poll(() => hasFocus(s.about), { message: `focus is on "${ABOUT}"` }).toBe(true);
      await page.keyboard.press('Enter');
      await expect(s.notice, 'the notice').toBeVisible();
      // Focused: the focused element holds the notice's text and not the rest of the screen.
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ notice, title }) => {
                const text = document.activeElement?.textContent ?? '';
                return text.includes(notice) && !text.includes(title);
              },
              { notice: NOTICE, title: TABLE_TITLE },
            ),
          { message: 'focus is on the notice' },
        )
        .toBe(true);
    },
  );

  await lines.line(
    'The help panel\'s text → it holds "not an AWS feature" and none of the capture\'s description sentence ("Buckets are containers for data stored in S3.")',
    async () => {
      await s.info.first().click(ACTION);
      await expect(s.tools.getByRole('heading', { name: H1, exact: true })).toBeVisible();
      const text = (await s.tools.innerText(ACTION)).replace(/\s+/g, ' ');
      expect(text, 'the help panel holds "not an AWS feature"').toContain('not an AWS feature');
      expect(text, "the help panel holds none of the capture's sentence").not.toContain(
        'Buckets are containers for data stored in S3.',
      );
    },
  );

  lines.end();
});
