// A dialog of the AWS area against Studio's bar (issue 531): where the dialog's title and close control are, what a
// point of the page meets, and what the bar's controls are. Read by `aws-area-dialog.spec.ts`, a check of no service.
//
// "A point meets X": X, or something inside X, is what the browser finds at that point (what a press there
// reaches). "The dialog's box": the dialog's own panel with its title, content and buttons, not the backdrop around
// it. The dialog itself (`role="dialog"`) is Cloudscape's root of it, which spans the viewport and scrolls.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { ElementHandle, Locator, Page } from '@playwright/test';

import { ACTION, frame } from './frame';
import { languageControl } from './languages';

/** The close control in a dialog's header, as Cloudscape's own test utilities find it. */
const DISMISS = createWrapper().findModal().findDismissButton().toSelector();
/** The same from inside the dialog: Cloudscape's selector starts at `body` and names the dialog's root first. */
const DISMISS_IN_DIALOG = DISMISS.split(' ').at(-1) ?? DISMISS;

export interface Point {
  x: number;
  y: number;
}

export interface BarControl {
  name: string;
  /** The centre of the control, read while no dialog is open; the bar does not move. */
  centre: Point;
}

/** Studio's bar, held as an element: once a dialog is open the bar may be out of the accessibility tree. */
export async function barElement(page: Page): Promise<ElementHandle<HTMLElement>> {
  return (await frame(page).banner.elementHandle(ACTION)) as ElementHandle<HTMLElement>;
}

/**
 * The bar's controls with their centres: the wordmark, every link of the navigation "Studio" and the language
 * control. Read with no dialog open.
 */
export async function barControls(page: Page): Promise<BarControl[]> {
  const f = frame(page);
  const found: { name: string; locator: Locator }[] = [{ name: 'EmuForge Studio', locator: f.wordmark }];
  const links = f.nav.getByRole('link');
  const count = await links.count();
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    found.push({
      name: ((await link.textContent(ACTION)) ?? '').trim(),
      locator: link,
    });
  }
  found.push({ name: 'the language control', locator: languageControl(page) });
  const controls: BarControl[] = [];
  for (const { name, locator } of found) {
    const box = await locator.boundingBox(ACTION);
    if (!box) throw new Error(`the bar's control "${name}" is not drawn`);
    controls.push({
      name,
      centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    });
  }
  return controls;
}

/** The area's root: the element with `lang="en"` that holds the page's `main` (`aws-area.md`). */
export async function areaRootElement(page: Page): Promise<ElementHandle<Element>> {
  const handle = await page
    .locator('main')
    .first()
    .evaluateHandle((main) => main.closest('[lang="en"]'));
  const element = handle.asElement();
  if (!element) throw new Error('the page has no area root: no element with lang="en" holds its main');
  return element as ElementHandle<Element>;
}

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PartReport {
  rect: Rect;
  /** Wholly inside the viewport. */
  inViewport: boolean;
  /** What the point at its centre meets: "itself", "Studio's bar", or the element found. */
  centreMeets: string;
  /** Points of it (a 5 by 3 grid) that are inside the bar's rectangle and meet the bar. */
  underBar: number;
}

export interface DialogReport {
  viewport: { width: number; height: number };
  bar: Rect;
  /** The dialog's content is taller than the viewport: its own scrolling has somewhere to go. */
  taller: boolean;
  scrollTop: number;
  box: Rect | null;
  title: PartReport | null;
  close: PartReport | null;
  closeName: string | null;
}

/** Where the open `dialog`'s title and close control are, against `bar`. */
export async function readDialog(dialog: Locator, bar: ElementHandle<HTMLElement>): Promise<DialogReport> {
  return dialog.evaluate(
    (root, { bar, dismiss }) => {
      const rectOf = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const barRect = rectOf(bar);
      const describe = (e: Element | null) =>
        e === null ? 'nothing' : `${e.tagName.toLowerCase()}.${[...e.classList].slice(0, 1).join('')}`;
      const part = (e: Element | null) => {
        if (e === null) return null;
        const rect = rectOf(e);
        const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
        let underBar = 0;
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 3; j++) {
            const x = rect.left + ((rect.right - rect.left) * (i + 0.5)) / 5;
            const y = rect.top + ((rect.bottom - rect.top) * (j + 0.5)) / 3;
            const inBar = x >= barRect.left && x < barRect.right && y >= barRect.top && y < barRect.bottom;
            const at = inBar ? document.elementFromPoint(x, y) : null;
            if (at !== null && bar.contains(at)) underBar++;
          }
        }
        return {
          rect,
          inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
          centreMeets:
            hit !== null && e.contains(hit)
              ? 'itself'
              : hit !== null && bar.contains(hit)
                ? "Studio's bar"
                : describe(hit),
          underBar,
        };
      };
      const box = root.querySelector('[class*="awsui_dialog_"]');
      const close = root.querySelector(dismiss);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        bar: barRect,
        taller: root.scrollHeight > root.clientHeight,
        scrollTop: root.scrollTop,
        box: box ? rectOf(box) : null,
        title: part(root.querySelector('h2')),
        close: part(close),
        closeName: close?.getAttribute('aria-label') ?? null,
      };
    },
    { bar, dismiss: DISMISS },
    ACTION,
  );
}

