// The S3 bucket list screen as a user meets it, and the emulator it is compared with (test-criteria.md, issue 56,
// Flow checks; requirement R3 to R9), and the direct calls of the checks of a bucket's page, create, empty and delete
// (issue 256). Used by the `s3-*.spec.ts` checks, `safety.spec.ts` and `s3-seed-structure.ts`.
//
// - Direct calls: S3 operations straight to the emulator, SigV4-signed with the key it wrote for this run, TLS
//   verified against its `ca.pem`, never through the engine. Unlike `directS3` of `aws-clients.ts` they carry a query
//   string (`ListBuckets` with `max-buckets`, `prefix`, `continuation-token`) and may be signed for another Region
//   (`CreateBucket` in `ap-northeast-2`, R2). A direct `ListBuckets` always sends `max-buckets`: without it the
//   emulator leaves `BucketRegion` out (R2).
// - A bucket's properties, versions and legal holds (issue 256, R2 and R5.3): `createBucketDirect` with Object Lock,
//   ownership and tags; `configureBucketDirect` puts any of the properties the four screens of a bucket show or the
//   create form sets, `bucketPropertiesDirect` reads them all back, each "not set" answer as `null`;
//   `objectVersionsDirect` lists every version and delete marker; `putLegalHoldDirect`, `legalHoldDirect`,
//   `deleteItemsDirect` and `emptyBucketDirect`; a KMS key (`createKeyDirect`). `s3Direct` and `kmsDirect` send any
//   other call. Each takes a `DirectEnv` (a check's `Ctx`, or `{ home }` for `s3-seed-structure.ts`).
// - `Seeded`: the buckets, KMS keys and SQS queues a check makes, and the buckets its screen makes (`track`), each
//   bucket emptied of every version and delete marker, its legal holds taken off, and removed when the check ends.
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

import { directSqs } from './aws-clients-general';
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

/** An answer of a direct call (its header names in lower case), or the error that kept it from arriving. */
export type Direct = { status: number; body: string; headers: Record<string, string> } | { error: string };

/** Any direct answer: this file's, or another support file's without headers. */
type Answer = { status: number; body: string } | { error: string };

/** `status` of a direct answer, or its error, for the log. */
export function shownDirect(answer: Answer): string {
  return 'error' in answer ? `error ${answer.error}` : `status ${String(answer.status)}`;
}

/** What a direct call needs of the run: the `$HOME` the emulator writes its files under. A check's `Ctx` is one. */
export type DirectEnv = Pick<Ctx, 'home'>;

const sha256Hex = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 percent-encoding, as SigV4 wants it: everything but the unreserved characters. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** One request to the emulator, before it is signed. */
interface Unsigned {
  /** The signing name: `s3`, `kms`. */
  service: string;
  method: string;
  /** The path as sent, already percent-encoded (`objectPath`). */
  pathname: string;
  query: [string, string][];
  body: string;
  region: string;
  /** Headers sent and signed besides `host`, `x-amz-content-sha256` and `x-amz-date`. */
  headers: Record<string, string>;
}

/**
 * `request` straight to the emulator on `port`, header-signed for its Region and service with the emulator's key over
 * every header it sends, TLS verified against its `ca.pem`. A body goes with its `content-md5`, which S3 asks of
 * `DeleteObjects`, `PutObjectLegalHold`, `PutObjectLockConfiguration` and an object put into an Object Lock bucket.
 */
async function signed(env: DirectEnv, port: number, request: Unsigned): Promise<Direct> {
  const dir = emulatorDir(env.home, port);
  const key = readEmulatorFiles(dir);
  if (!key) return { error: `the emulator files under ${dir} are incomplete` };
  const ca = fs.readFileSync(path.join(dir, 'ca.pem'));
  const { service, method, pathname, query, body, region } = request;
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
  if (body !== '') headers['content-md5'] = createHash('md5').update(body).digest('base64');
  for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = value.trim();
  const names = Object.keys(headers).sort();
  const canonicalQuery = query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
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
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const sent: Record<string, string> = { ...headers };
  delete sent.host;
  sent.authorization =
    `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, ` +
    `Signature=${signature}`;
  if (body !== '') sent['content-length'] = String(Buffer.byteLength(body));
  const target = canonicalQuery === '' ? pathname : `${pathname}?${canonicalQuery}`;
  return new Promise((resolve) => {
    const call = https.request(
      { host: '127.0.0.1', port, method, path: target, ca, agent: false, timeout: 5_000, headers: sent },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => {
          const received: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) received[name] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({ status: response.statusCode ?? 0, body: text, headers: received });
        });
        response.on('error', (e) => resolve({ error: e.message }));
      },
    );
    call.on('timeout', () => call.destroy(new Error('no answer within 5 s')));
    call.on('error', (e) => resolve({ error: e.message }));
    call.end(body === '' ? undefined : body);
  });
}

/** `method pathname?query` with `body` straight to the emulator's S3, signed for `region`, with `headers`. */
function signedS3(
  env: DirectEnv,
  port: number,
  method: string,
  pathname: string,
  query: [string, string][] = [],
  body = '',
  region = 'us-east-1',
  headers: Record<string, string> = {},
): Promise<Direct> {
  return signed(env, port, { service: 's3', method, pathname, query, body, region, headers });
}

/**
 * Any S3 request straight to the emulator, for a call this file has no function of its own for: `pathname` as sent
 * (`objectPath` encodes a key), signed for `region` (default `us-east-1`) with the extra `headers`.
 */
