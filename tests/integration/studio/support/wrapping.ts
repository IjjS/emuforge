// How Studio's own text wraps in the built app (issue 32, requirement R1, R4; test-criteria.md, issue 32, Flow):
// Korean words, a count and its unit, and the computed wrapping properties of Studio's own layer. Used by
// `wrapping.spec.ts`.
//
// Words, as `test-criteria.md` defines them:
//
// - "The three states of Home": engine and emulator running ("connected"); the engine running and the check's own
//   emulator stopped ("emulator stopped"); the engine stopped ("engine unreachable").
// - "The widths": every even width from 320 to 520, then 768, 1024 and 1280, the window 844 high.
// - "A Korean word is whole": no two Hangul syllables (U+AC00 to U+D7A3) with no white space between them are on
//   different lines. Two characters are next to each other when they follow one another in the text of one block:
//   the nearest element around them whose display is neither `inline` nor `contents`, with no `br` between them. Text
//   hidden from sight (a visually hidden helper) is not read: it is drawn on no line a reader sees.
// - "On one line": the boxes of two characters overlap vertically by more than 1px. White space is never measured; it
//   may hang at the end of a line.
// - "A counted message": one of the three messages Home shows with a count. Each is found in the English catalogue by
//   the English text `test-criteria.md` quotes ("Last checked … Checked every 5 seconds.", "Studio checks again every
//   5 seconds; …", "19 services · …"), white space of any kind compared as one space; in another language it is the
//   form that language's catalogue gives for the count Studio shows, chosen as Studio chooses it (the language's
//   plural category of the count, else its `other` form), with the count formatted as a number of the language. It
//   is found on the page by that text, any other placeholder standing for any text. No message key is named and no
//   translation is copied: every text is read from `studio/src/i18n/messages/` at run time.
// - "The unit's first character": the first character after the count, past one white space character where one
//   directly follows it (U+0020 or U+00A0). "The unit is whole": the count, that space and every character after it up
//   to the next white space, or to the message's end, are on one line.
// - "Text drawn outside its control or panel": a text of Studio's own layer that `layout` of `support/languages.ts`
//   finds wider than its box, unless an element around it clips it there (an address cut with an ellipsis, as
//   `studio/DESIGN.md` draws an address): clipped text is not drawn outside.
// - "The engine's English message on Home" (provisional, `decisions-needed.md` of issue 32): the notice Home shows
//   for the emulator stopped by `docker stop` ("No emulator is running on port …") holds no text of the engine's, so
//   the message is read where Home shows it, in the notice for the check's own emulator killed (`docker kill`).

import fs from 'node:fs';
import path from 'node:path';

import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from '@playwright/test';

import { type Ctx } from './check';
import { ACTION } from './frame';
import { SERVICE_LABELS } from './home';
import { appendValues, areaRootLang, languageContext, removeValues, settled } from './languages';
import { type StudioServer } from './studio';
import { Traffic } from './traffic';
import { waitFor } from './wait';

/** Requirement 3.4 of issue 3: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

/** Every even width from 320 to 520, then 768, 1024 and 1280. */
export const WRAP_WIDTHS: readonly number[] = [
  ...Array.from({ length: (520 - 320) / 2 + 1 }, (_, i) => 320 + 2 * i),
  768,
  1024,
  1280,
];

/** The window's height at every width. */
export const WRAP_HEIGHT = 844;

export type HomeState = 'connected' | 'emulator stopped' | 'engine unreachable';

export const HOME_STATES: readonly HomeState[] = ['connected', 'emulator stopped', 'engine unreachable'];

/** Resizes the page to `width` x 844 and waits until it is drawn again (two frames, every font load). */
export async function resizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: WRAP_HEIGHT });
  await settled(page);
}

// ---------------------------------------------------------------------------------------------------------------
// The counted messages, read from the catalogues.
// ---------------------------------------------------------------------------------------------------------------

