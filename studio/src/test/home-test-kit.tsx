// Used by unit tests only; nothing in the app imports it. A fake engine behind `fetch` that answers Studio's
// `/config.json`, the engine's session and health routes the way a test tells it to and records every request,
// and Home rendered with the app's real routes and providers. Only the network is replaced. For tests of language:
// a marked test catalogue and what of Studio's text it does not cover.

import { notifyManager } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PROVIDERS } from '../app/provider-list';
import { Providers } from '../app/providers';
import { routes } from '../app/routes';
import { BUNDLED_CATALOGUES } from '../i18n/bundled';
import {
  catalogueSet,
  PLACEHOLDER,
  textsOf,
  type Catalogue,
  type Catalogues,
  type Message,
  type MessageKey,
} from '../i18n/catalogue';
import { createLanguageStore, type LanguageStore } from '../i18n/language';

// TanStack Query hands its notifications to React on a 0 ms timer. Under fake timers a 0 ms timer set while timers
// run waits for the clock to move, which would make every step of a test move time; the kit notifies in a microtask.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

export type FakeAnswer =
  /** `ignoreAbort`: delivered after `delayMs` even when the request was aborted, as a transport that does not stop. */
  | { status: number; json?: unknown; text?: string; delayMs?: number; ignoreAbort?: boolean }
  /** The request fails at the network level, as a refused connection or an answer the browser withholds. */
  | { network: true; delayMs?: number }
  /** No answer until the request is aborted. */
  | { hang: true };

export interface SeenRequest {
  url: string;
  origin: string;
  path: string;
  /** Header names lower-case. */
  headers: Record<string, string>;
  init: RequestInit;
  /** The request's signal was aborted, before or after its answer. */
  aborted: () => boolean;
}

export const TOKEN_1 = 'a'.repeat(64);
export const TOKEN_2 = 'b'.repeat(64);

export function connected(port = 9297): FakeAnswer {
  return { status: 200, json: { emulator: { port, endpoint: `https://127.0.0.1:${String(port)}`, reachable: true } } };
}

export function emulatorDown(reason: string | undefined, port = 9297, message = 'the engine says why'): FakeAnswer {
  return {
    status: 503,
    json: { emulator: { port, endpoint: `https://127.0.0.1:${String(port)}`, reachable: false, reason, message } },
  };
}

export function engineRefusal(status: number, code: string, message = `the engine refused: ${code}`): FakeAnswer {
  return { status, json: { error: { code, message } } };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** A fake engine on `127.0.0.1:<enginePort>`; install it with `vi.stubGlobal('fetch', engine.fetch)`. */
export class FakeEngine {
  /** What `/config.json` answers: an engine port, or `undefined` for a 404 (no Studio server). */
  configPort: number | undefined = 8297;
  readonly requests: SeenRequest[] = [];
  /** Answers to session requests, in order; the last one repeats. */
  sessionAnswers: FakeAnswer[] = [{ status: 200, json: { token: TOKEN_1 } }];
  /** Answers to health requests, in order; the last one repeats. */
  healthAnswers: FakeAnswer[] = [connected()];
  private sessionCount = 0;
  private healthCount = 0;

  /** Requests to the engine's `path`. */
  to(path: string): SeenRequest[] {
    return this.requests.filter((r) => r.origin.startsWith('http://127.0.0.1:') && r.path === path);
  }

  get sessions(): SeenRequest[] {
    return this.to('/__emuforge/session');
  }

  get healths(): SeenRequest[] {
    return this.to('/__emuforge/health');
  }

  /** Every later health request is answered `answer`. */
  answerHealth(...answers: FakeAnswer[]): void {
    this.healthAnswers = [...this.healthAnswers.slice(0, this.healthCount), ...answers];
  }

  /** Every later session request is answered `answer`. */
  answerSession(...answers: FakeAnswer[]): void {
    this.sessionAnswers = [...this.sessionAnswers.slice(0, this.sessionCount), ...answers];
  }

  readonly fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), window.location.href);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => (headers[name] = value));
    const signal = init.signal ?? undefined;
    this.requests.push({
      url: String(input),
      origin: url.origin,
      path: url.pathname,
      headers,
      init,
      aborted: () => signal?.aborted === true,
    });
    if (url.origin === window.location.origin && url.pathname === '/config.json') {
      return Promise.resolve(
        this.configPort === undefined
          ? new Response('not found', { status: 404 })
          : Response.json({ enginePort: this.configPort }),
      );
    }
    let answer: FakeAnswer;
    if (url.pathname === '/__emuforge/session') {
      answer = this.sessionAnswers[Math.min(this.sessionCount++, this.sessionAnswers.length - 1)] ?? { hang: true };
    } else if (url.pathname === '/__emuforge/health') {
      answer = this.healthAnswers[Math.min(this.healthCount++, this.healthAnswers.length - 1)] ?? { hang: true };
    } else {
      answer = { network: true };
    }
    return this.deliver(answer, signal);
  };

  private deliver(answer: FakeAnswer, signal: AbortSignal | undefined): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted === true && !('ignoreAbort' in answer)) {
        reject(abortError(signal));
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (!('ignoreAbort' in answer && answer.ignoreAbort === true)) {
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(abortError(signal));
        });
      }
      if ('hang' in answer) {
        return;
      }
      const send = () => {
        if ('network' in answer) {
          reject(new TypeError('Failed to fetch'));
        } else {
          const body = answer.text ?? (answer.json === undefined ? null : JSON.stringify(answer.json));
          resolve(new Response(body, { status: answer.status }));
        }
      };
      if (answer.delayMs === undefined) {
        send();
      } else {
        timer = setTimeout(send, answer.delayMs);
      }
    });
  }
}