export function s3Direct(
  env: DirectEnv,
  port: number,
  request: {
    method: string;
    pathname: string;
    query?: [string, string][];
    body?: string;
    region?: string;
    headers?: Record<string, string>;
  },
): Promise<Direct> {
  return signedS3(
    env,
    port,
    request.method,
    request.pathname,
    request.query,
    request.body,
    request.region,
    request.headers,
  );
}

/** A KMS action (AWS JSON 1.1) with its JSON input, straight to the emulator. */
export function kmsDirect(env: DirectEnv, port: number, action: string, input: object): Promise<Direct> {
  return signed(env, port, {
    service: 'kms',
    method: 'POST',
    pathname: '/',
    query: [],
    body: JSON.stringify(input),
    region: 'us-east-1',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `TrentService.${action}` },
  });
}

/** The path of the object `key` in `bucket` as sent and signed: each segment of the key percent-encoded. */
export function objectPath(bucket: string, key: string): string {
  return `/${bucket}/${key.split('/').map(uriEncode).join('/')}`;
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
export async function listBucketsDirect(ctx: DirectEnv, port: number, prefix?: string): Promise<DirectBucket[]> {
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
export async function bucketNamesDirect(ctx: DirectEnv, port: number, prefix?: string): Promise<string[]> {
  return (await listBucketsDirect(ctx, port, prefix)).map((b) => b.name);
}

/** The keys of a direct `ListObjectsV2` of `bucket`. */
export async function objectKeysDirect(ctx: DirectEnv, port: number, bucket: string): Promise<string[]> {
  const body = answered(
    await signedS3(ctx, port, 'GET', `/${bucket}`, [['list-type', '2']]),
    200,
    `direct ListObjectsV2 ${bucket}`,
  );
  return [...body.matchAll(/<Contents>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<\/Contents>/g)].map((m) => xmlText(m[1]));
}

// ---------------------------------------------------------------------------------------------------------------
// A bucket's properties, versions and legal holds, directly (issue 256, R2 and R5.3).
// ---------------------------------------------------------------------------------------------------------------

const S3_XMLNS = 'http://s3.amazonaws.com/doc/2006-03-01/';

/** `text` as XML character data. */
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `<name>text</name>`, the text escaped. */
const el = (name: string, text: string) => `<${name}>${xmlEscape(text)}</${name}>`;

/** The `<name>…</name>` blocks of `xml` in order, each block's inside; nested blocks of the same name are not met. */
function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
}

/** The emulator's `Code` of an error answer; `null` for an answer that has none. */
export function errorCodeOf(answer: Answer): string | null {
  return 'error' in answer ? null : element(answer.body, 'Code');
}

/**
 * The body of `answer` when it is a 200; `null` when it is the 404 with `notSet`, the emulator's answer for a
 * property never set (R2). Any other answer fails the check.
 */
function readOrNotSet(answer: Direct, notSet: string, what: string): string | null {
  if (!('error' in answer) && answer.status === 404 && errorCodeOf(answer) === notSet) return null;
  return answered(answer, 200, what);
}

/** Throws an `EnvError` unless `answer` has one of `statuses`: a direct Given the check needs did not hold. */
function given<T extends Answer>(answer: T, what: string, statuses: number[] = [200]): Exclude<T, { error: string }> {
  if ('error' in answer || !statuses.includes(answer.status)) {
    const code = errorCodeOf(answer);
    const message = 'error' in answer ? null : element(answer.body, 'Message');
    throw new EnvError(
      `${what} answered ${shownDirect(answer)}${code === null ? '' : ` ${code}`}${message === null ? '' : `: ${message}`}`,
    );
  }
  return answer as Exclude<T, { error: string }>;
}

/** The values of `Rule.ObjectOwnership` (R6.4). */
export type ObjectOwnership = 'BucketOwnerEnforced' | 'BucketOwnerPreferred' | 'ObjectWriter';

/** What a direct `CreateBucket` sends besides the name (R2). */
export interface CreateOptions {
  /** Signed for this Region, with its `LocationConstraint` when it is not `us-east-1` (default `us-east-1`). */
  region?: string;
  /** The header `x-amz-bucket-object-lock-enabled: true`. */
  objectLock?: boolean;
  /** The header `x-amz-object-ownership`. */
  ownership?: ObjectOwnership;
  /** `CreateBucketConfiguration.Tags`, in order. */
  tags?: [string, string][];
}

/** A direct `CreateBucket name` with `options`. */
export function createBucketDirect(
  env: DirectEnv,
  port: number,
  name: string,
  options: CreateOptions = {},
): Promise<Direct> {
  const region = options.region ?? 'us-east-1';
  const parts: string[] = [];
  if (region !== 'us-east-1') parts.push(el('LocationConstraint', region));
  if (options.tags && options.tags.length > 0) {
    parts.push(`<Tags>${options.tags.map(([k, v]) => `<Tag>${el('Key', k)}${el('Value', v)}</Tag>`).join('')}</Tags>`);
  }
  const body =
    parts.length === 0
      ? ''
      : `<CreateBucketConfiguration xmlns="${S3_XMLNS}">${parts.join('')}</CreateBucketConfiguration>`;
  const headers: Record<string, string> = {};
  if (options.objectLock) headers['x-amz-bucket-object-lock-enabled'] = 'true';
  if (options.ownership) headers['x-amz-object-ownership'] = options.ownership;
  return signedS3(env, port, 'PUT', `/${name}`, [], body, region, headers);
}

/** One Intelligent-Tiering configuration as put and as read (R5.3). */
export interface TieringConfiguration {
  id: string;
  status: 'Enabled' | 'Disabled';
  /** `Filter.Prefix`, or `Filter.And.Prefix` as read; `null` without one. */
  prefix: string | null;
  /** The `Days` of each `Tiering`, by its `AccessTier`. */
  archiveDays: number | null;
  deepArchiveDays: number | null;
}

/** One queue configuration of a bucket's event notifications, as put and as read (R5.3). */
export interface QueueNotification {
  id: string;
  queueArn: string;
  events: string[];
  prefix: string | null;
  suffix: string | null;
}

/** One public access setting each, as `PutPublicAccessBlock` and `GetPublicAccessBlock` name them (R6.4). */
export interface PublicAccessBlock {
  BlockPublicAcls: boolean;
  IgnorePublicAcls: boolean;
  BlockPublicPolicy: boolean;
  RestrictPublicBuckets: boolean;
}

/** The default encryption as put (R5.3). */
export interface EncryptionSetting {
  algorithm: 'AES256' | 'aws:kms' | 'aws:kms:dsse';
  keyId?: string;
  bucketKey?: boolean;
}

/** The default retention of an Object Lock bucket as put, `days` or `years`. */
export interface RetentionSetting {
  mode: 'GOVERNANCE' | 'COMPLIANCE';
  days?: number;
  years?: number;
}

/** What `configureBucketDirect` puts, each property only when given, in this order. */
export interface BucketSettings {
  versioning?: 'Enabled' | 'Suspended';
  abac?: 'Enabled' | 'Disabled';
  tags?: [string, string][];
  encryption?: EncryptionSetting;
  intelligentTiering?: TieringConfiguration[];
  logging?: { targetBucket: string; targetPrefix?: string };
  /** The whole notification configuration: its queue configurations and whether EventBridge is on. */
  notifications?: { queues?: QueueNotification[]; eventBridge?: boolean };
  accelerate?: 'Enabled' | 'Suspended';
  /** `PutObjectLockConfiguration` of a bucket made with Object Lock. */
  defaultRetention?: RetentionSetting;
  requestPayer?: 'BucketOwner' | 'Requester';
  website?: { indexDocument: string; errorDocument?: string };
  publicAccessBlock?: PublicAccessBlock;
  ownership?: ObjectOwnership;
}

/** The subresource, body and name of each put of `settings`, in `BucketSettings`' order. */
function settingPuts(settings: BucketSettings): { what: string; query: [string, string][]; body: string }[] {
  const puts: { what: string; query: [string, string][]; body: string }[] = [];
  const put = (what: string, query: [string, string][], root: string, inner: string) =>
    puts.push({ what, query, body: `<${root} xmlns="${S3_XMLNS}">${inner}</${root}>` });
  if (settings.versioning) {
    put('PutBucketVersioning', [['versioning', '']], 'VersioningConfiguration', el('Status', settings.versioning));
  }
  if (settings.abac) put('PutBucketAbac', [['abac', '']], 'AbacStatus', el('Status', settings.abac));
  if (settings.tags) {
    const tags = settings.tags.map(([k, v]) => `<Tag>${el('Key', k)}${el('Value', v)}</Tag>`).join('');
    put('PutBucketTagging', [['tagging', '']], 'Tagging', `<TagSet>${tags}</TagSet>`);
  }
  if (settings.encryption) {
    const { algorithm, keyId, bucketKey } = settings.encryption;
    const byDefault = `${el('SSEAlgorithm', algorithm)}${keyId === undefined ? '' : el('KMSMasterKeyID', keyId)}`;
    const key = bucketKey === undefined ? '' : el('BucketKeyEnabled', String(bucketKey));
    put(
      'PutBucketEncryption',
      [['encryption', '']],
      'ServerSideEncryptionConfiguration',
      `<Rule><ApplyServerSideEncryptionByDefault>${byDefault}</ApplyServerSideEncryptionByDefault>${key}</Rule>`,
    );
  }
  for (const t of settings.intelligentTiering ?? []) {
    const tierings = [
      t.archiveDays === null
        ? ''
        : `<Tiering>${el('Days', String(t.archiveDays))}${el('AccessTier', 'ARCHIVE_ACCESS')}</Tiering>`,
      t.deepArchiveDays === null
        ? ''
        : `<Tiering>${el('Days', String(t.deepArchiveDays))}${el('AccessTier', 'DEEP_ARCHIVE_ACCESS')}</Tiering>`,
    ].join('');
    const filter = t.prefix === null ? '' : `<Filter>${el('Prefix', t.prefix)}</Filter>`;
    put(
      `PutBucketIntelligentTieringConfiguration ${t.id}`,
      [
        ['intelligent-tiering', ''],
        ['id', t.id],
      ],
      'IntelligentTieringConfiguration',
      `${el('Id', t.id)}${filter}${el('Status', t.status)}${tierings}`,
    );
  }
  if (settings.logging) {
    const { targetBucket, targetPrefix } = settings.logging;
    put(
      'PutBucketLogging',
      [['logging', '']],
      'BucketLoggingStatus',
      `<LoggingEnabled>${el('TargetBucket', targetBucket)}${el('TargetPrefix', targetPrefix ?? '')}</LoggingEnabled>`,
    );
  }
  if (settings.notifications) {
    const queues = (settings.notifications.queues ?? []).map((q) => {
      const rules = [
        q.prefix === null ? '' : `<FilterRule>${el('Name', 'prefix')}${el('Value', q.prefix)}</FilterRule>`,
        q.suffix === null ? '' : `<FilterRule>${el('Name', 'suffix')}${el('Value', q.suffix)}</FilterRule>`,
      ].join('');
      const filter = rules === '' ? '' : `<Filter><S3Key>${rules}</S3Key></Filter>`;
      return `<QueueConfiguration>${el('Id', q.id)}${el('Queue', q.queueArn)}${q.events.map((e) => el('Event', e)).join('')}${filter}</QueueConfiguration>`;
    });
    const eventBridge = settings.notifications.eventBridge
      ? '<EventBridgeConfiguration></EventBridgeConfiguration>'
      : '';
    put(
      'PutBucketNotificationConfiguration',
      [['notification', '']],
      'NotificationConfiguration',
      `${queues.join('')}${eventBridge}`,
    );
  }
  if (settings.accelerate) {
    put(
      'PutBucketAccelerateConfiguration',
      [['accelerate', '']],
      'AccelerateConfiguration',
      el('Status', settings.accelerate),
    );
  }
  if (settings.defaultRetention) {
    const { mode, days, years } = settings.defaultRetention;
    const period = days !== undefined ? el('Days', String(days)) : el('Years', String(years ?? 1));
    put(
      'PutObjectLockConfiguration',
      [['object-lock', '']],
      'ObjectLockConfiguration',
      `${el('ObjectLockEnabled', 'Enabled')}<Rule><DefaultRetention>${el('Mode', mode)}${period}</DefaultRetention></Rule>`,
    );
  }
  if (settings.requestPayer) {
    put(
      'PutBucketRequestPayment',
      [['requestPayment', '']],
      'RequestPaymentConfiguration',
      el('Payer', settings.requestPayer),
    );
  }
  if (settings.website) {
    const { indexDocument, errorDocument } = settings.website;
    const error = errorDocument === undefined ? '' : `<ErrorDocument>${el('Key', errorDocument)}</ErrorDocument>`;
    put(
      'PutBucketWebsite',
      [['website', '']],
      'WebsiteConfiguration',
      `<IndexDocument>${el('Suffix', indexDocument)}</IndexDocument>${error}`,
    );
  }
  if (settings.publicAccessBlock) {
    const b = settings.publicAccessBlock;
    put(
      'PutPublicAccessBlock',
      [['publicAccessBlock', '']],
      'PublicAccessBlockConfiguration',
      (['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'] as const)
        .map((n) => el(n, String(b[n])))
        .join(''),
    );
  }
  if (settings.ownership) {
    put(
      'PutBucketOwnershipControls',
      [['ownershipControls', '']],
      'OwnershipControls',
      `<Rule>${el('ObjectOwnership', settings.ownership)}</Rule>`,
    );
  }
  return puts;
}

/**
 * Puts each property of `settings` on `bucket` directly, one call each in `BucketSettings`' order, and logs each
 * answer with `log`. A put that does not answer 200 is an `EnvError`: the check's Given would not hold.
 */
export async function configureBucketDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  settings: BucketSettings,
  log: (line: string) => void = () => undefined,
): Promise<void> {
  for (const { what, query, body } of settingPuts(settings)) {
    const answer = await signedS3(env, port, 'PUT', `/${bucket}`, query, body);
    log(`direct ${what} ${bucket}: ${shownDirect(answer)}`);
    given(answer, `direct ${what} ${bucket}`, [200, 204]);
  }
}

