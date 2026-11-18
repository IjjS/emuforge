// What Home's "Connection" section shows, read from the page the way a user reads it, in Studio's own elements found
// by role and name (requirement R9.1, R9.3; test-criteria.md, issue 16): the region named "Connection", its "Engine"
// and "Emulator" rows (the row's status text and all its text) and the notices under the rows, each named by its
// heading. Used by the Home checks of issues 3 and 16 (`home.spec.ts`, `safety.spec.ts`).

import fs from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

/** The status texts a row shows (requirement R9.1). */
export const STATUSES = ['Checking', 'Connected', 'Not started', 'Unreachable', 'Error', 'Unknown'];

/** One row of the "Connection" section. */
export interface RowView {
  /** The row's status text; `null` when the row shows none of `STATUSES`, or more than one. */
  status: string | null;
  /** All visible text of the row, whitespace collapsed: the label, the status and the address. */
  text: string;
}

export interface ConnectionView {
  /** The "Engine" row; `null` when the page has no Studio "Connection" region or no row labelled "Engine". */
  engine: RowView | null;
  /** The "Emulator" row; `null` likewise. */
  emulator: RowView | null;
  /** How many notices the section holds. */
  notices: number;
  /** The visible text of the section's notices, whitespace collapsed; `''` when it holds none. */
  notice: string;
}

/**
 * Reads the "Connection" section once. Never waits: a page without it reads as `null` rows.
 *
 * - The section is the element with role `region` and accessible name "Connection" that is Studio's own: neither it
 *   nor an element around it carries a Cloudscape class (a class starting with `awsui`).
 * - A notice is the largest element inside the section that holds a heading other than "Connection" and none of the
 *   rows' labels.
 * - A row is the smallest element around the element whose text is exactly the row's label (outside every notice)
 *   that also holds an element whose text is exactly one of `STATUSES`.
 */
export async function connectionView(page: Page): Promise<ConnectionView> {
  const regions = page.getByRole('region', { name: 'Connection', exact: true });
  const views = await regions.evaluateAll((found, statuses) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el: Element) => norm((el as HTMLElement).innerText);
    const cloudscape = (el: Element | null): boolean => {
      for (let at = el; at; at = at.parentElement) {
        if ([...at.classList].some((c) => c.startsWith('awsui'))) return true;
      }
      return false;
    };
    const box = found.filter((r) => !cloudscape(r)).at(-1);
    if (!box) return null;
    const exactly = (text: string) =>
      [...box.querySelectorAll('*')].filter(
        (el) => norm(el.textContent) === text && ![...el.children].some((child) => norm(child.textContent) === text),
      );
    const labels = [...exactly('Engine'), ...exactly('Emulator')];
    const headings = [...box.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].filter(
      (h) => norm(h.textContent) !== 'Connection',
    );
    const notices: Element[] = [];
    for (const heading of headings) {
      let el: Element = heading;
      while (el.parentElement && el.parentElement !== box && !labels.some((l) => el.parentElement!.contains(l))) {
        el = el.parentElement;
      }
      if (labels.some((l) => el.contains(l))) continue;
      if (!notices.some((n) => n.contains(el))) notices.push(el);
    }
    const row = (label: string) => {
      const own = exactly(label).find((el) => !notices.some((n) => n.contains(el)));
      if (!own) return null;
      for (let scope = own.parentElement; scope && box.contains(scope); scope = scope.parentElement) {
        const shown = [...scope.querySelectorAll('*')].filter(
          (el) =>
            !notices.some((n) => n.contains(el)) &&
            statuses.includes(norm(el.textContent)) &&
            ![...el.children].some((child) => norm(child.textContent) === norm(el.textContent)),
        );
        if (shown.length === 0) continue;
        const distinct = [...new Set(shown.map((el) => norm(el.textContent)))];
        return { status: distinct.length === 1 ? distinct[0] : null, text: visible(scope) };
      }
      return null;
    };
    return {
      engine: row('Engine'),
      emulator: row('Emulator'),
      notices: notices.length,
      notice: notices.map(visible).join(' '),
    };
  }, STATUSES);
  return views ?? { engine: null, emulator: null, notices: 0, notice: '' };
}

/** A pattern matching `<flag> <port>` not followed by another digit, as a command line names a port. */
export function flagWithPort(flag: string, port: number): RegExp {
  return new RegExp(`${flag.replace(/[-]/g, '\\-')} ${String(port)}(?!\\d)`);
}

/**
 * Leaves a mark in the page's window. `stillSamePage` is true only while that document is the one shown: a reload
 * or a full navigation drops the mark. Proves "without reloading the page".
 */
export async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __emuforgeItMark?: boolean }).__emuforgeItMark = true;
  });
}

export async function stillSamePage(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __emuforgeItMark?: boolean }).__emuforgeItMark === true);
}

/** `studio/src/providers/aws/area/services/` of the checkout under test, beside this file. */
const SERVICES_DIR = path.resolve(__dirname, '../../../../studio/src/providers/aws/area/services');

