// Home's two status rows, Engine and Emulator, as the built app draws them (issue 60, requirement R5; test-criteria.md,
// issue 60, Flow). Used by `addresses.spec.ts`.
//
// Words, as `test-criteria.md` defines them:
//
// - "The widths": every even width from 320 to 520, then 640, 641, 768, 1024 and 1280, the window 844 high.
// - "A row": the `div` inside the description list that holds a term (`dt`) and its definition (`dd`); its label is
//   the term, found by its text, which is the language's word for "Engine" or "Emulator" read from that language's
//   catalogue. "The row's inner width" is its content box: its box less its borders and padding.
// - "The status": the smallest element in the definition whose text is one of the six status words of the language
//   (read from its catalogue by the English words of requirement R6), its icon included.
// - "The address": the smallest element in the definition whose text, white space collapsed, is the address; "its
//   own box" is the nearest element around its text, the address's element included, whose display is neither
//   `inline` nor `contents`. "-": the visible text "-" in the definition.
// - "Whole": each character of the address (white space aside) has a box on screen; all of them are on one line
//   (their boxes overlap vertically by more than 1px); none lies outside the address's own box or the row's inner
//   box by more than 1px; no element around the address whose `overflow-x` is not `visible` leaves a character
//   outside its box; and neither the address's element nor its box shows an ellipsis (`text-overflow: ellipsis`
//   with content wider than the box).
// - "The page scrolls sideways": the document is wider than its viewport.
// - "The first command of the notice under the rows": the first `pre` that follows the rows' list in the nearest
//   element around the list that holds one; it "starts within the first screen" when the page is not scrolled and
//   the box of its first character lies inside the viewport.
//
// Every text of another language is read from the catalogue files of the checkout under test at run time; no message
// key is named and no translation is copied.

import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

import { type Ctx } from './check';
import { STATUSES } from './home';
import { type Scheme } from './layers';
import { languageContext, readCatalogue, settled, translationOf } from './languages';
import { type StudioServer } from './studio';
import { waitFor } from './wait';
import { WRAP_HEIGHT, type HomeState } from './wrapping';

/** Requirement 3.4 of issue 3: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

/** Every even width from 320 to 520, then 640, 641, 768, 1024 and 1280. */
export const ADDRESS_WIDTHS: readonly number[] = [
  ...Array.from({ length: (520 - 320) / 2 + 1 }, (_, i) => 320 + 2 * i),
  640,
  641,
  768,
  1024,
  1280,
];

/** The lowest port of five digits. */
export const FIVE_DIGITS = 10_000;

// ---------------------------------------------------------------------------------------------------------------
// The rows' words in one language, read from its catalogue.
// ---------------------------------------------------------------------------------------------------------------

export interface RowWords {
  tag: string;
  /** The texts the language's catalogue gives for the English label "Engine". */
  engine: string[];
  /** Likewise for "Emulator". */
  emulator: string[];
  /** Likewise for each status word of requirement R6, by its English word. */
  status: Record<string, string[]>;
  /** Every status word of the language. */
  statuses: string[];
}

/**
 * The labels and status words of the rows in `tag`, read from the catalogues of the checkout under test as they are
 * on disk now. Throws, naming what is missing, when a catalogue lacks one.
 */
export function rowWords(ctx: Ctx, tag: string): RowWords {
  const en = readCatalogue(ctx, 'en');
  const other = readCatalogue(ctx, tag);
  const of = (english: string) => [...new Set(translationOf(en, other, english))];
  const status: Record<string, string[]> = {};
  for (const word of STATUSES) status[word] = of(word);
  const words = { tag, engine: of('Engine'), emulator: of('Emulator'), status, statuses: Object.values(status).flat() };
  ctx.log(
    `${tag}: labels ${JSON.stringify(words.engine)} ${JSON.stringify(words.emulator)}, statuses ${JSON.stringify(status)}`,
  );
  return words;
}

// ---------------------------------------------------------------------------------------------------------------
// One measure of the rows as drawn now.
// ---------------------------------------------------------------------------------------------------------------

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Face {
  /** The first family of the computed `font-family`, without quotes. */
  family: string;
  /** The computed `font-family`. */
  families: string;
  /** The computed `font-size`. */
  size: string;
}

