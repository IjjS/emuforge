// The language menu of Studio's bar as a user meets it while it is open (issue 32, requirement R2, R3;
// test-criteria.md, issue 32, Flow): a press outside the control that should only put the menu away, and the veil that
// should tell the open menu apart from the page at 480 wide and below. Used by `language-menu.spec.ts`.
//
// Words, as `test-criteria.md` defines them, and how they are measured:
//
// - "The menu", "the control", "outside the control": `languageMenu` and `languageControl` of `support/languages.ts`;
//   outside is any point of the bar or the page that is neither.
// - "A press": a mouse click with the main button (`click`) or a tap (`tap`, in a context with touch). The other
//   inputs are a press of the middle button (`middle`), of the secondary button (`secondary`) and a touch drag
//   (`touchDrag`). Every press is made at a point of the window, as a user's finger or pointer lands, never on an
//   element by script: whatever is on top at that point receives it.
// - "Press <element>": the element is first brought into the window (an element of the page is scrolled until its
//   centre is at 85% of the window's height, or as far as the page scrolls; the bar's own do not move), then the
//   points of its box where it is on top are found while the menu is closed. With the menu open, the press lands on
//   the one of those points nearest to the element's centre that is not inside the menu's box. Opening the menu moves
//   nothing (requirement R3.3), so the point is still on the element under whatever covers it.
// - "Press it again": the same kind of press at the same point, once the menu is closed. It is made only while the
//   element is still on top at that point; if it is not (the first press already took the page away), that is the
//   line's failure, not a press.
// - "The veil": what is on top at a point under the bar while the menu is open, when it is an element that was not in
//   the document before the menu opened, is not the menu or inside it, is not inside the AWS area's root and is not
//   an SVG element (an icon redrawn by the page). The page's own element is any other: one that was there before the
//   menu opened. The veil of a page is the element found just under the bar; its fill, shadow, border, motion and
//   content are read from its computed style.
// - "Meets the veil, not the page": the element on top at that point is the veil.
// - "A fill of <colour>": the computed `background-color` and the colour drawn into a canvas pixel for both, compared
//   as 8-bit RGBA within 2 of each channel, so `oklch(...)`, `color-mix(...)` and `rgb(...)` of one colour are equal.

import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from '@playwright/test';

import { type Ctx } from './check';
import { ACTION, frame } from './frame';
import { connectionView } from './home';
import { areaRootLang, languageControl, languageMenu, settled, STORAGE_KEY, storedChoice } from './languages';
import { type Scheme } from './layers';
import { type Stack } from './stack';
import { type StudioServer } from './studio';
import { Traffic } from './traffic';
import { waitFor } from './wait';
import { type HomeState } from './wrapping';

/** Requirement 3.4 of issue 3: a check every 5 seconds, so a change shows within two of them. */
export const CHANGE_BOUND_MS = 10_000;

/** The veil's fill in each scheme (requirement R3.2): the page's ground, `bg`, at part opacity. */
export const VEIL_FILL: Record<Scheme, string> = {
  light: 'oklch(0.972 0.005 85 / 0.75)',
  dark: 'oklch(0.185 0.012 252 / 0.8)',
};

/** The height of the window at a width: the phone's at 480 and below, else the desktop's. */
export function windowHeight(width: number): number {
  return width <= 480 ? 844 : 800;
}

// ---------------------------------------------------------------------------------------------------------------
// A page with the menu, in a context of its own.
// ---------------------------------------------------------------------------------------------------------------

export interface MenuPage {
  context: BrowserContext;
  page: Page;
  traffic: Traffic;
  /** How many other pages the browser has opened in this context since it was made (each closed at once). */
  opened: () => number;
}

export interface MenuPageOptions {
  width: number;
  /** A context with touch (`hasTouch`): taps and touch drags. */
  touch?: boolean;
  scheme?: Scheme;
}

