// The AWS area's "no screen yet" page below a service that has screens, in the built app served by `bun run serve`,
// in front of a real engine started for that Studio and an emulator (test-criteria.md, issue 57, Flow checks;
// requirement R4, R6, R7): what it says, that opening it changes nothing in the emulator, that it is the same page at
// every path no screen matches, that it follows the emulator's stop and start, and its keyboard order and layout.
//
// `studio.aws-no-screen-part-says-what-is-missing`, `studio.aws-no-screen-part-changes-nothing-in-the-emulator`,
// `studio.aws-no-screen-part-same-page-at-every-unlisted-path`,
// `studio.aws-no-screen-part-follows-emulator-stop-and-start`, `studio.aws-no-screen-part-keyboard-and-layout`.
//
// These are checks of the area's own page, shared by every service: they open paths of S3, Lambda and IAM that no
// screen matches on `main` (requirement R2's table) and carry no `service` in the manifest. Other checks make buckets
// on the run's emulator at the same time, so each check names its buckets with its own prefix `<p>`. The page reads
// nothing (R2), so a path that names a function or a role, and the long paths, are opened directly without one.
//
// Words and readers of the page: `support/no-screen-part.ts`; a bucket's page: `services/s3/s3-bucket-page.ts`; the
// bucket list and the direct calls: `services/s3/s3.ts`.
//
// Issue 480 gave the bucket its "Objects" tab and removed the "Directory buckets" link and tab and the tiering section
// (decisions.md, the listed checks and the Plan decision on this file): the page is reached from the bucket's page by
// the buttons of kept sections, which still lead to it, and `…/metrics`, still unbuilt, stands for `…/objects`. The
// tabs of a function's page that lead to it are Lambda's own check (`lambda-function-list.spec.ts`).
//
// The Tab walk of the keyboard check allows Cloudscape's own stops where Cloudscape places them, as the bucket list's
// keyboard check does: "Close navigation" before the navigation's header, the toggle of the navigation's section
// after it, and the current-page crumb, which Cloudscape's breadcrumb group renders as a Tab stop
// (`support/aws-area.ts`, `currentCrumb`). Every other stop must be the next one the criteria line names.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, NO_SCREEN_SERVICE, startStack, test } from './support';
import {
  areaImages,
  connectedAt,
  connectionStatusLink,
  crumbLink,
  currentCrumb,
  emulatorLine,
  expectLine,
  LINE_CHANGE_BOUND_MS,
  notStartedOn,
} from './support/aws-area';
import {
  contentStopProblems,
  describeStop,
  expectNextContentStop,
  expectTarget,
  focusedAx,
  focusRing,
  pressTab,
} from './support/focus';
import {
  ACTION,
  addressOf,
  expectHome,
  expectNoScreenYet,
  heading,
  NAVIGATION_TOGGLE,
  SIDE_NAVIGATION,
  SIDE_NAVIGATION_ACTIVE,
  titleOf,
} from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { languageContext } from './support/languages';
import { Lines } from './support/lines';
import {
  action,
  actions,
  crumbTrail,
  expectCrumbs,
  expectNoScreenPart,
  expectPath,
  GO_HOME,
  goTo,
  navigationShown,
  NO_SCREEN_PART_H1,
  nothingChanged,
  PART_SERVICES,
  partShown,
  PATH_LABEL,
  pathFitProblems,
  pathLayout,
  pathPlaceProblems,
} from './support/no-screen-part';
import { checkPrefix, scrollsSideways } from './support/service-screens';
import {
  H1 as BUCKETS_H1,
  LONGEST_NAME,
  NAV_DIRECTORY,
  NAV_GENERAL,
  NAV_HEADER,
  NO_BUCKETS,
  bucketNamesDirect,
  objectKeysDirect,
  openList,
  screen,
  Seeded,
} from './services/s3/s3';
import {
  bucketPath,
  EngineRecord,
  expectBucketPage,
  OBJECTS,
  openBucketPage,
  sectionButton,
  VERSIONING,
  WEBSITE,
} from './services/s3/s3-bucket-page';

const S3 = PART_SERVICES.s3;
const LAMBDA = PART_SERVICES.lambda;
const IAM = PART_SERVICES.iam;

/** The first action under S3 (R4.7). */
const GO_TO_BUCKETS = goTo(S3.first);

const DIRECTORY_PATH = '/aws/s3/directory-buckets';

/**
 * "Edit" of "Bucket Versioning" and of "Static website hosting", for `name` (R2's table; the website section stands
 * for the tiering section issue 480 removed); the tiering section's old "Create configuration" path, still a path no
 * screen matches, for the 114-character path of the layout lines; and a bucket's `…/metrics`, a tab issue 480 removed.
 */
const versioningEditPath = (name: string) => `/aws/s3/bucket/${name}/property/versioning/edit`;
const websiteEditPath = (name: string) => `/aws/s3/bucket/${name}/property/website/edit`;
const tieringCreatePath = (name: string) => `/aws/s3/bucket/${name}/property/intelligent-tiering/create`;
const metricsPath = (name: string) => `${bucketPath(name)}/metrics`;