export interface AddressDrawn {
  /** The address's element's text, white space collapsed. */
  text: string;
  /** The address's own box, and what it is. */
  box: Box;
  boxIs: string;
  /** Characters of the address, white space aside; and how many of them have a box on screen. */
  chars: number;
  drawn: number;
  /** The address as drawn, one entry per line. */
  lines: string[];
  /** Characters outside the address's own box, and outside the row's inner box. */
  outsideBox: number;
  outsideRow: number;
  /** Elements around the address whose `overflow-x` is not `visible` that leave a character outside their box. */
  cutBy: string[];
  /** Elements (the address's own, its box) that show an ellipsis. */
  ellipsis: string[];
  /** The box of its first character, and the top of its highest character. */
  first: Box | null;
  top: number;
  face: Face;
}

export interface DashDrawn {
  box: Box;
  face: Face;
}

export interface RowDrawn {
  /** Why the row could not be measured; `null` when it was. */
  missing: string | null;
  /** The definition's visible text, white space collapsed. */
  shown: string;
  row: Box;
  /** The row's content box. */
  inner: Box;
  /** The label's drawn text and its element's box. */
  label: Box;
  labelBox: Box;
  labelFace: Face;
  /** What is topmost at the centre of the label's element; `null` when it is the label itself. */
  overLabel: string | null;
  status: { word: string; box: Box; face: Face } | null;
  /** The address the check expects in this row, when it expects one and the row shows it. */
  address: AddressDrawn | null;
  dash: DashDrawn | null;
}

export interface RowsDrawn {
  engine: RowDrawn;
  emulator: RowDrawn;
  pageScrolls: boolean;
}

/** The addresses the check expects in the rows; `null` for a row that shows none (or whose address is not read). */
export interface Expected {
  engine: string | null;
  emulator: string | null;
}

