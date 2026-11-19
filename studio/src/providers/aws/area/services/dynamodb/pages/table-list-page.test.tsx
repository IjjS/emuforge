import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// DynamoDB's table list, S1, rendered inside the area's layout as Studio's frame renders the area, against a fake
// engine behind the page's `fetch` that answers DynamoDB's JSON 1.0 protocol (issue 496, test-criteria.md, "Unit s2 —
// .../dynamodb/pages/table-list-page.test.tsx").

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

function open(path = '/aws/dynamodb') {
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

function list() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The data rows' cells as text, in the columns' order, the selection cell left out. */
function rows(): string[][] {
  return (list().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].filter((cell) => cell.querySelector('input') === null).map(text),
  );
}

function names(): string[] {
  return rows().map((row) => row[0] ?? '');
}

async function expectNames(expected: string[]) {
  await waitFor(() => {
    expect(names()).toEqual(expected);
  });
}

function slot(): HTMLElement {
  const found = list().findEmptySlot()?.getElement();
  expect(found).toBeDefined();
  return found as HTMLElement;
}

function header(): HTMLElement {
  return list().findHeaderSlot()?.getElement() as HTMLElement;
}

function button(name: string): HTMLElement {
  return within(header()).getByRole('button', { name });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function nextPage(): HTMLButtonElement {
  return list().findPagination()?.findNextPageButton().getElement() as HTMLButtonElement;
}

function searchInput(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Search tables' });
}

function searchFor(value: string) {
  fireEvent.change(searchInput(), { target: { value } });
  fireEvent.keyDown(searchInput(), { key: 'Enter' });
}

function flashItems(): [string, string][] {
  return (PAGE.findFlashbar()?.findItems() ?? []).map((item) => [
    text(item.findHeader()?.getElement() ?? document.createElement('i')),
    text(item.findContent()?.getElement() ?? document.createElement('i')),
  ]);
}

async function expectFlash(expected: [string, string][]) {
  await waitFor(() => {
    expect(flashItems()).toEqual(expected);
  });
}

function announced(): string[] {
  return [...document.querySelectorAll('.aws-area-announcer')].map(text);
}

async function openLoaded(tables: Description[] = [ORDERS, USERS], path?: string) {
  engine.hold(...tables);
  const opened = open(path);
  await expectNames(tables.map((each) => each.TableName).sort());
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------

describe('the table list, loaded', () => {
  it('one row per table: its name a link to its page, status, keys as "name (type)", indexes, capacity mode', async () => {
    await openLoaded();

    // The first header is the selection column's.
    const headers = (list().findColumnHeaders() ?? []).map((each) => text(each.getElement())).slice(1);
    expect(headers).toEqual(['Name', 'Status', 'Partition key', 'Sort key', 'Indexes', 'Capacity mode']);
    expect(rows()).toEqual([
      ['orders', 'Active', 'customer (S)', 'placed (N)', '2', 'On-demand'],
      ['users', 'Active', 'pk (S)', '-', '0', 'Provisioned (5 read, 7 write)'],
    ]);
    const links = (list().findRows() ?? [])
      .flatMap((row) => within(row.getElement()).getAllByRole('link'))
      .map((link) => [text(link), link.getAttribute('href')]);
    expect(links).toEqual([
      ['orders', '/aws/dynamodb/tables/table/orders'],
      ['users', '/aws/dynamodb/tables/table/users'],
    ]);
  });

  it('one ListTables of 25, then one DescribeTable per name of its answer', async () => {
    await openLoaded();

    expect(engine.of('ListTables').map((sent) => sent.body)).toEqual([{ Limit: 25 }]);
    expect(engine.of('DescribeTable').map((sent) => sent.body)).toEqual([
      { TableName: 'orders' },
      { TableName: 'users' },
    ]);
  });

  it('a table deleted between ListTables and its DescribeTable is left out of the page', async () => {
    engine.hold(ORDERS, USERS);
    engine.on('DescribeTable', (body) =>
      body['TableName'] === 'users'
        ? refused(400, 'ResourceNotFoundException', 'Requested resource not found: Table: users not found')
        : undefined,
    );
    open();

    await expectNames(['orders']);
  });

  it('a status Studio does not name is shown as it came', async () => {
    engine.hold(table('aaa', { TableStatus: 'ARCHIVED' }));
    open();

    await expectNames(['aaa']);
    expect(rows()[0]?.[1]).toBe('ARCHIVED');
  });

  it('the h1 "Tables" with the count, the requirement’s description; the notice names "tables"', async () => {
    await openLoaded();

    expect(text(screen.getByRole('heading', { level: 1 }))).toBe('Tables (2)');
    expect(screen.getByText('The search matches the start of a table name and is case-sensitive.')).toBeInTheDocument();
    expect(screen.getByText('These tables are in your local emulator')).toBeInTheDocument();
  });

  it.each(['/aws/dynamodb', '/aws/dynamodb/tables'])(
    'at %s: the list, the side navigation "DynamoDB" with "Tables" current, the crumbs',
    async (path) => {
      const { router } = await openLoaded(undefined, path);

      expect(router.state.location.pathname).toBe(path);
      const navigation = PAGE.findSideNavigation();
      expect(text(navigation?.findHeaderLink()?.getElement() as HTMLElement)).toBe('DynamoDB');
      expect(text(navigation?.findActiveLink()?.getElement() as HTMLElement)).toBe('Tables');
      expect(navigation?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/dynamodb/tables');
      const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) =>
        text(crumb.getElement()),
      );
      expect(crumbs).toEqual(['EmuForge', 'AWS', 'DynamoDB', 'Tables']);
    },
  );

  it('"Create table" leads to the create page', async () => {
    const { router } = await openLoaded();

    fireEvent.click(within(header()).getByRole('link', { name: 'Create table' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/dynamodb/tables/create');
    });
  });
});

describe('empty and no match', () => {
  it('no table: "No tables", its text, and "Create table" leading to the create page', async () => {
    const { router } = open();

    await waitFor(() => {
      expect(text(slot())).toContain('No tables');
    });
    expect(text(slot())).toContain(
      'This emulator holds no tables. Create one here, or with any tool pointed at the emulator. It starts empty each time it restarts.',
    );
    fireEvent.click(within(slot()).getByRole('button', { name: 'Create table' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/dynamodb/tables/create');
    });
  });

  it('a search on Enter: ListTables from its start name, the names that start with it', async () => {
    await openLoaded([ORDERS, USERS, table('order-lines'), table('Orders')]);

    searchFor('order');

    await expectNames(['order-lines', 'orders']);
    expect(engine.of('ListTables').at(-1)?.body).toEqual({
      Limit: 25,
      ExclusiveStartTableName: `ordeq${'z'.repeat(250)}`,
    });
  });

  it('typing alone sends nothing; only Enter searches', async () => {
    await openLoaded();

    fireEvent.change(searchInput(), { target: { value: 'us' } });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.of('ListTables')).toHaveLength(1);
    expect(names()).toEqual(['orders', 'users']);
  });

  it('none matching: "No matches" with its sentence; "Clear search" lists every table again', async () => {
    await openLoaded();

    searchFor('zz');

    await waitFor(() => {
      expect(text(slot())).toContain('No matches');
    });
    expect(text(slot())).toContain('No table name starts with “zz”.');
    fireEvent.click(within(slot()).getByRole('button', { name: 'Clear search' }));
    await expectNames(['orders', 'users']);
    expect(searchInput().value).toBe('');
  });

  it('a search outside the name alphabet sends nothing and shows "No matches"', async () => {
    await openLoaded();
    const listed = engine.of('ListTables').length;

    searchFor('or ders');

    await waitFor(() => {
      expect(text(slot())).toContain('No table name starts with “or ders”.');
    });
    expect(engine.of('ListTables')).toHaveLength(listed);
  });
});

describe('failures of the read', () => {
  async function expectState(lines: string[]) {
    await waitFor(() => {
      const shown = text(slot());
      for (const line of lines) {
        expect(shown).toContain(line);
      }
    });
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  }

  it('HTTP 501: "Not implemented by the emulator" naming ListTables', async () => {
    engine.on('ListTables', () => ({ status: 501, body: { __type: 'NotImplemented', message: 'not here' } }));
    open();

    await expectState([
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for ListTables, so Studio cannot show the table list.',
    ]);
    await waitFor(() => {
      expect(announced()).toContain('Not implemented by the emulator');
    });
  });

  it('AccessDeniedException: "Access denied" with the reason returned', async () => {
    engine.on('ListTables', () => refused(403, 'AccessDeniedException', 'no policy allows it'));
    open();

    await expectState(['Access denied', 'ListTables was refused: no policy allows it']);
  });

  it('a DescribeTable failing other than "not found" is the failure of the read', async () => {
    engine.hold(ORDERS);
    engine.on('DescribeTable', () => refused(403, 'AccessDeniedException', 'no describe'));
    open();

    await expectState(['Access denied', 'DescribeTable was refused: no describe']);
  });

  it('the emulator did not answer', async () => {
    engine.on('ListTables', () => refused(504, 'EmulatorTimeout', 'the emulator did not answer in time'));
    open();

    await expectState(['The emulator did not answer', 'the emulator did not answer in time']);
  });

  it('the engine did not answer', async () => {
    engine.on('ListTables', () => 'network-error');
    open();

    await expectState([`The EmuForge engine at ${engineOrigin} did not answer`]);
  });

  it('any other failure: "The table list could not be read" with code and message as they came', async () => {
    engine.on('ListTables', () => refused(500, 'InternalServerError', 'boom'));
    open();

    await expectState(['The table list could not be read', 'InternalServerError: boom']);
  });

  it('not connected: the emulator line’s words, "The table list could not be read.", "Connection status"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    engine.on('ListTables', () => refused(500, 'InternalServerError', 'boom'));
    open();

    await expectState([`Not started on port ${String(EMULATOR_PORT)}`, 'The table list could not be read.']);
    expect(within(slot()).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
  });

  it('a failed read, then the connection connected again: read again by itself, and its rows', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    let fail = true;
    engine.on('ListTables', () => (fail ? refused(500, 'InternalServerError', 'boom') : undefined));
    engine.hold(ORDERS);
    open();
    await waitFor(() => {
      expect(text(slot())).toContain('The table list could not be read.');
    });

    fail = false;
    connection.set(connectedResult());

    await expectNames(['orders']);
  });

  it('"Retry" reads again', async () => {
    let fail = true;
    engine.on('ListTables', () => (fail ? refused(500, 'InternalServerError', 'boom') : undefined));
    engine.hold(ORDERS);
    open();
    await expectState(['The table list could not be read']);

    fail = false;
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));

    await expectNames(['orders']);
  });
});

