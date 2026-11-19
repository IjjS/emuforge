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

// The item editor of DynamoDB's table page, S2, rendered inside the area's layout as Studio's frame renders the area,
// against a fake engine behind the page's `fetch` that answers DynamoDB's JSON 1.0 protocol (issue 496,
// test-criteria.md, "Unit s4 — .../dynamodb/components/item-editor.test.tsx").

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
let nextPort = 9700;
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

function textarea() {
  const found = modal().findContent().findTextarea();
  expect(found, 'the editor').not.toBeNull();
  return found as NonNullable<typeof found>;
}

function editorError(): string {
  return text(modal().findContent().findFormField()?.findError()?.getElement() ?? document.createElement('i'));
}

function editorAlert(): [string, string] {
  const alert = modal().findContent().findAlert();
  return [
    text(alert?.findHeader()?.getElement() ?? document.createElement('i')),
    text(alert?.findContent().getElement() ?? document.createElement('i')),
  ];
}

/** Opens the item of row `row` (1-based) by its key's link. */
function openRow(row: number) {
  const link = itemsTable().findRows()[row - 1]?.findLink();
  expect(link, `the key link of row ${String(row)}`).toBeDefined();
  link?.click();
}

async function openedEditor(header: string) {
  await waitFor(() => {
    expect(PAGE.findModal()).not.toBeNull();
  });
  expect(text(modal().findHeader().getElement())).toBe(header);
}

function save() {
  fireEvent.click(dialogButton('Save'));
}

/** Text as the editor writes it: two-space indented JSON, its members in the order given. */
function written(item: unknown): string {
  return JSON.stringify(item, null, 2);
}

const ANN = order('ann', 1, { total: { N: '12.5' }, note: { S: 'hi' } });

describe('opening the editor', () => {
  it('"Create item": the table’s key attributes with empty values of their types; nothing read', async () => {
    await openOrders(ANN);

    fireEvent.click(itemsButton('Create item'));
    await openedEditor('Create item');

    expect(textarea().getTextareaValue()).toBe(written({ customer: { S: '' }, placed: { N: '' } }));
    expect(text(modal().findContent().getElement())).toContain(
      "The item in DynamoDB JSON: each attribute's type and value, as the AWS CLI writes it.",
    );
    expect(engine.of('GetItem')).toHaveLength(0);
  });

  it('"Edit item": the item as GetItem returns it now, keys first, then the others by code point', async () => {
    await openOrders(ANN);
    // Another tool changed the item after the page was read.
    engine.items.set('orders', [order('ann', 1, { total: { N: '13' }, note: { S: 'hi' }, Zeta: { BOOL: true } })]);

    openRow(1);
    await openedEditor('Edit item');

    expect(engine.of('GetItem').map((sent) => sent.body)).toEqual([
      { TableName: 'orders', Key: { customer: { S: 'ann' }, placed: { N: '1' } } },
    ]);
    expect(textarea().getTextareaValue()).toBe(
      written({
        customer: { S: 'ann' },
        placed: { N: '1' },
        Zeta: { BOOL: true },
        note: { S: 'hi' },
        total: { N: '13' },
      }),
    );
  });

  it('a row read through an index: GetItem from the table, by the table’s key alone', async () => {
    engine.on('Scan', () => ok({ Items: [{ status: { S: 'open' }, customer: { S: 'ann' }, placed: { N: '1' } }] }));
    await openOrders(ANN);

    openRow(1);
    await openedEditor('Edit item');

    expect(engine.of('GetItem').map((sent) => sent.body)).toEqual([
      { TableName: 'orders', Key: { customer: { S: 'ann' }, placed: { N: '1' } } },
    ]);
  });
});

describe('an item GetItem does not find', () => {
  it('no dialog; the Flashbar warning; the page read again', async () => {
    await openOrders(ANN, order('bo', 2));
    // Another tool deleted it after the page was read.
    engine.items.set('orders', [order('bo', 2)]);

    openRow(1);

    await expectFlash([['warning', '', 'This item is no longer in orders. It may have been deleted.']]);
    expect(PAGE.findModal()).toBeNull();
    await waitFor(() => {
      expect(engine.of('Scan')).toHaveLength(2);
    });
    await expectRows([['S bo', 'N 2']]);
  });
});

