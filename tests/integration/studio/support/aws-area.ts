// The AWS area's frame parts as a user meets them (test-criteria.md, issue 45, Flow checks; requirement R3, R4, R7):
// the breadcrumbs, the emulator line (the group whose label is "Local emulator, not AWS"), where the line is drawn,
// whether it fits the page's width, the contrast of its text, and the images of the area. Used by
// `aws-area-frame.spec.ts`.
//
// Every value a check compares with comes from the run: the emulator's endpoint from the port it was started on, the
// engine's origin from the engine the check started. Nothing here names a port.

import type { Locator, Page } from '@playwright/test';

import { expect } from './check';
import { ACTION, BREADCRUMB_GROUP, breadcrumbs, heading } from './frame';

/** The constant label of the emulator line (R4.2). */
export const LINE_LABEL = 'Local emulator, not AWS';

/** The link the line ends with in every state but "Checking" and connected (R4.3). */
export const CONNECTION_STATUS = 'Connection status';

/** The (i) control of a page that carries the notice (R5.4); the area's own pages have none. */
export const ABOUT_CONTROL = 'About the local emulator';

/** A check every 5 seconds (R4.4), so a change of state shows within two of them. */
export const LINE_CHANGE_BOUND_MS = 10_000;

/** The emulator line: the group named by its label. */
export function emulatorLine(page: Page): Locator {
  return page.getByRole('group', { name: LINE_LABEL, exact: true });
}