/** A bucket's properties as direct reads return them, each `null` where the emulator answers "not set" (R2, R5.3). */
export interface BucketProperties {
  /** `GetBucketVersioning` `Status`; `null` on a bucket never versioned. */
  versioning: string | null;
  /** `GetBucketAbac` `Status`. */
  abac: string | null;
  /** `GetBucketTagging` `TagSet` in its order; `null` on `NoSuchTagSet`. */
  tags: [string, string][] | null;
  /** `GetBucketEncryption`'s first rule; `null` on `ServerSideEncryptionConfigurationNotFoundError`. */
  encryption: { algorithm: string | null; keyId: string | null; bucketKey: boolean | null } | null;
  /** `ListBucketIntelligentTieringConfigurations`, its first answer, and whether it was truncated. */
  intelligentTiering: TieringConfiguration[];
  intelligentTieringTruncated: boolean;
  /** `GetBucketLogging` `LoggingEnabled`; `null` without it. */
  logging: { targetBucket: string | null; targetPrefix: string | null } | null;
  /** `GetBucketNotificationConfiguration`: its queue configurations, the ARNs of its topic and function ones. */
  notifications: { queues: QueueNotification[]; topicArns: string[]; functionArns: string[]; eventBridge: boolean };
  /** `GetBucketAccelerateConfiguration` `Status`; `null` without one. */
  accelerate: string | null;
  /** `GetObjectLockConfiguration`; `null` on `ObjectLockConfigurationNotFoundError`. */
  objectLock: {
    enabled: string | null;
    retention: { mode: string | null; days: number | null; years: number | null } | null;
  } | null;
  /** `GetBucketRequestPayment` `Payer`. */
  requestPayer: string | null;
  /** `GetBucketWebsite`; `null` on `NoSuchWebsiteConfiguration`. */
  website: { indexDocument: string | null; errorDocument: string | null } | null;
  /** `GetPublicAccessBlock`; `null` on `NoSuchPublicAccessBlockConfiguration`. */
  publicAccessBlock: PublicAccessBlock | null;
  /** `GetBucketOwnershipControls` `ObjectOwnership`; `null` on `OwnershipControlsNotFoundError`. */
  ownership: string | null;
}

