import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import type { ItemsRequest, QueryKey } from './api';
import { NEW_CONDITION } from './filter';
import {
  REREAD_DELAY_MS,
  useDeleteItems,
  useDeleteTable,
  useItemExploration,
  useOpenItem,
  usePutItem,
  useTableListing,
  useTableReading,
  type ItemExplorationOptions,
  type TableListingOptions,
} from './queries';

// The test plays the engine behind the page's `fetch`, in JSON 1.0 (issue 496, test-criteria.md "Unit s1 — .../dynamodb/queries.test.tsx"). Each `ListTables`, `Scan` and `Query` waits until
// the case answers it, so a case decides the order in which answers arrive; every other request is answered at once
// from `status`, the emulator's state as the case sets it, unless that says to hold it.

interface Answer {
  status: number;
  body: unknown;
}

interface Sent {
  operation: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  /** `Date.now()` when it was sent and when it was answered. */
  at: number;
  answeredAt: number | undefined;
  respond: (answer: Answer) => void;
}

/** A table's state in the emulator: its status, gone, a refusal, or a request held until the case answers it. */
type TableState = string | 'gone' | 'refuse' | 'hold';

class FakeEngine {
  readonly sent: Sent[] = [];
  readonly status = new Map<string, TableState>();

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-496' }), { status: 200 });
    }
    const operation = (request.headers.get('x-amz-target') ?? '').replace('DynamoDB_20120810.', '');
    const raw = await request.text();
    return new Promise((resolve, reject) => {
      const sent: Sent = {
        operation,
        body: raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>),
        signal: request.signal,
        at: Date.now(),
        answeredAt: undefined,
        respond: ({ status, body }) => {
          sent.answeredAt = Date.now();
          resolve(
            new Response(JSON.stringify(body), {
              status,
              headers: { 'content-type': 'application/x-amz-json-1.0' },
            }),
          );
        },
      };
      request.signal.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
      this.sent.push(sent);
      const answer = this.answer(sent);
      if (answer !== undefined) {
        sent.respond(answer);
      }
    });
  };

  private answer({ operation, body }: Sent): Answer | undefined {
    const name = String(body.TableName);
    if (operation === 'ListTables' || operation === 'Scan' || operation === 'Query') {
      return undefined;
    }
    if (operation !== 'DescribeTable' && operation !== 'DescribeTimeToLive') {
      return { status: 200, body: {} };
    }
    const state = this.status.get(name) ?? 'ACTIVE';
    if (state === 'hold') {
      return undefined;
    }
    if (state === 'gone') {
      return refusal('ResourceNotFoundException', `Requested resource not found: Table: ${name} not found`);
    }
    if (state === 'refuse') {
      return refusal('ValidationException', 'refused');
    }
    if (operation === 'DescribeTimeToLive') {
      return { status: 200, body: { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } } };
    }
    return { status: 200, body: { Table: description(name, state) } };
  }

  /** The n-th request of `operation` (from 0), once it has been sent. */
  async request(operation: string, n = 0): Promise<Sent> {
    await waitFor(() => {
      expect(this.of(operation).length).toBeGreaterThan(n);
    });
    return this.of(operation)[n] as Sent;
  }

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }

  /** The names of the `DescribeTable` requests, in the order sent. */
  described(): string[] {
    return this.of('DescribeTable').map(({ body }) => String(body.TableName));
  }
}

function refusal(code: string, message: string): Answer {
  return { status: 400, body: { __type: `com.amazonaws.dynamodb.v20120810#${code}`, message } };
}

function description(name: string, status: string): Record<string, unknown> {
  return {
    TableName: name,
    TableStatus: status,
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
    BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
  };
}

function listAnswer(names: string[], next?: string): Answer {
  return { status: 200, body: { TableNames: names, ...(next === undefined ? {} : { LastEvaluatedTableName: next }) } };
}