describe('"Refresh"', () => {
  it('reads the list again and announces "Tables refreshed"', async () => {
    await openLoaded([ORDERS]);
    engine.hold(USERS);

    fireEvent.click(button('Refresh'));

    await expectNames(['orders', 'users']);
    await waitFor(() => {
      expect(announced()).toContain('Tables refreshed');
    });
    expect(engine.of('ListTables')).toHaveLength(2);
  });
});

describe('pages', () => {
  const THIRTY = Array.from({ length: 30 }, (_, index) => table(`t-${String(index + 1).padStart(2, '0')}`));

  it('a LastEvaluatedTableName: next page enabled and read with it; on the last page, none: disabled', async () => {
    engine.hold(...THIRTY);
    open();
    await expectNames(THIRTY.slice(0, 25).map((each) => each.TableName));
    expect(text(screen.getByRole('heading', { level: 1 }))).toBe('Tables (25+)');
    await waitFor(() => {
      expect(isDisabled(nextPage())).toBe(false);
    });

    fireEvent.click(nextPage());

    await expectNames(THIRTY.slice(25).map((each) => each.TableName));
    expect(engine.of('ListTables').at(-1)?.body).toEqual({ Limit: 25, ExclusiveStartTableName: 't-25' });
    expect(isDisabled(nextPage())).toBe(true);
    expect(text(screen.getByRole('heading', { level: 1 }))).toBe('Tables (30)');
  });

  it('no LastEvaluatedTableName: next page disabled', async () => {
    await openLoaded();

    expect(isDisabled(nextPage())).toBe(true);
  });
});

