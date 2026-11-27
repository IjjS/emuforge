// What a service's support lends to the checks of other services and of no service (issue 402, requirement R5.2):
// the check's name prefix, the Seoul zone and the creation date cell the date checks compare with, the watch of a
// text that appears and goes again, whether the page scrolls sideways, and the test of a page request for the
// engine's `ListBuckets` that `safety.spec.ts` counts. They were S3's (`services/s3/s3.ts`, issue 56) and are read
// from here by every check, S3's own included; nothing in a service's folder exports them again.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import type { Ctx } from './check';

/**
 * The check's own prefix `<p>`: `efit-<run id>-<tag>`. Each check passes its own `tag`, none of which starts with
 * another, so a filter on one check's prefix never lists another check's bucket on the run's shared emulator.
 */
export function checkPrefix(ctx: Ctx, tag: string): string {
  return `efit-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${tag}`;
}

/** The browser time zone the date check sets on its context, and its fixed offset (Korea keeps no summer time). */
export const SEOUL = { timeZone: 'Asia/Seoul', offsetMinutes: 9 * 60, label: 'UTC+09:00' };

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The "Creation date" cell for the `CreationDate` `iso` of a direct answer, in a zone `offsetMinutes` east of UTC
 * named `label` (R4.2): "October 30, 2026, 23:18:34 (UTC+09:00)"; "-" without a date.
 */
export function creationDateText(iso: string | null, zone: { offsetMinutes: number; label: string }): string {
  if (iso === null) return '-';
  const at = new Date(Date.parse(iso) + zone.offsetMinutes * 60_000);
  if (Number.isNaN(at.getTime())) throw new Error(`the direct answer's CreationDate ${iso} is not a date`);
  const two = (n: number) => String(n).padStart(2, '0');
  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`;
  return `${MONTHS[at.getUTCMonth()]} ${String(at.getUTCDate())}, ${String(at.getUTCFullYear())}, ${time} (${zone.label})`;
}

/**
 * From now on, in the current document, records whether `text` appears anywhere in it (`appeared`). Survives the
 * area's route changes, which load no document.
 */
export async function watchText(page: Page, text: string): Promise<void> {
  await page.evaluate((wanted) => {
    const w = window as unknown as { __emuforgeItSeen?: Record<string, boolean> };
    w.__emuforgeItSeen = { ...w.__emuforgeItSeen, [wanted]: false };
    const look = () => {
      if ((document.body.textContent ?? '').includes(wanted)) w.__emuforgeItSeen![wanted] = true;
    };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
    look();
  }, text);
}

/** Whether `text` appeared since `watchText`; `null` when it is not watched in the current document. */
export async function appeared(page: Page, text: string): Promise<boolean | null> {
  return page.evaluate(
    (wanted) =>
      (window as unknown as { __emuforgeItSeen?: Record<string, boolean> }).__emuforgeItSeen?.[wanted] ?? null,
    text,
  );
}

/** Whether the page scrolls sideways now. */
export async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/** True when `url` with `method` is a `ListBuckets` to the engine at `engineOrigin`: `GET /` (path style). */
export function isListBuckets(url: string, method: string, engineOrigin: string): boolean {
  const u = new URL(url);
  return u.origin === engineOrigin && method === 'GET' && u.pathname === '/';
}

// --- Names that differ only by white space a browser hides (issue 664) ------------------------------------------

/**
 * How the area writes, in a name's exact identity, a space that stands next to another space or at an end of the
 * name: a backslash, `u0020`. Six characters of text, not a space.
 */
export const SPACE_ESCAPE = '\\' + 'u0020';

/** The exact identity of `<stem> a  b` (two spaces): `<stem> a`, the escape twice, `b`. */
export function twoSpaceIdentity(stem: string): string {
  return `${stem} a${SPACE_ESCAPE}${SPACE_ESCAPE}b`;
}

/**
 * The text of the one element `locator` as it is drawn: the text a reader sees, in order. Text that takes no room
 * on the screen is left out (an element not displayed, hidden, of opacity 0 or of font size 0, as the area's text
 * for assistive technology beside a name); where the browser collapses white space a run of it is one space, and
 * where it keeps it the spaces and tabs stay as they are. Spaces at the two ends are trimmed.
 */
export async function drawnText(locator: Locator): Promise<string> {
  return locator.evaluate((root) => {
    let out = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      let drawn = true;
      for (let e = node.parentElement; e !== null; e = e === root ? null : e.parentElement) {
        const style = getComputedStyle(e);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.fontSize === '0px') {
          drawn = false;
          break;
        }
      }
      if (!drawn || node.parentElement === null) continue;
      const style = getComputedStyle(node.parentElement) as CSSStyleDeclaration & { whiteSpaceCollapse?: string };
      const collapse = style.whiteSpaceCollapse ?? (style.whiteSpace.startsWith('pre') || style.whiteSpace === 'break-spaces' ? 'preserve' : 'collapse');
      const text = node.textContent ?? '';
      out += collapse === 'collapse' ? text.replace(/[ \t\n\r\f]+/g, ' ') : text;
    }
    return out.replace(/^ +| +$/g, '');
  }, undefined, { timeout: 15_000 });
}

/** The `h1` of the page's Cloudscape header: found from the header's heading text, for its accessible name. */
export function headerHeading(page: Page): Locator {
  const text = createWrapper().findHeader().findHeadingText().toSelector();
  return page.locator(text).first().locator('xpath=ancestor::h1');
}

/** The open modal's element of the role `dialog`, for its accessible name. */
export function modalDialog(page: Page): Locator {
  return page.locator(createWrapper().findModal().toSelector()).filter({ visible: true }).locator('xpath=descendant-or-self::*[@role="dialog"]');
}