let nextPort = 8860;
let engine: FakeEngine;
let endpoint: string;
let client: QueryClient;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
  // As Studio's query client: nothing retried or refetched behind the screen's back.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderListing(options: Partial<TableListingOptions> = {}) {
  return renderHook((props: TableListingOptions) => useTableListing(props), {
    initialProps: { endpoint, pageSize: 25, search: '', connected: true, ...options },
    wrapper,
  });
}

/** The names of the tables a listing shows, once they are as expected. */
async function shown(listing: { current: { tables?: { name: string }[] | undefined } }, names: string[]) {
  await waitFor(() => {
    expect(listing.current.tables?.map(({ name }) => name)).toEqual(names);
  });
}

/** Lets `ms` pass on the fake clock, running what it starts. */
async function pass(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function itemsAnswer(keys: string[], next?: string): Answer {
  return {
    status: 200,
    body: {
      Items: keys.map((pk) => ({ pk: { S: pk } })),
      ...(next === undefined ? {} : { LastEvaluatedKey: { pk: { S: next } } }),
    },
  };
}

const SCAN: ItemsRequest = { table: 't-1', pageSize: 25, read: { kind: 'scan' } };

function renderItems(options: Partial<ItemExplorationOptions> = {}) {
  return renderHook((props: ItemExplorationOptions) => useItemExploration(props), {
    initialProps: { endpoint, request: SCAN, run: 0, connected: true, ...options },
    wrapper,
  });
}

async function shownItems(exploration: { current: { items?: { pk?: { S?: string } }[] | undefined } }, keys: string[]) {
  await waitFor(() => {
    expect(exploration.current.items?.map(({ pk }) => pk?.S)).toEqual(keys);
  });
}

/** The query keys of the cache whose fourth element is `kind`. */
function keysOf(kind: string): (readonly unknown[])[] {
  return client
    .getQueryCache()
    .getAll()
    .map(({ queryKey }) => queryKey)
    .filter((key) => key[3] === kind);
}

describe('query keys', () => {
  it('the list’s key holds the search, the page’s start name and the page size', async () => {
    const listing = renderListing({ pageSize: 10, search: 'ab' });
    (await engine.request('ListTables')).respond(listAnswer(['ab-', 'abb'], 'abb'));
    await shown(listing.result, ['ab-', 'abb']);
    expect(keysOf('list-tables')).toEqual([expect.arrayContaining([10, 'ab', null])]);

    act(() => {
      listing.result.current.goToPage(2);
    });
    const second = await engine.request('ListTables', 1);
    expect(second.body).toEqual({ Limit: 10, ExclusiveStartTableName: 'abb' });
    second.respond(listAnswer(['abc']));
    await shown(listing.result, ['abc']);
    expect(keysOf('list-tables')).toContainEqual(expect.arrayContaining([10, 'ab', 'abb']));

    listing.rerender({ endpoint, pageSize: 50, search: 'x', connected: true });
    const third = await engine.request('ListTables', 2);
    expect(third.body).toMatchObject({ Limit: 50 });
    expect(keysOf('list-tables')).toContainEqual(expect.arrayContaining([50, 'x', null]));
  });

  it('the items’ key holds the request and the page’s start key', async () => {
    const read: { kind: 'query' } & QueryKey = {
      kind: 'query',
      partition: { key: { name: 'pk', type: 'S' }, value: 'p1' },
      sort: { key: { name: 'sk', type: 'N' }, condition: 'between', values: ['2', '3'] },
      descending: true,
    };
    const request: ItemsRequest = { table: 't-1', index: 'by-l', pageSize: 50, read };
    const exploration = renderItems({ request });
    const first = await engine.request('Query');
    first.respond(itemsAnswer(['p1'], 'p1'));
    await shownItems(exploration.result, ['p1']);
    expect(keysOf('items')).toEqual([expect.arrayContaining([request, null])]);

    act(() => {
      exploration.result.current.goToPage(2);
    });
    const second = await engine.request('Query', 1);
    expect(second.body.ExclusiveStartKey).toEqual({ pk: { S: 'p1' } });
    expect(keysOf('items')).toContainEqual(expect.arrayContaining([request, '"pk":{"S":"p1"}']));

    const changes: ItemsRequest[] = [
      { table: request.table, pageSize: request.pageSize, read: request.read },
      { ...request, pageSize: 25 },
      { ...request, read: { ...read, descending: false } },
      { ...request, read: { ...read, partition: { key: { name: 'pk', type: 'S' }, value: 'p2' } } },
      { ...request, read: { kind: 'scan' } },
    ];
    for (const change of changes) {
      exploration.rerender({ endpoint, request: change, run: 0, connected: true });
      await waitFor(() => {
        expect(keysOf('items')).toContainEqual(expect.arrayContaining([change, null]));
      });
    }
  });
});

describe('pages of items', () => {
  it('"next page" asks with the last key; a page of none without a key ends the pages; page 1 is read again', async () => {
    const exploration = renderItems();
    (await engine.request('Scan')).respond(itemsAnswer(['a', 'b'], 'b'));
    await shownItems(exploration.result, ['a', 'b']);
    expect(exploration.result.current.openEnd).toBe(true);

    act(() => {
      exploration.result.current.goToPage(2);
    });
    const second = await engine.request('Scan', 1);
    expect(second.body).toEqual({ TableName: 't-1', Limit: 25, ExclusiveStartKey: { pk: { S: 'b' } } });
    second.respond(itemsAnswer([]));
    await shownItems(exploration.result, []);
    expect(exploration.result.current.openEnd).toBe(false);
    expect(exploration.result.current.currentPage).toBe(2);
    expect(exploration.result.current.pagesCount).toBe(2);

    act(() => {
      exploration.result.current.goToPage(1);
    });
    const again = await engine.request('Scan', 2);
    expect(again.body).toEqual({ TableName: 't-1', Limit: 25 });
  });

  it('a new "Run" of the same request starts at page 1; no request reads nothing', async () => {
    const exploration = renderItems();
    (await engine.request('Scan')).respond(itemsAnswer(['a'], 'a'));
    await shownItems(exploration.result, ['a']);
    act(() => {
      exploration.result.current.goToPage(2);
    });
    (await engine.request('Scan', 1)).respond(itemsAnswer(['b']));
    await shownItems(exploration.result, ['b']);

    exploration.rerender({ endpoint, request: SCAN, run: 1, connected: true });
    const run = await engine.request('Scan', 2);
    expect(run.body).toEqual({ TableName: 't-1', Limit: 25 });
    expect(exploration.result.current.currentPage).toBe(1);

    const none = renderItems({ request: undefined });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.of('Scan')).toHaveLength(3);
    expect(none.result.current.loading).toBe(false);
    expect(none.result.current.items).toBeUndefined();
  });

  it('a failed read is the query’s failure, with its operation', async () => {
    const exploration = renderItems({
      request: {
        table: 't-1',
        pageSize: 25,
        read: { kind: 'query', partition: { key: { name: 'pk', type: 'S' }, value: 'x' }, descending: false },
      },
    });
    (await engine.request('Query')).respond(refusal('ValidationException', 'bad'));
    await waitFor(() => {
      expect(exploration.result.current.failure).toEqual({
        kind: 'other',
        operation: 'Query',
        code: 'ValidationException',
        message: 'bad',
      });
    });
    expect(exploration.result.current.items).toBeUndefined();
  });
});