const numberOrNull = (text: string | null) => (text === null ? null : Number(text));

/** The filter rule `name` (`prefix`, `suffix`) of a notification configuration's block. */
function filterRule(block: string, name: string): string | null {
  for (const rule of blocks(block, 'FilterRule')) {
    if (element(rule, 'Name')?.toLowerCase() === name) return element(rule, 'Value') ?? '';
  }
  return null;
}

/** Every property of `bucket` the four screens show or the create form sets, read directly, all in parallel. */
export async function bucketPropertiesDirect(env: DirectEnv, port: number, bucket: string): Promise<BucketProperties> {
  const get = (sub: string) => signedS3(env, port, 'GET', `/${bucket}`, [[sub, '']]);
  const what = (op: string) => `direct ${op} ${bucket}`;
  const [
    versioning,
    abac,
    tagging,
    encryption,
    tiering,
    logging,
    notification,
    accelerate,
    lock,
    payment,
    website,
    block,
    ownership,
  ] = await Promise.all(
    [
      'versioning',
      'abac',
      'tagging',
      'encryption',
      'intelligent-tiering',
      'logging',
      'notification',
      'accelerate',
      'object-lock',
      'requestPayment',
      'website',
      'publicAccessBlock',
      'ownershipControls',
    ].map(get),
  );
  const tagsBody = readOrNotSet(tagging, 'NoSuchTagSet', what('GetBucketTagging'));
  const encryptionBody = readOrNotSet(
    encryption,
    'ServerSideEncryptionConfigurationNotFoundError',
    what('GetBucketEncryption'),
  );
  const tieringBody = answered(tiering, 200, what('ListBucketIntelligentTieringConfigurations'));
  const loggingBody = answered(logging, 200, what('GetBucketLogging'));
  const notificationBody = answered(notification, 200, what('GetBucketNotificationConfiguration'));
  const lockBody = readOrNotSet(lock, 'ObjectLockConfigurationNotFoundError', what('GetObjectLockConfiguration'));
  const websiteBody = readOrNotSet(website, 'NoSuchWebsiteConfiguration', what('GetBucketWebsite'));
  const blockBody = readOrNotSet(block, 'NoSuchPublicAccessBlockConfiguration', what('GetPublicAccessBlock'));
  const ownershipBody = readOrNotSet(ownership, 'OwnershipControlsNotFoundError', what('GetBucketOwnershipControls'));
  const rule = encryptionBody === null ? null : (blocks(encryptionBody, 'Rule')[0] ?? '');
  const enabledLogging = blocks(loggingBody, 'LoggingEnabled')[0];
  const retention = lockBody === null ? undefined : blocks(lockBody, 'DefaultRetention')[0];
  return {
    versioning: element(answered(versioning, 200, what('GetBucketVersioning')), 'Status'),
    abac: element(answered(abac, 200, what('GetBucketAbac')), 'Status'),
    tags:
      tagsBody === null
        ? null
        : blocks(tagsBody, 'Tag').map((t) => [element(t, 'Key') ?? '', element(t, 'Value') ?? ''] as [string, string]),
    encryption:
      rule === null
        ? null
        : {
            algorithm: element(rule, 'SSEAlgorithm'),
            keyId: element(rule, 'KMSMasterKeyID'),
            bucketKey: element(rule, 'BucketKeyEnabled') === null ? null : element(rule, 'BucketKeyEnabled') === 'true',
          },
    intelligentTiering: blocks(tieringBody, 'IntelligentTieringConfiguration').map((c) => {
      const days = (tier: string) =>
        numberOrNull(
          blocks(c, 'Tiering')
            .filter((t) => element(t, 'AccessTier') === tier)
            .map((t) => element(t, 'Days'))[0] ?? null,
        );
      const filter = blocks(c, 'Filter')[0] ?? '';
      return {
        id: element(c, 'Id') ?? '',
        status: (element(c, 'Status') ?? '') as 'Enabled' | 'Disabled',
        prefix: element(filter, 'Prefix'),
        archiveDays: days('ARCHIVE_ACCESS'),
        deepArchiveDays: days('DEEP_ARCHIVE_ACCESS'),
      };
    }),
    intelligentTieringTruncated: element(tieringBody, 'IsTruncated') === 'true',
    logging:
      enabledLogging === undefined
        ? null
        : {
            targetBucket: element(enabledLogging, 'TargetBucket'),
            targetPrefix: element(enabledLogging, 'TargetPrefix'),
          },
    notifications: {
      queues: blocks(notificationBody, 'QueueConfiguration').map((q) => ({
        id: element(q, 'Id') ?? '',
        queueArn: element(q, 'Queue') ?? '',
        events: blocks(q, 'Event').map(xmlText),
        prefix: filterRule(q, 'prefix'),
        suffix: filterRule(q, 'suffix'),
      })),
      topicArns: blocks(notificationBody, 'TopicConfiguration').map((t) => element(t, 'Topic') ?? ''),
      functionArns: blocks(notificationBody, 'CloudFunctionConfiguration').map(
        (f) => element(f, 'CloudFunction') ?? '',
      ),
      eventBridge: /<EventBridgeConfiguration\s*\/?>/.test(notificationBody),
    },
    accelerate: element(answered(accelerate, 200, what('GetBucketAccelerateConfiguration')), 'Status'),
    objectLock:
      lockBody === null
        ? null
        : {
            enabled: element(lockBody, 'ObjectLockEnabled'),
            retention:
              retention === undefined
                ? null
                : {
                    mode: element(retention, 'Mode'),
                    days: numberOrNull(element(retention, 'Days')),
                    years: numberOrNull(element(retention, 'Years')),
                  },
          },
    requestPayer: element(answered(payment, 200, what('GetBucketRequestPayment')), 'Payer'),
    website:
      websiteBody === null
        ? null
        : {
            indexDocument: element(blocks(websiteBody, 'IndexDocument')[0] ?? '', 'Suffix'),
            errorDocument: element(blocks(websiteBody, 'ErrorDocument')[0] ?? '', 'Key'),
          },
    publicAccessBlock:
      blockBody === null
        ? null
        : {
            BlockPublicAcls: element(blockBody, 'BlockPublicAcls') === 'true',
            IgnorePublicAcls: element(blockBody, 'IgnorePublicAcls') === 'true',
            BlockPublicPolicy: element(blockBody, 'BlockPublicPolicy') === 'true',
            RestrictPublicBuckets: element(blockBody, 'RestrictPublicBuckets') === 'true',
          },
    ownership: ownershipBody === null ? null : element(ownershipBody, 'ObjectOwnership'),
  };
}

