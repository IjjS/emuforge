// The delete page, the empty page and its status as a user meets them, and what every one of the four screens of a
// bucket shows when the bucket is missing or a read fails (test-criteria.md, issue 256, Flow checks of delete, empty
// and of all four screens; requirement R5.5, R7, R8, R9.4, R9.5, R11, R12). Imported directly by
// `s3-delete-bucket.spec.ts`, `s3-empty-bucket.spec.ts`, `s3-bucket-screens.spec.ts`,
// `s3-bucket-screens-states.spec.ts` and `s3-bucket-screens-keyboard.spec.ts`; the words of a bucket's page and of
// the create form, `EngineHold` and the flash are `services/s3/s3-bucket-page.ts`'s, the direct calls and `Seeded`
// `services/s3/s3.ts`'s.
//
// - The words: English, word for word from the requirement (R5.5, R7, R8, R9.4, R9.5, R11.1, R11.4).
// - Text "shown by the page" is text outside the emulator line, the side navigation and the area's flash, so the
//   line's own status, its "Connection status", the navigation's "General purpose buckets" and a flash item never
//   stand in for what the page itself shows.
// - `EngineAnswers` lists the page's S3 requests to the engine by operation (`operationOf` of `s3-bucket-page.ts`)
//   with their answers' status, `Code` and `Message`, from Playwright's request events; it only listens.
// - The Cloudscape selectors made by `createWrapper()` start with `body `, so they are rooted at the page, never under
//   another locator.
//
// Every value a check compares with comes from the run: names from the check's own prefix, endpoints from the
// emulator's port, the engine's origin and messages from the engine the check started, failures from the emulator.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { BrowserContext, Locator, Page } from '@playwright/test';

import { endpointPattern, emulatorLine, LINE_LABEL } from '../../support/aws-area';
import { expect, type Ctx } from '../../support/check';
import { ACTION, heading, SIDE_NAVIGATION } from '../../support/frame';
import { operationOf } from './s3-bucket-page';

/** The area's `Flashbar` (rooted at the page: the selector starts with `body `). */
const FLASHBAR = createWrapper().findFlashbar().toSelector();

// ---------------------------------------------------------------------------------------------------------------
// Routes (R0).
// ---------------------------------------------------------------------------------------------------------------

const segment = (name: string) => encodeURIComponent(name);

/** The empty page of `name` (S3) and its delete page (S4). */
export function emptyPath(name: string): string {
  return `/aws/s3/bucket/${segment(name)}/empty`;
}
export function deletePath(name: string): string {
  return `/aws/s3/bucket/${segment(name)}/delete`;
}

// ---------------------------------------------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Bucket not found" of every screen (R5.5), and the list's link in it. */
export const NOT_FOUND = 'Bucket not found';
export const GENERAL_PURPOSE_BUCKETS = 'General purpose buckets';
export function notFoundSentence(name: string): string {
  return `The emulator holds no bucket named “${name}”. It may have been deleted, or the emulator restarted.`;
}

/** The states of a read (R11.1) and of an action (R11.4). */
export const NOT_READ = 'The bucket could not be read.';
export const RETRY = 'Retry';
export const CONNECTION_STATUS = 'Connection status';
export const EMULATOR_DID_NOT_ANSWER = 'The emulator did not answer';
/** "The EmuForge engine at `<origin>` did not answer" of an action (R11.4). */
export function engineDidNotAnswer(origin: string): RegExp {
  return new RegExp(`The EmuForge engine at ${escape(origin)} did not answer`);
}

/** The delete page (R7, R9.5). */
export const DELETE_H1 = 'Delete bucket';
export const DELETE_BUTTON = 'Delete bucket';
export const DELETE_FIELD = 'To confirm deletion, enter the name of the bucket.';
export const CANCEL = 'Cancel';
export const NOT_EMPTY = 'This bucket is not empty';
export const NOT_EMPTY_TEXT =
  'A bucket can be deleted only when it holds no object, object version or delete marker. Empty it, then come back to this page.';
export const EMPTY_BUCKET = 'Empty bucket';
/** The delete page's sentence, connected to the emulator on `port` (R9.5). */
export function deleteSentence(name: string, port: number): RegExp {
  return new RegExp(
    `Bucket “${escape(name)}” will be deleted from your local emulator at ${endpointPattern(port)}\\. This cannot be undone\\.`,
  );
}
/** The flash item after `DeleteBucket` (R7.4). */
export function deletedItem(name: string): string {
  return `Bucket “${name}” was deleted from the local emulator.`;
}

