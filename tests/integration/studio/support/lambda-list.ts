// The Lambda function list ("Event Functions") and its delete dialog as a user meets them (test-criteria.md, issue
// 84, Flow checks; requirement R4, R6.1, R7 to R10). Used by the `lambda-function-list*.spec.ts` and
// `lambda-function-delete.spec.ts` checks. The emulator side (direct calls, `LambdaSeeded`) is `support/lambda.ts`.
//
// - The screen: its words (R4, R6.1, R7, R8, R9, R10; the console's words of `function-list.yaml` and Studio's own),
//   and readers of what it shows: the table's rows by its column headings, the counter after the `h1`, the property
//   filter and its token, the actions, the pagination, the preferences, the notice, the delete dialog and the
//   area's Flashbar.
// - `applyFilter`: "apply the filter `x`" of the criteria: type `x` into "Search by attributes or search by keyword"
//   and press Enter.
// - `ListFunctionsRecord`: the page's `ListFunctions` requests to the engine (`GET /2015-03-31/functions/` on the
//   engine's origin), from Playwright's request events; it only listens.
// - `ListFunctionsHold`: holds the page's `ListFunctions` requests to the engine in the browser until the check lets
//   them go, with a Chrome DevTools Protocol `Fetch` session on the page, as `ListBucketsHold` of `support/s3.ts`
//   does. It answers nothing: every request it pauses is continued unchanged, a held one when it is let go, every
//   other at once (CORS preflights included, so the engine answers them itself).
//
// Every value a check compares with comes from the run: names from the check's own prefix, descriptions, runtimes,
// dates and messages from a direct answer, the endpoint from the emulator's port.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';

import { expect, type Ctx } from './check';
import { ACTION } from './frame';
import type { FunctionConfiguration } from './lambda';
import { creationDateText } from './s3';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words.
// ---------------------------------------------------------------------------------------------------------------

/** The service's route and the list's own route (R0). */
export const LAMBDA_PATH = '/aws/lambda';
export const FUNCTIONS_PATH = '/aws/lambda/functions';
export const CREATE_PATH = '/aws/lambda/functions/create';

/** A function's page (R0). */
export function functionPath(name: string): string {
  return `/aws/lambda/functions/function/${name}`;
}

/** The service's label: the `h1` of its "no screen yet" page (`services/lambda/service.json`). */
export const SERVICE_LABEL = 'AWS Lambda';

/** The `h1` without its counter (R6.1). */
export const H1 = 'Event Functions';

/** The crumbs of the list (R6.1). */
export const CRUMBS = ['EmuForge', 'AWS', 'Lambda', 'Event Functions'];

/** The header's actions, in order (R8). */
export const REFRESH = 'Refresh';
export const ACTIONS = 'Actions';
export const CREATE = 'Create Event Function';
export const DELETE = 'Delete';

/** The columns, in order (R4.2). */
export const COLUMNS = ['Function name', 'Description', 'Package type', 'Runtime', 'Type', 'Last modified'];

/** The filter's placeholder and accessible name (R4.7). */
export const FILTER = 'Search by attributes or search by keyword';
export const PREFERENCES = 'Preferences';
export const NEXT_PAGE = 'Next page';
export const PREVIOUS_PAGE = 'Previous page';

/** The states' words (R10.1). */
export const LOADING = 'Loading functions';
export const NO_FUNCTIONS = 'No functions';
export const NO_MATCHES = 'No matches';
export const CLEAR_FILTER = 'Clear filter';

/** The sentence of the "No matches" state for the filter `text` (R10.1). */
export function noMatchSentence(text: string): string {
  return `No function name starts with “${text}”.`;
}

/** The count beside the filter (R4.7): "1 match", "<n> matches". */
export function matchesText(n: number): string {
  return n === 1 ? '1 match' : `${String(n)} matches`;
}

/** The notice and its controls (R6.1; `studio/AGENTS.md`). */
export const NOTICE = 'These functions are in your local emulator';
export const NOTICE_REGION = 'Local emulator notice';
export const NOTICE_CLOSE = 'Close the local emulator notice';
export const ABOUT = 'About the local emulator';

/** The preferences (R9.5). */
export const CONFIRM = 'Confirm';
export const CANCEL = 'Cancel';
export function pageSizeOption(size: 10 | 25 | 50): string {
  return `${String(size)} functions`;
}

/** The delete dialog (R7). */
export const DELETE_DIALOG = 'Delete functions';
export const CONFIRM_FIELD = 'To confirm deletion, type "confirm" in the field.';
export const CONFIRM_WORD = 'confirm';

/** The Flashbar's success item after a delete of `n` functions (R7). */
export function deletedText(n: number): string {
  return n === 1
    ? '1 function was deleted from the local emulator.'
    : `${String(n)} functions were deleted from the local emulator.`;
}

