// The S3 bucket list screen as a user meets it, and the emulator it is compared with (test-criteria.md, issue 56,
// Flow checks; requirement R3 to R9). Used by the `s3-bucket-list*.spec.ts` checks and `safety.spec.ts`.
//
// - Direct calls: S3 operations straight to the emulator, SigV4-signed with the key it wrote for this run, TLS
//   verified against its `ca.pem`, never through the engine. Unlike `directS3` of `aws-clients.ts` they carry a query
//   string (`ListBuckets` with `max-buckets`, `prefix`, `continuation-token`) and may be signed for another Region
//   (`CreateBucket` in `ap-northeast-2`, R2). A direct `ListBuckets` always sends `max-buckets`: without it the
//   emulator leaves `BucketRegion` out (R2).
// - `Seeded`: the buckets a check makes, each removed (its objects first) when the check ends.
// - The screen: its words (R3 to R8, English), and readers of what it shows — the table's rows by its column
//   headings, the counter after the table's title, the filter, the actions, the help panel and the notice.
// - `ListBucketsRecord`: the page's `ListBuckets` requests to the engine (`GET /` on the engine's origin), from
//   Playwright's request events; it only listens.
// - `ListBucketsHold`: holds the page's `ListBuckets` requests to the engine in the browser until the check lets them
//   go, with a Chrome DevTools Protocol `Fetch` session on the page. It answers nothing: every request it pauses is
//   continued unchanged, a held one when it is let go, every other at once (CORS preflights included, so the engine
//   answers them itself; that is what a Playwright `route` would not do, `check.ts`).
//
// Every value a check compares with comes from the run: names from the check's own prefix, Regions, dates and ARNs
// from a direct answer, the endpoint from the emulator's port, the engine's origin from the engine the check started.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { EnvError, expect, type Ctx } from './check';
import { emulatorDir, readEmulatorFiles } from './emulator';
import { ACTION, heading } from './frame';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words.
// ---------------------------------------------------------------------------------------------------------------

/** The service's route and the bucket list's own route (R0). */
export const S3_PATH = '/aws/s3';
export const BUCKETS_PATH = '/aws/s3/buckets';

/** The `h1`, the document title's first part and the content target's name (R5.4). */
export const H1 = 'Buckets';

/** Home's link to the service (R1). */
export const SERVICE_LABEL = 'Amazon Simple Storage Service';

/** The crumbs on both routes (R5.3). */
export const CRUMBS = ['EmuForge', 'AWS', 'S3', 'Buckets'];

/** The side navigation of the screen (R5.1). */
export const NAV_HEADER = 'Amazon S3';
export const NAV_GENERAL = 'General purpose buckets';
export const NAV_DIRECTORY = 'Directory buckets';

/** The tabs (R3 rows 4 and 6) and the table's title (R5.4). */
export const TAB_GENERAL = 'General purpose buckets';
export const TAB_DIRECTORY = 'Directory buckets';
export const TABLE_TITLE = 'General purpose buckets';

/** The actions, in order (R3 row 8, R6). */
export const REFRESH = 'Refresh Buckets';
export const COPY_ARN = 'Copy ARN';
export const EMPTY = 'Empty';
export const DELETE = 'Delete';
export const CREATE = 'Create bucket';
export const ACTIONS = [REFRESH, COPY_ARN, EMPTY, DELETE, CREATE];
/** The actions that need a selected row (R6). */
export const SELECTION_ACTIONS = [COPY_ARN, EMPTY, DELETE];

export const FILTER = 'Find buckets by name';
export const PREFERENCES = 'Preferences';
export const INFO = 'Info';
export const NEXT_PAGE = 'Next page';
export const PREVIOUS_PAGE = 'Previous page';

/** The states' words (R7). */
export const LOADING = 'Loading buckets';
export const NO_BUCKETS = 'No buckets';
export const NO_MATCHES = 'No matches';
export const CLEAR_FILTER = 'Clear filter';
export const RETRY = 'Retry';
export const NOT_READ = 'The bucket list could not be read.';
export const ARN_COPIED = 'ARN copied';

