// Where focus goes in Studio as a keyboard and screen reader user meets it, in the built app served by `bun run serve`
// in front of a real engine and the run's emulator (test-criteria.md, issue 19, Integration checks):
// `studio.skip-link-reaches-page-content`, `studio.route-change-focuses-new-page-content`,
// `studio.focus-moves-change-nothing-on-screen`, `studio.first-load-keeps-focus-at-document-start`.
//
// Keys are pressed on the keyboard; nothing is clicked unless a line says so. A fresh load is `page.goto` of the path;
// a page is ready when its `h1` is visible, and Home shows both rows "Connected" before a keyboard step on it.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect, NO_SCREEN_SERVICE, startStack, test } from './support';
import { connectedAt, expectLine } from './support/aws-area';
import {
  awaitTarget,
  contentStopProblems,
  describeStop,
  expectNextContentStop,
  expectTarget,
  extraLiveRegions,
  focusedStop,
  focusMoves,
  focusRing,
  hasFocus,
  lineAnswered,
  liveRegions,
  outlinedElements,
  placeDiffers,
  placesOf,
  pressTab,
  recordFocusMoves,
  settled,
  type Places,
  type Stop,
  type TargetReport,
} from './support/focus';
import {
  ACTION,
  addressOf,
  BREADCRUMB_GROUP,
  frame,
  heading,
  providersSection,
  SIDE_NAVIGATION,
  titleOf,
} from './support/frame';
import { INDEX_FIRST_LINK } from './support/home';
import { Lines } from './support/lines';

const AWS = 'Amazon Web Services';
const SERVICE = NO_SCREEN_SERVICE.label;
const GO_HOME = 'Go to Home';
const NOT_FOUND = 'Page not found';
const SKIP = 'Skip to content';

/** A page of R4 with its `h1` and its first content stop. */
interface PageOf {
  path: string;
  h1: string;
  firstStop: string;
  /** Home: its title is Studio's name alone, and it waits for "Connected". */
  home?: boolean;
  /**
   * A list whose `h1` is its title followed by its counter once the list is read ("Tables (3)", Cloudscape's header
   * counter inside the `h1`; issue 496, design.md task 1): it is shown once the counter is there, its content target
   * is named by the `h1`'s text then, and the Tab after it is read once the emulator line reads "Connected at
   * <endpoint>" (issue 496, decisions.md, Review decisions of 2026-11-19).
   */
  counted?: boolean;
}

const HOME: PageOf = { path: '/', h1: 'Home', firstStop: 'Refresh', home: true };
// The first link of "Services" is computed from the checkout (issue 494, `decisions.md`, PM decisions): the index lists
// the services that have a Studio screen first.
const INDEX: PageOf = { path: '/aws', h1: AWS, firstStop: INDEX_FIRST_LINK };
const SERVICE_PAGE: PageOf = { path: NO_SCREEN_SERVICE.path, h1: SERVICE, firstStop: GO_HOME };
const SERVICE_BELOW: PageOf = { path: NO_SCREEN_SERVICE.below, h1: SERVICE, firstStop: GO_HOME };
// Issue 496: `/aws/dynamodb` is DynamoDB's table list, whose `h1` is "Tables" and whose first content stop is the
// local-emulator notice's (i) control.
const DYNAMODB: PageOf = { path: '/aws/dynamodb', h1: 'Tables', firstStop: 'About the local emulator', counted: true };
// Issue 69: `/aws/apigateway` is API Gateway's APIs list, whose `h1` is "APIs" and whose first content stop is the
// local-emulator notice's (i) control, as on DynamoDB's list; the index's link to it keeps the service's name.
const API_GATEWAY_LINK = 'Amazon API Gateway';
const API_GATEWAY: PageOf = { path: '/aws/apigateway', h1: 'APIs', firstStop: 'About the local emulator' };
const AREA_NOT_FOUND: PageOf = { path: '/aws/does-not-exist', h1: NOT_FOUND, firstStop: GO_HOME };
const STUDIO_NOT_FOUND: PageOf = { path: '/does-not-exist', h1: NOT_FOUND, firstStop: GO_HOME };

