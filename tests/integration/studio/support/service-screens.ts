// What a service's support lends to the checks of other services and of no service (issue 402, requirement R5.2):
// the check's name prefix, the Seoul zone and the creation date cell the date checks compare with, the watch of a
// text that appears and goes again, whether the page scrolls sideways, and the test of a page request for the
// engine's `ListBuckets` that `safety.spec.ts` counts. They were S3's (`services/s3/s3.ts`, issue 56) and are read
// from here by every check, S3's own included; nothing in a service's folder exports them again.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect, type Ctx } from './check';

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
 * The text of the one element `locator` as the browser draws it: its rendered text (`innerText`), which the layout
 * decides, so white space the browser collapses is one space, also across two elements side by side, and the spaces
 * and tabs it keeps stay as they are. Text that takes no room on the screen is left out: what is not displayed or
 * hidden is none of an element's rendered text, and an element of opacity 0 or of font size 0 (the area's text for
 * assistive technology beside a name) is taken out of the layout for the length of the read, in the one task that
 * reads, and put back as it was. White space at the two ends is trimmed.
 */
export async function drawnText(locator: Locator): Promise<string> {
  return locator.evaluate(
    (root) => {
      const unseen: { element: HTMLElement; style: string | null }[] = [];
      for (const element of root.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(element);
        if (style.opacity === '0' || style.fontSize === '0px') {
          unseen.push({ element, style: element.getAttribute('style') });
        }
      }
      try {
        for (const { element } of unseen) element.style.setProperty('display', 'none', 'important');
        return (root as HTMLElement).innerText.replace(/^[ \n]+|[ \n]+$/g, '');
      } finally {
        for (const { element, style } of unseen) {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
        }
      }
    },
    undefined,
    { timeout: 15_000 },
  );
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

/** The content of the open modal: what the dialog says and asks, without its header and footer. */
export function modalContent(page: Page): Locator {
  return page.locator(createWrapper().findModal().findContent().toSelector()).filter({ visible: true });
}

/** A data row of a Cloudscape table and one of its cells. */
export interface TableRow {
  /** The row: its links, buttons and selection control are found by role within it. */
  row: Locator;
  /** The cell the row was found by. */
  cell: Locator;
}

/**
 * In the Cloudscape table whose root is `table`: the one data row whose cell under column `column` (1 the first, the
 * selection column counted) reads `text` as drawn (`drawnText`), waited for. The rows and the cell are found with
 * Cloudscape's selectors. A failure says what the column's cells read last.
 */
export async function rowReading(table: Locator, column: number, text: string): Promise<TableRow> {
  // A selector below the table's root: the table wrapper's own selector is taken off the front of its part's.
  const root = createWrapper().findTable().toSelector();
  const below = (part: { toSelector(): string }) => {
    const selector = part.toSelector();
    if (!selector.startsWith(`${root} `)) throw new Error(`the selector ${selector} is not below the table's, ${root}`);
    return selector.slice(root.length + 1);
  };
  const rows = table.locator(below(createWrapper().findTable().findRows()));
  const cellOf = (index: number) => table.locator(below(createWrapper().findTable().findBodyCell(index + 1, column)));
  let read: string[] = [];
  let found: number[] = [];
  try {
    await expect
      .poll(
        async () => {
          try {
            const count = await rows.count();
            read = [];
            for (let i = 0; i < count; i++) read.push(await drawnText(cellOf(i)));
          } catch {
            // The table drew its rows again during the read: it is read once more.
            read = [];
          }
          found = read.flatMap((each, i) => (each === text ? [i] : []));
          return found.length;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
  } catch {
    throw new Error(
      `the table has ${String(found.length)} rows whose column ${String(column)} reads ${JSON.stringify(text)}; the column reads ${JSON.stringify(read)}`,
    );
  }
  return { row: rows.nth(found[0]!), cell: cellOf(found[0]!) };
}

/** An option the open list offers: its value and its text as drawn. */
export interface OfferedOption {
  value: string;
  text: string;
}

/**
 * What the open list of the page's one open select or multiselect offers at one moment: whether it says it is still
 * reading (its status line), and which of `values` have an option a user sees in it, in the order given, each with
 * its text as drawn. An option is seen when a box of it has a width and a height and neither it nor an element around it is
 * hidden or of opacity 0; its text is read as `drawnText` reads one (the rendered text, without what takes no room).
 * All of it is read in one step, so a check asserts on one list and not on two states of it.
 */
export async function offeredNow(page: Page, values: string[]): Promise<{ reading: boolean; offered: OfferedOption[] }> {
  const select = createWrapper().findSelect();
  const multiselect = createWrapper().findMultiselect();
  return page.evaluate(
    ({ status, options }) => {
      const seen = (element: Element) =>
        [...element.getClientRects()].some((box) => box.width > 0 && box.height > 0) &&
        (element as Element & { checkVisibility(options: object): boolean }).checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        });
      const all = (selectors: string[]) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
      // The same read as `drawnText`.
      const textOf = (root: Element) => {
        const unseen: { element: HTMLElement; style: string | null }[] = [];
        for (const element of root.querySelectorAll<HTMLElement>('*')) {
          const style = getComputedStyle(element);
          if (style.opacity === '0' || style.fontSize === '0px') {
            unseen.push({ element, style: element.getAttribute('style') });
          }
        }
        try {
          for (const { element } of unseen) element.style.setProperty('display', 'none', 'important');
          return (root as HTMLElement).innerText.replace(/^[ \n]+|[ \n]+$/g, '');
        } finally {
          for (const { element, style } of unseen) {
            if (style === null) element.removeAttribute('style');
            else element.setAttribute('style', style);
          }
        }
      };
      return {
        reading: all(status).some(seen),
        offered: options.flatMap((each) =>
          all(each.selectors)
            .filter(seen)
            .map((element) => ({ value: each.value, text: textOf(element) })),
        ),
      };
    },
    {
      status: [select.findStatusIndicator().toSelector(), multiselect.findStatusIndicator().toSelector()],
      options: values.map((value) => ({
        value,
        selectors: [
          select.findDropdown().findOptionByValue(value).toSelector(),
          multiselect.findDropdown().findOptionByValue(value).toSelector(),
        ],
      })),
    },
  );
}