/**
 * Opens a context of the same browser with the check's destination rule (`proxy`), English, the stored choice
 * `en` (so a press that changed the stored language would show), owned by `ctx`, and a page in it whose traffic is
 * recorded. Any page the browser opens besides it is counted and closed.
 */
export async function menuPage(
  ctx: Ctx,
  browser: Browser,
  proxy: BrowserContextOptions['proxy'],
  studio: StudioServer,
  options: MenuPageOptions,
): Promise<MenuPage> {
  const context = await browser.newContext({
    proxy,
    baseURL: studio.origin,
    locale: 'en-US',
    colorScheme: options.scheme ?? 'light',
    viewport: { width: options.width, height: windowHeight(options.width) },
    hasTouch: options.touch ?? false,
    serviceWorkers: 'block',
    storageState: {
      cookies: [],
      origins: [{ origin: studio.origin, localStorage: [{ name: STORAGE_KEY, value: 'en' }] }],
    },
  });
  ctx.own({ dispose: () => context.close() });
  const page = await context.newPage();
  const traffic = Traffic.attach(ctx, context, page);
  let opened = 0;
  context.on('page', (other) => {
    if (other === page) return;
    opened++;
    ctx.log(`the browser opened another page: ${other.url()}`);
    void other.close().catch(() => undefined);
  });
  ctx.log(`context: en-US, stored en, ${String(options.width)} wide, touch ${String(options.touch ?? false)}`);
  return { context, page, traffic, opened: () => opened };
}

/** Moves the stack into `state`: the check's own emulator stopped, then the engine stopped. */
export async function enterState(ctx: Ctx, stack: Stack, state: HomeState): Promise<void> {
  if (state === 'emulator stopped') {
    await stack.emulator!.stop();
    ctx.log(`own emulator on port ${String(stack.emulatorPort)} stopped: Home is "emulator stopped"`);
  }
  if (state === 'engine unreachable') {
    await stack.engine.stop();
    ctx.log('engine stopped: Home is "engine unreachable"');
  }
}

/**
 * Opens `/` and waits until Home shows `state` in its "Connection" rows: both "Connected"; the Emulator row "Not
 * started"; the Engine row "Unreachable". Throws, naming the rows it saw, after 10 seconds.
 */
export async function showHome(page: Page, state: HomeState): Promise<void> {
  await page.goto('/');
  const wanted = (v: Awaited<ReturnType<typeof connectionView>>) => {
    if (state === 'connected') return v.engine?.status === 'Connected' && v.emulator?.status === 'Connected';
    if (state === 'emulator stopped') return v.emulator?.status === 'Not started';
    return v.engine?.status === 'Unreachable';
  };
  let last = '';
  const seen = await waitFor(CHANGE_BOUND_MS, async () => {
    const v = await connectionView(page);
    last = `engine ${String(v.engine?.status)}, emulator ${String(v.emulator?.status)}`;
    return wanted(v) ? true : undefined;
  });
  if (!seen) throw new Error(`Home does not show "${state}" within 10s (${last})`);
  await settled(page);
}

/** Opens `path` of the AWS area and waits until the area shows its `h1` named `h1`. */
export async function openArea(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await page.getByRole('heading', { level: 1, name: h1, exact: true }).waitFor({ state: 'visible', ...ACTION });
  await settled(page);
}

// ---------------------------------------------------------------------------------------------------------------
// Presses at a point.
// ---------------------------------------------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export type PressKind = 'click' | 'tap' | 'middle' | 'secondary';

function at(p: Point): string {
  return `(${p.x.toFixed(0)},${p.y.toFixed(0)})`;
}

/**
 * Brings `target` into the window as "Press <element>" says (support words above) and returns the points of its box
 * where it is on top, nearest to its centre first. The menu must be closed. Throws when the element is not on the
 * page or is on top nowhere in the window.
 */