/** The five pages the criteria go through on each line that names them, in their order. */
const FIVE = [HOME, INDEX, SERVICE_PAGE, AREA_NOT_FOUND, STUDIO_NOT_FOUND];

const SERVICES_CONTAINER = createWrapper().findContainer().toSelector();

function titleFor(p: PageOf): string {
  return titleOf(p.home ? null : p.h1);
}

/** Both rows of Home's "Connection" section show "Connected". */
async function connected(page: Page): Promise<void> {
  await expect(page.getByText('Connected', { exact: true }), 'both rows "Connected"').toHaveCount(2);
}

/** The `h1` of `p`: named `p.h1`, or for a counted list `p.h1` followed by its counter ("Tables (3)", "Tables (25+)"). */
function h1Of(page: Page, p: PageOf): Locator {
  if (!p.counted) return heading(page, p.h1);
  return page.getByRole('heading', { level: 1, name: new RegExp(`^${p.h1} \\(\\d+\\+?\\)$`) });
}

/** The name the content target of `p` has: the `h1`'s text as shown now. */
async function targetName(page: Page, p: PageOf): Promise<string> {
  if (!p.counted) return p.h1;
  return (await h1Of(page, p).innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/** The page `p` is shown at its address: its `h1` visible, and on Home both rows "Connected". */
async function shown(page: Page, p: PageOf): Promise<void> {
  await expect(page).toHaveURL(addressOf(p.path));
  await expect(h1Of(page, p)).toBeVisible();
  if (p.home) await connected(page);
}

async function openFresh(page: Page, p: PageOf): Promise<void> {
  await page.goto(p.path);
  await shown(page, p);
}

function skipLink(page: Page): Locator {
  return frame(page).banner.getByRole('link', { name: SKIP, exact: true });
}

/** Presses Tab and asserts it reached "Skip to content". */
async function tabToSkip(page: Page): Promise<void> {
  const stop = await pressTab(page);
  expect(stop?.name, `the first Tab reaches "${SKIP}" (it reached ${describeStop(stop)})`).toBe(SKIP);
  expect(await hasFocus(skipLink(page)), `"${SKIP}" in the frame has focus`).toBe(true);
}

/** Fresh load of `p`, Tab, Enter on "Skip to content". */
async function skipOn(page: Page, p: PageOf): Promise<void> {
  await openFresh(page, p);
  await tabToSkip(page);
  await page.keyboard.press('Enter');
}

/** Puts focus on `link` and presses Enter. */
async function follow(page: Page, link: Locator): Promise<void> {
  await link.focus(ACTION);
  await page.keyboard.press('Enter');
}

function sideNavigationLink(page: Page, name: string): Locator {
  return page.locator(SIDE_NAVIGATION).filter({ visible: true }).getByRole('link', { name, exact: true });
}

function breadcrumbLink(page: Page, name: string): Locator {
  return page.locator(BREADCRUMB_GROUP).getByRole('link', { name, exact: true }).filter({ visible: true });
}

/** A service link in the AWS area index's "Services" container. */
function servicesLink(page: Page, name: string): Locator {
  return page
    .locator(SERVICES_CONTAINER)
    .filter({ has: page.getByRole('heading', { level: 2, name: /^Services\b/ }) })
    .getByRole('link', { name, exact: true });
}

function providersLink(page: Page, name: string): Locator {
  return providersSection(page).getByRole('link', { name, exact: true });
}

function goToHome(page: Page): Locator {
  return page.getByRole('link', { name: GO_HOME, exact: true });
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.skip-link-reaches-page-content', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  await startStack(ctx);
  const lines = new Lines(ctx);

  /** After the skip: focus on `p`'s content target with no ring, the address unchanged, the next Tab its first stop. */
  async function expectSkipped(p: PageOf, next = true): Promise<void> {
    await expectTarget(page, p.h1, p.firstStop);
    expect(await focusRing(page).then((r) => (r?.startsWith('outline') ? r : null)), 'the target’s focus ring').toBe(
      null,
    );
    await expect(page).toHaveURL(addressOf(p.path));
    if (next) await expectNextContentStop(page, p.firstStop);
  }

  await lines.line(
    'Fresh load of `/aws`, Tab, Enter → focus is on the content target named "Amazon Web Services", it draws no focus ring, and the address is still `/aws`; the next Tab reaches the first link of "Services" (regression)',
    async () => {
      await skipOn(page, INDEX);
      await expectSkipped(INDEX);
    },
  );

  for (const p of [SERVICE_PAGE, AREA_NOT_FOUND]) {
    await lines.line(
      `Fresh load of \`${p.path}\`, Tab, Enter → focus is on the content target named "${p.h1}", it draws no focus ring, the address is unchanged; the next Tab reaches "Go to Home" (regression)`,
      async () => {
        await skipOn(page, p);
        await expectSkipped(p);
      },
    );
  }

  for (const p of [HOME, STUDIO_NOT_FOUND]) {
    await lines.line(
      `Fresh load of \`${p.path}\`, Tab, Enter → focus is on the content target named "${p.h1}", it draws no focus ring, the address is unchanged; the next Tab reaches "${p.firstStop}"`,
      async () => {
        await skipOn(page, p);
        await expectSkipped(p);
      },
    );
  }

  await lines.line(
    'Fresh load of `/aws`, Tab, Enter → focus is on the content target named "Amazon Web Services"; the next Tab reaches the first link of "Services", not "Open navigation", a link of the side navigation or a breadcrumb — 390 wide',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      try {
        await skipOn(page, INDEX);
        await expectTarget(page, INDEX.h1, INDEX.firstStop);
        const stop: Stop | null = await pressTab(page);
        const problems = contentStopProblems(stop, INDEX.firstStop);
        if (stop?.name === 'Open navigation') problems.push('the Tab reached "Open navigation"');
        expect(problems, `the next Tab reaches "${INDEX.firstStop}", the first link of "Services"`).toEqual([]);
      } finally {
        await page.setViewportSize({ width: 1280, height: 800 });
      }
    },
  );

  await lines.line(
    'Fresh load of `/aws/kinesis`, Tab, Enter → focus is on the content target named "Amazon Kinesis"; the next Tab reaches "Go to Home" — 390 wide',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      try {
        await skipOn(page, SERVICE_PAGE);
        await expectTarget(page, SERVICE_PAGE.h1, SERVICE_PAGE.firstStop);
        await expectNextContentStop(page, GO_HOME);
      } finally {
        await page.setViewportSize({ width: 1280, height: 800 });
      }
    },
  );

  await lines.line(
    'Fresh load of `/aws/kinesis`, Tab, click "Skip to content" → focus is on the content target named "Amazon Kinesis" and the address is unchanged',
    async () => {
      await openFresh(page, SERVICE_PAGE);
      await tabToSkip(page);
      await skipLink(page).click(ACTION);
      await expectSkipped(SERVICE_PAGE, false);
    },
  );

  await lines.line(
    'Fresh load of `/aws`, Tab, Enter, then Shift+Tab back to "Skip to content" and Enter again → focus is on the content target named "Amazon Web Services" again',
    async () => {
      await skipOn(page, INDEX);
      await expectTarget(page, INDEX.h1, INDEX.firstStop);
      // Shift+Tab until "Skip to content" has focus, at most once per Tab stop the page can hold before it.
      let back: Stop | null = null;
      for (let i = 0; i < 60 && back?.name !== SKIP; i++) back = await pressTab(page, true);
      expect(back?.name, `Shift+Tab comes back to "${SKIP}" (last reached ${describeStop(back)})`).toBe(SKIP);
      await page.keyboard.press('Enter');
      await expectTarget(page, INDEX.h1, INDEX.firstStop);
    },
  );

  await lines.line(
    'Each of the five pages above, after Tab → the focused element is "Skip to content", it is visible with its focus ring, and it is at the bar\'s start',
    async () => {
      const found: string[] = [];
      for (const p of [INDEX, SERVICE_PAGE, AREA_NOT_FOUND, HOME, STUDIO_NOT_FOUND]) {
        await openFresh(page, p);
        const stop = await pressTab(page);
        if (stop?.name !== SKIP || !(await hasFocus(skipLink(page)))) {
          found.push(`${p.path}: the Tab reached ${describeStop(stop)}, not the frame's "${SKIP}"`);
          continue;
        }
        if (!(await skipLink(page).isVisible())) found.push(`${p.path}: "${SKIP}" is not visible`);
        const ring = await focusRing(page);
        if (ring === null) found.push(`${p.path}: "${SKIP}" draws no focus ring`);
        const f = frame(page);
        const box = await skipLink(page).boundingBox(ACTION);
        const bar = await f.banner.boundingBox(ACTION);
        const wordmark = await f.wordmark.boundingBox(ACTION);
        if (box === null || bar === null || wordmark === null) {
          found.push(`${p.path}: "${SKIP}", the bar or "EmuForge Studio" is not drawn`);
          continue;
        }
        if (box.width <= 1 || box.height <= 1) found.push(`${p.path}: "${SKIP}" is drawn ${JSON.stringify(box)}`);
        const inBar =
          box.x >= bar.x - 0.5 &&
          box.y >= bar.y - 0.5 &&
          box.x + box.width <= bar.x + bar.width + 0.5 &&
          box.y + box.height <= bar.y + bar.height + 0.5;
        if (!inBar)
          found.push(`${p.path}: "${SKIP}" ${JSON.stringify(box)} is not inside the bar ${JSON.stringify(bar)}`);
        if (box.x > wordmark.x + 0.5) {
          found.push(
            `${p.path}: "${SKIP}" starts at ${String(box.x)}, after "EmuForge Studio" at ${String(wordmark.x)}`,
          );
        }
        ctx.log(`${p.path}: "${SKIP}" at ${JSON.stringify(box)}, ring ${ring ?? 'none'}`);
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

/** The frame's `aria-current` marks: "EmuForge Studio", "Home", "AWS". */
async function marksOf(page: Page): Promise<(string | null)[]> {
  const f = frame(page);
  return Promise.all([f.wordmark, f.home, f.aws].map((link) => link.getAttribute('aria-current', ACTION)));
}

/** What a route change led to, read once the new page is shown. */
interface Arrival {
  change: string;
  to: PageOf;
  target: TargetReport;
  title: string;
  marks: (string | null)[];
  live: string[];
  /** What the Tab after the change reached. */
  next: Stop | null;
}

test('studio.route-change-focuses-new-page-content', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const f = frame(page);
  const arrivals: Arrival[] = [];

  /**
   * After a route change to `to`: waits until it is shown, then for focus on its content target (bounded), reads the
   * title, the frame's marks and the live regions, then presses Tab. Recorded for the last two lines.
   */
  async function arrive(change: string, to: PageOf): Promise<Arrival> {
    await shown(page, to);
    const target = await awaitTarget(page, await targetName(page, to), to.firstStop);
    const title = await expect
      .poll(() => page.title(), { timeout: 5_000 })
      .toBe(titleFor(to))
      .then(
        () => titleFor(to),
        () => page.title(),
      );
    const arrival: Arrival = {
      change,
      to,
      target,
      title,
      marks: await marksOf(page),
      live: await liveRegions(page),
      next: null,
    };
    if (to.counted) await expectLine(page, connectedAt(stack.emulatorPort));
    arrival.next = await pressTab(page);
    arrivals.push(arrival);
    ctx.log(
      `${change}: focus ${target.focused}${target.problems.length ? ` (${target.problems.join('; ')})` : ''}; next Tab ${describeStop(arrival.next)}`,
    );
    return arrival;
  }

  function expectArrived(a: Arrival, withNext: boolean): void {
    expect(a.target.problems, `focus (${a.target.focused}) is on the content target named "${a.to.h1}"`).toEqual([]);
    if (withNext) {
      expect(contentStopProblems(a.next, a.to.firstStop), `the next Tab reaches "${a.to.firstStop}"`).toEqual([]);
    }
  }

  await lines.line(
    '(changed, issue 496) Fresh load of `/`, focus "Amazon DynamoDB" in Home\'s "Providers", Enter → the address is `/aws/dynamodb`, focus is on the content target named "Tables", and the next Tab, read once the emulator line shows "Connected at <endpoint>", reaches "About the local emulator" (regression)',
    async () => {
      await openFresh(page, HOME);
      await follow(page, providersLink(page, 'Amazon DynamoDB'));
      expectArrived(await arrive('/ → "Amazon DynamoDB" in "Providers"', DYNAMODB), true);
    },
  );

  await lines.line(
    'Fresh load of `/does-not-exist`, focus "Go to Home", Enter → the address is `/`, focus is on the content target named "Home", and the next Tab reaches "Refresh" (regression)',
    async () => {
      await openFresh(page, STUDIO_NOT_FOUND);
      await follow(page, goToHome(page));
      expectArrived(await arrive('/does-not-exist → "Go to Home"', HOME), true);
    },
  );

  await lines.line(
    'Fresh load of `/` (the area\'s code not yet loaded), focus the frame\'s "AWS", Enter → the address is `/aws`, focus is on the content target named "Amazon Web Services", and the next Tab reaches the first link of "Services"',
    async () => {
      await openFresh(page, HOME);
      await follow(page, f.aws);
      expectArrived(await arrive('/ → the frame\'s "AWS"', INDEX), true);
    },
  );

  await lines.line(
    'Fresh load of `/aws`, focus the frame\'s "Home", Enter → the address is `/`, focus is on the content target named "Home"',
    async () => {
      await openFresh(page, INDEX);
      await follow(page, f.home);
      expectArrived(await arrive('/aws → the frame\'s "Home"', HOME), false);
    },
  );

  await lines.line(
    'Fresh load of `/aws/kinesis`, focus the frame\'s "EmuForge Studio", Enter → the address is `/`, focus is on the content target named "Home"',
    async () => {
      await openFresh(page, SERVICE_PAGE);
      await follow(page, f.wordmark);
      expectArrived(await arrive('/aws/kinesis → "EmuForge Studio"', HOME), false);
    },
  );

  await lines.line(
    'Fresh load of `/`, focus "Amazon Web Services" in Home\'s "Providers", Enter → the address is `/aws`, focus is on the content target named "Amazon Web Services"',
    async () => {
      await openFresh(page, HOME);
      await follow(page, providersLink(page, AWS));
      expectArrived(await arrive('/ → "Amazon Web Services" in "Providers"', INDEX), false);
    },
  );

  await lines.line(
    '(changed, issue 69) Fresh load of `/aws`, focus "Amazon API Gateway" in "Services", Enter → the address is `/aws/apigateway`, focus is on the content target named "APIs", and the next Tab reaches "About the local emulator"',
    async () => {
      await openFresh(page, INDEX);
      await follow(page, servicesLink(page, API_GATEWAY_LINK));
      expectArrived(await arrive('/aws → "Amazon API Gateway" in "Services"', API_GATEWAY), true);
    },
  );

  await lines.line(
    '(changed, issue 84) Fresh load of `/aws`, focus "Amazon Kinesis" in the side navigation, Enter → the address is `/aws/kinesis`, focus is on the content target named "Amazon Kinesis", and the next Tab reaches "Go to Home" (regression)',
    async () => {
      await openFresh(page, INDEX);
      await follow(page, sideNavigationLink(page, SERVICE_PAGE.h1));
      expectArrived(await arrive(`/aws → "${SERVICE}" in the side navigation`, SERVICE_PAGE), true);
    },
  );

  await lines.line(
    '(changed, issue 45) Fresh load of `/aws/kinesis`, focus "AWS" in the breadcrumbs, Enter → the address is `/aws`, focus is on the content target named "Amazon Web Services"',
    async () => {
      await openFresh(page, SERVICE_PAGE);
      await follow(page, breadcrumbLink(page, 'AWS'));
      expectArrived(await arrive('/aws/kinesis → "AWS" in the breadcrumbs', INDEX), false);
    },
  );

  await lines.line(
    'Fresh load of `/aws/kinesis` and of `/aws/does-not-exist`, focus "Go to Home", Enter → the address is `/`, focus is on the content target named "Home"',
    async () => {
      const found: string[] = [];
      for (const from of [SERVICE_PAGE, AREA_NOT_FOUND]) {
        await openFresh(page, from);
        await follow(page, goToHome(page));
        const a = await arrive(`${from.path} → "Go to Home"`, HOME);
        for (const problem of a.target.problems) found.push(`${from.path} → "Go to Home": ${problem}`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'After `/` → "AWS" → `/aws`, press Back → the address is `/` and focus is on the content target named "Home"; press Forward → the address is `/aws` and focus is on the content target named "Amazon Web Services"',
    async () => {
      await openFresh(page, HOME);
      await follow(page, f.aws);
      await arrive('/ → the frame\'s "AWS" (before Back)', INDEX);
      await page.goBack();
      const back = await arrive('/aws → Back', HOME);
      await page.goForward();
      const forward = await arrive('/ → Forward', INDEX);
      expect(
        [...back.target.problems.map((p) => `Back: ${p}`), ...forward.target.problems.map((p) => `Forward: ${p}`)],
        'focus is on the new page’s content target after Back and after Forward',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Fresh load of `/aws/kinesis/streams`, focus "Amazon Kinesis" in the side navigation, Enter → the address is `/aws/kinesis` and focus is on the content target named "Amazon Kinesis"; press Back → the address is `/aws/kinesis/streams` and focus is on the content target named "Amazon Kinesis"',
    async () => {
      await openFresh(page, SERVICE_BELOW);
      await follow(page, sideNavigationLink(page, SERVICE));
      const there = await arrive('/aws/kinesis/streams → "Amazon Kinesis" in the side navigation', SERVICE_PAGE);
      await page.goBack();
      const back = await arrive('/aws/kinesis → Back', SERVICE_BELOW);
      expect(
        [
          ...there.target.problems.map((p) => `to /aws/kinesis: ${p}`),
          ...back.target.problems.map((p) => `Back: ${p}`),
        ],
        'focus is on the content target named "Amazon Kinesis" both times',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Fresh load of `/aws`, focus the frame\'s "AWS", Enter → the address is still `/aws` and focus stays on "AWS"',
    async () => {
      await openFresh(page, INDEX);
      await follow(page, f.aws);
      await settled(page);
      await expect(page).toHaveURL(addressOf(INDEX.path));
      await expect(heading(page, INDEX.h1)).toBeVisible();
      await settled(page);
      const stop = await focusedStop(page);
      expect(await hasFocus(f.aws), `focus stays on the frame's "AWS" (it is on ${describeStop(stop)})`).toBe(true);
    },
  );

  // The route changes above, each read once its page was shown; a line that did not get to its route change is
  // missing here, and the count says so.
  const CHANGES = 16;

  const fresh = new Map<string, { title: string; marks: (string | null)[]; live: string[] }>();
  async function freshOf(p: PageOf) {
    const known = fresh.get(p.path);
    if (known) return known;
    await openFresh(page, p);
    await settled(page);
    const read = { title: await page.title(), marks: await marksOf(page), live: await liveRegions(page) };
    fresh.set(p.path, read);
    ctx.log(
      `fresh ${p.path}: title "${read.title}", marks ${JSON.stringify(read.marks)}, live ${JSON.stringify(read.live)}`,
    );
    return read;
  }

  await lines.line(
    "After each route change above → the next Tab reaches the new page's first content stop, the focused content target draws no focus ring, the document title is the new page's (`<h1> | EmuForge Studio`, `EmuForge Studio` on Home), and the frame's `aria-current` marks the new page as on a fresh load of it",
    async () => {
      const found: string[] = [];
      if (arrivals.length !== CHANGES) {
        found.push(`${String(arrivals.length)} of ${String(CHANGES)} route changes were made and read`);
      }
      for (const a of arrivals) {
        for (const p of contentStopProblems(a.next, a.to.firstStop)) found.push(`${a.change}: ${p}`);
        const onTarget = !a.target.problems.some((p) => p.startsWith('focus is on'));
        if (!onTarget) found.push(`${a.change}: no content target has focus (${a.target.focused})`);
        for (const p of a.target.problems.filter((x) => x.includes('focus ring'))) found.push(`${a.change}: ${p}`);
        if (a.title !== titleFor(a.to)) found.push(`${a.change}: the title is "${a.title}", not "${titleFor(a.to)}"`);
        const reference = await freshOf(a.to);
        if (JSON.stringify(a.marks) !== JSON.stringify(reference.marks)) {
          found.push(
            `${a.change}: the frame's marks are ${JSON.stringify(a.marks)}, on a fresh load ${JSON.stringify(reference.marks)}`,
          );
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'After each route change above → the document has no live region (`aria-live`, `role` `status`, `alert` or `log`) that a fresh load of the new path does not have',
    async () => {
      const found: string[] = [];
      if (arrivals.length !== CHANGES) {
        found.push(`${String(arrivals.length)} of ${String(CHANGES)} route changes were made and read`);
      }
      for (const a of arrivals) {
        const extra = extraLiveRegions(a.live, (await freshOf(a.to)).live);
        if (extra.length > 0) found.push(`${a.change}: live regions a fresh load has not: ${extra.join(', ')}`);
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.focus-moves-change-nothing-on-screen', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const f = frame(page);

  async function places(p: PageOf): Promise<Places> {
    return placesOf(page, p.firstStop, f.banner);
  }

  await lines.line(
    'Fresh load of each of `/`, `/aws`, `/aws/kinesis`, `/aws/does-not-exist` and `/does-not-exist`, Tab, Enter on "Skip to content" → the page\'s `h1`, its first content stop and the frame\'s bar are at the same place as before the Enter, and no element draws an outline; on a page of the area the "before" places are read once the emulator line shows "Connected at `<endpoint>`" (changed, issue 45)',
    async () => {
      const found: string[] = [];
      for (const p of FIVE) {
        await openFresh(page, p);
        await lineAnswered(page, p.path, stack.emulatorPort);
        await tabToSkip(page);
        const before = await places(p);
        await page.keyboard.press('Enter');
        await settled(page);
        const after = await places(p);
        for (const moved of placeDiffers(before, after)) found.push(`${p.path}: ${moved}`);
        for (const drawn of await outlinedElements(page)) found.push(`${p.path}: ${drawn}`);
        ctx.log(`${p.path}: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Each of those five pages reached by a route change: `/` by the frame\'s "Home" from a fresh `/aws`; `/aws` by the frame\'s "AWS" from a fresh `/`; `/aws/kinesis` by "Amazon Kinesis" in the side navigation from a fresh `/aws`; `/aws/does-not-exist` by Back after a fresh `/aws/does-not-exist` and "AWS" in its breadcrumbs (changed, issue 45); `/does-not-exist` by Back after a fresh `/does-not-exist` and "Go to Home" → the page\'s `h1`, its first content stop and the frame\'s bar are at the same place as on a fresh load of the same path, and no element draws an outline; on a page of the area the places are read, on the fresh load and after the route change alike, once the emulator line shows "Connected at `<endpoint>`" (changed, issue 45)',
    async () => {
      const routes: { to: PageOf; how: string; go: () => Promise<void> }[] = [
        {
          to: HOME,
          how: 'the frame\'s "Home" from a fresh /aws',
          go: async () => {
            await openFresh(page, INDEX);
            await follow(page, f.home);
          },
        },
        {
          to: INDEX,
          how: 'the frame\'s "AWS" from a fresh /',
          go: async () => {
            await openFresh(page, HOME);
            await follow(page, f.aws);
          },
        },
        {
          to: SERVICE_PAGE,
          how: '"Amazon Kinesis" in the side navigation from a fresh /aws',
          go: async () => {
            await openFresh(page, INDEX);
            await follow(page, sideNavigationLink(page, SERVICE));
          },
        },
        {
          to: AREA_NOT_FOUND,
          how: 'Back after a fresh /aws/does-not-exist and "AWS" in its breadcrumbs',
          go: async () => {
            await openFresh(page, AREA_NOT_FOUND);
            await follow(page, breadcrumbLink(page, 'AWS'));
            await shown(page, INDEX);
            await page.goBack();
          },
        },
        {
          to: STUDIO_NOT_FOUND,
          how: 'Back after a fresh /does-not-exist and "Go to Home"',
          go: async () => {
            await openFresh(page, STUDIO_NOT_FOUND);
            await follow(page, goToHome(page));
            await shown(page, HOME);
            await page.goBack();
          },
        },
      ];
      const found: string[] = [];
      for (const { to, how, go } of routes) {
        await openFresh(page, to);
        await lineAnswered(page, to.path, stack.emulatorPort);
        await settled(page);
        const reference = await places(to);
        await go();
        await shown(page, to);
        await awaitTarget(page, to.h1, to.firstStop);
        await lineAnswered(page, to.path, stack.emulatorPort);
        await settled(page);
        const after = await places(to);
        for (const moved of placeDiffers(reference, after)) found.push(`${to.path} by ${how}: ${moved}`);
        for (const drawn of await outlinedElements(page)) found.push(`${to.path} by ${how}: ${drawn}`);
        ctx.log(`${to.path} by ${how}: fresh ${JSON.stringify(reference)}, after ${JSON.stringify(after)}`);
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.first-load-keeps-focus-at-document-start', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);
  await recordFocusMoves(page);

  /** Once `p` is shown and the title is its own: focus on `body`, nothing took focus, the first Tab "Skip to content". */
  async function atStart(p: PageOf): Promise<string[]> {
    await expect(heading(page, p.h1)).toBeVisible();
    await expect.poll(() => page.title(), { message: `the title of ${p.path}` }).toBe(titleFor(p));
    if (p.home) await connected(page);
    await settled(page);
    const found: string[] = [];
    const focused = await focusedStop(page);
    if (focused !== null) found.push(`${p.path}: focus is on ${describeStop(focused)}, not on body`);
    const moves = await focusMoves(page);
    if (moves.length > 0) found.push(`${p.path}: focus moved on load to ${moves.join(', ')}`);
    const first = await pressTab(page);
    if (first?.name !== SKIP) found.push(`${p.path}: the first Tab reached ${describeStop(first)}, not "${SKIP}"`);
    return found;
  }

  await lines.line(
    "Fresh load of `/`, `/aws`, `/aws/kinesis`, `/aws/does-not-exist` and `/does-not-exist` → once the page's `h1` is visible and the document title is the page's, focus is on the document's `body`, and the first Tab reaches \"Skip to content\"",
    async () => {
      const found: string[] = [];
      for (const p of FIVE) {
        await page.goto(p.path);
        found.push(...(await atStart(p)));
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'After `/` → "AWS" → `/aws` with the keyboard, reload → once the `h1` "Amazon Web Services" is visible and the document title is the page\'s, focus is on the document\'s `body`, and the first Tab reaches "Skip to content"',
    async () => {
      await openFresh(page, HOME);
      await follow(page, frame(page).aws);
      await shown(page, INDEX);
      await page.reload();
      expect(await atStart(INDEX)).toEqual([]);
    },
  );

  lines.end();
});