/** The empty page and its status (R8, R9.4). */
export const EMPTY_H1 = 'Empty bucket';
export const STATUS_H1 = 'Empty bucket: Status';
export const EMPTY_BUTTON = 'Empty';
export const EMPTY_FIELD = 'To confirm, enter the name of the bucket.';
export const EMPTYING = 'Emptying the bucket';
export const ITEM_MEANS = 'An item is an object version or a delete marker.';
export const FAILURES_TITLE = 'Could not be deleted';
export const FAILURE_COLUMNS = ['Key', 'Version ID', 'Error'];
/** The empty page's sentence, connected to the emulator on `port` (R9.4). */
export function emptySentence(name: string, port: number): RegExp {
  return new RegExp(
    `Every object, object version and delete marker in bucket “${escape(name)}” will be deleted from your local emulator at ${endpointPattern(port)}\\. This cannot be undone\\.`,
  );
}

/** "1 item", "<n> items" (R8.5). */
export function items(n: number): string {
  return n === 1 ? '1 item' : `${String(n)} items`;
}
/** The count while the emptying runs and after it (R8.4). */
export function deletedCount(n: number): string {
  return `${items(n)} deleted`;
}
/** The result when nothing failed (R8.5). */
export function emptiedResult(name: string, n: number): string {
  return n === 0
    ? `Bucket “${name}” was already empty.`
    : `Bucket “${name}” is empty. ${items(n)} deleted from the local emulator.`;
}
/** The result when `m` items failed and `n` were deleted (R8.5). */
export function failedResult(name: string, m: number, n: number): string {
  return `${items(m)} could not be deleted from bucket “${name}”. ${items(n)} deleted.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The two pages' controls.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Elements outside every `nav` (the side navigation and the crumbs are each one) and outside the emulator line (the
 * group labelled by the element that reads `LINE_LABEL`).
 */
const OUTSIDE_NAV_AND_LINE =
  `xpath=//*[not(ancestor-or-self::nav)]` +
  `[not(ancestor-or-self::*[@role='group'][@aria-labelledby = //*[normalize-space(.)='${LINE_LABEL}']/@id])]`;

/** A link or a button named `name` that the page itself shows: visible, outside every `nav` and the emulator line. */
export function pageControl(page: Page, name: string): Locator {
  return page
    .getByRole('link', { name, exact: true })
    .or(page.getByRole('button', { name, exact: true }))
    .filter({ visible: true })
    .and(page.locator(OUTSIDE_NAV_AND_LINE));
}

/** The Cloudscape alerts of the page (rooted at the page: the selector starts with `body `). */
export const ALERTS = createWrapper().findAlert().toSelector();

/** The delete page's controls (R7). */
export function deletePage(page: Page) {
  const alert = page.locator(ALERTS).filter({ hasText: NOT_EMPTY });
  return {
    h1: heading(page, DELETE_H1),
    field: page.getByRole('textbox', { name: DELETE_FIELD, exact: true }),
    cancel: page.getByRole('button', { name: CANCEL, exact: true }),
    delete: page.getByRole('button', { name: DELETE_BUTTON, exact: true }),
    alert,
    emptyBucket: alert
      .getByRole('link', { name: EMPTY_BUCKET, exact: true })
      .or(alert.getByRole('button', { name: EMPTY_BUCKET, exact: true })),
  };
}

/** The empty page's controls (R8). */
export function emptyPage(page: Page) {
  return {
    h1: heading(page, EMPTY_H1),
    statusH1: heading(page, STATUS_H1),
    field: page.getByRole('textbox', { name: EMPTY_FIELD, exact: true }),
    cancel: page.getByRole('button', { name: CANCEL, exact: true }),
    empty: page.getByRole('button', { name: EMPTY_BUTTON, exact: true }),
    retry: page.getByRole('button', { name: RETRY, exact: true }),
    deleteLink: pageControl(page, DELETE_BUTTON),
    listLink: pageControl(page, GENERAL_PURPOSE_BUCKETS),
  };
}

/** Opens the delete page of `name` and waits for its `h1`. */
export async function openDeletePage(page: Page, name: string): Promise<void> {
  await page.goto(deletePath(name));
  await expect(heading(page, DELETE_H1), `the delete page's h1 "${DELETE_H1}"`).toBeVisible();
}

/** Opens the empty page of `name` and waits for its `h1`. */
export async function openEmptyPage(page: Page, name: string): Promise<void> {
  await page.goto(emptyPath(name));
  await expect(heading(page, EMPTY_H1), `the empty page's h1 "${EMPTY_H1}"`).toBeVisible();
}

/** On the empty page of `name`: types the name and presses "Empty"; waits for the status's `h1`. */
export async function startEmptying(page: Page, name: string): Promise<void> {
  const e = emptyPage(page);
  await e.field.fill(name, ACTION);
  await e.empty.click(ACTION);
  await expect(e.statusH1, `the status's h1 "${STATUS_H1}"`).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------
// What the page shows, apart from the line, the navigation and the flash.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Whether an element the page itself shows (visible, outside the emulator line, the side navigation and the area's
 * flash) holds text matching `text` (a string matches as a part).
 */
export async function pageShows(page: Page, text: string | RegExp): Promise<boolean> {
  const matches = page.getByText(text);
  if ((await matches.count()) === 0) return false;
  const line = (await emulatorLine(page).count()) === 1 ? await emulatorLine(page).elementHandle(ACTION) : null;
  return matches.evaluateAll(
    (els, { line, nav, flash }) =>
      els.some((el) => {
        const box = (el as HTMLElement).getBoundingClientRect();
        if (box.width === 0 && box.height === 0) return false;
        if (line !== null && (line as Node).contains(el)) return false;
        if (el.closest(nav) !== null || el.closest(flash) !== null) return false;
        return el.closest('[aria-hidden="true"]') === null;
      }),
    { line, nav: SIDE_NAVIGATION, flash: FLASHBAR },
  );
}

/** Waits until the page itself shows `text`. */
export async function expectPageShows(
  page: Page,
  text: string | RegExp,
  message: string,
  timeout = 10_000,
): Promise<void> {
  await expect.poll(() => pageShows(page, text), { timeout, message }).toBe(true);
}

/** Waits until a flash item of `type` holds `text` (rooted at the page: the selector starts with `body `). */
export async function expectFlash(page: Page, type: 'success' | 'error', text: string): Promise<void> {
  const typed = page.locator(createWrapper().findFlashbar().findItemsByType(type).toSelector());
  await expect(typed.filter({ hasText: text }), `a flash item of type ${type} holds "${text}"`).toHaveCount(1);
}

/**
 * Whether the page itself (outside the flash) shows an error: a Cloudscape alert or status indicator of type `error`
 * holding `text`.
 */
export async function pageShowsError(page: Page, text: string): Promise<boolean> {
  return page.evaluate(
    ({ wanted, flash }) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ');
      const errors = [...document.querySelectorAll('[class*="awsui_"]')].filter(
        (el) => [...el.classList].some((c) => /^awsui_(type|status)-error(_|$)/.test(c)) && el.closest(flash) === null,
      );
      // The error's own box, or the nearest container around it, holds the text.
      return errors.some((el) => {
        for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
          if (norm((a as HTMLElement).innerText).includes(wanted)) return true;
          if (a.tagName === 'MAIN') return false;
        }
        return false;
      });
    },
    { wanted: text, flash: FLASHBAR },
  );
}

