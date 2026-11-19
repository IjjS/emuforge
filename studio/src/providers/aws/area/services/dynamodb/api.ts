import {
  CreateTableCommand,
  DeleteItemCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  GetItemCommand,
  ListTablesCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  type AttributeDefinition,
  type AttributeValue,
  type CreateTableCommandInput,
  type GlobalSecondaryIndexDescription,
  type KeySchemaElement,
  type LocalSecondaryIndexDescription,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest, type RequestFailure } from '../../../../../lib/aws/request';
import { filterMembers, type Condition } from './filter';
import { base64ToBytes } from './item-json';
import { filterStart, isTableName, matchesFilter } from './start-name';

// The DynamoDB calls of the AWS area (issue 496, design.md; issue 72's `listTables`, `describeTable`, `createTable`
// and the delete of a table, adapted), through the engine, mapped to plain typed results. Every value in a result
// comes from the emulator's answer, unchanged; each is untrusted text. The client speaks the SDK's own protocol, JSON
// 1.0, which the engine relays; the factory sets everything else. Every command goes through the shared
// `sendRequest` with its operation's name, so a failed request rejects with its `RequestError` and an aborted one with
// the signal's reason. What this file reads of a failure is only the code with which the emulator says it holds no
// table of the name asked, which is not a failure here.

/** The operations of the DynamoDB screens, as a failure names them. */
export const OPERATIONS = {
  listTables: 'ListTables',
  describeTable: 'DescribeTable',
  describeTimeToLive: 'DescribeTimeToLive',
  createTable: 'CreateTable',
  deleteTable: 'DeleteTable',
  scan: 'Scan',
  query: 'Query',
  getItem: 'GetItem',
  putItem: 'PutItem',
  deleteItem: 'DeleteItem',
} as const;

/** The emulator's code for a table it does not hold. */
const RESOURCE_NOT_FOUND = 'ResourceNotFoundException';

/** The emulator's code for a refused condition (`attribute_not_exists`, `attribute_exists`). */
export const CONDITION_FAILED = 'ConditionalCheckFailedException';

/** The emulator holds no table of the name asked, or the name is one no table can have. */
export const NOT_FOUND = 'not-found';
export type NotFound = typeof NOT_FOUND;

/** `GetItem` answered without an item: the emulator holds none of that key. */
export const NO_SUCH_ITEM = 'no-such-item';
export type NoSuchItem = typeof NO_SUCH_ITEM;

/** An item as the client gives and takes it: attribute values by name, binary values as bytes. */
export type Item = Record<string, AttributeValue>;

/** A key's type as `AttributeDefinitions` gives it and the create form offers it: String, Number, Binary. */
export type KeyType = 'S' | 'N' | 'B';

/** A key attribute: its name, and its type as `AttributeDefinitions` gives it, absent when they lack it. */
export interface TableKey {
  name: string;
  type?: string;
}

/** The key attributes of a table or an index. */
export interface Keys {
  partition: TableKey;
  sort?: TableKey;
}

/** How a table's capacity is billed: on-demand, or provisioned with the units `ProvisionedThroughput` gives. */
export type Capacity = { mode: 'on-demand' } | { mode: 'provisioned'; read?: number; write?: number };

/** A secondary index of a table, as `DescribeTable` gives it. */
export interface Index {
  name: string;
  kind: 'global' | 'local';
  partitionKey?: TableKey;
  sortKey?: TableKey;
  /** `Projection.ProjectionType` as it came, and its `NonKeyAttributes`. */
  projection: { type?: string; nonKeyAttributes?: string[] };
  /** `IndexStatus` as it came; a local index has none. */
  status?: string;
}

/** A table's stream, from `StreamSpecification`: on with its view type as the API names it, or off. */
export type Stream = { enabled: false } | { enabled: true; viewType?: string };