/** The interval of Home's checks in seconds (requirement R4.6): the count of the two interval messages. */
const INTERVAL_SECONDS = 5;

/** The English texts `test-criteria.md` quotes, white space compared as one space, and the count each shows. */
const COUNTED: readonly { name: string; english: RegExp; count: number; states: readonly HomeState[] }[] = [
  {
    name: 'the connection\'s "Last checked … Checked every 5 seconds."',
    english: /^Last checked \{time\}\. Checked every \{count\} seconds?\.$/,
    count: INTERVAL_SECONDS,
    states: ['connected'],
  },
  {
    name: 'a notice\'s "Studio checks again every 5 seconds; …"',
    english: /^Studio checks again every \{count\} seconds?; /,
    count: INTERVAL_SECONDS,
    states: ['emulator stopped', 'engine unreachable'],
  },
  {
    name: 'a provider\'s "19 services · …"',
    english: /^\{count\} services? · /,
    count: SERVICE_LABELS.length,
    states: ['connected', 'emulator stopped', 'engine unreachable'],
  },
];

export interface CountedMessage {
  /** The message as `test-criteria.md` names it. */
  name: string;
  count: number;
  /** The states of Home that show it. */
  states: readonly HomeState[];
  /** The text the page shows for the count, per language tag, with its placeholders still in it. */
  forms: Map<string, string>;
}

type RawCatalogue = Record<string, unknown>;

function readRaw(ctx: Ctx, tag: string): RawCatalogue {
  const file = path.join(ctx.studioDir, 'src', 'i18n', 'messages', `${tag}.json`);
  const json: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`${path.relative(ctx.checkout, file)} is not a JSON object`);
  }
  return json as RawCatalogue;
}

/** White space of any kind as one space, trimmed. */
function oneSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The form of `message` Studio shows for `count` in `tag`: the plural category's, else `other`. */
function formFor(message: unknown, tag: string, count: number): string | undefined {
  if (typeof message === 'string') return message;
  if (typeof message !== 'object' || message === null) return undefined;
  const forms = message as Record<string, unknown>;
  const category = new Intl.PluralRules(tag).select(count);
  const text = forms[category] || forms.other;
  return typeof text === 'string' && text !== '' ? text : undefined;
}

/**
 * The three counted messages in each of `tags`, read from the catalogues of the checkout under test as they are on
 * disk now. Throws, naming what is missing, when a catalogue lacks one.
 */
export function countedMessages(ctx: Ctx, tags: readonly string[]): CountedMessage[] {
  const en = readRaw(ctx, 'en');
  const catalogues = new Map(tags.map((tag) => [tag, readRaw(ctx, tag)] as const));
  return COUNTED.map((wanted) => {
    const keys = Object.entries(en)
      .filter(([key, value]) => {
        if (key.startsWith('@')) return false;
        const text = formFor(value, 'en', wanted.count);
        return text !== undefined && wanted.english.test(oneSpace(text));
      })
      .map(([key]) => key);
    if (keys.length !== 1) {
      throw new Error(`the English catalogue holds ${String(keys.length)} messages that read as ${wanted.name}`);
    }
    const forms = new Map<string, string>();
    for (const [tag, catalogue] of catalogues) {
      const text = formFor(catalogue[keys[0]], tag, wanted.count);
      if (text === undefined) throw new Error(`the catalogue of ${tag} has no text for ${wanted.name}`);
      forms.set(tag, text);
    }
    ctx.log(`counted message ${wanted.name}: ${[...forms].map(([t, f]) => `${t} ${JSON.stringify(f)}`).join(', ')}`);
    return { name: wanted.name, count: wanted.count, states: wanted.states, forms };
  });
}

/**
 * A pattern for the text `form` shows in `tag`: its words as they are, white space of any kind for each run of white
 * space, the count formatted as a number of `tag` in the group `count`, and any other placeholder for any text.
 */