/** The sentence of the "No matches" state for the filter `text` (R7). */
export function noMatchSentence(text: string): string {
  return `No bucket name starts with “${text}”.`;
}

/** The notice and its controls (R5.5; `studio/AGENTS.md`). */
export const NOTICE = 'These buckets are in your local emulator';
export const NOTICE_CLOSE = 'Close the local emulator notice';
export const ABOUT = 'About the local emulator';

/** The help panel (R5.6, R8.5). */
export const HELP_OPEN = 'Open help panel';
export const HELP_CLOSE = 'Close help panel';

/** The description under the table's heading, connected, for the emulator at `endpoint` (R8.2). */
export function descriptionAt(endpoint: string): string {
  return `Buckets in your local emulator at ${endpoint}, not in an AWS account.`;
}

/** The preferences (R8.4). */
export const PAGE_SIZE = 'Page size';
export const WRAP_LINES = 'Wrap lines';
export const CONFIRM = 'Confirm';
export const CANCEL = 'Cancel';
export function pageSizeOption(size: 10 | 25 | 50): string {
  return `${String(size)} buckets`;
}

/** The longest name S3 allows. */
export const LONGEST_NAME = 63;

// ---------------------------------------------------------------------------------------------------------------
// Names, Regions and dates as the screen writes them.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The check's own prefix `<p>`: `efit-<run id>-<tag>`. Each check passes its own `tag`, none of which starts with
 * another, so a filter on one check's prefix never lists another check's bucket on the run's shared emulator.
 */
export function checkPrefix(ctx: Ctx, tag: string): string {
  return `efit-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${tag}`;
}

/**
 * AWS's public names of the Regions the checks make buckets in (AWS General Reference, "AWS Regions"). A check
 * reads the code of each bucket from a direct answer and looks its name up here.
 */
const REGION_NAMES: Record<string, string> = {
  'us-east-1': 'US East (N. Virginia)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
};

/** The "AWS Region" cell for the Region `code` of a direct answer (R4.2): `<name> <code>`, or "-" without one. */
export function regionText(code: string | null): string {
  if (code === null) return '-';
  const name = REGION_NAMES[code];
  if (name === undefined) throw new Error(`no Region name for ${code} in support/s3.ts`);
  return `${name} ${code}`;
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

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** An answer of a direct call, or the error that kept it from arriving. */
export type Direct = { status: number; body: string } | { error: string };

/** `status` of a direct answer, or its error, for the log. */
export function shownDirect(answer: Direct): string {
  return 'error' in answer ? `error ${answer.error}` : `status ${String(answer.status)}`;
}

const sha256Hex = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 percent-encoding, as SigV4 wants it: everything but the unreserved characters. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `method pathname?query` with `body` straight to the S3 of the emulator on `port`, header-signed for `region` with
 * the emulator's key over `host`, `x-amz-content-sha256` and `x-amz-date`, TLS verified against its `ca.pem`.
 */
async function signedS3(
  ctx: Ctx,
  port: number,
  method: string,
  pathname: string,
  query: [string, string][] = [],
  body = '',
  region = 'us-east-1',
): Promise<Direct> {
  const dir = emulatorDir(ctx.home, port);
  const key = readEmulatorFiles(dir);
  if (!key) return { error: `the emulator files under ${dir} are incomplete` };
  const ca = fs.readFileSync(path.join(dir, 'ca.pem'));
  const amzDate = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: `127.0.0.1:${String(port)}`,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalQuery = query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonical = [
    method,
    pathname,
    canonicalQuery,
    ...names.map((n) => `${n}:${headers[n]}`),
    '',
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const sent: Record<string, string> = { ...headers };
  delete sent.host;
  sent.authorization =
    `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, ` +
    `Signature=${signature}`;
  if (body !== '') sent['content-length'] = String(Buffer.byteLength(body));
  const target = canonicalQuery === '' ? pathname : `${pathname}?${canonicalQuery}`;
  return new Promise((resolve) => {
    const request = https.request(
      { host: '127.0.0.1', port, method, path: target, ca, agent: false, timeout: 5_000, headers: sent },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
        response.on('error', (e) => resolve({ error: e.message }));
      },
    );
    request.on('timeout', () => request.destroy(new Error('no answer within 5 s')));
    request.on('error', (e) => resolve({ error: e.message }));
    request.end(body === '' ? undefined : body);
  });
}

/** One bucket of a direct `ListBuckets`, each value as the emulator wrote it, `null` when it wrote none. */
export interface DirectBucket {
  name: string;
  region: string | null;
  creationDate: string | null;
  arn: string | null;
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function element(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? xmlText(m[1]) : null;
}

/** Fails the check (an assertion, not the environment) unless `answer` has `status`; returns its body. */
function answered(answer: Direct, status: number, what: string): string {
  expect('error' in answer ? answer.error : answer.status, `${what}: ${shownDirect(answer)}`).toBe(status);
  return 'error' in answer ? '' : answer.body;
}

/**
 * Every bucket a direct `ListBuckets` returns, in its order, page after page of 1000 (`max-buckets` always sent, so
 * each bucket carries its Region), with `prefix` when given.
 */
export async function listBucketsDirect(ctx: Ctx, port: number, prefix?: string): Promise<DirectBucket[]> {
  const buckets: DirectBucket[] = [];
  let token: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const query: [string, string][] = [['max-buckets', '1000']];
    if (prefix !== undefined) query.push(['prefix', prefix]);
    if (token !== null) query.push(['continuation-token', token]);
    const body = answered(await signedS3(ctx, port, 'GET', '/', query), 200, 'direct ListBuckets');
    for (const m of body.matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g)) {
      buckets.push({
        name: element(m[1], 'Name') ?? '',
        region: element(m[1], 'BucketRegion'),
        creationDate: element(m[1], 'CreationDate'),
        arn: element(m[1], 'BucketArn'),
      });
    }
    token = element(body, 'ContinuationToken');
    if (token === null) return buckets;
  }
  throw new Error('direct ListBuckets: more than 100 pages');
}

