import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// DynamoDB's table page, S2, rendered inside the area's layout as Studio's frame renders the area, against a fake
// engine behind the page's `fetch` that answers DynamoDB's JSON 1.0 protocol (issue 496, test-criteria.md, "Unit s3 —
// .../dynamodb/pages/table-page.test.tsx"), and its filter (issue 512).

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

const JSON_1_0 = 'application/x-amz-json-1.0';

interface Answer {
  status: number;
  body: unknown;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

type Handler = (body: Record<string, unknown>) => EngineAnswer | undefined;

interface Sent {
  operation: string;
  body: Record<string, unknown>;
}

function ok(body: unknown): Answer {
  return { status: 200, body };
}

function refused(status: number, code: string, message: string): Answer {
  return { status, body: { __type: `com.amazonaws.dynamodb.v20120810#${code}`, message } };
}

/** A table as `DescribeTable` gives it. */
type Description = Record<string, unknown> & { TableName: string };

class FakeEngine {
  /** The tables the emulator holds, by name. */
  tables = new Map<string, Description>();
  /** The items of each table, in the emulator's order, as the wire carries them. */
  readonly items = new Map<string, WireItem[]>();
  /** Each table's `TimeToLiveDescription`; absent is `DISABLED`. */
  readonly ttl = new Map<string, Record<string, unknown>>();
  readonly sent: Sent[] = [];
  /** A case's own answer to an operation; `undefined` from it leaves the emulator's. */
  readonly handlers = new Map<string, Handler>();

  hold(...tables: Description[]) {
    for (const table of tables) {
      this.tables.set(table.TableName, table);
    }
  }

  on(operation: string, handler: Handler) {
    this.handlers.set(operation, handler);
  }

  put(name: string, ...items: WireItem[]) {
    this.items.set(name, [...(this.items.get(name) ?? []), ...items]);
  }

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }

  /** The emulator's answer: `ListTables` in code point order, after `ExclusiveStartTableName`, `Limit` at a time. */
  private emulator(operation: string, body: Record<string, unknown>): Answer {
    const name = String(body['TableName']);
    switch (operation) {
      case 'ListTables': {
        const start = typeof body['ExclusiveStartTableName'] === 'string' ? body['ExclusiveStartTableName'] : '';
        const limit = typeof body['Limit'] === 'number' ? body['Limit'] : 100;
        const after = [...this.tables.keys()].sort().filter((each) => each > start);
        const page = after.slice(0, limit);
        const more = after.length > limit;
        return ok({ TableNames: page, ...(more ? { LastEvaluatedTableName: page.at(-1) } : {}) });
      }
      case 'DescribeTable': {
        const table = this.tables.get(name);
        return table === undefined
          ? refused(400, 'ResourceNotFoundException', `Requested resource not found: Table: ${name} not found`)
          : ok({ Table: table });
      }
      case 'DescribeTimeToLive': {
        return this.tables.has(name)
          ? ok({ TimeToLiveDescription: this.ttl.get(name) ?? { TimeToLiveStatus: 'DISABLED' } })
          : refused(400, 'ResourceNotFoundException', `Requested resource not found: Table: ${name} not found`);
      }
      case 'Scan':
      case 'Query': {
        const table = this.tables.get(name);
        if (table === undefined) {
          return refused(400, 'ResourceNotFoundException', `Requested resource not found: Table: ${name} not found`);
        }
        let items = this.items.get(name) ?? [];
        if (operation === 'Query') {
          const names = body['ExpressionAttributeNames'] as Record<string, string>;
          const values = body['ExpressionAttributeValues'] as Record<string, unknown>;
          const partition = names['#pk'] ?? '';
          items = items.filter((item) => JSON.stringify(item[partition]) === JSON.stringify(values[':pk']));
        }
        return ok(page(items, table, body));
      }
      case 'DeleteTable': {
        const table = this.tables.get(name);
        if (table === undefined) {
          return refused(400, 'ResourceNotFoundException', `Requested resource not found: Table: ${name} not found`);
        }
        this.tables.delete(name);
        return ok({ TableDescription: { ...table, TableStatus: 'DELETING' } });
      }
      default:
        return ok({});
    }
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-496' }), { status: 200 });
    }
    const operation = (request.headers.get('x-amz-target') ?? '').replace('DynamoDB_20120810.', '');
    const body = JSON.parse((await request.text()) || '{}') as Record<string, unknown>;
    this.sent.push({ operation, body });
    const own = this.handlers.get(operation)?.(body);
    const answer = await Promise.race([
      Promise.resolve(own ?? this.emulator(operation, body)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': JSON_1_0 } });
  };
}

/** An item as the wire carries it: attribute values by name, a binary value as base64. */
type WireItem = Record<string, Record<string, unknown>>;

/** The key of `item` by the key attributes of `table`. */
function keyOf(item: WireItem, table: Description): WireItem {
  const schema = table['KeySchema'] as { AttributeName: string }[];
  return Object.fromEntries(schema.map(({ AttributeName }) => [AttributeName, item[AttributeName] ?? {}]));
}

/**
 * A page of `items` as the emulator gives it: `Limit` items after `ExclusiveStartKey`, and a `LastEvaluatedKey` on a
 * page of `Limit` items, even when nothing follows (probe-3 §3).
 */
function page(items: WireItem[], table: Description, body: Record<string, unknown>): Record<string, unknown> {
  const limit = typeof body['Limit'] === 'number' ? body['Limit'] : 100;
  const start = body['ExclusiveStartKey'] as WireItem | undefined;
  const from =
    start === undefined
      ? 0
      : items.findIndex((item) => JSON.stringify(keyOf(item, table)) === JSON.stringify(start)) + 1;
  const shown = items.slice(from, from + limit);
  const last = shown.at(-1);
  return {
    Items: shown,
    Count: shown.length,
    ...(shown.length === limit && last !== undefined ? { LastEvaluatedKey: keyOf(last, table) } : {}),
  };
}

const ARN = 'arn:aws:dynamodb:us-east-1:000000000000:table';

/** An active on-demand table keyed by `pk` (S), with what `extra` adds or replaces. */
function table(name: string, extra: Record<string, unknown> = {}): Description {
  return {
    TableName: name,
    TableStatus: 'ACTIVE',
    TableArn: `${ARN}/${name}`,
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
    BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
    ...extra,
  };
}

const ORDERS = table('orders', {
  KeySchema: [
    { AttributeName: 'customer', KeyType: 'HASH' },
    { AttributeName: 'placed', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'customer', AttributeType: 'S' },
    { AttributeName: 'placed', AttributeType: 'N' },
    { AttributeName: 'status', AttributeType: 'S' },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'by-status',
      KeySchema: [{ AttributeName: 'status', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
      IndexStatus: 'ACTIVE',
    },
  ],
  LocalSecondaryIndexes: [
    {
      IndexName: 'by-status-local',
      KeySchema: [
        { AttributeName: 'customer', KeyType: 'HASH' },
        { AttributeName: 'status', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'KEYS_ONLY' },
    },
  ],
});

const USERS = table('users', {
  BillingModeSummary: undefined,
  ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 7 },
  DeletionProtectionEnabled: true,
});

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  set(result: CheckResult | undefined) {
    this.value = { ...this.value, result };
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

const EMULATOR_PORT = 9306;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

function notStartedResult(): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT },
    reason: 'not_started',
    message: '',
  };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9600;
let engine: FakeEngine;
let connection: Connection;
let engineOrigin: string;

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', matchMedia);
  nextPort += 1;
  engineOrigin = engineEndpoint(nextPort);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = '/aws/dynamodb/tables/table/orders') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function announced(): string[] {
  return [...document.querySelectorAll('.aws-area-announcer')].map(text);
}

function h1(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

function headerButton(name: string): HTMLElement {
  return within(h1().closest('header') ?? document.body).getByRole('button', { name });
}

/** The content of the tab shown. */
function tabContent(): HTMLElement {
  const found = PAGE.findTabs()?.findTabContent()?.getElement();
  expect(found).toBeDefined();
  return found as HTMLElement;
}

function showTab(id: 'items' | 'details') {
  PAGE.findTabs()?.findTabLinkById(id)?.click();
}

/** "Table details" as label and value text, in their order. */
function details(): [string, string][] {
  const pairs = createWrapper(tabContent()).findKeyValuePairs();
  return (pairs?.findItems() ?? []).map((item) => [
    text(item.findLabel()?.getElement() ?? document.createElement('i')),
    text(item.findValue()?.getElement() ?? document.createElement('i')),
  ]);
}

function itemsTable() {
  const found = createWrapper(tabContent()).findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

/** The data rows' cells as text, in the columns' order, a selection cell left out. */
function cellsOf(found: ReturnType<typeof itemsTable>): string[][] {
  return (found.findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].filter((cell) => cell.querySelector('input') === null).map(text),
  );
}

/** The column headers as text, a selection column's left out. */
function headersOf(found: ReturnType<typeof itemsTable>): string[] {
  return (found.findColumnHeaders() ?? [])
    .map((each) => each.getElement())
    .filter((header) => header.querySelector('input') === null)
    .map(text);
}

/** The first cell of each row of the items. */
function firstCells(): string[] {
  return cellsOf(itemsTable()).map((row) => row[0] ?? '');
}

async function expectFirstCells(expected: string[]) {
  await waitFor(() => {
    expect(firstCells()).toEqual(expected);
  });
}

function slot(): HTMLElement {
  const found = itemsTable().findEmptySlot()?.getElement();
  expect(found).toBeDefined();
  return found as HTMLElement;
}

function field(label: string) {
  const found = PAGE.findAllFormFields().find(
    (each) => text(each.findLabel()?.getElement() ?? document.body) === label,
  );
  expect(found, `the field "${label}"`).toBeDefined();
  return found as NonNullable<typeof found>;
}

function fieldLabels(): string[] {
  return createWrapper(tabContent())
    .findAllFormFields()
    .map((each) => text(each.findLabel()?.getElement() ?? document.createElement('i')))
    .filter((label) => label !== '');
}

function type(label: string, value: string) {
  field(label).findControl()?.findInput()?.setInputValue(value);
}

function choose(label: string, value: string) {
  const select = field(label).findControl()?.findSelect();
  expect(select).toBeDefined();
  select?.openDropdown();
  select?.selectOptionByValue(value);
}

function optionsOf(label: string): string[] {
  const select = field(label).findControl()?.findSelect();
  select?.openDropdown();
  const options = (select?.findDropdown().findOptions() ?? []).map((option) => text(option.getElement()));
  select?.closeDropdown();
  return options;
}

function segment(name: string) {
  fireEvent.click(within(tabContent()).getByRole('button', { name }));
}

function run() {
  fireEvent.click(within(tabContent()).getByRole('button', { name: 'Run' }));
}

function errorOf(label: string): string {
  return text(field(label).findError()?.getElement() ?? document.createElement('i'));
}

function nextPage(): HTMLButtonElement {
  return itemsTable().findPagination()?.findNextPageButton().getElement() as HTMLButtonElement;
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------------------------------------------

/** A table with a Binary partition key `id` and a Binary sort key `part`. */
const BLOBS = table('blobs', {
  KeySchema: [
    { AttributeName: 'id', KeyType: 'HASH' },
    { AttributeName: 'part', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'id', AttributeType: 'B' },
    { AttributeName: 'part', AttributeType: 'B' },
  ],
});

/** An order of `customer` placed at `placed`, with what `extra` adds. */
function order(customer: string, placed: number, extra: WireItem = {}): WireItem {
  return { customer: { S: customer }, placed: { N: String(placed) }, ...extra };
}

async function openTable(description: Description = ORDERS, items: WireItem[] = []) {
  engine.hold(description);
  engine.put(description.TableName, ...items);
  const opened = open(`/aws/dynamodb/tables/table/${encodeURIComponent(description.TableName)}`);
  await waitFor(() => {
    expect(engine.of('Scan')).toHaveLength(1);
  });
  await waitFor(() => {
    expect(itemsTable().findLoadingText()).toBeNull();
  });
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------

describe('the header and the notice', () => {
  it('the h1 is the name, with "Refresh" and "Delete table"; the crumbs; the notice names "tables"', async () => {
    await openTable();

    expect(text(h1())).toBe('orders');
    expect(headerButton('Refresh')).toBeInTheDocument();
    expect(headerButton('Delete table')).toBeInTheDocument();
    const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) => text(crumb.getElement()));
    expect(crumbs).toEqual(['EmuForge', 'AWS', 'DynamoDB', 'Tables', 'orders']);
    expect(screen.getByText('These tables are in your local emulator')).toBeInTheDocument();
  });

  it('"Refresh" reads the table and the shown page of items again, and announces "Table refreshed"', async () => {
    await openTable(ORDERS, [order('c1', 1)]);
    await expectFirstCells(['S c1']);
    engine.put('orders', order('c2', 2));

    fireEvent.click(headerButton('Refresh'));

    await expectFirstCells(['S c1', 'S c2']);
    await waitFor(() => {
      expect(announced()).toContain('Table refreshed');
    });
    expect(engine.of('DescribeTable')).toHaveLength(2);
    expect(engine.of('DescribeTimeToLive')).toHaveLength(2);
    expect(engine.of('Scan').map((sent) => sent.body)).toEqual([
      { TableName: 'orders', Limit: 25 },
      { TableName: 'orders', Limit: 25 },
    ]);
  });
});

describe('"Details"', () => {
  it('every row from DescribeTable and DescribeTimeToLive', async () => {
    engine.ttl.set('orders', { TimeToLiveStatus: 'ENABLED', AttributeName: 'expires' });
    await openTable({
      ...ORDERS,
      DeletionProtectionEnabled: true,
      StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
      CreationDateTime: 1_763_510_400,
    });

    showTab('details');

    await waitFor(() => {
      expect(details().map(([label]) => label)).toEqual([
        'Status',
        'Partition key',
        'Sort key',
        'Capacity mode',
        'Deletion protection',
        'Time to live',
        'Stream',
        'Creation date',
        'ARN',
      ]);
    });
    const shown = Object.fromEntries(details());
    expect(shown).toMatchObject({
      Status: 'Active',
      'Partition key': 'customer (S)',
      'Sort key': 'placed (N)',
      'Capacity mode': 'On-demand',
      'Deletion protection': 'On',
      'Time to live': 'On: expires',
      Stream: 'On: NEW_AND_OLD_IMAGES',
      ARN: `${ARN}/orders`,
    });
    expect(shown['Creation date']).toMatch(/2025/);
    expect(within(tabContent()).getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    expect(text(tabContent())).not.toMatch(/item count|size/i);
  });

  it('a provisioned table without a sort key, time to live turning on, no stream', async () => {
    engine.ttl.set('users', { TimeToLiveStatus: 'ENABLING', AttributeName: 'ttl' });
    await openTable(USERS);

    showTab('details');

    await waitFor(() => {
      expect(Object.fromEntries(details())).toMatchObject({
        'Sort key': '-',
        'Capacity mode': 'Provisioned (5 read, 7 write)',
        'Deletion protection': 'On',
        'Time to live': 'Turning on: ttl',
        Stream: 'Off',
      });
    });
  });

  it('DescribeTimeToLive failing: Time to live "Not read", the rest shown', async () => {
    engine.on('DescribeTimeToLive', () => refused(500, 'InternalServerError', 'boom'));
    await openTable();

    showTab('details');

    await waitFor(() => {
      expect(Object.fromEntries(details())).toMatchObject({
        Status: 'Active',
        'Partition key': 'customer (S)',
        'Time to live': 'Not read',
      });
    });
  });

  it('"Indexes": one row per index with its type, keys, projection and status', async () => {
    await openTable();

    showTab('details');

    await waitFor(() => {
      expect(headersOf(itemsTable())).toEqual(['Name', 'Type', 'Partition key', 'Sort key', 'Projection', 'Status']);
    });
    expect(cellsOf(itemsTable())).toEqual([
      ['by-status', 'Global', 'status (S)', '-', 'All', 'Active'],
      ['by-status-local', 'Local', 'customer (S)', 'status (S)', 'Keys only', '-'],
    ]);
  });

  it('no index: "No indexes" with its text', async () => {
    await openTable(USERS);

    showTab('details');

    await waitFor(() => {
      expect(text(slot())).toContain('No indexes');
    });
    expect(text(slot())).toContain('users has no secondary indexes.');
  });
});

describe('a table that cannot be read', () => {
  it('no such table: "No table named {name}", its text and a link to the tables; no "Delete table"', async () => {
    open('/aws/dynamodb/tables/table/gone');

    await waitFor(() => {
      expect(document.body.textContent).toContain('No table named gone');
    });
    expect(document.body.textContent).toContain(
      'The emulator holds no table named gone. It may have been deleted, or the emulator restarted.',
    );
    const content = PAGE.findContentLayout()?.getElement() as HTMLElement;
    expect(within(content).getByRole('link', { name: 'Tables' })).toHaveAttribute('href', '/aws/dynamodb/tables');
    expect(within(h1().closest('header') ?? document.body).queryByRole('button', { name: 'Delete table' })).toBeNull();
    expect(engine.of('Scan')).toHaveLength(0);
  });

  it.each([
    ['too short', 'ab'],
    ['with a space', 'my table'],
    ['too long', 'a'.repeat(256)],
  ])('a name %s: the same, and nothing sent', async (_, name) => {
    open(`/aws/dynamodb/tables/table/${encodeURIComponent(name)}`);

    await waitFor(() => {
      expect(document.body.textContent).toContain(`No table named ${name}`);
    });
    expect(engine.sent).toEqual([]);
  });

  async function expectState(lines: string[]) {
    await waitFor(() => {
      for (const line of lines) {
        expect(document.body.textContent).toContain(line);
      }
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  }

  it('HTTP 501: "Not implemented by the emulator" naming DescribeTable', async () => {
    engine.hold(ORDERS);
    engine.on('DescribeTable', () => ({ status: 501, body: { __type: 'NotImplemented', message: 'not here' } }));
    open();

    await expectState([
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for DescribeTable, so Studio cannot show the table.',
    ]);
    await waitFor(() => {
      expect(announced()).toContain('Not implemented by the emulator');
    });
  });

  it('AccessDeniedException: "Access denied" with the reason returned', async () => {
    engine.hold(ORDERS);
    engine.on('DescribeTable', () => refused(403, 'AccessDeniedException', 'no describe'));
    open();

    await expectState(['Access denied', 'DescribeTable was refused: no describe']);
  });

  it('the emulator did not answer', async () => {
    engine.hold(ORDERS);
    engine.on('DescribeTable', () => refused(504, 'EmulatorTimeout', 'the emulator did not answer in time'));
    open();

    await expectState(['The emulator did not answer', 'the emulator did not answer in time']);
  });

  it('the engine did not answer', async () => {
    engine.hold(ORDERS);
    engine.on('DescribeTable', () => 'network-error');
    open();

    await expectState([`The EmuForge engine at ${engineOrigin} did not answer`]);
  });

  it('any other failure: "The table could not be read" with code and message as they came', async () => {
    engine.hold(ORDERS);
    engine.on('DescribeTable', () => refused(500, 'InternalServerError', 'boom'));
    open();

    await expectState(['The table could not be read', 'InternalServerError: boom']);
  });

  it('not connected: the emulator line’s words and "Connection status"; connected again, read again', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    let fail = true;
    engine.hold(ORDERS);
    engine.on('DescribeTable', () => (fail ? refused(500, 'InternalServerError', 'boom') : undefined));
    open();
    await expectState([`Not started on port ${String(EMULATOR_PORT)}`, 'The table could not be read.']);
    expect(
      screen.getAllByRole('link', { name: 'Connection status' }).map((link) => link.getAttribute('href')),
    ).toContain('/');

    fail = false;
    connection.set(connectedResult());

    await waitFor(() => {
      expect(engine.of('Scan')).toHaveLength(1);
    });
  });

  it('the connection down and back while the table is shown: read again, and gone → "No table named"', async () => {
    await openTable();
    connection.set(notStartedResult());
    engine.tables.clear();

    connection.set(connectedResult());

    await waitFor(() => {
      expect(document.body.textContent).toContain('No table named orders');
    });
  });
});

describe('"Items" while the table changes', () => {
  it.each([
    ['CREATING', 'The table is being created. Its items can be read once it is active.'],
    ['DELETING', 'The table is being deleted.'],
  ])('%s: the sentence, and no read of items', async (status, sentence) => {
    engine.hold(table('fresh', { TableStatus: status }));
    open('/aws/dynamodb/tables/table/fresh');

    await waitFor(() => {
      expect(text(tabContent())).toBe(sentence);
    });
    expect(engine.of('Scan')).toHaveLength(0);
  });

  it('UPDATING: its items are read', async () => {
    engine.hold(table('busy', { TableStatus: 'UPDATING' }));
    open('/aws/dynamodb/tables/table/busy');

    await waitFor(() => {
      expect(engine.of('Scan').map((sent) => sent.body)).toEqual([{ TableName: 'busy', Limit: 25 }]);
    });
  });

  it('ACTIVE reached by the re-reading: the first scan starts by itself', async () => {
    engine.hold(table('fresh', { TableStatus: 'CREATING' }));
    open('/aws/dynamodb/tables/table/fresh');
    await waitFor(() => {
      expect(text(tabContent())).toContain('The table is being created.');
    });
    engine.hold(table('fresh'));

    await waitFor(
      () => {
        expect(engine.of('Scan').map((sent) => sent.body)).toEqual([{ TableName: 'fresh', Limit: 25 }]);
      },
      { timeout: 4000 },
    );
    await waitFor(() => {
      expect(text(slot())).toContain('No items');
    });
  });
});

describe('the request', () => {
  it('opening an active table: one scan of the table, 25 items', async () => {
    await openTable();

    expect(engine.of('Scan').map((sent) => sent.body)).toEqual([{ TableName: 'orders', Limit: 25 }]);
    expect(engine.of('Query')).toHaveLength(0);
    expect(text(itemsTable().findHeaderSlot()?.getElement() as HTMLElement)).toContain('Scan of orders');
  });

  it('"Query": the key fields of the table, "{key} ({type name})"', async () => {
    await openTable();

    segment('Query');

    expect(fieldLabels()).toEqual(['Read', 'Table or index', 'customer (String)', 'Sort key condition', 'Order']);
    choose('Sort key condition', '=');
    expect(fieldLabels()).toContain('placed (Number)');
    choose('Sort key condition', 'between');
    expect(fieldLabels()).toContain('placed (Number), upper bound');
  });

  it('the table and its indexes to choose from; an index’s own key fields', async () => {
    await openTable();
    segment('Query');

    expect(optionsOf('Table or index')).toEqual([
      'orders (table)',
      'by-status (global index)',
      'by-status-local (local index)',
    ]);
    choose('Table or index', 'by-status');
    expect(fieldLabels()).toEqual(['Read', 'Table or index', 'status (String)', 'Order']);
    choose('Table or index', 'by-status-local');
    expect(fieldLabels()).toEqual(['Read', 'Table or index', 'customer (String)', 'Sort key condition', 'Order']);
  });

  it('"Begins with" on a String or Binary sort key only', async () => {
    await openTable();
    segment('Query');

    expect(optionsOf('Sort key condition')).not.toContain('Begins with');
    choose('Table or index', 'by-status-local');
    expect(optionsOf('Sort key condition')).toEqual([
      'Any',
      'Equal to',
      'Less than',
      'Less than or equal to',
      'Greater than',
      'Greater than or equal to',
      'Between',
      'Begins with',
    ]);
  });

  it('"Begins with" on a Binary sort key, sent with the bytes of its base64', async () => {
    await openTable(BLOBS);
    segment('Query');
    expect(optionsOf('Sort key condition')).toContain('Begins with');

    type('id (Binary)', 'AAH+/w==');
    choose('Sort key condition', 'begins_with');
    type('part (Binary)', 'AQI=');
    run();

    await waitFor(() => {
      expect(engine.of('Query')).toHaveLength(1);
    });
    expect(engine.of('Query')[0]?.body).toEqual({
      TableName: 'blobs',
      Limit: 25,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk1)',
      ExpressionAttributeNames: { '#pk': 'id', '#sk': 'part' },
      ExpressionAttributeValues: { ':pk': { B: 'AAH+/w==' }, ':sk1': { B: 'AQI=' } },
    });
  });

  it('a query of an index, between two values, descending', async () => {
    await openTable();
    segment('Query');
    choose('Table or index', 'by-status-local');
    type('customer (String)', 'c1');
    choose('Sort key condition', 'between');
    type('status (String)', 'a');
    type('status (String), upper bound', 'm');
    segment('Descending');

    run();

    await waitFor(() => {
      expect(engine.of('Query')).toHaveLength(1);
    });
    expect(engine.of('Query')[0]?.body).toEqual({
      TableName: 'orders',
      IndexName: 'by-status-local',
      Limit: 25,
      KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :sk1 AND :sk2',
      ExpressionAttributeNames: { '#pk': 'customer', '#sk': 'status' },
      ExpressionAttributeValues: { ':pk': { S: 'c1' }, ':sk1': { S: 'a' }, ':sk2': { S: 'm' } },
      ScanIndexForward: false,
    });
    expect(text(itemsTable().findHeaderSlot()?.getElement() as HTMLElement)).toContain('Query of by-status-local');
  });

  it('an empty partition key value: "Enter a value for {name}.", nothing sent', async () => {
    await openTable();
    segment('Query');

    run();

    expect(errorOf('customer (String)')).toBe('Enter a value for customer.');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.of('Query')).toHaveLength(0);
    expect(engine.of('Scan')).toHaveLength(1);
  });

  it('a Binary value not base64: "Enter the value in base64.", nothing sent', async () => {
    await openTable(BLOBS);
    segment('Query');

    type('id (Binary)', 'not base64!');
    run();

    expect(errorOf('id (Binary)')).toBe('Enter the value in base64.');
    choose('Sort key condition', '=');
    type('id (Binary)', 'AAE=');
    type('part (Binary)', 'AQ');
    run();
    expect(errorOf('id (Binary)')).toBe('');
    expect(errorOf('part (Binary)')).toBe('Enter the value in base64.');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.of('Query')).toHaveLength(0);
  });

  it('changing a field reads nothing', async () => {
    await openTable();

    segment('Query');
    type('customer (String)', 'c1');
    choose('Table or index', 'by-status');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.of('Query')).toHaveLength(0);
    expect(engine.of('Scan')).toHaveLength(1);
  });
});