/** The crumbs of the page at a path below a bucket's page (R4.3). */
const bucketCrumbs = (name: string) => ['EmuForge', 'AWS', S3.crumb, 'Buckets', name, NO_SCREEN_PART_H1];

/** The crumbs of the page at a path with no screen above, under S3 (R4.3). */
const S3_CRUMBS = ['EmuForge', 'AWS', S3.crumb, NO_SCREEN_PART_H1];

/** A section's button on a bucket's page, waited for until it can be chosen (the section shows it once read). */
async function chooseSectionButton(page: Page, section: string, name: string): Promise<void> {
  const control = sectionButton(page, section, name);
  await expect(control.first(), `"${name}" of "${section}"`).toBeVisible(ACTION);
  await control.first().click(ACTION);
}

/** Waits for the bucket list at `/aws/s3` or `at`, read: its `h1` and its table. */
async function expectBucketList(page: Page, at: string): Promise<void> {
  await expect(page).toHaveURL(addressOf(at));
  await expect(heading(page, BUCKETS_H1), `the bucket list's h1 "${BUCKETS_H1}"`).toBeVisible();
}

/** The current side navigation link's text, as a poll can compare it. */
async function currentLinks(page: Page): Promise<string[]> {
  return (await navigationShown(page)).current;
}

const WIDTHS = [1280, 390] as const;