describe('a filtered exploration (issue 512)', () => {
  const FILTERED: ItemsRequest = {
    ...SCAN,
    filter: [{ ...NEW_CONDITION, name: 'status', value: 'open' }],
  };
  const OTHER: ItemsRequest = {
    ...SCAN,
    filter: [{ ...NEW_CONDITION, name: 'status', value: 'closed' }],
  };

  function counted(keys: string[], scanned: number, next?: string): Answer {
    const answer = itemsAnswer(keys, next);
    return { ...answer, body: { ...(answer.body as object), Count: keys.length, ScannedCount: scanned } };
  }

  it('a run with other conditions starts at page 1 with earlier pages dropped; "next page" keeps the conditions', async () => {
    const exploration = renderItems({ request: FILTERED });
    const first = await engine.request('Scan');
    expect(first.body).toMatchObject({
      FilterExpression: '#f0 = :f0',
      ExpressionAttributeValues: { ':f0': { S: 'open' } },
    });
    first.respond(counted(['a'], 25, 'k1'));
    await shownItems(exploration.result, ['a']);

    act(() => {
      exploration.result.current.goToPage(2);
    });
    const second = await engine.request('Scan', 1);
    expect(second.body).toEqual({
      TableName: 't-1',
      Limit: 25,
      ExclusiveStartKey: { pk: { S: 'k1' } },
      FilterExpression: '#f0 = :f0',
      ExpressionAttributeNames: { '#f0': 'status' },
      ExpressionAttributeValues: { ':f0': { S: 'open' } },
    });
    second.respond(counted(['b'], 25, 'k2'));
    await shownItems(exploration.result, ['b']);
    expect(exploration.result.current.pagesCount).toBe(2);

    exploration.rerender({ endpoint, request: OTHER, run: 1, connected: true });
    const run = await engine.request('Scan', 2);
    expect(run.body).not.toHaveProperty('ExclusiveStartKey');
    expect(run.body).toMatchObject({ ExpressionAttributeValues: { ':f0': { S: 'closed' } } });
    expect(exploration.result.current.currentPage).toBe(1);
    run.respond(counted(['c'], 25));
    await shownItems(exploration.result, ['c']);
    expect(exploration.result.current.pagesCount).toBe(1);
  });

  it('the shown page gives the number it read and whether its own answer carried a last key, after going back too', async () => {
    const exploration = renderItems({ request: FILTERED });
    (await engine.request('Scan')).respond(counted([], 25, 'k1'));
    await shownItems(exploration.result, []);
    expect(exploration.result.current.read).toBe(25);
    expect(exploration.result.current.more).toBe(true);

    act(() => {
      exploration.result.current.goToPage(2);
    });
    (await engine.request('Scan', 1)).respond(counted(['b', 'c'], 10));
    await shownItems(exploration.result, ['b', 'c']);
    expect(exploration.result.current.read).toBe(10);
    expect(exploration.result.current.more).toBe(false);

    act(() => {
      exploration.result.current.goToPage(1);
    });
    expect(exploration.result.current.read).toBeUndefined();
    (await engine.request('Scan', 2)).respond(counted([], 25, 'k1'));
    await shownItems(exploration.result, []);
    expect(exploration.result.current.read).toBe(25);
    expect(exploration.result.current.more).toBe(true);
    expect(exploration.result.current.pagesCount).toBe(2);
  });

  it('an answer of the earlier conditions that arrives after a new run is not shown', async () => {
    const exploration = renderItems({ request: FILTERED });
    const first = await engine.request('Scan');

    exploration.rerender({ endpoint, request: OTHER, run: 1, connected: true });
    const second = await engine.request('Scan', 1);
    second.respond(counted(['later'], 3));
    await shownItems(exploration.result, ['later']);
    first.respond(counted(['earlier'], 9));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(first.signal.aborted).toBe(true);
    expect(exploration.result.current.items?.map(({ pk }) => pk?.S)).toEqual(['later']);
    expect(exploration.result.current.read).toBe(3);
  });
});