describe('pages', () => {
  const THIRTY = Array.from({ length: 30 }, (_, index) => order(`c${String(index + 1).padStart(2, '0')}`, index));

  it('"Run" reads page 1; "next page" with the last key; after page 1 a page of none: "No more items"', async () => {
    await openTable(ORDERS, THIRTY.slice(0, 25));
    await waitFor(() => {
      expect(firstCells()).toHaveLength(25);
    });
    await waitFor(() => {
      expect(isDisabled(nextPage())).toBe(false);
    });

    fireEvent.click(nextPage());

    await waitFor(() => {
      expect(text(slot())).toBe('No more items');
    });
    expect(engine.of('Scan').at(-1)?.body).toEqual({
      TableName: 'orders',
      Limit: 25,
      ExclusiveStartKey: { customer: { S: 'c25' }, placed: { N: '24' } },
    });
    expect(isDisabled(nextPage())).toBe(true);
  });

  it('a second page, back to page 1, and "Run" starts again at page 1', async () => {
    await openTable(ORDERS, THIRTY);
    await waitFor(() => {
      expect(isDisabled(nextPage())).toBe(false);
    });

    fireEvent.click(nextPage());
    await expectFirstCells(THIRTY.slice(25).map((item) => `S ${item['customer']?.['S'] as string}`));

    itemsTable().findPagination()?.findPageNumberByIndex(1)?.click();
    await waitFor(() => {
      expect(firstCells()).toHaveLength(25);
    });
    expect(engine.of('Scan').at(-1)?.body).toEqual({ TableName: 'orders', Limit: 25 });

    fireEvent.click(nextPage());
    await waitFor(() => {
      expect(firstCells()).toHaveLength(5);
    });
    run();
    await waitFor(() => {
      expect(firstCells()).toHaveLength(25);
    });
    expect(engine.of('Scan').at(-1)?.body).toEqual({ TableName: 'orders', Limit: 25 });
    expect(itemsTable().findPagination()?.findCurrentPage()?.getElement().textContent).toBe('1');
  });

  it('"Items per page" 50 reads page 1 again with Limit 50', async () => {
    await openTable(ORDERS, THIRTY);
    const preferences = itemsTable().findCollectionPreferences();
    expect(preferences).not.toBeNull();
    preferences?.findTriggerButton().click();
    const modal = await waitFor(() => {
      const found = preferences?.findModal();
      expect(found).toBeDefined();
      expect(found).not.toBeNull();
      return found as NonNullable<typeof found>;
    });
    fireEvent.click(within(modal.getElement()).getByRole('radio', { name: '50 items' }));
    modal.findConfirmButton()?.click();

    await waitFor(() => {
      expect(firstCells()).toHaveLength(30);
    });
    expect(engine.of('Scan').at(-1)?.body).toEqual({ TableName: 'orders', Limit: 50 });
  });

  it('the first page of none: "No items" for a scan, "No matching items" for a query', async () => {
    await openTable();
    await waitFor(() => {
      expect(text(slot())).toContain('No items');
    });
    expect(text(slot())).toContain('orders holds no items. Create one here, or with any tool pointed at the emulator.');

    segment('Query');
    type('customer (String)', 'nobody');
    run();

    await waitFor(() => {
      expect(text(slot())).toContain('No matching items');
    });
    expect(text(slot())).toContain('No item of orders matches this query.');
  });
});