/** The "Connection status" link inside the emulator line. */
export function connectionStatusLink(page: Page): Locator {
  return emulatorLine(page).getByRole('link', { name: CONNECTION_STATUS, exact: true });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `https://127.0.0.1:<port>`, not followed by another digit. */
export function endpointPattern(port: number): string {
  return `https://127\\.0\\.0\\.1:${String(port)}(?!\\d)`;
}

/** The connected status for the emulator on `port`. */
export function connectedAt(port: number): RegExp {
  return new RegExp(`Connected at ${endpointPattern(port)}`);
}

/** The not-started status for `port`. */
export function notStartedOn(port: number): RegExp {
  return new RegExp(`Not started on port ${String(port)}(?!\\d)`);
}

/** The engine-unreachable status for the engine at `origin` (`http://127.0.0.1:<port>`). */
export function engineNotAnswering(origin: string): RegExp {
  return new RegExp(`The EmuForge engine at ${escape(origin)} is not answering`);
}

/** The emulator line's text, white space collapsed; `null` when the page has no such line. */
export async function lineText(page: Page): Promise<string | null> {
  const line = emulatorLine(page);
  if ((await line.count()) !== 1) return null;
  return (await line.innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/**
 * Waits until the emulator line holds the label followed by text matching `status`. A failure shows what the line read
 * last, or "(no emulator line)".
 */
export async function expectLine(page: Page, status: RegExp, timeout = LINE_CHANGE_BOUND_MS): Promise<void> {
  const wanted = new RegExp(`${escape(LINE_LABEL)}[\\s\\S]*${status.source}`);
  await expect
    .poll(async () => (await lineText(page)) ?? '(no emulator line)', {
      timeout,
      message: `the emulator line reads "${LINE_LABEL}" and ${String(status)}`,
    })
    .toMatch(wanted);
}

/** The texts of the crumbs on screen, in order, the current page last. */
export async function crumbs(page: Page): Promise<string[]> {
  return breadcrumbs(page);
}

/** A crumb link with exactly `name`, as it is shown. */
export function crumbLink(page: Page, name: string): Locator {
  return page.locator(BREADCRUMB_GROUP).getByRole('link', { name, exact: true }).filter({ visible: true });
}

/**
 * At a narrow width: the crumbs a user can reach. When the breadcrumbs collapse into an entry ("Show path" and its
 * like), it is opened and its items are read; the crumbs still shown are read too. Returns every reachable crumb text,
 * and whether a collapsed entry was opened.
 */
export async function reachableCrumbs(page: Page): Promise<{ collapsed: boolean; texts: string[] }> {
  const group = page.locator(BREADCRUMB_GROUP).filter({ visible: true });
  const shown = await crumbs(page);
  const entry = group.locator('button[aria-haspopup], button[aria-expanded]').filter({ visible: true });
  if ((await entry.count()) === 0) return { collapsed: false, texts: shown };
  await entry.first().click(ACTION);
  const items = page.getByRole('menuitem').filter({ visible: true });
  await expect(items.first(), 'the collapsed entry opens a list').toBeVisible();
  const listed = (await items.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape');
  return { collapsed: true, texts: [...shown, ...listed] };
}

export interface AreaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the crumbs, the emulator line and the page's `h1` are drawn, in the document; `null` for a missing part. */
export async function frameOrder(
  page: Page,
  h1: string,
): Promise<{ crumbs: AreaBox | null; line: AreaBox | null; h1: AreaBox | null; lineInMain: boolean; mains: number }> {
  const box = async (locator: Locator) => ((await locator.count()) > 0 ? locator.first().boundingBox(ACTION) : null);
  const line = emulatorLine(page);
  const mains = await page.getByRole('main').count();
  const lineInMain =
    mains === 1 && (await line.count()) === 1
      ? await line.evaluate((el) => el.closest('main, [role~="main"]') !== null, undefined, ACTION)
      : false;
  return {
    crumbs: await box(page.locator(BREADCRUMB_GROUP).filter({ visible: true })),
    line: await box(line),
    h1: await box(heading(page, h1)),
    lineInMain,
    mains,
  };
}

/** The controls inside the emulator line: its buttons, links and other Tab stops, described. */
export async function lineControls(page: Page): Promise<{ buttons: number; links: number; tabStops: string[] }> {
  const line = emulatorLine(page);
  const buttons = await line.getByRole('button').count();
  const links = await line.getByRole('link').count();
  const tabStops = await line.evaluate(
    (el) =>
      [
        ...el.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"], [tabindex]',
        ),
        el as HTMLElement,
      ]
        .filter((c) => c.tabIndex >= 0 && !(c as HTMLButtonElement).disabled && c.getClientRects().length > 0)
        .map((c) => `${c.tagName.toLowerCase()} "${(c.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`),
    undefined,
    ACTION,
  );
  return { buttons, links, tabStops };
}

/** The local-emulator notice and its (i) control, as the page shows them: the counts of each. */
export async function noticeParts(page: Page): Promise<{ notices: number; about: number }> {
  const notices = await page.getByText(/^These .+ are in your local emulator$/).count();
  const about = await page.getByRole('button', { name: ABOUT_CONTROL, exact: true }).count();
  return { notices, about };
}

export interface WidthReport {
  /** The page scrolls sideways. */
  pageScrolls: boolean;
  /** The parts of the emulator line drawn past the page's width (or before its start), described. */
  outside: string[];
  /** The rows the line's text takes on screen. */
  rows: number;
  /** The line's texts, each with whether it is drawn: the label, the status, the link. */
  parts: string[];
}

/**
 * Measures the emulator line as it is drawn now: every text of it (each text node, followed across a wrap) and the
 * line's own box against the page's width (`documentElement.clientWidth`), and the rows its text takes. `null` when
 * the page has no emulator line.
 */
export async function lineWidth(page: Page): Promise<WidthReport | null> {
  const line = emulatorLine(page);
  if ((await line.count()) !== 1) return null;
  return line.evaluate(
    (el) => {
      const root = document.documentElement;
      const width = root.clientWidth;
      const outside: string[] = [];
      const parts: string[] = [];
      const tops: number[] = [];
      const box = el.getBoundingClientRect();
      if (box.left < -0.5 || box.right > width + 0.5) {
        outside.push(`the line's box ${String(box.left)}..${String(box.right)} (page ${String(width)})`);
      }
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n as Text).data.replace(/\s+/g, ' ').trim();
        if (text === '') continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
        if (rects.length === 0) continue;
        parts.push(text);
        for (const r of rects) {
          if (r.left < -0.5 || r.right > width + 0.5) {
            outside.push(
              `"${text.slice(0, 60)}" drawn ${r.left.toFixed(1)}..${r.right.toFixed(1)} (page ${String(width)})`,
            );
          }
          tops.push(r.top);
        }
      }
      // Rows: tops more than half a text line apart.
      const sorted = [...tops].sort((a, b) => a - b);
      let rows = 0;
      let last = -Infinity;
      for (const t of sorted) {
        if (t - last > 6) {
          rows++;
          last = t;
        }
      }
      return { pageScrolls: root.scrollWidth > root.clientWidth, outside, rows, parts };
    },
    undefined,
    ACTION,
  );
}

/**
 * The WCAG 2.2 contrast of every visible text of the emulator line (the link's included) against what is behind it:
 * its colour composited over the backgrounds of its element and its ancestors, from the canvas up. A text meets AA at
 * 4.5:1, or 3:1 when it is large (24px, or 18.66px bold). Returns the texts checked and those below.
 */
export async function lineContrast(page: Page): Promise<{ checked: string[]; failures: string[] } | null> {
  const line = emulatorLine(page);
  if ((await line.count()) !== 1) return null;
  return line.evaluate(
    (lineEl) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const paint = canvas.getContext('2d', { willReadFrequently: true })!;
      const rgba = (color: string): number[] => {
        paint.clearRect(0, 0, 1, 1);
        paint.fillStyle = '#000';
        paint.fillStyle = color;
        paint.fillRect(0, 0, 1, 1);
        const d = paint.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const over = (top: number[], below: number[]) => {
        const a = top[3];
        return [top[0] * a + below[0] * (1 - a), top[1] * a + below[1] * (1 - a), top[2] * a + below[2] * (1 - a), 1];
      };
      const luminance = (c: number[]) => {
        const ch = c.slice(0, 3).map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
      };
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      const canvasColour = () => {
        const probe = document.createElement('div');
        probe.style.cssText = `position:absolute;width:0;height:0;background-color:Canvas;color-scheme:${getComputedStyle(document.documentElement).colorScheme}`;
        document.documentElement.appendChild(probe);
        const c = rgba(getComputedStyle(probe).backgroundColor);
        probe.remove();
        return c;
      };
      const behind = (el: Element) => {
        const layers: number[][] = [];
        for (let a: Element | null = el; a; a = a.parentElement) {
          const c = rgba(getComputedStyle(a).backgroundColor);
          layers.push(c);
          if (c[3] >= 1) break;
        }
        let below = canvasColour();
        for (const layer of layers.reverse()) below = over(layer, below);
        return below;
      };
      const opacity = (el: Element) => {
        let o = 1;
        for (let a: Element | null = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity) || 0;
        return o;
      };
      const checked: string[] = [];
      const failures: string[] = [];
      const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n as Text).data.replace(/\s+/g, ' ').trim();
        const el = n.parentElement;
        if (text === '' || el === null) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
        const cs = getComputedStyle(el);
        if (rects.length === 0 || cs.visibility !== 'visible') continue;
        // A visually hidden helper (clipped to nothing) is not drawn text.
        let hidden = false;
        for (let a: Element | null = el; a && a !== lineEl.parentElement; a = a.parentElement) {
          const s = getComputedStyle(a);
          const b = a.getBoundingClientRect();
          if (
            (s.clip !== 'auto' && s.clip !== '' && /absolute|fixed/.test(s.position)) ||
            /inset\(\s*50%/.test(s.clipPath)
          )
            hidden = true;
          if (s.overflow !== 'visible' && (b.width <= 1 || b.height <= 1)) hidden = true;
        }
        if (hidden) continue;
        const ink = rgba(cs.getPropertyValue('-webkit-text-fill-color') || cs.color);
        ink[3] *= opacity(el);
        const bg = behind(el);
        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        const needed = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
        const r = ratio(over(ink, bg), bg);
        checked.push(text.slice(0, 60));
        if (r + 1e-9 < needed) {
          failures.push(
            `"${text.slice(0, 60)}": ${r.toFixed(2)}:1, below ${String(needed)}:1 (${String(size)}px, weight ${String(weight)})`,
          );
        }
      }
      return { checked, failures };
    },
    undefined,
    ACTION,
  );
}

