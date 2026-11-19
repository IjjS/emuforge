// A bucket's page and the create form as a user meets them (test-criteria.md, issue 256, Flow checks of a bucket's
// page and of "Create bucket"; requirement R5, R6, R9, R10, R11), and what the checks compare them with. Imported
// directly by `s3-bucket-page.spec.ts`, `s3-bucket-page-states.spec.ts` and `s3-create-bucket.spec.ts`; the direct
// calls and `Seeded` are `services/s3/s3.ts`'s.
//
// - The words: the tabs, the thirteen sections built (every section of the spec but "AWS CloudTrail data events",
//   R14 item 6), their fields and buttons, the routes of R10, the form's labels and messages (R6.3), the flash items
//   (R6.6). English, word for word from the requirement.
// - A section is read by its heading (level 2, outside the side navigation and the help panel; a counter after the
//   title is allowed): its box is the largest element around that heading that holds no other level-2 heading. Its
//   fields are read by their labels (a `dt` and its `dd`, else the line after the label's last line), its table by
//   its column headings, and its lines as shown. `expectedSections` writes what each section shows for the direct
//   reads of the same bucket, in the words of R5.3.
// - `EngineRecord` lists the page's requests to the engine by operation (`GET /` is `ListBuckets`, `PUT /<bucket>`
//   without a subresource `CreateBucket`, `GET /<bucket>?versioning` `GetBucketVersioning`, …), from Playwright's
//   request events; it only listens. `EngineHold` holds the requests one predicate picks in the browser until the
//   check lets them go, with a Chrome DevTools Protocol `Fetch` session (as `ListBucketsHold` of `s3.ts`): it answers
//   nothing, every paused request is continued unchanged.
// - The Cloudscape selectors made by `createWrapper()` start with `body `, so they are rooted at the page, never under
//   another locator.
//
// Every value a check compares with comes from the run: names from the check's own prefix, Regions, dates, ARNs and
// properties from direct answers, the engine's origin from the engine the check started.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';

import { expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { creationDateText } from '../../support/service-screens';

import { type BucketProperties, type DirectBucket, regionText } from './s3';

// ---------------------------------------------------------------------------------------------------------------
// A bucket's page: routes and words (R0, R5, R9, R10).
// ---------------------------------------------------------------------------------------------------------------

/** One path segment, percent-encoded once (R10). */
const segment = (name: string) => encodeURIComponent(name);

/** The page's bare route and its "Properties" route (R0). */
export function bucketPath(name: string): string {
  return `/aws/s3/buckets/${segment(name)}`;
}
export function propertiesPath(name: string): string {
  return `${bucketPath(name)}/properties`;
}

/**
 * The two tabs (issue 480, decisions.md: the tabs Metadata, Permissions, Metrics and Management went): "Objects" at
 * the bare route, "Properties" at its own.
 */
export const TABS = ['Objects', 'Properties'];
export const OBJECTS = 'Objects';
export const PROPERTIES = 'Properties';

/** The page's own words (R3 row 10, R5.1, R9.2, R11.1). */
export const REFRESH = 'Refresh';
export const LOADING_BUCKET = 'Loading bucket';
export const SECTION_LOADING = 'Loading';
export const NO_TAGS = 'No tags';
export const NO_CONFIGURATIONS = 'No configurations';
export const NO_NOTIFICATIONS = 'No event notifications';

/** The section headings (R5.3), and the fields each one shows. */
export const OVERVIEW = 'Bucket overview';
export const VERSIONING = 'Bucket Versioning';
export const TAGS = 'Tags';
export const ENCRYPTION = 'Default encryption';
export const NOTIFICATIONS = 'Event notifications';
export const WEBSITE = 'Static website hosting';

/**
 * The six sections kept (issue 480: Bucket ABAC, S3 Intelligent-Tiering Archive configurations, Server access
 * logging, Amazon EventBridge, Transfer acceleration, Object Lock and Requester pays went), in the page's order.
 */
export const SECTIONS = [OVERVIEW, VERSIONING, TAGS, ENCRYPTION, NOTIFICATIONS, WEBSITE];

/** Each kept section's button and the route it leads to (R10): five. "Bucket overview" has none. */
export const SECTION_BUTTONS: { section: string; button: string; path: (name: string) => string }[] = [
  ...(
    [
      [VERSIONING, 'versioning'],
      [TAGS, 'tags'],
      [ENCRYPTION, 'encryption'],
      [WEBSITE, 'website'],
    ] as const
  ).map(([section, slug]) => ({
    section,
    button: 'Edit',
    path: (name: string) => `/aws/s3/bucket/${segment(name)}/property/${slug}/edit`,
  })),
  {
    section: NOTIFICATIONS,
    button: 'Create event notification',
    path: (name: string) => `/aws/s3/bucket/${segment(name)}/property/event-notification/create`,
  },
];

/** The words of the encryption types (R5.3), by `SSEAlgorithm`. */
export const SSE_S3 = 'Server-side encryption with Amazon S3 managed keys (SSE-S3)';
export const SSE_KMS = 'Server-side encryption with AWS Key Management Service keys (SSE-KMS)';
export const DSSE_KMS = 'Dual-layer server-side encryption with AWS Key Management Service (AWS KMS) keys (DSSE-KMS)';
const ENCRYPTION_TYPES: Record<string, string> = { AES256: SSE_S3, 'aws:kms': SSE_KMS, 'aws:kms:dsse': DSSE_KMS };

/** What one section is expected to show: field values by label, or a table's rows (none: its empty text). */
export interface ExpectedSection {
  fields?: Record<string, string>;
  rows?: Record<string, string>[];
  /** The table's empty title, shown when `rows` is empty. */
  empty?: string;
}

/**
 * What each built section shows for `bucket` of a direct `ListBuckets` and its `props` of direct reads, in the words
 * of R5.3, the creation date in `zone` (the browser's, which the check sets). A value the answer lacks is "-".
 */
export function expectedSections(
  bucket: DirectBucket,
  props: BucketProperties,
  zone: { offsetMinutes: number; label: string },
): Record<string, ExpectedSection> {
  const or = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? '-' : v);
  const enc = props.encryption;
  return {
    [OVERVIEW]: {
      fields: {
        'AWS Region': regionText(bucket.region),
        'Bucket ARN': or(bucket.arn),
        'Creation date': creationDateText(bucket.creationDate, zone),
      },
    },
    [VERSIONING]: { fields: { [VERSIONING]: props.versioning ?? 'Disabled' } },
    [TAGS]: { rows: (props.tags ?? []).map(([Key, Value]) => ({ Key, Value })), empty: NO_TAGS },
    [ENCRYPTION]: {
      fields: {
        'Encryption type': enc?.algorithm ? (ENCRYPTION_TYPES[enc.algorithm] ?? enc.algorithm) : '-',
        'AWS KMS key': or(enc?.keyId),
        'Bucket Key': enc?.bucketKey === true ? 'Enabled' : 'Disabled',
      },
    },
    [NOTIFICATIONS]: {
      rows: props.notifications.queues.map((q) => ({
        'Event name': q.id,
        'Event types': q.events.join(', '),
        Prefix: or(q.prefix),
        Suffix: or(q.suffix),
        'Destination type': 'SQS queue',
        Destination: q.queueArn,
      })),
      empty: NO_NOTIFICATIONS,
    },
    [WEBSITE]: {
      fields: {
        [WEBSITE]: props.website === null ? 'Disabled' : 'Enabled',
        'Index document': or(props.website?.indexDocument),
        'Error document': or(props.website?.errorDocument),
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a bucket's page.
// ---------------------------------------------------------------------------------------------------------------

/** XPath string literal of `text` (none of the titles holds a quote). */
const xq = (text: string) => `'${text}'`;

/** A level-2 heading outside the side navigation and the help panel whose text is `title`, or `title (<counter>)`. */
/** Every level-2 heading of the page's content: none of the navigation, the help panel or a hidden part. */
const ANY_HEADING = `//h2[not(ancestor::nav) and not(ancestor::aside) and not(ancestor::*[@aria-hidden='true'])]`;

function headingXPath(title: string): string {
  return ANY_HEADING + `[normalize-space(.)=${xq(title)} or starts-with(normalize-space(.), ${xq(`${title} (`)})]`;
}

/** The section `title`: the largest element around its heading that holds no other level-2 heading. */
export function sectionBox(page: Page, title: string): Locator {
  // `.//h2` of an element counts the headings inside it; on the reverse axis `ancestor`, `[last()]` is the farthest.
  return page.locator(`xpath=${headingXPath(title)}/ancestor::*[count(.//h2)=1][last()]`);
}

/** The section's heading. */
export function sectionHeading(page: Page, title: string): Locator {
  return page.locator(`xpath=${headingXPath(title)}`);
}

/** A section as shown: the values under `labels`, its table's rows by column heading, its lines. */
export interface ShownSection {
  fields: Record<string, string | null>;
  rows: Record<string, string>[] | null;
  lines: string[];
}

/** The section `title` as shown; `null` when the page has no such section, or more than one. */
export async function readSection(page: Page, title: string, labels: string[] = []): Promise<ShownSection | null> {
  const box = sectionBox(page, title);
  if ((await box.count()) !== 1) return null;
  return box.evaluate(
    (root, wanted) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const lines = (root as HTMLElement).innerText.split('\n').map(norm).filter(Boolean);
      const fields: Record<string, string | null> = {};
      for (const label of wanted) {
        const dt = [...root.querySelectorAll('dt')].find((d) => norm((d as HTMLElement).innerText) === label);
        if (dt) {
          let dd = dt.nextElementSibling;
          while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling;
          fields[label] = dd ? norm((dd as HTMLElement).innerText) : null;
          continue;
        }
        const at = lines.lastIndexOf(label);
        fields[label] = at > 0 && at + 1 < lines.length ? lines[at + 1] : null;
      }
      let rows: Record<string, string>[] | null = null;
      const table = [...root.querySelectorAll('table')].find(
        (t) => t.tBodies.length > 0 && !t.closest('[aria-hidden="true"]'),
      );
      const head = table?.tHead?.rows[0];
      if (table && head) {
        const headings = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
        rows = [];
        for (const row of table.tBodies[0].rows) {
          if (row.cells.length <= 1) continue;
          const record: Record<string, string> = {};
          headings.forEach((h, i) => {
            if (h !== '') record[h] = norm((row.cells[i] as HTMLElement | undefined)?.innerText ?? '');
          });
          rows.push(record);
        }
      }
      return { fields, rows, lines };
    },
    labels,
    ACTION,
  );
}

/** What `shown` differs in from `expected`, one line each; `[]` when it shows what is expected. */
export function sectionProblems(title: string, shown: ShownSection | null, expected: ExpectedSection): string[] {
  if (shown === null) return [`${title}: no such section on the page`];
  const problems: string[] = [];
  for (const [label, value] of Object.entries(expected.fields ?? {})) {
    if (shown.fields[label] !== value) {
      problems.push(
        `${title}: "${label}" shows ${JSON.stringify(shown.fields[label])}, expected ${JSON.stringify(value)}`,
      );
    }
  }
  if (expected.rows !== undefined) {
    if (expected.rows.length === 0) {
      if (!shown.lines.includes(expected.empty ?? '')) {
        problems.push(`${title}: "${expected.empty ?? ''}" is not shown; lines ${JSON.stringify(shown.lines)}`);
      }
      if (shown.rows !== null && shown.rows.length > 0) problems.push(`${title}: rows ${JSON.stringify(shown.rows)}`);
    } else {
      const picked = (shown.rows ?? []).map((r) =>
        Object.fromEntries(Object.keys(expected.rows![0]).map((k) => [k, r[k] ?? null])),
      );
      if (JSON.stringify(picked) !== JSON.stringify(expected.rows)) {
        problems.push(`${title}: rows ${JSON.stringify(picked)}, expected ${JSON.stringify(expected.rows)}`);
      }
    }
  }
  return problems;
}

/** Every section of `expected` as shown, compared: the problems of all of them. */
export async function pageProblems(page: Page, expected: Record<string, ExpectedSection>): Promise<string[]> {
  const problems: string[] = [];
  for (const [title, section] of Object.entries(expected)) {
    const shown = await readSection(page, title, Object.keys(section.fields ?? {}));
    problems.push(...sectionProblems(title, shown, section));
  }
  return problems;
}

/** Waits until every section of `expected` shows what it should; a failure lists what differs. */
export async function expectSections(
  page: Page,
  expected: Record<string, ExpectedSection>,
  message: string,
  timeout = 10_000,
): Promise<void> {
  await expect.poll(() => pageProblems(page, expected), { timeout, message }).toEqual([]);
}

/**
 * The titles of every section heading the page's content shows now, in the page's order: a known section by its
 * title (without its count), any other level-2 heading by its text, so a section that should be gone is seen.
 */
export async function shownSectionTitles(page: Page): Promise<string[]> {
  const headings = page.locator(`xpath=${ANY_HEADING}`);
  const shown: { title: string; y: number }[] = [];
  for (const h of await headings.all()) {
    const text = (await h.innerText()).replace(/\s+/g, ' ').trim();
    const title = SECTIONS.find((t) => text === t || text.startsWith(`${t} (`)) ?? text;
    shown.push({ title, y: (await h.boundingBox())?.y ?? 0 });
  }
  return shown.sort((a, b) => a.y - b.y).map((s) => s.title);
}

/** The names of the page's tabs, in order. */
export async function shownTabs(page: Page): Promise<string[]> {
  return (await page.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** The page's tabs. */
export function tab(page: Page, name: string): Locator {
  return page.getByRole('tab', { name, exact: true });
}

/** A section's button (`Edit`, `Create configuration`, …), a link or a button. */
export function sectionButton(page: Page, section: string, name: string): Locator {
  const box = sectionBox(page, section);
  return box.getByRole('link', { name, exact: true }).or(box.getByRole('button', { name, exact: true }));
}

/** Waits for a bucket's page: its `h1` the bucket's name and the tab `selected` ("Properties" unless named). */
export async function expectBucketPage(page: Page, name: string, selected = PROPERTIES): Promise<void> {
  await expect(heading(page, name), `the bucket page's h1 "${name}"`).toBeVisible();
  await expect(tab(page, selected), `the tab "${selected}" selected`).toHaveAttribute('aria-selected', 'true');
}

/**
 * Opens `path` and waits for the page of bucket `name` on "Properties": its own route since issue 480 moved the
 * bare route to "Objects" (decisions.md, the listed checks).
 */
export async function openBucketPage(page: Page, name: string, path = propertiesPath(name)): Promise<void> {
  await page.goto(path);
  await expectBucketPage(page, name);
}

/** Opens a bucket's tab "Objects" at `prefix` (the bare route, `?prefix=`) and waits for it. */
export async function openObjectsTab(page: Page, name: string, prefix = ''): Promise<void> {
  await page.goto(prefix === '' ? bucketPath(name) : `${bucketPath(name)}?${new URLSearchParams({ prefix })}`);
  await expectBucketPage(page, name, OBJECTS);
}

// ---------------------------------------------------------------------------------------------------------------
// The create form (R6, R9.3).
// ---------------------------------------------------------------------------------------------------------------

export const CREATE_PATH = '/aws/s3/bucket/create';
export const CREATE_H1 = 'Create bucket';
export const CREATE_BUTTON = 'Create bucket';
export const CANCEL = 'Cancel';
export const ADD_TAG = 'Add tag';
export const REMOVE = 'Remove';

export const OWNERSHIP_CHOICES = ['Bucket owner enforced', 'Bucket owner preferred', 'Object writer'];
export const BLOCK_SETTINGS = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];
export const ENCRYPTION_CHOICES = [SSE_S3, SSE_KMS, DSSE_KMS];

/** The field messages of R6.3 and R6.4. */
export const MESSAGES = {
  emptyName: 'Enter a bucket name.',
  length: 'The name must have 3 to 63 characters.',
  characters: 'Use only lowercase letters, digits, periods (.) and hyphens (-).',
  ends: 'The name must begin and end with a letter or digit.',
  periods: 'The name cannot have two periods in a row.',
  ip: 'The name cannot be formatted as an IP address.',
  begins: (prefix: string) => `The name cannot begin with “${prefix}”.`,
  endsWith: (suffix: string) => `The name cannot end with “${suffix}”.`,
  emptyKey: 'Enter a key.',
  awsKey: 'A key cannot begin with “aws:”.',
  usedKey: 'This key is already used.',
  emptyKms: 'Enter a KMS key ARN.',
  taken: (name: string) => `The emulator already holds a bucket named “${name}”.`,
};

/** The success item of the flash after "Create bucket" (R6.6). */
export function createdItem(name: string): string {
  return `Bucket “${name}” was created in the local emulator.`;
}

/** The form's controls. */
export function form(page: Page) {
  const group = (name: string) => page.getByRole('radiogroup', { name, exact: true });
  return {
    h1: heading(page, CREATE_H1),
    name: page.getByRole('textbox', { name: 'Bucket name', exact: true }),
    ownership: (choice: string) => page.getByRole('radio', { name: choice, exact: true }),
    block: (setting: string) => page.getByRole('checkbox', { name: setting, exact: true }),
    versioning: (choice: 'Enable' | 'Disable') =>
      group('Bucket Versioning').getByRole('radio', { name: choice, exact: true }),
    addTag: page.getByRole('button', { name: ADD_TAG, exact: true }),
    key: (i: number) => page.getByRole('textbox', { name: 'Key', exact: true }).nth(i),
    value: (i: number) => page.getByRole('textbox', { name: 'Value', exact: true }).nth(i),
    keys: page.getByRole('textbox', { name: 'Key', exact: true }),
    removeTag: page.getByRole('button', { name: REMOVE, exact: true }),
    encryption: (choice: string) => page.getByRole('radio', { name: choice, exact: true }),
    kmsKey: page.getByRole('textbox', { name: 'AWS KMS key', exact: true }),
    bucketKeyGroup: group('Bucket Key'),
    bucketKey: (choice: 'Enable' | 'Disable') => group('Bucket Key').getByRole('radio', { name: choice, exact: true }),
    objectLock: (choice: 'Enable' | 'Disable') =>
      group('Object Lock').getByRole('radio', { name: choice, exact: true }),
    cancel: page.getByRole('button', { name: CANCEL, exact: true }),
    create: page.getByRole('button', { name: CREATE_BUTTON, exact: true }),
  };
}

/** Opens the form at `path` and waits for its `h1`. */
export async function openForm(page: Page, path = CREATE_PATH): Promise<void> {
  await page.goto(path);
  await expect(heading(page, CREATE_H1), `the form's h1 "${CREATE_H1}"`).toBeVisible();
}

/** The form's values as shown. */
export interface FormState {
  name: string | null;
  ownership: string | null;
  blocks: (boolean | null)[];
  versioning: string | null;
  tags: number;
  encryption: string | null;
  kmsKeyShown: boolean;
  bucketKeyShown: boolean;
  objectLock: string | null;
}

/** The form as it is at start (R6.1). */
export const FORM_AT_START: FormState = {
  name: '',
  ownership: OWNERSHIP_CHOICES[0],
  blocks: [true, true, true, true],
  versioning: 'Disable',
  tags: 0,
  encryption: SSE_S3,
  kmsKeyShown: false,
  bucketKeyShown: false,
  objectLock: 'Disable',
};

async function checked(locator: Locator): Promise<boolean | null> {
  return (await locator.count()) === 1 ? locator.isChecked(ACTION) : null;
}

async function chosen(options: [string, Locator][]): Promise<string | null> {
  for (const [name, locator] of options) if ((await checked(locator)) === true) return name;
  return null;
}

/** The form's values as shown now. */
export async function formState(page: Page): Promise<FormState> {
  const f = form(page);
  return {
    name: (await f.name.count()) === 1 ? await f.name.inputValue(ACTION) : null,
    ownership: await chosen(OWNERSHIP_CHOICES.map((c) => [c, f.ownership(c)])),
    blocks: await Promise.all(BLOCK_SETTINGS.map((s) => checked(f.block(s)))),
    versioning: await chosen((['Disable', 'Enable'] as const).map((c) => [c, f.versioning(c)])),
    tags: await f.keys.count(),
    encryption: await chosen(ENCRYPTION_CHOICES.map((c) => [c, f.encryption(c)])),
    kmsKeyShown: (await f.kmsKey.count()) > 0,
    bucketKeyShown: (await f.bucketKeyGroup.count()) > 0,
    objectLock: await chosen((['Disable', 'Enable'] as const).map((c) => [c, f.objectLock(c)])),
  };
}

/** Waits until `field` carries `message` as its description (Cloudscape's form field puts its error text there). */
export async function expectFieldMessage(field: Locator, message: string, what: string): Promise<void> {
  await expect(field, `${what} shows "${message}"`).toHaveAccessibleDescription(
    new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The area's flash (R6.6, R11.4).
// ---------------------------------------------------------------------------------------------------------------

/** The items of the area's `Flashbar` (rooted at the page: the selector starts with `body `). */
export const FLASH_ITEMS = createWrapper().findFlashbar().findItems().toSelector();

/** The flash items' texts as shown, white space collapsed. */
export async function flashTexts(page: Page): Promise<string[]> {
  return (await page.locator(FLASH_ITEMS).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** The flash item that holds `text`. */
export function flashItem(page: Page, text: string): Locator {
  return page.locator(FLASH_ITEMS).filter({ hasText: text });
}

// ---------------------------------------------------------------------------------------------------------------
// The page's requests to the engine.
// ---------------------------------------------------------------------------------------------------------------

/** The S3 operation of a subresource, by method. */
const SUBRESOURCES: Record<string, Record<string, string>> = {
  versioning: { GET: 'GetBucketVersioning', PUT: 'PutBucketVersioning' },
  abac: { GET: 'GetBucketAbac', PUT: 'PutBucketAbac' },
  tagging: { GET: 'GetBucketTagging', PUT: 'PutBucketTagging' },
  encryption: { GET: 'GetBucketEncryption', PUT: 'PutBucketEncryption' },
  'intelligent-tiering': {
    GET: 'ListBucketIntelligentTieringConfigurations',
    PUT: 'PutBucketIntelligentTieringConfiguration',
  },
  logging: { GET: 'GetBucketLogging', PUT: 'PutBucketLogging' },
  notification: { GET: 'GetBucketNotificationConfiguration', PUT: 'PutBucketNotificationConfiguration' },
  accelerate: { GET: 'GetBucketAccelerateConfiguration', PUT: 'PutBucketAccelerateConfiguration' },
  'object-lock': { GET: 'GetObjectLockConfiguration', PUT: 'PutObjectLockConfiguration' },
  requestPayment: { GET: 'GetBucketRequestPayment', PUT: 'PutBucketRequestPayment' },
  website: { GET: 'GetBucketWebsite', PUT: 'PutBucketWebsite' },
  publicAccessBlock: { GET: 'GetPublicAccessBlock', PUT: 'PutPublicAccessBlock' },
  ownershipControls: { GET: 'GetBucketOwnershipControls', PUT: 'PutBucketOwnershipControls' },
  versions: { GET: 'ListObjectVersions' },
  delete: { POST: 'DeleteObjects' },
};

/**
 * The S3 operation of a request to the engine at `engineOrigin` (path style); `null` for a request that is not one
 * (another origin, the engine's own `/__emuforge/` paths, a CORS preflight).
 */
export function operationOf(url: string, method: string, engineOrigin: string): string | null {
  const u = new URL(url);
  if (u.origin !== engineOrigin || u.pathname.startsWith('/__emuforge/') || method === 'OPTIONS') return null;
  const xId = u.searchParams.get('x-id');
  if (xId) return xId;
  if (u.pathname === '/' && method === 'GET') return 'ListBuckets';
  for (const key of u.searchParams.keys()) {
    const op = SUBRESOURCES[key]?.[method];
    if (op) return op;
  }
  const keys = [...u.searchParams.keys()];
  const bucketOnly = /^\/[^/]+\/?$/.test(u.pathname);
  if (bucketOnly && keys.length === 0 && method === 'PUT') return 'CreateBucket';
  if (bucketOnly && keys.length === 0 && method === 'DELETE') return 'DeleteBucket';
  return `${method} ${u.pathname}${u.search}`;
}

/** One request of the page to the engine. */
export interface EngineRequest {
  operation: string;
  /** The bucket of a path-style request; `null` for `ListBuckets`. */
  bucket: string | null;
  query: Record<string, string>;
}

/** The page's S3 requests to the engine, in the order they left, from Playwright's request events of the context. */
export class EngineRecord {
  readonly requests: EngineRequest[] = [];

  private constructor(private readonly ctx: Ctx) {}

  static attach(ctx: Ctx, context: BrowserContext, engineOrigin: string): EngineRecord {
    const record = new EngineRecord(ctx);
    context.on('request', (request) => {
      const operation = operationOf(request.url(), request.method(), engineOrigin);
      if (operation === null) return;
      const u = new URL(request.url());
      const segment0 = u.pathname.split('/')[1] ?? '';
      record.requests.push({
        operation,
        bucket: segment0 === '' ? null : decodeURIComponent(segment0),
        query: Object.fromEntries(u.searchParams),
      });
    });
    return record;
  }

  /** The requests of `operation` (for `bucket`, when given). */
  of(operation: string, bucket?: string): EngineRequest[] {
    return this.requests.filter((r) => r.operation === operation && (bucket === undefined || r.bucket === bucket));
  }

  /** The operations in the order they left, from the `from`th request on. */
  operations(from = 0): string[] {
    return this.requests.slice(from).map((r) => r.operation);
  }

  log(): void {
    this.ctx.log(`engine requests: ${JSON.stringify(this.requests)}`);
  }
}

/**
 * Holds the page's requests to the engine that `pick` chooses (by operation), in the browser, while holding, through
 * a CDP `Fetch` session on `page`. It answers nothing: a held request is continued unchanged when `release` is
 * called, every other paused request (session, health, CORS preflights, the other operations) at once.
 */
export class EngineHold {
  private holding = true;
  private readonly held: string[] = [];

  private constructor(
    private readonly ctx: Ctx,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(
    ctx: Ctx,
    context: BrowserContext,
    page: Page,
    engineOrigin: string,
    pick: (operation: string) => boolean,
  ): Promise<EngineHold> {
    const cdp = await context.newCDPSession(page);
    const hold = new EngineHold(ctx, cdp);
    ctx.own(hold);
    cdp.on('Fetch.requestPaused', (e) => {
      const operation = operationOf(e.request.url, e.request.method, engineOrigin);
      if (hold.holding && operation !== null && pick(operation)) {
        hold.held.push(e.requestId);
        ctx.log(`holding ${operation} ${new URL(e.request.url).pathname}${new URL(e.request.url).search}`);
        return;
      }
      void cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => undefined);
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${engineOrigin}/*`, requestStage: 'Request' }] });
    return hold;
  }

  /** How many requests are held now. */
  count(): number {
    return this.held.length;
  }

  /** Lets every held request go, unchanged, and holds no more. */
  async release(): Promise<void> {
    this.holding = false;
    for (const requestId of this.held.splice(0)) {
      await this.cdp.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
    }
    this.ctx.log('let the held requests go');
  }

  async dispose(): Promise<void> {
    await this.release();
    await this.cdp.send('Fetch.disable').catch(() => undefined);
  }
}