/** The order of the services list (issue 386, requirement R13.2): by label, English, ignoring case. */
const compareLabels = new Intl.Collator('en', { sensitivity: 'base' }).compare;

/**
 * The service labels (requirement R5.2, R9.2), in label order, as the AWS area and Home's "Providers" list them: the
 * `label` of each folder's `service.json` under `SERVICES_DIR`, read at run time when this file loads, sorted by
 * `compareLabels` (issue 386, R13.5). A folder without a `service.json` gives no label.
 */
export const SERVICE_LABELS: string[] = fs
  .readdirSync(SERVICES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SERVICES_DIR, entry.name, 'service.json')))
  .map((entry) => {
    const file = JSON.parse(fs.readFileSync(path.join(SERVICES_DIR, entry.name, 'service.json'), 'utf8')) as {
      label?: unknown;
    };
    return typeof file.label === 'string' ? file.label : '';
  })
  .sort(compareLabels);

/** The lines of the start command for `port` (requirement 3.3), trimmed. */
export function startCommandLines(port: number): string[] {
  return [
    'E=$HOME/.aws/emulator',
    `P=${String(port)}`,
    'docker run -d \\',
    '--name \\',
    'emuforge-emulator-$P \\',
    '-p 127.0.0.1:$P:$P \\',
    '-e HOME=$HOME \\',
    '-v $E:$E \\',
    'aws-emulator \\',
    '-p $P -t off',
  ];
}

/**
 * The lines of the engine command (requirement 3.2, 3.3) shown after a first check that got no answer, trimmed. The
 * last one is matched without its continuation: whether `--emulator-port` follows depends on earlier answers.
 */
export function engineCommandLines(enginePort: number, studioPort: number): string[] {
  return [
    'cargo run \\',
    '-p emuforge -- serve \\',
    `--port ${String(enginePort)} \\`,
    `--studio-port ${String(studioPort)}`,
  ];
}

export interface LayoutIssues {
  /** The page itself scrolls sideways. */
  pageScrolls: boolean;
  /** Visible elements that scroll sideways (`overflow-x` auto or scroll, content wider than the box). */
  scrolling: string[];
  /** Command lines that take more than one line on screen. */
  wrapped: string[];
  /** Command lines that are not shown on the page at all. */
  missing: string[];
}

/**
 * Measures the page as it is drawn now: sideways scrolling of the page and of any visible element, and for each of
 * `lines` the first visible place where that text is drawn, which must sit on one line (its boxes overlap
 * vertically). Text split over several elements (highlighting, one element per line) is followed across them.
 */
