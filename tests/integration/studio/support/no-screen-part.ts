// The AWS area's "no screen yet" page below a service that has screens, as a user meets it (test-criteria.md, issue
// 57, Flow checks; requirement R4): its words, the path it names, its crumbs, its side navigation and its actions, and
// the measures of the path's layout. Used by `aws-no-screen-part.spec.ts` and by the rewritten lines of
// `lambda-function-list.spec.ts` and `iam-role-screens.spec.ts`.
//
// - The words are the requirement's (R4.2, R4.5, R4.7), English, word for word. The page of a service without any
//   screen keeps its own words and is read by `expectNoScreenYet` of `frame.ts`, which this file leaves as it is.
// - The path is read as Cloudscape writes code text, a `code` element, the first after the label "Path" (Cloudscape's
//   key label) inside the page's `main` (R4.5). Its lines are read from the boxes the browser draws each character
//   in, so a line break is where the drawing breaks, whatever the markup.
// - The Cloudscape selectors made by `createWrapper()` start with `body `, so they are rooted at the page, never under
//   another locator.
//
// Every value a check compares with comes from the run or from the requirement: paths from the check's own prefix,
// nothing from Studio's source.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect } from './check';
import {
  ACTION,
  addressOf,
  BREADCRUMB_ITEMS,
  heading,
  inCloudscape,
  SIDE_NAVIGATION,
  SIDE_NAVIGATION_ACTIVE,
} from './frame';

// ---------------------------------------------------------------------------------------------------------------
// The words (R4.2, R4.5, R4.7).
// ---------------------------------------------------------------------------------------------------------------

/** The `h1`, the title reported to Studio's frame and the content target's name (R4.2). */
export const NO_SCREEN_PART_H1 = 'No screen yet';

/** The label above the path (R4.5). */
export const PATH_LABEL = 'Path';

/** The sentence after the path (R4.5). */
export const NOTHING_CHANGED = 'Opening this page changed nothing in your local emulator.';

/** The second action (R4.7). */
export const GO_HOME = 'Go to Home';

/** The statement for a part of the service `label` (R4.5). */
export function partStatement(label: string): string {
  return `Studio has no screen for this part of ${label} yet.`;
}

/** The sentence of the page of a service without any screen, which the changed page never says (R4.5, R5). */
export function serviceSentence(label: string): string {
  return `Studio has no screen for ${label} yet.`;
}

/** The first action, to the service's first screen titled `title` (R4.7). */
export function goTo(title: string): string {
  return `Go to ${title}`;
}

/** The services the flow checks open, with their label, crumb and first screen (R4.1). */
export const PART_SERVICES = {
  s3: {
    label: 'Amazon Simple Storage Service',
    crumb: 'S3',
    first: 'Buckets',
    firstPath: '/aws/s3',
  },
  lambda: {
    label: 'AWS Lambda',
    crumb: 'Lambda',
    first: 'Event Functions',
    firstPath: '/aws/lambda',
  },
  iam: {
    label: 'AWS Identity and Access Management',
    crumb: 'IAM',
    first: 'Roles',
    firstPath: '/aws/iam',
  },
} as const;

// ---------------------------------------------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The changed page for a part of the service `label` (R4.2, R4.5): the address is `path`, the `h1` "No screen yet"
 * inside the AWS area, the statement for this part of `label` in the page's `main`, and nowhere the sentence that
 * Studio has no screen for the service.
 */
export async function expectNoScreenPart(page: Page, label: string, path: string): Promise<void> {
  await expect(page).toHaveURL(addressOf(path));
  const h1 = heading(page, NO_SCREEN_PART_H1);
  await expect(h1, `the h1 "${NO_SCREEN_PART_H1}" at ${path}`).toBeVisible();
  expect(await inCloudscape(h1), `"${NO_SCREEN_PART_H1}" is inside the AWS area`).toBe(true);
  const main = page.getByRole('main');
  await expect(main, `the statement "${partStatement(label)}"`).toContainText(partStatement(label));
  await expect(main, `the page never says "${serviceSentence(label)}"`).not.toContainText(serviceSentence(label));
}