/** One item of a bucket (R8.5): an object version or a delete marker, as `ListObjectVersions` lists it. */
export interface DirectItem {
  kind: 'version' | 'delete-marker';
  key: string;
  /** `null` in a bucket never versioned (the emulator writes `null`). */
  versionId: string;
  isLatest: boolean;
}

/**
 * Every item of `bucket` by a direct `ListObjectVersions`, versions and delete markers in the answer's order, page
 * after page of `maxKeys` (default 1000) with the answer's markers. `null` on `NoSuchBucket`.
 */
export async function objectVersionsDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  maxKeys = 1000,
): Promise<DirectItem[] | null> {
  const items: DirectItem[] = [];
  let markers: [string, string][] = [];
  for (let pages = 0; pages < 100; pages++) {
    const answer = await signedS3(env, port, 'GET', `/${bucket}`, [
      ['versions', ''],
      ['max-keys', String(maxKeys)],
      ...markers,
    ]);
    const body = readOrNotSet(answer, 'NoSuchBucket', `direct ListObjectVersions ${bucket}`);
    if (body === null) return null;
    for (const m of body.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)) {
      items.push({
        kind: m[1] === 'Version' ? 'version' : 'delete-marker',
        key: element(m[2], 'Key') ?? '',
        versionId: element(m[2], 'VersionId') ?? 'null',
        isLatest: element(m[2], 'IsLatest') === 'true',
      });
    }
    if (element(body, 'IsTruncated') !== 'true') return items;
    markers = [
      ['key-marker', element(body, 'NextKeyMarker') ?? ''],
      ['version-id-marker', element(body, 'NextVersionIdMarker') ?? ''],
    ];
  }
  throw new Error(`direct ListObjectVersions ${bucket}: more than 100 pages`);
}