describe('Save, checked before sending', () => {
  it('a failing check: its message under the editor, nothing sent', async () => {
    await openOrders(ANN);
    fireEvent.click(itemsButton('Create item'));
    await openedEditor('Create item');

    const cases: [string, string][] = [
      ['nope', 'Enter the item as a JSON object of attribute values.'],
      ['[1]', 'Enter the item as a JSON object of attribute values.'],
      [
        '{"customer": {"S": "c"}, "placed": {"N": "1"}, "tags": {"L": [{"S": "x"}, {"X": 1}]}}',
        'tags[1] is not an attribute value. Write it as {"S": "text"}, {"N": "1"} and so on.',
      ],
      [
        '{"customer": {"S": "c"}, "placed": {"N": "1"}, "m": {"M": {"x": {"B": "not base64"}}}}',
        'm.x is not base64. Write a binary value in base64.',
      ],
      ['{"customer": {"S": "c"}}', 'The item must hold its key attribute placed of type N.'],
      ['{"customer": {"N": "1"}, "placed": {"N": "1"}}', 'The item must hold its key attribute customer of type S.'],
    ];
    for (const [entered, message] of cases) {
      textarea().setTextareaValue(entered);
      save();
      await waitFor(() => {
        expect(editorError()).toBe(message);
      });
    }
    expect(engine.of('PutItem')).toHaveLength(0);
    expect(PAGE.findModal()).not.toBeNull();
  });

  it('on edit, a key attribute changed: "The key cannot change. …", nothing sent', async () => {
    await openOrders(ANN);
    openRow(1);
    await openedEditor('Edit item');

    textarea().setTextareaValue(written({ customer: { S: 'ann' }, placed: { N: '2' }, note: { S: 'hi' } }));
    save();

    await waitFor(() => {
      expect(editorError()).toBe('The key cannot change. Create a new item to copy this one.');
    });
    expect(engine.of('PutItem')).toHaveLength(0);
  });

  it('in flight: "Save" disabled, a second press sends nothing', async () => {
    let answer: (value: Answer) => void = () => undefined;
    engine.on('PutItem', () => new Promise<Answer>((resolve) => (answer = resolve)));
    await openOrders(ANN);
    fireEvent.click(itemsButton('Create item'));
    await openedEditor('Create item');

    textarea().setTextareaValue(written({ customer: { S: 'bo' }, placed: { N: '2' } }));
    save();
    await waitFor(() => {
      expect(engine.of('PutItem')).toHaveLength(1);
    });
    expect(isDisabled(dialogButton('Save'))).toBe(true);
    save();
    fireEvent.click(dialogButton('Save'));
    expect(engine.of('PutItem')).toHaveLength(1);

    answer(ok({}));
    await waitFor(() => {
      expect(PAGE.findModal()).toBeNull();
    });
    expect(engine.of('PutItem')).toHaveLength(1);
  });
});