/** `value`, or a failure naming `what` when it is missing. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} is missing`);
  }
  return value;
}

/**
 * Lets every timer due within `ms` fire, then settles what they started: answers, TanStack Query's notifications and
 * React's renders, each render able to start the next request. Each round is its own `act`, so React renders between.
 */
export async function advance(ms = 0): Promise<void> {
  const { vi } = await import('vitest');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let round = 0; round < 10; round++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/**
 * Renders the app's routes at `path` (Home by default) with its providers, in `language` (by default the one the
 * browser's languages give over the bundled catalogues).
 */
export function renderApp(path = '/', language?: LanguageStore) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <Providers language={language}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...result, router };
}

/** The marks around every value of the marked test catalogue. */
export const MARK_OPEN = '⟦';
export const MARK_CLOSE = '⟧';

/** The tag of the marked test catalogue: a well-formed tag of no language Studio has. */
export const MARKED_TAG = 'zz';

function mark(text: string): string {
  return `${MARK_OPEN}${text}${MARK_CLOSE}`;
}

function markMessage(message: Message): Message {
  return typeof message === 'string'
    ? mark(message)
    : Object.fromEntries(Object.entries(message).map(([category, text]) => [category, mark(text)]));
}

/** A test catalogue that holds every message of `source` (English), each value wrapped in the marks. */
export function markedCatalogue(source: Catalogue = BUNDLED_CATALOGUES.source): Catalogue {
  return {
    tag: MARKED_TAG,
    name: mark(source.name),
    sameAsEnglish: [],
    messages: new Map([...source.messages].map(([key, message]) => [key, markMessage(message)])),
  };
}

/** Studio's bundled catalogues and the marked test catalogue. */
export function withMarked(): Catalogues {
  return catalogueSet([...BUNDLED_CATALOGUES.byTag.values(), markedCatalogue()]);
}

/** A page's current language: `tag` from `catalogues`, as a browser whose only language is `tag` resolves it. */
export function languageStore(tag: string, catalogues: Catalogues = withMarked()): LanguageStore {
  return createLanguageStore(catalogues, { languages: [tag], language: tag, storage: () => window.localStorage });
}

/** What is kept as it is besides what the kit knows itself (test-criteria.md, "Kept as it is"). */
export interface KeptAsItIs {
  /** The engine's `message`s the page was sent: kept in an element with `lang="en"` that holds exactly one. */
  engineMessages?: readonly string[];
}

/** Names Studio never translates: the wordmark and the providers' names and service labels (R4.3). */
function keptNames(): string[] {
  const names = PROVIDERS.flatMap((p) => [p.name, p.shortName, ...p.services.map((service) => service.label)]);
  // Longest first, so a name that holds another is removed whole.
  return ['EmuForge Studio', 'EmuForge', ...names].sort((a, b) => b.length - a.length);
}

const ADDRESS = /https?:\/\/127\.0\.0\.1(?::\d+)?/g;
const DIGITS_AND_PUNCTUATION = /^[\p{N}\p{P}\p{S}\s]*$/u;

/** Whether `text`, once names and addresses are taken out, is digits and punctuation alone. */
function keptText(text: string): boolean {
  let rest = text.replace(ADDRESS, ' ');
  for (const name of keptNames()) {
    rest = rest.split(name).join(' ');
  }
  return DIGITS_AND_PUNCTUATION.test(rest);
}