/** A direct `PutObject bucket/key` with `body`; its version id is the header `x-amz-version-id` of a 200. */
export function putObjectDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
  body: string,
): Promise<Direct> {
  return signedS3(env, port, 'PUT', objectPath(bucket, key), [], body);
}

/** A direct `DeleteObject bucket/key`, of `versionId` when given (without one, a versioned bucket gets a delete marker). */
export function deleteObjectDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
  versionId?: string,
): Promise<Direct> {
  return signedS3(
    env,
    port,
    'DELETE',
    objectPath(bucket, key),
    versionId === undefined ? [] : [['versionId', versionId]],
  );
}

/** A direct `PutObjectLegalHold` of `key`'s `versionId` in `bucket`, `ON` or `OFF`. */
export function putLegalHoldDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
  versionId: string,
  status: 'ON' | 'OFF',
): Promise<Direct> {
  return signedS3(
    env,
    port,
    'PUT',
    objectPath(bucket, key),
    [
      ['legal-hold', ''],
      ['versionId', versionId],
    ],
    `<LegalHold xmlns="${S3_XMLNS}">${el('Status', status)}</LegalHold>`,
  );
}

/** The legal hold of `key`'s `versionId` in `bucket` by a direct `GetObjectLegalHold`; `null` when it has none. */
export async function legalHoldDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  key: string,
  versionId: string,
): Promise<string | null> {
  const answer = await signedS3(env, port, 'GET', objectPath(bucket, key), [
    ['legal-hold', ''],
    ['versionId', versionId],
  ]);
  const body = readOrNotSet(answer, 'NoSuchObjectLockConfiguration', `direct GetObjectLegalHold ${bucket}/${key}`);
  return body === null ? null : element(body, 'Status');
}

/** One entry of a direct `DeleteObjects` answer's `Errors`. */
export interface DeleteFailure {
  key: string;
  versionId: string | null;
  code: string | null;
  message: string | null;
}

/**
 * A direct `DeleteObjects` of `items` (each with its version id) in `bucket`, `Quiet`, at most 1000, with
 * `x-amz-bypass-governance-retention` so a governance retention does not keep a version (a legal hold still does).
 * Returns the answer's `Errors`.
 */