describe('a table that is changing', () => {
  /** A listing whose page 1 is `names`, answered; resolves once every table of it is shown. */
  async function listed(names: string[]) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listing = renderListing();
    (await engine.request('ListTables')).respond(listAnswer(names));
    await shown(listing.result, names);
    return listing;
  }

  it.each(['CREATING', 'UPDATING', 'DELETING'])(
    'a %s row is read again alone 2 s after each answer until it is ACTIVE, and not after',
    async (status) => {
      engine.status.set('t-1', status);
      const listing = await listed(['t-1', 't-2']);
      expect(engine.described()).toEqual(['t-1', 't-2']);
      const answered = engine.of('DescribeTable')[0]?.answeredAt ?? 0;

      await pass(REREAD_DELAY_MS - 200);
      expect(engine.described()).toEqual(['t-1', 't-2']);
      await pass(400);
      expect(engine.described()).toEqual(['t-1', 't-2', 't-1']);
      const reread = engine.of('DescribeTable')[2];
      expect((reread?.at ?? 0) - answered).toBeGreaterThanOrEqual(REREAD_DELAY_MS);

      engine.status.set('t-1', 'ACTIVE');
      await pass(REREAD_DELAY_MS + 200);
      expect(engine.described()).toEqual(['t-1', 't-2', 't-1', 't-1']);
      await waitFor(() => {
        expect(listing.result.current.tables?.[0]?.status).toBe('ACTIVE');
      });
      await pass(REREAD_DELAY_MS * 3);
      expect(engine.described()).toHaveLength(4);
    },
  );

  it('an ACTIVE or other table is never read again by itself', async () => {
    engine.status.set('t-2', 'ARCHIVED');
    await listed(['t-1', 't-2']);
    await pass(REREAD_DELAY_MS * 3);
    expect(engine.described()).toEqual(['t-1', 't-2']);
  });

  it('a row a re-read finds gone leaves the page, and is not read after', async () => {
    engine.status.set('t-1', 'DELETING');
    const listing = await listed(['t-1', 't-2']);
    engine.status.set('t-1', 'gone');
    await pass(REREAD_DELAY_MS + 200);
    await shown(listing.result, ['t-2']);
    await pass(REREAD_DELAY_MS * 3);
    expect(engine.described()).toEqual(['t-1', 't-2', 't-1']);
  });

  it('a table’s page: CREATING read again until ACTIVE, then not; gone → "not found"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    engine.status.set('t-1', 'CREATING');
    engine.status.set('t-2', 'DELETING');
    const creating = renderHook(() => useTableReading({ endpoint, name: 't-1', connected: true }), { wrapper });
    const deleting = renderHook(() => useTableReading({ endpoint, name: 't-2', connected: true }), { wrapper });
    await waitFor(() => {
      expect(creating.result.current.read).toMatchObject({
        kind: 'found',
        table: { status: 'CREATING' },
        timeToLive: { kind: 'read', status: 'DISABLED' },
      });
      expect(deleting.result.current.read).toMatchObject({ kind: 'found', table: { status: 'DELETING' } });
    });

    engine.status.set('t-1', 'ACTIVE');
    engine.status.set('t-2', 'gone');
    await pass(REREAD_DELAY_MS + 200);
    await waitFor(() => {
      expect(creating.result.current.read).toMatchObject({ kind: 'found', table: { status: 'ACTIVE' } });
      expect(deleting.result.current.read).toEqual({ kind: 'not-found' });
    });
    const reads = engine.described().length;
    await pass(REREAD_DELAY_MS * 3);
    expect(engine.described()).toHaveLength(reads);
  });
});

