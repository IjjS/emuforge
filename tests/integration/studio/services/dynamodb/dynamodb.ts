// The emulator side and the words of DynamoDB's screens (test-criteria.md, issue 496), for the `dynamodb-*.spec.ts`
// checks.
//
// - Direct calls: `directDynamoDb` of `support/aws-clients-general.ts` (JSON 1.0 straight to the emulator, SigV4-signed
//   with the key it wrote for this run, TLS verified against its `ca.pem`), never through the engine. An answer's
//   error is read from its JSON `__type` and `message`.
// - A table's change of status (`CREATING`, `UPDATING`, `DELETING`) is waited for with a bound through
//   `DescribeTable`, never with a sleep.
// - `DynamoDbSeeded`: the tables a check makes, every one named under the check's prefix `<p>`. When the check ends
//   it removes every table of the emulator whose name starts with `<p>`, those Studio made during the check
//   included, a protected one too.
// - The screens' words (requirement.md, "EmuForge's own text"; design.md) and readers of what a screen shows.
//
// Every value a check compares with comes from the run: names from the check's own prefix, ARNs and messages from
// an answer of the emulator.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page, Response } from '@playwright/test';

import { directDynamoDb, type DirectAnswer } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION } from '../../support/frame';
import { waitFor } from '../../support/wait';

/** How long a table may take for one change of status (the emulator takes about 3 s for each). */
export const TABLE_STATUS_BOUND_MS = 20_000;

/** The table name alphabet in code point order, the order of `ListTables`. */
const NAME_ALPHABET = '-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** A direct answer, parsed: its status, its JSON body (`{}` when empty), and for a refusal its code and message. */
export interface Answer {
  status: number;
  json: Record<string, unknown>;
  type: string | null;
  message: string | null;
}

function parsed(answer: DirectAnswer, what: string): Answer {
  if ('error' in answer) throw new EnvError(`${what}: ${answer.error}`);
  let json: Record<string, unknown> = {};
  if (answer.body.trim() !== '') {
    try {
      json = JSON.parse(answer.body) as Record<string, unknown>;
    } catch {
      json = { raw: answer.body };
    }
  }
  const type = typeof json.__type === 'string' ? (json.__type.split('#').at(-1) ?? null) : null;
  const message = (json.message ?? json.Message) as string | undefined;
  return { status: answer.status, json, type, message: typeof message === 'string' ? message : null };
}

/** Sends `operation` with `input` straight to the emulator; `quiet` leaves it out of the log (a wait's reads). */
export async function ddb(ctx: Ctx, port: number, operation: string, input: object = {}, quiet = false): Promise<Answer> {
  const answer = parsed(await directDynamoDb(ctx, port, operation, input), `direct ${operation}`);
  if (!quiet) ctx.log(`direct ${operation}: status ${String(answer.status)}${answer.type ? ` ${answer.type}` : ''}`);
  return answer;
}