function countedPattern(form: string, tag: string, count: number): string {
  const escape = (text: string) =>
    text
      .split(/\s+/)
      .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
  const formatted = new Intl.NumberFormat(tag).format(count);
  return form
    .split(/(\{[A-Za-z][A-Za-z0-9_]*\})/)
    .map((piece) => {
      if (piece === '{count}') return `(?<count>${escape(formatted)})`;
      if (/^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(piece)) return '[\\s\\S]*?';
      return escape(piece);
    })
    .join('');
}

/** One place on the page where a counted message is drawn. */
export interface CountedDrawn {
  /** The count's last character and the unit's first are on different lines. */
  apart: boolean;
  /** The count, one space, and what follows up to the next white space or the message's end are not on one line. */
  unitBroken: boolean;
  /** The message's last line starts at the count or after it. */
  lastLineFromCount: boolean;
  /** The message as it is drawn, one entry per line, white space as one space. */
  drawn: string[];
}

export interface CountedOnPage {
  name: string;
  /** Every visible place the message is drawn; empty when the page does not show it. */
  places: CountedDrawn[];
}

/** Measures every counted message of `messages` in `tag` as the page draws it now. Never waits. */
export async function measureCounted(page: Page, tag: string, messages: CountedMessage[]): Promise<CountedOnPage[]> {
  const list = messages.map((m) => ({ name: m.name, source: countedPattern(m.forms.get(tag)!, tag, m.count) }));
  return page.evaluate((wanted) => {
    const hidden = (el: Element): boolean => {
      for (let a: Element | null = el; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
        if (/inset\(\s*50%/.test(cs.clipPath)) return true;
        const box = a.getBoundingClientRect();
        if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
        if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') return true;
      }
      return false;
    };
    const nodes: { node: Text; start: number }[] = [];
    let flat = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest('script, style, template, noscript, [data-emuforge-it-value]')) continue;
      nodes.push({ node: n as Text, start: flat.length });
      flat += (n as Text).data;
    }
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
    const space = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
    return wanted.map(({ name, source }) => {
      const places: {
        apart: boolean;
        unitBroken: boolean;
        lastLineFromCount: boolean;
        drawn: string[];
      }[] = [];
      for (const m of flat.matchAll(new RegExp(source, 'gdu'))) {
        const start = m.index;
        const end = start + m[0].length;
        const [countStart, countEnd] = m.indices!.groups!.count;
        if (hidden(at(countStart)[0].parentElement!)) continue;
        let unit = countEnd;
        if (space(flat[unit])) unit++;
        const last = rectAt(countEnd - 1);
        const first = rectAt(unit);
        const apart = !(last && first && sameLine(last, first));
        let unitEnd = unit;
        while (unitEnd < end && !space(flat[unitEnd])) unitEnd++;
        const base = rectAt(countStart);
        let unitBroken = base === null;
        for (let i = countStart; i < unitEnd && base; i++) {
          if (space(flat[i])) continue;
          const r = rectAt(i);
          if (r && !sameLine(base, r)) unitBroken = true;
        }
        const drawn: string[] = [];
        let current = '';
        let lineRect: DOMRect | null = null;
        let lastLineStart = start;
        let pendingSpace = false;
        for (let i = start; i < end; i++) {
          if (space(flat[i])) {
            pendingSpace = true;
            continue;
          }
          const r = rectAt(i);
          if (!r) continue;
          if (lineRect && !sameLine(lineRect, r)) {
            drawn.push(current);
            current = '';
            lineRect = null;
            pendingSpace = false;
          }
          if (!lineRect) {
            lineRect = r;
            lastLineStart = i;
          }
          current += (pendingSpace && current !== '' ? ' ' : '') + flat[i];
          pendingSpace = false;
        }
        if (current !== '') drawn.push(current);
        places.push({ apart, unitBroken, lastLineFromCount: lastLineStart >= countStart, drawn });
      }
      return { name, places };
    });
  }, list);
}