/** Measures both rows as the page draws them now. Never waits. */
export async function rowsDrawn(page: Page, words: RowWords, expected: Expected): Promise<RowsDrawn> {
  return page.evaluate(
    ({ labels, statuses, expected: wanted }) => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const box = (r: DOMRect) => ({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      });
      const describe = (el: Element | null) => {
        if (!el) return '(nothing)';
        const cls = el.classList.length > 0 ? `.${[...el.classList].slice(0, 2).join('.')}` : '';
        return `${el.tagName.toLowerCase()}${cls}`;
      };
      const face = (el: Element) => {
        const cs = getComputedStyle(el);
        return {
          family: cs.fontFamily
            .split(',')[0]
            .trim()
            .replace(/^["']|["']$/g, ''),
          families: cs.fontFamily,
          size: cs.fontSize,
        };
      };
      const charBox = (node: Text, i: number) => {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        return [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0) ?? null;
      };
      const sameLine = (a: DOMRect, b: DOMRect) => a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const textsIn = (el: Element) => {
        const out: Text[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
        return out;
      };
      const smallestWithText = (scope: Element, text: (t: string) => boolean) =>
        [...scope.querySelectorAll('*')].find(
          (el) => text(norm(el.textContent)) && ![...el.children].some((c) => text(norm(c.textContent))),
        ) ?? null;
      const blockOf = (el: Element) => {
        let at = el;
        while (at.parentElement && /^(inline|contents)$/.test(getComputedStyle(at).display)) at = at.parentElement;
        return at;
      };
      const empty = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
      const face0 = { family: '', families: '', size: '' };

      const measure = (names: string[], address: string | null) => {
        const out = {
          missing: null as string | null,
          shown: '',
          row: empty,
          inner: empty,
          label: empty,
          labelBox: empty,
          labelFace: face0,
          overLabel: null as string | null,
          status: null as { word: string; box: ReturnType<typeof box>; face: ReturnType<typeof face> } | null,
          address: null as unknown,
          dash: null as { box: ReturnType<typeof box>; face: ReturnType<typeof face> } | null,
        };
        const dt = [...document.querySelectorAll('main dt')].find((el) => names.includes(norm(el.textContent)));
        if (!dt) {
          out.missing = `no term ${JSON.stringify(names)} on the page`;
          return out;
        }
        const row = dt.parentElement;
        if (!row || row.tagName !== 'DIV' || row.parentElement?.tagName !== 'DL') {
          out.missing = `the term ${JSON.stringify(norm(dt.textContent))} is not in a div of a description list`;
          return out;
        }
        const dd = row.querySelector('dd');
        if (!dd) {
          out.missing = `the row ${JSON.stringify(norm(dt.textContent))} holds no definition`;
          return out;
        }
        out.shown = norm((dd as HTMLElement).innerText);
        const rr = row.getBoundingClientRect();
        const rcs = getComputedStyle(row);
        const px = (v: string) => parseFloat(v) || 0;
        const innerLeft = rr.left + px(rcs.borderLeftWidth) + px(rcs.paddingLeft);
        const innerRight = rr.right - px(rcs.borderRightWidth) - px(rcs.paddingRight);
        const innerTop = rr.top + px(rcs.borderTopWidth) + px(rcs.paddingTop);
        const innerBottom = rr.bottom - px(rcs.borderBottomWidth) - px(rcs.paddingBottom);
        out.row = box(rr);
        out.inner = box(new DOMRect(innerLeft, innerTop, innerRight - innerLeft, innerBottom - innerTop));
        const labelRange = document.createRange();
        labelRange.selectNodeContents(dt);
        out.label = box(labelRange.getBoundingClientRect());
        const lb = dt.getBoundingClientRect();
        out.labelBox = box(lb);
        const labelText = textsIn(dt).find((n) => norm(n.data) !== '');
        out.labelFace = face(labelText?.parentElement ?? dt);
        const top = document.elementFromPoint(lb.left + lb.width / 2, lb.top + lb.height / 2);
        out.overLabel = top && (top === dt || dt.contains(top)) ? null : describe(top);

        const statusEl = smallestWithText(dd, (t) => statuses.includes(t));
        if (statusEl) {
          const word = norm(statusEl.textContent);
          const wordNode = textsIn(statusEl).find((n) => norm(n.data) === word);
          out.status = {
            word,
            box: box(statusEl.getBoundingClientRect()),
            face: face(wordNode?.parentElement ?? statusEl),
          };
        }

        if (address !== null) {
          const el = smallestWithText(dd, (t) => t === address);
          if (el) {
            const own = blockOf(el);
            const ob = own.getBoundingClientRect();
            const chars: DOMRect[] = [];
            let count = 0;
            const lines: string[] = [];
            let line = '';
            let lineBox: DOMRect | null = null;
            for (const node of textsIn(el)) {
              for (let i = 0; i < node.data.length; i++) {
                if (/\s/.test(node.data[i])) continue;
                count++;
                const r = charBox(node, i);
                if (!r) continue;
                chars.push(r);
                if (lineBox && !sameLine(lineBox, r)) {
                  lines.push(line);
                  line = '';
                  lineBox = null;
                }
                if (!lineBox) lineBox = r;
                line += node.data[i];
              }
            }
            if (line !== '') lines.push(line);
            const outside = (r: DOMRect, l: number, rt: number) => r.left < l - 1 || r.right > rt + 1;
            const cutBy: string[] = [];
            for (let a: Element | null = el; a; a = a.parentElement) {
              if (getComputedStyle(a).overflowX === 'visible') continue;
              const ab = a.getBoundingClientRect();
              if (chars.some((r) => outside(r, ab.left, ab.right) || r.top < ab.top - 1 || r.bottom > ab.bottom + 1)) {
                cutBy.push(describe(a));
              }
            }
            const ellipsis = [...new Set([el, own])]
              .filter((x) => getComputedStyle(x).textOverflow === 'ellipsis' && x.scrollWidth > x.clientWidth + 1)
              .map(describe);
            out.address = {
              text: norm(el.textContent),
              box: box(ob),
              boxIs: describe(own),
              chars: count,
              drawn: chars.length,
              lines,
              outsideBox: chars.filter((r) => outside(r, ob.left, ob.right)).length,
              outsideRow: chars.filter((r) => outside(r, innerLeft, innerRight)).length,
              cutBy,
              ellipsis,
              first: chars.length > 0 ? box(chars[0]) : null,
              top: chars.length > 0 ? Math.min(...chars.map((r) => r.top)) : 0,
              face: face(el),
            };
          }
        }

        for (const node of textsIn(dd)) {
          if (norm(node.data) !== '-') continue;
          const i = node.data.indexOf('-');
          const r = charBox(node, i);
          if (!r || r.width <= 1 || r.height <= 1) continue;
          out.dash = { box: box(r), face: face(node.parentElement!) };
          break;
        }
        return out;
      };

      const de = document.documentElement;
      return {
        engine: measure(labels.engine, wanted.engine),
        emulator: measure(labels.emulator, wanted.emulator),
        pageScrolls: de.scrollWidth > de.clientWidth,
      };
    },
    { labels: { engine: words.engine, emulator: words.emulator }, statuses: words.statuses, expected },
  ) as Promise<RowsDrawn>;
}

// ---------------------------------------------------------------------------------------------------------------
// What a measure says, in the words of the criteria lines.
// ---------------------------------------------------------------------------------------------------------------

/** Why the address of `row` is not shown as `address` and whole; empty when it is. */
export function notWhole(row: RowDrawn, address: string): string[] {
  if (row.missing) return [row.missing];
  const a = row.address;
  if (!a) return [`the row shows ${JSON.stringify(row.shown)}, not ${address}`];
  const out: string[] = [];
  if (a.drawn < a.chars) out.push(`${String(a.chars - a.drawn)} of its ${String(a.chars)} characters are not drawn`);
  if (a.lines.length !== 1) out.push(`it is on ${String(a.lines.length)} lines ${JSON.stringify(a.lines)}`);
  if (a.outsideBox > 0) {
    out.push(
      `${String(a.outsideBox)} characters are outside its box ${a.boxIs} (${a.box.left.toFixed(0)}-${a.box.right.toFixed(0)})`,
    );
  }
  if (a.outsideRow > 0) {
    out.push(
      `${String(a.outsideRow)} characters are outside its row (${row.inner.left.toFixed(0)}-${row.inner.right.toFixed(0)})`,
    );
  }
  for (const c of a.cutBy) out.push(`it is cut by ${c}`);
  for (const e of a.ellipsis) out.push(`it is cut with an ellipsis in ${e}`);
  return out;
}

/** Why "-" is not shown inside the row's inner box; empty when it is. */
export function dashNotInRow(row: RowDrawn): string[] {
  if (row.missing) return [row.missing];
  if (!row.dash) return [`the row shows ${JSON.stringify(row.shown)}, no "-"`];
  const d = row.dash.box;
  const i = row.inner;
  if (d.left < i.left - 1 || d.right > i.right + 1 || d.top < i.top - 1 || d.bottom > i.bottom + 1) {
    return [`"-" (${d.left.toFixed(0)},${d.top.toFixed(0)}) is outside its row's inner box (${fmt(i)})`];
  }
  return [];
}

export function fmt(b: Box): string {
  return `${b.left.toFixed(0)},${b.top.toFixed(0)} ${b.width.toFixed(0)}x${b.height.toFixed(0)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Home in one of its states, in one language; changes made in the open page.
// ---------------------------------------------------------------------------------------------------------------

export interface RowsPage {
  context: BrowserContext;
  page: Page;
}

/** Whether the rows show `state`, by their status words and, with the engine stopped, the Emulator row's "-". */
function shows(drawn: RowsDrawn, words: RowWords, state: HomeState): boolean {
  const is = (row: RowDrawn, english: string) => row.status !== null && words.status[english].includes(row.status.word);
  if (state === 'connected') return is(drawn.engine, 'Connected') && is(drawn.emulator, 'Connected');
  if (state === 'emulator stopped') return is(drawn.engine, 'Connected') && is(drawn.emulator, 'Not started');
  return is(drawn.engine, 'Unreachable') && drawn.emulator.dash !== null;
}

/**
 * Opens a context with the stored choice `words.tag` and `scheme`, and `/` in it at `width` x 844, and waits until the
 * rows show `state`: "connected", both rows say the language's "Connected"; "emulator stopped", the Emulator row says
 * its "Not started"; "engine unreachable", the Engine row says its "Unreachable" and the Emulator row shows "-".
 * Throws, naming what the rows show, after 10 seconds.
 */
export async function openRows(
  ctx: Ctx,
  browser: Browser,
  proxy: BrowserContextOptions['proxy'],
  studio: StudioServer,
  words: RowWords,
  state: HomeState,
  width = 1280,
  scheme: Scheme = 'light',
): Promise<RowsPage> {
  const { context, page } = await languageContext(ctx, browser, proxy, studio, { stored: words.tag, width, scheme });
  await page.setViewportSize({ width, height: WRAP_HEIGHT });
  await page.goto('/');
  let last: RowsDrawn | null = null;
  const seen = await waitFor(CHANGE_BOUND_MS, async () => {
    last = await rowsDrawn(page, words, { engine: null, emulator: null });
    return shows(last, words, state) ? true : undefined;
  });
  if (!seen) {
    const l = last as RowsDrawn | null;
    const said = l
      ? `Engine ${JSON.stringify(l.engine.missing ?? l.engine.shown)}, Emulator ${JSON.stringify(l.emulator.missing ?? l.emulator.shown)}`
      : 'nothing';
    throw new Error(`${words.tag} ${state}: the rows do not show the state within 10s (${said})`);
  }
  await settled(page);
  return { context, page };
}

/** Replaces the text of the element that draws `from` in the row labelled one of `labels` with `to`; false when none. */
export async function replaceAddress(page: Page, labels: string[], from: string, to: string): Promise<boolean> {
  const done = await page.evaluate(
    ({ names, a, b }) => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const dt = [...document.querySelectorAll('main dt')].find((el) => names.includes(norm(el.textContent)));
      const dd = dt?.parentElement?.querySelector('dd');
      if (!dd) return false;
      const el = [...dd.querySelectorAll('*')].find(
        (x) => norm(x.textContent) === a && ![...x.children].some((c) => norm(c.textContent) === a),
      );
      if (!el) return false;
      el.textContent = b;
      return true;
    },
    { names: labels, a: from, b: to },
  );
  await settled(page);
  return done;
}

/** Sets `font-size` on the element that draws each of `addresses` in the rows; how many it found. */
export async function sizeAddresses(page: Page, addresses: string[], size: string): Promise<number> {
  const found = await page.evaluate(
    ({ list, px }) => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      let n = 0;
      for (const dd of document.querySelectorAll('main dl dd')) {
        for (const a of list) {
          const el = [...dd.querySelectorAll('*')].find(
            (x) => norm(x.textContent) === a && ![...x.children].some((c) => norm(c.textContent) === a),
          );
          if (!el) continue;
          (el as HTMLElement).style.fontSize = px;
          n++;
        }
      }
      return n;
    },
    { list: addresses, px: size },
  );
  await settled(page);
  return found;
}

export interface FirstCommand {
  /** Why there is no command to measure; `null` when there is one. */
  missing: string | null;
  /** Its first line, trimmed. */
  text: string;
  /** The box of its first character. */
  first: Box | null;
  scrollY: number;
  viewport: { width: number; height: number };
}

/** The first command of the notice under the rows (see the head of this file), as drawn now. Never waits. */
export async function firstCommand(page: Page, words: RowWords): Promise<FirstCommand> {
  return page.evaluate((names) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const viewport = { width: innerWidth, height: innerHeight };
    const none = (missing: string) => ({ missing, text: '', first: null, scrollY, viewport });
    const dt = [...document.querySelectorAll('main dt')].find((el) => names.includes(norm(el.textContent)));
    const dl = dt?.closest('dl');
    if (!dl) return none('no rows on the page');
    const after = (el: Element) => (dl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    let pre: Element | null = null;
    for (let at = dl.parentElement; at && !pre; at = at.parentElement) {
      pre = [...at.querySelectorAll('pre')].find(after) ?? null;
    }
    if (!pre) return none('no command follows the rows');
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n as Text).data;
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const r = [...range.getClientRects()].find((x) => x.width > 0 && x.height > 0);
        if (!r) continue;
        return {
          missing: null,
          text: norm((pre.textContent ?? '').split('\n')[0]),
          first: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          scrollY,
          viewport,
        };
      }
    }
    return none('the first command draws no character');
  }, words.engine);
}
