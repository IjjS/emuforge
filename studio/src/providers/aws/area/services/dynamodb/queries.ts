import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  OPERATIONS,
  putItem,
  readItems,
  readTable,
  type DeleteItemsResult,
  type Item,
  type ItemPage,
  type ItemsRequest,
  type Keys,
  type NewTable,
  type NoSuchItem,
  type NotFound,
  type Table,
  type TablePage,
  type TableRead,
} from './api';
import { isChanging } from './format';
import { compactText, compareCodePoints } from './item-json';

// The TanStack Query hooks of the DynamoDB screens (issue 496, design.md; issue 72's `useTableListing` and
// `useTableReading`, adapted). Nothing is kept for a later mount and nothing is shown from an earlier reading:
// every read is a request of its own. A request no longer wanted is aborted, and its late answer never replaces a
// newer one. A table being created, updated or deleted is read again by itself until it is none of the three. A page of items
// follows the API's own `LastEvaluatedKey`.

/** Every key of the DynamoDB screens for the engine at `endpoint` starts with this. */
export function dynamodbKey(endpoint: string | undefined): readonly unknown[] {
  return ['aws', 'dynamodb', endpoint ?? null];
}

/** The key of the generation every listing and table reading of `endpoint` holds in its own key. */
function generationKey(endpoint: string | undefined): unknown[] {
  return [...dynamodbKey(endpoint), 'listing-generation'];
}

/** A table being created, updated or deleted is read again this long after the previous answer for it. */
export const REREAD_DELAY_MS = 2000;

/** Why a request failed, from what it rejected with. */
function failureOf(error: unknown, operation: string): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/** A number per mount, so a page of an earlier mount is never shown. */
let mounts = 0;
/** One more each time the listings of an endpoint are invalidated (after a create, a delete or an update). */
let listingGenerations = 0;

/**
 * The generation of the listings and readings of `endpoint`: it changes when an action invalidates it, so a listing
 * then starts again at page 1 and a table's page reads again. It is computed here and asks nothing of the
 * engine.
 */
function useListingGeneration(endpoint: string | undefined): number {
  const query = useQuery({
    queryKey: generationKey(endpoint),
    queryFn: () => (listingGenerations += 1),
    initialData: 0,
    staleTime: Infinity,
    retry: false,
  });
  return query.data;
}

/** `connected` became true after `failed` was seen: the reading is to be made again. */
function useReconnect(connected: boolean, failed: boolean, readAgain: () => void): void {
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && failed) {
      readAgain();
    }
  }
}

/** What the re-reads of an answer found, by table name: the table as last read, or `NOT_FOUND` once it is gone. */
type Rereads = ReadonlyMap<string, Table | NotFound>;

const NO_REREADS: Rereads = new Map();

/**
 * Reads again by itself each table of `tables` whose status is `CREATING`, `UPDATING` or `DELETING`, alone, with
 * `DescribeTable`, `REREAD_DELAY_MS` after the answer that showed it so and again after each answer, until it is
 * none of the three or is gone. A failed re-read ends that table's re-reads and is not reported. `found`
 * receives each answer. Everything pending is dropped, and aborted, when `tables` or `endpoint` changes or the
 * screen leaves.
 */