export async function layoutIssues(page: Page, lines: string[]): Promise<LayoutIssues> {
  return page.evaluate((wanted) => {
    const root = document.documentElement;
    const out = {
      pageScrolls: root.scrollWidth > root.clientWidth,
      scrolling: [] as string[],
      wrapped: [] as string[],
      missing: [] as string[],
    };
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
      if (el.getClientRects().length === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.scrolling.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`,
        );
      }
    }
    const nodes: { node: Text; start: number }[] = [];
    let flat = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n as Text, start: flat.length });
      flat += (n as Text).data;
    }
    const at = (offset: number): [Text, number] => {
      let i = nodes.length - 1;
      while (i > 0 && nodes[i].start > offset) i--;
      return [nodes[i].node, offset - nodes[i].start];
    };
    for (const line of wanted) {
      let shown = false;
      for (let from = flat.indexOf(line); from >= 0 && !shown; from = flat.indexOf(line, from + 1)) {
        const range = document.createRange();
        const [startNode, startOffset] = at(from);
        const [endNode, endOffset] = at(from + line.length - 1);
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset + 1);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.length === 0) continue;
        shown = true;
        const top = Math.min(...rects.map((r) => r.top));
        const firstBottom = Math.min(...rects.filter((r) => r.top === top).map((r) => r.bottom));
        if (rects.some((r) => r.top >= firstBottom - 1)) out.wrapped.push(line);
      }
      if (!shown) out.missing.push(line);
    }
    return out;
  }, lines);
}

/** One thing a notice shows, in the order it is drawn (`noticeItems`). */
export type NoticeItem =
  | {
      /** A run of text in one block (a paragraph, a step's label), whitespace collapsed. */
      kind: 'text';
      text: string;
      /** The text as it is drawn, one entry per line on screen, whitespace collapsed. */
      drawn: string[];
      top: number;
      bottom: number;
    }
  | {
      /** A command (`pre`): its lines exactly as in the page, leading spaces kept. */
      kind: 'command';
      lines: string[];
      /** The command as it is drawn, one entry per line on screen, trimmed. */
      drawn: string[];
      top: number;
      bottom: number;
    }
  | {
      /** A button, by its accessible name (`aria-label`, else its text). */
      kind: 'button';
      name: string;
      top: number;
      bottom: number;
    };

/**
 * Reads the visible content of the notice titled `title` in Home's "Connection" section (found as `connectionView`
 * finds notices), in document order, which is the order it is drawn: its texts (the heading, paragraphs, each
 * step's label), its commands and its buttons (the copy buttons by name, the build-once toggle). Hidden content
 * (a closed disclosure) and `aria-hidden` content are left out. `null` when the section holds no such notice. Never
 * waits.
 *
 * Text is grouped by its block: the nearest element around it whose display is neither inline nor `contents`, so
 * a label with an inline span in it (`st-nowrap`) reads as one text. `drawn` splits an item at the line breaks on
 * screen, so a check can tell whether a name in a label sits on one line or a command line wraps.
 */
export async function noticeItems(page: Page, title: string): Promise<NoticeItem[] | null> {
  const regions = page.getByRole('region', { name: 'Connection', exact: true });
  return regions.evaluateAll((found, wanted) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const cloudscape = (el: Element | null): boolean => {
      for (let at = el; at; at = at.parentElement) {
        if ([...at.classList].some((c) => c.startsWith('awsui'))) return true;
      }
      return false;
    };
    const box = found.filter((r) => !cloudscape(r)).at(-1);
    if (!box) return null;
    const exactly = (text: string) =>
      [...box.querySelectorAll('*')].filter(
        (el) => norm(el.textContent) === text && ![...el.children].some((child) => norm(child.textContent) === text),
      );
    const labels = [...exactly('Engine'), ...exactly('Emulator')];
    const heading = [...box.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].find(
      (h) => norm(h.textContent) === wanted,
    );
    if (!heading) return null;
    let notice: Element = heading;
    while (
      notice.parentElement &&
      notice.parentElement !== box &&
      !labels.some((l) => notice.parentElement!.contains(l))
    ) {
      notice = notice.parentElement;
    }

    /** The characters of `nodes` with a box on screen, split into the lines they are drawn on. */
    const drawnLines = (nodes: Text[]): { lines: string[]; top: number; bottom: number } | null => {
      const lines: string[] = [];
      let current = '';
      let lineBottom = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      let pendingSpace = false;
      for (const node of nodes) {
        for (let i = 0; i < node.data.length; i++) {
          const ch = node.data[i];
          if (ch === '\n' || /\s/.test(ch)) {
            pendingSpace = true;
            continue;
          }
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0);
          if (!rect) continue;
          top = Math.min(top, rect.top);
          bottom = Math.max(bottom, rect.bottom);
          if (current !== '' && rect.top >= lineBottom - 1) {
            lines.push(current);
            current = '';
            pendingSpace = false;
          }
          if (current === '') lineBottom = rect.bottom;
          current += (pendingSpace && current !== '' ? ' ' : '') + ch;
          pendingSpace = false;
          lineBottom = Math.min(lineBottom, rect.bottom);
        }
      }
      if (current !== '') lines.push(current);
      return lines.length === 0 ? null : { lines, top, bottom };
    };

    const textsIn = (el: Element): Text[] => {
      const out: Text[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
      return out;
    };
    const blockOf = (node: Node): Element => {
      let at = node.parentElement!;
      while (at !== notice) {
        const display = getComputedStyle(at).display;
        if (!display.startsWith('inline') && display !== 'contents') break;
        at = at.parentElement!;
      }
      return at;
    };

    type Item =
      | { kind: 'text'; text: string; drawn: string[]; top: number; bottom: number }
      | { kind: 'command'; lines: string[]; drawn: string[]; top: number; bottom: number }
      | { kind: 'button'; name: string; top: number; bottom: number };
    const items: Item[] = [];
    let run: { block: Element; nodes: Text[] } | null = null;
    const flush = () => {
      if (!run) return;
      const drawn = drawnLines(run.nodes);
      if (drawn) {
        items.push({
          kind: 'text',
          text: norm(run.nodes.map((n) => n.data).join('')),
          drawn: drawn.lines,
          top: drawn.top,
          bottom: drawn.bottom,
        });
      }
      run = null;
    };
    const visit = (el: Element) => {
      if (el.getAttribute('aria-hidden') === 'true' || (el as HTMLElement).hidden) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'pre' || tag === 'button') {
        flush();
        const rects = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.length === 0) return;
        const top = Math.min(...rects.map((r) => r.top));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        if (tag === 'button') {
          items.push({ kind: 'button', name: norm(el.getAttribute('aria-label') ?? el.textContent), top, bottom });
        } else {
          const drawn = drawnLines(textsIn(el));
          items.push({
            kind: 'command',
            lines: (el.textContent ?? '').split('\n'),
            drawn: drawn ? drawn.lines : [],
            top,
            bottom,
          });
        }
        return;
      }
      for (const child of el.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          visit(child as Element);
        } else if (child.nodeType === Node.TEXT_NODE) {
          const block = blockOf(child);
          if (run && run.block !== block) flush();
          if (!run) run = { block, nodes: [] };
          run.nodes.push(child as Text);
        }
      }
    };
    visit(notice);
    flush();
    return items;
  }, title);
}