/** Where the topmost element the page itself shows with `text` is drawn; `null` when there is none. */
export async function topOf(page: Page, text: string | RegExp): Promise<number | null> {
  const matches = page.getByText(text);
  if ((await matches.count()) === 0) return null;
  const line = (await emulatorLine(page).count()) === 1 ? await emulatorLine(page).elementHandle(ACTION) : null;
  return matches.evaluateAll(
    (els, { line, flash }) => {
      const tops = els
        .filter((el) => (line === null || !(line as Node).contains(el)) && el.closest(flash) === null)
        .map((el) => (el as HTMLElement).getBoundingClientRect())
        .filter((b) => b.width > 0 || b.height > 0)
        .map((b) => b.top);
      return tops.length === 0 ? null : Math.min(...tops);
    },
    { line, flash: FLASHBAR },
  );
}

/** Waits until the page itself shows `text` above `button` (R7.4, R6.6: "above the buttons"). */
export async function expectAbove(page: Page, text: string | RegExp, button: Locator, what: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const top = await topOf(page, text);
        if (top === null || (await button.count()) === 0) return `${String(text)} not shown`;
        const box = await button.first().boundingBox();
        if (box === null) return 'the button is not drawn';
        return top < box.y ? 'above' : `drawn at ${top.toFixed(0)}, the button at ${box.y.toFixed(0)}`;
      },
      { message: what },
    )
    .toBe('above');
}