function useStatusRereads(
  endpoint: string | undefined,
  tables: readonly Table[] | undefined,
  found: (name: string, read: Table | NotFound) => void,
): void {
  const latest = useRef(found);
  useEffect(() => {
    latest.current = found;
  });
  useEffect(() => {
    if (endpoint === undefined || tables === undefined) {
      return;
    }
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const follow = (table: Table) => {
      if (!isChanging(table.status)) {
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        describeTable(endpoint, table.name, controller.signal).then(
          (read) => {
            if (controller.signal.aborted) {
              return;
            }
            latest.current(table.name, read);
            if (read !== NOT_FOUND) {
              follow(read);
            }
          },
          () => {
            // Not reported, and not read again until the page is.
          },
        );
      }, REREAD_DELAY_MS);
      timers.add(timer);
    };
    tables.forEach(follow);
    return () => {
      controller.abort();
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [endpoint, tables]);
}

// ---------------------------------------------------------------------------------------------------------------
// The table list

export interface TableListingOptions {
  /** The engine's address, `http://127.0.0.1:<port>`; nothing is asked while it is not known. */
  endpoint: string | undefined;
  /** `Limit` of every page. */
  pageSize: number;
  /** The search's applied text (issue 72's start name); `''` for none. */
  search: string;
  /** The connection is connected: a failed reading is made again when it becomes so. */
  connected: boolean;
}

/** The counter after the title: the tables of the pages read, with "+" while more remain. */
export interface TableCount {
  total: number;
  more: boolean;
}

export interface TableListing {
  /** The shown page's tables, in the answer's order, as last read; `undefined` until its answer, or when it failed. */
  tables: Table[] | undefined;
  /** Why the shown page could not be read; `undefined` while it is read or once it is. */
  failure: RequestFailure | undefined;
  /** A read of the shown page is in flight. */
  loading: boolean;
  /** `undefined` while no page of this listing has been read. */
  count: TableCount | undefined;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this listing knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read carried a next start name: more pages may follow. */
  openEnd: boolean;
  /** Shows page `page` (from 1) of this listing, read again; a page this listing has no start name for is ignored. */
  goToPage: (page: number) => void;
  /** Starts a new listing at page 1, dropping every start name ("Refresh", "Retry"). */
  refresh: () => void;
}

/** What the listing learnt from one page's last answer. */
interface PageRead {
  count: number;
  next: string | undefined;
}

/** Where the user is in one listing. */
interface Position {
  listing: string;
  /** The page asked for, from 0. */
  page: number;
  /** One more on every move, so a page shown again is read again. */
  visit: number;
  /** The last read of each page of this listing, from page 0, up to the last page read. */
  reads: readonly PageRead[];
}

/** Page 1 of `listing`, nothing read yet. */
function fresh(listing: string): Position {
  return { listing, page: 0, visit: 0, reads: [] };
}

/** `reads` with page `page`'s answer as its last read; the later pages stay only while its next name is the same. */
function withRead(reads: readonly PageRead[], page: number, count: number, next: string | undefined): PageRead[] {
  const before = reads[page];
  const later = before !== undefined && before.next === next && next !== undefined ? reads.slice(page + 1) : [];
  return [...reads.slice(0, page), { count, next }, ...later];
}

/** The tables of `answer` as its re-reads last found them, a table that is gone left out. */
function applied(answer: TablePage, rereads: Rereads): Table[] {
  return answer.tables.flatMap((table) => {
    const read = rereads.get(table.name);
    return read === NOT_FOUND ? [] : [read ?? table];
  });
}

/**
 * The table list of the emulator behind the engine at `endpoint`, one page at a time, following the API's own start
 * names; with a search, the names that start with its text.
 */
export function useTableListing({ endpoint, pageSize, search, connected }: TableListingOptions): TableListing {
  const [mount] = useState(() => (mounts += 1));
  const [refreshes, setRefreshes] = useState(0);
  const generation = useListingGeneration(endpoint);
  const listing = JSON.stringify([endpoint ?? null, mount, generation, refreshes, pageSize, search]);

  const [stored, setPosition] = useState<Position>(() => fresh(listing));
  // A change of listing starts at page 1 with no start name.
  const position: Position = stored.listing === listing ? stored : fresh(listing);
  const after = position.page === 0 ? undefined : position.reads[position.page - 1]?.next;

  const query = useQuery({
    queryKey: [
      ...dynamodbKey(endpoint),
      'list-tables',
      pageSize,
      search,
      after ?? null,
      mount,
      generation,
      refreshes,
      position.page,
      position.visit,
    ],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      const page = position.page;
      const answer = await listTables(
        endpoint,
        { pageSize, search, ...(after === undefined ? {} : { after }) },
        signal,
      );
      // Kept as this page's last read only while the user is still on it in the same listing.
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        return at.page === page
          ? { ...at, reads: withRead(at.reads, page, answer.tables.length, answer.next) }
          : current;
      });
      return answer;
    },
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const answer = query.data;

  // The re-reads of the page shown, by the answer they follow: a new answer starts with none.
  const [rereads, setRereads] = useState<{ of: TablePage | undefined; found: Rereads }>({
    of: undefined,
    found: NO_REREADS,
  });
  const found = rereads.of === answer ? rereads.found : NO_REREADS;
  const page = position.page;
  useStatusRereads(endpoint, answer?.tables, (name, read) => {
    setRereads((current) => {
      const next = new Map(current.of === answer ? current.found : NO_REREADS);
      next.set(name, read);
      return { of: answer, found: next };
    });
    if (read === NOT_FOUND) {
      // The page's count drops by one, as it is last read.
      setPosition((current) => {
        const last = current.reads[page];
        return current.listing === listing && last !== undefined
          ? {
              ...current,
              reads: current.reads.map((each, index) => (index === page ? { ...each, count: each.count - 1 } : each)),
            }
          : current;
      });
    }
  });

  const tables = answer === undefined ? undefined : applied(answer, found);
  const reads =
    answer === undefined || tables === undefined
      ? position.reads
      : withRead(position.reads, position.page, tables.length, answer.next);
  const last = reads[reads.length - 1];
  const openEnd = last?.next !== undefined;
  const failed = query.isError;

  const goToPage = useCallback(
    (target: number) => {
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        const index = target - 1;
        const known = index === 0 || at.reads[index - 1]?.next !== undefined;
        return Number.isInteger(index) && index >= 0 && known ? { ...at, page: index, visit: at.visit + 1 } : current;
      });
    },
    [listing],
  );

  const refresh = useCallback(() => {
    setRefreshes((current) => current + 1);
  }, []);

  useReconnect(connected, failed, refresh);

  return {
    tables,
    failure: failed ? failureOf(query.error, OPERATIONS.listTables) : undefined,
    loading: query.isFetching || (endpoint === undefined && answer === undefined),
    count: last === undefined ? undefined : { total: reads.reduce((sum, read) => sum + read.count, 0), more: openEnd },
    currentPage: position.page + 1,
    pagesCount: Math.max(reads.length, position.page + 1),
    openEnd,
    goToPage,
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A table's page

export interface TableReadingOptions {
  endpoint: string | undefined;
  name: string;
  connected: boolean;
}

export interface TableReading {
  /** The table, or "not found"; `undefined` until the first answer of this reading, or when it failed. */
  read: TableRead | undefined;
  /** Why the reading failed; a failed re-read is never shown. */
  failure: RequestFailure | undefined;
  /** The reading's first answer has not arrived. */
  loading: boolean;
  /** Reads the table again, from nothing shown ("Refresh", "Retry"). */
  refresh: () => void;
}

/**
 * The table `name` of the emulator behind the engine at `endpoint`. While it is being created, updated or
 * deleted it is read again by itself as a row of the list is; once a re-read says it is gone the page is
 * "not found".
 */
export function useTableReading({ endpoint, name, connected }: TableReadingOptions): TableReading {
  const [mount] = useState(() => (mounts += 1));
  const [readings, setReadings] = useState(0);
  const generation = useListingGeneration(endpoint);

  const query = useQuery({
    queryKey: [...dynamodbKey(endpoint), 'table', name, mount, generation, readings],
    queryFn: ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return readTable(endpoint, name, signal);
    },
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const data = query.data;

  const [reread, setReread] = useState<{ of: TableRead | undefined; table: Table | NotFound | undefined }>({
    of: undefined,
    table: undefined,
  });
  const latest = reread.of === data ? reread.table : undefined;
  // One list per answer, so the re-reads follow that answer and stop with it.
  const followed = useMemo(() => (data?.kind === 'found' ? [data.table] : undefined), [data]);
  useStatusRereads(endpoint, followed, (_, table) => {
    setReread({ of: data, table });
  });

  const refresh = useCallback(() => {
    setReadings((current) => current + 1);
  }, []);

  const failed = query.isError;
  useReconnect(connected, failed, refresh);

  let read: TableRead | undefined = data;
  if (data?.kind === 'found' && latest !== undefined) {
    read = latest === NOT_FOUND ? { kind: 'not-found' } : { ...data, table: latest };
  }

  return {
    read: failed ? undefined : read,
    failure: failed ? failureOf(query.error, OPERATIONS.describeTable) : undefined,
    loading: data === undefined && (query.isFetching || endpoint === undefined),
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A table's items

export interface ItemExplorationOptions {
  /** The engine's address; nothing is asked while it is not known. */
  endpoint: string | undefined;
  /** The request "Run" applied (at first the scan of the table); `undefined` reads nothing (a table not active). */
  request: ItemsRequest | undefined;
  /** One more on each "Run": the same request run again starts a new exploration at page 1. */
  run: number;
  /** The connection is connected: a failed reading is made again when it becomes so. */
  connected: boolean;
}

export interface ItemExploration {
  /** The shown page's items, in the emulator's order; `undefined` until its answer, or when it failed. */
  items: Item[] | undefined;
  /** Why the shown page could not be read; `undefined` while it is read or once it is. */
  failure: RequestFailure | undefined;
  /** A read of the shown page is in flight and none of it is shown. */
  loading: boolean;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this exploration knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read carried a `LastEvaluatedKey`: more pages may follow. */
  openEnd: boolean;
  /** The number of items the emulator read for the shown page (`ScannedCount`); `undefined` until its answer. */
  read: number | undefined;
  /** The shown page's own answer carried a `LastEvaluatedKey`. */
  more: boolean;
  /** Shows page `page` (from 1), read again with its start key; a page with no known start key is ignored. */
  goToPage: (page: number) => void;
  /** Reads the shown page again with its start key (the header's "Refresh"). */
  refresh: () => void;
}

/** What the exploration learnt from one page's last answer: its `LastEvaluatedKey`. */
interface ItemPageRead {
  next: Item | undefined;
}

interface ItemPosition {
  exploration: string;
  page: number;
  visit: number;
  reads: readonly ItemPageRead[];
}

function freshItems(exploration: string): ItemPosition {
  return { exploration, page: 0, visit: 0, reads: [] };
}

/** A key as text, its attributes in code point order, so two equal keys are one text. */
function keyText(key: Item | undefined): string | null {
  if (key === undefined) {
    return null;
  }
  return Object.keys(key)
    .sort(compareCodePoints)
    .map((name) => `${JSON.stringify(name)}:${key[name] === undefined ? '' : compactText(key[name])}`)
    .join(',');
}

/** `reads` with page `page`'s answer; the later pages stay only while its next key is the same. */
function withItemRead(reads: readonly ItemPageRead[], page: number, next: Item | undefined): ItemPageRead[] {
  const before = reads[page];
  const later =
    before !== undefined && next !== undefined && keyText(before.next) === keyText(next) ? reads.slice(page + 1) : [];
  return [...reads.slice(0, page), { next }, ...later];
}

/**
 * The items `request` reads, one page at a time, following the API's own `LastEvaluatedKey`. A change of the request
 * or a new "Run" starts at page 1 with earlier pages dropped; an action on the table's items or the table reads the
 * shown page again with its start key.
 */
export function useItemExploration({ endpoint, request, run, connected }: ItemExplorationOptions): ItemExploration {
  const [mount] = useState(() => (mounts += 1));
  const [refreshes, setRefreshes] = useState(0);
  const generation = useListingGeneration(endpoint);
  const exploration = JSON.stringify([endpoint ?? null, mount, request ?? null, run]);

  const [stored, setPosition] = useState<ItemPosition>(() => freshItems(exploration));
  const position: ItemPosition = stored.exploration === exploration ? stored : freshItems(exploration);
  const startKey = position.page === 0 ? undefined : position.reads[position.page - 1]?.next;

  const query = useQuery({
    queryKey: [
      ...dynamodbKey(endpoint),
      'items',
      request ?? null,
      keyText(startKey),
      run,
      mount,
      generation,
      refreshes,
      position.page,
      position.visit,
    ],
    queryFn: async ({ signal }): Promise<ItemPage> => {
      if (endpoint === undefined || request === undefined) {
        throw new Error('Nothing to read yet.');
      }
      const page = position.page;
      const answer = await readItems(endpoint, request, startKey, signal);
      setPosition((current) => {
        const at = current.exploration === exploration ? current : freshItems(exploration);
        return at.page === page ? { ...at, reads: withItemRead(at.reads, page, answer.next) } : current;
      });
      return answer;
    },
    enabled: endpoint !== undefined && request !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const answer = query.data;
  const reads = answer === undefined ? position.reads : withItemRead(position.reads, position.page, answer.next);
  const openEnd = reads[reads.length - 1]?.next !== undefined;
  const failed = query.isError;

  const goToPage = useCallback(
    (target: number) => {
      setPosition((current) => {
        const at = current.exploration === exploration ? current : freshItems(exploration);
        const index = target - 1;
        const known = index === 0 || at.reads[index - 1]?.next !== undefined;
        return Number.isInteger(index) && index >= 0 && known ? { ...at, page: index, visit: at.visit + 1 } : current;
      });
    },
    [exploration],
  );

  const refresh = useCallback(() => {
    setRefreshes((current) => current + 1);
  }, []);

  useReconnect(connected, failed, refresh);

  const shown = failed ? undefined : answer;
  return {
    items: shown?.items,
    read: shown === undefined ? undefined : (shown.read ?? shown.items.length),
    more: shown?.next !== undefined,
    failure: failed
      ? failureOf(query.error, request?.read.kind === 'query' ? OPERATIONS.query : OPERATIONS.scan)
      : undefined,
    loading: request !== undefined && answer === undefined && (query.isFetching || endpoint === undefined),
    currentPage: position.page + 1,
    pagesCount: Math.max(reads.length, position.page + 1),
    openEnd,
    goToPage,
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

/** Every listing, table reading and page of items of `endpoint` is read again. */
function useReadAgain(endpoint: string | undefined): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: generationKey(endpoint) }), [client, endpoint]);
}

/**
 * One action of the screens through the engine at `endpoint`: its requests are aborted when the screen leaves, and
 * once they are answered the listings, table readings and pages of items of the endpoint are read again: a list
 * starts a new listing at page 1, a table's page reads again, the shown page of items is read again.
 */
function useAction<Input, Output>(
  endpoint: string | undefined,
  run: (endpoint: string, input: Input, signal: AbortSignal) => Promise<Output>,
  readAgainOn: 'settled' | 'success' | 'never',
) {
  const readAgain = useReadAgain(endpoint);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  return useMutation<Output, unknown, Input>({
    mutationFn: (input) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      controller.current = new AbortController();
      return run(endpoint, input, controller.current.signal);
    },
    ...(readAgainOn === 'settled' ? { onSettled: readAgain } : {}),
    ...(readAgainOn === 'success' ? { onSuccess: readAgain } : {}),
  });
}

export interface TableCreation {
  /** Sends the one `CreateTable`; a second call while it is in flight sends nothing. */
  create: (table: NewTable) => void;
  /** It is in flight. */
  pending: boolean;
  /** The name of the table the emulator accepted; `undefined` until it did. */
  created: string | undefined;
  /** Why the last attempt failed; `undefined` while none did. */
  failure: RequestFailure | undefined;
}

/** "Create table": a success reads the listings again. */
export function useCreateTable(endpoint: string | undefined): TableCreation {
  const mutation = useAction(
    endpoint,
    async (at: string, table: NewTable, signal: AbortSignal) => {
      await createTable(at, table, signal);
      return table.name;
    },
    'success',
  );
  const { mutate, isPending, data, error } = mutation;
  // Set at the press itself, so a second press before the next render sends nothing either.
  const inFlight = useRef(false);
  const create = useCallback(
    (table: NewTable) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      mutate(table, {
        onSettled: () => {
          inFlight.current = false;
        },
      });
    },
    [mutate],
  );
  return {
    create,
    pending: isPending,
    created: data,
    failure: error === null ? undefined : failureOf(error, OPERATIONS.createTable),
  };
}

/** An action whose result the screen reports itself. */
export interface Action<Input, Output> {
  /** Resolves with the result, or rejects with the shared `RequestError` (or the reason the screen left first). */
  run: (input: Input) => Promise<Output>;
  /** Its requests are in flight. */
  pending: boolean;
}

/** "Delete" / "Delete table": one `DeleteTable`; the listings are read again once it is answered. */
export function useDeleteTable(endpoint: string | undefined): Action<string, void> {
  const mutation = useAction(endpoint, deleteTable, 'settled');
  return { run: mutation.mutateAsync, pending: mutation.isPending };
}

/** What opening an item reads: the table, its key attributes, and the row the item was chosen from. */
export interface ItemToOpen {
  table: string;
  keys: Keys;
  row: Item;
}

/**
 * Opening an item: `GetItem` from the table by the table's key. When it finds none, the page of items is read again
 * (another tool deleted it) and `NO_SUCH_ITEM` is the result.
 */
export function useOpenItem(endpoint: string | undefined): Action<ItemToOpen, Item | NoSuchItem> {
  const readAgain = useReadAgain(endpoint);
  const mutation = useAction(
    endpoint,
    async (at: string, { table, keys, row }: ItemToOpen, signal: AbortSignal) => {
      const item = await getItem(at, table, keys, row, signal);
      if (item === NO_SUCH_ITEM) {
        await readAgain();
      }
      return item;
    },
    'never',
  );
  return { run: mutation.mutateAsync, pending: mutation.isPending };
}

/** What Save of the item editor sends. */
export interface ItemToSave {
  table: string;
  item: Item;
  mode: 'create' | 'edit';
  /** The table's partition key, the attribute of the condition. */
  partitionKey: string;
}

/** Save of the item editor: one conditional `PutItem`; the page of items is read again once it succeeded. */
export function usePutItem(endpoint: string | undefined): Action<ItemToSave, void> {
  const mutation = useAction(
    endpoint,
    (at: string, { table, item, mode, partitionKey }: ItemToSave, signal: AbortSignal) =>
      putItem(at, table, item, { mode, partitionKey }, signal),
    'success',
  );
  return { run: mutation.mutateAsync, pending: mutation.isPending };
}

/** What "Delete" of items sends: the table and the key of each selected item, in the page's order. */
export interface ItemsToDelete {
  table: string;
  keys: readonly Item[];
}

/** "Delete" of items: one `DeleteItem` per item, in order; the page of items is read again once they are answered. */
export function useDeleteItems(endpoint: string | undefined): Action<ItemsToDelete, DeleteItemsResult> {
  const mutation = useAction(
    endpoint,
    (at: string, { table, keys }: ItemsToDelete, signal: AbortSignal) => deleteItems(at, table, keys, signal),
    'settled',
  );
  return { run: mutation.mutateAsync, pending: mutation.isPending };
}
