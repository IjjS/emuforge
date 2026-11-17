// What the five rules every AWS screen follows look like to a user (test-criteria.md, issue 467; requirement R3 to R7),
// read the same way for every service. Imported by each service's `*-screens-rules.spec.ts` and by the checks of a
// service that this issue rewrote; `support/index.ts` does not export it.
//
// - `shortPrefix`: a prefix unique to the check run that leaves room for names of 24 characters (the criteria's
//   lengths include the prefix); `checkPrefix` of `support/s3.ts` is longer than that.
// - `drawnLines`: the lines a value is drawn on, read from the boxes the browser gives each of its characters.
// - The clipboard: what a check puts on it first, what it holds, and the grant a check that copies gives its page.
// - `timesOnPage`: how often a text is drawn on the page, visible text only.
// - `pageHeader`: the page's `h1` with its description (Cloudscape's `Header` that holds the `h1`).
// - `formField`: a Cloudscape `FormField` by its label, with its constraint text and its message.
// - `selectAndCopy`: selects a value's characters as a user's drag would, and copies the selection with the keyboard.
//
// Every value a check compares with comes from the run: an endpoint from the emulator's port, a value from a direct
// answer. Nothing here names a port.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { BrowserContext, Locator, Page } from '@playwright/test';

import { type Ctx } from './check';
import { ACTION } from './frame';

// ---------------------------------------------------------------------------------------------------------------
// Names.
// ---------------------------------------------------------------------------------------------------------------

/**
 * A prefix `<p>` unique to the check run and to `tag`, short enough for a name of 24 characters to start with it:
 * `e`, the run id's numbers in base 36, `-`, `tag`; lower-case letters, digits and `-`, so it fits a bucket's, a
 * function's and a role's alphabet. It never starts another check's `checkPrefix` (`efit-…`): its second
 * character is a base-36 digit of the run's start time and its fifth is never `-`.
 */
export function shortPrefix(ctx: Pick<Ctx, 'runId'>, tag: string): string {
  const parts = ctx.runId.split(/[^0-9]+/).filter((part) => part !== '');
  const id =
    parts.length === 0
      ? ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')
      : parts.map((part) => Number(part).toString(36)).join('');
  return `e${id}-${tag}`;
}