/** The names of a direct `ListBuckets` with `prefix`, in its order. */
export async function bucketNamesDirect(ctx: Ctx, port: number, prefix?: string): Promise<string[]> {
  return (await listBucketsDirect(ctx, port, prefix)).map((b) => b.name);
}

/** The keys of a direct `ListObjectsV2` of `bucket`. */
export async function objectKeysDirect(ctx: Ctx, port: number, bucket: string): Promise<string[]> {
  const body = answered(
    await signedS3(ctx, port, 'GET', `/${bucket}`, [['list-type', '2']]),
    200,
    `direct ListObjectsV2 ${bucket}`,
  );
  return [...body.matchAll(/<Contents>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<\/Contents>/g)].map((m) => xmlText(m[1]));
}

/**
 * The buckets a check makes directly on the emulator on `port`. Each is removed when the check ends, its objects
 * first, straight through the emulator; a removal that fails is logged. Making a bucket that does not answer 200 is
 * an environment failure: the check's Given would not hold.
 */
export class Seeded {
  private readonly made: string[] = [];
  private readonly objects = new Map<string, string[]>();

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
  ) {
    ctx.own(this);
  }

  /** `CreateBucket name`, signed for `region`, with its `LocationConstraint` when it is not `us-east-1`. */
  async bucket(name: string, region = 'us-east-1'): Promise<void> {
    const body =
      region === 'us-east-1'
        ? ''
        : `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`;
    this.made.push(name);
    const answer = await signedS3(this.ctx, this.port, 'PUT', `/${name}`, [], body, region);
    this.ctx.log(`direct CreateBucket ${name} in ${region}: ${shownDirect(answer)}`);
    if ('error' in answer || answer.status !== 200) {
      throw new EnvError(`direct CreateBucket ${name} in ${region} answered ${shownDirect(answer)}`);
    }
  }

  /** `PutObject bucket/key` with `body`. */
  async object(bucket: string, key: string, body: string): Promise<void> {
    this.objects.set(bucket, [...(this.objects.get(bucket) ?? []), key]);
    const answer = await signedS3(this.ctx, this.port, 'PUT', `/${bucket}/${key}`, [], body);
    this.ctx.log(`direct PutObject ${bucket}/${key}: ${shownDirect(answer)}`);
    if ('error' in answer || answer.status !== 200) {
      throw new EnvError(`direct PutObject ${bucket}/${key} answered ${shownDirect(answer)}`);
    }
  }

  /** Whether `name` was made by this check and is not removed yet. */
  has(name: string): boolean {
    return this.made.includes(name);
  }

  /** `DeleteBucket name` now (a check's step); the bucket is no longer removed at the end. */
  async remove(name: string): Promise<void> {
    for (const key of this.objects.get(name) ?? []) await signedS3(this.ctx, this.port, 'DELETE', `/${name}/${key}`);
    this.objects.delete(name);
    const answer = await signedS3(this.ctx, this.port, 'DELETE', `/${name}`);
    this.ctx.log(`direct DeleteBucket ${name}: ${shownDirect(answer)}`);
    if ('error' in answer || answer.status !== 204) {
      throw new EnvError(`direct DeleteBucket ${name} answered ${shownDirect(answer)}`);
    }
    this.made.splice(this.made.indexOf(name), 1);
  }

  async dispose(): Promise<void> {
    for (const name of this.made.reverse()) {
      for (const key of this.objects.get(name) ?? []) {
        const deleted = await signedS3(this.ctx, this.port, 'DELETE', `/${name}/${key}`);
        this.ctx.log(`cleanup DeleteObject ${name}/${key} directly: ${shownDirect(deleted)}`);
      }
      this.ctx.log(
        `cleanup DeleteBucket ${name} directly: ${shownDirect(await signedS3(this.ctx, this.port, 'DELETE', `/${name}`))}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** The screen's Cloudscape `Table`: its header with the actions, the filter, pagination, preferences and body. */
export const TABLE = wrapper.findTable().toSelector();
/** The table's empty slot, where the empty, no-match and failure states are shown (R7). */
export const TABLE_EMPTY = wrapper.findTable().findEmptySlot().toSelector();
/** The table's pagination. */
export const PAGINATION = wrapper.findTable().findPagination().toSelector();
/** The area layout's tools region, which holds the help panel (R5.6). */
export const TOOLS = wrapper.findAppLayout().findTools().toSelector();

/** The screen's parts a check acts on or reads. */
export function screen(page: Page) {
  const table = page.locator(TABLE);
  return {
    h1: heading(page, H1),
    table,
    /** The table's own heading (level 2), its counter included in its name. */
    title: page.getByRole('heading', { level: 2, name: new RegExp(`^${TABLE_TITLE}(\\s|$)`) }),
    filter: page.getByRole('searchbox', { name: FILTER, exact: true }),
    action: (name: string) => table.getByRole('button', { name, exact: true }).first(),
    nextPage: page.getByRole('button', { name: NEXT_PAGE, exact: true }),
    previousPage: page.getByRole('button', { name: PREVIOUS_PAGE, exact: true }),
    preferences: page.getByRole('button', { name: PREFERENCES, exact: true }),
    info: table
      .getByRole('button', { name: INFO, exact: true })
      .or(table.getByRole('link', { name: INFO, exact: true })),
    tab: (name: string) => page.getByRole('tab', { name, exact: true }),
    radio: (bucket: string) => page.getByRole('radio', { name: `Select ${bucket}`, exact: true }),
    nameLink: (bucket: string) => table.getByRole('link', { name: bucket, exact: true }),
    empty: page.locator(TABLE_EMPTY),
    notice: page.getByText(NOTICE, { exact: true }),
    noticeClose: page.getByRole('button', { name: NOTICE_CLOSE, exact: true }),
    about: page.getByRole('button', { name: ABOUT, exact: true }),
    tools: page.locator(TOOLS),
  };
}

/** Opens `path` and waits for the bucket list's `h1`. */
export async function openList(page: Page, at: string = BUCKETS_PATH): Promise<void> {
  await page.goto(at);
  await expect(heading(page, H1), `the bucket list's h1 "${H1}" at ${at}`).toBeVisible();
}

/** One row of the table as it is shown: the cells under "Name", "AWS Region" and "Creation date". */
export interface ShownRow {
  name: string;
  region: string;
  date: string;
}

/**
 * The table's data rows as shown, each read by the column headings "Name", "AWS Region" and "Creation date"; a row
 * whose only cell spans the table (loading, empty and failure states) is not a data row. `null` when the screen has
 * no table, or the table lacks one of the three headings.
 */
export async function shownRows(page: Page): Promise<ShownRow[] | null> {
  const table = page.locator(TABLE);
  if ((await table.count()) === 0) return null;
  return table.first().evaluate((root) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    // The table that holds a body; a sticky copy of the header is hidden from assistive technology.
    const el = [...root.querySelectorAll('table')].find(
      (t) => t.tBodies.length > 0 && !t.closest('[aria-hidden="true"]'),
    );
    if (!el) return null;
    const head = el.tHead?.rows[0];
    if (!head) return null;
    const headings = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
    const at = (name: string) => headings.indexOf(name);
    const [n, r, d] = [at('Name'), at('AWS Region'), at('Creation date')];
    if (n < 0 || r < 0 || d < 0) return null;
    const rows: { name: string; region: string; date: string }[] = [];
    for (const row of el.tBodies[0].rows) {
      if (row.cells.length <= 1) continue;
      const cell = (i: number) => norm((row.cells[i] as HTMLElement | undefined)?.innerText ?? '');
      rows.push({ name: cell(n), region: cell(r), date: cell(d) });
    }
    return rows;
  });
}

/** The names of the table's data rows, in order; `[]` when there is no table. */
export async function shownNames(page: Page): Promise<string[]> {
  return ((await shownRows(page)) ?? []).map((r) => r.name);
}

/** Waits until the table's rows are exactly `names`, in that order. */
export async function expectNames(page: Page, names: string[], message: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => shownNames(page), { timeout, message }).toEqual(names);
}