// ---------------------------------------------------------------------------------------------------------------
// Home in one of its states, in one language.
// ---------------------------------------------------------------------------------------------------------------

export interface HomePage {
  context: BrowserContext;
  page: Page;
  traffic: Traffic;
}

/**
 * Opens a context with the stored choice `tag` (`languageContext`) and `/` in it, and waits until Home shows
 * `state`: for "connected" and "emulator stopped" a health answer with the emulator reachable or not; then, in every
 * state, each counted message that state shows. Throws, naming what did not show, after 10 seconds.
 */
export async function openHome(
  ctx: Ctx,
  browser: Browser,
  proxy: BrowserContextOptions['proxy'],
  studio: StudioServer,
  tag: string,
  state: HomeState,
  messages: CountedMessage[],
  width = 1280,
): Promise<HomePage> {
  const { context, page } = await languageContext(ctx, browser, proxy, studio, { stored: tag, width });
  const traffic = Traffic.attach(ctx, context, page);
  await page.setViewportSize({ width, height: WRAP_HEIGHT });
  await page.goto('/');
  if (state !== 'engine unreachable') {
    const reachable = state === 'connected';
    const seen = await waitFor(CHANGE_BOUND_MS, async () => {
      await traffic.settle();
      return traffic.health.some(
        (a) => (a.body as { emulator?: { reachable?: unknown } } | null)?.emulator?.reachable === reachable,
      )
        ? true
        : undefined;
    });
    if (!seen) throw new Error(`${tag} ${state}: no health answer with the emulator reachable=${String(reachable)}`);
  }
  const shown = messages.filter((m) => m.states.includes(state));
  let missing: string[] = shown.map((m) => m.name);
  await waitFor(CHANGE_BOUND_MS, async () => {
    const found = await measureCounted(page, tag, shown);
    missing = found.filter((f) => f.places.length === 0).map((f) => f.name);
    return missing.length === 0 ? true : undefined;
  });
  if (missing.length > 0) throw new Error(`${tag} ${state}: Home does not show ${missing.join(', ')} within 10s`);
  await settled(page);
  return { context, page, traffic };
}

/**
 * Of the issues `layout` (`support/languages.ts`) reports, the texts drawn outside their box: each text it finds
 * wider than its box for which it reports no element that cuts it (a clip, an ellipsis).
 */