/** The Flashbar's error item's header for a delete of `name` that failed (R10.3). */
export function deleteFailedText(name: string): string {
  return `Deleting ${name} failed`;
}

/** The tabs of a function's page that lead to a route without a screen, and the route's last segment (R8). */
export const TAB_ROUTES: { tab: string; segment: string }[] = [
  { tab: 'Test', segment: 'test' },
  { tab: 'Monitor', segment: 'monitor' },
  { tab: 'Configuration', segment: 'configuration' },
  { tab: 'Aliases', segment: 'aliases' },
  { tab: 'Versions', segment: 'versions' },
];

/** The create form's words the delete check uses (R6.2, R6.5). */
export const FUNCTION_NAME_FIELD = 'Function name';

// ---------------------------------------------------------------------------------------------------------------
// Cells as the screen writes them.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The console's names of the runtimes the checks make functions with (R4.2: the user guide's table, `lambda-runtimes`,
 * ".x" kept where the identifier ends in ".x").
 */
const RUNTIME_NAMES: Record<string, string> = {
  'nodejs24.x': 'Node.js 24.x',
  'nodejs22.x': 'Node.js 22.x',
  'python3.14': 'Python 3.14',
  'python3.13': 'Python 3.13',
};

/** The "Runtime" cell for the `Runtime` of a direct answer (R4.2); "-" without one. */
export function runtimeText(runtime: string | undefined): string {
  if (runtime === undefined || runtime === '') return '-';
  const name = RUNTIME_NAMES[runtime];
  if (name === undefined) throw new Error(`no runtime name for ${runtime} in support/lambda-list.ts`);
  return name;
}

/** One row of the table as it is shown: the cells under the six column headings. */
export interface ShownRow {
  name: string;
  description: string;
  packageType: string;
  runtime: string;
  type: string;
  lastModified: string;
}

/**
 * The row the screen shows for a function of a direct `ListFunctions` (R4.2), its "Last modified" in the time zone
 * `zone` the check sets on its browser context.
 */
export function expectedRow(f: FunctionConfiguration, zone: { offsetMinutes: number; label: string }): ShownRow {
  const dash = (v: string | undefined) => (v === undefined || v === '' ? '-' : v);
  return {
    name: f.FunctionName,
    description: dash(f.Description),
    packageType: dash(f.PackageType),
    runtime: runtimeText(f.Runtime),
    type: f.DurableConfig === undefined ? 'Standard' : 'Durable',
    lastModified: creationDateText(f.LastModified ?? null, zone),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** The screen's Cloudscape `Table`: its header with the actions, the filter, pagination, preferences and body. */
export const TABLE = wrapper.findTable().toSelector();
/** The table's empty slot, where the empty, no-match and failure states are shown (R10.1). */
export const TABLE_EMPTY = wrapper.findTable().findEmptySlot().toSelector();
/** The table's property filter (R4.7). */
export const PROPERTY_FILTER = wrapper.findTable().findPropertyFilter().toSelector();
/** The property filter's count beside it (R4.7). */
export const RESULTS_COUNT = wrapper.findTable().findPropertyFilter().findResultsCount().toSelector();
/** The property filter's tokens. */
export const TOKENS = wrapper.findTable().findPropertyFilter().findTokens().toSelector();
/** The area's Flashbar and its items (R7, R10.3). */
export const FLASH_ITEMS = wrapper.findFlashbar().findItems().toSelector();

/** The `h1` of the list, with or without its counter. */
export function listHeading(page: Page): Locator {
  return page.getByRole('heading', {
    level: 1,
    name: new RegExp(`^${H1}(\\s|$)`),
  });
}

/** The screen's parts a check acts on or reads. */
export function screen(page: Page) {
  const table = page.locator(TABLE);
  return {
    h1: listHeading(page),
    table,
    filter: page.getByRole('combobox', { name: FILTER, exact: true }),
    resultsCount: page.locator(RESULTS_COUNT),
    tokens: page.locator(TOKENS),
    action: (name: string) => page.getByRole('main').getByRole('button', { name, exact: true }).first(),
    create: page
      .getByRole('main')
      .getByRole('link', { name: CREATE, exact: true })
      .or(page.getByRole('main').getByRole('button', { name: CREATE, exact: true }))
      .first(),
    menuItem: (name: string) => page.getByRole('menuitem', { name, exact: true }),
    nextPage: page.getByRole('button', { name: NEXT_PAGE, exact: true }),
    previousPage: page.getByRole('button', {
      name: PREVIOUS_PAGE,
      exact: true,
    }),
    preferences: page.getByRole('button', { name: PREFERENCES, exact: true }),
    /** A row's check box, named by its function (R4.3). */
    checkbox: (name: string) => table.getByRole('checkbox', { name, exact: true }),
    nameLink: (name: string) => table.getByRole('link', { name, exact: true }),
    empty: page.locator(TABLE_EMPTY),
    notice: page.getByText(NOTICE, { exact: true }),
    noticeRegion: page.getByRole('region', {
      name: NOTICE_REGION,
      exact: true,
    }),
    noticeClose: page.getByRole('button', { name: NOTICE_CLOSE, exact: true }),
    about: page.getByRole('button', { name: ABOUT, exact: true }),
  };
}

/** Opens `at` and waits for the list's `h1` "Event Functions". */
export async function openList(page: Page, at: string = FUNCTIONS_PATH): Promise<void> {
  await page.goto(at);
  await expect(listHeading(page), `the function list's h1 "${H1}" at ${at}`).toBeVisible();
}

/**
 * The table's data rows as shown, each read by the six column headings; a row whose only cell spans the table
 * (loading, empty and failure states) is not a data row. `null` when the screen has no table, or the table lacks one
 * of the six headings.
 */
export async function shownRows(page: Page): Promise<ShownRow[] | null> {
  const table = page.locator(TABLE);
  if ((await table.count()) === 0) return null;
  return table.first().evaluate((root, columns) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    // The table that holds a body; a sticky copy of the header is hidden from assistive technology.
    const el = [...root.querySelectorAll('table')].find(
      (t) => t.tBodies.length > 0 && !t.closest('[aria-hidden="true"]'),
    );
    if (!el) return null;
    const head = el.tHead?.rows[0];
    if (!head) return null;
    const headings = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
    const at = columns.map((name) => headings.indexOf(name));
    if (at.some((i) => i < 0)) return null;
    const rows: ShownRow[] = [];
    for (const row of el.tBodies[0].rows) {
      if (row.cells.length <= 1) continue;
      const cell = (i: number) => norm((row.cells[i] as HTMLElement | undefined)?.innerText ?? '');
      rows.push({
        name: cell(at[0]),
        description: cell(at[1]),
        packageType: cell(at[2]),
        runtime: cell(at[3]),
        type: cell(at[4]),
        lastModified: cell(at[5]),
      });
    }
    return rows;
  }, COLUMNS);
}

/** The names of the table's data rows, in order; `[]` when there is no table. */
export async function shownNames(page: Page): Promise<string[]> {
  return ((await shownRows(page)) ?? []).map((r) => r.name);
}

/** Waits until the table's rows are exactly `names`, in that order. */
export async function expectNames(page: Page, names: string[], message: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => shownNames(page), { timeout, message }).toEqual(names);
}

