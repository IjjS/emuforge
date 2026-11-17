// The finish of the four screens of a bucket in the built app served by `bun run serve`, in front of a real engine and
// the check's own emulator (test-criteria.md, issue 256, Flow — `studio.s3-bucket-screens-keyboard-and-layout`;
// requirement R12): the order of the Tab stops, the keyboard alone creating, emptying and deleting, the page's width
// in every state, the longest values, the narrow layout and the images of the area.
//
// The check has its own emulator (`own-emulator`): one of its lines needs the screens not connected (an emulator
// stopped), which the run's shared emulator cannot be. For the same reason the bucket of 63 characters without a
// hyphen is named from the check's prefix with its hyphens left out, on this emulator only.
//
// The Tab walk: Cloudscape's layout adds stops of its own that R12 does not name — "Close navigation" before the side
// navigation's header and the toggle of the navigation's section after it, a tab panel after the tabs, the header of
// an expandable section — and its tabs and radio groups decide themselves which of their items are stops; each of
// those is allowed where Cloudscape places it and nowhere else. Every other stop must be the next one R12 names. A
// section button is known by its section: the level-2 heading of the nearest element around it that holds exactly one.
//
// Issue 467 rewrote one step (its test-criteria.md, "Flow checks, changed"; requirement R9, rule 3): the walk on a
// bucket's page reaches the copy controls of "Bucket ARN" and "AWS KMS key" at their values' places, on the page of a
// bucket with a KMS key. A copy control is known by its section as a section button is.

import type { Locator, Page, Request } from '@playwright/test';

import { expect, startStack, test } from './support';
import { areaImages, currentCrumb, documentIcons, emulatorLine, expectLine, notStartedOn } from './support/aws-area';
import { focusedAx, focusRing } from './support/focus';
import { ACTION, addressOf, heading, NAVIGATION_TOGGLE, SIDE_NAVIGATION } from './support/frame';
import { Lines } from './support/lines';
import { copyControl, pairValueOf } from './support/screen-rules';
import {
  ABOUT,
  BUCKETS_PATH,
  bucketNamesDirect,
  checkPrefix,
  H1,
  LONGEST_NAME,
  NAV_DIRECTORY,
  NAV_GENERAL,
  NAV_HEADER,
  NOTICE_CLOSE,
  scrollsSideways,
  Seeded,
  listBucketsDirect,
} from './support/s3';
import {
  BLOCK_SETTINGS,
  bucketPath,
  ENCRYPTION,
  CREATE_BUTTON,
  CREATE_H1,
  CREATE_PATH,
  ENCRYPTION_CHOICES,
  expectBucketPage,
  expectFieldMessage,
  form,
  MESSAGES,
  openBucketPage,
  openForm,
  OVERVIEW,
  OWNERSHIP_CHOICES,
  SECTION_BUTTONS,
  SECTIONS,
  shownSectionTitles,
  TABS,
} from './support/s3-bucket-page';
import {
  CANCEL,
  DELETE_BUTTON,
  DELETE_FIELD,
  DELETE_H1,
  deletePage,
  deletePath,
  EMPTY_BUCKET,
  EMPTY_BUTTON,
  EMPTY_FIELD,
  EMPTY_H1,
  emptyPage,
  emptyPath,
  expectPageShows,
  failureRows,
  GENERAL_PURPOSE_BUCKETS,
  NOT_FOUND,
  NOT_READ,
  openDeletePage,
  openEmptyPage,
  startEmptying,
  STATUS_H1,
} from './support/s3-bucket-actions';

// ---------------------------------------------------------------------------------------------------------------
// The Tab walk.
// ---------------------------------------------------------------------------------------------------------------

/** A Tab stop as the browser reports it. */
interface Stop {
  role: string;
  name: string;
  /** Inside the AWS area (an element with a Cloudscape class around it). */
  inArea: boolean;
  /** The section the stop is in: the level-2 heading of the nearest element around it that holds exactly one. */
  section: string | null;
  /** The focus indicator it draws; `null` when none. */
  ring: string | null;
}

