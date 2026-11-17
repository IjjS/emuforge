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

/** The top of `locator`'s first element in the document's coordinates, in CSS pixels; `null` when there is none. */
export async function topOf(locator: Locator): Promise<number | null> {
  if ((await locator.count()) === 0) return null;
  return locator.first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY, undefined, ACTION);
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
  const body = page.getByRole('region', { name: NOTICE_REGION, exact: true }).locator(ALERT_CONTENT);
  if ((await body.count()) === 0) return null;
  return (await body.first().innerText(ACTION)).replace(/\s+/g, ' ').trim();
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