/**
 * The images of the AWS area as the page holds them now. The area's root is the nearest element that holds every
 * element with a Cloudscape class (`awsui_…`); inside it: `img`, `picture` and SVG `image` elements, and elements
 * (and their `::before` and `::after`) whose background image names a file (`url(…)`, `data:` images included). A
 * Cloudscape interface icon is an inline `svg` of paths and is not an image here. `null` when no area is on the page.
 */
export async function areaImages(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const tree = [...document.querySelectorAll('[class*="awsui_"]')].filter((el) =>
      [...el.classList].some((c) => c.startsWith('awsui_')),
    );
    if (tree.length === 0) return null;
    let root: Element | null = tree[0];
    for (const el of tree.slice(1)) {
      while (root && !root.contains(el)) root = root.parentElement;
    }
    if (root === null) return null;
    const describe = (el: Element) => {
      const cls = [...el.classList][0];
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
    };
    const found: string[] = [];
    for (const el of root.querySelectorAll('img, picture, image')) found.push(`${describe(el)} element`);
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const where of [null, '::before', '::after']) {
        const value = getComputedStyle(el, where).backgroundImage;
        if (value && value !== 'none' && /url\(/.test(value)) {
          found.push(`${describe(el)}${where ?? ''} background ${value.slice(0, 80)}`);
        }
      }
    }
    return found;
  });
}

/** The document's own icons (`<link rel="icon">`, `apple-touch-icon`), as absolute URLs: Studio's, not the area's. */
export async function documentIcons(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel~="apple-touch-icon"]')].map(
      (l) => l.href,
    ),
  );
}