describe('the result', () => {
  it('columns: the keys, then the page’s other names in code point order; an absent attribute an empty cell', async () => {
    await openTable(ORDERS, [
      order('c1', 1, { b: { B: 'aGVsbG8=' }, Zed: { BOOL: true }, a: { S: 'x' } }),
      order('c2', 2, { nul: { NULL: true }, ss: { SS: ['a', 'b'] }, m: { M: { k: { N: '1' } } } }),
    ]);
    await expectFirstCells(['S c1', 'S c2']);

    expect(headersOf(itemsTable())).toEqual(['customer', 'placed', 'Zed', 'a', 'b', 'm', 'nul', 'ss']);
    expect(cellsOf(itemsTable())).toEqual([
      ['S c1', 'N 1', 'BOOL true', 'S x', 'B aGVsbG8=', '', '', ''],
      ['S c2', 'N 2', '', '', '', 'M {"k":{"N":"1"}}', 'NULL null', 'SS ["a","b"]'],
    ]);
    expect(text(itemsTable().findHeaderSlot()?.getElement() as HTMLElement)).toContain('(2)');
  });

  it('a value from the emulator is text, never HTML', async () => {
    await openTable(ORDERS, [order('<b>bold</b>', 1)]);

    await expectFirstCells(['S <b>bold</b>']);
    expect(tabContent().querySelector('b')).toBeNull();
  });
});

