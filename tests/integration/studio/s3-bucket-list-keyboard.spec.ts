// The S3 bucket list's finish in the built app served by `bun run serve`, in front of a real engine and the check's
// own emulator (test-criteria.md, issue 56, Flow — `studio.s3-bucket-list-keyboard-and-layout`; requirement R9): the
// order of the Tab stops, the keyboard alone reaching an action, the page's width in every state, the longest bucket
// name, the narrow layout and the images of the area.
//
// The check has its own emulator: one of its lines needs the screen empty (an emulator without buckets) and not
// connected (an emulator stopped), which the run's shared emulator cannot be.
//
// The Tab walk: Cloudscape's layout adds stops of its own that R9 does not name — "Close navigation" before the side
// navigation's header, and the toggle of the navigation's section after it — and its pagination and tabs decide
// themselves which of their buttons are stops, and its `Tabs` make the tab panel a stop after the tabs; each of those
// is allowed where Cloudscape places it and nowhere else. The help toggle R9 names after the crumbs is allowed there
// or where Cloudscape's layout places it, after the content, and must be a stop exactly once (PM decision on
// decisions-needed 17). Every other stop must be the next one R9 names. The walk ends at the help toggle after the
// content, or where the focus leaves the area; a stop after the last expected one is reported too.

import type { Page, Request } from '@playwright/test';

import { expect, startStack, test } from './support';
import { areaImages, documentIcons, emulatorLine, expectLine, connectedAt, notStartedOn } from './support/aws-area';
import { focusedAx, focusRing } from './support/focus';
import { ACTION, addressOf, NAVIGATION_TOGGLE, SIDE_NAVIGATION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix, scrollsSideways } from './support/service-screens';
import {
  ABOUT,
  COPY_ARN,
  CREATE,
  DELETE,
  EMPTY,
  expectNames,
  FILTER,
  filterFor,
  H1,
  HELP_OPEN,
  INFO,
  LONGEST_NAME,
  NAV_DIRECTORY,
  NAV_GENERAL,
  NAV_HEADER,
  NO_BUCKETS,
  NOT_READ,
  NOTICE_CLOSE,
  openList,
  PAGINATION,
  PREFERENCES,
  REFRESH,
  screen,
  Seeded,
  TABLE,
} from './services/s3/s3';

/** A Tab stop as the browser reports it. */
interface Stop {
  role: string;
  name: string;
  /** Inside the AWS area (an element with a Cloudscape class around it). */
  inArea: boolean;
  inPagination: boolean;
  /** The focus indicator it draws; `null` when none. */
  ring: string | null;
}

async function focusedStop(page: Page): Promise<Stop | null> {
  const ax = await focusedAx(page);
  if (ax === null) return null;
  const where = await page.evaluate((pagination) => {
    const active = document.activeElement;
    let inArea = false;
    for (let a: Element | null = active; a; a = a.parentElement) {
      if ([...a.classList].some((c) => c.startsWith('awsui'))) inArea = true;
    }
    return { inArea, inPagination: active?.closest(pagination) != null };
  }, PAGINATION);
  return { role: ax.role, name: ax.name, ...where, ring: await focusRing(page) };
}

const shown = (stop: Stop) => `${stop.role} "${stop.name}"`;

/** One stop R9 names, or one Cloudscape adds (`optional`); `many` takes every next stop that matches. */
interface Expected {
  what: string;
  match: (stop: Stop) => boolean;
  optional?: boolean;
  many?: boolean;
}

const named =
  (name: string, role?: string) =>
  (stop: Stop): boolean =>
    stop.name === name && (role === undefined || stop.role === role);

/** The stops of R9 in order, for a list whose buckets are `names`, then the other rows and the content's end. */
function r9Order(names: string[]): Expected[] {
  const first = names[0];
  const rest = names.slice(1);
  return [
    { what: '"Close navigation" (Cloudscape\'s layout)', match: named('Close navigation', 'button'), optional: true },
    { what: `the side navigation's header "${NAV_HEADER}"`, match: named(NAV_HEADER, 'link') },
    {
      what: "the toggle of the navigation's section (Cloudscape's)",
      match: named('Buckets', 'button'),
      optional: true,
    },
    { what: `"${NAV_GENERAL}"`, match: named(NAV_GENERAL, 'link') },
    { what: 'the crumb "EmuForge"', match: named('EmuForge', 'link') },
    { what: 'the crumb "AWS"', match: named('AWS', 'link') },
    { what: 'the crumb "S3"', match: named('S3', 'link') },
    { what: 'the current crumb "Buckets"', match: named(H1) },
    { what: `the help toggle "${HELP_OPEN}" (after the crumbs)`, match: named(HELP_OPEN, 'button'), optional: true },
    { what: `the (i) control "${ABOUT}"`, match: named(ABOUT, 'button') },
    { what: `the notice's close "${NOTICE_CLOSE}"`, match: named(NOTICE_CLOSE, 'button') },
    { what: `"${INFO}"`, match: named(INFO) },
    { what: `"${REFRESH}"`, match: named(REFRESH, 'button') },
    { what: `"${COPY_ARN}" (disabled)`, match: named(COPY_ARN, 'button'), optional: true },
    { what: `"${EMPTY}" (disabled)`, match: named(EMPTY, 'button'), optional: true },
    { what: `"${DELETE}" (disabled)`, match: named(DELETE, 'button'), optional: true },
    { what: `"${CREATE}"`, match: named(CREATE, 'button') },
    { what: `the filter "${FILTER}"`, match: named(FILTER) },
    { what: 'the pagination', match: (stop) => stop.inPagination, many: true },
    { what: `"${PREFERENCES}"`, match: named(PREFERENCES, 'button') },
    { what: `the first radio "Select ${first}"`, match: named(`Select ${first}`, 'radio') },
    { what: `the first name link "${first}"`, match: named(first, 'link') },
    {
      what: "the other rows' radios and name links",
      match: (stop) => rest.some((name) => named(`Select ${name}`, 'radio')(stop) || named(name, 'link')(stop)),
      optional: true,
      many: true,
    },
    {
      what: `the help toggle "${HELP_OPEN}" (after the content, where Cloudscape's layout places it)`,
      match: named(HELP_OPEN, 'button'),
      optional: true,
    },
  ];
}