/** The table's title as shown, white space collapsed ("General purpose buckets (3)"); `null` when it is not there. */
export async function titleText(page: Page): Promise<string | null> {
  const title = screen(page).title;
  if ((await title.count()) === 0) return null;
  return (await title.first().innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/** The counter after the table's title without its parentheses ("3", "10+"); `null` when there is none. */
export async function counter(page: Page): Promise<string | null> {
  const text = await titleText(page);
  const m = text === null ? null : /\(([^)]*)\)$/.exec(text);
  return m ? m[1] : null;
}

/** Types `text` into the filter, replacing what it held. */
export async function filterFor(page: Page, text: string): Promise<void> {
  await screen(page).filter.fill(text, ACTION);
}

/**
 * Opens "Preferences", sets what is given, and confirms (or cancels with `cancel`). Waits until the dialog is gone.
 */
export async function setPreferences(
  page: Page,
  options: { pageSize?: 10 | 25 | 50; wrapLines?: boolean; cancel?: boolean },
): Promise<void> {
  await screen(page).preferences.click(ACTION);
  const dialog = page.getByRole('dialog', { name: PREFERENCES });
  await expect(dialog, `the dialog "${PREFERENCES}"`).toBeVisible();
  if (options.pageSize !== undefined) {
    await dialog.getByRole('radio', { name: pageSizeOption(options.pageSize), exact: true }).check(ACTION);
  }
  if (options.wrapLines !== undefined) await dialog.getByLabel(WRAP_LINES).setChecked(options.wrapLines, ACTION);
  await dialog.getByRole('button', { name: options.cancel ? CANCEL : CONFIRM, exact: true }).click(ACTION);
  await expect(dialog, `the dialog "${PREFERENCES}" closes`).toHaveCount(0);
}

/** What "Preferences" shows when opened (it is closed again with "Cancel"). */
export async function shownPreferences(page: Page): Promise<{ pageSize: string | null; wrapLines: boolean }> {
  await screen(page).preferences.click(ACTION);
  const dialog = page.getByRole('dialog', { name: PREFERENCES });
  await expect(dialog, `the dialog "${PREFERENCES}"`).toBeVisible();
  let pageSize: string | null = null;
  for (const size of [10, 25, 50] as const) {
    if (await dialog.getByRole('radio', { name: pageSizeOption(size), exact: true }).isChecked(ACTION)) {
      pageSize = pageSizeOption(size);
    }
  }
  const wrapLines = await dialog.getByLabel(WRAP_LINES).isChecked(ACTION);
  await dialog.getByRole('button', { name: CANCEL, exact: true }).click(ACTION);
  await expect(dialog).toHaveCount(0);
  return { pageSize, wrapLines };
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

// ---------------------------------------------------------------------------------------------------------------
// The page's ListBuckets requests.
// ---------------------------------------------------------------------------------------------------------------

/** True when `url` with `method` is a `ListBuckets` to the engine at `engineOrigin`: `GET /` (path style). */
export function isListBuckets(url: string, method: string, engineOrigin: string): boolean {
  const u = new URL(url);
  return u.origin === engineOrigin && method === 'GET' && u.pathname === '/';
}

/** One `ListBuckets` request of the page, with its query and its answer's status once it came. */
export interface ListRequest {
  query: Record<string, string>;
  status: number | null;
  failed: string | null;
}

/** The page's `ListBuckets` requests to the engine, from Playwright's request events of the context. */
export class ListBucketsRecord {
  readonly requests: ListRequest[] = [];

  private constructor(private readonly ctx: Ctx) {}

  static attach(ctx: Ctx, context: BrowserContext, engineOrigin: string): ListBucketsRecord {
    const record = new ListBucketsRecord(ctx);
    const byRequest = new Map<object, ListRequest>();
    context.on('request', (request) => {
      if (!isListBuckets(request.url(), request.method(), engineOrigin)) return;
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
        ctx.log(`ListBuckets ${JSON.stringify(seen.query)} answered ${String(seen.status)}`);
      });
    });
    context.on('requestfailed', (request) => {
      const seen = byRequest.get(request);
      if (!seen) return;
      seen.failed = request.failure()?.errorText ?? 'failed';
      ctx.log(`ListBuckets ${JSON.stringify(seen.query)} failed: ${seen.failed}`);
    });
    return record;
  }

  /** How many `ListBuckets` requests have been answered so far. */
  answered(): number {
    return this.requests.filter((r) => r.status !== null).length;
  }

  /** Waits until more than `from` requests have been answered. */
  async answeredAfter(from: number, message: string, timeout = 10_000): Promise<void> {
    await expect.poll(() => this.answered(), { timeout, message }).toBeGreaterThan(from);
  }

  /** Writes the record to the check's log. */
  log(): void {
    this.ctx.log(`ListBuckets requests: ${JSON.stringify(this.requests)}`);
  }
}

