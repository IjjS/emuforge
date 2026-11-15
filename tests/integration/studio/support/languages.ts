// Studio in more than one language as the built app shows it (issue 17, requirement R1-R7; test-criteria.md, issue 17,
// Flow). Used by `languages.spec.ts`.
//
// Words, as `test-criteria.md` defines them:
//
// - "The catalogue of L": `studio/src/i18n/messages/<tag>.json` of the checkout under test, read at run time. "A value
//   of L's catalogue" is any text it holds: a message, a plural form, or a reserved entry (the language's own name). A
//   text "comes from L's catalogue" when it equals a value with each `{placeholder}` standing for any text, or is a
//   piece of a value split around a placeholder (the text beside a placeholder's element). A value or a piece with no
//   letter left once its placeholders are taken out matches nothing: it would match any text. No check names a key.
// - "Kept as it is" (R4.3): the engine's `message` (as the page received it) and an area page title, each in an
//   element with `lang="en"`; a language's own name in an element with that language's `lang`; text inside `code` or
//   `pre`; the wordmark; the provider's names and service labels; addresses, origins, ports, paths, HTTP status codes,
//   engine error codes; text with no letter (digits and punctuation alone). Nothing else is exempt for carrying a
//   `lang`.
// - "Studio's own layer": every element outside the AWS area's root; the root is found as `support/layers.ts` finds it
//   (the lowest common ancestor of the elements with a Cloudscape component class, lifted above a Cloudscape
//   component and above Cloudscape's bare wrappers).
// - "Studio's text" of a page: every text node of Studio's own layer, live regions and visually hidden text included,
//   every attribute that gives an accessible name or description (`aria-label`, `aria-description`,
//   `aria-roledescription`, `aria-valuetext`, `aria-placeholder`, `title`, `alt`, `placeholder`), and the document
//   title. A name or description computed from content or from `aria-labelledby`/`aria-describedby` is made of text
//   nodes, each read on its own here.
// - "The face that draws a node": the platform fonts Chromium's `CSS.getPlatformFontsForNode` reports for a text node
//   (DevTools protocol), by family name.
// - "Stored choice": `localStorage` key `emuforge.studio.language` for Studio's origin, set with the browser context's
//   storage state (R8.4).

import fs from 'node:fs';
import path from 'node:path';

import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from '@playwright/test';

import { type Ctx } from './check';
import { ACTION, frame } from './frame';
import { SERVICE_LABELS } from './home';
import { type Scheme } from './layers';
import { type StudioServer } from './studio';
import { type Traffic } from './traffic';

// ---------------------------------------------------------------------------------------------------------------
// The twelve languages (R1.1) and the control's order (R3.3).
// ---------------------------------------------------------------------------------------------------------------

export interface Language {
  tag: string;
  /** Its own name, the same in every language (R1.1, R1.3). */
  name: string;
}

/** R1.1, in the requirement's order. */
export const LANGUAGES: readonly Language[] = [
  { tag: 'en', name: 'English' },
  { tag: 'ko', name: '한국어' },
  { tag: 'ja', name: '日本語' },
  { tag: 'es', name: 'Español' },
  { tag: 'pt-BR', name: 'Português' },
  { tag: 'fr', name: 'Français' },
  { tag: 'de', name: 'Deutsch' },
  { tag: 'ru', name: 'Русский' },
  { tag: 'it', name: 'Italiano' },
  { tag: 'pl', name: 'Polski' },
  { tag: 'vi', name: 'Tiếng Việt' },
  { tag: 'th', name: 'ไทย' },
];

/** The own names in the menu's order after "Browser language" (R3.3). */
export const MENU_ORDER: readonly string[] = [
  'Deutsch',
  'English',
  'Español',
  'Français',
  'Italiano',
  'Polski',
  'Português',
  'Tiếng Việt',
  'Русский',
  'ไทย',
  '한국어',
  '日本語',
];

/** The key of the stored choice (R2.4). */
export const STORAGE_KEY = 'emuforge.studio.language';

export function language(tag: string): Language {
  const found = LANGUAGES.find((l) => l.tag === tag);
  if (!found) throw new Error(`${tag} is not a language of R1.1`);
  return found;
}

/** Whether `lang` (an attribute's value) names the language `tag`: equal ignoring case. */
export function isLang(lang: string, tag: string): boolean {
  return lang.toLowerCase() === tag.toLowerCase();
}

/** The language of R1.1 that `lang` names, if any. */
function languageOf(lang: string): Language | undefined {
  return LANGUAGES.find((l) => isLang(lang, l.tag));
}

// ---------------------------------------------------------------------------------------------------------------
// Catalogues and the value matcher.
// ---------------------------------------------------------------------------------------------------------------

/** Whitespace collapsed to one space, trimmed: how text is compared. */
export function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9_]*\}/g;
const LETTER = /\p{L}/u;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface Catalogue {
  tag: string;
  file: string;
  /** Why the catalogue could not be read; `null` when it was. */
  missing: string | null;
  /** Every text of each message by key, reserved entries aside. */
  messages: Map<string, string[]>;
  /** Every value: each message's texts and the language's own name. */
  values: string[];
}

/** Reads the catalogue of `tag` from the checkout under test, as it is on disk now. */
export function readCatalogue(ctx: Ctx, tag: string): Catalogue {
  const file = path.join(ctx.studioDir, 'src', 'i18n', 'messages', `${tag}.json`);
  const catalogue: Catalogue = {
    tag,
    file,
    missing: null,
    messages: new Map(),
    values: [],
  };
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    catalogue.missing = `no catalogue of ${tag} at ${path.relative(ctx.checkout, file)} (${(e as Error).message.split('\n')[0]})`;
    return catalogue;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    catalogue.missing = `the catalogue of ${tag} is not a JSON object`;
    return catalogue;
  }
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (key === '@name' && typeof value === 'string') catalogue.values.push(value);
    if (key.startsWith('@')) continue;
    const texts =
      typeof value === 'string'
        ? [value]
        : typeof value === 'object' && value !== null
          ? Object.values(value as Record<string, unknown>).filter((t): t is string => typeof t === 'string')
          : [];
    catalogue.messages.set(key, texts);
    catalogue.values.push(...texts);
  }
  if (catalogue.messages.size === 0) catalogue.missing = `the catalogue of ${tag} holds no message`;
  return catalogue;
}