/** The open `dialog`'s close control. */
export function closeControl(dialog: Locator): Locator {
  return dialog.locator(DISMISS_IN_DIALOG);
}

/** Brings the open `dialog`'s own scrolling to its start (`0`) or its end. */
export async function scrollDialog(dialog: Locator, to: 'start' | 'end'): Promise<void> {
  await dialog.evaluate(
    (root, where) => {
      root.scrollTop = where === 'start' ? 0 : root.scrollHeight;
    },
    to,
    ACTION,
  );
}

/** What `point` meets: the bar, the dialog's close control, the dialog's box, its backdrop, or something else. */
export async function pointMeets(
  page: Page,
  point: Point,
  bar: ElementHandle<HTMLElement>,
): Promise<'bar' | 'close' | 'box' | 'backdrop' | 'other' | 'nothing'> {
  return page.evaluate(
    ({ point, bar, dismiss }) => {
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit === null) return 'nothing';
      if (bar.contains(hit)) return 'bar';
      const root = hit.closest('[role="dialog"]');
      if (root === null) return 'other';
      if (hit.closest(dismiss)) return 'close';
      return hit.closest('[class*="awsui_dialog_"]') ? 'box' : 'backdrop';
    },
    { point, bar, dismiss: DISMISS },
  );
}

/** A point of the open `dialog`'s backdrop: outside its box and outside the bar's rectangle; `null` when none is found. */
export async function backdropPoint(
  page: Page,
  dialog: Locator,
  bar: ElementHandle<HTMLElement>,
): Promise<Point | null> {
  const { viewport, bar: barRect } = await readDialog(dialog, bar);
  const candidates: Point[] = [
    { x: 3, y: (barRect.bottom + viewport.height) / 2 },
    { x: viewport.width - 3, y: (barRect.bottom + viewport.height) / 2 },
    { x: viewport.width / 2, y: barRect.bottom + 6 },
    { x: viewport.width / 2, y: viewport.height - 4 },
    { x: 3, y: viewport.height - 4 },
  ];
  for (const point of candidates) {
    if (point.y <= barRect.bottom) continue;
    if ((await pointMeets(page, point, bar)) === 'backdrop') return point;
  }
  return null;
}

/** Where focus is: in the bar, in a dialog, or elsewhere. */
export async function focusPlace(page: Page, bar: ElementHandle<HTMLElement>): Promise<'bar' | 'dialog' | 'other'> {
  return page.evaluate((bar) => {
    const a = document.activeElement;
    if (a !== null && bar.contains(a)) return 'bar';
    return a?.closest('[role="dialog"]') ? 'dialog' : 'other';
  }, bar);
}

/**
 * Cloudscape outside the area: every element rendered by Cloudscape (one that carries an `awsui*` class and is
 * neither `html` nor `body`) that is not inside `root`, and the `awsui*` classes `html` and `body` carry.
 */
export async function cloudscapeOutside(
  page: Page,
  root: ElementHandle<Element>,
): Promise<{ elements: string[]; onDocument: string[] }> {
  return page.evaluate((root) => {
    const awsui = (el: Element) => [...el.classList].filter((c) => c.startsWith('awsui'));
    const elements = [...document.querySelectorAll('*')]
      .filter((el) => el !== document.documentElement && el !== document.body)
      .filter((el) => awsui(el).length > 0 && !root.contains(el))
      .slice(0, 10)
      .map((el) => `${el.tagName.toLowerCase()}.${awsui(el)[0] ?? ''}`);
    const onDocument = [
      ...awsui(document.documentElement).map((c) => `html.${c}`),
      ...awsui(document.body).map((c) => `body.${c}`),
    ];
    return { elements, onDocument };
  }, root);
}

/**
 * At `point`: whether what it meets is inside `control`'s place in the bar (the bar itself), and whether an element
 * of the area (one inside `root`) lies behind it there.
 */
export async function behindBar(
  page: Page,
  point: Point,
  bar: ElementHandle<HTMLElement>,
  root: ElementHandle<Element>,
): Promise<{ meetsBar: boolean; areaBehind: boolean }> {
  return page.evaluate(
    ({ point, bar, root }) => {
      const stack = document.elementsFromPoint(point.x, point.y);
      return {
        meetsBar: stack.length > 0 && bar.contains(stack[0] ?? null),
        areaBehind: stack.some((el) => root.contains(el)),
      };
    },
    { point, bar, root },
  );
}