describe('"Delete"', () => {
  function select(name: string) {
    fireEvent.click(screen.getByRole('radio', { name: `Select ${name}` }));
  }

  function modal() {
    const found = PAGE.findModal();
    expect(found).not.toBeNull();
    return found as NonNullable<typeof found>;
  }

  function dialog(): HTMLElement {
    return modal().getElement();
  }

  function confirmButton(): HTMLElement {
    return within(dialog()).getByRole('button', { name: 'Delete' });
  }

  function typeName(value: string) {
    act(() => {
      modal().findContent().findInput()?.setInputValue(value);
    });
  }

  async function openDialog(name: string) {
    select(name);
    await waitFor(() => {
      expect(isDisabled(button('Delete'))).toBe(false);
    });
    fireEvent.click(button('Delete'));
    await waitFor(() => {
      expect(PAGE.findModal()).not.toBeNull();
    });
  }

  function dialogShown(): boolean {
    return PAGE.findModal() !== null;
  }

  it('disabled without a selection; enabled once a table is selected', async () => {
    await openLoaded();

    expect(isDisabled(button('Delete'))).toBe(true);
    select('orders');
    await waitFor(() => {
      expect(isDisabled(button('Delete'))).toBe(false);
    });
  });

  it('the dialog: its header and body; "Delete" enabled only once the table’s name is typed exactly', async () => {
    await openLoaded();
    await openDialog('orders');

    expect(text(modal().findHeader().getElement())).toBe('Delete orders?');
    expect(text(dialog())).toContain(
      'orders and every item in it are deleted from your local emulator. This cannot be undone.',
    );
    expect(text(dialog())).not.toContain('Deletion protection');
    expect(isDisabled(confirmButton())).toBe(true);
    typeName('Orders');
    expect(isDisabled(confirmButton())).toBe(true);
    typeName('orders');
    expect(isDisabled(confirmButton())).toBe(false);
    expect(engine.of('DeleteTable')).toHaveLength(0);
  });

  it('a table with deletion protection: the warning above the body', async () => {
    await openLoaded();
    await openDialog('users');

    expect(text(dialog())).toContain(
      'Deletion protection is on for users. The emulator refuses to delete it while it is on.',
    );
  });

  it('success: one DeleteTable, "Table orders is being deleted." and a new listing without it', async () => {
    await openLoaded();
    const listed = engine.of('ListTables').length;
    await openDialog('orders');
    typeName('orders');

    fireEvent.click(confirmButton());

    await expectFlash([['', 'Table orders is being deleted.']]);
    expect(engine.of('DeleteTable').map((sent) => sent.body)).toEqual([{ TableName: 'orders' }]);
    await expectNames(['users']);
    expect(engine.of('ListTables').length).toBeGreaterThan(listed);
    expect(dialogShown()).toBe(false);
    expect(isDisabled(button('Delete'))).toBe(true);
  });

  it('refusal: the flash names the code and message as they came; the table stays', async () => {
    await openLoaded();
    engine.on('DeleteTable', () =>
      refused(
        400,
        'ValidationException',
        'Resource cannot be deleted as it is currently protected against deletion. Disable deletion protection first.',
      ),
    );
    await openDialog('users');
    typeName('users');

    fireEvent.click(confirmButton());

    await expectFlash([
      [
        'Deleting users failed',
        'ValidationException: Resource cannot be deleted as it is currently protected against deletion. Disable deletion protection first.',
      ],
    ]);
    expect(dialogShown()).toBe(false);
    await expectNames(['orders', 'users']);
  });

  it('"Cancel" closes the dialog and sends nothing', async () => {
    await openLoaded();
    await openDialog('orders');

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(dialogShown()).toBe(false);
    });
    expect(engine.of('DeleteTable')).toHaveLength(0);
  });
});