/**
 * Holds the page's `ListBuckets` requests to the engine in the browser while `holding`, through a CDP `Fetch` session
 * on `page`. It answers nothing: a held request is continued unchanged when `release` is called, every other paused
 * request (session, health, CORS preflights) at once.
 */
export class ListBucketsHold {
  private holding = true;
  private readonly held: string[] = [];

  private constructor(
    private readonly ctx: Ctx,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(ctx: Ctx, context: BrowserContext, page: Page, engineOrigin: string): Promise<ListBucketsHold> {
    const cdp = await context.newCDPSession(page);
    const hold = new ListBucketsHold(ctx, cdp);
    cdp.on('Fetch.requestPaused', (e) => {
      if (hold.holding && isListBuckets(e.request.url, e.request.method, engineOrigin)) {
        hold.held.push(e.requestId);
        ctx.log(`holding ListBuckets ${new URL(e.request.url).search}`);
        return;
      }
      void cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => undefined);
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${engineOrigin}/*`, requestStage: 'Request' }] });
    return hold;
  }

  /** How many `ListBuckets` requests are held now. */
  count(): number {
    return this.held.length;
  }

  /** Lets every held request go, unchanged, and holds no more. */
  async release(): Promise<void> {
    this.holding = false;
    for (const requestId of this.held.splice(0)) {
      await this.cdp.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
    }
    this.ctx.log('let the held ListBuckets requests go');
  }

  async stop(): Promise<void> {
    await this.release();
    await this.cdp.send('Fetch.disable').catch(() => undefined);
  }
}