export async function deleteItemsDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  items: { key: string; versionId: string }[],
): Promise<DeleteFailure[]> {
  const objects = items.map((i) => `<Object>${el('Key', i.key)}${el('VersionId', i.versionId)}</Object>`).join('');
  const answer = await signedS3(
    env,
    port,
    'POST',
    `/${bucket}`,
    [['delete', '']],
    `<Delete xmlns="${S3_XMLNS}"><Quiet>true</Quiet>${objects}</Delete>`,
    'us-east-1',
    { 'x-amz-bypass-governance-retention': 'true' },
  );
  const body = given(answer, `direct DeleteObjects ${bucket} (${String(items.length)} items)`).body;
  return blocks(body, 'Error').map((e) => ({
    key: element(e, 'Key') ?? '',
    versionId: element(e, 'VersionId'),
    code: element(e, 'Code'),
    message: element(e, 'Message'),
  }));
}

/**
 * Empties `bucket` directly of every item: lists from the bucket's start after each `DeleteObjects` (R2, markers after
 * a delete are not safe), takes off the legal hold of a version that could not be deleted and sends it again. Returns
 * the items still left (none when it worked); `null` when the emulator holds no such bucket.
 */
export async function emptyBucketDirect(
  env: DirectEnv,
  port: number,
  bucket: string,
  log: (line: string) => void = () => undefined,
): Promise<DirectItem[] | null> {
  const released = new Set<string>();
  for (let round = 0; round < 10; round++) {
    const items = await objectVersionsDirect(env, port, bucket);
    if (items === null || items.length === 0) return items;
    const failures = await deleteItemsDirect(env, port, bucket, items);
    log(`direct DeleteObjects ${bucket}: ${String(items.length)} items, ${String(failures.length)} failed`);
    let progress = failures.length < items.length;
    for (const f of failures) {
      const id = `${f.key}\u0000${f.versionId ?? ''}`;
      if (f.versionId === null || released.has(id)) continue;
      released.add(id);
      const off = await putLegalHoldDirect(env, port, bucket, f.key, f.versionId, 'OFF');
      log(`direct PutObjectLegalHold OFF ${bucket}/${f.key}: ${shownDirect(off)}`);
      progress = true;
    }
    if (!progress) return objectVersionsDirect(env, port, bucket);
  }
  return objectVersionsDirect(env, port, bucket);
}

/** A KMS key made directly (`CreateKey`, symmetric, for encryption): its ARN. */
export async function createKeyDirect(env: DirectEnv, port: number, description: string): Promise<string> {
  const answer = given(await kmsDirect(env, port, 'CreateKey', { Description: description }), 'direct KMS CreateKey');
  const arn = (JSON.parse(answer.body) as { KeyMetadata?: { Arn?: string } }).KeyMetadata?.Arn;
  if (typeof arn !== 'string' || arn === '') throw new EnvError(`direct KMS CreateKey answered no KeyMetadata.Arn`);
  return arn;
}

/**
 * The buckets, KMS keys and SQS queues a check makes directly on the emulator on `port`, and the buckets its screen
 * makes (`track`). Each bucket is removed when the check ends, emptied first of every version and delete marker and
 * with every legal hold taken off; then each queue is deleted and each key scheduled for deletion (the shortest
 * window KMS allows, 7 days). A removal that fails is logged. Making something that does not answer 200 is an
 * environment failure: the check's Given would not hold.
 */