/** One table, as `DescribeTable` gives it. A value the answer did not give is absent. */
export interface Table {
  name: string;
  /** `TableStatus` as it came. */
  status?: string;
  /** The `HASH` attribute of `KeySchema`. */
  partitionKey?: TableKey;
  /** The `RANGE` attribute of `KeySchema`. */
  sortKey?: TableKey;
  /** The global indexes, then the local ones, each in the answer's order. */
  indexes: Index[];
  /** On-demand when `BillingModeSummary.BillingMode` is `PAY_PER_REQUEST`, else provisioned. */
  capacity: Capacity;
  deletionProtection?: boolean;
  stream: Stream;
  creationTime?: Date;
  arn?: string;
}

const clients = new Map<string, DynamoDBClient>();

/**
 * The area's DynamoDB client for the engine at `endpoint`, one per endpoint for the life of the page, made by the
 * factory's general function from the SDK's class, with no setting of its own: no `protocol`, so the SDK's default,
 * JSON 1.0.
 */
function dynamodbClient(endpoint: string): DynamoDBClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(DynamoDBClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `{ [key]: value }`, or nothing when `value` is `undefined`. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function keyOf(
  schema: readonly KeySchemaElement[] | undefined,
  definitions: readonly AttributeDefinition[] | undefined,
  keyType: 'HASH' | 'RANGE',
): TableKey | undefined {
  const name = schema?.find((element) => element.KeyType === keyType)?.AttributeName;
  if (name === undefined) {
    return undefined;
  }
  const type = text(definitions?.find((definition) => definition.AttributeName === name)?.AttributeType);
  return type === undefined ? { name } : { name, type };
}

function indexOf(
  index: GlobalSecondaryIndexDescription | LocalSecondaryIndexDescription,
  kind: Index['kind'],
  definitions: readonly AttributeDefinition[] | undefined,
): Index {
  const nonKey = index.Projection?.NonKeyAttributes;
  return {
    name: index.IndexName ?? '',
    kind,
    ...optional('partitionKey', keyOf(index.KeySchema, definitions, 'HASH')),
    ...optional('sortKey', keyOf(index.KeySchema, definitions, 'RANGE')),
    projection: {
      ...optional('type', text(index.Projection?.ProjectionType)),
      ...optional('nonKeyAttributes', nonKey === undefined ? undefined : [...nonKey]),
    },
    ...optional('status', 'IndexStatus' in index ? text(index.IndexStatus) : undefined),
  };
}

/** The table a `DescribeTable` answer describes. */
function toTable(description: TableDescription | undefined, asked: string): Table {
  const {
    TableName,
    TableStatus,
    KeySchema,
    AttributeDefinitions,
    GlobalSecondaryIndexes,
    LocalSecondaryIndexes,
    BillingModeSummary,
    ProvisionedThroughput,
    DeletionProtectionEnabled,
    StreamSpecification,
    CreationDateTime,
    TableArn,
  } = description ?? {};
  const capacity: Capacity =
    BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST'
      ? { mode: 'on-demand' }
      : {
          mode: 'provisioned',
          ...optional('read', number(ProvisionedThroughput?.ReadCapacityUnits)),
          ...optional('write', number(ProvisionedThroughput?.WriteCapacityUnits)),
        };
  const stream: Stream =
    StreamSpecification?.StreamEnabled === true
      ? { enabled: true, ...optional('viewType', text(StreamSpecification.StreamViewType)) }
      : { enabled: false };
  return {
    name: TableName ?? asked,
    ...optional('status', text(TableStatus)),
    ...optional('partitionKey', keyOf(KeySchema, AttributeDefinitions, 'HASH')),
    ...optional('sortKey', keyOf(KeySchema, AttributeDefinitions, 'RANGE')),
    indexes: [
      ...(GlobalSecondaryIndexes ?? []).map((index) => indexOf(index, 'global', AttributeDefinitions)),
      ...(LocalSecondaryIndexes ?? []).map((index) => indexOf(index, 'local', AttributeDefinitions)),
    ],
    capacity,
    ...optional(
      'deletionProtection',
      typeof DeletionProtectionEnabled === 'boolean' ? DeletionProtectionEnabled : undefined,
    ),
    stream,
    ...optional(
      'creationTime',
      CreationDateTime instanceof Date && !Number.isNaN(CreationDateTime.getTime()) ? CreationDateTime : undefined,
    ),
    ...optional('arn', text(TableArn)),
  };
}

/** The request failed because the emulator holds no table of that name. */
function isNotFound(error: unknown): boolean {
  return error instanceof RequestError && error.failure.kind === 'other' && error.failure.code === RESOURCE_NOT_FOUND;
}

/**
 * The table `name` as `DescribeTable` gives it, or `NOT_FOUND` for `ResourceNotFoundException`. A name no table can
 * have is `NOT_FOUND` without a request: the emulator would answer `ValidationException` for it (probe-5 §1).
 */
export async function describeTable(endpoint: string, name: string, signal: AbortSignal): Promise<Table | NotFound> {
  signal.throwIfAborted();
  if (!isTableName(name)) {
    return NOT_FOUND;
  }
  const command = new DescribeTableCommand({ TableName: name });
  try {
    const output = await sendRequest(
      OPERATIONS.describeTable,
      (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
      signal,
    );
    return toTable(output.Table, name);
  } catch (error) {
    if (isNotFound(error)) {
      return NOT_FOUND;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The table list

/** What one page of the table list is asked with. */
export interface TablePageRequest {
  /** `Limit`, always sent. */
  pageSize: number;
  /** The `LastEvaluatedTableName` of the page before, sent as `ExclusiveStartTableName`. */
  after?: string;
  /**
   * The search's applied text; `''` or absent for none. A first page starts at the text's start name; every page is
   * cut at the first name that does not start with the text.
   */
  search?: string;
}

/** One page of the table list, in the order of `ListTables`. */
export interface TablePage {
  tables: Table[];
  /** The `LastEvaluatedTableName` to ask the next page with; absent on the last page. */
  next?: string;
}

/**
 * One page of the emulator's tables: one `ListTables`, then one `DescribeTable` per name of its answer, sent
 * together. A name whose `DescribeTable` answers `ResourceNotFoundException` (deleted between the two calls) is left
 * out; any other failure of any call is the failure of the page. With a search the page holds only the names that
 * start with its text and is the last once it was cut; a text no name can start with asks nothing.
 */
export async function listTables(
  endpoint: string,
  { pageSize, after, search = '' }: TablePageRequest,
  signal: AbortSignal,
): Promise<TablePage> {
  signal.throwIfAborted();
  let start = after;
  if (search !== '' && start === undefined) {
    const first = filterStart(search);
    if (first.kind === 'matches-nothing') {
      return { tables: [] };
    }
    start = first.kind === 'after' ? first.name : undefined;
  }
  const command = new ListTablesCommand({
    Limit: pageSize,
    ...(start === undefined ? {} : { ExclusiveStartTableName: start }),
  });
  const output = await sendRequest(
    OPERATIONS.listTables,
    (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
    signal,
  );
  const names = output.TableNames ?? [];
  const cut = search === '' ? -1 : names.findIndex((name) => !matchesFilter(name, search));
  const shown = cut === -1 ? names : names.slice(0, cut);
  const next = cut === -1 ? text(output.LastEvaluatedTableName) : undefined;

  const reads = await Promise.all(shown.map((name) => describeTable(endpoint, name, signal)));
  const tables = reads.filter((read): read is Table => read !== NOT_FOUND);
  return next === undefined ? { tables } : { tables, next };
}

// ---------------------------------------------------------------------------------------------------------------
// A table's page

/** The table's time to live: `TimeToLiveStatus` and `AttributeName` as they came, or the failure of its read. */
export type TimeToLiveRead =
  { kind: 'read'; status?: string; attribute?: string } | { kind: 'not-read'; failure: RequestFailure };

/** A table's page. */
export type TableRead = { kind: 'found'; table: Table; timeToLive: TimeToLiveRead } | { kind: 'not-found' };

/**
 * The page of table `name`: `DescribeTable` and `DescribeTimeToLive`, sent together. "Not found" for
 * `ResourceNotFoundException`, and without a request for a name no table can have. A failed `DescribeTimeToLive`
 * does not fail the page: its failure is the time to live's.
 */
export async function readTable(endpoint: string, name: string, signal: AbortSignal): Promise<TableRead> {
  signal.throwIfAborted();
  if (!isTableName(name)) {
    return { kind: 'not-found' };
  }
  const ttlCommand = new DescribeTimeToLiveCommand({ TableName: name });
  const timeToLive: Promise<TimeToLiveRead> = sendRequest(
    OPERATIONS.describeTimeToLive,
    (abortSignal) => dynamodbClient(endpoint).send(ttlCommand, { abortSignal }),
    signal,
  ).then(
    (output) => ({
      kind: 'read',
      ...optional('status', text(output.TimeToLiveDescription?.TimeToLiveStatus)),
      ...optional('attribute', text(output.TimeToLiveDescription?.AttributeName)),
    }),
    (error: unknown) => {
      if (error instanceof RequestError) {
        return { kind: 'not-read', failure: error.failure };
      }
      throw error;
    },
  );
  const [table, ttl] = await Promise.all([describeTable(endpoint, name, signal), timeToLive]);
  return table === NOT_FOUND ? { kind: 'not-found' } : { kind: 'found', table, timeToLive: ttl };
}

// ---------------------------------------------------------------------------------------------------------------
// Items: scan and query

/** A value the screen took as text was not base64 where a Binary key needs it; nothing was sent. */
export class NotBase64Error extends Error {
  readonly attribute: string;

  constructor(attribute: string) {
    super(`The value of ${attribute} is not base64 text.`);
    this.name = 'NotBase64Error';
    this.attribute = attribute;
  }
}

/** A key value typed as text, as the key's type: a String and a Number as written, a Binary the bytes of its base64. */
export function keyValue(name: string, type: string | undefined, value: string): AttributeValue {
  if (type === 'N') {
    return { N: value };
  }
  if (type === 'B') {
    const bytes = base64ToBytes(value);
    if (bytes === undefined) {
      throw new NotBase64Error(name);
    }
    return { B: bytes };
  }
  return { S: value };
}

/** A sort key condition of a query; "Any" is none. */
export type SortCondition = '=' | '<' | '<=' | '>' | '>=' | 'between' | 'begins_with';

/** What a query asks: the partition key's value, an optional sort key condition, and the order. */
export interface QueryKey {
  partition: { key: TableKey; value: string };
  sort?: { key: TableKey; condition: SortCondition; values: readonly [string] | readonly [string, string] };
  descending: boolean;
}

/** What a page of items is asked with: a scan or a query, of the table or one of its indexes. */
export interface ItemsRequest {
  table: string;
  /** The index's name; absent for the table itself. */
  index?: string;
  /** `Limit`, always sent. */
  pageSize: number;
  read: { kind: 'scan' } | ({ kind: 'query' } & QueryKey);
  /** The filter's conditions, joined with `AND`; absent or empty for none. */
  filter?: readonly Condition[];
}

/**
 * A page of items, in the emulator's order, the `LastEvaluatedKey` to ask the next one with, and the number of items
 * the emulator read for it (`ScannedCount`), which a filter may leave above the items shown.
 */
export interface ItemPage {
  items: Item[];
  next?: Item;
  /** `ScannedCount` as it came; absent when the answer gave none. */
  read?: number;
}

/** The members of `Query` that a `QueryKey` makes. */
function queryMembers({ partition, sort, descending }: QueryKey) {
  const names: Record<string, string> = { '#pk': partition.key.name };
  const values: Item = { ':pk': keyValue(partition.key.name, partition.key.type, partition.value) };
  let expression = '#pk = :pk';
  if (sort !== undefined) {
    names['#sk'] = sort.key.name;
    const [first, second = ''] = sort.values;
    values[':sk1'] = keyValue(sort.key.name, sort.key.type, first);
    if (sort.condition === 'between') {
      values[':sk2'] = keyValue(sort.key.name, sort.key.type, second);
      expression += ' AND #sk BETWEEN :sk1 AND :sk2';
    } else if (sort.condition === 'begins_with') {
      expression += ' AND begins_with(#sk, :sk1)';
    } else {
      expression += ` AND #sk ${sort.condition} :sk1`;
    }
  }
  return {
    KeyConditionExpression: expression,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ...(descending ? { ScanIndexForward: false } : {}),
  };
}

/**
 * The members of `request`'s read and filter: the query's key condition, the filter's `FilterExpression`, and their
 * names and values in one map each. A scan with no condition holding a value sends no `ExpressionAttributeValues`;
 * with no condition at all, nothing of the filter.
 */
function readMembers(request: ItemsRequest) {
  const { read } = request;
  const query = read.kind === 'query' ? queryMembers(read) : undefined;
  const filter = filterMembers(request.filter ?? []);
  if (filter === undefined) {
    return query ?? {};
  }
  const names = { ...query?.ExpressionAttributeNames, ...filter.names };
  const values = { ...query?.ExpressionAttributeValues, ...filter.values };
  return {
    ...query,
    FilterExpression: filter.expression,
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length === 0 ? {} : { ExpressionAttributeValues: values }),
  };
}

/**
 * One page of `request`: a `Scan` or a `Query`, with `IndexName` only for an index, `ExclusiveStartKey` only after
 * page 1 (`startKey`, the previous page's `LastEvaluatedKey`) and the filter's members only with a condition. Rejects
 * with `NotBase64Error`, before sending, for a Binary key value that is not base64, and with the filter's
 * `FilterValueError` for a Binary condition value that is not.
 */
export async function readItems(
  endpoint: string,
  request: ItemsRequest,
  startKey: Item | undefined,
  signal: AbortSignal,
): Promise<ItemPage> {
  signal.throwIfAborted();
  const common = {
    TableName: request.table,
    Limit: request.pageSize,
    ...(request.index === undefined ? {} : { IndexName: request.index }),
    ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
  };
  const members = readMembers(request);
  const output =
    request.read.kind === 'scan'
      ? await (() => {
          const command = new ScanCommand({ ...common, ...members });
          return sendRequest(
            OPERATIONS.scan,
            (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
            signal,
          );
        })()
      : await (() => {
          const command = new QueryCommand({ ...common, ...members });
          return sendRequest(
            OPERATIONS.query,
            (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
            signal,
          );
        })();
  const items = output.Items ?? [];
  const next = output.LastEvaluatedKey;
  const read = number(output.ScannedCount);
  return {
    items,
    ...(next === undefined || Object.keys(next).length === 0 ? {} : { next }),
    ...optional('read', read),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Items: get, put, delete

/** The key of `item` by the table's key attributes, whatever else it holds (a row of an index's result included). */
export function keyOfItem(item: Item, keys: Keys): Item {
  const key: Item = {};
  for (const { name } of [keys.partition, ...(keys.sort === undefined ? [] : [keys.sort])]) {
    const value = item[name];
    if (value !== undefined) {
      key[name] = value;
    }
  }
  return key;
}

/**
 * The item of `table` whose key `row` holds, read again from the table (never an index) by the table's key attributes
 * only; `NO_SUCH_ITEM` when `GetItem` answers without one.
 */
export async function getItem(
  endpoint: string,
  table: string,
  keys: Keys,
  row: Item,
  signal: AbortSignal,
): Promise<Item | NoSuchItem> {
  const command = new GetItemCommand({ TableName: table, Key: keyOfItem(row, keys) });
  const output = await sendRequest(
    OPERATIONS.getItem,
    (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
    signal,
  );
  return output.Item ?? NO_SUCH_ITEM;
}

/**
 * Save of the item editor: one `PutItem`. On create with the condition that no item has the key
 * (`attribute_not_exists`), on edit with the condition that the item still exists (`attribute_exists`), so neither
 * overwrites nor brings back an item behind the developer's back. A refused condition is `CONDITION_FAILED`.
 */
export async function putItem(
  endpoint: string,
  table: string,
  item: Item,
  { mode, partitionKey }: { mode: 'create' | 'edit'; partitionKey: string },
  signal: AbortSignal,
): Promise<void> {
  const command = new PutItemCommand({
    TableName: table,
    Item: item,
    ConditionExpression: mode === 'create' ? 'attribute_not_exists(#pk)' : 'attribute_exists(#pk)',
    ExpressionAttributeNames: { '#pk': partitionKey },
  });
  await sendRequest(
    OPERATIONS.putItem,
    (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
    signal,
  );
}

/** What "Delete" of items did: the keys deleted, and each that failed with its failure, each in the order asked. */
export interface DeleteItemsResult {
  deleted: Item[];
  failed: { key: Item; failure: RequestFailure }[];
}

/**
 * "Delete" of the selected items: one `DeleteItem` per key, in order, each sent after the previous one's answer, with
 * no condition; a refused one does not stop the next. Rejects only with `signal`'s reason, once it aborts.
 */
export async function deleteItems(
  endpoint: string,
  table: string,
  keys: readonly Item[],
  signal: AbortSignal,
): Promise<DeleteItemsResult> {
  signal.throwIfAborted();
  const result: DeleteItemsResult = { deleted: [], failed: [] };
  for (const key of keys) {
    const command = new DeleteItemCommand({ TableName: table, Key: key });
    try {
      await sendRequest(
        OPERATIONS.deleteItem,
        (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
        signal,
      );
      result.deleted.push(key);
    } catch (error) {
      if (!(error instanceof RequestError)) {
        throw error;
      }
      result.failed.push({ key, failure: error.failure });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Create and delete a table

/** What "Create table" sends. */
export interface NewTable {
  name: string;
  partitionKey: { name: string; type: KeyType };
  sortKey?: { name: string; type: KeyType };
  capacity: { mode: 'on-demand' } | { mode: 'provisioned'; read: number; write: number };
}

/**
 * The one `CreateTable` of "Create table": the keys and their definitions, and `PAY_PER_REQUEST` with no throughput or
 * `PROVISIONED` with both units. Rejects with the shared module's `RequestError`.
 */
export async function createTable(endpoint: string, table: NewTable, signal: AbortSignal): Promise<void> {
  const keys = [
    { ...table.partitionKey, role: 'HASH' as const },
    ...(table.sortKey === undefined ? [] : [{ ...table.sortKey, role: 'RANGE' as const }]),
  ];
  const { capacity } = table;
  const billing: Partial<CreateTableCommandInput> =
    capacity.mode === 'provisioned'
      ? {
          BillingMode: 'PROVISIONED',
          ProvisionedThroughput: { ReadCapacityUnits: capacity.read, WriteCapacityUnits: capacity.write },
        }
      : { BillingMode: 'PAY_PER_REQUEST' };
  const command = new CreateTableCommand({
    TableName: table.name,
    KeySchema: keys.map(({ name, role }) => ({ AttributeName: name, KeyType: role })),
    AttributeDefinitions: keys.map(({ name, type }) => ({ AttributeName: name, AttributeType: type })),
    ...billing,
  });
  await sendRequest(
    OPERATIONS.createTable,
    (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
    signal,
  );
}

/** "Delete" / "Delete table": one `DeleteTable`; a protected table is sent too, and the emulator refuses it. */
export async function deleteTable(endpoint: string, name: string, signal: AbortSignal): Promise<void> {
  const command = new DeleteTableCommand({ TableName: name });
  await sendRequest(
    OPERATIONS.deleteTable,
    (abortSignal) => dynamodbClient(endpoint).send(command, { abortSignal }),
    signal,
  );
}