async function focusedStop(page: Page): Promise<Stop | null> {
  const ax = await focusedAx(page);
  if (ax === null) return null;
  const where = await page.evaluate(() => {
    const active = document.activeElement;
    let inArea = false;
    for (let a: Element | null = active; a; a = a.parentElement) {
      if ([...a.classList].some((c) => c.startsWith('awsui'))) inArea = true;
    }
    const outside = (h: Element) => h.closest('nav, aside, [aria-hidden="true"]') === null;
    let section: string | null = null;
    for (let a: Element | null = active; a && a !== document.body; a = a.parentElement) {
      const headings = [...a.querySelectorAll('h2')].filter(outside);
      if (headings.length === 1) {
        section = (headings[0] as HTMLElement).innerText
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/ \([^)]*\)$/, '');
        break;
      }
      if (headings.length > 1) break;
    }
    return { inArea, section };
  });
  return { role: ax.role, name: ax.name, ...where, ring: await focusRing(page) };
}

const shown = (stop: Stop) => `${stop.role} "${stop.name}"${stop.section ? ` in "${stop.section}"` : ''}`;

/** One stop R12 names, or one Cloudscape adds (`optional`); `many` takes every next stop that matches. */
interface Expected {
  what: string;
  match: (stop: Stop) => boolean;
  optional?: boolean;
  many?: boolean;
}

const named =
  (name: string, ...roles: string[]) =>
  (stop: Stop): boolean =>
    stop.name === name && (roles.length === 0 || roles.includes(stop.role));

/** Where the walk `stops` leaves the order `expected`; empty when every stop is the next one expected. */
function orderProblems(stops: Stop[], expected: Expected[]): string[] {
  let at = 0;
  for (const want of expected) {
    const stop = stops[at] as Stop | undefined;
    if (stop !== undefined && want.match(stop)) {
      at++;
      while (want.many && stops[at] !== undefined && want.match(stops[at]!)) at++;
      continue;
    }
    if (want.optional) continue;
    return [`expected ${want.what}, the Tab reached ${stop === undefined ? 'nothing more' : shown(stop)}`];
  }
  return stops.slice(at).map((stop) => `${shown(stop)} after the last expected stop`);
}

/** The area's stops before a screen's content (R12): the side navigation, the crumbs, the (i) control, the notice. */
function frameStops(crumbs: string[]): Expected[] {
  return [
    { what: '"Close navigation" (Cloudscape\'s layout)', match: named('Close navigation', 'button'), optional: true },
    { what: `the side navigation's header "${NAV_HEADER}"`, match: named(NAV_HEADER, 'link') },
    {
      what: "the toggle of the navigation's section (Cloudscape's)",
      match: named('Buckets', 'button'),
      optional: true,
    },
    { what: `"${NAV_GENERAL}"`, match: named(NAV_GENERAL, 'link') },
    { what: `"${NAV_DIRECTORY}"`, match: named(NAV_DIRECTORY, 'link') },
    ...crumbs.map((c, i) => ({
      what: i === crumbs.length - 1 ? `the current crumb "${c}"` : `the crumb "${c}"`,
      match: i === crumbs.length - 1 ? named(c) : named(c, 'link'),
    })),
    { what: `the (i) control "${ABOUT}"`, match: named(ABOUT, 'button') },
    { what: `the notice's close "${NOTICE_CLOSE}"`, match: named(NOTICE_CLOSE, 'button') },
  ];
}

/**
 * Presses Tab from the document's start (each walk follows a fresh load) and returns every stop inside the area, until the focus leaves the area or
 * `until` matches a stop (that stop included).
 */
async function walk(page: Page, until?: (stop: Stop) => boolean, max = 120): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const stop = await focusedStop(page);
    if (stop === null) break;
    if (!stop.inArea) {
      if (stops.length > 0) break;
      continue;
    }
    stops.push(stop);
    if (until && until(stop)) break;
  }
  return stops;
}

/** The stops after the notice's close: the screen's own content. */
function contentStops(stops: Stop[]): Stop[] {
  const at = stops.findIndex(named(NOTICE_CLOSE, 'button'));
  return at < 0 ? [] : stops.slice(at + 1);
}

/** Presses Tab once and returns the stop reached. */
async function tabOnce(page: Page): Promise<Stop | null> {
  await page.keyboard.press('Tab');
  return focusedStop(page);
}

/** The stops of `stops` without a visible focus indicator. */
const withoutRing = (stops: Stop[]) => stops.filter((s) => s.ring === null).map(shown);

// ---------------------------------------------------------------------------------------------------------------
// Fit.
// ---------------------------------------------------------------------------------------------------------------

/**
 * What keeps the element `locator` from showing `text` whole: a different text, its own content wider than its box,
 * an ellipsis, or an ancestor that clips it sideways. `[]` when it is whole.
 */