/** `start` followed by `fill` up to `length` characters; throws when `start` is longer. */
export function nameOfLength(start: string, length: number, fill = 'x'): string {
  if (start.length > length) throw new Error(`${start} is longer than ${String(length)} characters`);
  return `${start}${fill.repeat(length - start.length)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The lines a value is drawn on.
// ---------------------------------------------------------------------------------------------------------------

/** How a value is drawn: one entry per line, and the value's offset where each line starts. */
export interface Drawn {
  /** The value's characters on each line, the white space between two lines left out. */
  lines: string[];
  /** For each line, the offset in the value of its first character that is not white space. */
  starts: number[];
}

/**
 * How the first visible occurrence of `value` inside `scope` is drawn, its characters taken from the text nodes of
 * the scope's first element in document order (an element between them, such as a `<wbr>`, adds no character);
 * `null` when the scope's visible text does not hold `value` character for character. Never waits.
 */
export async function drawnLines(scope: Locator, value: string): Promise<Drawn | null> {
  if ((await scope.count()) === 0) return null;
  return scope.first().evaluate(
    (root, wanted) => {
      const hidden = (el: Element): boolean => {
        for (let a: Element | null = el; a && a !== root.parentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
          if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
          if (/inset\(\s*50%/.test(cs.clipPath)) return true;
          const box = a.getBoundingClientRect();
          if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
        }
        return false;
      };
      const nodes: { node: Text; start: number }[] = [];
      let flat = '';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('script, style, template, noscript') || hidden(el)) continue;
        nodes.push({ node: n as Text, start: flat.length });
        flat += (n as Text).data;
      }
      const from = flat.indexOf(wanted);
      if (from < 0) return null;
      const at = (offset: number): [Text, number] => {
        let i = nodes.length - 1;
        while (i > 0 && nodes[i].start > offset) i--;
        return [nodes[i].node, offset - nodes[i].start];
      };
      const rectAt = (offset: number): DOMRect | null => {
        const [node, off] = at(offset);
        const range = document.createRange();
        range.setStart(node, off);
        range.setEnd(node, off + 1);
        return [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0) ?? null;
      };
      const sameLine = (a: DOMRect, b: DOMRect) => a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const starts: number[] = [];
      let line: DOMRect | null = null;
      for (let i = 0; i < wanted.length; i++) {
        if (/\s/.test(wanted[i])) continue;
        const r = rectAt(from + i);
        if (!r) continue;
        if (!line || !sameLine(line, r)) {
          starts.push(i);
          line = r;
        }
      }
      const lines = starts.map((s, k) => wanted.slice(s, k + 1 < starts.length ? starts[k + 1] : wanted.length).trim());
      return { lines, starts };
    },
    value,
    ACTION,
  );
}

/** Problems with `drawn` of a value that is to be on one line. */
export function oneLineProblems(drawn: Drawn | null, what: string): string[] {
  if (drawn === null) return [`${what}: not shown`];
  return drawn.lines.length === 1 ? [] : [`${what} is drawn on ${String(drawn.lines.length)} lines: ${show(drawn)}`];
}

/** Problems with `drawn` of a value that is to be on more than one line, each line but the last ending with `ends`. */
export function breakAfterProblems(drawn: Drawn | null, ends: string[], what: string): string[] {
  if (drawn === null) return [`${what}: not shown`];
  if (drawn.lines.length < 2) return [`${what} is drawn on one line: ${show(drawn)}`];
  const found: string[] = [];
  drawn.lines.slice(0, -1).forEach((line, k) => {
    if (!ends.some((end) => line.endsWith(end))) {
      found.push(
        `${what}: line ${String(k + 1)} of ${String(drawn.lines.length)} does not end with ${ends.join(' or ')}: ${show(drawn)}`,
      );
    }
  });
  return found;
}

/** Problems with `drawn` of `value` that is to break only at white space. */
export function breakAtSpacesProblems(drawn: Drawn | null, value: string, what: string): string[] {
  if (drawn === null) return [`${what}: not shown`];
  return drawn.starts
    .slice(1)
    .filter((s) => !/\s/.test(value[s - 1] ?? ''))
    .map((s) => `${what} breaks inside a word, before offset ${String(s)}: ${show(drawn)}`);
}

const show = (drawn: Drawn) => drawn.lines.map((l) => JSON.stringify(l)).join(' / ');

// ---------------------------------------------------------------------------------------------------------------
// The clipboard.
// ---------------------------------------------------------------------------------------------------------------

/** A value's copy control, named by its field's label (R5): "Copy {label}". */
export function copyControl(label: string): string {
  return `Copy ${label}`;
}

/** What a press of the copy control of `label` shows (R5). */
export function copiedText(label: string): string {
  return `${label} copied`;
}
export function notCopiedText(label: string): string {
  return `${label} could not be copied`;
}

/** Grants Studio's origin, and nothing else, the clipboard: a check that copies reads what was copied. */
export async function grantClipboard(context: BrowserContext, studioOrigin: string): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: studioOrigin });
}

/** Puts `text` on the clipboard, so a check sees a copy and not what was there before. */
export async function setClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

/** The clipboard's text. */
export async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Selects the characters of the first visible occurrence of `value` inside `scope` (a range over its text nodes, as
 * dragging over it does) and presses the platform's copy keys. Returns whether the value was found.
 */
export async function selectAndCopy(page: Page, scope: Locator, value: string): Promise<boolean> {
  const found = await scope.first().evaluate(
    (root, wanted) => {
      const nodes: { node: Text; start: number }[] = [];
      let flat = '';
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('script, style, template, noscript')) continue;
        if (el.getClientRects().length === 0) continue;
        nodes.push({ node: n as Text, start: flat.length });
        flat += (n as Text).data;
      }
      const from = flat.indexOf(wanted);
      if (from < 0) return false;
      const at = (offset: number, end: boolean): [Text, number] => {
        let i = nodes.length - 1;
        while (i > 0 && (end ? nodes[i].start >= offset : nodes[i].start > offset)) i--;
        return [nodes[i].node, offset - nodes[i].start];
      };
      const range = document.createRange();
      range.setStart(...at(from, false));
      range.setEnd(...at(from + wanted.length, true));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    },
    value,
    ACTION,
  );
  if (found) await page.keyboard.press('ControlOrMeta+c');
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// Text on the page.
// ---------------------------------------------------------------------------------------------------------------

/**
 * How often text matching `pattern` (a regular expression's source) is drawn on the page now: visible text only,
 * its text nodes joined in document order, so a screen reader's copy or a closed panel is not counted. Never waits.
 */
export async function timesOnPage(page: Page, pattern: string): Promise<number> {
  return page.evaluate((source) => {
    const hidden = (el: Element): boolean => {
      for (let a: Element | null = el; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
        if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
        if (/inset\(\s*50%/.test(cs.clipPath)) return true;
        const box = a.getBoundingClientRect();
        if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
      }
      return false;
    };
    let flat = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('script, style, template, noscript, title') || hidden(el)) continue;
      flat += (n as Text).data;
    }
    return [...flat.matchAll(new RegExp(source, 'g'))].length;
  }, pattern);
}

// ---------------------------------------------------------------------------------------------------------------
// The local-emulator notice.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();

/** The notice's body in every state of the connection (R3). */
export const NOTICE_BODY =
  'They are not in an AWS account. EmuForge Studio is a stand-alone local tool, not an AWS feature.';

/** The region that holds the notice. */
export const NOTICE_REGION = 'Local emulator notice';

/** Cloudscape's `Alert` content slot: the notice's body, under its heading. */
export const ALERT_CONTENT = wrapper.findAlert().findContent().toSelector();

/** The notice's body as shown, white space collapsed; `null` when the page shows no notice. */
export async function noticeBody(page: Page): Promise<string | null> {
  // The selector is rooted at the document (`createWrapper()`), so it is matched from the page and the content kept
  // is the one inside the notice's region.
  return page.evaluate(
    ([content, region]) => {
      const el = [...document.querySelectorAll(content)].find(
        (c) => c.closest(`[role="region"][aria-label="${region}"]`) !== null,
      );
      return el ? (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : null;
    },
    [ALERT_CONTENT, NOTICE_REGION],
  );
}

/** Cloudscape's `Container`. */
export const CONTAINER = wrapper.findContainer().toSelector();

/**
 * The top, in the document's coordinates, of the first container of the page's content: the first Cloudscape
 * `Container` in the main's document order that is shown and is not in the notice's region; `null` when there is
 * none (decisions.md, PM 2026-11-18 04:40, item 10).
 */
export async function firstContainerTop(page: Page): Promise<number | null> {
  // The selector is rooted at the document (`createWrapper()`), so it is matched from the page and kept inside the main.
  return page.evaluate(
    ([container, region]) => {
      const main = document.querySelector('main, [role="main"]');
      if (!main) return null;
      const el = [...main.querySelectorAll(container)].find((c) => {
        if (c.closest(`[role="region"][aria-label="${region}"]`) !== null) return false;
        const box = c.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(c).visibility !== 'hidden';
      });
      return el ? el.getBoundingClientRect().top + window.scrollY : null;
    },
    [CONTAINER, NOTICE_REGION],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The page's header.
// ---------------------------------------------------------------------------------------------------------------

/** Cloudscape's `Header` and its description slot. */
export const HEADER = wrapper.findHeader().toSelector();
export const HEADER_DESCRIPTION = wrapper.findHeader().findDescription().toSelector();

/** The header of the page: its `h1` and the description of the Cloudscape `Header` that holds it. */
export interface PageHeader {
  heading: string;
  /** The description's text, white space collapsed; `null` when the header has no description. */
  description: string | null;
}

/** The page's header (`h1` in the main, with its `Header`'s description); `null` when the main has no `h1`. */
export async function pageHeader(page: Page): Promise<PageHeader | null> {
  return page.evaluate(
    ([header, description]) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main, [role="main"]');
      const h1 = main?.querySelector('h1');
      if (!h1) return null;
      const holder = h1.closest(header);
      const desc = holder ? [...holder.querySelectorAll(description)].find((d) => d.closest(header) === holder) : null;
      const text = desc ? norm((desc as HTMLElement).innerText) : '';
      return { heading: norm(h1.innerText), description: text === '' ? null : text };
    },
    [HEADER, HEADER_DESCRIPTION],
  );
}

/** The words a header holds that say where the resources are (R3); empty when it holds none. */
export function whereWords(header: PageHeader | null): string[] {
  if (header === null) return ['no h1'];
  const text = `${header.heading} ${header.description ?? ''}`;
  return ['AWS account', 'local emulator'].filter((w) => text.includes(w));
}

// ---------------------------------------------------------------------------------------------------------------
// What "Cancel" opens on a form that holds something (R7).
// ---------------------------------------------------------------------------------------------------------------

export const DISCARD_HEADING = 'Discard what you entered?';
export const DISCARD_TEXT = 'What you entered on this page is not kept.';
export const KEEP_EDITING = 'Keep editing';
export const DISCARD = 'Discard';
export const DISCARD_CLOSE = 'Close';

/** The dialog "Discard what you entered?" and its controls. */
export function discardDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: DISCARD_HEADING, exact: true });
  return {
    dialog,
    /** Any element that shows the dialog's heading, whether or not it is named as a dialog. */
    heading: page.getByText(DISCARD_HEADING, { exact: true }),
    keepEditing: dialog.getByRole('button', { name: KEEP_EDITING, exact: true }),
    discard: dialog.getByRole('button', { name: DISCARD, exact: true }),
    close: dialog.getByRole('button', { name: DISCARD_CLOSE, exact: true }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A form's fields.
// ---------------------------------------------------------------------------------------------------------------

export const FORM_FIELD = wrapper.findFormField().toSelector();
export const FORM_FIELD_LABEL = wrapper.findFormField().findLabel().toSelector();
export const FORM_FIELD_CONSTRAINT = wrapper.findFormField().findConstraint().toSelector();
export const FORM_FIELD_ERROR = wrapper.findFormField().findError().toSelector();

/** What a field labelled `label` shows under it: its constraint text and its message, white space collapsed. */
export interface FieldTexts {
  /** How many fields of the page's main carry that label. */
  fields: number;
  constraint: string | null;
  error: string | null;
}

/** The constraint text and the message of the field of the page's main whose label is exactly `label`. */
export async function fieldTexts(page: Page, label: string): Promise<FieldTexts> {
  return page.evaluate(
    ([field, labelSel, constraintSel, errorSel, wanted]) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const main = document.querySelector('main, [role="main"]');
      if (!main) return { fields: 0, constraint: null, error: null };
      const own = (holder: Element, sel: string) =>
        [...holder.querySelectorAll(sel)].find((el) => el.closest(field) === holder) ?? null;
      const holders = [...main.querySelectorAll(field)].filter((f) => {
        const l = own(f, labelSel);
        return l !== null && norm((l as HTMLElement).innerText) === wanted;
      });
      const first = holders[0];
      const text = (el: Element | null) => {
        const t = el ? norm((el as HTMLElement).innerText) : '';
        return t === '' ? null : t;
      };
      return {
        fields: holders.length,
        constraint: first ? text(own(first, constraintSel)) : null,
        error: first ? text(own(first, errorSel)) : null,
      };
    },
    [FORM_FIELD, FORM_FIELD_LABEL, FORM_FIELD_CONSTRAINT, FORM_FIELD_ERROR, label],
  );
}

/**
 * The constraint text and the message of the field whose label is exactly `label` inside `scope`'s first element: a
 * dialog, which the area renders outside the page's main. The same reading as `fieldTexts`.
 */
export async function fieldTextsIn(scope: Locator, label: string): Promise<FieldTexts> {
  if ((await scope.count()) === 0) return { fields: 0, constraint: null, error: null };
  return scope.first().evaluate(
    (root, [field, labelSel, constraintSel, errorSel, wanted]) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const own = (holder: Element, sel: string) =>
        [...holder.querySelectorAll(sel)].find((el) => el.closest(field) === holder) ?? null;
      const holders = [...root.querySelectorAll(field)].filter((f) => {
        const l = own(f, labelSel);
        return l !== null && norm((l as HTMLElement).innerText) === wanted;
      });
      const first = holders[0];
      const text = (el: Element | null) => {
        const t = el ? norm((el as HTMLElement).innerText) : '';
        return t === '' ? null : t;
      };
      return {
        fields: holders.length,
        constraint: first ? text(own(first, constraintSel)) : null,
        error: first ? text(own(first, errorSel)) : null,
      };
    },
    [FORM_FIELD, FORM_FIELD_LABEL, FORM_FIELD_CONSTRAINT, FORM_FIELD_ERROR, label] as const,
    ACTION,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Key-value pairs and table cells.
// ---------------------------------------------------------------------------------------------------------------

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The value of the key-value pair labelled `label` in the page's main: the `dd` after the `dt` that is the label. */
export function pairValueOf(page: Page, label: string): Locator {
  return page
    .getByRole('main')
    .locator('dt')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`) })
    .first()
    .locator('xpath=following-sibling::dd[1]');
}