/** The page's sentence "Opening this page changed nothing in your local emulator." in its `main`. */
export function nothingChanged(page: Page): Locator {
  return page.getByRole('main').getByText(NOTHING_CHANGED, { exact: true });
}

/** An action of the page by its name: a link inside the page's `main` (R4.7). */
export function action(page: Page, name: string): Locator {
  return page.getByRole('main').getByRole('link', { name, exact: true });
}

/** The page's actions, the links of its `main` whose names start "Go to ", in visible order, with their addresses. */
export async function actions(page: Page): Promise<{ name: string; href: string | null }[]> {
  const links = page.getByRole('main').getByRole('link', { name: /^Go to / });
  return links.evaluateAll((els) =>
    els
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({
        name: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: el.getAttribute('href'),
      })),
  );
}

/** What the page shows of its own, to compare two moments: the `h1`, the statement, the path, the sentence, actions. */
export interface PartShown {
  h1: string | null;
  statement: boolean;
  path: string | null;
  sentence: boolean;
  actions: string[];
}

/** Reads `PartShown` for a part of the service `label` now; never waits. */
export async function partShown(page: Page, label: string): Promise<PartShown> {
  const h1s = await page.getByRole('heading', { level: 1 }).allInnerTexts();
  const main = page.getByRole('main');
  return {
    h1: h1s.length === 1 ? h1s[0].replace(/\s+/g, ' ').trim() : null,
    statement: (await main.getByText(partStatement(label), { exact: true }).count()) === 1,
    path: await shownPath(page),
    sentence: (await nothingChanged(page).count()) === 1,
    actions: (await actions(page)).map((a) => a.name),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The path (R4.5, R4.6).
// ---------------------------------------------------------------------------------------------------------------

/** The probe `installPathProbe` puts on the page's window. */
interface PathProbe {
  parts: () => { label: Element | null; code: Element | null };
}

/**
 * In the browser: puts on `window` a probe that finds the label "Path" (the innermost element of `main` whose text is
 * exactly "Path") and the path's `code`, the first `code` element after the label in document order; either is `null`
 * when the page has none. Installed by `page.evaluate` before each read, so a new document gets it too.
 */
function installPathProbe(): void {
  (window as unknown as { __emuforgeItPath?: PathProbe }).__emuforgeItPath = {
    parts: () => {
      const main = document.querySelector('main, [role~="main"]');
      if (main === null) return { label: null, code: null };
      const label =
        [...main.querySelectorAll('*')].find(
          (el) =>
            (el.textContent ?? '').trim() === 'Path' &&
            ![...el.children].some((child) => (child.textContent ?? '').trim() === 'Path'),
        ) ?? null;
      if (label === null) return { label: null, code: null };
      const code =
        [...main.querySelectorAll('code')].find(
          (el) => (label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && !label.contains(el),
        ) ?? null;
      return { label, code };
    },
  };
}

/** The path the page shows under "Path", as text; `null` when it shows none. */
export async function shownPath(page: Page): Promise<string | null> {
  await page.evaluate(installPathProbe);
  return page.evaluate(() => {
    const { code } = (window as unknown as { __emuforgeItPath: PathProbe }).__emuforgeItPath.parts();
    return code === null ? null : (code.textContent ?? '');
  });
}

/** Waits until the page shows `path` under "Path". */
export async function expectPath(page: Page, path: string): Promise<void> {
  await expect
    .poll(() => shownPath(page), {
      message: `"${PATH_LABEL}" shows ${path}`,
      ...ACTION,
    })
    .toBe(path);
}

/** A box as the browser draws it, in CSS pixels of the viewport. */
export interface DrawnBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** How the path and its label are drawn now; `null` when the page has no label or no path. */
export interface PathLayout {
  /** The path's text as the page holds it. */
  text: string;
  /** The path's box: the union of the boxes its `code` element draws. */
  path: DrawnBox;
  /** The box of the label's drawn text. */
  label: DrawnBox;
  /** The box that holds the label's text and the path, both drawn. */
  pair: DrawnBox;
  /** The box of the Cloudscape container around the path. */
  container: DrawnBox | null;
  /** The path's lines as drawn: its characters grouped by the line they are drawn on, in order. */
  lines: string[];
  /** The `code` element's content is wider than its box (cut or scrolled). */
  clipped: boolean;
}

/** The Cloudscape `Container`, as `closest()` matches it. */
const CONTAINER = createWrapper().findContainer().toSelector();

/** Measures the label "Path" and the path as drawn now (R4.5, R4.6, R7). */
export async function pathLayout(page: Page): Promise<PathLayout | null> {
  await page.evaluate(installPathProbe);
  return page.evaluate((container) => {
    const { label, code } = (window as unknown as { __emuforgeItPath: PathProbe }).__emuforgeItPath.parts();
    if (label === null || code === null) return null;
    const union = (rects: DOMRect[]) => ({
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    });
    const drawn = (rects: DOMRectList | DOMRect[]) => [...rects].filter((r) => r.width > 0.5 && r.height > 0.5);
    const pathRects = drawn(code.getClientRects());
    const labelRange = document.createRange();
    labelRange.selectNodeContents(label);
    const labelRects = drawn(labelRange.getClientRects());
    if (pathRects.length === 0 || labelRects.length === 0) return null;
    // The path's characters, each with the top of the box it is drawn in.
    const chars: { ch: string; top: number }[] = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const data = (n as Text).data;
      for (let i = 0; i < data.length; i++) {
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const rect = drawn(range.getClientRects())[0];
        chars.push({ ch: data[i], top: rect ? rect.top : Number.NaN });
      }
    }
    const lines: string[] = [];
    let lastTop = Number.NEGATIVE_INFINITY;
    for (const { ch, top } of chars) {
      if (Number.isNaN(top)) continue;
      if (lines.length === 0 || top - lastTop > 2) {
        lines.push(ch);
        lastTop = top;
      } else lines[lines.length - 1] += ch;
    }
    const box = code.closest(container);
    return {
      text: code.textContent ?? '',
      path: union(pathRects),
      label: union(labelRects),
      pair: union([...pathRects, ...labelRects]),
      container: box === null ? null : union([box.getBoundingClientRect()]),
      lines,
      clipped: code.scrollWidth > code.clientWidth + 1 && getComputedStyle(code).display !== 'inline',
    };
  }, CONTAINER);
}

/** What is wrong with `layout` for the whole path `path` (R4.6, R7): the text, the box, the page's width. */
export function pathFitProblems(layout: PathLayout | null, path: string): string[] {
  if (layout === null) return [`no "${PATH_LABEL}" with a path`];
  const problems: string[] = [];
  if (layout.text !== path) problems.push(`the path reads "${layout.text}", not "${path}"`);
  if (layout.lines.join('') !== path) problems.push(`the drawn lines ${JSON.stringify(layout.lines)} are not ${path}`);
  if (layout.clipped) problems.push("the path's box is narrower than its text");
  const c = layout.container;
  if (c === null) problems.push('the path is in no Cloudscape container');
  else if (
    layout.path.left < c.left - 0.5 ||
    layout.path.right > c.right + 0.5 ||
    layout.path.top < c.top - 0.5 ||
    layout.path.bottom > c.bottom + 0.5
  ) {
    problems.push(`the path's box ${JSON.stringify(layout.path)} is not inside the container's ${JSON.stringify(c)}`);
  }
  return problems;
}

/**
 * What is wrong with the label's place (R4.5): the label above the path with the same left edge, and the box that
 * holds the two centred in the container, its left and right distances to the container's edges within 1 px.
 */
export function pathPlaceProblems(layout: PathLayout | null): string[] {
  if (layout === null) return [`no "${PATH_LABEL}" with a path`];
  const problems: string[] = [];
  if (layout.label.bottom > layout.path.top + 0.5) {
    problems.push(
      `the label (bottom ${String(layout.label.bottom)}) is not above the path (top ${String(layout.path.top)})`,
    );
  }
  if (Math.abs(layout.label.left - layout.path.left) > 0.5) {
    problems.push(`the label's left edge ${String(layout.label.left)} is not the path's ${String(layout.path.left)}`);
  }
  const c = layout.container;
  if (c === null) problems.push('the path is in no Cloudscape container');
  else {
    const left = layout.pair.left - c.left;
    const right = c.right - layout.pair.right;
    if (Math.abs(left - right) > 1) {
      problems.push(
        `the pair is ${left.toFixed(1)} px from the container's left edge and ${right.toFixed(1)} px from its right`,
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Crumbs and navigation (R4.3, R4.4).
// ---------------------------------------------------------------------------------------------------------------

/** A crumb as shown: its text, its address (`null` for no link) and whether it is the current page. */
export interface ShownCrumb {
  text: string;
  href: string | null;
  current: boolean;
}

/** The crumbs on screen, in order, the current page last. */
export async function crumbTrail(page: Page): Promise<ShownCrumb[]> {
  return page
    .locator(BREADCRUMB_ITEMS)
    .filter({ visible: true })
    .evaluateAll((els) =>
      els.map((el) => {
        const link = el.closest('a[href]') ?? el.querySelector('a[href]');
        return {
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
          href: link === null ? null : link.getAttribute('href'),
          current: el.getAttribute('aria-current') === 'page' || el.closest('[aria-current="page"]') !== null,
        };
      }),
    );
}

/**
 * What is wrong with the crumbs for the texts `texts` (R4.3): the texts in order, every crumb but the last a link,
 * the last "No screen yet", the current page and no link.
 */
export function crumbProblems(shown: ShownCrumb[], texts: string[]): string[] {
  const problems: string[] = [];
  const got = shown.map((c) => c.text);
  if (JSON.stringify(got) !== JSON.stringify(texts)) problems.push(`the crumbs read ${JSON.stringify(got)}`);
  shown.slice(0, -1).forEach((c) => {
    if (c.href === null) problems.push(`the crumb "${c.text}" is not a link`);
  });
  const last = shown.at(-1);
  if (last !== undefined && (last.href !== null || !last.current)) {
    problems.push(
      `the last crumb "${last.text}" is ${last.href === null ? 'not the current page' : `a link to ${last.href}`}`,
    );
  }
  return problems;
}

/** Waits until the crumbs read `texts` as `crumbProblems` asks. */
export async function expectCrumbs(page: Page, texts: string[]): Promise<void> {
  await expect
    .poll(async () => crumbProblems(await crumbTrail(page), texts), {
      message: `the crumbs ${texts.join(' > ')}`,
      ...ACTION,
    })
    .toEqual([]);
}

/** The side navigation's header link. */
const NAVIGATION_HEADER = createWrapper().findSideNavigation().findHeaderLink().toSelector();

/** The side navigation as shown: its header, its links in order (header left out) and the texts of the current ones. */
export async function navigationShown(
  page: Page,
): Promise<{ header: string | null; links: string[]; current: string[] }> {
  const nav = page.locator(SIDE_NAVIGATION).filter({ visible: true });
  if ((await nav.count()) === 0) return { header: null, links: [], current: [] };
  const header = page.locator(NAVIGATION_HEADER).filter({ visible: true });
  const headerText = (await header.count()) > 0 ? (await header.first().innerText(ACTION)).trim() : null;
  const links = (
    await nav
      .first()
      .getByRole('link')
      .evaluateAll(
        (els, headerSelector) =>
          els
            .filter((el) => !el.matches(headerSelector))
            .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()),
        NAVIGATION_HEADER.replace(/^body /, ''),
      )
  ).filter((text) => text !== '');
  const current = (await page.locator(SIDE_NAVIGATION_ACTIVE).filter({ visible: true }).allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
  return { header: headerText, links, current };
}