/** Where the walk `stops` leaves the order `expected`; empty when every stop is the next one expected. */
function orderProblems(stops: Stop[], expected: Expected[]): string[] {
  let at = 0;
  for (const want of expected) {
    const stop = stops[at] as Stop | undefined;
    if (stop !== undefined && want.match(stop)) {
      at++;
      while (want.many && stops[at] !== undefined && want.match(stops[at])) at++;
      continue;
    }
    if (want.optional) continue;
    return [`expected ${want.what}, the Tab reached ${stop === undefined ? 'nothing more' : shown(stop)}`];
  }
  return stops.slice(at).map((stop) => `${shown(stop)} after the last expected stop`);
}

/** The 63-character name's link against its cell, as drawn now; `null` when the link is not on the page. */
async function longNameFit(page: Page, name: string) {
  const link = screen(page).nameLink(name);
  if ((await link.count()) === 0) return null;
  return link.first().evaluate(
    (el) => {
      const cell = el.closest('td, th')!;
      const l = el.getBoundingClientRect();
      const c = cell.getBoundingClientRect();
      return {
        text: (el.textContent ?? '').trim(),
        inside:
          l.left >= c.left - 0.5 && l.right <= c.right + 0.5 && l.top >= c.top - 0.5 && l.bottom <= c.bottom + 0.5,
        clipped: cell.scrollWidth > cell.clientWidth + 1,
        link: `${l.left.toFixed(1)}..${l.right.toFixed(1)} x ${l.top.toFixed(1)}..${l.bottom.toFixed(1)}`,
        cell: `${c.left.toFixed(1)}..${c.right.toFixed(1)} x ${c.top.toFixed(1)}..${c.bottom.toFixed(1)}`,
      };
    },
    undefined,
    ACTION,
  );
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

test('studio.s3-bucket-list-keyboard-and-layout', async ({ ctx, page, context }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'keys');
  let seeded = new Seeded(ctx, port);
  const two = [`${p}-a`, `${p}-b`];
  for (const name of two) await seeded.bucket(name);
  const s = screen(page);

  await lines.line(
    'Fresh load with two buckets under the filter, Tab from the document start, past Studio\'s frame → the stops inside the area come in the order of R9 (the side navigation\'s header and its link, the crumbs, the help toggle, the (i) control, the notice\'s close, "Info" — issue 480: "Directory buckets" and with it the tab bar went — the five actions with the disabled ones as Cloudscape places them, the filter, pagination, preferences, the first radio, the first name link), each with a visible focus indicator',
    async () => {
      await openList(page);
      await expectNames(page, two, 'the two rows');
      const stops: Stop[] = [];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const stop = await focusedStop(page);
        if (stop === null) break;
        if (!stop.inArea) {
          if (stops.length > 0) break;
          continue;
        }
        stops.push(stop);
        // The help toggle after the content is the area's last stop R9 names; the walk ends there.
        if (named(HELP_OPEN, 'button')(stop) && stops.some(named(two[0], 'link'))) break;
      }
      ctx.log(`Tab stops in the area: ${stops.map(shown).join(', ')}`);
      expect(orderProblems(stops, r9Order(two)), 'the order of the Tab stops').toEqual([]);
      expect(
        stops.filter(named(HELP_OPEN, 'button')).length,
        `stops on the help toggle "${HELP_OPEN}", after the crumbs or after the content`,
      ).toBe(1);
      expect(stops.filter((stop) => stop.ring === null).map(shown), 'stops without a visible focus indicator').toEqual(
        [],
      );
    },
  );

  await lines.line(
    'With the keyboard only: focus a radio, Space, then "Empty", Enter → the address is the bucket\'s empty route',
    async () => {
      await openList(page);
      await expectNames(page, two, 'the two rows');
      await s.radio(two[0]).focus(ACTION);
      await page.keyboard.press('Space');
      await expect(s.radio(two[0])).toBeChecked();
      let onEmpty = false;
      for (let i = 0; i < 20 && !onEmpty; i++) {
        await page.keyboard.press('Shift+Tab');
        onEmpty = (await focusedAx(page))?.name === EMPTY;
      }
      expect(onEmpty, `Shift+Tab from the radio reaches "${EMPTY}"`).toBe(true);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(addressOf(`/aws/s3/bucket/${two[0]}/empty`));
    },
  );

  await lines.line(
    'The screen loaded, empty, and not connected → the page does not scroll sideways — 1280 and 390 wide, light and dark',
    async () => {
      const found: string[] = [];
      const states = [
        {
          name: 'loaded',
          ready: async () => {
            await expectNames(page, two, 'the two rows');
          },
        },
        {
          name: 'empty',
          ready: async () => {
            await expect(s.empty.getByText(NO_BUCKETS, { exact: true })).toBeVisible();
          },
          before: async () => {
            for (const name of two) await seeded.remove(name);
          },
        },
        {
          name: 'not connected',
          ready: async () => {
            await expectLine(page, notStartedOn(port));
            await expect(s.table.getByText(NOT_READ, { exact: true })).toBeVisible({ timeout: 10_000 });
          },
          before: async () => {
            await emulator.stop();
          },
        },
      ];
      for (const state of states) {
        if (state.before) await state.before();
        for (const width of WIDTHS) {
          for (const colorScheme of ['light', 'dark'] as const) {
            await sizeTo(page, width);
            await page.emulateMedia({ colorScheme });
            await openList(page);
            await state.ready();
            if (await scrollsSideways(page)) found.push(`${state.name}, ${String(width)} wide, ${colorScheme}`);
          }
        }
      }
      await sizeTo(page, 1280);
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found, 'states in which the page scrolls sideways').toEqual([]);
    },
  );

  // The lines after need the emulator running: the one before stopped it (started again empty, with new keys).
  await emulator.startAgain();
  seeded = new Seeded(ctx, port);
  const longest = `${p}-${'x'.repeat(LONGEST_NAME - p.length - 1)}`;
  await seeded.bucket(longest);

  await lines.line(
    'With a bucket whose name is 63 characters long (the longest S3 allows, starting with `<p>`) made directly, under the filter, "Wrap lines" on as at the start → the whole name is visible inside its cell (the link\'s box lies within the cell\'s box and the cell is not clipped) and the page does not scroll sideways — 1280 and 390 wide',
    async () => {
      expect(longest.length, 'the name is 63 characters long').toBe(LONGEST_NAME);
      const found: string[] = [];
      for (const width of WIDTHS) {
        await sizeTo(page, width);
        await openList(page);
        await expectLine(page, connectedAt(port), 20_000);
        await filterFor(page, p);
        await expectNames(page, [longest], 'the row under the filter <p>', 20_000);
        const fit = await longNameFit(page, longest);
        ctx.log(`${String(width)} wide: ${JSON.stringify(fit)}`);
        if (fit === null) found.push(`${String(width)}: no link named ${longest}`);
        else {
          if (fit.text !== longest) found.push(`${String(width)}: the link reads "${fit.text}"`);
          if (!fit.inside) found.push(`${String(width)}: the link ${fit.link} lies outside its cell ${fit.cell}`);
          if (fit.clipped) found.push(`${String(width)}: the cell is clipped`);
        }
        if (await scrollsSideways(page)) found.push(`${String(width)}: the page scrolls sideways`);
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'The screen at 390 wide → the side navigation is closed, "Open navigation" opens it with the link "General purpose buckets" (issue 480: "Directory buckets" went), and the emulator line is visible without opening anything',
    async () => {
      await sizeTo(page, 390);
      await openList(page);
      await expect(emulatorLine(page), 'the emulator line at 390 wide').toBeVisible();
      await expect(
        page.locator(SIDE_NAVIGATION).filter({ visible: true }),
        'the side navigation at 390 wide',
      ).toHaveCount(0);
      await page.locator(NAVIGATION_TOGGLE).filter({ visible: true }).first().click(ACTION);
      const nav = page.locator(SIDE_NAVIGATION).filter({ visible: true });
      await expect(nav.getByRole('link', { name: NAV_GENERAL, exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: NAV_DIRECTORY, exact: true })).toHaveCount(0);
      await sizeTo(page, 1280);
    },
  );

  await lines.line(
    "The screen → no image inside the area comes from another origin, and none is an AWS logo, service icon or resource icon (the only images are Cloudscape's interface icons)",
    async () => {
      const requested: string[] = [];
      context.on('request', (request) => {
        if (isImageRequest(request)) requested.push(request.url());
      });
      await openList(page);
      await expect(page.locator(TABLE)).toBeVisible();
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      const images = await areaImages(page);
      const icons = await documentIcons(page);
      ctx.log(`images ${JSON.stringify(images)}, image requests ${JSON.stringify(requested)}`);
      expect(images, 'images inside the area').toEqual([]);
      expect(
        requested.filter((u) => !icons.includes(u)),
        'image requests of the area',
      ).toEqual([]);
    },
  );

  lines.end();
});
