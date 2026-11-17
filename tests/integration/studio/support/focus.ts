// Where focus is and what a focus move changes on screen (requirement R4, issue 19; test-criteria.md, issue 19,
// Integration checks), read from the page the way a keyboard and a screen reader user meets it. Used by
// `focus.spec.ts`.
//
// - The content target of a page (R4) is checked on the focused element by one helper, `targetProblems`: form (a),
//   the page's `h1` itself, or form (b), an element that holds the `h1` and the page's first content stop, whose role
//   takes a name and that is named by the `h1` through `aria-labelledby`; inside the page's one `main` or that `main`;
//   no `nav` element or `navigation` landmark, holding none, and none between it and the first content stop in
//   document order; its accessible name, as the browser's accessibility tree computes it, the `h1`'s text; not a Tab
//   stop; no focus ring (computed outline style `none` or width 0).
// - The first content stop the structural part names is the first Tab stop after the target in document order (no
//   page of Studio sets a positive `tabindex`); the checks also press Tab and read what the browser focused.
// - A name is the browser's: the role and name of the focused element's node in Chromium's accessibility tree (CDP
//   `Accessibility.getPartialAXTree`), not attributes read by the check.

import type { CDPSession, Locator, Page } from '@playwright/test';

import { connectedAt, expectLine } from './aws-area';
import { expect } from './check';
import { ACTION, BREADCRUMB_GROUP, SIDE_NAVIGATION } from './frame';

/** The bound within which a focus move that follows a render (a route change, an area that loads) is awaited. */
export const FOCUS_BOUND = 5_000;

// ---------------------------------------------------------------------------------------------------------------
// The probe: installed in the page's current document before each call (again after every load).
// ---------------------------------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __emuforgeFocus?: Record<string, (...args: any[]) => unknown>;
    __emuforgeFocusMoves?: string[];
  }
}