/**
 * The cell under the column headed `column` of the body row of `table` that holds the link `row`. A row's cells are
 * counted as the heading counts them, `th` and `td` together, since a name cell may be the row header. Fails the
 * check, naming the headings read, when the table has no such column.
 */
export async function cellUnder(table: Locator, row: string, column: string): Promise<Locator> {
  const headings = (await table.locator('thead tr').first().locator('th').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
  if (!headings.includes(column)) {
    throw new Error(`the table has no column "${column}"; its headings: ${JSON.stringify(headings)}`);
  }
  return table
    .locator('tbody tr')
    .filter({ has: table.page().getByRole('link', { name: row, exact: true }) })
    .locator('td, th')
    .nth(headings.indexOf(column));
}

// ---------------------------------------------------------------------------------------------------------------
// A copy control's place.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Problems with the place of the control `control` against the first visible occurrence of `value` in `scope` (the
 * value's element): the control must come before the value in document order, inside the same scope, with no visible
 * text between its end and the value's first character. Empty when the control is directly before the value.
 */
export async function directlyBeforeProblems(control: Locator, scope: Locator, value: string): Promise<string[]> {
  if ((await control.count()) === 0) return ['the control is not shown'];
  if ((await scope.count()) === 0) return ['the value is not shown'];
  const handle = await control.first().elementHandle(ACTION);
  return scope.first().evaluate(
    (root, [button, wanted]) => {
      const el = button as Element | null;
      if (!el) return ['the control is not shown'];
      if (!root.contains(el)) return ['the control is not inside the element that holds the value'];
      const visible = (node: Element): boolean => {
        for (let a: Element | null = node; a && a !== root.parentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
          if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return false;
          if (/inset\(\s*50%/.test(cs.clipPath)) return false;
        }
        return true;
      };
      // Visible text of the scope in document order, and the offset at which the control ends.
      let flat = '';
      let controlEnd = -1;
      let controlStart = -1;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!parent || parent.closest('script, style, template, noscript') || !visible(parent)) continue;
        if (el.contains(n)) {
          if (controlStart < 0) controlStart = flat.length;
          flat += (n as Text).data;
          controlEnd = flat.length;
          continue;
        }
        if (controlStart < 0 && el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) {
          controlStart = flat.length;
          controlEnd = flat.length;
        }
        flat += (n as Text).data;
      }
      if (controlStart < 0) {
        controlStart = flat.length;
        controlEnd = flat.length;
      }
      const at = flat.indexOf(wanted, controlEnd);
      const before = flat.indexOf(wanted);
      if (before >= 0 && before < controlStart) return ['the value comes before the control'];
      if (at < 0) return ['the value does not follow the control'];
      const between = flat.slice(controlEnd, at);
      return between.trim() === '' ? [] : [`text between the control and the value: ${JSON.stringify(between)}`];
    },
    [handle, value] as const,
    ACTION,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Added by issue 467's S3 unit (t3): what S3's screens need beside the readers above.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The descriptions of every Cloudscape `Header` in the page's main, as shown, white space collapsed; empty when no
 * header there shows one. On a list whose table holds its own header (the S3 bucket list), the table's description
 * stands between the page's `h1` and the table's controls, which `pageHeader` does not read. Never waits.
 */
export async function headerDescriptions(page: Page): Promise<string[]> {
  // The selector is rooted at the document (`createWrapper()`), so it is matched from the page and kept inside the main.
  return page.evaluate((description) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main, [role="main"]');
    if (!main) return [];
    return [...document.querySelectorAll(description)]
      .filter((d) => main.contains(d) && (d as HTMLElement).getClientRects().length > 0)
      .map((d) => norm((d as HTMLElement).innerText))
      .filter((t) => t !== '');
  }, HEADER_DESCRIPTION);
}

/**
 * The cell under the column headed `column` of the body row of `table` that has a cell reading exactly `text` (a row
 * without a link, such as a tag's). Cells are counted as `cellUnder` counts them, `th` and `td` together. Fails the
 * check, naming the headings read, when the table has no such column.
 */
export async function cellUnderRowWith(table: Locator, text: string, column: string): Promise<Locator> {
  const headings = (await table.locator('thead tr').first().locator('th').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
  if (!headings.includes(column)) {
    throw new Error(`the table has no column "${column}"; its headings: ${JSON.stringify(headings)}`);
  }
  const exactly = new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
  return (
    table
      .locator('tbody tr')
      // An inner locator of `has` is matched inside each row, so it is rooted at the page as `cellUnder`'s is.
      .filter({ has: table.page().locator('td, th').filter({ hasText: exactly }) })
      .locator('td, th')
      .nth(headings.indexOf(column))
  );
}

/** What a table's box does against the element it scrolls in: the table's width and that element's. */
export interface TableFit {
  tableWidth: number;
  /** The width of the nearest element around the table that scrolls sideways or clips, else the table's parent. */
  boxWidth: number;
}

/** How wide `table`'s first element is drawn against the box it scrolls in; `null` when there is no table. */
export async function tableFit(table: Locator): Promise<TableFit | null> {
  if ((await table.count()) === 0) return null;
  return table.first().evaluate(
    (el) => {
      let box: Element | null = el.parentElement;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(a).overflowX)) {
          box = a;
          break;
        }
      }
      return {
        tableWidth: el.getBoundingClientRect().width,
        boxWidth: (box ?? el).getBoundingClientRect().width,
      };
    },
    undefined,
    ACTION,
  );
}