/** The text of `text` outside the marks, from `depth` marks open; and the depth at its end. */
function outsideMarks(text: string, depth = 0): { outside: string; depth: number } {
  let outside = '';
  let open = depth;
  for (const char of text) {
    if (char === MARK_OPEN) {
      open++;
    } else if (char === MARK_CLOSE) {
      open = Math.max(0, open - 1);
    } else if (open === 0) {
      outside += char;
    }
  }
  return { outside, depth: open };
}

/** Whether `element` is inside a provider's area, which is not Studio's own layer. */
function inArea(element: Element): boolean {
  return element.closest('.st-area') !== null;
}

/** Attributes that hold text a user hears or reads. */
const TEXT_ATTRIBUTES = ['aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'title', 'alt'];

/**
 * Every piece of Studio's text (test-criteria.md) on the page that is neither inside the marks nor kept as it is:
 * text nodes of Studio's own layer, read in document order so a placeholder's element sits inside its message's
 * marks, its attributes that are read or heard, and the document title. Empty when the page holds only marked text.
 */
export function unmarkedText(kept: KeptAsItIs = {}): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let depth = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || inArea(parent)) {
      continue;
    }
    const step = outsideMarks(node.textContent ?? '', depth);
    depth = step.depth;
    if (step.outside.trim() === '' || parent.closest('code, pre, .st-wordmark') !== null) {
      continue;
    }
    // The engine's message, or a language's own name in an element of that language (R4.3).
    if (keptByLang(parent, kept)) {
      continue;
    }
    if (!keptText(step.outside)) {
      found.push(`text "${norm(step.outside)}" in <${parent.tagName.toLowerCase()}>`);
    }
  }
  for (const element of document.body.querySelectorAll('*')) {
    if (inArea(element)) {
      continue;
    }
    for (const name of TEXT_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value !== null && !keptText(outsideMarks(value).outside)) {
        found.push(`${name} "${value}" on <${element.tagName.toLowerCase()}>`);
      }
    }
  }
  if (!keptText(outsideMarks(document.title).outside)) {
    found.push(`document title "${document.title}"`);
  }
  return found;
}

/** `text` as a pattern: whitespace runs match any whitespace, every other character itself. */
function literalPattern(text: string): string {
  return escapeRegExp(text.trim()).replace(/\s+/g, '\\s+');
}

/**
 * What a value of a catalogue can show as one text node, attribute or title (test-criteria.md, "comes from L's
 * catalogue"): the value with each placeholder standing for any text, and each run of its pieces split around
 * placeholders, since a placeholder's element splits the value's text. A pattern whose own text holds no letter
 * (`{code}: {message}`) is left out: punctuation alone is kept as it is, and such a pattern would match any text.
 */
function valuePatterns(text: string): RegExp[] {
  const pieces = text.split(PLACEHOLDER).filter((_part, index) => index % 2 === 0);
  const patterns: RegExp[] = [];
  for (let first = 0; first < pieces.length; first++) {
    for (let last = first; last < pieces.length; last++) {
      const run = pieces.slice(first, last + 1);
      if (!/\p{L}/u.test(run.join(''))) {
        continue;
      }
      const body = run.map((piece, index) => {
        const own = literalPattern(piece);
        return index === 0 ? own : `[\\s\\S]+?${own}`;
      });
      patterns.push(new RegExp(`^\\s*${body.join('')}\\s*$`, 'u'));
    }
  }
  return patterns;
}

/** Every value of `catalogue`, by key: its texts' patterns, and the whole value's pattern for each text. */
interface CataloguePatterns {
  /** Every pattern of every value, the language's own name included. */
  pieces: RegExp[];
  /** By key, the pattern of each whole text (each plural form). */
  whole: Map<string, RegExp[]>;
}

const PATTERNS = new Map<string, CataloguePatterns>();

function patternsOf(tag: string): CataloguePatterns {
  let patterns = PATTERNS.get(tag);
  if (patterns === undefined) {
    const catalogue = present(withMarked().byTag.get(tag), `the catalogue ${tag}`);
    const whole = new Map<string, RegExp[]>();
    const pieces: RegExp[] = [];
    for (const [key, message] of catalogue.messages) {
      const texts = textsOf(message);
      pieces.push(...texts.flatMap(valuePatterns));
      // Only a text with words of its own: one of punctuation and placeholders alone would match any text.
      const worded = texts.filter((text) =>
        /\p{L}/u.test(
          text
            .split(PLACEHOLDER)
            .filter((_p, i) => i % 2 === 0)
            .join(''),
        ),
      );
      whole.set(
        key,
        worded.map((text) => {
          const parts = text
            .split(PLACEHOLDER)
            .map((part, index) => (index % 2 === 1 ? '[\\s\\S]+?' : literalPattern(part)));
          return new RegExp(`^\\s*${parts.join('')}\\s*$`, 'u');
        }),
      );
    }
    pieces.push(...valuePatterns(catalogue.name));
    patterns = { pieces, whole };
    PATTERNS.set(tag, patterns);
  }
  return patterns;
}