export function drawnOutside(issues: string[]): string[] {
  const textOf = (issue: string) => /^"(.*)" is /.exec(issue)?.[1] ?? null;
  const clipped = new Set(issues.filter((i) => /" is cut (by|with an ellipsis in) /.test(i)).map((i) => textOf(i)));
  return issues.filter((i) => /" is wider than its box /.test(i) && !clipped.has(textOf(i)));
}

// ---------------------------------------------------------------------------------------------------------------
// Korean words.
// ---------------------------------------------------------------------------------------------------------------

export interface HangulReport {
  /** How many pairs of Hangul syllables next to each other were measured. */
  pairs: number;
  /** Each pair on different lines, as `<left part> / <right part>` of its word. */
  splits: string[];
}

/** Measures every pair of Hangul syllables next to each other in the elements of `scopes`, as drawn now. */
export async function hangulSplits(page: Page, scopes: Locator[]): Promise<HangulReport> {
  const handles = [];
  for (const scope of scopes) handles.push(await scope.elementHandle(ACTION));
  return page.evaluate((roots) => {
    const HANGUL = /[가-힣]/;
    const hidden = (el: Element): boolean => {
      for (let a: Element | null = el; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
        if (/inset\(\s*50%/.test(cs.clipPath)) return true;
        const box = a.getBoundingClientRect();
        if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
        if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') return true;
      }
      return false;
    };
    const blockOf = (el: Element): Element => {
      let at = el;
      while (at.parentElement && /^(inline|contents)$/.test(getComputedStyle(at).display)) at = at.parentElement;
      return at;
    };
    const rectOf = (node: Text, i: number): DOMRect | null => {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      return [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0) ?? null;
    };
    const sameLine = (a: DOMRect, b: DOMRect) => a.top < b.bottom - 1 && b.top < a.bottom - 1;
    let pairs = 0;
    const splits: string[] = [];
    type Char = { node: Text; i: number; ch: string };
    const examine = (chars: Char[]) => {
      for (let k = 0; k + 1 < chars.length; k++) {
        const a = chars[k];
        const b = chars[k + 1];
        if (!HANGUL.test(a.ch) || !HANGUL.test(b.ch)) continue;
        pairs++;
        const ra = rectOf(a.node, a.i);
        const rb = rectOf(b.node, b.i);
        if (!ra || !rb || sameLine(ra, rb)) continue;
        let from = k;
        while (from > 0 && !/\s/.test(chars[from - 1].ch)) from--;
        let to = k + 1;
        while (to + 1 < chars.length && !/\s/.test(chars[to + 1].ch)) to++;
        const word = (x: number, y: number) =>
          chars
            .slice(x, y + 1)
            .map((c) => c.ch)
            .join('');
        splits.push(`"${word(from, k)} / ${word(k + 1, to)}"`);
      }
    };
    for (const root of roots) {
      if (!root) continue;
      let run: { block: Element; chars: Char[] } | null = null;
      const flush = () => {
        if (run) examine(run.chars);
        run = null;
      };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if ((n as Element).tagName === 'BR') flush();
          continue;
        }
        const el = n.parentElement;
        if (!el || el.closest('script, style, template, noscript, [data-emuforge-it-value]')) continue;
        if (hidden(el)) {
          flush();
          continue;
        }
        const block = blockOf(el);
        if (run && (run as { block: Element }).block !== block) flush();
        if (!run) run = { block, chars: [] };
        const text = (n as Text).data;
        for (let i = 0; i < text.length; i++)
          (run as { chars: Char[] }).chars.push({ node: n as Text, i, ch: text[i] });
      }
      flush();
    }
    return { pairs, splits: [...new Set(splits)] };
  }, handles);
}

/**
 * Appends a paragraph holding `word` to Studio's `main` (`appendValues`), measures how it is drawn and removes it:
 * how many lines its characters take, how many are drawn outside the paragraph's box, and whether the page scrolls
 * sideways.
 */
export async function longWordDrawn(
  page: Page,
  word: string,
): Promise<{ lines: number; outside: number; pageScrolls: boolean }> {
  await appendValues(page, [word]);
  try {
    await settled(page);
    return await page.evaluate(() => {
      const p = document.querySelector('[data-emuforge-it-value]');
      const node = p?.firstChild;
      const de = document.documentElement;
      if (!p || !node || node.nodeType !== Node.TEXT_NODE) return { lines: 0, outside: 0, pageScrolls: false };
      const box = p.getBoundingClientRect();
      const sameLine = (a: DOMRect, b: DOMRect) => a.top < b.bottom - 1 && b.top < a.bottom - 1;
      let lines = 0;
      let outside = 0;
      let lineRect: DOMRect | null = null;
      const text = (node as Text).data;
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = [...range.getClientRects()].find((x) => x.width > 0 && x.height > 0);
        if (!r) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1) outside++;
        if (!lineRect || !sameLine(lineRect, r)) {
          lines++;
          lineRect = r;
        }
      }
      return { lines, outside, pageScrolls: de.scrollWidth > de.clientWidth };
    });
  } finally {
    await removeValues(page);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Computed wrapping properties.
// ---------------------------------------------------------------------------------------------------------------

/** One visible text of Studio's own layer with a computed property of the element that holds it. */
export interface StyledText {
  /** The text, white space as one space. */
  text: string;
  /** The `lang` of the nearest element that has one (`html` included). */
  lang: string;
  /** Whether that element is not `html`: the text's element names its own language. */
  explicit: boolean;
  value: string;
  where: string;
}

/** Every visible text node inside `scope`'s elements, with `property` computed on the element that holds it. */
export async function styledTexts(scope: Locator, property: string): Promise<StyledText[]> {
  return scope.evaluateAll((roots, prop) => {
    const out: { text: string; lang: string; explicit: boolean; value: string; where: string }[] = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        const text = (n as Text).data.replace(/\s+/g, ' ').trim();
        if (!el || text === '' || el.closest('script, style, template, noscript, [data-emuforge-it-value]')) continue;
        if (el.getClientRects().length === 0) continue;
        const holder = el.closest('[lang]');
        const cls = el.classList.length > 0 ? `.${[...el.classList].slice(0, 2).join('.')}` : '';
        out.push({
          text,
          lang: holder?.getAttribute('lang') ?? '',
          explicit: holder !== null && holder !== document.documentElement,
          value: getComputedStyle(el).getPropertyValue(prop),
          where: `${el.tagName.toLowerCase()}${cls}`,
        });
      }
    }
    return out;
  }, property);
}