/** One row of the table "Could not be deleted", by its column headings. */
export interface FailureRow {
  Key: string;
  'Version ID': string;
  Error: string;
}

/**
 * The rows of the table whose column headings are "Key", "Version ID" and "Error" (the table "Could not be deleted",
 * R8.5); `null` when the page holds no such table.
 */
export async function failureRows(page: Page): Promise<FailureRow[] | null> {
  return page.evaluate((columns) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const table = [...document.querySelectorAll('table')].find((t) => {
      if (t.tBodies.length === 0 || t.closest('[aria-hidden="true"]')) return false;
      const head = t.tHead?.rows[0];
      const headings = head ? [...head.cells].map((c) => norm((c as HTMLElement).innerText)) : [];
      return columns.every((c) => headings.includes(c));
    });
    if (!table) return null;
    const headings = [...table.tHead!.rows[0]!.cells].map((c) => norm((c as HTMLElement).innerText));
    const rows: Record<string, string>[] = [];
    for (const row of table.tBodies[0]!.rows) {
      if (row.cells.length <= 1) continue;
      const record: Record<string, string> = {};
      for (const c of columns)
        record[c] = norm((row.cells[headings.indexOf(c)] as HTMLElement | undefined)?.innerText ?? '');
      rows.push(record);
    }
    return rows;
  }, FAILURE_COLUMNS) as Promise<FailureRow[] | null>;
}

// ---------------------------------------------------------------------------------------------------------------
// The page's requests to the engine and their answers.
// ---------------------------------------------------------------------------------------------------------------

/** One S3 request of the page to the engine, and its answer once it came. */
export interface EngineCall {
  operation: string;
  bucket: string | null;
  status: number | null;
  code: string | null;
  message: string | null;
  /** The browser's error when the request failed without an answer (aborted, refused). */
  failed: string | null;
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** The page's S3 requests to the engine at `engineOrigin`, in the order they left, with their answers. */
export class EngineAnswers {
  readonly calls: EngineCall[] = [];
  private readonly pending: Promise<unknown>[] = [];

  private constructor(private readonly ctx: Ctx) {}

  static attach(ctx: Ctx, context: BrowserContext, engineOrigin: string): EngineAnswers {
    const record = new EngineAnswers(ctx);
    const byRequest = new Map<object, EngineCall>();
    context.on('request', (request) => {
      const operation = operationOf(request.url(), request.method(), engineOrigin);
      if (operation === null) return;
      const first = new URL(request.url()).pathname.split('/')[1] ?? '';
      const call: EngineCall = {
        operation,
        bucket: first === '' ? null : decodeURIComponent(first),
        status: null,
        code: null,
        message: null,
        failed: null,
      };
      byRequest.set(request, call);
      record.calls.push(call);
    });
    context.on('requestfinished', (request) => {
      const call = byRequest.get(request);
      if (!call) return;
      record.pending.push(
        (async () => {
          const response = await request.response();
          const body = await response?.text().catch(() => '');
          call.code = /<Code>([^<]*)<\/Code>/.exec(body ?? '')?.[1] ?? null;
          const message = /<Message>([^<]*)<\/Message>/.exec(body ?? '')?.[1];
          call.message = message === undefined ? null : xmlText(message);
          call.status = response?.status() ?? 0;
        })().catch(() => undefined),
      );
    });
    context.on('requestfailed', (request) => {
      const call = byRequest.get(request);
      if (call) call.failed = request.failure()?.errorText ?? 'failed';
    });
    return record;
  }

  /** The calls of `operation` (for `bucket`, when given). */
  of(operation: string, bucket?: string): EngineCall[] {
    return this.calls.filter((c) => c.operation === operation && (bucket === undefined || c.bucket === bucket));
  }

  /** Whether every call so far has its answer or its failure. */
  settled(): boolean {
    return this.calls.every((c) => c.status !== null || c.failed !== null);
  }

  /** Waits until every call so far has its answer or its failure. */
  async settle(message: string, timeout = 10_000): Promise<void> {
    await expect.poll(() => this.settled(), { timeout, message }).toBe(true);
    await Promise.allSettled(this.pending.splice(0));
  }

  /** The `Message` of the latest answer whose `Code` is `code`; `null` when none came. */
  latestMessage(code: string): string | null {
    for (const call of [...this.calls].reverse()) if (call.code === code && call.message !== null) return call.message;
    return null;
  }

  log(): void {
    this.ctx.log(`engine calls: ${JSON.stringify(this.calls)}`);
  }
}