export async function aim(page: Page, target: Locator, name: string): Promise<Point[]> {
  if ((await target.count()) === 0) throw new Error(`${name} is not on the page`);
  const bar = await frame(page).banner.elementHandle(ACTION);
  const points = await target.first().evaluate(
    (el, b) => {
      const inBar = b !== null && b.contains(el);
      if (!inBar) {
        const r = el.getBoundingClientRect();
        let scroller: Element | null = el.parentElement;
        while (scroller && scroller !== document.documentElement) {
          const cs = getComputedStyle(scroller);
          if (/auto|scroll/.test(cs.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
          scroller = scroller.parentElement;
        }
        const by = r.top + r.height / 2 - innerHeight * 0.85;
        if (!scroller || scroller === document.documentElement) window.scrollBy(0, by);
        else scroller.scrollBy(0, by);
      }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const found: { x: number; y: number }[] = [];
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 2; j++) {
          const x = r.left + 2 + ((r.width - 4) * i) / 8;
          const y = r.top + 2 + ((r.height - 4) * j) / 2;
          if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
          const top = document.elementFromPoint(x, y);
          if (top !== null && (top === el || el.contains(top))) found.push({ x, y });
        }
      }
      return found.sort((a, c) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(c.x - cx, c.y - cy));
    },
    bar,
    ACTION,
  );
  await settled(page);
  if (points.length === 0) throw new Error(`${name} is on top nowhere in the window`);
  return points;
}

