// The flow checks of issue 32 on the language menu (test-criteria.md, issue 32, Flow; requirement R2, R3): a press
// outside the control while the menu is open only puts the menu away, and at 480 wide and below a veil tells the open
// menu apart from the page under the bar. In the built app served by `bun run serve`, in front of a real engine
// started for that Studio and an emulator of the check's own, stopped for Home's "emulator stopped" state, then the
// engine stopped for "engine unreachable". Every press lands at a point of the window, as a finger or a pointer
// lands; the touch presses run in a context with touch. Measurements are made first and the criteria lines are judged
// at the end, so a line that reads what happened later in the run ("the browser has opened no other page") reads it
// after everything else the check did. Words: `support/language-menu.ts`.
//
// `studio.language-menu-dismissing-press-does-nothing-else`, `studio.language-menu-is-veiled-at-480-and-below`.

import type { Locator, Page } from '@playwright/test';

import {
  aim,
  borderProblems,
  CHANGE_BOUND_MS,
  coveredAtCentre,
  enterState,
  expect,
  focusedName,
  focusOnControl,
  HOME_STATES,
  languageNow,
  markElements,
  menuClosed,
  menuLook,
  menuPage,
  noTransition,
  openArea,
  openMenuBy,
  outsideMenu,
  pagePlace,
  pathOf,
  pointProblems,
  pointsUnderBar,
  pressAgain,
  pressAt,
  sameColour,
  showHome,
  startStack,
  studioInArea,
  test,
  touchDrag,
  treeWithoutMenu,
  VEIL_FILL,
  veilLook,
  waitFor,
  windowHeight,
  type MenuPage,
  type Point,
  type PressKind,
} from './support';
import { ACTION, addressOf, frame, providersSection } from './support/frame';
import { languageControl, languageMenu, notOnTop, settled } from './support/languages';
import { layerReport, type Scheme } from './support/layers';
import { lineAnswered } from './support/focus';
import { Lines } from './support/lines';
import { HEALTH_PATH } from './support/traffic';

/** Home checks again this long after each answer (requirement 3.4 of issue 3). */
const RECHECK_MS = 5_000;

/** The service link of Home every press on a link uses: the first of the AWS provider's (requirement D2). */
const HOME_LINK = 'Amazon API Gateway';

/** The service link inside the AWS area, at `/aws`. */
const AREA_LINK = 'AWS Lambda';

/** The notice's disclosure in the emulator stopped state. */
const BUILD_ONCE = 'First run? Build the image once, from the root of your EmuForge checkout';

/** What the copy button and the polite region say after a copy (the English catalogue's two outcomes). */
const COPY_OUTCOMES = ['Command copied', 'Command not copied'];

/** At most `n` lines of a list, with how many more there are. */
function cap(list: string[], n = 40): string[] {
  return list.length > n ? [...list.slice(0, n), `… and ${String(list.length - n)} more`] : list;
}

/** The first line of an error's message. */
function first(e: unknown): string {
  return ((e as Error).message ?? String(e)).split('\n')[0];
}

/** Home's service link `name` in its "Providers" section. */
function homeLink(page: Page, name = HOME_LINK): Locator {
  return providersSection(page).getByRole('link', { name, exact: true });
}

/** The path a link opens: its `href`. */
async function hrefOf(link: Locator): Promise<string> {
  const href = await link.first().getAttribute('href', ACTION);
  if (href === null) throw new Error('the link has no href');
  return new URL(href, 'http://127.0.0.1').pathname;
}

/** Whether the page's path becomes `path` within the bound of an action. */
async function pathBecomes(page: Page, path: string): Promise<boolean> {
  return expect(page)
    .toHaveURL(addressOf(path), ACTION)
    .then(() => true)
    .catch(() => false);
}

// ---------------------------------------------------------------------------------------------------------------
// studio.language-menu-dismissing-press-does-nothing-else
// ---------------------------------------------------------------------------------------------------------------

/** What one dismissing press did. */
interface Dismissed {
  /** Where it landed. */
  point: Point;
  closed: boolean;
  path: string;
  focused: boolean;
  focus: string;
}