export class Seeded {
  private readonly made: string[] = [];
  private readonly keys: string[] = [];
  private readonly queues: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
  ) {
    ctx.own(this);
  }

  /** `CreateBucket name`, signed for `region`, with its `LocationConstraint` when it is not `us-east-1`. */
  async bucket(name: string, region = 'us-east-1', options: Omit<CreateOptions, 'region'> = {}): Promise<void> {
    this.made.push(name);
    const answer = await createBucketDirect(this.ctx, this.port, name, { ...options, region });
    this.ctx.log(`direct CreateBucket ${name} in ${region} ${JSON.stringify(options)}: ${shownDirect(answer)}`);
    given(answer, `direct CreateBucket ${name} in ${region}`);
  }

  /** Puts `settings` on `name` directly (`configureBucketDirect`). */
  async configure(name: string, settings: BucketSettings): Promise<void> {
    await configureBucketDirect(this.ctx, this.port, name, settings, (line) => this.ctx.log(line));
  }

  /** A bucket the check's screen makes: removed at the end like the check's own. */
  track(name: string): void {
    if (!this.made.includes(name)) this.made.push(name);
  }

  /** `PutObject bucket/key` with `body`; returns its version id (`null` when the answer names none). */
  async object(bucket: string, key: string, body: string): Promise<string | null> {
    const answer = await putObjectDirect(this.ctx, this.port, bucket, key, body);
    this.ctx.log(`direct PutObject ${bucket}/${key}: ${shownDirect(answer)}`);
    return given(answer, `direct PutObject ${bucket}/${key}`).headers['x-amz-version-id'] ?? null;
  }

  /** `PutObject` of each key with `body`, at most `parallel` at a time; returns their version ids in order. */
  async objects(bucket: string, keys: string[], body: string, parallel = 16): Promise<(string | null)[]> {
    const ids: (string | null)[] = new Array<string | null>(keys.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < keys.length) {
        const i = next++;
        const answer = await putObjectDirect(this.ctx, this.port, bucket, keys[i], body);
        ids[i] = given(answer, `direct PutObject ${bucket}/${keys[i]}`).headers['x-amz-version-id'] ?? null;
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, keys.length) }, worker));
    this.ctx.log(`direct PutObject of ${String(keys.length)} keys into ${bucket}, ${String(parallel)} at a time`);
    return ids;
  }

  /** `DeleteObject bucket/key` without a version id: in a versioned bucket, a delete marker; returns its version id. */
  async deleteMarker(bucket: string, key: string): Promise<string | null> {
    const answer = await deleteObjectDirect(this.ctx, this.port, bucket, key);
    this.ctx.log(`direct DeleteObject ${bucket}/${key}: ${shownDirect(answer)}`);
    return given(answer, `direct DeleteObject ${bucket}/${key}`, [200, 204]).headers['x-amz-version-id'] ?? null;
  }

  /** `PutObjectLegalHold` of `key`'s `versionId`, `ON` or `OFF`. */
  async legalHold(bucket: string, key: string, versionId: string, status: 'ON' | 'OFF'): Promise<void> {
    const answer = await putLegalHoldDirect(this.ctx, this.port, bucket, key, versionId, status);
    this.ctx.log(`direct PutObjectLegalHold ${status} ${bucket}/${key}: ${shownDirect(answer)}`);
    given(answer, `direct PutObjectLegalHold ${status} ${bucket}/${key}`);
  }

  /** A KMS key; returns its ARN. */
  async kmsKey(): Promise<string> {
    const arn = await createKeyDirect(this.ctx, this.port, `EmuForge check ${this.ctx.id}`);
    this.keys.push(arn);
    this.ctx.log(`direct KMS CreateKey: ${arn}`);
    return arn;
  }

  /**
   * An SQS queue `name` whose policy lets S3 send to it (without one the emulator refuses a notification to it:
   * "Unable to validate the following destination configurations"); returns its ARN.
   */
  async queue(name: string): Promise<string> {
    const created = given(
      await directSqs(this.ctx, this.port, 'CreateQueue', { QueueName: name }),
      `direct SQS CreateQueue ${name}`,
    );
    const url = (JSON.parse(created.body) as { QueueUrl?: string }).QueueUrl ?? '';
    this.queues.push(url);
    const attributes = given(
      await directSqs(this.ctx, this.port, 'GetQueueAttributes', { QueueUrl: url, AttributeNames: ['QueueArn'] }),
      `direct SQS GetQueueAttributes ${name}`,
    );
    const arn = (JSON.parse(attributes.body) as { Attributes?: { QueueArn?: string } }).Attributes?.QueueArn;
    if (typeof arn !== 'string' || arn === '') throw new EnvError(`direct SQS GetQueueAttributes ${name}: no QueueArn`);
    const policy = {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Principal: { Service: 's3.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: arn },
      ],
    };
    given(
      await directSqs(this.ctx, this.port, 'SetQueueAttributes', {
        QueueUrl: url,
        Attributes: { Policy: JSON.stringify(policy) },
      }),
      `direct SQS SetQueueAttributes ${name}`,
    );
    this.ctx.log(`direct SQS CreateQueue ${name}, its policy allowing S3: ${arn}`);
    return arn;
  }

  /** Whether `name` was made by this check and is not removed yet. */
  has(name: string): boolean {
    return this.made.includes(name);
  }

  /** Empties and deletes `name` now (a check's step); the bucket is no longer removed at the end. */
  async remove(name: string): Promise<void> {
    await emptyBucketDirect(this.ctx, this.port, name, (line) => this.ctx.log(line));
    const answer = await signedS3(this.ctx, this.port, 'DELETE', `/${name}`);
    this.ctx.log(`direct DeleteBucket ${name}: ${shownDirect(answer)}`);
    given(answer, `direct DeleteBucket ${name}`, [204]);
    this.made.splice(this.made.indexOf(name), 1);
  }

  async dispose(): Promise<void> {
    const log = (line: string) => this.ctx.log(`cleanup ${line}`);
    for (const name of this.made.reverse()) {
      try {
        const left = await emptyBucketDirect(this.ctx, this.port, name, log);
        if (left !== null && left.length > 0) log(`${name} still holds ${String(left.length)} items`);
      } catch (e) {
        log(`emptying ${name} directly: ${e instanceof Error ? e.message : String(e)}`);
      }
      log(`DeleteBucket ${name} directly: ${shownDirect(await signedS3(this.ctx, this.port, 'DELETE', `/${name}`))}`);
    }
    for (const url of this.queues) {
      log(
        `SQS DeleteQueue ${url} directly: ${shownDirect(await directSqs(this.ctx, this.port, 'DeleteQueue', { QueueUrl: url }))}`,
      );
    }
    for (const arn of this.keys) {
      const answer = await kmsDirect(this.ctx, this.port, 'ScheduleKeyDeletion', {
        KeyId: arn,
        PendingWindowInDays: 7,
      });
      log(`KMS ScheduleKeyDeletion ${arn} directly: ${shownDirect(answer)}`);
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
/**
 * The visible match count of the table's text filter (R4.7). Cloudscape's `TextFilter` also renders the same text in a
 * hidden live region, so the count is matched here only (PM decision on decisions-needed 15).
 */
export const RESULTS_COUNT = wrapper.findTable().findTextFilter().findResultsCount().toSelector();
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
    resultsCount: page.locator(RESULTS_COUNT),
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