describe('a failed read of items', () => {
  async function expectState(lines: string[]) {
    await waitFor(() => {
      const shown = text(slot());
      for (const line of lines) {
        expect(shown).toContain(line);
      }
    });
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  }

  it('HTTP 501: "Not implemented by the emulator" naming Scan, in the result’s place', async () => {
    engine.on('Scan', () => ({ status: 501, body: { __type: 'NotImplemented', message: 'not here' } }));
    engine.hold(ORDERS);
    open();

    await expectState([
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for Scan, so Studio cannot show the items.',
    ]);
  });

  it('AccessDeniedException on a query: "Access denied" with the reason; the request fields kept', async () => {
    await openTable();
    engine.on('Query', () => refused(403, 'AccessDeniedException', 'no query'));
    segment('Query');
    type('customer (String)', 'c1');

    run();

    await expectState(['Access denied', 'Query was refused: no query']);
    expect(field('customer (String)').findControl()?.findInput()?.getInputValue()).toBe('c1');
  });

  it('a refusal: "The items could not be read" with code and message; "Retry" reads again', async () => {
    let fail = true;
    engine.on('Scan', () =>
      fail ? refused(400, 'ValidationException', 'The BETWEEN operator requires upper bound to be greater') : undefined,
    );
    await openTable(ORDERS, [order('c1', 1)]);
    await expectState([
      'The items could not be read',
      'ValidationException: The BETWEEN operator requires upper bound to be greater',
    ]);

    fail = false;
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));

    await expectFirstCells(['S c1']);
  });
});