test('studio.language-menu-dismissing-press-does-nothing-else', async ({ ctx, browser, proxy }) => {
  test.setTimeout(900_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const lines = new Lines(ctx);
  const found = {
    tapLink: [] as string[],
    clickLink: [] as string[],
    again: [] as string[],
    awsTab: [] as string[],
    refresh: [] as string[],
    copy: [] as string[],
    disclosure: [] as string[],
    area: [] as string[],
    drag: [] as string[],
    middle: [] as string[],
    secondary: [] as string[],
    wheel: [] as string[],
    language: [] as string[],
  };
  let presses = 0;
  /** Pages the browser opened since the middle button was pressed; `null` until it was pressed. */
  let middleOpened: () => number | null = () => null;

  const touch = await menuPage(ctx, browser, proxy, stack.studio, { width: 390, touch: true });
  const mouse = await menuPage(ctx, browser, proxy, stack.studio, { width: 1280 });

  /**
   * Opens the menu with a press on the control (a tap or a click as `kind` is a tap or not), presses `target` at a
   * point outside the menu with `kind`, and reads what followed. The language before and after goes to its line.
   */
  const dismiss = async (m: MenuPage, kind: PressKind, target: Locator, name: string, where: string) => {
    const points = await aim(m.page, target, name);
    const before = await languageNow(m.page);
    await openMenuBy(m.page, kind === 'tap' ? 'tap' : 'click');
    const point = await outsideMenu(m.page, points, name);
    await pressAt(m.page, kind, point);
    presses++;
    const closed = await menuClosed(m.page);
    const result: Dismissed = {
      point,
      closed,
      path: pathOf(m.page),
      focused: await focusOnControl(m.page),
      focus: await focusedName(m.page),
    };
    const after = await languageNow(m.page);
    if (after.stored !== before.stored || after.lang !== before.lang) {
      found.language.push(
        `${where}: stored ${String(before.stored)} → ${String(after.stored)}, page language ${String(before.lang)} → ${String(after.lang)}`,
      );
    }
    ctx.log(`${where}: ${kind} at (${point.x.toFixed(0)},${point.y.toFixed(0)}): ${JSON.stringify(result)}`);
    return result;
  };

  /** The problems of a dismissing press against "closed, the path is still `path`, focus on the control". */
  const expectDismissed = (d: Dismissed, path: string, where: string, withFocus: boolean): string[] => {
    const out: string[] = [];
    if (!d.closed) out.push(`${where}: the menu is still open`);
    if (d.path !== path) out.push(`${where}: the path went from ${path} to ${d.path}`);
    if (withFocus && !d.focused) out.push(`${where}: focus is on ${d.focus}, not on the control`);
    return out;
  };

  /** "Press it again → its path opens", into `into`. */
  const again = async (m: MenuPage, kind: PressKind, target: Locator, d: Dismissed, name: string, where: string) => {
    const href = await hrefOf(target).catch(() => null);
    if (href === null) {
      found.again.push(`${where}: ${name} is not on the page to be pressed again (the path is ${pathOf(m.page)})`);
      return;
    }
    const problem = await pressAgain(m.page, kind, target, d.point, name);
    if (problem) found.again.push(`${where}: ${problem}`);
    else if (!(await pathBecomes(m.page, href))) {
      found.again.push(`${where}: pressed again, the path is ${pathOf(m.page)}, not ${href}`);
    }
  };

  // Connected.
  {
    // A service link of Home: a tap at 390, a click at 1280, then the same press again.
    for (const [m, kind, list, where] of [
      [touch, 'tap', found.tapLink, '390, tap'],
      [mouse, 'click', found.clickLink, '1280, click'],
    ] as const) {
      try {
        await showHome(m.page, 'connected');
        const link = homeLink(m.page);
        const d = await dismiss(m, kind, link, `"${HOME_LINK}"`, `${where}, "${HOME_LINK}"`);
        list.push(...expectDismissed(d, '/', `${where}, "${HOME_LINK}"`, true));
        await again(m, kind, link, d, `"${HOME_LINK}"`, `${where}, "${HOME_LINK}"`);
      } catch (e) {
        list.push(`${where}: could not press: ${first(e)}`);
      }
    }

    // The bar's "AWS" tab, at 1280 and 390.
    for (const [m, kind, where] of [
      [mouse, 'click', '1280, click'],
      [touch, 'tap', '390, tap'],
    ] as const) {
      try {
        await showHome(m.page, 'connected');
        const tab = frame(m.page).aws;
        const d = await dismiss(m, kind, tab, 'the "AWS" tab', `${where}, "AWS" tab`);
        found.awsTab.push(...expectDismissed(d, '/', `${where}, "AWS" tab`, false));
        const problem = await pressAgain(m.page, kind, tab, d.point, 'the "AWS" tab');
        if (problem) found.awsTab.push(`${where}: ${problem}`);
        else if (!(await pathBecomes(m.page, '/aws'))) {
          found.awsTab.push(`${where}: pressed again, the path is ${pathOf(m.page)}, not /aws`);
        }
      } catch (e) {
        found.awsTab.push(`${where}: could not press: ${first(e)}`);
      }
    }

    // Home's "Refresh", right after a check answered: the checks sent since the menu opened.
    try {
      const m = mouse;
      await showHome(m.page, 'connected');
      const refresh = m.page.getByRole('main').getByRole('button', { name: 'Refresh', exact: true });
      const points = await aim(m.page, refresh, '"Refresh"');
      const isHealth = (r: { url(): string }) => new URL(r.url()).pathname === HEALTH_PATH;
      await m.page.waitForResponse(isHealth, { timeout: CHANGE_BOUND_MS });
      // Home's own timer sends a check 5 seconds after each answer (requirement 3.4 of issue 3): the count holds only
      // while the second click's check is answered within those 5 seconds.
      const answeredAt = Date.now();
      const before = await languageNow(m.page);
      await openMenuBy(m.page, 'click');
      await m.traffic.settle();
      const sentBefore = m.traffic.to(stack.engine.url, HEALTH_PATH).length;
      const point = await outsideMenu(m.page, points, '"Refresh"');
      await pressAt(m.page, 'click', point);
      presses++;
      if (!(await menuClosed(m.page))) found.refresh.push('the menu is still open after the click on "Refresh"');
      const after = await languageNow(m.page);
      if (after.stored !== before.stored || after.lang !== before.lang) {
        found.language.push(`1280, "Refresh": stored ${String(after.stored)}, page language ${String(after.lang)}`);
      }
      // "Refresh" ignores a choice while its check is in flight (it is busy), so it is clicked again once it is not:
      // a click it acts on, whose check is the one waited for.
      const idle = await expect(refresh)
        .not.toHaveAttribute('aria-busy', 'true', ACTION)
        .then(() => true)
        .catch(() => false);
      const answered = m.page.waitForResponse(isHealth, { timeout: CHANGE_BOUND_MS }).catch(() => null);
      const problem = idle
        ? await pressAgain(m.page, 'click', refresh, point, '"Refresh"')
        : '"Refresh" was still busy 10s after the click';
      if (problem) found.refresh.push(problem);
      else {
        if ((await answered) === null) found.refresh.push('no check was answered within 10s of the second click');
        await m.traffic.settle();
        const sent = m.traffic.to(stack.engine.url, HEALTH_PATH).length - sentBefore;
        ctx.log(`"Refresh": ${String(sent)} checks sent to the engine since the menu was opened`);
        const took = Date.now() - answeredAt;
        if (took >= RECHECK_MS) {
          found.refresh.push(
            `could not measure: the second click's check was answered ${String(took)}ms after the check the line starts from, so Home's own timer may have sent one`,
          );
        } else if (sent !== 1) {
          found.refresh.push(`${String(sent)} checks were sent to the engine since the menu was opened`);
        }
      }
    } catch (e) {
      found.refresh.push(`could not press "Refresh": ${first(e)}`);
    }

    // A service link inside the AWS area, at `/aws`, at 1280 and 390.
    for (const [m, kind, where] of [
      [mouse, 'click', '1280, click'],
      [touch, 'tap', '390, tap'],
    ] as const) {
      try {
        await openArea(m.page, '/aws', 'Amazon Web Services');
        // (changed, issue 45 PM decision) The area's emulator line may add a row with its first answer (R4.7); the
        // link's point is read once the line shows it, as the focus check does.
        await lineAnswered(m.page, '/aws', stack.emulatorPort);
        await settled(m.page);
        const links = m.page.getByRole('link', { name: AREA_LINK, exact: true }).filter({ visible: true });
        const count = await links.count();
        let link: Locator | null = null;
        let points: Point[] = [];
        for (let i = 0; i < count && link === null; i++) {
          const candidate = links.nth(i);
          const p = await aim(m.page, candidate, `"${AREA_LINK}"`).catch(() => []);
          if (p.length > 0) {
            link = candidate;
            points = p;
          }
        }
        if (link === null) throw new Error(`no "${AREA_LINK}" link of the area is on top in the window`);
        const href = await hrefOf(link);
        const before = await languageNow(m.page);
        await openMenuBy(m.page, kind === 'tap' ? 'tap' : 'click');
        const point = await outsideMenu(m.page, points, `"${AREA_LINK}"`);
        await pressAt(m.page, kind, point);
        presses++;
        const d: Dismissed = {
          point,
          closed: await menuClosed(m.page),
          path: pathOf(m.page),
          focused: await focusOnControl(m.page),
          focus: await focusedName(m.page),
        };
        ctx.log(`${where}, /aws "${AREA_LINK}": ${JSON.stringify(d)}`);
        const after = await languageNow(m.page);
        if (after.stored !== before.stored || after.lang !== before.lang) {
          found.language.push(`${where}, /aws: stored ${String(after.stored)}, page language ${String(after.lang)}`);
        }
        found.area.push(...expectDismissed(d, '/aws', `${where}, /aws "${AREA_LINK}"`, false));
        const problem = await pressAgain(m.page, kind, link, point, `"${AREA_LINK}"`);
        if (problem) found.area.push(`${where}: ${problem}`);
        else if (!(await pathBecomes(m.page, href))) {
          found.area.push(`${where}: pressed again, the path is ${pathOf(m.page)}, not ${href}`);
        }
      } catch (e) {
        found.area.push(`${where}: could not press: ${first(e)}`);
      }
    }

    // A touch drag on the page under the bar, from a service link, then a tap on that link.
    try {
      const m = touch;
      await showHome(m.page, 'connected');
      const link = homeLink(m.page);
      const href = await hrefOf(link);
      const points = await aim(m.page, link, `"${HOME_LINK}"`);
      const before = await languageNow(m.page);
      await openMenuBy(m.page, 'tap');
      const from = await outsideMenu(m.page, points, `"${HOME_LINK}"`);
      await touchDrag(m.page, from, 150);
      presses++;
      if (!(await menuClosed(m.page))) found.drag.push('the menu is still open after the drag');
      if (pathOf(m.page) !== '/') found.drag.push(`the path went from / to ${pathOf(m.page)}`);
      const after = await languageNow(m.page);
      if (after.stored !== before.stored || after.lang !== before.lang) {
        found.language.push(`390, drag: stored ${String(after.stored)}, page language ${String(after.lang)}`);
      }
      if (pathOf(m.page) === '/') {
        const p = await aim(m.page, link, `"${HOME_LINK}"`);
        await pressAt(m.page, 'tap', p[0]);
        if (!(await pathBecomes(m.page, href))) {
          found.drag.push(`a tap on "${HOME_LINK}" after the drag: the path is ${pathOf(m.page)}, not ${href}`);
        }
      }
    } catch (e) {
      found.drag.push(`could not drag: ${first(e)}`);
    }

    // The middle button on a service link, at 1280. Pages opened are counted until the lines are judged.
    let openedAtMiddle: number | null = null;
    try {
      const m = mouse;
      await showHome(m.page, 'connected');
      openedAtMiddle = m.opened();
      const d = await dismiss(m, 'middle', homeLink(m.page), `"${HOME_LINK}"`, '1280, middle button');
      found.middle.push(...expectDismissed(d, '/', '1280, middle button', false));
    } catch (e) {
      found.middle.push(`could not press: ${first(e)}`);
    }

    // The secondary button on a service link, at 1280, then a click on that link.
    try {
      const m = mouse;
      await showHome(m.page, 'connected');
      const link = homeLink(m.page);
      const href = await hrefOf(link);
      const d = await dismiss(m, 'secondary', link, `"${HOME_LINK}"`, '1280, secondary button');
      found.secondary.push(...expectDismissed(d, '/', '1280, secondary button', false));
      const problem = await pressAgain(m.page, 'click', link, d.point, `"${HOME_LINK}"`);
      if (problem) found.secondary.push(problem);
      else if (!(await pathBecomes(m.page, href))) {
        found.secondary.push(`a click after the secondary button: the path is ${pathOf(m.page)}, not ${href}`);
      }
    } catch (e) {
      found.secondary.push(`could not press: ${first(e)}`);
    }

    // The wheel over the page, at 1280.
    try {
      const m = mouse;
      await showHome(m.page, 'connected');
      await m.page.evaluate(() => window.scrollTo(0, 0));
      await settled(m.page);
      const before = await languageNow(m.page);
      await openMenuBy(m.page, 'click');
      const menu = await languageMenu(m.page).boundingBox(ACTION);
      const over = { x: Math.max(40, (menu?.x ?? 400) / 2), y: windowHeight(1280) / 2 };
      const scrolled = await m.page.evaluate(() => scrollY);
      await m.page.mouse.move(over.x, over.y);
      await m.page.mouse.wheel(0, 300);
      const moved = await waitFor(ACTION.timeout, async () =>
        (await m.page.evaluate(() => scrollY)) > scrolled ? true : undefined,
      );
      await settled(m.page);
      if (!moved) found.wheel.push('the page did not scroll');
      if (!(await languageMenu(m.page).isVisible())) found.wheel.push('the menu closed');
      const after = await languageNow(m.page);
      if (after.stored !== before.stored || after.lang !== before.lang) {
        found.language.push(`1280, wheel: stored ${String(after.stored)}, page language ${String(after.lang)}`);
      }
      await m.page.keyboard.press('Escape');
    } catch (e) {
      found.wheel.push(`could not turn the wheel: ${first(e)}`);
    }

    middleOpened = () => (openedAtMiddle === null ? null : mouse.opened() - openedAtMiddle);
  }

  // Emulator stopped: the notice's "First run? …" disclosure, at 1280.
  await enterState(ctx, stack, 'emulator stopped');
  try {
    const m = mouse;
    await showHome(m.page, 'emulator stopped');
    const toggle = m.page.getByRole('main').locator('[aria-expanded]').filter({ hasText: BUILD_ONCE });
    const d = await dismiss(m, 'click', toggle, 'the "First run? …" disclosure', '1280, disclosure');
    found.disclosure.push(...expectDismissed(d, '/', '1280, disclosure', true));
    const expanded = await toggle.first().getAttribute('aria-expanded', ACTION);
    if (expanded !== 'false')
      found.disclosure.push(`after the click the disclosure is aria-expanded=${String(expanded)}`);
    const problem = await pressAgain(m.page, 'click', toggle, d.point, 'the disclosure');
    if (problem) found.disclosure.push(problem);
    else {
      const opened = await expect(toggle.first())
        .toHaveAttribute('aria-expanded', 'true', ACTION)
        .then(() => true)
        .catch(() => false);
      if (!opened) found.disclosure.push('clicked again, the disclosure does not open');
    }
  } catch (e) {
    found.disclosure.push(`could not press: ${first(e)}`);
  }

  // Engine unreachable: "Copy" of the notice's command, at 1280. Every copy outcome the button shows and the polite
  // region says is recorded from before the menu opens; the click of "Copy" made after the menu closed bounds the
  // wait for the dismissing press's own outcome, which would come first.
  await enterState(ctx, stack, 'engine unreachable');
  try {
    const m = mouse;
    await showHome(m.page, 'engine unreachable');
    const copy = m.page
      .getByRole('main')
      .getByRole('button', { name: /^Copy command: / })
      .filter({ visible: true })
      .first();
    const points = await aim(m.page, copy, '"Copy"');
    await copy.evaluate(
      (button, outcomes) => {
        const w = window as unknown as { __emuforgeItCopy?: { phase: string; said: string[]; shown: string[] } };
        const record = { phase: 'open', said: [] as string[], shown: [] as string[] };
        w.__emuforgeItCopy = record;
        const group = button.closest('[role="group"]') ?? button.parentElement!;
        const shows = () => {
          const text = (group as HTMLElement).innerText ?? '';
          return outcomes.find((o) => text.includes(o));
        };
        new MutationObserver(() => {
          const s = shows();
          if (s) record.shown.push(`${record.phase}: ${s}`);
        }).observe(group, { subtree: true, childList: true, characterData: true, attributes: true });
        for (const region of document.querySelectorAll('[aria-live="polite"]')) {
          new MutationObserver((list) => {
            for (const mu of list) {
              for (const n of mu.addedNodes) {
                const t = (n.textContent ?? '').trim();
                if (t !== '') record.said.push(`${record.phase}: ${t}`);
              }
            }
          }).observe(region, { subtree: true, childList: true });
        }
      },
      COPY_OUTCOMES,
      ACTION,
    );
    const before = await languageNow(m.page);
    await openMenuBy(m.page, 'click');
    const point = await outsideMenu(m.page, points, '"Copy"');
    await m.page.evaluate(() => {
      (window as unknown as { __emuforgeItCopy: { phase: string } }).__emuforgeItCopy.phase = 'dismissing press';
    });
    await pressAt(m.page, 'click', point);
    presses++;
    if (!(await menuClosed(m.page))) found.copy.push('the menu is still open after the click on "Copy"');
    const after = await languageNow(m.page);
    if (after.stored !== before.stored || after.lang !== before.lang) {
      found.language.push(`1280, "Copy": stored ${String(after.stored)}, page language ${String(after.lang)}`);
    }
    await m.page.evaluate(() => {
      (window as unknown as { __emuforgeItCopy: { phase: string } }).__emuforgeItCopy.phase = 'next click';
    });
    const problem = await pressAgain(m.page, 'click', copy, point, '"Copy"');
    if (problem) found.copy.push(`${problem} (the dismissing press's outcome could not be bounded)`);
    else {
      const said = await waitFor(ACTION.timeout, async () => {
        const r = await m.page.evaluate(
          () => (window as unknown as { __emuforgeItCopy: { said: string[] } }).__emuforgeItCopy.said,
        );
        return r.some((s) => s.startsWith('next click')) ? true : undefined;
      });
      if (!said) found.copy.push('the next click of "Copy" was not announced within 10s');
    }
    await settled(m.page);
    const record = await m.page.evaluate(
      () => (window as unknown as { __emuforgeItCopy: { said: string[]; shown: string[] } }).__emuforgeItCopy,
    );
    ctx.log(`"Copy": ${JSON.stringify(record)}`);
    for (const s of record.shown.filter((x) => !x.startsWith('next click'))) {
      found.copy.push(`the button showed a copy outcome: ${s}`);
    }
    for (const s of record.said.filter((x) => !x.startsWith('next click'))) {
      found.copy.push(`the polite region said: ${s}`);
    }
    const nextSaid = record.said.filter((x) => x.startsWith('next click')).length;
    if (nextSaid > 1)
      found.copy.push(`the polite region said ${String(nextSaid)} outcomes for one click after the menu`);
  } catch (e) {
    found.copy.push(`could not press "Copy": ${first(e)}`);
  }

  await lines.line(
    '(regression) Connected, 390 wide, touch: open the menu and tap a service link of Home → the menu is closed, the path is still `/`, and focus is on the control',
    async () => expect(found.tapLink).toEqual([]),
  );
  await lines.line(
    '(regression) Connected, 1280 wide, mouse: open the menu and click a service link of Home → the menu is closed, the path is still `/`, and focus is on the control',
    async () => expect(found.clickLink).toEqual([]),
  );
  await lines.line('After each of those, press the same link again → its path opens', async () =>
    expect(found.again).toEqual([]),
  );
  await lines.line(
    '1280 and 390 wide: open the menu and press the bar\'s "AWS" tab → the menu is closed and the path is still `/`; press it again → the path is `/aws`',
    async () => expect(found.awsTab).toEqual([]),
  );
  await lines.line(
    '1280 wide, right after a check answered: open the menu and click Home\'s "Refresh" → the menu is closed; click "Refresh" again and wait for its check to be answered → exactly one check was sent to the engine since the menu was opened',
    async () => expect(found.refresh).toEqual([]),
  );
  await lines.line(
    'Engine unreachable, 1280 wide: open the menu and click "Copy" of the notice\'s command → the menu is closed, the button does not show a copied or failed state, and the polite region says nothing',
    async () => expect(found.copy).toEqual([]),
  );
  await lines.line(
    '(regression) Emulator stopped, 1280 wide: open the menu and click the notice\'s "First run? …" disclosure → the menu is closed, the disclosure is still closed, and focus is on the control; click it again → it opens',
    async () => expect(found.disclosure).toEqual([]),
  );
  await lines.line(
    "On `/aws`, 1280 and 390 wide: open the menu and press a service link inside the AWS area → the menu is closed and the path is still `/aws`; press it again → that service's path opens; the link's point is read once the emulator line shows its first answer (changed, issue 45 PM decision)",
    async () => expect(found.area).toEqual([]),
  );
  await lines.line(
    '390 wide, touch: open the menu, drag a finger on the page under the bar and lift it → the menu is closed and the path is still `/`; then tap a service link → its path opens',
    async () => expect(found.drag).toEqual([]),
  );
  await lines.line(
    '1280 wide: open the menu and press the middle button on a service link → the menu is closed, the path is still `/`, and the browser has opened no other page',
    async () => {
      const opened = middleOpened();
      const problems = [...found.middle];
      if (opened === null) problems.push('the middle button was not pressed');
      else if (opened > 0) problems.push(`the browser opened ${String(opened)} other page(s) since the press`);
      expect(problems).toEqual([]);
    },
  );
  await lines.line(
    '1280 wide: open the menu and press the secondary button on a service link → the menu is closed and the path is still `/`; then click the same link → its path opens',
    async () => expect(found.secondary).toEqual([]),
  );
  await lines.line(
    '1280 wide: open the menu and turn the wheel over the page → the page scrolls and the menu is still open',
    async () => expect(found.wheel).toEqual([]),
  );
  await lines.line(
    'After every press above → the stored language is what it was, and the language of the page is unchanged',
    async () => {
      const problems = [...found.language];
      if (presses === 0) problems.push('no press was made');
      expect(cap(problems)).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.language-menu-is-veiled-at-480-and-below
// ---------------------------------------------------------------------------------------------------------------

const SCHEMES: readonly Scheme[] = ['light', 'dark'];

test('studio.language-menu-is-veiled-at-480-and-below', async ({ ctx, browser, proxy }) => {
  test.setTimeout(900_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const lines = new Lines(ctx);
  const found = {
    covers: [] as string[],
    bar: [] as string[],
    fill: [] as string[],
    scroll: [] as string[],
    still: [] as string[],
    tree: [] as string[],
    wide: [] as string[],
    box: [] as string[],
    area: [] as string[],
    motion: [] as string[],
  };

  /** Sets the window and the scheme, scrolls to the top, marks the page and opens the menu. */
  const openAt = async (page: Page, width: number, scheme: Scheme, reducedMotion?: 'reduce' | 'no-preference') => {
    await page.setViewportSize({ width, height: windowHeight(width) });
    await page.emulateMedia({ colorScheme: scheme, ...(reducedMotion ? { reducedMotion } : {}) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settled(page);
    await markElements(page);
    await openMenuBy(page, 'click');
  };

  const close = async (page: Page) => {
    await page.keyboard.press('Escape');
    await menuClosed(page);
  };

  for (const state of HOME_STATES) {
    await enterState(ctx, stack, state);
    const m = await menuPage(ctx, browser, proxy, stack.studio, { width: 390 });
    const page = m.page;
    try {
      await showHome(page, state);
    } catch (e) {
      found.covers.push(`${state}: could not open Home: ${first(e)}`);
      await m.context.close();
      continue;
    }

    // 390 and 480, light and dark: what the open menu covers, the bar, the menu on top, the veil's fill.
    for (const width of [390, 480]) {
      for (const scheme of SCHEMES) {
        const where = `${state}, ${String(width)}, ${scheme}`;
        try {
          await openAt(page, width, scheme);
          const points = await pointsUnderBar(page);
          found.covers.push(...pointProblems(points, 'veil', where));
          const f = frame(page);
          for (const [name, el] of [
            ['the wordmark', f.wordmark],
            ['the "Home" tab', f.home],
            ['the "AWS" tab', f.aws],
            ['the control', languageControl(page)],
          ] as const) {
            const covered = await coveredAtCentre(el);
            if (covered) found.bar.push(`${where}: ${name} is not met at its centre: ${covered}`);
          }
          for (const p of await notOnTop(page, languageMenu(page))) {
            found.bar.push(`${where}: the menu is not on top at its ${p}`);
          }
          const look = await veilLook(page, VEIL_FILL[scheme]);
          if (!look) found.fill.push(`${where}: no veil just under the bar`);
          else {
            if (!sameColour(look.drawn, look.wanted)) {
              found.fill.push(
                `${where}: the veil ${look.what} is filled ${look.background} (${look.drawn.join(',')}), not ${VEIL_FILL[scheme]} (${look.wanted.join(',')})`,
              );
            }
            if (look.boxShadow !== 'none') found.fill.push(`${where}: the veil has a shadow: ${look.boxShadow}`);
            for (const b of borderProblems(look.borders)) found.fill.push(`${where}: the veil has a border: ${b}`);
          }
          await close(page);
        } catch (e) {
          found.covers.push(`${where}: could not measure: ${first(e)}`);
          await close(page).catch(() => undefined);
        }
      }
    }

    if (state === 'connected') {
      // 390: scroll with the menu open.
      try {
        await openAt(page, 390, 'light');
        await page.evaluate(() => window.scrollTo(0, 400));
        await settled(page);
        const y = await page.evaluate(() => scrollY);
        if (y === 0) found.scroll.push('the page did not scroll');
        if (!(await languageMenu(page).isVisible())) found.scroll.push('the menu closed when the page scrolled');
        else found.scroll.push(...pointProblems(await pointsUnderBar(page), 'veil', `390, scrolled to ${String(y)}`));
        await close(page);
      } catch (e) {
        found.scroll.push(`could not measure: ${first(e)}`);
        await close(page).catch(() => undefined);
      }

      // 390: nothing moves when the menu opens, while it is open, or when Esc closes it.
      try {
        await page.setViewportSize({ width: 390, height: windowHeight(390) });
        await page.emulateMedia({ colorScheme: 'light' });
        await page.evaluate(() => window.scrollTo(0, 100));
        await settled(page);
        const before = await pagePlace(page);
        await markElements(page);
        await openMenuBy(page, 'click');
        const open1 = await pagePlace(page);
        await settled(page);
        const open2 = await pagePlace(page);
        await page.keyboard.press('Escape');
        if (!(await menuClosed(page))) found.still.push('Esc did not close the menu');
        await settled(page);
        const after = await pagePlace(page);
        ctx.log(`places: before ${before}; open ${open1}; open later ${open2}; after Esc ${after}`);
        if (open1 !== before) found.still.push(`opening moved the page: ${before} → ${open1}`);
        if (open2 !== open1) found.still.push(`the page moved while the menu was open: ${open1} → ${open2}`);
        if (after !== before) found.still.push(`after Esc the page is not where it was: ${before} → ${after}`);
      } catch (e) {
        found.still.push(`could not measure: ${first(e)}`);
        await close(page).catch(() => undefined);
      }

      // 390: the accessibility tree with the menu open; the veil in it.
      try {
        await page.setViewportSize({ width: 390, height: windowHeight(390) });
        await page.evaluate(() => window.scrollTo(0, 0));
        // Right after a check answered, so "Last checked" does not change between the two trees.
        await page.waitForResponse((r) => new URL(r.url()).pathname === HEALTH_PATH, {
          timeout: CHANGE_BOUND_MS,
        });
        await settled(page);
        const closed = await treeWithoutMenu(page);
        await markElements(page);
        await openMenuBy(page, 'click');
        const open = await treeWithoutMenu(page);
        const menuInTree = (await page.locator('body').ariaSnapshot(ACTION)).includes('- menu');
        if (!menuInTree) found.tree.push('the open menu is not in the accessibility tree');
        const added = open.filter((l) => !closed.includes(l));
        const gone = closed.filter((l) => !open.includes(l));
        for (const l of added) found.tree.push(`with the menu open the tree also holds: ${l.trim()}`);
        for (const l of gone) found.tree.push(`with the menu open the tree no longer holds: ${l.trim()}`);
        await pointsUnderBar(page);
        const look = await veilLook(page, VEIL_FILL.light);
        if (!look) found.tree.push('no veil just under the bar');
        else {
          if (look.role !== null) found.tree.push(`the veil has the role "${look.role}"`);
          if (look.named.length > 0) found.tree.push(`the veil has ${look.named.join(', ')}`);
          if (look.focusable.length > 0) found.tree.push(`the veil holds focusable ${look.focusable.join(', ')}`);
          if (look.text !== '') found.tree.push(`the veil holds the text "${look.text}"`);
          for (const g of look.generated) found.tree.push(`the veil generates content: ${g}`);
        }
        await close(page);
      } catch (e) {
        found.tree.push(`could not measure: ${first(e)}`);
        await close(page).catch(() => undefined);
      }

      // 390: the menu's box as on `main`.
      try {
        await openAt(page, 390, 'light');
        const look = await menuLook(page);
        const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
        const left = look.bar.left + look.bar.paddingLeft;
        const right = look.bar.right - look.bar.paddingRight;
        if (!near(look.box.left, left))
          found.box.push(`the menu starts at ${String(look.box.left)}, not at ${String(left)}`);
        if (!near(look.box.right, right))
          found.box.push(`the menu ends at ${String(look.box.right)}, not at ${String(right)}`);
        if (!near(look.box.top, look.bar.bottom + 4)) {
          found.box.push(
            `the menu's top is at ${String(look.box.top)}, not 4px under the bar (${String(look.bar.bottom + 4)})`,
          );
        }
        await close(page);
      } catch (e) {
        found.box.push(`could not measure: ${first(e)}`);
        await close(page).catch(() => undefined);
      }

      // 390, with reduced motion asked for and without: the veil's transition and animation.
      for (const motion of ['no-preference', 'reduce'] as const) {
        try {
          await openAt(page, 390, 'light', motion);
          await pointsUnderBar(page);
          const look = await veilLook(page, VEIL_FILL.light);
          if (!look) found.motion.push(`${motion}: no veil just under the bar`);
          else {
            if (!noTransition(look.transitionProperty, look.transitionDuration, look.transitionDelay)) {
              found.motion.push(
                `${motion}: the veil has a transition: ${look.transitionProperty} ${look.transitionDuration} ${look.transitionDelay}`,
              );
            }
            if (look.animationName !== 'none')
              found.motion.push(`${motion}: the veil's animation is ${look.animationName}`);
            if (look.animations > 0)
              found.motion.push(`${motion}: the veil runs ${String(look.animations)} animation(s)`);
          }
          await close(page);
        } catch (e) {
          found.motion.push(`${motion}: could not measure: ${first(e)}`);
          await close(page).catch(() => undefined);
        }
      }
      await page.emulateMedia({ reducedMotion: 'no-preference' });

      // 481 and 1280, light and dark: nothing but the menu covers the page; the menu as on `main`.
      for (const width of [481, 1280]) {
        for (const scheme of SCHEMES) {
          const where = `${String(width)}, ${scheme}`;
          try {
            await openAt(page, width, scheme);
            const points = await pointsUnderBar(page);
            found.wide.push(
              ...pointProblems(
                points.filter((p) => p.kind !== 'menu'),
                'page',
                where,
              ),
            );
            const box = await languageMenu(page).boundingBox(ACTION);
            if (box) {
              const beside = await page.evaluate(
                ([x, y]) => {
                  const w = window as unknown as { __emuforgeItMenu?: { before: WeakSet<Element> } };
                  const el = document.elementFromPoint(x, y);
                  if (!el) return 'nothing';
                  return w.__emuforgeItMenu?.before.has(el)
                    ? null
                    : `${el.tagName.toLowerCase()} added when the menu opened`;
                },
                [box.x - 12, box.y + box.height / 2] as const,
              );
              if (beside)
                found.wide.push(`${where}: the point beside the menu meets ${beside}, not the page's own element`);
            }
            const look = await menuLook(page);
            const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
            const end = look.bar.right - look.bar.paddingRight;
            if (!near(look.box.width, 248))
              found.wide.push(`${where}: the menu is ${String(look.box.width)}px wide, not 248`);
            if (!near(look.box.right, end))
              found.wide.push(
                `${where}: the menu ends at ${String(look.box.right)}, not at the bar's end ${String(end)}`,
              );
            if (!sameColour(look.fill.drawn, look.fill.wanted)) {
              found.wide.push(`${where}: the menu is filled ${look.fill.computed}, not surface`);
            }
            if (look.edge.widths.some((w) => w !== '1px') || look.edge.styles.some((s) => s !== 'solid')) {
              found.wide.push(
                `${where}: the menu's edge is ${look.edge.widths.join(' ')} ${look.edge.styles.join(' ')}`,
              );
            }
            if (look.edge.drawn.some((c) => !sameColour(c, look.edge.wanted))) {
              found.wide.push(`${where}: the menu's edge is not control-line`);
            }
            if (look.boxShadow !== 'none') found.wide.push(`${where}: the menu has a shadow: ${look.boxShadow}`);
            await close(page);
          } catch (e) {
            found.wide.push(`${where}: could not measure: ${first(e)}`);
            await close(page).catch(() => undefined);
          }
        }
      }

      // `/aws` at 390: the veil over the area, nothing of Studio's inside the area's root.
      try {
        await openArea(page, '/aws', 'Amazon Web Services');
        await openAt(page, 390, 'light');
        const points = await pointsUnderBar(page);
        found.area.push(...pointProblems(points, 'veil', '/aws, 390'));
        const look = await veilLook(page, VEIL_FILL.light);
        if (look?.insideArea) found.area.push(`the veil ${look.what} is inside the area's root`);
        for (const el of await studioInArea(page))
          found.area.push(`an element of Studio's is inside the area's root: ${el}`);
        const report = await layerReport(page, true);
        if (report.root === null) found.area.push('no area root on /aws');
        for (const r of report.studioInside) found.area.push(`a rule of the studio layer matches ${r}`);
        await close(page);
      } catch (e) {
        found.area.push(`/aws: could not measure: ${first(e)}`);
        await close(page).catch(() => undefined);
      }
    }
    await m.context.close();
  }

  await lines.line(
    "(regression) 390 and 480 wide, light and dark, in each of the three states of Home: open the menu → the veil covers the page from the bar's bottom edge to the bottom of the window and from its left edge to its right: a point just under the bar, the four corners of that box and a point just under the menu all meet the veil, not the page",
    async () => expect(cap(found.covers)).toEqual([]),
  );
  await lines.line(
    "The same → the bar is not covered (the wordmark, the tabs and the control are met at their own centres), and the menu is above the veil (a point inside each corner of the menu's shape meets the menu)",
    async () => expect(cap(found.bar)).toEqual([]),
  );
  await lines.line(
    "The same → the veil's fill is the page's ground at 0.75 opacity in light and at 0.8 in dark (`oklch(0.972 0.005 85 / 0.75)`, `oklch(0.185 0.012 252 / 0.8)`), and it has no shadow and no border",
    async () => expect(cap(found.fill)).toEqual([]),
  );
  await lines.line(
    '390 wide: open the menu, then scroll the page → the veil still covers everything under the bar',
    async () => expect(found.scroll).toEqual([]),
  );
  await lines.line(
    "390 wide: open the menu, then close it with Esc → the page's heading, the first panel and the scroll position are where they were before the menu opened, and they did not move while it was open",
    async () => expect(found.still).toEqual([]),
  );
  await lines.line(
    "390 wide: open the menu → the accessibility tree of the page is what it is at 390 wide with the menu closed, plus the menu and the control's expanded state; the veil is no node of it, takes no focus on Tab, and holds no text",
    async () => expect(cap(found.tree)).toEqual([]),
  );
  await lines.line(
    "481 and 1280 wide, light and dark: open the menu → nothing but the menu covers the page: a point of the page beside the menu meets the page's own element, and the menu's box, fill and edge are as on `main` (248px wide at the bar's end, `surface`, 1px `control-line`, no shadow)",
    async () => expect(cap(found.wide)).toEqual([]),
  );
  await lines.line(
    "390 wide: open the menu → the menu's box is as on `main` (from gutter to gutter, 4px under the bar)",
    async () => expect(found.box).toEqual([]),
  );
  await lines.line(
    "On `/aws` at 390 wide: open the menu → the veil covers the AWS area under the bar, no element of Studio's is inside the area's root, and no rule of the `studio` layer matches the root or an element in it",
    async () => expect(cap(found.area)).toEqual([]),
  );
  await lines.line(
    '390 wide: open the menu → the veil has no transition and no animation (both compute to none), with reduced motion asked for and without',
    async () => expect(found.motion).toEqual([]),
  );

  lines.end();
});