/** Whether `text` is an English value whose text `tag`'s catalogue does not give for the same key. */
function englishNotOwn(tag: string, text: string): boolean {
  const own = patternsOf(tag).whole;
  return [...patternsOf(BUNDLED_CATALOGUES.source.tag).whole].some(
    ([key, english]) =>
      english.some((pattern) => pattern.test(text)) && !(own.get(key) ?? []).some((pattern) => pattern.test(text)),
  );
}

/** Why `text` of Studio's text is not `tag`'s: `undefined` when it comes from `tag`'s catalogue or is kept as it is. */
function notFrom(tag: string, text: string): string | undefined {
  if (keptText(text)) {
    return undefined;
  }
  if (!patternsOf(tag).pieces.some((pattern) => pattern.test(text))) {
    return 'not from the catalogue';
  }
  if (tag !== BUNDLED_CATALOGUES.source.tag && englishNotOwn(tag, text)) {
    return "an English value the catalogue's differs from";
  }
  return undefined;
}

/** The own names of the languages Studio has, by tag (R1.3): kept as they are in an element with that `lang`. */
function ownNames(): Map<string, string> {
  return new Map([...withMarked().byTag.values()].map((catalogue) => [catalogue.tag, catalogue.name]));
}

/** Whether `element` sits in an element whose `lang` keeps its text as it is: the engine's message, or an own name. */
function keptByLang(element: Element, kept: KeptAsItIs): boolean {
  const marked = element.closest('[lang]');
  if (marked === null || marked === document.documentElement) {
    return false;
  }
  const lang = marked.getAttribute('lang') ?? '';
  const text = marked.textContent ?? '';
  return (lang === 'en' && (kept.engineMessages ?? []).includes(text)) || ownNames().get(lang) === text;
}

/**
 * Every piece of Studio's text (test-criteria.md) on the page that neither comes from the catalogue of `tag` nor is
 * kept as it is, and every text that is an English value where `tag`'s catalogue gives another: text nodes of
 * Studio's own layer, the attributes read or heard, and the document title, each split at " | ". Empty when the page
 * is wholly in `tag`.
 */
export function textNotFrom(tag: string, kept: KeptAsItIs = {}): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = node.textContent ?? '';
    if (parent === null || inArea(parent) || text.trim() === '' || parent.closest('code, pre, .st-wordmark') !== null) {
      continue;
    }
    if (keptByLang(parent, kept)) {
      continue;
    }
    const why = notFrom(tag, text);
    if (why !== undefined) {
      found.push(`text "${norm(text)}" in <${parent.tagName.toLowerCase()}>: ${why}`);
    }
  }
  for (const element of document.body.querySelectorAll('*')) {
    if (inArea(element)) {
      continue;
    }
    for (const name of TEXT_ATTRIBUTES) {
      const value = element.getAttribute(name);
      const why = value === null ? undefined : notFrom(tag, value);
      if (why !== undefined) {
        found.push(`${name} "${String(value)}" on <${element.tagName.toLowerCase()}>: ${why}`);
      }
    }
  }
  for (const part of document.title.split(' | ')) {
    const why = notFrom(tag, part);
    if (why !== undefined) {
      found.push(`document title "${document.title}", "${part}": ${why}`);
    }
  }
  return found;
}

/**
 * Every element of Studio's own layer whose `lang` differs from the page's and whose text is not the engine's
 * message or the own name of the language it names (requirement R4.3): `[]` when there is none.
 */
export function otherLangElements(kept: KeptAsItIs = {}): string[] {
  const page = document.documentElement.lang;
  return [...document.body.querySelectorAll('[lang]')]
    .filter((element) => !inArea(element) && element.getAttribute('lang') !== page)
    .filter((element) => !keptByLang(element, kept))
    .map(
      (element) =>
        `<${element.tagName.toLowerCase()} lang="${String(element.getAttribute('lang'))}">${norm(element.textContent)}`,
    );
}