describe('"Delete table"', () => {
  it('confirmed: one DeleteTable, then the tables with "Table orders is being deleted."', async () => {
    const { router } = await openTable();

    fireEvent.click(headerButton('Delete table'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'orders' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/dynamodb/tables');
    });
    expect(engine.of('DeleteTable').map((sent) => sent.body)).toEqual([{ TableName: 'orders' }]);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Table orders is being deleted.');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The filter (issue 512, test-criteria.md "Unit s1 — .../dynamodb/pages/table-page.test.tsx").
// ---------------------------------------------------------------------------------------------------------------

function addCondition() {
  fireEvent.click(within(tabContent()).getByRole('button', { name: 'Add condition' }));
}

function conditionInput(label: string): HTMLInputElement {
  return within(tabContent()).getByRole('textbox', { name: label });
}

function typeCondition(label: string, value: string) {
  fireEvent.change(conditionInput(label), { target: { value } });
}

/** An element's name from its `aria-labelledby`. */
function labelledName(element: Element): string {
  return (element.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => text(document.getElementById(id) ?? document.createElement('i')))
    .join(' ');
}

/** A condition's select, by its field's label and its row ("Comparison, condition 1"). */
function conditionSelect(label: string) {
  const name = `${label.replace(', ', ' ')} `;
  const found = createWrapper(tabContent())
    .findAllSelects()
    .find((each) => labelledName(each.findTrigger().getElement()).startsWith(name));
  expect(found, `the select "${label}"`).toBeDefined();
  return found as NonNullable<typeof found>;
}

function chooseCondition(label: string, value: string) {
  const found = conditionSelect(label);
  found.openDropdown();
  found.selectOptionByValue(value);
}

/** The result's heading, its counter included. */
function heading(): string {
  return text(within(itemsTable().findHeaderSlot()?.getElement() as HTMLElement).getByRole('heading', { level: 2 }));
}

function headerText(): string {
  return text(itemsTable().findHeaderSlot()?.getElement() as HTMLElement);
}

/** A filtered page's answer: `items`, the number read, and a last key when more remain. */
function filteredPage(items: WireItem[], read: number, next?: WireItem): Answer {
  return ok({
    Items: items,
    Count: items.length,
    ScannedCount: read,
    ...(next === undefined ? {} : { LastEvaluatedKey: next }),
  });
}

/** Answers every filtered `operation` with `answer`, and every unfiltered one as the emulator. */
function onFiltered(operation: string, answer: (body: Record<string, unknown>) => EngineAnswer) {
  engine.on(operation, (body) => ('FilterExpression' in body ? answer(body) : undefined));
}

const C1 = order('c1', 1, { status: { S: 'open' } });
const C2 = order('c2', 2, { status: { S: 'closed' } });

describe('the filter', () => {
  it('conditions added and not run: the request sent before, the heading and the rows unchanged', async () => {
    await openTable(ORDERS, [C1, C2]);
    await expectFirstCells(['S c1', 'S c2']);

    addCondition();
    typeCondition('Attribute name, condition 1', 'status');
    typeCondition('Value, condition 1', 'open');
    chooseCondition('Comparison, condition 1', '<>');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.of('Scan').map((sent) => sent.body)).toEqual([{ TableName: 'orders', Limit: 25 }]);
    expect(heading()).toBe('Scan of orders (2)');
    expect(firstCells()).toEqual(['S c1', 'S c2']);
  });

  it('"Run" with an empty name or a Binary value not base64: the message under its field, nothing sent; with a query\'s empty partition key both messages', async () => {
    await openTable();
    addCondition();
    run();
    expect(text(tabContent())).toContain('Enter an attribute name.');

    typeCondition('Attribute name, condition 1', 'bin');
    chooseCondition('Type, condition 1', 'B');
    typeCondition('Value, condition 1', 'not base64!');
    run();
    expect(text(tabContent())).not.toContain('Enter an attribute name.');
    expect(text(tabContent())).toContain('Enter the value in base64.');

    segment('Query');
    typeCondition('Attribute name, condition 1', '');
    run();
    expect(errorOf('customer (String)')).toBe('Enter a value for customer.');
    expect(text(tabContent())).toContain('Enter an attribute name.');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.of('Scan')).toHaveLength(1);
    expect(engine.of('Query')).toHaveLength(0);
  });

  it('"Run" with one condition, then two: the filtered heading; for a query "Query of"; for an index its name', async () => {
    await openTable(ORDERS, [C1, C2]);
    onFiltered('Scan', () => filteredPage([C1], 2));
    onFiltered('Query', () => filteredPage([C1], 1));

    addCondition();
    typeCondition('Attribute name, condition 1', 'status');
    typeCondition('Value, condition 1', 'open');
    run();
    await waitFor(() => {
      expect(heading()).toBe('Scan of orders, filtered by 1 condition (1)');
    });
    expect(engine.of('Scan').at(-1)?.body).toEqual({
      TableName: 'orders',
      Limit: 25,
      FilterExpression: '#f0 = :f0',
      ExpressionAttributeNames: { '#f0': 'status' },
      ExpressionAttributeValues: { ':f0': { S: 'open' } },
    });

    addCondition();
    typeCondition('Attribute name, condition 2', 'total');
    chooseCondition('Comparison, condition 2', 'exists');
    run();
    await waitFor(() => {
      expect(heading()).toBe('Scan of orders, filtered by 2 conditions (1)');
    });

    segment('Query');
    type('customer (String)', 'c1');
    run();
    await waitFor(() => {
      expect(heading()).toBe('Query of orders, filtered by 2 conditions (1)');
    });
    expect(engine.of('Query').at(-1)?.body).toEqual({
      TableName: 'orders',
      Limit: 25,
      KeyConditionExpression: '#pk = :pk',
      FilterExpression: '#f0 = :f0 AND attribute_exists(#f1)',
      ExpressionAttributeNames: { '#pk': 'customer', '#f0': 'status', '#f1': 'total' },
      ExpressionAttributeValues: { ':pk': { S: 'c1' }, ':f0': { S: 'open' } },
    });

    segment('Scan');
    choose('Table or index', 'by-status');
    run();
    await waitFor(() => {
      expect(heading()).toBe('Scan of by-status, filtered by 2 conditions (1)');
    });
    expect(engine.of('Scan').at(-1)?.body).toMatchObject({
      IndexName: 'by-status',
      FilterExpression: expect.any(String),
    });
  });

  it('a page of items under a filter: "{read} items read, {matched} match the filter."; at one, the singulars; without a filter no such line', async () => {
    await openTable(ORDERS, [C1, C2]);
    expect(headerText()).not.toContain('match the filter');
    let answer = filteredPage([C1, C2], 25, { customer: { S: 'c2' }, placed: { N: '2' } });
    onFiltered('Scan', () => answer);

    addCondition();
    typeCondition('Attribute name, condition 1', 'status');
    run();
    await waitFor(() => {
      expect(headerText()).toContain('25 items read, 2 match the filter.');
    });

    answer = filteredPage([C1], 1);
    run();
    await waitFor(() => {
      expect(headerText()).toContain('1 item read, 1 matches the filter.');
    });
  });

  describe('under a filter, a page of none', () => {
    const LAST = { customer: { S: 'c9' }, placed: { N: '9' } };

    async function filtered(answers: Answer[], query = false) {
      await openTable();
      let at = 0;
      onFiltered(query ? 'Query' : 'Scan', () => answers[Math.min(at++, answers.length - 1)] as Answer);
      if (query) {
        segment('Query');
        type('customer (String)', 'c1');
      }
      addCondition();
      typeCondition('Attribute name, condition 1', 'status');
      run();
    }

    async function expectSlot(lines: string[], absent: string[] = []) {
      await waitFor(() => {
        for (const line of lines) {
          expect(text(slot())).toContain(line);
        }
      });
      for (const line of absent) {
        expect(text(slot())).not.toContain(line);
      }
      expect(headerText()).not.toContain('match the filter');
    }

    it('a last key: "No matching items on this page" with the number read, next page available; at one the singular', async () => {
      await filtered([filteredPage([], 25, LAST), filteredPage([], 1, LAST)]);
      await expectSlot([
        'No matching items on this page',
        'None of the 25 items this page read matches the filter. More items remain: go to the next page.',
      ]);
      expect(isDisabled(nextPage())).toBe(false);

      fireEvent.click(nextPage());
      await expectSlot([
        'No matching items on this page',
        'The 1 item this page read does not match the filter. More items remain: go to the next page.',
      ]);
      expect(engine.of('Scan').at(-1)?.body).toMatchObject({ ExclusiveStartKey: LAST, FilterExpression: '#f0 = :f0' });
      expect(isDisabled(nextPage())).toBe(false);
    });

    it('no key on page 1 of a scan: "No item of {target} matches the filter."', async () => {
      await filtered([filteredPage([], 10)]);
      await expectSlot(['No matching items', 'No item of orders matches the filter.'], ['on this page']);
      expect(isDisabled(nextPage())).toBe(true);
    });

    it('no key on page 1 of a query: "No item of {target} matches this query and its filter."', async () => {
      await filtered([filteredPage([], 6)], true);
      await expectSlot(['No matching items', 'No item of orders matches this query and its filter.']);
    });

    it('no key after page 1: "No more matching items" with the number read; none read: "No more items"', async () => {
      await filtered([filteredPage([C1], 25, LAST), filteredPage([], 10)]);
      await expectFirstCells(['S c1']);
      fireEvent.click(nextPage());
      await expectSlot(['No more matching items', 'None of the 10 items this page read matches the filter.']);
      expect(isDisabled(nextPage())).toBe(true);
    });

    it('the singular after page 1, and a last page that read none', async () => {
      await filtered([
        filteredPage([C1], 25, LAST),
        filteredPage([], 1),
        filteredPage([C1], 25, LAST),
        filteredPage([], 0),
      ]);
      await expectFirstCells(['S c1']);
      fireEvent.click(nextPage());
      await expectSlot(['No more matching items', 'The 1 item this page read does not match the filter.']);

      run();
      await expectFirstCells(['S c1']);
      fireEvent.click(nextPage());
      await waitFor(() => {
        expect(text(slot())).toBe('No more items');
      });
    });
  });

  it('a filtered read refused, answered 501 or AccessDeniedException: shown in place of the items, the conditions as written', async () => {
    await openTable(ORDERS, [C1]);
    let answer: Answer = refused(
      400,
      'ValidationException',
      'The parameter cannot be converted to a numeric value: abc',
    );
    onFiltered('Scan', () => answer);
    addCondition();
    typeCondition('Attribute name, condition 1', 'total');
    chooseCondition('Comparison, condition 1', '>');
    chooseCondition('Type, condition 1', 'N');
    typeCondition('Value, condition 1', 'abc');
    run();

    await waitFor(() => {
      expect(text(slot())).toContain('ValidationException: The parameter cannot be converted to a numeric value: abc');
    });
    expect(firstCells()).toEqual([]);
    const asWritten = () => {
      expect(conditionInput('Attribute name, condition 1').value).toBe('total');
      expect(text(conditionSelect('Comparison, condition 1').findTrigger().getElement())).toBe('Greater than');
      expect(text(conditionSelect('Type, condition 1').findTrigger().getElement())).toBe('Number');
      expect(conditionInput('Value, condition 1').value).toBe('abc');
    };
    asWritten();

    answer = { status: 501, body: { __type: 'NotImplemented', message: 'not here' } };
    run();
    await waitFor(() => {
      expect(text(slot())).toContain('Not implemented by the emulator');
    });
    expect(text(slot())).toContain('Scan');

    answer = refused(403, 'AccessDeniedException', 'no scan');
    run();
    await waitFor(() => {
      expect(text(slot())).toContain('Access denied');
    });
    expect(text(slot())).toContain('Scan was refused: no scan');
    asWritten();
  });

  it('Enter in a condition\'s field: the same as "Run"', async () => {
    await openTable(ORDERS, [C1]);
    onFiltered('Scan', () => filteredPage([C1], 1));
    addCondition();
    const user = userEvent.setup();
    await user.type(conditionInput('Attribute name, condition 1'), 'status{Enter}');

    await waitFor(() => {
      expect(engine.of('Scan')).toHaveLength(2);
    });
    expect(engine.of('Scan').at(-1)?.body).toMatchObject({ ExpressionAttributeNames: { '#f0': 'status' } });
    await waitFor(() => {
      expect(heading()).toBe('Scan of orders, filtered by 1 condition (1)');
    });
  });

  it('every condition removed and "Run": the request without a filter and the heading "Scan of {target}"', async () => {
    await openTable(ORDERS, [C1, C2]);
    onFiltered('Scan', () => filteredPage([C1], 2));
    addCondition();
    typeCondition('Attribute name, condition 1', 'status');
    run();
    await waitFor(() => {
      expect(heading()).toBe('Scan of orders, filtered by 1 condition (1)');
    });

    fireEvent.click(within(tabContent()).getByRole('button', { name: 'Remove condition 1' }));
    run();

    await expectFirstCells(['S c1', 'S c2']);
    expect(engine.of('Scan').at(-1)?.body).toEqual({ TableName: 'orders', Limit: 25 });
    expect(heading()).toBe('Scan of orders (2)');
    expect(headerText()).not.toContain('match the filter');
  });

  it('"Read", "Table or index" or a query field changed: the conditions stay; "Details" and back: the conditions, the applied filter and the page stay', async () => {
    await openTable(ORDERS, [C1, C2]);
    onFiltered('Scan', () => filteredPage([C1], 2));
    addCondition();
    typeCondition('Attribute name, condition 1', 'status');
    typeCondition('Value, condition 1', 'open');
    run();
    await waitFor(() => {
      expect(heading()).toBe('Scan of orders, filtered by 1 condition (1)');
    });

    segment('Query');
    choose('Table or index', 'by-status');
    type('status (String)', 'open');
    expect(conditionInput('Attribute name, condition 1').value).toBe('status');
    expect(conditionInput('Value, condition 1').value).toBe('open');

    showTab('details');
    showTab('items');

    await expectFirstCells(['S c1']);
    expect(heading()).toBe('Scan of orders, filtered by 1 condition (1)');
    expect(headerText()).toContain('2 items read, 1 matches the filter.');
    expect(conditionInput('Attribute name, condition 1').value).toBe('status');
    expect(conditionInput('Value, condition 1').value).toBe('open');
  });

  it('"Items per page" changed, the header\'s "Refresh", an item saved and items deleted: read again with the applied conditions', async () => {
    await openTable(ORDERS, [C1, C2]);
    onFiltered('Scan', () => filteredPage([C1], 2));
    addCondition();
    typeCondition('Attribute name, condition 1', 'status');
    typeCondition('Value, condition 1', 'open');
    run();
    await expectFirstCells(['S c1']);
    const filter = {
      FilterExpression: '#f0 = :f0',
      ExpressionAttributeNames: { '#f0': 'status' },
      ExpressionAttributeValues: { ':f0': { S: 'open' } },
    };
    let reads = engine.of('Scan').length;
    async function readAgain(limit = 25) {
      await waitFor(() => {
        expect(engine.of('Scan').length).toBeGreaterThan(reads);
      });
      expect(engine.of('Scan').at(-1)?.body).toEqual({ TableName: 'orders', Limit: limit, ...filter });
      reads = engine.of('Scan').length;
      await expectFirstCells(['S c1']);
    }

    const preferences = itemsTable().findCollectionPreferences();
    preferences?.findTriggerButton().click();
    const modal = await waitFor(() => {
      const found = preferences?.findModal();
      expect(found).not.toBeNull();
      return found as NonNullable<typeof found>;
    });
    fireEvent.click(within(modal.getElement()).getByRole('radio', { name: '50 items' }));
    modal.findConfirmButton()?.click();
    await readAgain(50);

    fireEvent.click(headerButton('Refresh'));
    await readAgain(50);

    fireEvent.click(
      within(itemsTable().findHeaderSlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Create item' }),
    );
    const editor = await waitFor(() => {
      const found = PAGE.findModal();
      expect(found).not.toBeNull();
      return found as NonNullable<typeof found>;
    });
    editor
      .findContent()
      .findTextarea()
      ?.setTextareaValue(JSON.stringify({ customer: { S: 'c3' }, placed: { N: '3' } }, null, 2));
    fireEvent.click(within(editor.getElement()).getByRole('button', { name: 'Save' }));
    await readAgain(50);

    itemsTable().findRowSelectionArea(1)?.click();
    fireEvent.click(
      within(itemsTable().findHeaderSlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Delete' }),
    );
    const dialog = await waitFor(() => {
      const found = PAGE.findModal();
      expect(found).not.toBeNull();
      return found as NonNullable<typeof found>;
    });
    fireEvent.change(within(dialog.getElement()).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog.getElement()).getByRole('button', { name: 'Delete' }));
    await readAgain(50);
  });
});
