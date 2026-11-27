import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// "Delete" of the items of DynamoDB's table page, S2, rendered inside the area's layout as Studio's frame renders the area,
// against a fake engine behind the page's `fetch` that answers DynamoDB's JSON 1.0 protocol (issue 496,
// test-criteria.md, "Unit s4 — .../dynamodb/components/delete-items.test.tsx").

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

const NOT_IMPLEMENTED: Answer = { status: 501, body: { __type: 'NotImplemented', message: 'not here' } };

/** A table as `DescribeTable` gives it. */
type Description = Record<string, unknown> & { TableName: string };

/** An item as the wire carries it: attribute values by name, a binary value as base64. */
type WireItem = Record<string, Record<string, unknown>>;

/** The key of `item` by the key attributes of `table`. */
function keyOf(item: WireItem, table: Description): WireItem {
  const schema = table['KeySchema'] as { AttributeName: string }[];
  return Object.fromEntries(schema.map(({ AttributeName }) => [AttributeName, item[AttributeName] ?? {}]));
}

function sameKey(item: WireItem, key: WireItem, table: Description): boolean {
  return JSON.stringify(keyOf(item, table)) === JSON.stringify(keyOf(key, table));
}

class FakeEngine {
  /** The tables the emulator holds, by name. */
  readonly tables = new Map<string, Description>();
  /** The items of each table, in the emulator's order, as the wire carries them. */
  readonly items = new Map<string, WireItem[]>();
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