/** The status words a row shows (requirement R9.1). */
const STATUSES = ['Checking', 'Connected', 'Not started', 'Unreachable', 'Error', 'Unknown'];

export interface RowText {
  status: string;
  text: string;
}

export function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What the message `key` reads in any language of the bundled catalogues or the marked one, each placeholder standing
 * for any text: how the kit finds an element by the name a user hears in whichever language the page is in.
 */
function anyLanguage(key: MessageKey): RegExp {
  const texts = [...withMarked().byTag.values()].flatMap((catalogue) => {
    const message = catalogue.messages.get(key);
    return message === undefined ? [] : textsOf(message);
  });
  const patterns = texts.map((text) =>
    text
      .split(PLACEHOLDER)
      .map((part, index) => (index % 2 === 1 ? '.+' : escapeRegExp(part)))
      .join(''),
  );
  return new RegExp(`^(?:${patterns.join('|')})$`, 'su');
}

/** The "Connection" section: the region of that name, in the page's language. */
export function connectionSection(): HTMLElement {
  return screen.getByRole('region', { name: anyLanguage('connection.title') });
}

/** The status and the whole text of the "Engine" or "Emulator" row: the term of that name and what it describes. */
export function row(label: 'Engine' | 'Emulator'): RowText {
  const term = within(connectionSection())
    .getAllByRole('term')
    .find((el) => norm(el.textContent) === label);
  const scope = present(term?.parentElement, `the "${label}" row`);
  const statuses = [...scope.querySelectorAll('dd *')]
    .map((el) => norm(el.textContent))
    .filter((text) => STATUSES.includes(text));
  return { status: [...new Set(statuses)].join(' | '), text: norm(scope.textContent) };
}

/** The line that describes the "Connection" section (next to its heading). */
export function connectionDescription(): string {
  const id = present(connectionSection().getAttribute('aria-describedby'), "the section's description");
  return norm(document.getElementById(id)?.textContent);
}

/** The notices inside the "Connection" section: what each heading under "Connection" heads. */
export function connectionNotices(): HTMLElement[] {
  return within(connectionSection())
    .queryAllByRole('heading', { level: 3 })
    .map((heading) => present(heading.closest<HTMLElement>('.st-notice'), 'the notice of a heading'));
}

/** The one notice inside the "Connection" section; fails when there is not exactly one. */
export function connectionNotice(): HTMLElement {
  const notices = connectionNotices();
  if (notices.length !== 1) {
    throw new Error(`expected one notice in "Connection", found ${String(notices.length)}`);
  }
  return present(notices[0], 'the notice');
}

/** The notice's heading. */
export function noticeHeading(notice: HTMLElement = connectionNotice()): HTMLElement {
  return within(notice).getByRole('heading', { level: 3 });
}

/** The text of the notice, whitespace collapsed. */
export function noticeText(notice: HTMLElement = connectionNotice()): string {
  return norm(notice.textContent);
}

/** The commands shown in `scope`, in order: each command group's `pre`, as lines. */
export function commandsIn(scope: HTMLElement): string[][] {
  return within(scope)
    .queryAllByRole('group', { name: anyLanguage('command.group') })
    .map((group) => (group.querySelector('pre')?.textContent ?? '').split('\n'));
}

/** The copy buttons shown in `scope`, in order. */
export function copyButtonsIn(scope: HTMLElement): HTMLElement[] {
  return within(scope).queryAllByRole('button', { name: anyLanguage('copy.name') });
}

/** The build-once toggle of the notice, or `null`. */
export function buildOnceToggle(notice: HTMLElement = connectionNotice()): HTMLElement | null {
  return within(notice).queryByRole('button', { name: anyLanguage('notice.buildOnce') });
}

/** The header "Refresh" of Home. */
export function headerRefresh(): HTMLElement {
  return screen.getByRole('button', { name: /^Refresh$/ });
}

/** The "Refresh" of the notice, by its accessible name. */
export function noticeRefresh(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Refresh connection status' });
}

/** The polite regions of the "Connection" section, the state's and the copy region, and what each says now. */
export function politeRegions(): HTMLElement[] {
  return [...connectionSection().querySelectorAll<HTMLElement>('[aria-live="polite"]')];
}

/** Every element of the document whose class names a Cloudscape class (`awsui…`). */
export function cloudscapeElements(scope: Element = document.documentElement): Element[] {
  return [scope, ...scope.querySelectorAll('*')].filter((el) =>
    [...el.classList].some((name) => name.startsWith('awsui')),
  );
}