/** The list's `h1` as shown, white space collapsed ("Event Functions (3)"); `null` when it is not there. */
export async function headingText(page: Page): Promise<string | null> {
  const h1 = listHeading(page);
  if ((await h1.count()) === 0) return null;
  return (await h1.first().innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/** The counter after the `h1` without its parentheses ("3", "10+"); `null` when there is none. */
export async function counter(page: Page): Promise<string | null> {
  const text = await headingText(page);
  const m = text === null ? null : /\(([^)]*)\)$/.exec(text);
  return m ? m[1] : null;
}

/**
 * "Apply the filter `text`" (the criteria's words): types `text` into "Search by attributes or search by keyword" and
 * presses Enter, which makes it the filter's one token (R4.7).
 */
export async function applyFilter(page: Page, text: string): Promise<void> {
  const filter = screen(page).filter;
  await filter.fill(text, ACTION);
  await filter.press('Enter', ACTION);
}

/** The texts of the filter's tokens as shown. */
export async function tokenTexts(page: Page): Promise<string[]> {
  return (await screen(page).tokens.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** Opens "Preferences", sets the page size, and confirms. Waits until the dialog is gone. */
export async function setPageSize(page: Page, size: 10 | 25 | 50): Promise<void> {
  await screen(page).preferences.click(ACTION);
  const dialog = page.getByRole('dialog', { name: PREFERENCES });
  await expect(dialog, `the dialog "${PREFERENCES}"`).toBeVisible();
  await dialog.getByRole('radio', { name: pageSizeOption(size), exact: true }).check(ACTION);
  await dialog.getByRole('button', { name: CONFIRM, exact: true }).click(ACTION);
  await expect(dialog, `the dialog "${PREFERENCES}" closes`).toHaveCount(0);
}

/** The delete dialog's parts. */
export function deleteDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: DELETE_DIALOG });
  return {
    dialog,
    field: dialog.getByLabel(CONFIRM_FIELD, { exact: true }),
    delete: dialog.getByRole('button', { name: DELETE, exact: true }),
    cancel: dialog.getByRole('button', { name: CANCEL, exact: true }),
    /** The names the dialog lists, in order: the items of its list. */
    names: async () => (await dialog.getByRole('listitem').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()),
  };
}