/** The box of the open menu, as left, top, right, bottom. Throws when the menu is not open. */
export async function menuBox(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  if ((await languageMenu(page).count()) === 0) throw new Error('the menu is not open');
  return languageMenu(page).evaluate((m) => {
    const r = m.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, ACTION);
}

/** Of `points`, the first that is not inside the open menu's box (2px around it included). */
export async function outsideMenu(page: Page, points: Point[], name: string): Promise<Point> {
  const m = await menuBox(page);
  const p = points.find((q) => q.x < m.left - 2 || q.x > m.right + 2 || q.y < m.top - 2 || q.y > m.bottom + 2);
  if (!p) throw new Error(`no point of ${name} lies outside the open menu`);
  return p;
}

/** Presses at `p` with `kind` and waits until the page is drawn again. */
export async function pressAt(page: Page, kind: PressKind, p: Point): Promise<void> {
  if (kind === 'tap') await page.touchscreen.tap(p.x, p.y);
  else if (kind === 'click') await page.mouse.click(p.x, p.y);
  else if (kind === 'middle') await page.mouse.click(p.x, p.y, { button: 'middle' });
  else await page.mouse.click(p.x, p.y, { button: 'right' });
  await settled(page);
}

/**
 * A finger put down at `from`, moved `dy` pixels up in ten steps and lifted: a scroll gesture, which ends without a
 * click. Sent as touch input through the DevTools protocol (`Input.dispatchTouchEvent`), as a touch screen sends it.
 */
export async function touchDrag(page: Page, from: Point, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x, y: from.y - (dy * i) / 10 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
  await scrollSettled(page);
}

/**
 * Waits until the page's scroll position, and that of every element, has stayed the same for ten frames in a row
 * (a fling after a touch drag goes on after the finger is lifted), at most the bound of an action. Throws when it
 * does not.
 */
export async function scrollSettled(page: Page): Promise<void> {
  const still = await page.evaluate(async (bound) => {
    const read = () => {
      let sum = scrollX * 7 + scrollY;
      for (const el of document.querySelectorAll('*')) sum += el.scrollTop * 3 + el.scrollLeft;
      return sum;
    };
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const end = performance.now() + bound;
    let last = read();
    let same = 0;
    while (performance.now() < end) {
      await frame();
      const now = read();
      same = now === last ? same + 1 : 0;
      last = now;
      if (same >= 10) return true;
    }
    return false;
  }, ACTION.timeout);
  if (!still) throw new Error('the page was still scrolling after 10s');
  await settled(page);
}

/** Opens the menu with a press on the control's centre (`tap` or `click`) and waits until it is shown. */
export async function openMenuBy(page: Page, kind: 'tap' | 'click'): Promise<void> {
  const control = languageControl(page);
  if ((await control.count()) === 0) throw new Error('the language control is not on the page');
  const box = await control.boundingBox(ACTION);
  if (!box) throw new Error('the language control is not drawn');
  await pressAt(page, kind, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await languageMenu(page).waitFor({ state: 'visible', ...ACTION });
  await settled(page);
}

/** Whether the menu is closed within the bound of an action: it is no longer on the page or no longer shown. */
export async function menuClosed(page: Page): Promise<boolean> {
  return languageMenu(page)
    .waitFor({ state: 'hidden', ...ACTION })
    .then(() => true)
    .catch(() => false);
}

/** Whether keyboard focus is on the control. */
export async function focusOnControl(page: Page): Promise<boolean> {
  const control = languageControl(page);
  if ((await control.count()) !== 1) return false;
  return control.evaluate((el) => el === document.activeElement, undefined, ACTION).catch(() => false);
}

/** What the active element is, for a log line. */
export async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return 'nothing';
    const label = a.getAttribute('aria-label') ?? (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${a.tagName.toLowerCase()} "${label}"`;
  });
}

/** The page's path. */
export function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

/** The stored choice and the language of the page (`html`'s `lang`). */
export async function languageNow(page: Page): Promise<{ stored: string | null; lang: string | null }> {
  return { stored: await storedChoice(page), lang: await page.locator('html').getAttribute('lang') };
}

/** Whether `target` is on top at `p`, so a press there reaches it. */
export async function onTopAt(target: Locator, p: Point): Promise<boolean> {
  if ((await target.count()) === 0) return false;
  return target.first().evaluate(
    (el, q) => {
      const top = document.elementFromPoint(q.x, q.y);
      return top !== null && (top === el || el.contains(top));
    },
    p,
    ACTION,
  );
}

/**
 * "Press it again" (support words above): the same press at `p`, made only while `target` is on top there. Returns
 * the problem, or `null` when the press was made.
 */
export async function pressAgain(page: Page, kind: PressKind, target: Locator, p: Point, name: string) {
  if (!(await onTopAt(target, p))) {
    return `${name} is not on top at ${at(p)} to be pressed again (the path is ${pathOf(page)})`;
  }
  await pressAt(page, kind, p);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The veil.
// ---------------------------------------------------------------------------------------------------------------

/** What is on top at one point of the window. */
export interface PointMeets {
  name: string;
  x: number;
  y: number;
  /** `veil`, `menu`, `page` (an element that was there before the menu opened, or of the area), or `nothing`. */
  kind: 'veil' | 'menu' | 'page' | 'nothing';
  what: string;
}

/** What the veil of the open menu is, read from its computed style. */
export interface VeilLook {
  what: string;
  background: string;
  /** The background drawn into a canvas pixel, and the colour asked for, as 8-bit RGBA. */
  drawn: number[];
  wanted: number[];
  boxShadow: string;
  borders: string[];
  transitionProperty: string;
  transitionDuration: string;
  transitionDelay: string;
  animationName: string;
  animations: number;
  text: string;
  generated: string[];
  role: string | null;
  named: string[];
  focusable: string[];
  insideArea: boolean;
}

interface MenuProbe {
  before: WeakSet<Element>;
  veil: Element | null;
}

/**
 * Remembers every element of the document, so what is added when the menu opens can be told from the page. Call it
 * with the menu closed, right before opening it.
 */
export async function markElements(page: Page): Promise<void> {
  await areaRootLang(page);
  await page.evaluate(() => {
    const w = window as unknown as { __emuforgeItMenu?: MenuProbe };
    w.__emuforgeItMenu = { before: new WeakSet(document.querySelectorAll('*')), veil: null };
  });
}

/**
 * With the menu open: what is on top at each point of requirement R3.1 (support words above). The box under the bar
 * is from the bar's bottom edge to the window's bottom, from its left edge to its right; its points are the one just
 * under the bar at the window's centre, the box's four corners, each 1px inside it, and the one just under the
 * menu's centre. The veil found just under the bar is kept for `veilLook`.
 */
export async function pointsUnderBar(page: Page): Promise<PointMeets[]> {
  const bar = await frame(page).banner.elementHandle(ACTION);
  return page.evaluate((b) => {
    const w = window as unknown as {
      __emuforgeItMenu?: MenuProbe;
      __emuforgeItLang?: { areaRoot: () => Element | null };
    };
    const probe = w.__emuforgeItMenu;
    if (!probe) throw new Error('the page was not marked before the menu opened');
    const menu = document.querySelector('[role="menu"]');
    if (!b || !menu) throw new Error('no bar or no open menu');
    const area = w.__emuforgeItLang ? w.__emuforgeItLang.areaRoot() : null;
    const describe = (el: Element | null) => {
      if (!el) return 'nothing';
      const cls =
        typeof el.className === 'string' && el.className !== ''
          ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
          : '';
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}${cls}${text !== '' ? ` "${text}"` : ''}`;
    };
    const classify = (el: Element | null): 'veil' | 'menu' | 'page' | 'nothing' => {
      if (!el) return 'nothing';
      if (menu.contains(el)) return 'menu';
      if (area && area.contains(el)) return 'page';
      if (!probe.before.has(el) && !(el instanceof SVGElement)) return 'veil';
      return 'page';
    };
    const br = b.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    const top = br.bottom + 1;
    const points: [string, number, number][] = [
      ['just under the bar', innerWidth / 2, top],
      ['the top left corner', 1, top],
      ['the top right corner', innerWidth - 1, top],
      ['the bottom left corner', 1, innerHeight - 1],
      ['the bottom right corner', innerWidth - 1, innerHeight - 1],
      ['just under the menu', mr.left + mr.width / 2, Math.min(mr.bottom + 1, innerHeight - 1)],
    ];
    const out = points.map(([name, x, y]) => {
      const el = document.elementFromPoint(x, y);
      return { name, x, y, kind: classify(el), what: describe(el) };
    });
    const first = document.elementFromPoint(points[0][1], points[0][2]);
    probe.veil = classify(first) === 'veil' ? first : null;
    return out;
  }, bar);
}

