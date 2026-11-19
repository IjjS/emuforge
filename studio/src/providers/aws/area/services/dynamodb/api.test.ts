// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  createTable,
  deleteItems,
  deleteTable,
  describeTable,
  getItem,
  listTables,
  NO_SUCH_ITEM,
  NOT_FOUND,
  NotBase64Error,
  putItem,
  readItems,
  readTable,
  type ItemsRequest,
  type Keys,
  type NewTable,
} from './api';

// The test plays the engine behind the page's `fetch`: its session route, and every AWS request as it leaves the
// browser. DynamoDB speaks JSON 1.0: `POST /`, the operation in `X-Amz-Target`, a JSON body (issue 496, test-criteria.md "Unit s1 — .../dynamodb/api.test.ts").

interface Answer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface Sent {
  url: string;
  method: string;
  operation: string;
  target: string | null;
  contentType: string | null;
  body: Record<string, unknown>;
  signal: AbortSignal;
}

type Handler = (sent: Sent) => Answer | 'hold' | Promise<Answer>;

const JSON_1_0 = 'application/x-amz-json-1.0';
const TARGET_PREFIX = 'DynamoDB_20120810.';

class FakeEngine {
  readonly sent: Sent[] = [];
  handle: Handler = (sent) => ok(defaultAnswer(sent));

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-496' }), { status: 200 });
    }
    const target = request.headers.get('x-amz-target');
    const raw = await request.text();
    const sent: Sent = {
      url: request.url,
      method: request.method,
      operation: (target ?? '').replace(TARGET_PREFIX, ''),
      target,
      contentType: request.headers.get('content-type'),
      body: raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>),
      signal: request.signal,
    };
    this.sent.push(sent);
    const answer = this.handle(sent);
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    const { status, body, headers } = await answer;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': JSON_1_0, ...headers },
    });
  };

  operations(): string[] {
    return this.sent.map(({ operation }) => operation);
  }

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }
}

function ok(body: unknown): Answer {
  return { status: 200, body };
}

/** A refusal in the emulator's JSON 1.0 shape. */
function refusal(code: string, message: string, status = 400): Answer {
  return { status, body: { __type: `com.amazonaws.dynamodb.v20120810#${code}`, message } };
}

/** A table of `DescribeTable`, with a partition key `pk` of type `S`. */
function description(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    TableName: name,
    TableStatus: 'ACTIVE',
    KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
    ProvisionedThroughput: { ReadCapacityUnits: 0, WriteCapacityUnits: 0 },
    BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
    ...extra,
  };
}

function defaultAnswer(sent: Sent): unknown {
  switch (sent.operation) {
    case 'ListTables':
      return { TableNames: [] };
    case 'DescribeTable':
      return { Table: description(String(sent.body.TableName)) };
    case 'DescribeTimeToLive':
      return { TimeToLiveDescription: { TimeToLiveStatus: 'DISABLED' } };
    case 'Scan':
    case 'Query':
      return { Items: [], Count: 0, ScannedCount: 0 };
    case 'CreateTable':
      return { TableDescription: description(String(sent.body.TableName), { TableStatus: 'CREATING' }) };
    case 'DeleteTable':
      return { TableDescription: description(String(sent.body.TableName), { TableStatus: 'DELETING' }) };
    default:
      return {};
  }
}