/** Selects the rows of `names`, then chooses "Actions", "Delete"; waits for the dialog. */
export async function openDeleteDialog(page: Page, names: string[]): Promise<void> {
  const s = screen(page);
  for (const name of names) await s.checkbox(name).check(ACTION);
  await s.action(ACTIONS).click(ACTION);
  await s.menuItem(DELETE).click(ACTION);
  await expect(deleteDialog(page).dialog, `the dialog "${DELETE_DIALOG}"`).toBeVisible();
}

/** The texts of the area's Flashbar items as shown, white space collapsed. */
export async function flashTexts(page: Page): Promise<string[]> {
  return (await page.locator(FLASH_ITEMS).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

// ---------------------------------------------------------------------------------------------------------------
// The page's ListFunctions requests.
// ---------------------------------------------------------------------------------------------------------------

/** True when `url` with `method` is a `ListFunctions` to the engine at `engineOrigin`: `GET /2015-03-31/functions/`. */
export function isListFunctions(url: string, method: string, engineOrigin: string): boolean {
  const u = new URL(url);
  return u.origin === engineOrigin && method === 'GET' && /^\/2015-03-31\/functions\/?$/.test(u.pathname);
}

/** One `ListFunctions` request of the page, with its query and its answer's status once it came. */
export interface ListRequest {
  query: Record<string, string>;
  status: number | null;
  failed: string | null;
}

/** The page's `ListFunctions` requests to the engine, from Playwright's request events of the context. */
export class ListFunctionsRecord {
  readonly requests: ListRequest[] = [];

  private constructor(private readonly ctx: Ctx) {}

  static attach(ctx: Ctx, context: BrowserContext, engineOrigin: string): ListFunctionsRecord {
    const record = new ListFunctionsRecord(ctx);
    const byRequest = new Map<object, ListRequest>();
    context.on('request', (request) => {
      if (!isListFunctions(request.url(), request.method(), engineOrigin)) return;
      const seen: ListRequest = {
        query: Object.fromEntries(new URL(request.url()).searchParams),
        status: null,
        failed: null,
      };
      byRequest.set(request, seen);
      record.requests.push(seen);
    });
    context.on('requestfinished', (request) => {
      const seen = byRequest.get(request);
      if (!seen) return;
      void request.response().then((response) => {
        seen.status = response?.status() ?? 0;
        ctx.log(`ListFunctions ${JSON.stringify(seen.query)} answered ${String(seen.status)}`);
      });
    });
    context.on('requestfailed', (request) => {
      const seen = byRequest.get(request);
      if (!seen) return;
      seen.failed = request.failure()?.errorText ?? 'failed';
      ctx.log(`ListFunctions ${JSON.stringify(seen.query)} failed: ${seen.failed}`);
    });
    return record;
  }

  /** How many `ListFunctions` requests have been answered so far. */
  answered(): number {
    return this.requests.filter((r) => r.status !== null).length;
  }

  /** Waits until more than `from` requests have been answered. */
  async answeredAfter(from: number, message: string, timeout = 10_000): Promise<void> {
    await expect.poll(() => this.answered(), { timeout, message }).toBeGreaterThan(from);
  }

  /** Writes the record to the check's log. */
  log(): void {
    this.ctx.log(`ListFunctions requests: ${JSON.stringify(this.requests)}`);
  }
}

/**
 * Holds the page's `ListFunctions` requests to the engine in the browser while `holding`, through a CDP `Fetch`
 * session on `page`. It answers nothing: a held request is continued unchanged when `release` is called, every other
 * paused request (session, health, CORS preflights) at once.
 */
export class ListFunctionsHold {
  private holding = true;
  private readonly held: string[] = [];

  private constructor(
    private readonly ctx: Ctx,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(ctx: Ctx, context: BrowserContext, page: Page, engineOrigin: string): Promise<ListFunctionsHold> {
    const cdp = await context.newCDPSession(page);
    const hold = new ListFunctionsHold(ctx, cdp);
    cdp.on('Fetch.requestPaused', (e) => {
      if (hold.holding && isListFunctions(e.request.url, e.request.method, engineOrigin)) {
        hold.held.push(e.requestId);
        ctx.log(`holding ListFunctions ${new URL(e.request.url).search}`);
        return;
      }
      void cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => undefined);
    });
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: `${engineOrigin}/*`, requestStage: 'Request' }],
    });
    return hold;
  }

  /** How many `ListFunctions` requests are held now. */
  count(): number {
    return this.held.length;
  }

  /** Lets every held request go, unchanged, and holds no more. */
  async release(): Promise<void> {
    this.holding = false;
    for (const requestId of this.held.splice(0)) {
      await this.cdp.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
    }
    this.ctx.log('let the held ListFunctions requests go');
  }

  async stop(): Promise<void> {
    await this.release();
    await this.cdp.send('Fetch.disable').catch(() => undefined);
  }
}