async function fitProblems(locator: Locator, text: string, what: string): Promise<string[]> {
  if ((await locator.count()) === 0) return [`${what}: not on the page`];
  return locator.first().evaluate(
    (el, { text, what }) => {
      const found: string[] = [];
      const norm = (s: string) => s.replace(/\s+/g, '');
      if (norm((el as HTMLElement).innerText) !== norm(text)) {
        found.push(`${what}: reads "${(el as HTMLElement).innerText.slice(0, 80)}…"`);
      }
      if (el.scrollWidth > el.clientWidth + 1) found.push(`${what}: its content is wider than its box`);
      if (getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) {
        found.push(`${what}: cut with an ellipsis`);
      }
      const box = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (!['hidden', 'clip'].includes(style.overflowX)) continue;
        const r = a.getBoundingClientRect();
        if (box.left < r.left - 0.5 || box.right > r.right + 0.5) {
          found.push(`${what}: clipped by ${a.tagName.toLowerCase()}`);
          break;
        }
      }
      return found;
    },
    { text, what },
    ACTION,
  );
}

/** The value of the field `label` of the section "Bucket overview" (a `dd` after its `dt`). */
function overviewValue(page: Page, label: string) {
  return page.locator(`xpath=//dt[normalize-space(.)='${label}']/following-sibling::dd[1]`);
}

/** The table cell that reads `text`. */
function cellOf(page: Page, text: string) {
  return page.locator('td').filter({ hasText: text });
}

/** An image request: an image by its type or by the file name's extension. */
function isImageRequest(request: Request): boolean {
  const { pathname } = new URL(request.url());
  return request.resourceType() === 'image' || /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(pathname);
}

const WIDTHS = [1280, 390];

async function sizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
}