describe('late answers', () => {
  it('a late answer of an earlier listing does not replace the later one', async () => {
    const listing = renderListing();
    const first = await engine.request('ListTables');

    listing.rerender({ endpoint, pageSize: 25, search: 'l', connected: true });
    const second = await engine.request('ListTables', 1);
    second.respond(listAnswer(['later']));
    await shown(listing.result, ['later']);
    first.respond(listAnswer(['earlier']));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(first.signal.aborted).toBe(true);
    expect(listing.result.current.tables?.map(({ name }) => name)).toEqual(['later']);
  });

  it('a late answer of an earlier request of items does not replace the later one', async () => {
    const exploration = renderItems();
    const first = await engine.request('Scan');

    exploration.rerender({ endpoint, request: { ...SCAN, pageSize: 50 }, run: 0, connected: true });
    const second = await engine.request('Scan', 1);
    second.respond(itemsAnswer(['later']));
    await shownItems(exploration.result, ['later']);
    first.respond(itemsAnswer(['earlier']));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(first.signal.aborted).toBe(true);
    expect(exploration.result.current.items?.map(({ pk }) => pk?.S)).toEqual(['later']);
  });
});

describe('a change reads the page and the list again', () => {
  /** A list, a table's page and its items on page 2, each answered, with the actions of the screens. */
  async function screens() {
    const view = renderHook(
      () => ({
        listing: useTableListing({ endpoint, pageSize: 25, search: '', connected: true }),
        reading: useTableReading({ endpoint, name: 't-1', connected: true }),
        items: useItemExploration({ endpoint, request: SCAN, run: 0, connected: true }),
        put: usePutItem(endpoint),
        deleteItems: useDeleteItems(endpoint),
        open: useOpenItem(endpoint),
        deleteTable: useDeleteTable(endpoint),
      }),
      { wrapper },
    );
    (await engine.request('ListTables')).respond(listAnswer(['t-1']));
    (await engine.request('Scan')).respond(itemsAnswer(['a'], 'a'));
    await waitFor(() => {
      expect(view.result.current.reading.read).toMatchObject({ kind: 'found' });
    });
    act(() => {
      view.result.current.items.goToPage(2);
    });
    (await engine.request('Scan', 1)).respond(itemsAnswer(['b']));
    await waitFor(() => {
      expect(view.result.current.items.items?.map(({ pk }) => pk?.S)).toEqual(['b']);
    });
    return view;
  }

  /** After an action: the list asked again, the table described again, the shown page of items asked again. */
  async function readAgain(scans: number, lists: number, describes: number) {
    const scan = await engine.request('Scan', scans);
    expect(scan.body).toEqual({ TableName: 't-1', Limit: 25, ExclusiveStartKey: { pk: { S: 'a' } } });
    await engine.request('ListTables', lists);
    await waitFor(() => {
      expect(engine.of('DescribeTable').length).toBeGreaterThan(describes);
    });
  }

  it('a saved item', async () => {
    const view = await screens();
    const describes = engine.of('DescribeTable').length;
    await act(async () => {
      await view.result.current.put.run({ table: 't-1', item: { pk: { S: 'c' } }, mode: 'create', partitionKey: 'pk' });
    });
    expect(engine.of('PutItem')).toHaveLength(1);
    await readAgain(2, 1, describes);
  });

  it('deleted items', async () => {
    const view = await screens();
    const describes = engine.of('DescribeTable').length;
    await act(async () => {
      await view.result.current.deleteItems.run({ table: 't-1', keys: [{ pk: { S: 'b' } }] });
    });
    expect(engine.of('DeleteItem')).toHaveLength(1);
    await readAgain(2, 1, describes);
  });

  it('an opened item the emulator no longer holds', async () => {
    const view = await screens();
    const describes = engine.of('DescribeTable').length;
    let result: unknown;
    await act(async () => {
      result = await view.result.current.open.run({
        table: 't-1',
        keys: { partition: { name: 'pk', type: 'S' } },
        row: { pk: { S: 'b' } },
      });
    });
    expect(result).toBe('no-such-item');
    await readAgain(2, 1, describes);
  });

  it('a deleted table', async () => {
    const view = await screens();
    const describes = engine.of('DescribeTable').length;
    await act(async () => {
      await view.result.current.deleteTable.run('t-1');
    });
    expect(engine.of('DeleteTable')).toHaveLength(1);
    await readAgain(2, 1, describes);
  });
});