/** Sends `operation` and fails the check unless the emulator answered 200. */
export async function ddbOk(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  const answer = await ddb(ctx, port, operation, input);
  if (answer.status !== 200) {
    throw new Error(`direct ${operation} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  }
  return answer;
}

/** An attribute value and an item of the JSON protocol, as the emulator writes them. */
export type AttributeValue = Record<string, unknown>;
export type Item = Record<string, AttributeValue>;

/** A table as a direct `DescribeTable` gives it: the fields the checks read, and whatever else it holds. */
export interface TableDescription {
  TableName: string;
  TableStatus: string;
  TableArn: string;
  KeySchema: { AttributeName: string; KeyType: string }[];
  AttributeDefinitions: { AttributeName: string; AttributeType: string }[];
  ProvisionedThroughput?: { ReadCapacityUnits?: number; WriteCapacityUnits?: number };
  BillingModeSummary?: { BillingMode?: string };
  DeletionProtectionEnabled?: boolean;
  GlobalSecondaryIndexes?: { IndexName: string; IndexStatus?: string }[];
  [field: string]: unknown;
}

/** A direct `DescribeTable name`; `null` when the emulator holds no such table. */
export async function tableDirect(ctx: Ctx, port: number, name: string, quiet = false): Promise<TableDescription | null> {
  const answer = await ddb(ctx, port, 'DescribeTable', { TableName: name }, quiet);
  if (answer.status === 200) return answer.json.Table as TableDescription;
  if (answer.type === 'ResourceNotFoundException') return null;
  throw new Error(`direct DescribeTable ${name} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
}

function settled(table: TableDescription): boolean {
  return (
    table.TableStatus === 'ACTIVE' &&
    (table.GlobalSecondaryIndexes ?? []).every((i) => i.IndexStatus === undefined || i.IndexStatus === 'ACTIVE')
  );
}

/** Waits, with a bound, until the table `name` and its global indexes are `ACTIVE`; whether they are. */
export async function waitActive(ctx: Ctx, port: number, name: string): Promise<boolean> {
  const reached = await waitFor(TABLE_STATUS_BOUND_MS, async () => {
    const table = await tableDirect(ctx, port, name, true);
    return table !== null && settled(table) ? true : undefined;
  });
  ctx.log(`direct DescribeTable ${name}: ${reached ? 'ACTIVE' : 'not ACTIVE within the bound'}`);
  return reached === true;
}

/** Waits, with a bound, until the emulator holds no table `name`; whether it is gone. */
export async function waitGone(ctx: Ctx, port: number, name: string): Promise<boolean> {
  const gone = await waitFor(TABLE_STATUS_BOUND_MS, async () =>
    (await tableDirect(ctx, port, name, true)) === null ? true : undefined,
  );
  ctx.log(`direct DescribeTable ${name}: ${gone ? 'gone' : 'still held within the bound'}`);
  return gone === true;
}

/**
 * The start name of a direct `ListTables` whose first page begins with the least name starting with `prefix`: the
 * greatest name that sorts before it. `prefix` is the check's own, of the name alphabet and at least 3 characters.
 */
function startNameOf(prefix: string): string {
  const last = prefix.at(-1) ?? '';
  const before = NAME_ALPHABET[NAME_ALPHABET.indexOf(last) - 1];
  if (prefix.length < 3 || before === undefined) throw new Error(`the prefix ${prefix} has no start name`);
  return `${prefix.slice(0, -1)}${before}`.padEnd(255, 'z');
}

/** The names of the tables under `prefix`, in `ListTables`' order, page after page; every table's without one. */
export async function tableNamesDirect(ctx: Ctx, port: number, prefix?: string): Promise<string[]> {
  const names: string[] = [];
  let next: string | undefined = prefix === undefined ? undefined : startNameOf(prefix);
  for (let pages = 0; pages < 1000; pages++) {
    const answer = await ddbOk(ctx, port, 'ListTables', {
      Limit: 100,
      ...(next === undefined ? {} : { ExclusiveStartTableName: next }),
    });
    for (const name of (answer.json.TableNames ?? []) as string[]) {
      if (prefix !== undefined && !name.startsWith(prefix)) return names;
      names.push(name);
    }
    next = answer.json.LastEvaluatedTableName as string | undefined;
    if (next === undefined) return names;
  }
  throw new Error('direct ListTables: more than 1000 pages');
}

/** Every item of the table `name`, by a direct `Scan`, page after page. */
export async function itemsDirect(ctx: Ctx, port: number, name: string): Promise<Item[]> {
  const items: Item[] = [];
  let start: Item | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    const answer = await ddbOk(ctx, port, 'Scan', {
      TableName: name,
      ...(start === undefined ? {} : { ExclusiveStartKey: start }),
    });
    items.push(...((answer.json.Items ?? []) as Item[]));
    start = answer.json.LastEvaluatedKey as Item | undefined;
    if (start === undefined) return items;
  }
  throw new Error('direct Scan: more than 1000 pages');
}

/** A direct `GetItem` of `key` with a consistent read; `null` when the table holds no such item. */
export async function itemDirect(ctx: Ctx, port: number, name: string, key: Item): Promise<Item | null> {
  const answer = await ddbOk(ctx, port, 'GetItem', { TableName: name, Key: key, ConsistentRead: true });
  return (answer.json.Item as Item | undefined) ?? null;
}

/** A direct `DeleteItem` of `key`. */
export async function deleteItemDirect(ctx: Ctx, port: number, name: string, key: Item): Promise<void> {
  await ddbOk(ctx, port, 'DeleteItem', { TableName: name, Key: key });
}

/** A direct `DeleteTable name`, then waits until the emulator holds it no longer. */
export async function deleteTableDirect(ctx: Ctx, port: number, name: string): Promise<void> {
  await ddbOk(ctx, port, 'DeleteTable', { TableName: name });
  if (!(await waitGone(ctx, port, name))) throw new EnvError(`table ${name} was not gone within the bound`);
}

/** Items in a stable order for a comparison: by their JSON text. */
export function sorted(items: Item[]): Item[] {
  return [...items].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** A key attribute as `name:type`, the type `S`, `N` or `B`: `pk:S`. */
type KeyText = `${string}:${'S' | 'N' | 'B'}`;

/** What a table a check makes directly has; everything but its partition key has a default. */
export interface TableOptions {
  partition: KeyText;
  sort?: KeyText;
  /** On-demand unless given. */
  provisioned?: { read: number; write: number };
  globalIndexes?: { name: string; partition: KeyText; sort?: KeyText; projection?: 'ALL' | 'KEYS_ONLY' }[];
  /** Each with the table's partition key. */
  localIndexes?: { name: string; sort: KeyText; projection?: 'ALL' | 'KEYS_ONLY' }[];
  deletionProtection?: boolean;
  stream?: string;
}

function keyOf(text: KeyText): { name: string; type: string } {
  const at = text.lastIndexOf(':');
  return { name: text.slice(0, at), type: text.slice(at + 1) };
}

function keySchema(partition: KeyText, sort?: KeyText) {
  return [
    { AttributeName: keyOf(partition).name, KeyType: 'HASH' },
    ...(sort === undefined ? [] : [{ AttributeName: keyOf(sort).name, KeyType: 'RANGE' }]),
  ];
}

/** The `CreateTable` input of a table `name` with `options`. */
export function createTableInput(name: string, options: TableOptions): Record<string, unknown> {
  const attributes = new Map<string, string>();
  const define = (text: KeyText | undefined) => {
    if (text !== undefined) attributes.set(keyOf(text).name, keyOf(text).type);
  };
  define(options.partition);
  define(options.sort);
  for (const index of options.globalIndexes ?? []) {
    define(index.partition);
    define(index.sort);
  }
  for (const index of options.localIndexes ?? []) define(index.sort);
  const throughput =
    options.provisioned === undefined
      ? undefined
      : { ReadCapacityUnits: options.provisioned.read, WriteCapacityUnits: options.provisioned.write };
  const input: Record<string, unknown> = {
    TableName: name,
    AttributeDefinitions: [...attributes].map(([AttributeName, AttributeType]) => ({ AttributeName, AttributeType })),
    KeySchema: keySchema(options.partition, options.sort),
    BillingMode: throughput === undefined ? 'PAY_PER_REQUEST' : 'PROVISIONED',
  };
  if (throughput !== undefined) input.ProvisionedThroughput = throughput;
  if (options.globalIndexes?.length) {
    input.GlobalSecondaryIndexes = options.globalIndexes.map((index) => ({
      IndexName: index.name,
      KeySchema: keySchema(index.partition, index.sort),
      Projection: { ProjectionType: index.projection ?? 'ALL' },
      ...(throughput === undefined ? {} : { ProvisionedThroughput: throughput }),
    }));
  }
  if (options.localIndexes?.length) {
    input.LocalSecondaryIndexes = options.localIndexes.map((index) => ({
      IndexName: index.name,
      KeySchema: keySchema(options.partition, index.sort),
      Projection: { ProjectionType: index.projection ?? 'ALL' },
    }));
  }
  if (options.deletionProtection !== undefined) input.DeletionProtectionEnabled = options.deletionProtection;
  if (options.stream !== undefined) input.StreamSpecification = { StreamEnabled: true, StreamViewType: options.stream };
  return input;
}

/** Removes the table `name` whatever state it is in: waits for a change to end, turns protection off, deletes. */
async function removeTable(ctx: Ctx, port: number, name: string): Promise<boolean> {
  let table = await tableDirect(ctx, port, name, true);
  if (table === null) return true;
  if (table.TableStatus === 'DELETING') return waitGone(ctx, port, name);
  if (!settled(table)) {
    await waitActive(ctx, port, name);
    table = await tableDirect(ctx, port, name, true);
    if (table === null) return true;
  }
  if (table.DeletionProtectionEnabled) {
    const off = await ddb(ctx, port, 'UpdateTable', { TableName: name, DeletionProtectionEnabled: false });
    if (off.status === 200) await waitActive(ctx, port, name);
  }
  const deleted = await ddb(ctx, port, 'DeleteTable', { TableName: name });
  if (deleted.status !== 200 && deleted.type !== 'ResourceInUseException') {
    return deleted.type === 'ResourceNotFoundException';
  }
  return waitGone(ctx, port, name);
}

/**
 * The tables a check makes under its prefix; every table of that prefix is removed when the check ends. Making one
 * the emulator refuses, or one that is not `ACTIVE` within the bound, is an environment failure: the check's Given
 * would not hold.
 */
export class DynamoDbSeeded {
  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  private async given(operation: string, input: object): Promise<Answer> {
    const answer = await ddb(this.ctx, this.port, operation, input);
    if (answer.status !== 200) {
      throw new EnvError(`direct ${operation} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
    }
    return answer;
  }

  /** `CreateTable` of each of `tables`, then waits until each is `ACTIVE`; each as `DescribeTable` gives it then. */
  async tables(tables: [name: string, options: TableOptions][]): Promise<TableDescription[]> {
    for (const [name, options] of tables) {
      if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
      await this.given('CreateTable', createTableInput(name, options));
    }
    const made: TableDescription[] = [];
    for (const [name] of tables) {
      if (!(await waitActive(this.ctx, this.port, name))) {
        throw new EnvError(`table ${name} was not ACTIVE within ${String(TABLE_STATUS_BOUND_MS)} ms`);
      }
      const table = await tableDirect(this.ctx, this.port, name);
      if (table === null) throw new EnvError(`table ${name} is gone right after it was made`);
      made.push(table);
    }
    return made;
  }

  /** One table of `options` holding `items`. */
  async table(name: string, options: TableOptions, items: Item[] = []): Promise<TableDescription> {
    const [table] = await this.tables([[name, options]]);
    await this.items(name, items);
    return table!;
  }

  /** `PutItem` of each of `items`. */
  async items(name: string, items: Item[]): Promise<void> {
    for (const item of items) await this.given('PutItem', { TableName: name, Item: item });
  }

  /** Turns time to live on for `attribute`. */
  async timeToLive(name: string, attribute: string): Promise<void> {
    await this.given('UpdateTimeToLive', {
      TableName: name,
      TimeToLiveSpecification: { Enabled: true, AttributeName: attribute },
    });
  }

  /** Removes every table of the emulator under the check's prefix. */
  async dispose(): Promise<void> {
    try {
      for (const name of await tableNamesDirect(this.ctx, this.port, this.prefix)) {
        if (!(await removeTable(this.ctx, this.port, name))) {
          this.ctx.log(`cleanup: the table ${name} was not removed`);
        }
      }
    } catch (e) {
      this.ctx.log(`cleanup: the tables under ${this.prefix} could not be removed: ${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens' words.
// ---------------------------------------------------------------------------------------------------------------

export const SERVICE_LABEL = 'Amazon DynamoDB';
export const DYNAMODB_PATH = '/aws/dynamodb';
export const TABLES_PATH = '/aws/dynamodb/tables';
export const CREATE_TABLE_PATH = '/aws/dynamodb/tables/create';
/** S2's path for `name`, its name one segment below `table/`. */
export function tablePath(name: string): string {
  return `${TABLES_PATH}/table/${encodeURIComponent(name)}`;
}

export const LIST_H1 = 'Tables';
export const CREATE_TABLE = 'Create table';
export const NAVIGATION_HEADER = 'DynamoDB';
export const SEARCH = 'Search tables';
export const REFRESH = 'Refresh';
export const DELETE = 'Delete';
export const DELETE_TABLE = 'Delete table';
export const CLEAR_SEARCH = 'Clear search';
export const NEXT_PAGE = 'Next page';
export const PREFERENCES = 'Preferences';
export const NO_TABLES = 'No tables';
export const NO_TABLES_TEXT =
  'This emulator holds no tables. Create one here, or with any tool pointed at the emulator. It starts empty each time it restarts.';
export const NO_MATCHES = 'No matches';
/** "No table name starts with “{text}”." */
export function noMatchText(text: string): string {
  return `No table name starts with “${text}”.`;
}
export const NOT_FOUND = 'No table named';

export const TAB_ITEMS = 'Items';
export const TAB_DETAILS = 'Details';
export const NO_ITEMS = 'No items';
export const NO_MORE_ITEMS = 'No more items';
export const CREATE_ITEM = 'Create item';
export const EDIT_ITEM = 'Edit item';
export const SAVE = 'Save';
export const CANCEL = 'Cancel';
export const RUN = 'Run';
export const KEY_CHANGED = 'The key cannot change.';
export const CONDITION_FAILED = 'ConditionalCheckFailedException';

export function beingCreated(name: string): string {
  return `Table ${name} is being created.`;
}
export function beingDeleted(name: string): string {
  return `Table ${name} is being deleted.`;
}
export function itemCreated(table: string): string {
  return `Item created in ${table}.`;
}
export function itemSaved(table: string): string {
  return `Item saved in ${table}.`;
}
export function itemsDeleted(n: number, table: string): string {
  return `${n === 1 ? '1 item' : `${String(n)} items`} deleted from ${table}.`;
}
export function alreadyThere(table: string): string {
  return `An item with this key is already in ${table}. Open it to change it.`;
}
export function noLongerThere(table: string): string {
  return `This item is no longer in ${table}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** A Cloudscape table, as a selector that also matches inside a scoped locator (no leading `body`). */
export const TABLE = wrapper.findTable().toSelector().replace(/^body /, '');

/** The page's `h1` named `name`, or `name` followed by a list's counter ("Tables (3)", "Tables (25+)"). */
export function h1(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('heading', { level: 1, name: new RegExp(`^${escaped}( \\(\\d+\\+?\\))?$`) });
}

/** Opens `path` and waits for its `h1` `name`. */
export async function open(page: Page, path: string, name: string): Promise<void> {
  await page.goto(path);
  await expect(h1(page, name), `the h1 "${name}" at ${path}`).toBeVisible({ timeout: 15_000 });
}

/** The column headings of `table` as shown, the selection column (no heading) left out. */
export async function headersOf(table: Locator): Promise<string[]> {
  return table.evaluate((root) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    return [...root.querySelectorAll('table thead tr:first-child > th')]
      .map((th) => norm(th.textContent))
      .filter((text) => text !== '');
  });
}

/**
 * The data rows of the table `table` as shown, each a record of its column headings' texts to its cells' texts (the
 * selection column has no heading and is left out). A row whose only cell spans the table (loading, empty, a failure)
 * is not a data row.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  return table.evaluate((root) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const element = root.querySelector('table');
    if (element === null) return [];
    const headers = [...element.querySelectorAll('thead tr:first-child > th')].map((th) => norm(th.textContent));
    const rows: Record<string, string>[] = [];
    for (const tr of element.querySelectorAll('tbody > tr')) {
      const cells = [...tr.querySelectorAll(':scope > td, :scope > th')];
      if (cells.length !== headers.length) continue;
      const row: Record<string, string> = {};
      cells.forEach((cell, i) => {
        const header = headers[i] ?? '';
        if (header !== '') row[header] = norm(cell.textContent);
      });
      rows.push(row);
    }
    return rows;
  });
}

/** Waits until the rows of `table`, mapped by `pick`, equal `want`. */
export async function expectRows<T>(
  table: Locator,
  pick: (row: Record<string, string>) => T,
  want: T[],
  what: string,
  timeout = 20_000,
): Promise<void> {
  await expect.poll(async () => (await rowsOf(table)).map(pick), { message: what, timeout }).toEqual(want);
}

/** The data row of `table` whose cells hold every text of `texts`, each as a whole cell's text. */
export function rowWith(table: Locator, ...texts: string[]): Locator {
  let row = table.locator('tbody > tr');
  for (const text of texts) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    row = row.filter({ has: table.page().locator('td, th', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) }) });
  }
  return row;
}

/** The text of the value of `label` in the key-value pairs inside `scope` (S2's "Table details"). */
export async function valueOf(scope: Locator, label: string): Promise<string | null> {
  return scope.evaluate((root, wanted) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    for (const dt of root.querySelectorAll('dt')) {
      if (norm(dt.textContent) !== wanted) continue;
      const dd = dt.nextElementSibling;
      return dd === null ? null : norm(dd.textContent);
    }
    return null;
  }, label);
}

/** The flash items of type `type`, as one locator. */
export function flashItems(page: Page, type: 'success' | 'error' | 'info' | 'warning'): Locator {
  return page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
}

/** Waits for one flash item of `type` holding every text of `texts`. */
export async function expectFlash(
  page: Page,
  type: 'success' | 'error' | 'warning',
  ...texts: string[]
): Promise<void> {
  let item = flashItems(page, type);
  for (const text of texts) item = item.filter({ hasText: text });
  await expect(item, `a ${type} flash holding ${texts.map((t) => `"${t}"`).join(', ')}`).toHaveCount(1, {
    timeout: 15_000,
  });
}

/** Whether a request the page sent to the engine is the DynamoDB operation `operation`. */
export function isOperation(headers: Record<string, string>, operation: string): boolean {
  return headers['x-amz-target'] === `DynamoDB_20120810.${operation}`;
}

/** Counts the `operation` requests the page sends from now on. */
export function countRequests(page: Page, operation: string): { readonly count: number } {
  const counter = { count: 0 };
  page.on('request', (request) => {
    if (isOperation(request.headers(), operation)) counter.count += 1;
  });
  return counter;
}

/** The emulator's refusal of a request of the page, as the engine relayed it: its code and message. */
export interface Refused {
  status: number;
  code: string;
  message: string;
}

/**
 * Runs `act` and waits for the engine's answer to the page's `operation` that is a refusal; its code and message, as
 * the emulator gave them, for a comparison with what the screen shows.
 */
export async function refused(page: Page, operation: string, act: () => Promise<void>): Promise<Refused> {
  const answer = page.waitForResponse(
    (r: Response) => isOperation(r.request().headers(), operation) && r.status() >= 400,
    { timeout: 30_000 },
  );
  await act();
  const response = await answer;
  const json = (await response.json().catch(() => ({}))) as { __type?: string; message?: string; Message?: string };
  const code = (json.__type ?? response.headers()['x-amzn-errortype'] ?? '').split('#').at(-1)!.split(':')[0]!;
  return { status: response.status(), code, message: json.message ?? json.Message ?? '' };
}

/** Types `text` into the table list's search and presses Enter (the search waits for Enter). */
export async function search(page: Page, text: string): Promise<void> {
  const box = page.getByRole('searchbox', { name: SEARCH, exact: true });
  await expect(box, 'the search is enabled').toBeEnabled({ timeout: 15_000 });
  await box.fill(text, ACTION);
  await box.press('Enter', ACTION);
}

/** The parts of S1, the table list, a check acts on. */
export function listScreen(page: Page) {
  return {
    table: page.locator(TABLE).first(),
    refresh: page.getByRole('button', { name: REFRESH, exact: true }).first(),
    del: page.getByRole('button', { name: DELETE, exact: true }),
    select: (name: string) => page.getByRole('radio', { name: `Select ${name}`, exact: true }),
    link: (name: string) => page.locator(TABLE).first().getByRole('link', { name, exact: true }),
    dialog: page.getByRole('dialog'),
  };
}

/** The parts of S2, a table's page, a check acts on. */
export function tableScreen(page: Page) {
  const main = page.getByRole('main');
  const panel = page.getByRole('tabpanel');
  const dialog = page.getByRole('dialog');
  return {
    main,
    panel,
    tab: (name: string) => page.getByRole('tab', { name, exact: true }),
    /** The table of the shown tab: the items, or on "Details" the indexes. */
    table: panel.locator(TABLE).first(),
    refresh: page.getByRole('button', { name: REFRESH, exact: true }).first(),
    deleteTable: page.getByRole('button', { name: DELETE_TABLE, exact: true }),
    del: panel.getByRole('button', { name: DELETE, exact: true }),
    createItem: panel.getByRole('button', { name: CREATE_ITEM, exact: true }),
    run: panel.getByRole('button', { name: RUN, exact: true }),
    /** A choice of a segmented control: "Scan", "Query", "Ascending", "Descending". */
    choice: (name: string) => panel.getByRole('button', { name, exact: true }),
    /** A select by its field's label; Cloudscape names its trigger by the label and the option shown. */
    select: (label: string) =>
      panel.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`) }),
    option: (name: string) => page.getByRole('option', { name, exact: true }),
    field: (label: string) => panel.getByRole('textbox', { name: label, exact: true }),
    nextPage: panel.getByRole('button', { name: NEXT_PAGE, exact: true }),
    pageButton: (n: number) => panel.getByRole('button', { name: `Page ${String(n)}`, exact: true }),
    dialog,
    editor: dialog.getByRole('textbox'),
    save: dialog.getByRole('button', { name: SAVE, exact: true }),
    cancel: dialog.getByRole('button', { name: CANCEL, exact: true }),
  };
}

/** Chooses `option` in the select labelled `label` of the "Items" tab. */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  const s = tableScreen(page);
  await s.select(label).click(ACTION);
  await s.option(option).click(ACTION);
  await expect(s.select(label), `"${label}" shows ${option}`).toContainText(option);
}

/** Closes a dialog left open (a line before failed inside it), so the next line starts from the page. */
export async function closeDialog(page: Page): Promise<void> {
  const s = tableScreen(page);
  if ((await s.dialog.count()) > 0 && (await s.cancel.count()) > 0) {
    await s.cancel.click(ACTION).catch(() => undefined);
    await expect(s.dialog, 'the dialog closes').toHaveCount(0);
  }
}

/** The item the editor's text holds, parsed; fails the check when the text is not JSON. */
export async function editorItem(page: Page): Promise<Item> {
  const text = await tableScreen(page).editor.inputValue(ACTION);
  return JSON.parse(text) as Item;
}

/** Confirms the open dialog by typing `word` and choosing `action`. */
export async function confirmWith(page: Page, word: string, action: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog, 'the confirmation dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(word, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

/**
 * Reads `read` again and again until `done` holds or `boundMs` passed; every value read, in order, the same value
 * read twice in a row once. For a state that shows only for a few seconds ("Deleting", then gone).
 */
export async function seenUntil<T>(
  boundMs: number,
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<{ seen: T[]; reached: boolean }> {
  const seen: T[] = [];
  const reached = await waitFor(boundMs, async () => {
    const value = await read();
    if (JSON.stringify(seen.at(-1)) !== JSON.stringify(value)) seen.push(value);
    return done(value) ? true : undefined;
  });
  return { seen, reached: reached === true };
}