/** `property` computed on each element `scope` finds, with its `lang` as `styledTexts` reads it. */
export async function elementStyles(scope: Locator, property: string): Promise<StyledText[]> {
  return scope.evaluateAll(
    (els, prop) =>
      els
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => {
          const holder = el.closest('[lang]');
          const cls = el.classList.length > 0 ? `.${[...el.classList].slice(0, 2).join('.')}` : '';
          return {
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
            lang: holder?.getAttribute('lang') ?? '',
            explicit: holder !== null && holder !== document.documentElement,
            value: getComputedStyle(el).getPropertyValue(prop),
            where: `${el.tagName.toLowerCase()}${cls}`,
          };
        }),
    property,
  );
}

/** `property` computed at the AWS area's root (found as `support/languages.ts` finds it); `null` without an area. */
export async function areaRootStyle(page: Page, property: string): Promise<string | null> {
  // `areaRootLang` installs the probe whose `areaRoot` is read here.
  if ((await areaRootLang(page)) === null) return null;
  return page.evaluate((prop) => {
    const probe = (window as unknown as { __emuforgeItLang?: { areaRoot: () => Element | null } }).__emuforgeItLang;
    const root = probe ? probe.areaRoot() : null;
    return root ? getComputedStyle(root).getPropertyValue(prop) : null;
  }, property);
}

/**
 * The heading of the notice that holds the counted message `message` in `tag`: from the element that draws the
 * message, the first element around it that holds a heading (`h1` to `h6`, `role="heading"`) other than the page's
 * `h1`; that heading's text and `property`. `null` when the page shows no such message or no heading around it.
 */
export async function noticeHeadingStyle(
  page: Page,
  tag: string,
  message: CountedMessage,
  property: string,
): Promise<{ text: string; value: string } | null> {
  const source = countedPattern(message.forms.get(tag)!, tag, message.count);
  return page.evaluate(
    ([src, prop]) => {
      const re = new RegExp(src, 'u');
      const holder = [...document.querySelectorAll('main *')].find(
        (el) => re.test(el.textContent ?? '') && ![...el.children].some((c) => re.test(c.textContent ?? '')),
      );
      if (!holder) return null;
      const headings = 'h2, h3, h4, h5, h6, [role="heading"]:not(h1)';
      for (let at = holder.parentElement; at && at.tagName !== 'MAIN'; at = at.parentElement) {
        const heading = [...at.querySelectorAll(headings)].find((h) => !h.contains(holder));
        if (heading) {
          return {
            text: (heading.textContent ?? '').replace(/\s+/g, ' ').trim(),
            value: getComputedStyle(heading).getPropertyValue(prop),
          };
        }
      }
      return null;
    },
    [source, property] as const,
  );
}