/** The problems of `points` against "meets `wanted`", one line each, prefixed with `where`. */
export function pointProblems(points: PointMeets[], wanted: PointMeets['kind'], where: string): string[] {
  return points
    .filter((p) => p.kind !== wanted)
    .map((p) => `${where}: ${p.name} ${at(p)} meets the ${p.kind}, not the ${wanted}: ${p.what}`);
}

/** The look of the veil `pointsUnderBar` found last; `null` when it found none. `fill` is the colour asked for. */
export async function veilLook(page: Page, fill: string): Promise<VeilLook | null> {
  return page.evaluate((wantedFill) => {
    const w = window as unknown as {
      __emuforgeItMenu?: MenuProbe;
      __emuforgeItLang?: { areaRoot: () => Element | null };
    };
    const el = w.__emuforgeItMenu?.veil ?? null;
    if (!el || !el.isConnected) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const g = canvas.getContext('2d')!;
    const draw = (css: string) => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = 'rgb(1 2 3 / 0.5)';
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data];
    };
    const cs = getComputedStyle(el);
    const generated = ['::before', '::after']
      .map((p) => [p, getComputedStyle(el, p).content] as const)
      .filter(([, c]) => c !== 'none' && c !== 'normal')
      .map(([p, c]) => `${p} ${c}`);
    const focusable = [el, ...el.querySelectorAll('*')]
      .filter(
        (e) =>
          (e as HTMLElement).tabIndex >= 0 ||
          (e as HTMLElement).isContentEditable ||
          e.matches('a[href], button, input, select, textarea, iframe, summary'),
      )
      .map((e) => e.tagName.toLowerCase());
    const named = ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-description', 'title', 'alt'].filter(
      (a) => el.hasAttribute(a),
    );
    const area = w.__emuforgeItLang ? w.__emuforgeItLang.areaRoot() : null;
    const cls =
      typeof el.className === 'string' && el.className !== ''
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
    return {
      what: `${el.tagName.toLowerCase()}${cls}`,
      background: cs.backgroundColor,
      drawn: draw(cs.backgroundColor),
      wanted: draw(wantedFill),
      boxShadow: cs.boxShadow,
      borders: ['top', 'right', 'bottom', 'left'].map(
        (s) => `${s} ${cs.getPropertyValue(`border-${s}-width`)} ${cs.getPropertyValue(`border-${s}-style`)}`,
      ),
      transitionProperty: cs.transitionProperty,
      transitionDuration: cs.transitionDuration,
      transitionDelay: cs.transitionDelay,
      animationName: cs.animationName,
      animations: el.getAnimations({ subtree: true }).length,
      text: (el.textContent ?? '').trim(),
      generated,
      role: el.getAttribute('role'),
      named,
      focusable,
      insideArea: area !== null && area.contains(el),
    };
  }, fill);
}