function installProbe(selectors: { sideNavigation: string; breadcrumbs: string }): void {
  if (window.__emuforgeFocus) return;
  const TABBABLE =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable=""], [contenteditable="true"], [tabindex]';
  const NAVIGATION = 'nav, [role~="navigation"]';
  const MAIN = 'main, [role~="main"]';
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el: Element) =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible' && !el.closest('[inert]');
  const textOf = (el: Element) => norm(el.getAttribute('aria-label') ?? (el as HTMLElement).innerText);
  const describe = (el: Element | null): string => {
    if (el === null) return 'nothing';
    if (el === document.body) return 'body';
    const id = el.id ? `#${el.id}` : '';
    const cls = [...el.classList][0];
    const role = el.getAttribute('role');
    return `${el.tagName.toLowerCase()}${id}${cls ? `.${cls}` : ''}${role ? `[role=${role}]` : ''} "${textOf(el).slice(0, 50)}"`;
  };
  const tabStops = () =>
    [...document.querySelectorAll(TABBABLE)].filter(
      (el) => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && visible(el),
    );
  const mains = () => [...document.querySelectorAll(MAIN)].filter(visible);
  const h1s = () => [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')].filter(visible);
  const drawsOutline = (cs: CSSStyleDeclaration) => {
    if (cs.outlineStyle === 'none' || !(parseFloat(cs.outlineWidth) > 0)) return false;
    const c = cs.outlineColor.replace(/\s+/g, '');
    return c !== 'transparent' && !/^rgba\(\d+,\d+,\d+,0\)$/.test(c);
  };
  /** Splits a selector list or a box-shadow list at its top-level commas. */
  const splitTop = (s: string) => {
    const parts: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      else if (s[i] === ',' && depth === 0) {
        parts.push(s.slice(from, i).trim());
        from = i + 1;
      }
    }
    parts.push(s.slice(from).trim());
    return parts.filter((p) => p !== '');
  };
  /** The first shadow of a computed `box-shadow` that is a seen ring: a non-transparent color, a spread above 0. */
  const seenShadow = (boxShadow: string) => {
    if (boxShadow === 'none') return null;
    for (const shadow of splitTop(boxShadow)) {
      const color = /rgba?\([^)]*\)/.exec(shadow)?.[0].replace(/\s+/g, '') ?? '';
      if (color === '' || color === 'transparent' || /^rgba\(\d+,\d+,\d+,0\)$/.test(color)) continue;
      const lengths = shadow
        .replace(/rgba?\([^)]*\)/, '')
        .split(/\s+/)
        .filter((t) => /^-?[\d.]+px$/.test(t))
        .map(parseFloat);
      if ((lengths[3] ?? 0) > 0) return shadow;
    }
    return null;
  };
  /** Every selector of the document's style rules that sets an outline or a box shadow and names a focus state. */
  const focusSelectors = () => {
    const found: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of [...rules]) {
        if (rule instanceof CSSStyleRule) {
          const s = rule.style;
          const draws = s.boxShadow !== '' || s.outline !== '' || s.outlineStyle !== '' || s.outlineColor !== '';
          if (draws && rule.selectorText.includes(':focus')) found.push(...splitTop(rule.selectorText));
        }
        if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of [...document.styleSheets]) {
      try {
        walk(sheet.cssRules);
      } catch {
        // A sheet of another origin cannot be read; Studio serves its own styles.
      }
    }
    return found;
  };
  /** Whether a focus selector that `pick` accepts matches `el` now (after `pseudo` is taken off its end). */
  const focusRuleMatches = (selectors: string[], el: Element, pick: (part: string) => boolean, pseudo: string) =>
    selectors.filter(pick).some((part) => {
      const base = pseudo === '' ? part : part.slice(0, -pseudo.length).replace(/:$/, '');
      try {
        return el.matches(base);
      } catch {
        return false;
      }
    });
  /** The page's first content stop by name: the first visible Tab stop inside the page's `main`, outside every navigation. */
  const contentStop = (name: string) =>
    tabStops().find((el) => textOf(el) === name && !el.closest(NAVIGATION) && el.closest(MAIN) !== null) ?? null;
  const docBox = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  };

  window.__emuforgeFocus = {
    /** The structural properties of R4's content target, on the focused element. */
    target(firstStop: string) {
      const el = document.activeElement;
      const problems: string[] = [];
      const onBody = el === null || el === document.body || el === document.documentElement;
      const pageMains = mains();
      const pageH1s = h1s();
      const h1 = pageH1s.length === 1 ? pageH1s[0] : null;
      if (pageMains.length !== 1) problems.push(`the page has ${String(pageMains.length)} main landmarks, not one`);
      if (pageH1s.length !== 1) problems.push(`the page has ${String(pageH1s.length)} h1, not one`);
      if (onBody || el === null) {
        return { focused: describe(el), onBody: true, h1: h1 ? norm(h1.textContent) : null, problems };
      }
      if (pageMains.length === 1 && !pageMains[0].contains(el)) problems.push('it is not inside the page’s main');
      let form: 'a' | 'b' | null = null;
      if (h1 !== null && el === h1) form = 'a';
      else if (h1 !== null && el.contains(h1)) {
        const ids = norm(el.getAttribute('aria-labelledby')).split(' ');
        if (h1.id !== '' && ids.includes(h1.id)) form = 'b';
        else problems.push('it holds the h1 but is not named by it through aria-labelledby');
      } else problems.push('it is neither the page’s h1 nor an element that holds it');
      if (el.matches(NAVIGATION)) problems.push('it is a navigation landmark');
      if (el.closest(NAVIGATION) !== null && !el.matches(NAVIGATION))
        problems.push('it is inside a navigation landmark');
      const held = [...el.querySelectorAll(NAVIGATION)];
      if (held.length > 0)
        problems.push(`it holds ${String(held.length)} navigation landmarks: ${held.map(describe).join(', ')}`);
      if ((el as HTMLElement).tabIndex >= 0)
        problems.push(`it is a Tab stop (tabIndex ${String((el as HTMLElement).tabIndex)})`);
      const cs = getComputedStyle(el);
      if (drawsOutline(cs))
        problems.push(`it draws a focus ring: outline ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`);
      const next =
        tabStops().find((stop) => stop !== el && (el.compareDocumentPosition(stop) & FOLLOWING) !== 0) ?? null;
      if (next === null) problems.push('no Tab stop follows it');
      else {
        if (textOf(next) !== firstStop) {
          problems.push(`the first Tab stop after it is ${describe(next)}, not "${firstStop}"`);
        }
        const between = [...document.querySelectorAll(NAVIGATION)].filter(
          (nav) =>
            !held.includes(nav) &&
            (el.compareDocumentPosition(nav) & FOLLOWING) !== 0 &&
            (nav.compareDocumentPosition(next) & FOLLOWING) !== 0,
        );
        if (between.length > 0) {
          problems.push(
            `navigation landmarks lie between it and its first Tab stop: ${between.map(describe).join(', ')}`,
          );
        }
        if (form === 'b' && !el.contains(next)) problems.push('it holds the h1 but not the first content stop');
      }
      return { focused: describe(el), onBody: false, form, h1: h1 ? norm(h1.textContent) : null, problems };
    },

    /** Where the focused element is: in a navigation, the side navigation, the breadcrumbs, the page's main. */
    stop() {
      const el = document.activeElement;
      if (el === null || el === document.body || el === document.documentElement) return null;
      return {
        describe: describe(el),
        inNavigation: el.closest(NAVIGATION) !== null,
        inSideNavigation: el.closest(selectors.sideNavigation) !== null,
        inBreadcrumbs: el.closest(selectors.breadcrumbs) !== null,
        inMain: el.closest(MAIN) !== null,
      };
    },

    /**
     * The focus indicator the focused element draws; `null` when it draws none. First its own outline, or a box
     * shadow (as before issue 56). Then, as `::before …`, `::after …` or `wrapper <element> …`, a ring that a focus
     * style rule draws for it (issue 56, decision of 2026-11-17 16:20): on its `::before` or `::after`, by a rule
     * whose selector has `:focus` and matches it now, or on its nearest wrapper that holds no other Tab stop, by a
     * rule whose selector has `:focus-within` and matches that wrapper now. Such a ring must be seen: a
     * non-transparent outline of width above 0, or a non-transparent box shadow with a spread above 0.
     */
    ring() {
      const el = document.activeElement;
      if (el === null || el === document.body) return null;
      const cs = getComputedStyle(el);
      if (drawsOutline(cs)) return `outline ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
      if (cs.boxShadow !== 'none') return `box-shadow ${cs.boxShadow}`;
      const seen = (style: CSSStyleDeclaration) => {
        if (drawsOutline(style)) return `outline ${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`;
        const shadow = seenShadow(style.boxShadow);
        return shadow === null ? null : `box-shadow ${shadow}`;
      };
      const selectors = focusSelectors();
      for (const which of ['::before', '::after'] as const) {
        if (!focusRuleMatches(selectors, el, (part) => part.includes(':focus') && part.endsWith(which), which))
          continue;
        const ps = getComputedStyle(el, which);
        if (ps.content === 'none' || ps.display === 'none' || ps.visibility !== 'visible') continue;
        const drawn = seen(ps);
        if (drawn !== null) return `${which} ${drawn}`;
      }
      const others = tabStops().filter((stop) => stop !== el);
      for (
        let wrapper = el.parentElement;
        wrapper !== null && wrapper !== document.body;
        wrapper = wrapper.parentElement
      ) {
        const around = wrapper;
        if (others.some((stop) => around.contains(stop))) break;
        if (
          !focusRuleMatches(
            selectors,
            wrapper,
            (part) => part.includes(':focus-within') && !/::?(before|after)$/.test(part),
            '',
          )
        )
          continue;
        const drawn = seen(getComputedStyle(wrapper));
        if (drawn !== null) return `wrapper ${describe(wrapper)} ${drawn}`;
      }
      return null;
    },

    /** Every element that draws an outline (at most 10 listed). */
    outlined() {
      return [...document.querySelectorAll('*')]
        .filter((el) => drawsOutline(getComputedStyle(el)))
        .slice(0, 10)
        .map((el) => {
          const cs = getComputedStyle(el);
          return `${describe(el)}: outline ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
        });
    },

    /** The `h1` and the first content stop named `firstStop`, in the document. */
    places(firstStop: string) {
      const h1 = h1s()[0] ?? null;
      const stop = contentStop(firstStop);
      return { h1: h1 ? docBox(h1) : null, firstStop: stop ? docBox(stop) : null };
    },

    /** The live regions of the document, as `tag role aria-live`, sorted. */
    live() {
      return [...document.querySelectorAll('[aria-live], [role~="status"], [role~="alert"], [role~="log"]')]
        .map(
          (el) =>
            `${el.tagName.toLowerCase()} role=${el.getAttribute('role') ?? '-'} aria-live=${el.getAttribute('aria-live') ?? '-'}`,
        )
        .sort();
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SELECTORS = { sideNavigation: SIDE_NAVIGATION, breadcrumbs: BREADCRUMB_GROUP };

async function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  await page.evaluate(installProbe, SELECTORS);
  return (await page.evaluate(([fn, list]) => window.__emuforgeFocus![fn as string](...(list as unknown[])), [
    name,
    args,
  ] as const)) as T;
}