/** Waits for a bucket's page with every section shown. */
async function expectAllSections(page: Page, name: string): Promise<void> {
  await expectBucketPage(page, name);
  await expect
    .poll(async () => (await shownSectionTitles(page)).length, { message: 'the sections are shown', timeout: 15_000 })
    .toBe(SECTIONS.length);
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-screens-keyboard-and-layout', async ({ ctx, page, context }) => {
  test.setTimeout(600_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'screens-keys');
  let seeded = new Seeded(ctx, port);
  let stopped = false;
  const plain = `${p}-plain`;
  const holding = `${p}-holding`;
  const empty = `${p}-empty`;
  await seeded.bucket(plain);
  await seeded.bucket(holding);
  await seeded.object(holding, 'kept.txt', 'kept');
  await seeded.bucket(empty);

  // Issue 467 (requirement R9, rule 3) replaced the stops '"Refresh", the tabs, then each section's button in the
  // sections' order' with the walk below, on the page of a bucket with a KMS key: each section's copy control comes at
  // its value's place, after the section's button.
  const kms = `${p}-kms`;
  await seeded.bucket(kms);
  const kmsKey = await seeded.kmsKey();
  await seeded.configure(kms, { encryption: { algorithm: 'aws:kms', keyId: kmsKey } });
  /** The copy control of each section that has one (R5), with its field's label. */
  const COPY_CONTROLS: Record<string, string> = { [OVERVIEW]: 'Bucket ARN', [ENCRYPTION]: 'AWS KMS key' };

  await lines.line(
    'Fresh load of the page of a bucket with a KMS key, Tab from the document start, past Studio\'s frame → the side navigation, the crumbs, the (i) control, the notice\'s close, "Refresh", the tabs, then in the sections\' order each section\'s button and, where the section has one, its copy control at its value\'s place ("Copy Bucket ARN" in "Bucket overview", "Copy AWS KMS key" in "Default encryption"); focus is visible on each',
    async () => {
      await openBucketPage(page, kms);
      await expectAllSections(page, kms);
      // The sections are read one by one after their headings show: the walk needs both values on the page.
      await expect(pairValueOf(page, 'Bucket ARN'), '"Bucket ARN" shows the ARN').toContainText(kms);
      await expect(pairValueOf(page, 'AWS KMS key'), '"AWS KMS key" shows the key').toContainText(kmsKey);
      const stopsOf = (section: string): Expected[] => {
        const button = SECTION_BUTTONS.find((b) => b.section === section);
        const copy = COPY_CONTROLS[section];
        return [
          ...(button === undefined
            ? []
            : [
                {
                  what: `"${button.button}" of "${section}"`,
                  match: (s: Stop) => named(button.button, 'link', 'button')(s) && s.section === section,
                },
              ]),
          ...(copy === undefined
            ? []
            : [
                {
                  what: `"${copyControl(copy)}" of "${section}"`,
                  match: (s: Stop) => named(copyControl(copy), 'button')(s) && s.section === section,
                },
              ]),
        ];
      };
      const expected: Expected[] = [
        ...frameStops(['EmuForge', 'AWS', 'S3', 'Buckets', kms]),
        { what: '"Refresh"', match: named('Refresh', 'button') },
        { what: 'the tabs', match: (s) => s.role === 'tab' && TABS.includes(s.name), many: true },
        { what: "the tab panel (Cloudscape's)", match: (s) => s.role === 'tabpanel', optional: true },
        ...SECTIONS.flatMap(stopsOf),
      ];
      const stops = await walk(page);
      ctx.log(`Tab stops in the area: ${stops.map(shown).join(', ')}`);
      expect(orderProblems(stops, expected), 'the order of the Tab stops').toEqual([]);
      expect(withoutRing(stops), 'stops without a visible focus indicator').toEqual([]);
    },
  );

  await lines.line(
    'With the keyboard only on the create form → the fields in visible order, then "Cancel", "Create bucket"; a bucket is created with the keyboard alone and exists directly',
    async () => {
      const radioOf = (choices: string[]) => (s: Stop) => s.role === 'radio' && choices.includes(s.name);
      const expected: Expected[] = [
        { what: '"Region" (not editable)', match: named('Region', 'textbox'), optional: true },
        { what: '"Bucket name"', match: named('Bucket name', 'textbox') },
        { what: '"Object Ownership"', match: radioOf(OWNERSHIP_CHOICES), many: true },
        ...BLOCK_SETTINGS.map((b) => ({ what: `"${b}"`, match: named(b, 'checkbox') })),
        { what: '"Bucket Versioning"', match: radioOf(['Disable', 'Enable']), many: true },
        { what: '"Add tag"', match: named('Add tag', 'button') },
        { what: '"Encryption type"', match: radioOf(ENCRYPTION_CHOICES), many: true },
        { what: '"Advanced settings" (its header)', match: named('Advanced settings', 'button'), optional: true },
        { what: '"Object Lock"', match: radioOf(['Disable', 'Enable']), many: true },
        { what: `"${CANCEL}"`, match: named(CANCEL, 'button') },
        { what: `"${CREATE_BUTTON}"`, match: named(CREATE_BUTTON, 'button') },
      ];
      await openForm(page);
      const stops = await walk(page);
      ctx.log(`Tab stops in the area: ${stops.map(shown).join(', ')}`);
      expect(
        orderProblems(stops, [...frameStops(['EmuForge', 'AWS', 'S3', 'Buckets', CREATE_H1]), ...expected]),
        'the order of the Tab stops',
      ).toEqual([]);
      expect(withoutRing(stops), 'stops without a visible focus indicator').toEqual([]);

      const name = `${p}-by-keys`;
      seeded.track(name);
      await openForm(page);
      const toName = await walk(page, named('Bucket name', 'textbox'));
      expect(toName.at(-1)?.name, 'the Tab reaches "Bucket name"').toBe('Bucket name');
      await page.keyboard.type(name);
      let onCreate = false;
      for (let i = 0; i < 30 && !onCreate; i++) onCreate = (await tabOnce(page))?.name === CREATE_BUTTON;
      expect(onCreate, `the Tab reaches "${CREATE_BUTTON}"`).toBe(true);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(addressOf(BUCKETS_PATH));
      await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
      expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets under ${name}`).toContain(name);
    },
  );

  await lines.line(
    'With the keyboard only: the delete page of a bucket that is not empty → "Empty bucket", then "Cancel"; of an empty one → the field, "Cancel", "Delete bucket"; the empty page → the field, "Cancel", "Empty"; its status → its links',
    async () => {
      const found: string[] = [];
      const deleteCrumbs = (name: string) => ['EmuForge', 'AWS', 'S3', 'Buckets', name, DELETE_H1];
      const emptyCrumbs = (name: string) => ['EmuForge', 'AWS', 'S3', 'Buckets', name, EMPTY_H1];

      await openDeletePage(page, holding);
      await expect(deletePage(page).alert).toBeVisible();
      const notEmpty = await walk(page);
      ctx.log(`delete page, not empty: ${notEmpty.map(shown).join(', ')}`);
      found.push(
        ...orderProblems(notEmpty, [
          ...frameStops(deleteCrumbs(holding)),
          { what: `"${EMPTY_BUCKET}"`, match: named(EMPTY_BUCKET, 'link', 'button') },
          { what: `"${CANCEL}"`, match: named(CANCEL, 'button') },
        ]).map((s) => `the delete page of a bucket that is not empty: ${s}`),
        ...withoutRing(notEmpty).map((s) => `no focus indicator on ${s}`),
      );

      /** From the document start to the field, which must be the content's first stop; types the name; then two Tabs. */
      const confirmWalk = async (crumbs: string[], field: string, name: string, then: string[], what: string) => {
        const before = await walk(page, named(field, 'textbox'));
        found.push(
          ...orderProblems(before, [
            ...frameStops(crumbs),
            { what: `the field "${field}"`, match: named(field, 'textbox') },
          ]).map((s) => `${what}: ${s}`),
        );
        await page.keyboard.type(name);
        const after: Stop[] = [];
        for (const _ of then) {
          const stop = await tabOnce(page);
          if (stop) after.push(stop);
        }
        ctx.log(`${what}: ${[...before, ...after].map(shown).join(', ')}`);
        const names = after.map((s) => s.name);
        if (JSON.stringify(names) !== JSON.stringify(then)) {
          found.push(
            `${what}: after the field the Tab reached ${JSON.stringify(names)}, expected ${JSON.stringify(then)}`,
          );
        }
        found.push(...withoutRing([...before, ...after]).map((s) => `no focus indicator on ${s}`));
      };

      await openDeletePage(page, empty);
      await expect(deletePage(page).field).toBeEnabled();
      await confirmWalk(
        deleteCrumbs(empty),
        DELETE_FIELD,
        empty,
        [CANCEL, DELETE_BUTTON],
        'the delete page of an empty bucket',
      );

      await openEmptyPage(page, empty);
      await expect(emptyPage(page).field).toBeVisible();
      await confirmWalk(emptyCrumbs(empty), EMPTY_FIELD, empty, [CANCEL, EMPTY_BUTTON], 'the empty page');
      if ((await focusedAx(page))?.name === EMPTY_BUTTON) {
        await page.keyboard.press('Enter');
        await expect(heading(page, STATUS_H1), `the status's h1 "${STATUS_H1}"`).toBeVisible();
        await expectPageShows(page, `Bucket “${empty}” was already empty.`, 'the emptying finished');
        const links: Stop[] = [];
        for (let i = 0; i < 2; i++) {
          const stop = await tabOnce(page);
          if (stop) links.push(stop);
        }
        ctx.log(`the status: ${links.map(shown).join(', ')}`);
        const names = links.map((s) => `${s.role} ${s.name}`);
        const want = [`link ${DELETE_BUTTON}`, `link ${GENERAL_PURPOSE_BUCKETS}`];
        if (JSON.stringify(names) !== JSON.stringify(want)) {
          found.push(
            `the status: from its h1 the Tab reached ${JSON.stringify(names)}, expected ${JSON.stringify(want)}`,
          );
        }
        found.push(...withoutRing(links).map((s) => `no focus indicator on ${s}`));
      } else {
        found.push(`the empty page: "${EMPTY_BUTTON}" is not reached by the keyboard, so its status is not either`);
      }
      expect(found, 'the keyboard on the delete page, the empty page and its status').toEqual([]);
    },
  );

  await lines.line(
    'A bucket\'s page of a full and of a plain bucket, "Bucket not found", the page not connected; the create form as opened, with SSE-KMS and three tags, and with every message shown; the empty page, its status with a failure table; the delete page with and without the alert → the page does not scroll sideways — 1280 and 390 wide, light and dark',
    async () => {
      const full = `${p}-full`;
      const logs = `${p}-logs`;
      await seeded.bucket(logs);
      await seeded.bucket(full, 'us-east-1', { objectLock: true });
      const key = await seeded.kmsKey();
      const queue = await seeded.queue(`${p}-queue`);
      await seeded.configure(full, {
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
      const locked = `${p}-locked`;
      await seeded.bucket(locked, 'us-east-1', { objectLock: true });
      const version = await seeded.object(locked, 'held.txt', 'held');
      await seeded.legalHold(locked, 'held.txt', version!, 'ON');
      const f = form(page);

      const states: { name: string; open: () => Promise<void>; before?: () => Promise<void> }[] = [
        {
          name: 'the page of a full bucket',
          open: () => openBucketPage(page, full).then(() => expectAllSections(page, full)),
        },
        {
          name: 'the page of a plain bucket',
          open: () => openBucketPage(page, plain).then(() => expectAllSections(page, plain)),
        },
        {
          name: '"Bucket not found"',
          open: async () => {
            await page.goto(bucketPath(`${p}-missing`));
            await expectPageShows(page, NOT_FOUND, `"${NOT_FOUND}"`);
          },
        },
        { name: 'the create form as opened', open: () => openForm(page) },
        {
          name: 'the create form with SSE-KMS and three tags',
          open: async () => {
            await openForm(page, `${CREATE_PATH}?encryption=sse-kms`);
            for (let i = 0; i < 3; i++) await f.addTag.click(ACTION);
            await expect(f.keys).toHaveCount(3);
          },
        },
        {
          name: 'the create form with every message shown',
          open: async () => {
            await openForm(page, `${CREATE_PATH}?encryption=sse-kms`);
            await f.addTag.click(ACTION);
            await f.create.click(ACTION);
            await expectFieldMessage(f.name, MESSAGES.emptyName, '"Bucket name"');
            await expectFieldMessage(f.key(0), MESSAGES.emptyKey, '"Key"');
            await expectFieldMessage(f.kmsKey, MESSAGES.emptyKms, '"AWS KMS key"');
          },
        },
        {
          name: 'the empty page',
          open: async () => {
            await openEmptyPage(page, empty);
            await expect(emptyPage(page).field).toBeVisible();
          },
        },
        {
          name: 'the status with a failure table',
          open: async () => {
            await openEmptyPage(page, locked);
            await startEmptying(page, locked);
            await expect.poll(async () => (await failureRows(page))?.length ?? 0, { timeout: 30_000 }).toBe(1);
          },
        },
        {
          name: 'the delete page with the alert',
          open: async () => {
            await openDeletePage(page, holding);
            await expect(deletePage(page).alert).toBeVisible();
          },
        },
        {
          name: 'the delete page without the alert',
          open: async () => {
            await openDeletePage(page, empty);
            await expect(deletePage(page).field).toBeEnabled();
          },
        },
        {
          name: 'the page not connected',
          before: async () => {
            await emulator.stop();
            stopped = true;
          },
          open: async () => {
            await page.goto(bucketPath(plain));
            await expectLine(page, notStartedOn(port));
            await expectPageShows(page, NOT_READ, `"${NOT_READ}"`);
          },
        },
      ];
      const scrolls: string[] = [];
      try {
        for (const state of states) {
          if (state.before) await state.before();
          for (const width of WIDTHS) {
            for (const colorScheme of ['light', 'dark'] as const) {
              const at = `${state.name}, ${String(width)} wide, ${colorScheme}`;
              await sizeTo(page, width);
              await page.emulateMedia({ colorScheme });
              try {
                await state.open();
              } catch (e) {
                scrolls.push(`${at}: not reached (${(e as Error).message.split('\n')[0] ?? ''})`);
                continue;
              }
              if (await scrollsSideways(page)) scrolls.push(`${at}: scrolls sideways`);
            }
          }
        }
      } finally {
        await sizeTo(page, 1280);
        await page.emulateMedia({ colorScheme: 'light' });
      }
      expect(scrolls, 'states in which the page scrolls sideways').toEqual([]);
    },
  );

  // The lines after need the emulator running: the one before stopped it (started again empty, with new keys).
  if (stopped) {
    await emulator.startAgain();
    seeded = new Seeded(ctx, port);
  }

  await lines.line(
    'With a bucket whose name is 63 characters without a hyphen and that has a tag key of 128 characters without a space → on its page the `h1`, the crumb, the ARN and the key are whole and the page does not scroll sideways — 1280 and 390 wide',
    async () => {
      const name = `${p.replace(/[^a-z0-9]/g, '')}${'x'.repeat(LONGEST_NAME)}`.slice(0, LONGEST_NAME);
      const tagKey = 'k'.repeat(128);
      expect(name.length, 'the name is 63 characters long').toBe(LONGEST_NAME);
      await seeded.bucket(name);
      await seeded.configure(name, { tags: [[tagKey, 'value']] });
      const arn = (await listBucketsDirect(ctx, port, name)).find((b) => b.name === name)?.arn ?? null;
      expect(arn, `the ARN of ${name}, directly`).not.toBeNull();
      const found: string[] = [];
      for (const width of WIDTHS) {
        await sizeTo(page, width);
        await openBucketPage(page, name);
        await expectAllSections(page, name);
        await expect(cellOf(page, tagKey).first(), 'the tag key').toBeVisible();
        const at = `${String(width)} wide`;
        found.push(...(await fitProblems(heading(page, name), name, `${at}, the h1`)));
        found.push(...(await fitProblems(currentCrumb(page), name, `${at}, the crumb`)));
        found.push(...(await fitProblems(overviewValue(page, 'Bucket ARN'), arn!, `${at}, the ARN`)));
        found.push(...(await fitProblems(cellOf(page, tagKey), tagKey, `${at}, the tag key`)));
        if (await scrollsSideways(page)) found.push(`${at}: the page scrolls sideways`);
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "With a failure whose key is 1024 characters without a slash on the empty page's status → the key is whole inside its cell and the page does not scroll sideways — 390 wide",
    async () => {
      const name = `${p}-long-key`;
      const longKey = 'k'.repeat(1024);
      await seeded.bucket(name, 'us-east-1', { objectLock: true });
      const version = await seeded.object(name, longKey, 'held');
      await seeded.legalHold(name, longKey, version!, 'ON');
      await sizeTo(page, 390);
      try {
        await openEmptyPage(page, name);
        await startEmptying(page, name);
        await expect.poll(async () => (await failureRows(page))?.length ?? 0, { timeout: 30_000 }).toBe(1);
        const found = await fitProblems(cellOf(page, longKey), longKey, 'the key of 1024 characters');
        if (await scrollsSideways(page)) found.push('the page scrolls sideways');
        expect(found).toEqual([]);
      } finally {
        await sizeTo(page, 1280);
      }
    },
  );

  /** The four screens, each opened and waited for. */
  const screens: { name: string; open: () => Promise<void> }[] = [
    { name: "a bucket's page", open: () => openBucketPage(page, plain) },
    { name: 'the create form', open: () => openForm(page) },
    { name: 'the empty page', open: () => openEmptyPage(page, plain) },
    { name: 'the delete page', open: () => openDeletePage(page, plain) },
  ];
  if (!(await bucketNamesDirect(ctx, port, plain)).includes(plain)) await seeded.bucket(plain);

  await lines.line(
    'Any of the four screens at 390 wide → the side navigation is closed, "Open navigation" opens it with "General purpose buckets", and the emulator line is visible without opening anything',
    async () => {
      await sizeTo(page, 390);
      try {
        for (const s of screens) {
          await s.open();
          await expect(emulatorLine(page), `${s.name}: the emulator line at 390 wide`).toBeVisible();
          await expect(
            page.locator(SIDE_NAVIGATION).filter({ visible: true }),
            `${s.name}: the side navigation at 390 wide`,
          ).toHaveCount(0);
          await page.locator(NAVIGATION_TOGGLE).filter({ visible: true }).first().click(ACTION);
          const nav = page.locator(SIDE_NAVIGATION).filter({ visible: true });
          await expect(
            nav.getByRole('link', { name: NAV_GENERAL, exact: true }),
            `${s.name}: "${NAV_GENERAL}"`,
          ).toBeVisible();
        }
      } finally {
        await sizeTo(page, 1280);
      }
    },
  );

  await lines.line(
    'The four screens → no image inside the area comes from another origin, and none is an AWS logo, service icon or resource icon',
    async () => {
      const requested: string[] = [];
      context.on('request', (request) => {
        if (isImageRequest(request)) requested.push(request.url());
      });
      const found: string[] = [];
      for (const s of screens) {
        await s.open();
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
        const images = await areaImages(page);
        ctx.log(`${s.name}: images ${JSON.stringify(images)}`);
        if (images === null) found.push(`${s.name}: no area on the page`);
        else found.push(...images.map((i) => `${s.name}: ${i}`));
      }
      const icons = await documentIcons(page);
      ctx.log(`image requests ${JSON.stringify(requested)}`);
      found.push(...requested.filter((u) => !icons.includes(u)).map((u) => `image request ${u}`));
      expect(found, 'images of the area').toEqual([]);
    },
  );

  lines.end();
});