/** Matches a text against the values of one catalogue (see the head of this file). */
export class ValueMatcher {
  private readonly exact = new Set<string>();
  private readonly patterns: RegExp[] = [];

  constructor(values: readonly string[]) {
    for (const raw of values) {
      const value = norm(raw);
      if (!LETTER.test(value.replace(PLACEHOLDER, ''))) continue;
      const pieces = value.split(PLACEHOLDER);
      if (pieces.length === 1) {
        this.exact.add(value);
        continue;
      }
      for (const piece of pieces) if (LETTER.test(piece)) this.exact.add(norm(piece));
      this.patterns.push(new RegExp(`^${pieces.map((p) => escapeRegExp(p.trim())).join('\\s*[\\s\\S]*?\\s*')}$`, 'u'));
    }
  }

  /** How many values or pieces can match: 0 means every text fails. */
  get size(): number {
    return this.exact.size + this.patterns.length;
  }

  matches(text: string): boolean {
    const t = norm(text);
    return this.exact.has(t) || this.patterns.some((p) => p.test(t));
  }
}

/**
 * The texts that `other`'s catalogue gives for the message whose English text, with its placeholders filled, is
 * `english` (today's wording, R4.2). Found by value: the key is never named. Throws, naming what is missing, when
 * either catalogue lacks it.
 */
export function translationOf(en: Catalogue, other: Catalogue, english: string): string[] {
  const keys = [...en.messages]
    .filter(([, texts]) => texts.some((t) => norm(t) === norm(english) || new ValueMatcher([t]).matches(english)))
    .map(([k]) => k);
  if (keys.length === 0) {
    throw new Error(`the English catalogue has no message "${english}"${en.missing ? ` (${en.missing})` : ''}`);
  }
  const texts = keys.flatMap((k) => other.messages.get(k) ?? []);
  if (texts.length === 0) {
    throw new Error(
      `the catalogue of ${other.tag} has no text for the English "${english}"${other.missing ? ` (${other.missing})` : ''}`,
    );
  }
  return texts;
}