/** Whether two 8-bit RGBA colours are within 2 of each other in every channel. */
export function sameColour(a: number[], b: number[]): boolean {
  return a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) <= 2);
}

/** The problems of a border: any side with a width above 0 and a style other than `none` or `hidden`. */
export function borderProblems(borders: string[]): string[] {
  return borders.filter((b) => {
    const [, width, style] = b.split(' ');
    return parseFloat(width) > 0 && style !== 'none' && style !== 'hidden';
  });
}

/** Whether a computed transition makes no transition: no property, or every duration and delay 0s. */
export function noTransition(property: string, duration: string, delay: string): boolean {
  if (property.trim() === 'none') return true;
  const zero = (list: string) => list.split(',').every((v) => parseFloat(v) === 0);
  return zero(duration) && zero(delay);
}

/** The menu's box, fill and edge against the tokens of Studio's own layer (requirement R3.5). */
export interface MenuLook {
  box: { left: number; top: number; right: number; bottom: number; width: number };
  /** The bar's box and its padding: the gutter of the bar's content. */
  bar: { left: number; right: number; bottom: number; paddingLeft: number; paddingRight: number };
  fill: { drawn: number[]; wanted: number[]; computed: string };
  edge: { widths: string[]; styles: string[]; drawn: number[][]; wanted: number[] };
  boxShadow: string;
}

/** Reads the open menu's box, its fill against `--st-surface`, its edge against `--st-control-line`. */
export async function menuLook(page: Page): Promise<MenuLook> {
  if ((await languageMenu(page).count()) === 0) throw new Error('the menu is not open');
  const bar = await frame(page).banner.elementHandle(ACTION);
  return languageMenu(page).evaluate(
    (menu, b) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const g = canvas.getContext('2d')!;
      const draw = (css: string) => {
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = 'rgb(1 2 3 / 0.5)';
        g.fillStyle = css;
        g.fillRect(0, 0, 1, 1);
        return [...g.getImageData(0, 0, 1, 1).data];
      };
      const cs = getComputedStyle(menu);
      const r = menu.getBoundingClientRect();
      const br = b ? b.getBoundingClientRect() : r;
      const bcs = b ? getComputedStyle(b) : cs;
      const sides = ['top', 'right', 'bottom', 'left'];
      return {
        box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
        bar: {
          left: br.left,
          right: br.right,
          bottom: br.bottom,
          paddingLeft: parseFloat(bcs.paddingLeft),
          paddingRight: parseFloat(bcs.paddingRight),
        },
        fill: {
          drawn: draw(cs.backgroundColor),
          wanted: draw(cs.getPropertyValue('--st-surface').trim()),
          computed: cs.backgroundColor,
        },
        edge: {
          widths: sides.map((s) => cs.getPropertyValue(`border-${s}-width`)),
          styles: sides.map((s) => cs.getPropertyValue(`border-${s}-style`)),
          drawn: sides.map((s) => draw(cs.getPropertyValue(`border-${s}-color`))),
          wanted: draw(cs.getPropertyValue('--st-control-line').trim()),
        },
        boxShadow: cs.boxShadow,
      };
    },
    bar,
    ACTION,
  );
}