/** A promise and the function that settles it, so a case decides when an answer arrives. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function failure(promise: Promise<unknown>): Promise<RequestFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RequestError);
    return (error as RequestError).failure;
  }
  throw new Error('the call resolved');
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 8820;
let engine: FakeEngine;
let endpoint: string;
const signal = () => new AbortController().signal;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'api.ts'), 'utf8');

const KEYS: Keys = { partition: { name: 'pk', type: 'S' }, sort: { name: 'sk', type: 'N' } };

describe('a command', () => {
  it('goes to the engine as POST / with X-Amz-Target and the JSON 1.0 content type, from the factory with no protocol', async () => {
    await readItems(endpoint, { table: 'orders', pageSize: 25, read: { kind: 'scan' } }, undefined, signal());

    expect(engine.sent).toHaveLength(1);
    const [sent] = engine.sent;
    expect(sent?.url).toBe(`${endpoint}/`);
    expect(sent?.method).toBe('POST');
    expect(sent?.target).toBe('DynamoDB_20120810.Scan');
    expect(sent?.contentType).toBe(JSON_1_0);
    expect(SOURCE).toContain('createAwsClient(DynamoDBClient, { endpoint })');
    expect(SOURCE).not.toMatch(/protocol\s*:/);
  });

  it('every command goes through sendRequest with its operation’s name', () => {
    const sends = [...SOURCE.matchAll(/\.send\(/g)].length;
    const through = [...SOURCE.matchAll(/sendRequest\(\s*OPERATIONS\.\w+,/g)].length;
    expect(sends).toBeGreaterThan(0);
    expect(through).toBe(sends);
  });

  it.each([
    ['Scan', () => readItems(endpoint, { table: 't-1', pageSize: 25, read: { kind: 'scan' } }, undefined, signal())],
    ['GetItem', () => getItem(endpoint, 't-1', KEYS, { pk: { S: 'a' }, sk: { N: '1' } }, signal())],
    ['PutItem', () => putItem(endpoint, 't-1', { pk: { S: 'a' } }, { mode: 'create', partitionKey: 'pk' }, signal())],
    ['DeleteTable', () => deleteTable(endpoint, 't-1', signal())],
  ])('a 501 of %s is "not implemented" with its name; AccessDenied gives the reason', async (operation, call) => {
    engine.handle = () => ({ status: 501, body: { __type: 'NotImplemented', message: 'no' } });
    expect(await failure(call())).toEqual({ kind: 'not-implemented', operation });

    engine.handle = () => refusal('AccessDeniedException', 'denied by policy', 403);
    expect(await failure(call())).toEqual({ kind: 'access-denied', operation, message: 'denied by policy' });
  });

  it('gives the code and message of a refusal in the emulator’s shape', async () => {
    engine.handle = () => refusal('ResourceInUseException', 'Table already exists: t-1');
    const table: NewTable = { name: 't-1', partitionKey: { name: 'pk', type: 'S' }, capacity: { mode: 'on-demand' } };
    expect(await failure(createTable(endpoint, table, signal()))).toEqual({
      kind: 'other',
      operation: 'CreateTable',
      code: 'ResourceInUseException',
      message: 'Table already exists: t-1',
    });
  });
});

describe('the table list', () => {
  it('ListTables with Limit, then one DescribeTable per name; the tables and the next name', async () => {
    engine.handle = (sent) =>
      sent.operation === 'ListTables'
        ? ok({ TableNames: ['beta', 'alpha', 'gamma'], LastEvaluatedTableName: 'gamma' })
        : ok(defaultAnswer(sent));

    const page = await listTables(endpoint, { pageSize: 25 }, signal());

    expect(engine.of('ListTables').map(({ body }) => body)).toEqual([{ Limit: 25 }]);
    expect(engine.of('DescribeTable').map(({ body }) => body.TableName)).toEqual(['beta', 'alpha', 'gamma']);
    expect(page.tables.map(({ name }) => name)).toEqual(['beta', 'alpha', 'gamma']);
    expect(page.next).toBe('gamma');
  });

  it('a next page is asked with ExclusiveStartTableName', async () => {
    await listTables(endpoint, { pageSize: 10, after: 'orders' }, signal());
    expect(engine.of('ListTables').map(({ body }) => body)).toEqual([{ Limit: 10, ExclusiveStartTableName: 'orders' }]);
  });

  it('a search starts at its start name and is cut at the first name that does not start with it', async () => {
    engine.handle = (sent) =>
      sent.operation === 'ListTables'
        ? ok({ TableNames: ['ab-', 'abb', 'ac'], LastEvaluatedTableName: 'ac' })
        : ok(defaultAnswer(sent));

    const page = await listTables(endpoint, { pageSize: 3, search: 'ab' }, signal());

    expect(engine.of('ListTables')[0]?.body).toEqual({ Limit: 3, ExclusiveStartTableName: `aa${'z'.repeat(253)}` });
    expect(page.tables.map(({ name }) => name)).toEqual(['ab-', 'abb']);
    expect(page.next).toBeUndefined();
  });

  it('a search outside the name alphabet asks nothing', async () => {
    expect(await listTables(endpoint, { pageSize: 25, search: 'a b' }, signal())).toEqual({ tables: [] });
    expect(engine.sent).toHaveLength(0);
  });

  it('a name answering ResourceNotFoundException is left out, the others kept in order', async () => {
    engine.handle = (sent) => {
      if (sent.operation === 'ListTables') {
        return ok({ TableNames: ['one', 'two', 'three'] });
      }
      return sent.body.TableName === 'two'
        ? refusal('ResourceNotFoundException', 'Requested resource not found: Table: two not found')
        : ok(defaultAnswer(sent));
    };
    const page = await listTables(endpoint, { pageSize: 25 }, signal());
    expect(page.tables.map(({ name }) => name)).toEqual(['one', 'three']);
  });

  it('any other failure of a DescribeTable fails the read', async () => {
    engine.handle = (sent) => {
      if (sent.operation === 'ListTables') {
        return ok({ TableNames: ['one', 'two'] });
      }
      return sent.body.TableName === 'two' ? refusal('ValidationException', 'boom') : ok(defaultAnswer(sent));
    };
    expect(await failure(listTables(endpoint, { pageSize: 25 }, signal()))).toEqual({
      kind: 'other',
      operation: 'DescribeTable',
      code: 'ValidationException',
      message: 'boom',
    });
  });

  it('a failure of ListTables fails the read', async () => {
    engine.handle = () => refusal('ValidationException', 'bad start');
    expect(await failure(listTables(endpoint, { pageSize: 25 }, signal()))).toMatchObject({
      operation: 'ListTables',
      code: 'ValidationException',
    });
  });
});

describe('a table as DescribeTable gives it', () => {
  it('every value of design.md: keys, indexes, capacity, deletion protection, stream, creation, ARN', async () => {
    const created = '2026-11-19T09:05:03.500Z';
    engine.handle = () =>
      ok({
        Table: {
          TableName: 'orders',
          TableStatus: 'ACTIVE',
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
            { AttributeName: 'gpk', AttributeType: 'S' },
            { AttributeName: 'lsk', AttributeType: 'N' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'by-g',
              KeySchema: [{ AttributeName: 'gpk', KeyType: 'HASH' }],
              Projection: { ProjectionType: 'KEYS_ONLY' },
              IndexStatus: 'ACTIVE',
            },
          ],
          LocalSecondaryIndexes: [
            {
              IndexName: 'by-l',
              KeySchema: [
                { AttributeName: 'pk', KeyType: 'HASH' },
                { AttributeName: 'lsk', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['a', 'b'] },
            },
          ],
          BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
          ProvisionedThroughput: { ReadCapacityUnits: 0, WriteCapacityUnits: 0 },
          DeletionProtectionEnabled: true,
          StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' },
          ItemCount: 0,
          TableSizeBytes: 0,
          CreationDateTime: Date.parse(created) / 1000,
          TableArn: 'arn:aws:dynamodb:us-east-1:000000000000:table/orders',
        },
      });

    expect(await describeTable(endpoint, 'orders', signal())).toEqual({
      name: 'orders',
      status: 'ACTIVE',
      partitionKey: { name: 'pk', type: 'S' },
      sortKey: { name: 'sk', type: 'S' },
      indexes: [
        {
          name: 'by-g',
          kind: 'global',
          partitionKey: { name: 'gpk', type: 'S' },
          projection: { type: 'KEYS_ONLY' },
          status: 'ACTIVE',
        },
        {
          name: 'by-l',
          kind: 'local',
          partitionKey: { name: 'pk', type: 'S' },
          sortKey: { name: 'lsk', type: 'N' },
          projection: { type: 'INCLUDE', nonKeyAttributes: ['a', 'b'] },
        },
      ],
      capacity: { mode: 'on-demand' },
      deletionProtection: true,
      stream: { enabled: true, viewType: 'NEW_AND_OLD_IMAGES' },
      creationTime: new Date(created),
      arn: 'arn:aws:dynamodb:us-east-1:000000000000:table/orders',
    });
  });

  it('provisioned with the units of ProvisionedThroughput; no stream is off', async () => {
    engine.handle = () =>
      ok({
        Table: {
          TableName: 'plain',
          TableStatus: 'CREATING',
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'B' }],
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 7 },
        },
      });
    expect(await describeTable(endpoint, 'plain', signal())).toEqual({
      name: 'plain',
      status: 'CREATING',
      partitionKey: { name: 'id', type: 'B' },
      indexes: [],
      capacity: { mode: 'provisioned', read: 5, write: 7 },
      stream: { enabled: false },
    });
  });

  it('a name no table can have is "not found" with no request', async () => {
    expect(await describeTable(endpoint, 'ab', signal())).toBe(NOT_FOUND);
    expect(await readTable(endpoint, 'a b', signal())).toEqual({ kind: 'not-found' });
    expect(engine.sent).toHaveLength(0);
  });
});

describe('a table’s page', () => {
  it('DescribeTable and DescribeTimeToLive together: the table and its time to live', async () => {
    engine.handle = (sent) =>
      sent.operation === 'DescribeTimeToLive'
        ? ok({ TimeToLiveDescription: { TimeToLiveStatus: 'ENABLING', AttributeName: 'expires' } })
        : ok(defaultAnswer(sent));

    const read = await readTable(endpoint, 'orders', signal());

    expect(engine.operations().sort()).toEqual(['DescribeTable', 'DescribeTimeToLive']);
    expect(read).toEqual({
      kind: 'found',
      table: expect.objectContaining({ name: 'orders' }),
      timeToLive: { kind: 'read', status: 'ENABLING', attribute: 'expires' },
    });
  });

  it('"not found" for ResourceNotFoundException; a failed time to live does not fail the page', async () => {
    engine.handle = () => refusal('ResourceNotFoundException', 'Requested resource not found');
    expect(await readTable(endpoint, 'gone', signal())).toEqual({ kind: 'not-found' });

    engine.handle = (sent) =>
      sent.operation === 'DescribeTimeToLive' ? refusal('ValidationException', 'boom') : ok(defaultAnswer(sent));
    expect(await readTable(endpoint, 'orders', signal())).toEqual({
      kind: 'found',
      table: expect.objectContaining({ name: 'orders' }),
      timeToLive: {
        kind: 'not-read',
        failure: { kind: 'other', operation: 'DescribeTimeToLive', code: 'ValidationException', message: 'boom' },
      },
    });
  });
});

describe('a scan and a query', () => {
  const scan: ItemsRequest = { table: 'orders', pageSize: 25, read: { kind: 'scan' } };

  it('a scan of the table: TableName and Limit, no IndexName, no ExclusiveStartKey on page 1', async () => {
    engine.handle = () => ok({ Items: [{ pk: { S: 'c1' }, b: { B: 'aGk=' } }], LastEvaluatedKey: { pk: { S: 'c1' } } });

    const page = await readItems(endpoint, scan, undefined, signal());

    expect(engine.sent[0]?.body).toEqual({ TableName: 'orders', Limit: 25 });
    expect(page.items).toEqual([{ pk: { S: 'c1' }, b: { B: new Uint8Array([104, 105]) } }]);
    expect(page.next).toEqual({ pk: { S: 'c1' } });
  });

  it('a scan of an index after page 1: IndexName and ExclusiveStartKey; a page without a key has no next', async () => {
    const page = await readItems(endpoint, { ...scan, index: 'by-g', pageSize: 50 }, { pk: { S: 'c1' } }, signal());

    expect(engine.sent[0]?.body).toEqual({
      TableName: 'orders',
      Limit: 50,
      IndexName: 'by-g',
      ExclusiveStartKey: { pk: { S: 'c1' } },
    });
    expect(page).toEqual({ items: [] });
  });

  it('a query with no sort condition: #pk = :pk, the key name in ExpressionAttributeNames', async () => {
    await readItems(
      endpoint,
      {
        table: 'orders',
        pageSize: 25,
        read: { kind: 'query', partition: { key: { name: 'status', type: 'S' }, value: 'p1' }, descending: false },
      },
      undefined,
      signal(),
    );
    expect(engine.of('Query')[0]?.body).toEqual({
      TableName: 'orders',
      Limit: 25,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'status' },
      ExpressionAttributeValues: { ':pk': { S: 'p1' } },
    });
  });

  it.each([
    ['=', ['2'], '#pk = :pk AND #sk = :sk1'],
    ['<', ['2'], '#pk = :pk AND #sk < :sk1'],
    ['<=', ['2'], '#pk = :pk AND #sk <= :sk1'],
    ['>', ['2'], '#pk = :pk AND #sk > :sk1'],
    ['>=', ['2'], '#pk = :pk AND #sk >= :sk1'],
    ['between', ['2', '3'], '#pk = :pk AND #sk BETWEEN :sk1 AND :sk2'],
    ['begins_with', ['2'], '#pk = :pk AND begins_with(#sk, :sk1)'],
  ] as const)('the condition %s → %s, values typed as the key', async (condition, values, expression) => {
    await readItems(
      endpoint,
      {
        table: 'orders',
        index: 'by-l',
        pageSize: 100,
        read: {
          kind: 'query',
          partition: { key: { name: 'pk', type: 'S' }, value: 'p1' },
          sort: { key: { name: 'name', type: 'N' }, condition, values },
          descending: true,
        },
      },
      { pk: { S: 'p1' }, name: { N: '1' } },
      signal(),
    );
    expect(engine.of('Query')[0]?.body).toEqual({
      TableName: 'orders',
      Limit: 100,
      IndexName: 'by-l',
      ExclusiveStartKey: { pk: { S: 'p1' }, name: { N: '1' } },
      KeyConditionExpression: expression,
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'name' },
      ExpressionAttributeValues: {
        ':pk': { S: 'p1' },
        ':sk1': { N: '2' },
        ...(values.length === 2 ? { ':sk2': { N: '3' } } : {}),
      },
      ScanIndexForward: false,
    });
  });

  it('a Binary key value goes as the bytes its base64 decodes to', async () => {
    engine.handle = () => ok({ Items: [{ id: { B: 'AAH+/w==' } }] });
    const page = await readItems(
      endpoint,
      {
        table: 'bin',
        pageSize: 25,
        read: { kind: 'query', partition: { key: { name: 'id', type: 'B' }, value: 'AAH+/w==' }, descending: false },
      },
      undefined,
      signal(),
    );
    expect(engine.of('Query')[0]?.body.ExpressionAttributeValues).toEqual({ ':pk': { B: 'AAH+/w==' } });
    expect(page.items[0]?.id?.B).toEqual(new Uint8Array([0, 1, 254, 255]));
  });

  it('a Binary key value that is not base64 is refused before anything is sent', async () => {
    const call = readItems(
      endpoint,
      {
        table: 'bin',
        pageSize: 25,
        read: { kind: 'query', partition: { key: { name: 'id', type: 'B' }, value: 'not base64' }, descending: false },
      },
      undefined,
      signal(),
    );
    await expect(call).rejects.toBeInstanceOf(NotBase64Error);
    expect(engine.sent).toHaveLength(0);
  });

  it('a refusal of a query is its code and message', async () => {
    engine.handle = () => refusal('ValidationException', 'The BETWEEN operator requires upper bound …');
    const call = readItems(
      endpoint,
      {
        table: 'orders',
        pageSize: 25,
        read: {
          kind: 'query',
          partition: { key: { name: 'pk', type: 'S' }, value: 'p1' },
          sort: { key: { name: 'sk', type: 'N' }, condition: 'between', values: ['10', '2'] },
          descending: false,
        },
      },
      undefined,
      signal(),
    );
    expect(await failure(call)).toEqual({
      kind: 'other',
      operation: 'Query',
      code: 'ValidationException',
      message: 'The BETWEEN operator requires upper bound …',
    });
  });
});

describe('an item', () => {
  it('opened from an index’s row: GetItem on the table, no IndexName, the table’s key attributes only', async () => {
    engine.handle = () => ok({ Item: { pk: { S: 'p1' }, sk: { N: '1' }, g: { S: 'x' }, v: { S: 'full' } } });

    const item = await getItem(endpoint, 'orders', KEYS, { pk: { S: 'p1' }, sk: { N: '1' }, g: { S: 'x' } }, signal());

    expect(engine.sent[0]?.operation).toBe('GetItem');
    expect(engine.sent[0]?.body).toEqual({ TableName: 'orders', Key: { pk: { S: 'p1' }, sk: { N: '1' } } });
    expect(item).toEqual({ pk: { S: 'p1' }, sk: { N: '1' }, g: { S: 'x' }, v: { S: 'full' } });
  });

  it('GetItem without an item → "no such item"', async () => {
    engine.handle = () => ok({});
    expect(await getItem(endpoint, 'orders', KEYS, { pk: { S: 'p1' }, sk: { N: '1' } }, signal())).toBe(NO_SUCH_ITEM);
  });

  it('create → PutItem with attribute_not_exists(#pk); edit → attribute_exists(#pk)', async () => {
    const item = { pk: { S: 'a' }, sk: { N: '1' }, x: { B: new Uint8Array([104, 105]) } };
    await putItem(endpoint, 'orders', item, { mode: 'create', partitionKey: 'pk' }, signal());
    await putItem(endpoint, 'orders', item, { mode: 'edit', partitionKey: 'pk' }, signal());

    const expected = (condition: string) => ({
      TableName: 'orders',
      Item: { pk: { S: 'a' }, sk: { N: '1' }, x: { B: 'aGk=' } },
      ConditionExpression: condition,
      ExpressionAttributeNames: { '#pk': 'pk' },
    });
    expect(engine.of('PutItem').map(({ body }) => body)).toEqual([
      expected('attribute_not_exists(#pk)'),
      expected('attribute_exists(#pk)'),
    ]);
  });

  it('a refused condition is ConditionalCheckFailedException with its message', async () => {
    engine.handle = () => refusal('ConditionalCheckFailedException', 'The conditional request failed');
    expect(
      await failure(putItem(endpoint, 'orders', { pk: { S: 'a' } }, { mode: 'edit', partitionKey: 'pk' }, signal())),
    ).toEqual({
      kind: 'other',
      operation: 'PutItem',
      code: 'ConditionalCheckFailedException',
      message: 'The conditional request failed',
    });
  });
});

describe('delete items', () => {
  it('one DeleteItem per item, in order, each after the previous answer; a failed one does not stop the next', async () => {
    const answers = [deferred<Answer>(), deferred<Answer>(), deferred<Answer>()];
    let index = 0;
    engine.handle = () => {
      const answer = answers[index];
      index += 1;
      return answer === undefined ? ok({}) : answer.promise;
    };
    const keys = [{ pk: { S: 'a' } }, { pk: { S: 'b' } }, { pk: { S: 'c' } }];

    const result = deleteItems(endpoint, 'orders', keys, signal());

    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(1);
    });
    answers[0]?.resolve(ok({}));
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(2);
    });
    answers[1]?.resolve(refusal('ValidationException', 'The provided key element does not match the schema'));
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(3);
    });
    answers[2]?.resolve(ok({}));

    expect(await result).toEqual({
      deleted: [{ pk: { S: 'a' } }, { pk: { S: 'c' } }],
      failed: [
        {
          key: { pk: { S: 'b' } },
          failure: {
            kind: 'other',
            operation: 'DeleteItem',
            code: 'ValidationException',
            message: 'The provided key element does not match the schema',
          },
        },
      ],
    });
    expect(engine.sent.map(({ operation, body }) => [operation, body])).toEqual(
      keys.map((key) => ['DeleteItem', { TableName: 'orders', Key: key }]),
    );
  });

  it('ends at once when its signal aborts', async () => {
    engine.handle = () => 'hold';
    const controller = new AbortController();
    const result = deleteItems(endpoint, 'orders', [{ pk: { S: 'a' } }, { pk: { S: 'b' } }], controller.signal);
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(1);
    });
    const reason = new Error('left');
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(engine.sent).toHaveLength(1);
  });
});

describe('create and delete a table', () => {
  it('on-demand: PAY_PER_REQUEST with no throughput; the partition key alone', async () => {
    await createTable(
      endpoint,
      { name: 'orders', partitionKey: { name: 'pk', type: 'S' }, capacity: { mode: 'on-demand' } },
      signal(),
    );
    expect(engine.of('CreateTable')[0]?.body).toEqual({
      TableName: 'orders',
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('provisioned: PROVISIONED with both units; a sort key adds its definition and RANGE', async () => {
    await createTable(
      endpoint,
      {
        name: 'orders',
        partitionKey: { name: 'id', type: 'B' },
        sortKey: { name: 'n', type: 'N' },
        capacity: { mode: 'provisioned', read: 5, write: 7 },
      },
      signal(),
    );
    expect(engine.of('CreateTable')[0]?.body).toEqual({
      TableName: 'orders',
      KeySchema: [
        { AttributeName: 'id', KeyType: 'HASH' },
        { AttributeName: 'n', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'id', AttributeType: 'B' },
        { AttributeName: 'n', AttributeType: 'N' },
      ],
      BillingMode: 'PROVISIONED',
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 7 },
    });
  });

  it('delete table → one DeleteTable; a protected table’s refusal is its code and message', async () => {
    await deleteTable(endpoint, 'orders', signal());
    expect(engine.sent.map(({ operation, body }) => [operation, body])).toEqual([
      ['DeleteTable', { TableName: 'orders' }],
    ]);

    const message =
      'Resource cannot be deleted as it is currently protected against deletion. Disable deletion protection first.';
    engine.handle = () => refusal('ValidationException', message);
    expect(await failure(deleteTable(endpoint, 'p', signal()))).toEqual({
      kind: 'other',
      operation: 'DeleteTable',
      code: 'ValidationException',
      message,
    });
  });
});