  /** The emulator's answer, for the operations the item screens call. */
  private emulator(operation: string, body: Record<string, unknown>): Answer {
    const name = String(body['TableName']);
    const table = this.tables.get(name);
    if (table === undefined) {
      return refused(400, 'ResourceNotFoundException', `Requested resource not found: Table: ${name} not found`);
    }
    const items = this.items.get(name) ?? [];
    switch (operation) {
      case 'DescribeTable':
        return ok({ Table: table });
      case 'DescribeTimeToLive':
        return ok({ TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } });
      case 'Scan': {
        const limit = typeof body['Limit'] === 'number' ? body['Limit'] : 100;
        return ok({ Items: items.slice(0, limit), Count: Math.min(items.length, limit) });
      }
      case 'GetItem': {
        const found = items.find((item) => sameKey(item, body['Key'] as WireItem, table));
        return ok(found === undefined ? {} : { Item: found });
      }
      case 'PutItem': {
        const item = body['Item'] as WireItem;
        const index = items.findIndex((each) => sameKey(each, item, table));
        const condition = String(body['ConditionExpression']);
        const refusedByCondition = condition.startsWith('attribute_not_exists') ? index >= 0 : index < 0;
        if (refusedByCondition) {
          return refused(400, 'ConditionalCheckFailedException', 'The conditional request failed');
        }
        this.items.set(name, index < 0 ? [...items, item] : items.map((each, at) => (at === index ? item : each)));
        return ok({});
      }
      case 'DeleteItem': {
        this.items.set(
          name,
          items.filter((item) => !sameKey(item, body['Key'] as WireItem, table)),
        );
        return ok({});
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

/** An active on-demand table `orders`, keyed by `customer` (S) and `placed` (N), with a global index `by-status`. */
const ORDERS: Description = {
  TableName: 'orders',
  TableStatus: 'ACTIVE',
  TableArn: 'arn:aws:dynamodb:us-east-1:000000000000:table/orders',
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
      Projection: { ProjectionType: 'KEYS_ONLY' },
      IndexStatus: 'ACTIVE',
    },
  ],
  BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
};

/** An order of `customer` placed at `placed`, with what `extra` adds. */
function order(customer: string, placed: number, extra: WireItem = {}): WireItem {
  return { customer: { S: customer }, placed: { N: String(placed) }, ...extra };
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

const EMULATOR_PORT = 9306;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9800;
let engine: FakeEngine;
let connection: AreaConnection;

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
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
      connection={connection}
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
  connection = { result: connectedResult(), engineOrigin: engineEndpoint(nextPort) };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Opens `orders`' page holding `items`, once its first scan is shown. */
async function openOrders(...items: WireItem[]) {
  engine.hold(ORDERS);
  engine.put('orders', ...items);
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: ['/aws/dynamodb/tables/table/orders'] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(engine.of('Scan')).toHaveLength(1);
  });
  await waitFor(() => {
    expect(itemsTable().findLoadingText()).toBeNull();
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function itemsTable() {
  const found = PAGE.findTabs()?.findTabContent()?.findTable();
  expect(found).toBeDefined();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

/** The text of each row's cells, the selection cell left out. */
function rows(): string[][] {
  return (itemsTable().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => cell.querySelector('input[type="checkbox"]') === null)
      .map(text),
  );
}

async function expectRows(expected: string[][]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

/** A button of the items' header. */
function itemsButton(name: string): HTMLElement {
  const header = itemsTable().findHeaderSlot()?.getElement();
  expect(header).toBeDefined();
  return within(header as HTMLElement).getByRole('button', { name });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** Each item of the area's Flashbar: its type, header and content. */
function flashItems(): [string, string, string][] {
  const flashbar = PAGE.findFlashbar();
  const typeOf = (element: Element) =>
    (['success', 'error', 'info', 'warning'] as const).find((type) =>
      (flashbar?.findItemsByType(type) ?? []).some(
        (item) => item.getElement().contains(element) || element.contains(item.getElement()),
      ),
    ) ?? '';
  return (flashbar?.findItems() ?? []).map((item) => [
    typeOf(item.getElement()),
    text(item.findHeader()?.getElement() ?? document.createElement('i')),
    text(item.findContent()?.getElement() ?? document.createElement('i')),
  ]);
}

async function expectFlash(expected: [string, string, string][]) {
  await waitFor(() => {
    expect(flashItems()).toEqual(expected);
  });
}

function modal() {
  const found = PAGE.findModal();
  expect(found, 'a dialog').not.toBeNull();
  return found as NonNullable<typeof found>;
}

function dialogButton(name: string): HTMLElement {
  return within(modal().getElement()).getByRole('button', { name });
}

function select(...rowNumbers: number[]) {
  for (const row of rowNumbers) {
    itemsTable().findRowSelectionArea(row)?.click();
  }
}

/** The rows whose selection box is checked, by their first cell. */
function selectedRows(): string[] {
  return (itemsTable().findRows() ?? [])
    .filter((row) => row.getElement().querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked === true)
    .map((row) => rows()[Number(row.getElement().getAttribute('aria-rowindex')) - 2]?.[0] ?? '');
}

async function openDialog() {
  fireEvent.click(itemsButton('Delete'));
  await waitFor(() => {
    expect(PAGE.findModal()).not.toBeNull();
  });
}

function typeWord(value: string) {
  fireEvent.change(within(modal().getElement()).getByRole('textbox'), { target: { value } });
}

async function confirmDelete() {
  await openDialog();
  typeWord('delete');
  fireEvent.click(dialogButton('Delete'));
}

const KEY_TEXT = (customer: string, placed: number) =>
  `{"customer":{"S":"${customer}"},"placed":{"N":"${String(placed)}"}}`;

const A = order('a', 1, { note: { S: 'first' } });
const B = order('b', 2);
const C = order('c', 3);

describe('"Delete" and its dialog', () => {
  it('disabled without a selection, "Select items first"; enabled once items are selected', async () => {
    await openOrders(A, B, C);

    const button = itemsButton('Delete');
    expect(isDisabled(button)).toBe(true);
    fireEvent.focus(button);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Select items first');
    });
    fireEvent.click(button);
    expect(PAGE.findModal()).toBeNull();

    select(1);
    await waitFor(() => {
      expect(isDisabled(itemsButton('Delete'))).toBe(false);
    });
  });

  it('several items: "Delete {n} items from {table}?", confirmed only once "delete" is typed', async () => {
    await openOrders(A, B, C);
    select(1, 3);
    await openDialog();

    expect(text(modal().findHeader().getElement())).toBe('Delete 2 items from orders?');
    expect(text(modal().getElement())).toContain('They are deleted from your local emulator. This cannot be undone.');
    expect(isDisabled(dialogButton('Delete'))).toBe(true);
    typeWord('Delete');
    expect(isDisabled(dialogButton('Delete'))).toBe(true);
    typeWord('delete');
    expect(isDisabled(dialogButton('Delete'))).toBe(false);
    expect(engine.of('DeleteItem')).toHaveLength(0);

    fireEvent.click(dialogButton('Cancel'));
    await waitFor(() => {
      expect(PAGE.findModal()).toBeNull();
    });
    expect(engine.of('DeleteItem')).toHaveLength(0);
  });

  it('one item: "Delete 1 item from {table}?" and "It is deleted …"', async () => {
    await openOrders(A, B, C);
    select(2);
    await openDialog();

    expect(text(modal().findHeader().getElement())).toBe('Delete 1 item from orders?');
    expect(text(modal().getElement())).toContain('It is deleted from your local emulator. This cannot be undone.');
  });

  it.each([
    { row: 1, name: 'a b', identity: 'a b' },
    { row: 2, name: 'a  b', identity: 'a\\u0020\\u0020b' },
  ])('shows the selected key for row $row and deletes the stored key', async ({ row, name, identity }) => {
    const oneSpace = order('a b', 1);
    const twoSpaces = order('a  b', 1);
    await openOrders(oneSpace, twoSpaces);
    select(row);
    await openDialog();

    expect(text(modal().findHeader().getElement())).toBe('Delete 1 item from orders?');
    const list = within(modal().getElement()).getByRole('list');
    expect(within(list).getByRole('listitem')).toHaveTextContent(KEY_TEXT(identity, 1));
    expect(isDisabled(dialogButton('Delete'))).toBe(true);
    typeWord('delete');
    fireEvent.click(dialogButton('Delete'));

    await expectFlash([['success', '', '1 item deleted from orders.']]);
    expect(engine.of('DeleteItem').map((sent) => sent.body)).toEqual([{ TableName: 'orders', Key: order(name, 1) }]);
    expect(engine.items.get('orders')).toEqual([row === 1 ? twoSpaces : oneSpace]);
  });

  it('lists every selected key in page order', async () => {
    await openOrders(order('a b', 1), B, order('a  b', 1));
    select(3, 1);
    await openDialog();

    expect(text(modal().findHeader().getElement())).toBe('Delete 2 items from orders?');
    const list = within(modal().getElement()).getByRole('list');
    expect(within(list).getAllByRole('listitem').map(text)).toEqual([
      KEY_TEXT('a b', 1),
      KEY_TEXT('a\\u0020\\u0020b', 1),
    ]);
  });
});

describe('the deletes and their report', () => {
  it('all deleted: one DeleteItem per item, keys only, in the page’s order, each after the previous answer', async () => {
    let answerFirst: (value: Answer) => void = () => undefined;
    engine.on('DeleteItem', (body) =>
      JSON.stringify(body['Key']) === JSON.stringify({ customer: { S: 'a' }, placed: { N: '1' } })
        ? new Promise<Answer>((resolve) => (answerFirst = resolve))
        : undefined,
    );
    await openOrders(A, B, C);
    select(3, 1);
    await confirmDelete();

    await waitFor(() => {
      expect(engine.of('DeleteItem')).toHaveLength(1);
    });
    expect(isDisabled(dialogButton('Delete'))).toBe(true);
    engine.items.set('orders', [B, C]);
    answerFirst(ok({}));

    await expectFlash([['success', '', '2 items deleted from orders.']]);
    expect(engine.of('DeleteItem').map((sent) => sent.body)).toEqual([
      { TableName: 'orders', Key: { customer: { S: 'a' }, placed: { N: '1' } } },
      { TableName: 'orders', Key: { customer: { S: 'c' }, placed: { N: '3' } } },
    ]);
    expect(PAGE.findModal()).toBeNull();
  });

  it('one deleted: "1 item deleted from orders."', async () => {
    await openOrders(A, B, C);
    select(2);
    await confirmDelete();

    await expectFlash([['success', '', '1 item deleted from orders.']]);
  });

  it('some failed: the success item for the others, one error item per failed item with its key, code and message', async () => {
    engine.on('DeleteItem', (body) =>
      JSON.stringify(body['Key']) === JSON.stringify({ customer: { S: 'b' }, placed: { N: '2' } })
        ? refused(400, 'ValidationException', 'The provided key element does not match the schema')
        : undefined,
    );
    await openOrders(A, B, C);
    select(1, 2, 3);
    await confirmDelete();

    await expectFlash([
      ['success', '', '2 items deleted from orders.'],
      [
        'error',
        'Deleting the item failed',
        `Item ${KEY_TEXT('b', 2)}ValidationException: The provided key element does not match the schema`,
      ],
    ]);
    expect(engine.of('DeleteItem')).toHaveLength(3);
  });

  it('all failed: no success item; 501 and AccessDenied in their words, each with its key', async () => {
    const answers: Answer[] = [NOT_IMPLEMENTED, refused(403, 'AccessDeniedException', 'no delete')];
    let next = 0;
    engine.on('DeleteItem', () => answers[next++]);
    await openOrders(A, B, C);
    select(1, 2);
    await confirmDelete();

    await expectFlash([
      [
        'info',
        'Not implemented by the emulator',
        `Item ${KEY_TEXT('a', 1)}The emulator answered 501 Not Implemented for DeleteItem.`,
      ],
      ['error', 'Access denied', `Item ${KEY_TEXT('b', 2)}DeleteItem was refused: no delete`],
    ]);
  });
});

describe('after the deletes', () => {
  it('the page read again, the selection cleared', async () => {
    await openOrders(A, B, C);
    select(1, 2);
    await waitFor(() => {
      expect(selectedRows()).toEqual(['S a', 'S b']);
    });
    await confirmDelete();

    await expectFlash([['success', '', '2 items deleted from orders.']]);
    await waitFor(() => {
      expect(engine.of('Scan')).toHaveLength(2);
    });
    await expectRows([['S c', 'N 3']]);
    expect(selectedRows()).toEqual([]);
    expect(isDisabled(itemsButton('Delete'))).toBe(true);
  });

  it('a failed delete too: the page read again, the selection cleared', async () => {
    engine.on('DeleteItem', () => refused(400, 'ValidationException', 'no'));
    await openOrders(A, B, C);
    select(1);
    await confirmDelete();

    await waitFor(() => {
      expect(engine.of('Scan')).toHaveLength(2);
    });
    await waitFor(() => {
      expect(isDisabled(itemsButton('Delete'))).toBe(true);
    });
    expect(selectedRows()).toEqual([]);
  });
});