/**
 * The visible texts of the page's main drawn in the band from the bottom of `above` to the top of the highest of
 * `below` (viewport coordinates, as the page is scrolled now), leaving out the texts of headings (a title with its
 * counter), links, buttons and tab lists: what stands between two parts of a page besides their own controls. Each
 * text node is one entry, white space collapsed. `null` when `above` or every `below` is not shown. Never waits.
 */
export async function textsBetween(page: Page, above: Locator, below: Locator[]): Promise<string[] | null> {
  const top =
    (await above
      .first()
      .boundingBox()
      .catch(() => null)) ?? null;
  const bottoms: number[] = [];
  for (const b of below) {
    const box = await b
      .first()
      .boundingBox()
      .catch(() => null);
    if (box) bottoms.push(box.y);
  }
  if (top === null || bottoms.length === 0) return null;
  return page.evaluate(
    ([from, to]) => {
      const hidden = (el: Element): boolean => {
        for (let a: Element | null = el; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
          if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
          if (/inset\(\s*50%/.test(cs.clipPath)) return true;
          const box = a.getBoundingClientRect();
          if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
        }
        return false;
      };
      const main = document.querySelector('main, [role="main"]');
      if (!main) return [];
      const own = 'h1, h2, h3, h4, h5, h6, a, button, [role="button"], [role="link"], [role="tablist"]';
      const found: string[] = [];
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n as Text).data.replace(/\s+/g, ' ').trim();
        const el = n.parentElement;
        if (text === '' || !el || el.closest(`script, style, template, noscript, ${own}`) || hidden(el)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.some((r) => r.top >= from - 1 && r.bottom <= to + 1)) found.push(text);
      }
      return found;
    },
    [top.y + top.height, Math.min(...bottoms)] as const,
  );
}