// ---------------------------------------------------------------------------------------------------------------
// The browser's accessibility tree.
// ---------------------------------------------------------------------------------------------------------------

const sessions = new WeakMap<Page, CDPSession>();

async function cdpOf(page: Page): Promise<CDPSession> {
  let session = sessions.get(page);
  if (session === undefined) {
    session = await page.context().newCDPSession(page);
    sessions.set(page, session);
  }
  return session;
}

/** The role and name Chromium's accessibility tree gives the focused element; `null` when nothing but `body` has focus. */
export async function focusedAx(page: Page): Promise<{ role: string; name: string } | null> {
  const cdp = await cdpOf(page);
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'document.activeElement === document.body ? null : document.activeElement',
  });
  if (result.objectId === undefined) return null;
  try {
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      objectId: result.objectId,
      fetchRelatives: false,
    });
    const node = nodes[0];
    if (node === undefined) return { role: '', name: '' };
    const value = (v: { value?: unknown } | undefined) =>
      String(v?.value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return { role: value(node.role), name: value(node.name) };
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The content target.
// ---------------------------------------------------------------------------------------------------------------

/** Roles whose name cannot be given by an author (ARIA 1.2, "prohibited"), and Chromium's names for no role. */
const UNNAMED_ROLES = new Set([
  '',
  'none',
  'generic',
  'presentation',
  'caption',
  'code',
  'deletion',
  'emphasis',
  'insertion',
  'paragraph',
  'strong',
  'subscript',
  'superscript',
  'StaticText',
]);

export interface TargetReport {
  /** The focused element, described; `body` when nothing else has focus. */
  focused: string;
  /** What keeps the focused element from being the content target named `name`; empty when it is. */
  problems: string[];
}

/**
 * Whether the focused element is the page's content target named `name` (R4), whose first content stop is
 * `firstStop`. Reads once; never waits.
 */
export async function targetProblems(page: Page, name: string, firstStop: string): Promise<TargetReport> {
  const facts = await call<{
    focused: string;
    onBody: boolean;
    form?: 'a' | 'b' | null;
    h1: string | null;
    problems: string[];
  }>(page, 'target', firstStop);
  if (facts.onBody)
    return {
      focused: facts.focused,
      problems: [`focus is on ${facts.focused}, not on a content target`, ...facts.problems],
    };
  const problems = [...facts.problems];
  const ax = await focusedAx(page);
  if (ax === null) problems.push('the accessibility tree has no node for it');
  else {
    if (ax.name !== name) problems.push(`its accessible name is "${ax.name}", not "${name}"`);
    if (facts.h1 !== null && ax.name !== facts.h1)
      problems.push(`its accessible name is not the h1's text "${facts.h1}"`);
    if (facts.form === 'b' && UNNAMED_ROLES.has(ax.role)) problems.push(`its role "${ax.role}" takes no name`);
  }
  if (facts.h1 !== null && facts.h1 !== name) problems.push(`the page's h1 is "${facts.h1}", not "${name}"`);
  return { focused: facts.focused, problems };
}

/**
 * Waits, within `FOCUS_BOUND`, until focus is on the content target named `name`, and returns what the last read
 * found. Never throws for a target that is not there; the caller asserts.
 */
export async function awaitTarget(page: Page, name: string, firstStop: string): Promise<TargetReport> {
  let last: TargetReport = { focused: 'nothing read', problems: ['not read'] };
  await expect
    .poll(
      async () => {
        last = await targetProblems(page, name, firstStop);
        return last.problems;
      },
      { timeout: FOCUS_BOUND },
    )
    .toEqual([])
    .catch(() => undefined);
  return last;
}

/** Asserts that focus is, or comes within `FOCUS_BOUND` to be, on the content target named `name`. */
export async function expectTarget(page: Page, name: string, firstStop: string): Promise<void> {
  const report = await awaitTarget(page, name, firstStop);
  expect(report.problems, `focus (${report.focused}) is on the content target named "${name}"`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------------------
// Tab stops.
// ---------------------------------------------------------------------------------------------------------------

export interface Stop {
  describe: string;
  /** The browser's role and accessible name of the focused element. */
  role: string;
  name: string;
  inNavigation: boolean;
  inSideNavigation: boolean;
  inBreadcrumbs: boolean;
  inMain: boolean;
}

/** The focused element as a Tab stop; `null` when focus is on `body`. */
export async function focusedStop(page: Page): Promise<Stop | null> {
  const where = await call<Omit<Stop, 'role' | 'name'> | null>(page, 'stop');
  if (where === null) return null;
  const ax = await focusedAx(page);
  return { ...where, role: ax?.role ?? '', name: ax?.name ?? '' };
}

/** Presses Tab (Shift+Tab with `back`) and returns what the browser focused. */
export async function pressTab(page: Page, back = false): Promise<Stop | null> {
  await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  return focusedStop(page);
}

export function describeStop(stop: Stop | null): string {
  return stop === null ? 'body' : `${stop.role} "${stop.name}" (${stop.describe})`;
}

/** Problems with `stop` as the page's first content stop named `name`: inside the page's main, in no navigation. */
export function contentStopProblems(stop: Stop | null, name: string): string[] {
  if (stop === null) return [`the Tab reached body, not "${name}"`];
  const problems: string[] = [];
  if (stop.name !== name) problems.push(`the Tab reached ${describeStop(stop)}, not "${name}"`);
  if (stop.inNavigation || stop.inSideNavigation || stop.inBreadcrumbs) {
    problems.push(`the Tab reached ${describeStop(stop)} in a navigation, not the page's content`);
  }
  if (!stop.inMain) problems.push(`the Tab reached ${describeStop(stop)} outside the page's main`);
  return problems;
}

/** Presses Tab and asserts it reached the page's first content stop named `name`. */
export async function expectNextContentStop(page: Page, name: string): Promise<void> {
  const stop = await pressTab(page);
  expect(contentStopProblems(stop, name), `the next Tab reaches "${name}"`).toEqual([]);
}

/**
 * The focus indicator the focused element draws: its own outline or box shadow, else a seen ring a focus rule draws
 * on its `::before` / `::after` or on its nearest wrapper under `:focus-within` (see the probe's `ring`); `null` when
 * none.
 */
export async function focusRing(page: Page): Promise<string | null> {
  return call(page, 'ring');
}

/** Every element of the document that draws an outline, described (at most 10). */
export async function outlinedElements(page: Page): Promise<string[]> {
  return call(page, 'outlined');
}

/** The live regions of the document, as `tag role aria-live`, sorted. */
export async function liveRegions(page: Page): Promise<string[]> {
  return call(page, 'live');
}

/** The live regions of `after` that `fresh` does not have, counted one for one. */
export function extraLiveRegions(after: string[], fresh: string[]): string[] {
  const left = [...fresh];
  return after.filter((region) => {
    const at = left.indexOf(region);
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Places.
// ---------------------------------------------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Places {
  /** The page's `h1`, in the document (its box plus the page's scroll offset). */
  h1: Box | null;
  /** The page's first content stop, in the document. */
  firstStop: Box | null;
  /** The frame's bar, in the viewport. */
  bar: Box | null;
}

/** Where the `h1`, the first content stop named `firstStop` and the frame's bar `bar` are now. */
export async function placesOf(page: Page, firstStop: string, bar: Locator): Promise<Places> {
  const inDocument = await call<Omit<Places, 'bar'>>(page, 'places', firstStop);
  return { ...inDocument, bar: await bar.boundingBox(ACTION) };
}

/** The parts of `b` that are not at the same place as in `a` (position and size within half a pixel). */
export function placeDiffers(a: Places, b: Places): string[] {
  const out: string[] = [];
  for (const part of ['h1', 'firstStop', 'bar'] as const) {
    const x = a[part];
    const y = b[part];
    if (x === null || y === null) {
      out.push(
        `${part}: ${x === null ? 'not found before' : 'found before'}, ${y === null ? 'not found after' : 'found after'}`,
      );
      continue;
    }
    const moved = (['x', 'y', 'width', 'height'] as const).filter((k) => Math.abs(x[k] - y[k]) > 0.5);
    if (moved.length > 0) out.push(`${part}: ${JSON.stringify(x)} became ${JSON.stringify(y)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// First loads.
// ---------------------------------------------------------------------------------------------------------------

/** From the next load on, records every element that takes focus in each document (`focusMoves`). */
export async function recordFocusMoves(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const moves: string[] = [];
    window.__emuforgeFocusMoves = moves;
    document.addEventListener(
      'focusin',
      (event) => {
        const el = event.target as Element | null;
        moves.push(
          el
            ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`
            : '?',
        );
      },
      true,
    );
  });
}

/** The elements that took focus in the current document since it loaded. */
export async function focusMoves(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__emuforgeFocusMoves ?? ['the recorder is not installed']);
}

/**
 * On a page of the AWS area (`path` under `/aws`), waits until the emulator line shows its first answer, "Connected at
 * <endpoint>" for the emulator on `emulatorPort`: the line's height is not fixed (issue 45, R4.7), so places on such
 * a page are read after it. Returns at once on any other page.
 */
export async function lineAnswered(page: Page, path: string, emulatorPort: number): Promise<void> {
  if (path !== '/aws' && !path.startsWith('/aws/')) return;
  await expectLine(page, connectedAt(emulatorPort));
}

/** Resolves once the page has drawn two more frames: effects of the last render have run. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** True when `locator` has focus now. */
export async function hasFocus(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el === document.activeElement, undefined, ACTION);
}