/** Whether the element `locator` finds is on top at its own centre; else what is. */
export async function coveredAtCentre(locator: Locator): Promise<string | null> {
  if ((await locator.count()) === 0) return 'it is not on the page';
  return locator.first().evaluate(
    (el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top !== null && (top === el || el.contains(top))) return null;
      return top ? `${top.tagName.toLowerCase()} "${(top.textContent ?? '').trim().slice(0, 30)}"` : 'nothing';
    },
    undefined,
    ACTION,
  );
}

/** Where the page's `h1` and its first panel are, and the scroll position, as one comparable line. */
export async function pagePlace(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const h1 = main?.querySelector('h1') ?? null;
    // The first panel: the first element of the page, after its `h1`, that draws an edge on all four sides and is
    // taller than a control.
    const panel =
      [...(main?.querySelectorAll('*') ?? [])].find((el) => {
        if (h1 && !(h1.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        const cs = getComputedStyle(el);
        const edged = ['Top', 'Right', 'Bottom', 'Left'].every(
          (s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)) > 0,
        );
        return edged && el.getBoundingClientRect().height > 60;
      }) ?? null;
    const box = (el: Element | null) => {
      if (!el) return 'none';
      const r = el.getBoundingClientRect();
      return `${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`;
    };
    return `h1 ${box(h1)}; first panel ${box(panel)}; scroll ${String(scrollX)},${String(scrollY)}`;
  });
}

/**
 * The accessibility tree of the page (`body`'s ARIA snapshot) with the menu's subtree taken out and the control's
 * expanded state dropped, so the tree with the menu open can be compared with the tree with it closed.
 */
export async function treeWithoutMenu(page: Page): Promise<string[]> {
  const snapshot = await page.locator('body').ariaSnapshot(ACTION);
  const name = (await languageControl(page).getAttribute('aria-label', ACTION)) ?? '';
  const lines = snapshot.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const menu = /^(\s*)- menu\b/.exec(line);
    if (menu) {
      const indent = menu[1].length;
      while (i + 1 < lines.length && (/^(\s*)/.exec(lines[i + 1])?.[1].length ?? 0) > indent) i++;
      continue;
    }
    out.push(line.includes(`"${name}"`) ? line.replace(/ \[expanded(=\w+)?\]/, '') : line);
  }
  return out;
}

/**
 * The elements added inside the AWS area's root since `markElements` that carry no Cloudscape class: elements of
 * Studio's own inside the area. Empty without an area.
 */
export async function studioInArea(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __emuforgeItMenu?: MenuProbe;
      __emuforgeItLang?: { areaRoot: () => Element | null };
    };
    const area = w.__emuforgeItLang ? w.__emuforgeItLang.areaRoot() : null;
    const before = w.__emuforgeItMenu?.before;
    if (!area || !before) return [];
    return [...area.querySelectorAll('*')]
      .filter((el) => !before.has(el))
      .filter((el) => {
        for (let a: Element | null = el; a && a !== area; a = a.parentElement) {
          if ([...a.classList].some((c) => c.startsWith('awsui'))) return false;
        }
        return true;
      })
      .slice(0, 10)
      .map((el) => el.tagName.toLowerCase());
  });
}