async function sizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-no-screen-part-says-what-is-missing', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'part-says');
  const name = `${p}-b`;
  const edit = versioningEditPath(name);
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);

  /** From the bucket's page, "Edit" of "Bucket Versioning", without a document load; the page is not read here. */
  async function fromVersioningEdit(): Promise<void> {
    await openBucketPage(page, name);
    await markPage(page);
    await chooseSectionButton(page, VERSIONING, 'Edit');
    await expect(page).toHaveURL(addressOf(edit));
    expect(await stillSamePage(page), '"Edit" of "Bucket Versioning": no document was loaded').toBe(true);
  }

  await lines.line(
    'With a bucket `<p>-b` made directly, open its page on "Properties" and choose "Edit" of "Bucket Versioning" → the address is `/aws/s3/bucket/<p>-b/property/versioning/edit`, without a document load; the `h1` is "No screen yet", the content holds the statement and nowhere the old sentence (regression)',
    async () => {
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
    },
  );

  await lines.line(
    'On that page → "Path" shows `/aws/s3/bucket/<p>-b/property/versioning/edit`, and the sentence is shown',
    async () => {
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
      await expectPath(page, edit);
      await expect(nothingChanged(page), 'the sentence').toBeVisible();
    },
  );

  await lines.line(
    'On that page → the crumbs are "EmuForge", "AWS", "S3", "Buckets", "`<p>-b`", "No screen yet", the last no link; the side navigation has the header "Amazon S3" and the one link "General purpose buckets", which is current, and no link "Amazon Kinesis"',
    async () => {
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
      await expectCrumbs(page, bucketCrumbs(name));
      await expect
        .poll(() => currentLinks(page), {
          message: 'the current navigation link',
        })
        .toEqual([NAV_GENERAL]);
      const nav = await navigationShown(page);
      ctx.log(`side navigation: ${JSON.stringify(nav)}`);
      expect(nav.header, 'the navigation header').toBe(NAV_HEADER);
      expect(nav.links, 'the navigation links').toEqual([NAV_GENERAL]);
      expect(nav.links, `no link "${NO_SCREEN_SERVICE.label}"`).not.toContain(NO_SCREEN_SERVICE.label);
    },
  );

  await lines.line(
    'On that page → the document title is "No screen yet | EmuForge Studio" and focus is on the content target named "No screen yet"',
    async () => {
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
      await expect(page).toHaveTitle(titleOf(NO_SCREEN_PART_H1));
      await expectTarget(page, NO_SCREEN_PART_H1, GO_TO_BUCKETS);
    },
  );

  await lines.line(
    'Choose the crumb "`<p>-b`" → the bucket\'s page at `/aws/s3/buckets/<p>-b` (`h1` the name) on its tab "Objects", without a document load',
    async () => {
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
      await crumbLink(page, name).click(ACTION);
      await expect(page).toHaveURL(addressOf(bucketPath(name)));
      await expectBucketPage(page, name, OBJECTS);
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  await lines.line(
    'On the bucket\'s page choose "Edit" of "Static website hosting" → the changed page at `/aws/s3/bucket/<p>-b/property/website/edit`, "Path" showing that path, the same six crumbs, "General purpose buckets" current; the crumb "`<p>-b`" → the bucket\'s page at `/aws/s3/buckets/<p>-b`',
    async () => {
      const website = websiteEditPath(name);
      await openBucketPage(page, name);
      await markPage(page);
      await chooseSectionButton(page, WEBSITE, 'Edit');
      await expectNoScreenPart(page, S3.label, website);
      await expectPath(page, website);
      await expectCrumbs(page, bucketCrumbs(name));
      await expect
        .poll(() => currentLinks(page), {
          message: 'the current navigation link',
        })
        .toEqual([NAV_GENERAL]);
      await crumbLink(page, name).click(ACTION);
      await expect(page).toHaveURL(addressOf(bucketPath(name)));
      await expectBucketPage(page, name, OBJECTS);
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  await lines.line(
    'From "Edit" of "Bucket Versioning" again: "Go to Buckets" → the address is `/aws/s3`, the `h1` is "Buckets", without a document load',
    async () => {
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
      await action(page, GO_TO_BUCKETS).click(ACTION);
      await expectBucketList(page, S3.firstPath);
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  await lines.line(
    'Back, then the crumb "S3" → the bucket list; Back, then the crumb "Buckets" → `/aws/s3/buckets` and the bucket list; Back, then "Go to Home" → Studio\'s home at `/`',
    async () => {
      // The Given: the bucket list reached by "Go to Buckets" from the page.
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
      await action(page, GO_TO_BUCKETS).click(ACTION);
      await expectBucketList(page, S3.firstPath);

      await page.goBack();
      await expectNoScreenPart(page, S3.label, edit);
      await crumbLink(page, S3.crumb).click(ACTION);
      await expectBucketList(page, S3.firstPath);

      await page.goBack();
      await expectNoScreenPart(page, S3.label, edit);
      await crumbLink(page, 'Buckets').click(ACTION);
      await expectBucketList(page, '/aws/s3/buckets');

      await page.goBack();
      await expectNoScreenPart(page, S3.label, edit);
      await action(page, GO_HOME).click(ACTION);
      await expectHome(page);
    },
  );

  await lines.line(
    'Back from Home → the changed page at `/aws/s3/bucket/<p>-b/property/versioning/edit` again',
    async () => {
      await fromVersioningEdit();
      await expectNoScreenPart(page, S3.label, edit);
      await action(page, GO_HOME).click(ACTION);
      await expectHome(page);
      await page.goBack();
      await expectNoScreenPart(page, S3.label, edit);
      await expectPath(page, edit);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-no-screen-part-changes-nothing-in-the-emulator', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'part-nothing');
  const keep = `${p}-keep`;
  const none = `${p}-none`;
  const key = 'kept/object.txt';
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(keep);
  await seeded.object(keep, key, 'kept by the check');
  const record = EngineRecord.attach(ctx, context, stack.engine.url);

  /** One visit of a changed page: its path and the AWS requests the engine received while it was shown. */
  interface Visit {
    what: string;
    path: string;
    requests: string[];
  }
  const visits = new Map<string, Visit>();

  /**
   * From the page `open` opens, `choose` a control that leads to `path`, then `read` the page there. The engine's AWS
   * requests are counted from the moment the address is `path` until the check leaves it, after the emulator line
   * shows its answer (the page has asked for all it asks for by then). The visit is kept whether or not `read` holds.
   */
  async function visit(
    what: string,
    path: string,
    open: () => Promise<void>,
    choose: () => Promise<void>,
    read: () => Promise<void>,
  ) {
    await open();
    await choose();
    await expect(page).toHaveURL(addressOf(path));
    const from = record.requests.length;
    try {
      await read();
      await expectLine(page, connectedAt(port));
    } finally {
      visits.set(what, { what, path, requests: record.operations(from) });
    }
  }

  const VERSIONING_EDIT = '"Edit" of "Bucket Versioning"';
  const WEBSITE_EDIT = '"Edit" of "Static website hosting"';
  const editVisit = () =>
    visit(
      VERSIONING_EDIT,
      versioningEditPath(keep),
      () => openBucketPage(page, keep),
      () => chooseSectionButton(page, VERSIONING, 'Edit'),
      async () => {
        await expectNoScreenPart(page, S3.label, versioningEditPath(keep));
        await expectPath(page, versioningEditPath(keep));
      },
    );
  const websiteVisit = () =>
    visit(
      WEBSITE_EDIT,
      websiteEditPath(keep),
      () => openBucketPage(page, keep),
      () => chooseSectionButton(page, WEBSITE, 'Edit'),
      async () => {
        await expectNoScreenPart(page, S3.label, websiteEditPath(keep));
        await expectPath(page, websiteEditPath(keep));
      },
    );

  /** The two visits, each made once; a visit a line before already made is not made again. */
  async function fallbackVisits(): Promise<void> {
    for (const [what, make] of [
      [VERSIONING_EDIT, editVisit],
      [WEBSITE_EDIT, websiteVisit],
    ] as const) {
      if (!visits.has(what)) await make().catch(() => undefined);
    }
    expect([...visits.keys()].sort(), 'the two controls were followed').toEqual(
      [VERSIONING_EDIT, WEBSITE_EDIT].sort(),
    );
  }

  await lines.line(
    'With a bucket `<p>-keep` and one object in it made directly, open the bucket\'s page on "Properties" and choose "Edit" of "Bucket Versioning" → the changed page at `/aws/s3/bucket/<p>-keep/property/versioning/edit`, "Path" showing that path',
    editVisit,
  );

  await lines.line(
    'Open it again, choose "Edit" of "Static website hosting" → the changed page at `/aws/s3/bucket/<p>-keep/property/website/edit`',
    websiteVisit,
  );

  await lines.line(
    'After both visits → a direct `ListBuckets` still returns `<p>-keep`, and a direct `ListObjectsV2` of it returns the same one key',
    async () => {
      await fallbackVisits();
      expect(await bucketNamesDirect(ctx, port, p), `a direct ListBuckets under ${p}`).toContain(keep);
      expect(await objectKeysDirect(ctx, port, keep), `a direct ListObjectsV2 of ${keep}`).toEqual([key]);
    },
  );

  await lines.line(
    'From the load of each changed page until the check leaves it → the engine received no AWS request (only its own connection checks)',
    async () => {
      await fallbackVisits();
      record.log();
      const sent = [...visits.values()].filter((v) => v.requests.length > 0);
      expect(
        sent.map((v) => `${v.what} (${v.path}): ${v.requests.join(', ')}`),
        'AWS requests while a changed page was shown',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Open `/aws/s3/buckets/<p>-none/metrics`, a bucket that does not exist → the same page and crumbs (with "`<p>-none`"), and no AWS request; a direct `ListBuckets` holds no `<p>-none`',
    async () => {
      const path = metricsPath(none);
      const from = record.requests.length;
      await page.goto(path);
      await expectNoScreenPart(page, S3.label, path);
      await expectPath(page, path);
      await expectCrumbs(page, bucketCrumbs(none));
      await expectLine(page, connectedAt(port));
      expect(record.operations(from), `AWS requests after opening ${path}`).toEqual([]);
      expect(await bucketNamesDirect(ctx, port, p), `a direct ListBuckets under ${p}`).not.toContain(none);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-no-screen-part-same-page-at-every-unlisted-path', async ({ ctx, page, browser, proxy }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'part-same');

  /** Opens `path` directly and waits for the changed page of `label` there, "Path" showing `path`. */
  async function openPart(path: string, label: string = S3.label, on: Page = page): Promise<void> {
    await on.goto(path);
    await expectNoScreenPart(on, label, path);
    await expectPath(on, path);
  }

  await lines.line(
    'Open directly, one after another, `/aws/s3/anything/at/all` and `/aws/s3/` → the changed page at each, the address unchanged, "Path" showing the path exactly as opened; the crumbs are "EmuForge", "AWS", "S3", "No screen yet"; no navigation link is current',
    async () => {
      for (const path of ['/aws/s3/anything/at/all', '/aws/s3/']) {
        await openPart(path);
        await expectCrumbs(page, S3_CRUMBS);
        await expect(page.locator(SIDE_NAVIGATION), `the side navigation at ${path}`).toHaveCount(1);
        await expect(page.locator(SIDE_NAVIGATION_ACTIVE), `no current navigation link at ${path}`).toHaveCount(0);
        await expect(page, `the address at ${path}`).toHaveURL(addressOf(path));
      }
    },
  );

  await lines.line(
    'Open `/aws/s3/buckets/a%2Fb/metrics` → the changed page, "Path" showing `/aws/s3/buckets/a%2Fb/metrics` undecoded; the crumb before "No screen yet" reads `a/b` and its address is `/aws/s3/buckets/a%2Fb`',
    async () => {
      const path = '/aws/s3/buckets/a%2Fb/metrics';
      await openPart(path);
      await expectCrumbs(page, bucketCrumbs('a/b'));
      const trail = await crumbTrail(page);
      const before = trail.at(-2);
      expect(before?.text, 'the crumb before "No screen yet"').toBe('a/b');
      expect(before?.href, "that crumb's address").toBe('/aws/s3/buckets/a%2Fb');
    },
  );

  await lines.line(
    'Open `/aws/s3/directory-buckets` directly → the changed page, no navigation link shown current and no link "Directory buckets"; reload → the same page',
    async () => {
      await openPart(DIRECTORY_PATH);
      await expect(page.locator(SIDE_NAVIGATION_ACTIVE), 'no current navigation link').toHaveCount(0);
      const nav = await navigationShown(page);
      ctx.log(`side navigation: ${JSON.stringify(nav)}`);
      expect(nav.links, `no link "${NAV_DIRECTORY}"`).not.toContain(NAV_DIRECTORY);
      await page.reload();
      await expectNoScreenPart(page, S3.label, DIRECTORY_PATH);
      await expectPath(page, DIRECTORY_PATH);
      await expect(page.locator(SIDE_NAVIGATION_ACTIVE), 'no current navigation link after reload').toHaveCount(0);
    },
  );

  await lines.line(
    'Open `/aws/lambda/functions/function/<p>-fn/test` → the changed page with "Studio has no screen for this part of AWS Lambda yet."; the crumbs are "EmuForge", "AWS", "Lambda", "Event Functions", "`<p>-fn`", "No screen yet"; the navigation\'s "Event Functions" is current; the first action is "Go to Event Functions" with the address `/aws/lambda`',
    async () => {
      const fn = `${p}-fn`;
      await openPart(`/aws/lambda/functions/function/${fn}/test`, LAMBDA.label);
      await expectCrumbs(page, ['EmuForge', 'AWS', LAMBDA.crumb, LAMBDA.first, fn, NO_SCREEN_PART_H1]);
      await expect
        .poll(() => currentLinks(page), {
          message: 'the current navigation link',
        })
        .toEqual([LAMBDA.first]);
      const shown = await actions(page);
      expect(shown[0], 'the first action').toEqual({
        name: goTo(LAMBDA.first),
        href: LAMBDA.firstPath,
      });
    },
  );

  await lines.line(
    'Open `/aws/lambda/layers` → the changed page; the crumbs are "EmuForge", "AWS", "Lambda", "No screen yet"',
    async () => {
      await openPart('/aws/lambda/layers', LAMBDA.label);
      await expectCrumbs(page, ['EmuForge', 'AWS', LAMBDA.crumb, NO_SCREEN_PART_H1]);
    },
  );

  await lines.line(
    'Open `/aws/iam/roles/details/<p>-role/tags` → the changed page with "Studio has no screen for this part of AWS Identity and Access Management yet."; the crumbs are "EmuForge", "AWS", "IAM", "Roles", "`<p>-role`", "No screen yet"; the first action is "Go to Roles" with the address `/aws/iam`',
    async () => {
      const role = `${p}-role`;
      await openPart(`/aws/iam/roles/details/${role}/tags`, IAM.label);
      await expectCrumbs(page, ['EmuForge', 'AWS', IAM.crumb, IAM.first, role, NO_SCREEN_PART_H1]);
      const shown = await actions(page);
      expect(shown[0], 'the first action').toEqual({
        name: goTo(IAM.first),
        href: IAM.firstPath,
      });
    },
  );

  await lines.line(
    'Open `/aws/kinesis` and `/aws/kinesis/streams` → today\'s page: the `h1` "Amazon Kinesis", "Studio has no screen for Amazon Kinesis yet.", the services list as navigation, one action "Go to Home", and no "Path"',
    async () => {
      for (const path of [NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.below]) {
        await page.goto(path);
        await expectNoScreenYet(page, NO_SCREEN_SERVICE.label, path);
        const nav = await navigationShown(page);
        expect(nav.links, `the services list as navigation at ${path}`).toEqual(
          expect.arrayContaining([NO_SCREEN_SERVICE.label, S3.label, LAMBDA.label, IAM.label]),
        );
        expect(nav.current, `the service current at ${path}`).toEqual([NO_SCREEN_SERVICE.label]);
        expect(
          (await actions(page)).map((a) => a.name),
          `the actions at ${path}`,
        ).toEqual([GO_HOME]);
        await expect(page.getByRole('main').getByText(PATH_LABEL, { exact: true }), `no "${PATH_LABEL}"`).toHaveCount(
          0,
        );
      }
    },
  );

  await lines.line(
    'With Studio\'s language set to Korean by a stored choice, as a user\'s browser holds it, open `/aws/s3/directory-buckets` → the `h1`, statement, "Path", sentence and both actions read exactly as in English',
    async () => {
      const { page: korean } = await languageContext(ctx, browser, proxy, stack.studio, { stored: 'ko' });
      await openPart(DIRECTORY_PATH, S3.label, korean);
      expect(await korean.evaluate(() => document.documentElement.lang), "Studio's language is Korean").toBe('ko');
      await expect(nothingChanged(korean), 'the sentence in English').toBeVisible();
      await expect(korean.getByRole('main').getByText(PATH_LABEL, { exact: true }), `"${PATH_LABEL}"`).toHaveCount(1);
      expect(
        (await actions(korean)).map((a) => a.name),
        'the actions in English',
      ).toEqual([GO_TO_BUCKETS, GO_HOME]);
      expect(await partShown(korean, S3.label), 'the page in Korean Studio').toEqual({
        h1: NO_SCREEN_PART_H1,
        statement: true,
        path: DIRECTORY_PATH,
        sentence: true,
        actions: [GO_TO_BUCKETS, GO_HOME],
      });
    },
  );

  await lines.line(
    'Open `/aws/s3` and `/aws/s3/buckets` → the bucket list (`h1` "Buckets"); open `/aws/does-not-exist` → the area\'s "Page not found"',
    async () => {
      for (const path of [S3.firstPath, '/aws/s3/buckets']) {
        await openList(page, path);
        await expectBucketList(page, path);
      }
      await page.goto('/aws/does-not-exist');
      await expect(heading(page, 'Page not found'), 'the area\'s "Page not found"').toBeVisible();
      await expect(page.locator(SIDE_NAVIGATION), 'inside the AWS area').toHaveCount(1);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-no-screen-part-follows-emulator-stop-and-start', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);

  /** Opens the page at `/aws/s3/directory-buckets` and waits for it and for the line to read `status`. */
  async function openPart(status: RegExp): Promise<void> {
    await page.goto(DIRECTORY_PATH);
    await expectNoScreenPart(page, S3.label, DIRECTORY_PATH);
    await expectPath(page, DIRECTORY_PATH);
    await expectLine(page, status, LINE_CHANGE_BOUND_MS * 2);
  }

  /** What the page shows of its own while the emulator runs: the expectation for every state. */
  const expected = {
    h1: NO_SCREEN_PART_H1,
    statement: true,
    path: DIRECTORY_PATH,
    sentence: true,
    actions: [GO_TO_BUCKETS, GO_HOME],
  };

  await lines.line(
    'Open `/aws/s3/directory-buckets` with the emulator running → the line reads "Connected at `<endpoint>`" and the changed page is shown',
    async () => {
      await openPart(connectedAt(port));
      expect(await partShown(page, S3.label), 'the page while connected').toEqual(expected);
    },
  );

  await lines.line(
    'Stop the emulator → within two connection checks the line reads "Not started on port `<port>`" with the link "Connection status"; the `h1`, statement, path, sentence and both actions are unchanged',
    async () => {
      await openPart(connectedAt(port));
      await emulator.stop();
      await expectLine(page, notStartedOn(port));
      await expect(connectionStatusLink(page), 'the line\'s "Connection status"').toBeVisible();
      expect(await partShown(page, S3.label), 'the page with the emulator stopped').toEqual(expected);
    },
  );

  await lines.line(
    'In that state, Tab through the content → "Connection status" comes before "Go to Buckets"; "Connection status" → Home; Back → the changed page in the same state',
    async () => {
      await emulator.stop();
      await openPart(notStartedOn(port));
      await expect(currentCrumb(page), 'the current-page crumb').toHaveText(NO_SCREEN_PART_H1);
      await currentCrumb(page).focus(ACTION);
      const first = await pressTab(page);
      expect(contentStopProblems(first, 'Connection status'), 'the next Tab reaches "Connection status"').toEqual([]);
      const second = await pressTab(page);
      expect(contentStopProblems(second, GO_TO_BUCKETS), `the Tab after reaches "${GO_TO_BUCKETS}"`).toEqual([]);
      await connectionStatusLink(page).click(ACTION);
      await expectHome(page);
      await page.goBack();
      await expectNoScreenPart(page, S3.label, DIRECTORY_PATH);
      await expectLine(page, notStartedOn(port));
      expect(await partShown(page, S3.label), 'the page after Back').toEqual(expected);
    },
  );

  await lines.line(
    'Start an emulator on the same port → without a reload the line reads "Connected at `<endpoint>`", the page unchanged; "Go to Buckets" → the bucket list reading "No buckets"',
    async () => {
      await emulator.stop();
      await openPart(notStartedOn(port));
      await markPage(page);
      await emulator.startAgain();
      await expectLine(page, connectedAt(port), LINE_CHANGE_BOUND_MS * 2);
      expect(await stillSamePage(page), 'no reload').toBe(true);
      expect(await partShown(page, S3.label), 'the page after the start').toEqual(expected);
      await action(page, GO_TO_BUCKETS).click(ACTION);
      await expectBucketList(page, S3.firstPath);
      await expect(screen(page).empty.getByText(NO_BUCKETS, { exact: true }), `"${NO_BUCKETS}"`).toBeVisible();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

/** A Tab stop as the browser reports it. */
interface Stop {
  role: string;
  name: string;
  /** Inside the AWS area (an element with a Cloudscape class around it). */
  inArea: boolean;
  /** The focus indicator it draws; `null` when none. */
  ring: string | null;
}

async function areaStop(page: Page): Promise<Stop | null> {
  const ax = await focusedAx(page);
  if (ax === null) return null;
  const inArea = await page.evaluate(() => {
    for (let a: Element | null = document.activeElement; a; a = a.parentElement) {
      if ([...a.classList].some((c) => c.startsWith('awsui'))) return true;
    }
    return false;
  });
  return { role: ax.role, name: ax.name, inArea, ring: await focusRing(page) };
}

const shownStop = (stop: Stop) => `${stop.role} "${stop.name}"`;

interface Expected {
  what: string;
  match: (stop: Stop) => boolean;
  optional?: boolean;
}

const named =
  (name: string, role?: string) =>
  (stop: Stop): boolean =>
    stop.name === name && (role === undefined || stop.role === role);

/** The stops of the criteria line in order, for the page below the bucket `name`, with Cloudscape's own allowed. */
function keyboardOrder(name: string): Expected[] {
  return [
    {
      what: '"Close navigation" (Cloudscape\'s layout)',
      match: named('Close navigation', 'button'),
      optional: true,
    },
    {
      what: `the navigation's header "${NAV_HEADER}"`,
      match: named(NAV_HEADER, 'link'),
    },
    {
      what: "the toggle of the navigation's section (Cloudscape's)",
      match: named('Buckets', 'button'),
      optional: true,
    },
    { what: `"${NAV_GENERAL}"`, match: named(NAV_GENERAL, 'link') },
    { what: 'the crumb "EmuForge"', match: named('EmuForge', 'link') },
    { what: 'the crumb "AWS"', match: named('AWS', 'link') },
    { what: `the crumb "${S3.crumb}"`, match: named(S3.crumb, 'link') },
    { what: 'the crumb "Buckets"', match: named('Buckets', 'link') },
    { what: `the crumb "${name}"`, match: named(name, 'link') },
    {
      what: `the current crumb "${NO_SCREEN_PART_H1}" (Cloudscape's)`,
      match: named(NO_SCREEN_PART_H1),
      optional: true,
    },
    { what: `"${GO_TO_BUCKETS}"`, match: named(GO_TO_BUCKETS, 'link') },
    { what: `"${GO_HOME}"`, match: named(GO_HOME, 'link') },
  ];
}

function orderProblems(stops: Stop[], expected: Expected[]): string[] {
  let at = 0;
  for (const want of expected) {
    const stop = stops[at] as Stop | undefined;
    if (stop !== undefined && want.match(stop)) {
      at++;
      continue;
    }
    if (want.optional) continue;
    return [`expected ${want.what}, the Tab reached ${stop === undefined ? 'nothing more' : shownStop(stop)}`];
  }
  return stops.slice(at).map((stop) => `${shownStop(stop)} after the last expected stop`);
}

/** The Cloudscape classes outside the area's root (`aws-area`, `studio/src/providers/aws/area/styles/root-class.ts`). */
async function cloudscapeOutsideArea(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => [...el.classList].some((c) => c.startsWith('awsui')) && el.closest('.aws-area') === null)
      .slice(0, 10)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].find((c) => c.startsWith('awsui')) ?? ''}`),
  );
}

test('studio.aws-no-screen-part-keyboard-and-layout', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'part-keys');
  const name = `${p}-b`;
  const metrics = metricsPath(name);
  const longest = `${p}-${'x'.repeat(LONGEST_NAME - p.length - 1)}`;
  const long114 = tieringCreatePath(longest);
  const long87 = metricsPath(longest);

  /** Opens `path` afresh and waits for the page, its path and the line's first answer (the line's height is set). */
  async function openPart(path: string): Promise<void> {
    await page.goto(path);
    await expectNoScreenPart(page, S3.label, path);
    await expectPath(page, path);
    await expectLine(page, connectedAt(port));
  }

  await lines.line(
    'Fresh load of `/aws/s3/buckets/<p>-b/metrics`, Tab from the document start, past Studio\'s frame → the stops inside the area come in this order: "Close navigation" (Cloudscape\'s layout; an optional stop, named as the bucket list\'s keyboard check names it, where Cloudscape places it), the navigation\'s header and its one link "General purpose buckets", the crumbs\' links ("EmuForge", "AWS", "S3", "Buckets", "`<p>-b`"), "Go to Buckets", "Go to Home"; each has a visible focus indicator',
    async () => {
      await openPart(metrics);
      const stops: Stop[] = [];
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        const stop = await areaStop(page);
        if (stop === null) break;
        if (!stop.inArea) {
          if (stops.length > 0) break;
          continue;
        }
        stops.push(stop);
      }
      ctx.log(`Tab stops in the area: ${stops.map(shownStop).join(', ')}`);
      expect(orderProblems(stops, keyboardOrder(name)), 'the order of the Tab stops').toEqual([]);
      expect(
        stops.filter((stop) => stop.ring === null).map(shownStop),
        'stops without a visible focus indicator',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Fresh load of `/aws/s3/directory-buckets`, Tab to "Skip to content", Enter → focus is on the content target named "No screen yet", and the next Tab reaches "Go to Buckets"',
    async () => {
      await openPart(DIRECTORY_PATH);
      const skip = await pressTab(page);
      expect(skip?.name, `the first Tab reaches "Skip to content" (it reached ${describeStop(skip)})`).toBe(
        'Skip to content',
      );
      await page.keyboard.press('Enter');
      await expectTarget(page, NO_SCREEN_PART_H1, GO_TO_BUCKETS);
      await expectNextContentStop(page, GO_TO_BUCKETS);
    },
  );

  await lines.line('With the keyboard only: focus "Go to Buckets", Enter → the bucket list at `/aws/s3`', async () => {
    await openPart(DIRECTORY_PATH);
    await action(page, GO_TO_BUCKETS).focus(ACTION);
    await page.keyboard.press('Enter');
    await expectBucketList(page, S3.firstPath);
  });

  await lines.line(
    "Open `/aws/s3/bucket/<63>/property/intelligent-tiering/create` (114 characters) and `/aws/s3/buckets/<63>/metrics` (87 characters) → the changed page shows the whole path, the path's box lies inside the container's box, and the page does not scroll sideways — 1280 and 390 wide, light and dark",
    async () => {
      expect(longest.length, 'the name is 63 characters long').toBe(LONGEST_NAME);
      expect([long114.length, long87.length], 'the two paths are 114 and 87 characters long').toEqual([114, 87]);
      const found: string[] = [];
      for (const path of [long114, long87]) {
        for (const width of WIDTHS) {
          for (const colorScheme of ['light', 'dark'] as const) {
            const where = `${String(path.length)} characters, ${String(width)} wide, ${colorScheme}`;
            await sizeTo(page, width);
            await page.emulateMedia({ colorScheme });
            await openPart(path);
            const layout = await pathLayout(page);
            ctx.log(`${where}: ${JSON.stringify(layout)}`);
            for (const problem of pathFitProblems(layout, path)) found.push(`${where}: ${problem}`);
            if (await scrollsSideways(page)) found.push(`${where}: the page scrolls sideways`);
          }
        }
      }
      await sizeTo(page, 1280);
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'On `/aws/s3/buckets/<63>/metrics` — 390 wide → the path takes more than one line, its first line ends after a `/`, and `/metrics` is whole on one line',
    async () => {
      await sizeTo(page, 390);
      await openPart(long87);
      const layout = await pathLayout(page);
      await sizeTo(page, 1280);
      ctx.log(`390 wide: ${JSON.stringify(layout)}`);
      expect(layout, 'the path is shown').not.toBeNull();
      const drawn = layout!.lines;
      expect(drawn.length, `the lines ${JSON.stringify(drawn)}`).toBeGreaterThan(1);
      expect(drawn[0].endsWith('/'), `the first line "${drawn[0]}" ends after a /`).toBe(true);
      expect(
        drawn.some((line) => line.includes('/metrics')),
        `"/metrics" whole on one line of ${JSON.stringify(drawn)}`,
      ).toBe(true);
    },
  );

  await lines.line(
    'On `/aws/s3/directory-buckets` and on the 114-character path → the label "Path" is above the path\'s box with the same left edge, and the box that holds the two is centred in the container (its left and right distances to the container\'s edges differ by no more than 1 px) — 1280 and 390 wide',
    async () => {
      const found: string[] = [];
      for (const path of [DIRECTORY_PATH, long114]) {
        for (const width of WIDTHS) {
          const where = `${path}, ${String(width)} wide`;
          await sizeTo(page, width);
          await openPart(path);
          const layout = await pathLayout(page);
          ctx.log(`${where}: ${JSON.stringify(layout)}`);
          for (const problem of pathPlaceProblems(layout)) found.push(`${where}: ${problem}`);
        }
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    '`/aws/s3/buckets/<63>/metrics` — 390 wide → the side navigation is closed, "Open navigation" opens it with the header and the one link "General purpose buckets" (no link "Directory buckets"), and the emulator line is visible without opening anything',
    async () => {
      await sizeTo(page, 390);
      await openPart(long87);
      await expect(emulatorLine(page), 'the emulator line at 390 wide').toBeVisible();
      await expect(
        page.locator(SIDE_NAVIGATION).filter({ visible: true }),
        'the side navigation at 390 wide',
      ).toHaveCount(0);
      await page.locator(NAVIGATION_TOGGLE).filter({ visible: true }).first().click(ACTION);
      const nav = page.locator(SIDE_NAVIGATION).filter({ visible: true });
      await expect(nav.getByRole('link', { name: NAV_HEADER, exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: NAV_GENERAL, exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: NAV_DIRECTORY, exact: true })).toHaveCount(0);
      await sizeTo(page, 1280);
    },
  );

  await lines.line(
    "On the changed page → no `img` element and no AWS artwork (only Cloudscape's interface icons, which are inline SVG), no element outside the area's root carries a Cloudscape class, and no console error",
    async () => {
      const errors: string[] = [];
      const onConsole = (message: { type: () => string; text: () => string }) => {
        if (message.type() === 'error') errors.push(message.text());
      };
      const onError = (error: Error) => errors.push(error.message);
      page.on('console', onConsole);
      page.on('pageerror', onError);
      try {
        await openPart(metrics);
        // `areaImages` lists every `img`, `picture` and SVG `image` element of the area and every background image.
        expect(await areaImages(page), 'images inside the area').toEqual([]);
        expect(await cloudscapeOutsideArea(page), "Cloudscape classes outside the area's root").toEqual([]);
        await expect(page.locator(createWrapper().findContainer().toSelector()).first()).toBeVisible();
      } finally {
        page.off('console', onConsole);
        page.off('pageerror', onError);
      }
      expect(errors, 'console errors').toEqual([]);
    },
  );

  lines.end();
});