/** The values of `en` whose message's text in `other` differs from English (the texts a page in `other` must not show). */
export function englishOnly(en: Catalogue, other: Catalogue): string[] {
  const out: string[] = [];
  for (const [key, texts] of en.messages) {
    const theirs = (other.messages.get(key) ?? []).map(norm);
    for (const t of texts) if (!theirs.includes(norm(t))) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// "Kept as it is" and the language of Studio's text.
// ---------------------------------------------------------------------------------------------------------------

/** One text of Studio's text, as the page reads it. */
export interface TextItem {
  kind: 'text' | 'attribute';
  text: string;
  /** The `lang` of the closest element that carries one (`html`'s when no other does). */
  lang: string;
  /** The closest `lang` is on an element inside the document, not on `html`. */
  explicit: boolean;
  /** Inside `code` or `pre`. */
  code: boolean;
  /** Inside the wordmark, the banner's link "EmuForge Studio". */
  wordmark: boolean;
  /** Where it is: the element, and the attribute's name for an attribute. */
  where: string;
}

/** What the page shows about itself besides its text. */
export interface PageText {
  items: TextItem[];
  title: string;
  htmlLang: string;
  /** `dir` of `html` and of every element of Studio's own layer that sets one, as `<element>: <dir>`. */
  dirs: string[];
}

/** The area's page titles Studio's own layer may show or announce, in English (R5.2). */
export const AREA_TITLES: readonly string[] = [...SERVICE_LABELS, 'Amazon Web Services', 'Page not found'];

/** Names that are the same in every language (R4.3). */
const NAMES = new Set(['EmuForge', 'EmuForge Studio', 'Amazon Web Services', 'AWS', ...SERVICE_LABELS]);

const ADDRESS = /^(?:https?:\/\/)?(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]|localhost)(?::\d+)?(?:\/\S*)?$/;
const PATH = /^\/\S*$/;

/** What the engine sent the page, kept as it came: its messages and its error codes (R4.3). */
export function engineWords(traffic: Traffic): Set<string> {
  const out = new Set<string>();
  for (const answer of traffic.health) {
    const body = answer.body as {
      emulator?: { message?: unknown };
      error?: { message?: unknown; code?: unknown };
    } | null;
    for (const v of [body?.emulator?.message, body?.error?.message, body?.error?.code]) {
      if (typeof v === 'string' && v.trim() !== '') out.add(norm(v));
    }
  }
  return out;
}

/** Kept as it is whatever its element: names, addresses, paths, ports, codes, text with no letter. */
function literal(text: string, engine: Set<string>): boolean {
  return !LETTER.test(text) || NAMES.has(text) || ADDRESS.test(text) || PATH.test(text) || engine.has(text);
}

/**
 * Why `item` is neither from the page language's catalogue nor kept as it is; `null` when it is one of them.
 * `matcher` holds the values of the catalogue of `pageTag`.
 */
export function textProblem(
  item: TextItem,
  pageTag: string,
  matcher: ValueMatcher,
  engine: Set<string>,
): string | null {
  const text = norm(item.text);
  if (text === '' || item.code || item.wordmark) return null;
  const own = languageOf(item.lang);
  if (item.kind === 'attribute') {
    // An attribute's language is its element's; a language's own name, the engine's text or an area title there is
    // kept like the text it names.
    if (LANGUAGES.some((l) => l.name === text) || AREA_TITLES.includes(text) || literal(text, engine)) return null;
  } else if (item.explicit) {
    if (own && own.name === text) return null;
    if (isLang(item.lang, 'en') && (engine.has(text) || AREA_TITLES.includes(text))) return null;
    if (!isLang(item.lang, pageTag)) {
      return `"${text}" in ${item.where} carries lang="${item.lang}" on a ${pageTag} page and is neither the engine's message, an area page title nor a language's own name`;
    }
  }
  if (literal(text, engine) || matcher.matches(text)) return null;
  return `"${text}" in ${item.where}${item.kind === 'attribute' ? '' : ` (lang ${item.lang || 'none'})`} is not from the ${pageTag} catalogue`;
}

export type PageKind = 'home' | 'not-found' | 'area';

/** Why the document title is not R5.2's on a page of `kind` in `pageTag`; `null` when it is. */
export function titleProblem(title: string, kind: PageKind, pageTag: string, matcher: ValueMatcher): string | null {
  const t = norm(title);
  if (kind === 'home') return t === 'EmuForge Studio' ? null : `the title on Home is "${t}", not "EmuForge Studio"`;
  const suffix = ' | EmuForge Studio';
  if (!t.endsWith(suffix)) return `the title "${t}" does not end with "${suffix}"`;
  const head = t.slice(0, -suffix.length);
  if (kind === 'area') {
    return AREA_TITLES.includes(head) ? null : `the title "${t}" does not start with the area's English page title`;
  }
  return matcher.matches(head) ? null : `the title "${t}" does not start with a page title of the ${pageTag} catalogue`;
}

/**
 * Every problem of the page's language: `<html lang>` is not `tag`, a `dir` other than `ltr`, the title (when `kind` is
 * given), and every text of Studio's text that is neither from the catalogue of `tag` nor kept as it is.
 */
export function languageProblems(
  page: PageText,
  catalogue: Catalogue,
  engine: Set<string>,
  kind: PageKind | null,
): string[] {
  const tag = catalogue.tag;
  const out: string[] = [];
  if (catalogue.missing) out.push(catalogue.missing);
  if (!isLang(page.htmlLang, tag)) out.push(`<html lang="${page.htmlLang}">, not "${tag}"`);
  for (const d of page.dirs) out.push(`dir is set other than ltr: ${d}`);
  const matcher = new ValueMatcher(catalogue.values);
  if (kind !== null) {
    const t = titleProblem(page.title, kind, tag, matcher);
    if (t) out.push(t);
  }
  for (const item of page.items) {
    const p = textProblem(item, tag, matcher, engine);
    if (p) out.push(p);
  }
  return [...new Set(out)];
}

/** Texts of `items` that equal an English text the catalogue of `tag` gives differently (R2.7). */
export function englishTexts(items: TextItem[], englishOnlyValues: string[], own: ValueMatcher): string[] {
  const english = new ValueMatcher(englishOnlyValues);
  return [
    ...new Set(
      items
        .filter((i) => !i.code && !i.wordmark && LETTER.test(i.text))
        .filter((i) => english.matches(i.text) && !own.matches(i.text))
        .map((i) => `"${norm(i.text)}" in ${i.where}`),
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The probe installed in the page: Studio's text, the area's root, the `#root` recorder and the layout measures.
// ---------------------------------------------------------------------------------------------------------------

/** One state of `#root` the recorder saw: after a batch of changes, with `<html lang>` at that time. */
export interface RecordedState {
  /** `performance.now()` of the batch. */
  at: number;
  lang: string;
  items: TextItem[];
}

export interface Recording {
  states: RecordedState[];
  /** `<html lang>` at the moment the app first put content into `#root`, from the change records' order. */
  firstContentLang: string | null;
  /** Index into `states` set by `markRecording`: the first state recorded after the mark. */
  mark: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Installs `window.__emuforgeItLang` in the page; with `record`, also starts the recorder of `#root` (as an init
 * script, so it runs before the app's own scripts). Self-contained: it is serialized into the page.
 */
function installLanguageProbe(record: boolean): void {
  const w = window as any;
  if (w.__emuforgeItLang) return;
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const ATTRIBUTES = [
    'aria-label',
    'aria-description',
    'aria-roledescription',
    'aria-valuetext',
    'aria-placeholder',
    'title',
    'alt',
    'placeholder',
  ];
  const describe = (el: Element | null): string => {
    if (!el) return '(none)';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList.length > 0 ? `.${[...el.classList].slice(0, 2).join('.')}` : '';
    const role = el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}${role}`;
  };
  const areaRoot = (): Element | null => {
    const tree = [...document.querySelectorAll('[class*="awsui_"]')].filter((el) =>
      [...el.classList].some((c) => c.startsWith('awsui_')),
    );
    if (tree.length === 0) return null;
    let common: Element | null = tree[0];
    for (const el of tree.slice(1)) {
      while (common && !common.contains(el)) common = common.parentElement;
    }
    if (common && [...common.classList].some((c) => c.startsWith('awsui_'))) common = common.parentElement;
    while (
      common &&
      common.attributes.length === 0 &&
      common.parentElement &&
      common.parentElement !== document.body &&
      common.parentElement.children.length === 1
    )
      common = common.parentElement;
    return common;
  };
  const wordmark = (): Element | null =>
    [...document.querySelectorAll('header a, [role="banner"] a')].find(
      (a) => norm(a.textContent) === 'EmuForge Studio',
    ) ?? null;
  const SKIP = 'script, style, template, noscript, [data-emuforge-it-value]';
  const langOf = (el: Element) => {
    const holder = el.closest('[lang]');
    return {
      lang: holder?.getAttribute('lang') ?? '',
      explicit: holder !== null && holder !== document.documentElement,
    };
  };
  /** Studio's text under `scope` (default `body`), outside the area's root; `inside` reads the area's instead. */
  const collect = (scope: Element | null, inside = false) => {
    const root = areaRoot();
    const mark = wordmark();
    const start = inside ? root : (scope ?? document.body);
    const items: any[] = [];
    if (!start) return items;
    const keep = (el: Element) => (inside ? true : !(root && root.contains(el)));
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = (n as Text).data;
      if (!el || text.trim() === '' || el.closest(SKIP) || !keep(el)) continue;
      items.push({
        kind: 'text',
        text,
        ...langOf(el),
        code: el.closest('code, pre') !== null,
        wordmark: mark !== null && mark.contains(el),
        where: describe(el),
      });
    }
    const elements = [start, ...start.querySelectorAll('*')];
    for (const el of elements) {
      if (el.closest(SKIP) || !keep(el)) continue;
      for (const name of ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value === null || value.trim() === '') continue;
        items.push({
          kind: 'attribute',
          text: value,
          ...langOf(el),
          code: false,
          wordmark: false,
          where: `${describe(el)} @${name}`,
        });
      }
    }
    return items;
  };
  const page = () => {
    const root = areaRoot();
    const dirs: string[] = [];
    const htmlDir = document.documentElement.getAttribute('dir');
    if (htmlDir !== null && htmlDir.toLowerCase() !== 'ltr') dirs.push(`html: ${htmlDir}`);
    for (const el of document.body.querySelectorAll('[dir]')) {
      if (root && root.contains(el)) continue;
      const d = el.getAttribute('dir') ?? '';
      if (d.toLowerCase() !== 'ltr') dirs.push(`${describe(el)}: ${d}`);
    }
    return {
      items: collect(null),
      title: document.title,
      htmlLang: document.documentElement.getAttribute('lang') ?? '',
      dirs,
    };
  };

  /** Hidden from sight though rendered: a visually hidden helper or something clipped to nothing. */
  const hiddenFromSight = (el: Element): boolean => {
    for (let a: Element | null = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
      if (/inset\(\s*50%/.test(cs.clipPath)) return true;
      const box = a.getBoundingClientRect();
      if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
      if (cs.visibility === 'hidden' || cs.opacity === '0') return true;
    }
    return false;
  };
  const rectsOf = (n: Node) => {
    const range = document.createRange();
    range.selectNodeContents(n);
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  };
  /** The text of `el` that is drawn and visible, in order. */
  const visibleText = (el: Element): string => {
    const out: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || (n as Text).data.trim() === '' || rectsOf(n).length === 0 || hiddenFromSight(parent)) continue;
      out.push((n as Text).data);
    }
    return norm(out.join(' '));
  };
  const scrolls = (cs: CSSStyleDeclaration) => /auto|scroll/.test(cs.overflowX);
  /** R6.4: the page scrolling sideways, and every text of Studio's own layer drawn outside its box or cut. */
  const layout = () => {
    const root = areaRoot();
    const issues: string[] = [];
    const de = document.documentElement;
    const pageScrolls = de.scrollWidth > de.clientWidth;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = norm((n as Text).data);
      if (!el || text === '' || el.closest(SKIP) || (root && root.contains(el))) continue;
      const rects = rectsOf(n);
      if (rects.length === 0 || hiddenFromSight(el)) continue;
      let box: Element = el;
      while (box.parentElement && /^(inline|contents)$/.test(getComputedStyle(box).display)) box = box.parentElement;
      let scroller = false;
      const clippers: Element[] = [];
      for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (scrolls(cs)) scroller = true;
        else if (/hidden|clip/.test(cs.overflowX)) clippers.push(a);
      }
      if (scroller) continue;
      const b = box.getBoundingClientRect();
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      if (right > b.right + 1 || left < b.left - 1) {
        issues.push(
          `"${text.slice(0, 50)}" is wider than its box ${describe(box)} (${left.toFixed(0)}-${right.toFixed(0)} in ${b.left.toFixed(0)}-${b.right.toFixed(0)})`,
        );
      }
      for (const c of clippers) {
        const r = c.getBoundingClientRect();
        if (right > r.right + 1 || left < r.left - 1) issues.push(`"${text.slice(0, 50)}" is cut by ${describe(c)}`);
      }
      const ps = getComputedStyle(box);
      if (ps.textOverflow === 'ellipsis' && box.scrollWidth > box.clientWidth + 1) {
        issues.push(`"${text.slice(0, 50)}" is cut with an ellipsis in ${describe(box)}`);
      }
    }
    return { pageScrolls, issues: [...new Set(issues)] };
  };
  /**
   * Text nodes of Studio's own layer that hold a character of `script` and whose letter spacing is below 0 (R6.3);
   * a page with no such node is reported too, as it shows nothing of the script to measure.
   */
  const negativeTracking = (script: string) => {
    const re = new RegExp(script, 'u');
    const root = areaRoot();
    const out: string[] = [];
    let seen = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !re.test((n as Text).data) || el.closest(SKIP) || (root && root.contains(el))) continue;
      seen++;
      const ls = getComputedStyle(el).letterSpacing;
      const px = ls === 'normal' ? 0 : parseFloat(ls);
      if (px < 0) out.push(`"${norm((n as Text).data).slice(0, 40)}" in ${describe(el)}: letter-spacing ${ls}`);
    }
    if (seen === 0) out.push(`no text node of Studio's own layer holds a character of ${script}`);
    return out;
  };
  /** The topmost element at a point lies inside `el`. */
  const topIsIn = (el: Element, x: number, y: number) => {
    const top = document.elementFromPoint(x, y);
    return top !== null && (top === el || el.contains(top));
  };
  /** Where `el` sits: inside the viewport, and whether something else covers its centre. */
  const placed = (el: Element) => {
    const r = el.getBoundingClientRect();
    const inside =
      r.width > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    const covered = !topIsIn(el, r.left + r.width / 2, r.top + r.height / 2);
    return {
      inside,
      covered,
      rect: `${r.left.toFixed(0)},${r.top.toFixed(0)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`,
    };
  };
  /** The open menu: in the viewport, scrolling within itself when taller, and what it covers of the bar. */
  const menuPlace = (menu: Element, bar: Element | null) => {
    const r = menu.getBoundingClientRect();
    const cs = getComputedStyle(menu);
    const problems: string[] = [];
    if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
      problems.push(
        `the menu (${r.left.toFixed(0)},${r.top.toFixed(0)}-${r.right.toFixed(0)},${r.bottom.toFixed(0)}) is not inside the viewport ${String(innerWidth)}x${String(innerHeight)}`,
      );
    }
    if (menu.scrollHeight > menu.clientHeight + 1 && !/auto|scroll/.test(cs.overflowY)) {
      problems.push(
        `the menu is taller than its box (${String(menu.scrollHeight)} > ${String(menu.clientHeight)}) and does not scroll`,
      );
    }
    const covers: string[] = [];
    if (bar) {
      const b = bar.getBoundingClientRect();
      const y = b.bottom - 0.5;
      for (const x of [r.left + 2, r.left + r.width / 2, r.right - 2]) {
        if (x >= 0 && x <= innerWidth && topIsIn(menu, x, y)) covers.push(`the bar's hairline at x=${x.toFixed(0)}`);
      }
      const current = bar.querySelector('[aria-current]');
      if (current) {
        const c = current.getBoundingClientRect();
        for (const x of [c.left + 1, c.left + c.width / 2, c.right - 1]) {
          for (const yy of [c.bottom - 1, b.bottom - 1.5]) {
            if (x >= 0 && x <= innerWidth && topIsIn(menu, x, yy))
              covers.push(`the current tab's underline at ${x.toFixed(0)},${yy.toFixed(0)}`);
          }
        }
      }
    }
    return { problems, covers: [...new Set(covers)] };
  };
  /** Whether the topmost element at the corners and the centre of `el` is `el`'s. */
  const onTop = (el: Element) => {
    const r = el.getBoundingClientRect();
    const points: [string, number, number][] = [
      ['top left', r.left + 2, r.top + 2],
      ['top right', r.right - 2, r.top + 2],
      ['bottom left', r.left + 2, r.bottom - 2],
      ['bottom right', r.right - 2, r.bottom - 2],
      ['centre', r.left + r.width / 2, r.top + r.height / 2],
    ];
    return points
      .filter(([, x, y]) => !topIsIn(el, x, y))
      .map(([name, x, y]) => `${name} (${x.toFixed(0)},${y.toFixed(0)}): ${describe(document.elementFromPoint(x, y))}`);
  };
  /** The marks of an option drawn besides its text: visible `svg`, `img` and generated content. */
  const marks = (el: Element) => {
    let count = 0;
    for (const m of el.querySelectorAll('svg, img')) {
      const cs = getComputedStyle(m);
      const r = m.getBoundingClientRect();
      if (
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility === 'visible' &&
        parseFloat(cs.opacity) > 0 &&
        !hiddenFromSight(m)
      )
        count++;
    }
    for (const at of [el, ...el.querySelectorAll('*')]) {
      for (const where of ['::before', '::after']) {
        const p = getComputedStyle(at, where);
        if (
          p.content !== 'none' &&
          p.content !== 'normal' &&
          p.display !== 'none' &&
          p.visibility === 'visible' &&
          parseFloat(p.opacity) > 0
        )
          count++;
      }
    }
    return count;
  };

  const recording = {
    states: [] as any[],
    firstContentLang: null as string | null,
    mark: null as number | null,
  };
  if (record) {
    const observer = new MutationObserver((records) => {
      const root = document.getElementById('root');
      if (!root) return;
      if (recording.firstContentLang === null) {
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          if (r.type !== 'childList' || r.addedNodes.length === 0 || !root.contains(r.target)) continue;
          let lang = document.documentElement.getAttribute('lang') ?? '';
          for (let j = i + 1; j < records.length; j++) {
            const q = records[j];
            if (q.type === 'attributes' && q.target === document.documentElement && q.attributeName === 'lang') {
              lang = q.oldValue ?? '';
              break;
            }
          }
          recording.firstContentLang = lang;
          break;
        }
      }
      if (root.childNodes.length > 0 && recording.states.length < 2000) {
        recording.states.push({
          at: performance.now(),
          lang: document.documentElement.getAttribute('lang') ?? '',
          items: collect(root),
        });
      }
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
    });
  }

  w.__emuforgeItLang = {
    areaRoot,
    wordmark,
    collect,
    page,
    layout,
    negativeTracking,
    placed,
    menuPlace,
    onTop,
    marks,
    visibleText,
    recording,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Probe = Record<string, (...args: unknown[]) => unknown> & {
  recording: Recording;
};

/** Installs the probe in the page's current document when it is not there yet. */
async function ensureProbe(page: Page): Promise<void> {
  await page.evaluate(installLanguageProbe, false);
}

/** Starts the `#root` recorder in every document `context` loads from now on, from the document's start. */
export async function recordRoot(target: BrowserContext | Page): Promise<void> {
  await target.addInitScript(installLanguageProbe, true);
}

export async function recording(page: Page): Promise<Recording> {
  return page.evaluate(() => (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.recording);
}

/** Marks the recording: the states recorded from now on are "after the mark". */
export async function markRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const r = (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.recording;
    r.mark = r.states.length;
  });
}

async function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  await ensureProbe(page);
  return (await page.evaluate(
    ([fn, list]) => {
      const api = (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang;
      return api[fn as string](...(list as unknown[]));
    },
    [name, args] as const,
  )) as T;
}

/** Throws at once, naming `what`, when `locator` finds nothing: a missing element fails its step without a wait. */
async function present(locator: Locator, what: string): Promise<void> {
  if ((await locator.count()) === 0) throw new Error(`${what} is not on the page`);
}

/** Studio's text of the page as it is now. */
export async function pageText(page: Page): Promise<PageText> {
  return call<PageText>(page, 'page');
}

/** Studio's text inside `locator`'s element (its text nodes and attributes), outside the area's root. */
export async function textWithin(page: Page, locator: Locator): Promise<TextItem[]> {
  await ensureProbe(page);
  await present(locator, 'the element');
  return locator.evaluate(
    (el) => (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.collect(el) as TextItem[],
    undefined,
    ACTION,
  );
}

/**
 * The live regions of Studio's own layer (`aria-live` other than `off`, roles `status`, `alert`, `log`) that hold
 * text now, each with its text and its text items.
 */
export async function liveRegions(page: Page): Promise<{ text: string; items: TextItem[] }[]> {
  await ensureProbe(page);
  return page.evaluate(() => {
    const api = (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang;
    const root = api.areaRoot() as Element | null;
    return [
      ...document.querySelectorAll('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]'),
    ]
      .filter((el) => !(root && root.contains(el)) && (el.textContent ?? '').trim() !== '')
      .map((el) => ({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        items: api.collect(el) as TextItem[],
      }));
  });
}

/** The AWS area's text and attributes, as `kind: text` strings in document order; `null` without an area. */
export async function areaText(page: Page): Promise<string[] | null> {
  await ensureProbe(page);
  return page.evaluate(() => {
    const api = (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang;
    if (!api.areaRoot()) return null;
    return (api.collect(null, true) as TextItem[]).map(
      (i) =>
        `${i.kind === 'attribute' ? `${i.where.replace(/^.* @/, '@')}=` : ''}${i.text.replace(/\s+/g, ' ').trim()}`,
    );
  });
}

/** The `lang` attribute of the area's root; `null` without an area, `''` when it carries none. */
export async function areaRootLang(page: Page): Promise<string | null> {
  await ensureProbe(page);
  return page.evaluate(() => {
    const root = (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.areaRoot() as Element | null;
    return root === null ? null : (root.getAttribute('lang') ?? '');
  });
}

/** Leaves a mark on the area's root element; `areaRootMarked` is true only while that same element is the root. */
export async function markAreaRoot(page: Page): Promise<boolean> {
  await ensureProbe(page);
  return page.evaluate(() => {
    const root = (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.areaRoot() as
      (Element & { __emuforgeItRoot?: boolean }) | null;
    if (root) root.__emuforgeItRoot = true;
    return root !== null;
  });
}

export async function areaRootMarked(page: Page): Promise<boolean> {
  await ensureProbe(page);
  return page.evaluate(() => {
    const root = (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.areaRoot() as
      (Element & { __emuforgeItRoot?: boolean }) | null;
    return root?.__emuforgeItRoot === true;
  });
}

export async function layout(page: Page): Promise<{ pageScrolls: boolean; issues: string[] }> {
  return call(page, 'layout');
}

/** Scripts whose text must not be tracked tighter than normal (R6.3), as Unicode property patterns. */
export const TRACKED_SCRIPTS: Record<string, string> = {
  th: '\\p{Script=Thai}',
  ko: '\\p{Script=Hangul}',
  ja: '[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}]',
};

export async function negativeTracking(page: Page, tag: string): Promise<string[]> {
  return call(page, 'negativeTracking', TRACKED_SCRIPTS[tag]);
}

/** Whether `locator`'s element lies inside the viewport and is not covered at its centre. */
export async function placed(
  page: Page,
  locator: Locator,
): Promise<{ inside: boolean; covered: boolean; rect: string }> {
  await ensureProbe(page);
  await present(locator, 'the element');
  return locator.evaluate(
    (el) =>
      (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.placed(el) as {
        inside: boolean;
        covered: boolean;
        rect: string;
      },
    undefined,
    ACTION,
  );
}

export async function visibleText(page: Page, locator: Locator): Promise<string> {
  await ensureProbe(page);
  await present(locator, 'the element');
  return locator.evaluate(
    (el) => (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.visibleText(el) as string,
    undefined,
    ACTION,
  );
}

export async function menuPlace(page: Page): Promise<{ problems: string[]; covers: string[] }> {
  await ensureProbe(page);
  await present(languageMenu(page), 'the language menu');
  const bar = await frame(page).banner.elementHandle(ACTION);
  return languageMenu(page).evaluate(
    (menu, b) =>
      (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.menuPlace(menu, b) as {
        problems: string[];
        covers: string[];
      },
    bar,
    ACTION,
  );
}

/** The points of `locator`'s element (corners and centre) where something else is on top. */
export async function notOnTop(page: Page, locator: Locator): Promise<string[]> {
  await ensureProbe(page);
  await present(locator, 'the element');
  return locator.evaluate(
    (el) => (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.onTop(el) as string[],
    undefined,
    ACTION,
  );
}

/** How many marks besides text `locator`'s element draws (visible icons and generated content). */
export async function marks(page: Page, locator: Locator): Promise<number> {
  await ensureProbe(page);
  await present(locator, 'the element');
  return locator.evaluate(
    (el) => (window as unknown as { __emuforgeItLang: Probe }).__emuforgeItLang.marks(el) as number,
    undefined,
    ACTION,
  );
}

/** Waits two frames and for every font load the page has started. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await document.fonts.ready;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Browser contexts with a language: the browser's locale or a stored choice.
// ---------------------------------------------------------------------------------------------------------------

export interface LanguageContextOptions {
  /** The browser's language (`navigator.languages`); default `en-US`, the checks' own (R8.1). */
  locale?: string;
  /** A stored choice, set through the context's storage state (R8.4). */
  stored?: string;
  width?: number;
  scheme?: Scheme;
  /** Start the `#root` recorder in every document of the context. */
  record?: boolean;
}

/** The context's viewport height for a width: the phone height at 390, else the desktop's. */
export function heightFor(width: number): number {
  return width <= 480 ? 844 : 800;
}

/**
 * Opens a context of the same browser with the check's destination rule (`proxy`, the `proxy` fixture of
 * `check.ts`), owned by `ctx` and closed when the check ends, and a page in it.
 */
export async function languageContext(
  ctx: Ctx,
  browser: Browser,
  proxy: BrowserContextOptions['proxy'],
  studio: StudioServer,
  options: LanguageContextOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const width = options.width ?? 1280;
  const context = await browser.newContext({
    proxy,
    baseURL: studio.origin,
    locale: options.locale ?? 'en-US',
    colorScheme: options.scheme ?? 'light',
    viewport: { width, height: heightFor(width) },
    serviceWorkers: 'block',
    storageState:
      options.stored === undefined
        ? undefined
        : {
            cookies: [],
            origins: [
              {
                origin: studio.origin,
                localStorage: [{ name: STORAGE_KEY, value: options.stored }],
              },
            ],
          },
  });
  ctx.own({ dispose: () => context.close() });
  if (options.record) await recordRoot(context);
  const page = await context.newPage();
  ctx.log(
    `context: locale ${options.locale ?? 'en-US'}, stored ${options.stored ?? '(none)'}, ${String(width)} wide, ${options.scheme ?? 'light'}`,
  );
  return { context, page };
}

/** The stored choice of the page's origin; `null` when the key is absent. */
export async function storedChoice(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
}

// ---------------------------------------------------------------------------------------------------------------
// The control and its menu (R3).
// ---------------------------------------------------------------------------------------------------------------

const OWN_NAME_AT_END = new RegExp(`(${LANGUAGES.map((l) => escapeRegExp(l.name)).join('|')})$`, 'u');

/** The control: the banner's button whose accessible name ends with a language's own name (R3.2). */
export function languageControl(page: Page): Locator {
  return frame(page).banner.getByRole('button', { name: OWN_NAME_AT_END });
}

/** The menu the control opens. */
export function languageMenu(page: Page): Locator {
  return page.getByRole('menu');
}

export function menuOptions(page: Page): Locator {
  return languageMenu(page).getByRole('menuitemradio');
}

export async function openMenu(page: Page): Promise<void> {
  await present(languageControl(page), 'the language control');
  await languageControl(page).click(ACTION);
  await languageMenu(page).waitFor({
    state: 'visible',
    timeout: ACTION.timeout,
  });
}

/** Opens the control and chooses an option: a language by its own name, or `browser` for "Browser language". */
export async function choose(page: Page, option: string): Promise<void> {
  await openMenu(page);
  const item =
    option === 'browser'
      ? menuOptions(page).first()
      : menuOptions(page).filter({
          hasText: new RegExp(`^${escapeRegExp(option)}$`),
        });
  await item.click(ACTION);
}

// ---------------------------------------------------------------------------------------------------------------
// Faces (R6): the platform fonts that draw each text node, through the DevTools protocol.
// ---------------------------------------------------------------------------------------------------------------

/** Faces of the passed mock, by the family name Chromium reports. */
export const FACES = {
  latin: 'Instrument Sans',
  noto: 'Noto Sans',
  thai: 'Noto Sans Thai',
  korean: 'Apple SD Gothic Neo',
  japanese: 'Hiragino Sans',
  code: 'JetBrains Mono',
} as const;

/** The face of each language's own script, for the languages whose script Instrument Sans lacks. */
const SCRIPT_FACE: Record<string, string> = {
  ru: FACES.noto,
  th: FACES.thai,
  ko: FACES.korean,
  ja: FACES.japanese,
};

/** A character drawn by a script's own face rather than Instrument Sans (Cyrillic, Thai, Hangul, kana, Han, CJK forms). */
const SCRIPT_CHAR =
  /[\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿゠-ヿ㄰-㆏＀-￯]/u;

export interface FaceItem {
  text: string;
  lang: string;
  code: boolean;
  wordmark: boolean;
  /** Text of a paragraph the check appended (`data-emuforge-it-value`). */
  value: boolean;
  where: string;
  /** Family names of the platform fonts that draw it, with their glyph counts. */
  fonts: { family: string; glyphs: number }[];
}

/** The faces allowed to draw `item`, by its own language (R6.2; the passed mock's per-script runs). */
export function allowedFaces(item: { text: string; lang: string; code: boolean; wordmark: boolean }): string[] {
  if (item.code) return [FACES.code];
  if (item.wordmark) return [FACES.latin];
  // The code face draws commands, addresses and paths (R6.2) wherever they stand; a Latin run may stay in Instrument Sans.
  if (ADDRESS.test(norm(item.text)) || PATH.test(norm(item.text))) return [FACES.code, FACES.latin];
  const tag = languageOf(item.lang)?.tag ?? item.lang;
  if (tag === 'vi') return [FACES.noto];
  const chars = [...item.text];
  const out: string[] = [];
  if (chars.some((c) => !SCRIPT_CHAR.test(c))) out.push(FACES.latin);
  const own = SCRIPT_FACE[tag];
  if (own && chars.some((c) => SCRIPT_CHAR.test(c))) out.push(own);
  return out;
}

function sameFace(reported: string, expected: string): boolean {
  return reported.toLowerCase().replace(/\s+variable$/, '') === expected.toLowerCase();
}

const LATIN_LETTER = /\p{Script=Latin}/gu;
/** Latin ligatures a face may form by default (`liga`); each draws its letters as one glyph. */
const LATIN_LIGATURE = /ff[il]?|f[ijlt]/g;

/**
 * The fewest glyphs that can draw the Latin letters of `text`: one per letter, less what the default ligatures
 * join.
 */
function latinGlyphsAtLeast(text: string): number {
  const letters = text.match(LATIN_LETTER)?.length ?? 0;
  const joined = [...text.matchAll(LATIN_LIGATURE)].reduce((n, m) => n + m[0].length - 1, 0);
  return letters - joined;
}

/**
 * Why `item` is drawn by another face than `allowed` (default: `allowedFaces`); `null` when it is not. When a node
 * mixes a script's own face with Instrument Sans, its Latin runs must be Instrument Sans's (R6.2): that face draws
 * at least one glyph per Latin letter, so a stack that puts the script's face first, which also carries Latin, is
 * told apart.
 */
export function faceProblem(item: FaceItem, allowed = allowedFaces(item)): string | null {
  const drawnBy = `"${norm(item.text).slice(0, 50)}" (lang ${item.lang || 'none'}) in ${item.where} is drawn by ${item.fonts.map((f) => `${f.family} (${String(f.glyphs)})`).join(', ')}`;
  const other = item.fonts.filter((f) => !allowed.some((a) => sameFace(f.family, a)));
  if (other.length > 0) return `${drawnBy}; allowed: ${allowed.join(', ') || 'none'}`;
  const mixed =
    allowed.some((a) => sameFace(a, FACES.latin)) &&
    allowed.some((a) => Object.values(SCRIPT_FACE).some((s) => sameFace(a, s)));
  if (!mixed) return null;
  const need = latinGlyphsAtLeast(item.text);
  const latin = item.fonts.filter((f) => sameFace(f.family, FACES.latin)).reduce((n, f) => n + f.glyphs, 0);
  if (latin >= need) return null;
  return `${drawnBy}; its Latin letters need at least ${String(need)} glyphs of ${FACES.latin}, it draws ${String(latin)}`;
}

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue: string;
  attributes?: string[];
  children?: DomNode[];
}

/**
 * Every drawn text node of Studio's own layer with the platform fonts that draw it (`CSS.getPlatformFontsForNode`).
 * A node no font draws (not laid out) is left out.
 */
export async function faceItems(page: Page): Promise<FaceItem[]> {
  await ensureProbe(page);
  await settled(page);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = (await session.send('DOM.getDocument', {
      depth: -1,
    })) as unknown as { root: DomNode };
    const nodeIdOf = async (expression: string): Promise<number | null> => {
      const { result } = await session.send('Runtime.evaluate', { expression });
      if (!result.objectId) return null;
      const { nodeId } = await session.send('DOM.requestNode', {
        objectId: result.objectId,
      });
      return nodeId;
    };
    const area = await nodeIdOf('window.__emuforgeItLang.areaRoot()');
    const mark = await nodeIdOf('window.__emuforgeItLang.wordmark()');
    const found: {
      nodeId: number;
      text: string;
      lang: string;
      code: boolean;
      wordmark: boolean;
      value: boolean;
      where: string;
    }[] = [];
    const walk = (
      node: DomNode,
      at: {
        lang: string;
        code: boolean;
        wordmark: boolean;
        value: boolean;
        where: string;
      },
    ): void => {
      if (node.nodeType === 3) {
        if (node.nodeValue.trim() !== '') found.push({ nodeId: node.nodeId, text: node.nodeValue, ...at });
        return;
      }
      if (node.nodeType === 1) {
        if (node.nodeId === area) return;
        if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD'].includes(node.nodeName)) return;
        const attrs = new Map<string, string>();
        for (let i = 0; i + 1 < (node.attributes ?? []).length; i += 2)
          attrs.set(node.attributes![i], node.attributes![i + 1]);
        const cls = attrs.get('class')?.split(/\s+/)[0];
        at = {
          lang: attrs.get('lang') ?? at.lang,
          code: at.code || node.nodeName === 'CODE' || node.nodeName === 'PRE',
          wordmark: at.wordmark || node.nodeId === mark,
          value: at.value || attrs.has('data-emuforge-it-value'),
          where: `${node.nodeName.toLowerCase()}${cls ? `.${cls}` : ''}`,
        };
      }
      for (const child of node.children ?? []) walk(child, at);
    };
    walk(root, {
      lang: '',
      code: false,
      wordmark: false,
      value: false,
      where: 'document',
    });
    const out: FaceItem[] = [];
    for (const f of found) {
      const { fonts } = (await session.send('CSS.getPlatformFontsForNode', {
        nodeId: f.nodeId,
      })) as {
        fonts: { familyName: string; glyphCount: number }[];
      };
      if (fonts.length === 0) continue;
      const { nodeId: _id, ...rest } = f;
      void _id;
      out.push({
        ...rest,
        fonts: fonts.map((x) => ({
          family: x.familyName,
          glyphs: x.glyphCount,
        })),
      });
    }
    return out;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

/**
 * Appends one paragraph per value to Studio's `main` (outside the area), each with the value as its text and the
 * attribute `data-emuforge-it-value`; the check adds them, Studio's code is unchanged. Returns how many were added.
 */
export async function appendValues(page: Page, values: string[]): Promise<number> {
  return page.getByRole('main').evaluate(
    (main, list) => {
      for (const v of list) {
        const p = document.createElement('p');
        p.setAttribute('data-emuforge-it-value', '');
        p.textContent = v;
        main.appendChild(p);
      }
      return list.length;
    },
    values,
    ACTION,
  );
}

export async function removeValues(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('[data-emuforge-it-value]').forEach((p) => p.remove()));
}