describe('Save, answered', () => {
  it('create: one PutItem on condition no item has the key; closed, "Item created in orders.", the page read again', async () => {
    await openOrders(ANN);
    fireEvent.click(itemsButton('Create item'));
    await openedEditor('Create item');

    textarea().setTextareaValue('{"customer": {"S": "bo"}, "placed": {"N": "2"}, "m": {"M": {"x": {"B": "aGk="}}}}');
    save();

    await expectFlash([['success', '', 'Item created in orders.']]);
    expect(PAGE.findModal()).toBeNull();
    expect(engine.of('PutItem').map((sent) => sent.body)).toEqual([
      {
        TableName: 'orders',
        Item: { customer: { S: 'bo' }, placed: { N: '2' }, m: { M: { x: { B: 'aGk=' } } } },
        ConditionExpression: 'attribute_not_exists(#pk)',
        ExpressionAttributeNames: { '#pk': 'customer' },
      },
    ]);
    await waitFor(() => {
      expect(engine.of('Scan')).toHaveLength(2);
    });
    await waitFor(() => {
      expect(rows().map((row) => row.slice(0, 2))).toEqual([
        ['S ann', 'N 1'],
        ['S bo', 'N 2'],
      ]);
    });
  });

  it('edit: one PutItem on condition the item exists; closed, "Item saved in orders.", the page read again', async () => {
    await openOrders(ANN);
    openRow(1);
    await openedEditor('Edit item');

    textarea().setTextareaValue(written({ customer: { S: 'ann' }, placed: { N: '1' }, note: { S: 'changed' } }));
    save();

    await expectFlash([['success', '', 'Item saved in orders.']]);
    expect(PAGE.findModal()).toBeNull();
    expect(engine.of('PutItem').map((sent) => sent.body)).toEqual([
      {
        TableName: 'orders',
        Item: { customer: { S: 'ann' }, placed: { N: '1' }, note: { S: 'changed' } },
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: { '#pk': 'customer' },
      },
    ]);
    await waitFor(() => {
      expect(engine.of('Scan')).toHaveLength(2);
    });
    await expectRows([['S ann', 'N 1', 'S changed']]);
  });

  it('create refused by the condition: its sentence before the code and message; the dialog kept with its text', async () => {
    await openOrders(ANN);
    fireEvent.click(itemsButton('Create item'));
    await openedEditor('Create item');
    const entered = written({ customer: { S: 'ann' }, placed: { N: '1' } });

    textarea().setTextareaValue(entered);
    save();

    await waitFor(() => {
      expect(editorAlert()).toEqual([
        'Creating the item failed',
        'An item with this key is already in orders. Open it to change it. ConditionalCheckFailedException: The conditional request failed',
      ]);
    });
    expect(textarea().getTextareaValue()).toBe(entered);
    expect(flashItems()).toEqual([]);
    expect(isDisabled(dialogButton('Save'))).toBe(false);
  });

  it('edit refused by the condition: "This item is no longer in orders. …" before the code and message', async () => {
    await openOrders(ANN);
    openRow(1);
    await openedEditor('Edit item');
    const entered = textarea().getTextareaValue();
    // Another tool deleted it while the editor was open.
    engine.items.set('orders', []);

    save();

    await waitFor(() => {
      expect(editorAlert()).toEqual([
        'Saving the item failed',
        'This item is no longer in orders. It may have been deleted. ConditionalCheckFailedException: The conditional request failed',
      ]);
    });
    expect(textarea().getTextareaValue()).toBe(entered);
    expect(engine.items.get('orders')).toEqual([]);
  });

  it('any other refusal: its code and message as they came; 501 and AccessDenied: their words', async () => {
    const answers: Answer[] = [
      refused(
        400,
        'ValidationException',
        'One or more parameter values were invalid: Input collection [a, a] contains duplicates.',
      ),
      NOT_IMPLEMENTED,
      refused(403, 'AccessDeniedException', 'no put'),
    ];
    let next = 0;
    engine.on('PutItem', () => answers[next++]);
    await openOrders(ANN);
    fireEvent.click(itemsButton('Create item'));
    await openedEditor('Create item');
    textarea().setTextareaValue(written({ customer: { S: 'bo' }, placed: { N: '2' }, s: { SS: ['a', 'a'] } }));

    const expected: [string, string][] = [
      [
        'Creating the item failed',
        'ValidationException: One or more parameter values were invalid: Input collection [a, a] contains duplicates.',
      ],
      ['Not implemented by the emulator', 'The emulator answered 501 Not Implemented for PutItem.'],
      ['Access denied', 'PutItem was refused: no put'],
    ];
    for (const shown of expected) {
      save();
      await waitFor(() => {
        expect(editorAlert()).toEqual(shown);
      });
    }
    expect(engine.of('PutItem')).toHaveLength(3);
    expect(PAGE.findModal()).not.toBeNull();
    expect(engine.of('Scan')).toHaveLength(1);
  });
});
