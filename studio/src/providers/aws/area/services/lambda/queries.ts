import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { requestFailure, type RequestFailure } from '../../../../../lib/aws/request';
import {
  createFunction,
  CreateFunctionError,
  deleteFunctions,
  INVOKE,
  invoke,
  isFunctionNotFound,
  LambdaRequestError,
  listFunctions,
  listRoles,
  readFunction,
  UPDATE_FUNCTION_CODE,
  UPDATE_FUNCTION_CONFIGURATION,
  updateFunctionCode,
  updateFunctionConfiguration,
  type ConfigurationChange,
  type CreatedFunction,
  type CreatedRole,
  type CreateFunctionRequest,
  type FunctionPage,
  type FunctionRead,
  type FunctionSummary,
  type InvokeAnswer,
  type LambdaFailure,
  type Role,
} from './api';

// The TanStack Query hooks of the Lambda screens (issue 84, requirement R4.1, R4.4, R4.5, R4.9, R4.10, R5.1, R5.2,
// R6.2, R6.5, R7, R10.2). Nothing is kept for a later mount and nothing is shown from an earlier reading: every read
// is a request of its own. A request no longer wanted is aborted, and its late answer never replaces a newer one.

/** Every key of the Lambda screens for the engine at `endpoint` starts with this. */
export function lambdaKey(endpoint: string | undefined): readonly unknown[] {
  return ['aws', 'lambda', endpoint ?? null];
}

/** The key of the generation every listing and function reading of `endpoint` holds in its own key. */
function generationKey(endpoint: string | undefined): unknown[] {
  return [...lambdaKey(endpoint), 'listing-generation'];
}

/** The prefix of every key of the readings of the function `name`: invalidating it reads the function again. */
export function functionKey(endpoint: string | undefined, name: string): unknown[] {
  return [...lambdaKey(endpoint), 'function', name];
}

/** What one page of the function list is read with. */
export interface FunctionListKeyParts {
  endpoint: string | undefined;
  pageSize: number;
  /** The filter's applied text; `''` for none. */
  filter: string;
  /** The page's `Marker`; `undefined` for a first page. */
  marker: string | undefined;
}

/** The query key of one page of the function list: the engine's origin, the page size, the filter and the marker. */
export function functionListKey({ endpoint, pageSize, filter, marker }: FunctionListKeyParts): unknown[] {
  return [...lambdaKey(endpoint), 'list-functions', pageSize, filter, marker ?? null];
}

/** Why a request failed, from what it rejected with. */
function failureOf(error: unknown, operation: string): LambdaFailure {
  if (error instanceof LambdaRequestError || error instanceof CreateFunctionError) {
    return error.failure;
  }
  return { kind: 'other', operation, code: String(error) };
}

/** A number per mount, so a page of an earlier mount is never shown. */
let mounts = 0;
/** One more each time the listings of an endpoint are invalidated (after a delete or a create). */
let listingGenerations = 0;

/**
 * The generation of the listings and readings of `endpoint`: it changes when a mutation invalidates it, so a listing
 * then starts again at page 1 (R4.4, R7) and a function's page reads again. It is computed here and asks nothing of
 * the engine; the page shown is not read once more under its old key first.
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

/** `connected` became true after `failed` was seen: the reading is to be made again (R10.2). */
function useReconnect(connected: boolean, failed: boolean, readAgain: () => void): void {
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && failed) {
      readAgain();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The function list

export interface FunctionListingOptions {
  /** The engine's address, `http://127.0.0.1:<port>`; nothing is asked while it is not known. */
  endpoint: string | undefined;
  /** `MaxItems` of every page. */
  pageSize: number;
  /** The filter's applied token (R4.7); `''` for none. */
  filter: string;
  /** The connection is connected: a failed reading is made again when it becomes so (R10.2). */
  connected: boolean;
}

/** The counter after the title (R4.5): the functions of the pages read, with "+" while more remain. */
export interface FunctionCount {
  total: number;
  more: boolean;
}

export interface FunctionListing {
  /** The shown page's functions, in the answer's order; `undefined` until its answer arrives or when it failed. */
  functions: FunctionSummary[] | undefined;
  /** Why the shown page could not be read; `undefined` while it is read or once it is. */
  failure: LambdaFailure | undefined;
  /** A read of the shown page is in flight. */
  loading: boolean;
  /** `undefined` while no page of this listing has been read. */
  count: FunctionCount | undefined;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this listing knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read carried a marker: more pages may follow. */
  openEnd: boolean;
  /**
   * A later page came back with no function to show, so it was not opened and the page shown stayed (R4.4); one more
   * each time, so a screen announces "No more functions" once per such answer. 0 in a new listing.
   */
  noMoreCount: number;
  /** Shows page `page` (from 1) of this listing, read again; a page this listing has no marker for is ignored. */
  goToPage: (page: number) => void;
  /** Starts a new listing at page 1, dropping every marker. */
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
  /** The last page whose answer was shown, and that answer. */
  shown: { page: number; answer: FunctionPage } | undefined;
  /** Shown without a read: the page that stayed when a later one came back empty. */
  held: boolean;
  noMoreCount: number;
}

/** Page 1 of `listing`, nothing read yet. */
function fresh(listing: string): Position {
  return { listing, page: 0, visit: 0, reads: [], shown: undefined, held: false, noMoreCount: 0 };
}

/** `reads` with page `page`'s answer as its last read; the later pages stay only while its marker is the same. */
function withRead(reads: readonly PageRead[], page: number, answer: FunctionPage): readonly PageRead[] {
  const read: PageRead = { count: answer.functions.length, next: answer.nextMarker };
  const before = reads[page];
  const later =
    before !== undefined && before.next === read.next && read.next !== undefined ? reads.slice(page + 1) : [];
  return [...reads.slice(0, page), read, ...later];
}

/** The position after page `page`'s answer, while the user is still on it. */
function answered(at: Position, page: number, answer: FunctionPage): Position {
  if (page > 0 && answer.functions.length === 0 && at.shown !== undefined) {
    // Not opened: the page shown stays, and the page before this one is the last (R4.4).
    const reads = at.reads
      .slice(0, page)
      .map((read, index) => (index === page - 1 ? { ...read, next: undefined } : read));
    return { ...at, page: at.shown.page, reads, held: true, noMoreCount: at.noMoreCount + 1 };
  }
  return { ...at, reads: withRead(at.reads, page, answer), shown: { page, answer } };
}

/**
 * The function list of the emulator behind the engine at `endpoint`, one page at a time, following the API's own
 * markers. It reads nothing again by itself while connected (R4.9).
 */
export function useFunctionListing({ endpoint, pageSize, filter, connected }: FunctionListingOptions): FunctionListing {
  const [mount] = useState(() => (mounts += 1));
  const [refreshes, setRefreshes] = useState(0);
  const generation = useListingGeneration(endpoint);
  const listing = JSON.stringify([endpoint ?? null, generation, refreshes, pageSize, filter]);

  const [stored, setPosition] = useState<Position>(() => fresh(listing));
  // A change of listing starts at page 1 with no marker.
  const position: Position = stored.listing === listing ? stored : fresh(listing);
  const marker = position.page === 0 ? undefined : position.reads[position.page - 1]?.next;

  const query = useQuery({
    queryKey: [
      ...functionListKey({ endpoint, pageSize, filter, marker }),
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
      const answer = await listFunctions(
        endpoint,
        { pageSize, filter, ...(marker === undefined ? {} : { marker }) },
        signal,
      );
      // Kept as this page's last read only while the user is still on it in the same listing.
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        return at.page === page && !at.held ? answered(at, page, answer) : current;
      });
      return answer;
    },
    enabled: endpoint !== undefined && !position.held,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });

  const answer = position.held ? position.shown?.answer : query.data;
  const reads =
    answer === undefined || position.held ? position.reads : withRead(position.reads, position.page, answer);
  const last = reads[reads.length - 1];
  const openEnd = last?.next !== undefined;
  const failed = !position.held && query.isError;

  const goToPage = useCallback(
    (page: number) => {
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        const index = page - 1;
        const known = index === 0 || at.reads[index - 1]?.next !== undefined;
        return Number.isInteger(index) && index >= 0 && known
          ? { ...at, page: index, visit: at.visit + 1, held: false }
          : current;
      });
    },
    [listing],
  );

  const refresh = useCallback(() => {
    setRefreshes((current) => current + 1);
  }, []);

  useReconnect(connected, failed, refresh);

  // A later page that came back empty is not shown while it is read: the page shown before is.
  const emptyLater = answer !== undefined && position.page > 0 && answer.functions.length === 0;

  return {
    functions: emptyLater ? undefined : answer?.functions,
    failure: failed ? failureOf(query.error, 'ListFunctions') : undefined,
    loading: (!position.held && query.isFetching) || (endpoint === undefined && answer === undefined),
    count: last === undefined ? undefined : { total: reads.reduce((sum, read) => sum + read.count, 0), more: openEnd },
    currentPage: position.page + 1,
    pagesCount: Math.max(reads.length, position.page + 1),
    openEnd,
    noMoreCount: position.noMoreCount,
    goToPage,
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A function's page

/** A function being created or updated is read again this long after the previous answer (R5.2). */
export const REREAD_DELAY_MS = 1000;

/** The function is being created or updated, so its page reads it again (R5.2). */
export function isChanging(read: FunctionRead | undefined): boolean {
  if (read === undefined || !read.found) {
    return false;
  }
  const { state, lastUpdateStatus } = read.function;
  return state === 'Pending' || (state === 'Active' && lastUpdateStatus === 'InProgress');
}

export interface FunctionReadingOptions {
  endpoint: string | undefined;
  name: string;
  connected: boolean;
  disconnected?: boolean;
  emulatorIdentity?: string | undefined;
  /** Read the function anew when a confirmed session replaces another session or the initial check. */
  revalidateOnReconnect?: boolean;
}

export interface FunctionReading {
  /** The function, or "not found"; `undefined` until the first answer of this reading, or when it failed. */
  read: FunctionRead | undefined;
  /** Why the reading failed; a failed re-reading is never shown (R5.2). */
  failure: LambdaFailure | undefined;
  /** The reading's first answer has not arrived. */
  loading: boolean;
  /** Changes when a connected session ends or the emulator target changes. */
  session: number;
  /** The detail query belongs to the current session. */
  sessionVerified: boolean;
  /** Reads the function again, from nothing shown. */
  refresh: () => void;
}

/**
 * The function `name` of the emulator behind the engine at `endpoint`. While it is being created or updated it is
 * read again `REREAD_DELAY_MS` after each answer, until it is neither or is gone; a re-reading that fails shows
 * nothing and ends the re-reading until the next reading.
 */
export function useFunctionReading({
  endpoint,
  name,
  connected,
  disconnected = false,
  emulatorIdentity,
  revalidateOnReconnect = false,
}: FunctionReadingOptions): FunctionReading {
  const [mount] = useState(() => (mounts += 1));
  const [readings, setReadings] = useState(0);
  const generation = useListingGeneration(endpoint);
  const [connection, setConnection] = useState({
    connected,
    disconnected,
    emulatorIdentity,
    epoch: Number(disconnected),
    readingEpoch: 0,
  });
  const changedTarget =
    connected && connection.emulatorIdentity !== undefined && connection.emulatorIdentity !== emulatorIdentity;
  // A detail fetched while the connection check was pending belongs to no confirmed session.
  const connectedFromChecking = connected && !connection.connected && !connection.disconnected;
  const epoch =
    connection.epoch + Number((disconnected && !connection.disconnected) || changedTarget || connectedFromChecking);
  const readingEpoch = connected && revalidateOnReconnect ? epoch : connection.readingEpoch;
  const identity = connected ? emulatorIdentity : connection.emulatorIdentity;
  if (
    connection.connected !== connected ||
    connection.disconnected !== disconnected ||
    identity !== connection.emulatorIdentity ||
    readingEpoch !== connection.readingEpoch
  ) {
    setConnection({ connected, disconnected, emulatorIdentity: identity, epoch, readingEpoch });
  }
  /** This reading's re-reads: `quiet` while one is in flight or has failed; `stopped` once one has failed. */
  const [rereading, setRereading] = useState({ reading: 0, epoch: 0, quiet: false, stopped: false });
  const sameReading = rereading.reading === readings && rereading.epoch === readingEpoch;
  const quiet = sameReading && rereading.quiet;
  const stopped = sameReading && rereading.stopped;

  const query = useQuery({
    queryKey: [...functionKey(endpoint, name), mount, generation, readings, readingEpoch],
    queryFn: ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return readFunction(endpoint, name, signal);
    },
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const { refetch, isError, isFetching } = query;
  const data = query.data;

  if (quiet && isError && !stopped) {
    setRereading({ reading: readings, epoch: readingEpoch, quiet: true, stopped: true });
  }

  const changing = isChanging(data);
  const updatedAt = query.dataUpdatedAt;
  useEffect(() => {
    if (!changing || isFetching || isError || stopped) {
      return;
    }
    const timer = setTimeout(() => {
      setRereading({ reading: readings, epoch: readingEpoch, quiet: true, stopped: false });
      void refetch();
    }, REREAD_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [changing, isFetching, isError, stopped, updatedAt, readings, readingEpoch, refetch]);

  const refresh = useCallback(() => {
    setReadings((current) => current + 1);
  }, []);

  const failed = isError && !quiet;
  useReconnect(connected, failed, refresh);

  return {
    read: failed ? undefined : data,
    failure: failed ? failureOf(query.error, 'GetFunction') : undefined,
    loading: data === undefined && (isFetching || endpoint === undefined),
    session: epoch,
    sessionVerified: connected && readingEpoch === epoch,
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Delete

/**
 * Deletes functions through the engine at `endpoint` (R7). When the requests are answered the listings of the
 * endpoint are invalidated: a function list starts a new listing at page 1, and a function's page reads again.
 */
export function useDeleteFunctions(endpoint: string | undefined) {
  const client = useQueryClient();
  const submissions = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    const pending = submissions.current;
    return () => {
      for (const submission of pending) {
        submission.abort();
      }
    };
  }, [endpoint]);
  const { mutateAsync, isPending } = useMutation({
    mutationFn: (submission: { endpoint: string | undefined; names: readonly string[]; signal: AbortSignal }) => {
      const { endpoint, names, signal } = submission;
      signal.throwIfAborted();
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return deleteFunctions(endpoint, names, signal);
    },
    onSettled: (_result, _error, submission) => {
      if (!submission.signal.aborted) {
        return client.invalidateQueries({ queryKey: generationKey(submission.endpoint) });
      }
    },
  });
  const remove = useCallback(
    async (names: readonly string[]) => {
      // TanStack Query can pause before mutationFn runs. Scope the signal when the deletion is confirmed.
      const controller = new AbortController();
      submissions.current.add(controller);
      try {
        return await mutateAsync({ endpoint, names, signal: controller.signal });
      } finally {
        submissions.current.delete(controller);
      }
    },
    [endpoint, mutateAsync],
  );
  return { remove, pending: isPending };
}

// ---------------------------------------------------------------------------------------------------------------
// Create

/** "Create Event Function" failed: the step, its failure, and the role left in the emulator, if any (R6.5). */
export interface CreateFailure {
  step: CreateFunctionError['step'];
  failure: LambdaFailure;
  createdRole: CreatedRole | undefined;
}

/**
 * Creates a function through the engine at `endpoint` (R6.5). The role a failed attempt left is kept for the life
 * of the form, so a second press for the same function name creates no second role. A success invalidates the
 * listings of the endpoint.
 */
export function useCreateFunction(endpoint: string | undefined) {
  const client = useQueryClient();
  const createdRole = useRef<CreatedRole | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const mutation = useMutation<CreatedFunction, unknown, CreateFunctionRequest>({
    mutationFn: (request) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      controller.current = new AbortController();
      const role =
        request.role.kind === 'default' ? { kind: 'default' as const, created: createdRole.current } : request.role;
      return createFunction(endpoint, { ...request, role }, controller.current.signal);
    },
    onSuccess: () => {
      createdRole.current = undefined;
      return client.invalidateQueries({ queryKey: generationKey(endpoint) });
    },
    onError: (error) => {
      if (error instanceof CreateFunctionError && error.createdRole !== undefined) {
        createdRole.current = error.createdRole;
      }
    },
  });
  const error = mutation.error;
  return {
    /** Sends the requests of "Create Event Function"; a second call while they are in flight sends nothing. */
    create: (request: CreateFunctionRequest) => {
      if (!mutation.isPending) {
        mutation.mutate(request);
      }
    },
    pending: mutation.isPending,
    created: mutation.data,
    failure:
      error instanceof CreateFunctionError
        ? ({ step: error.step, failure: error.failure, createdRole: error.createdRole } satisfies CreateFailure)
        : error === null
          ? undefined
          : ({
              step: 'Creating the function',
              failure: failureOf(error, 'CreateFunction'),
              createdRole: undefined,
            } satisfies CreateFailure),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The roles of "Existing role"

export interface RoleList {
  /** The roles of the pages read, in the answers' order. */
  roles: Role[];
  /** The select's status, as Cloudscape's `statusType` takes it. */
  status: 'pending' | 'loading' | 'finished' | 'error';
  failure: LambdaFailure | undefined;
  /** Cloudscape's `onLoadItems`: the first page when the select is first opened, then the next one. */
  load: (firstPage: boolean) => void;
  /** "Retry" after a failure: reads the page that failed again. */
  retry: () => void;
}

/**
 * The IAM roles of the emulator behind the engine at `endpoint`, page by page, as the select asks for them (R6.2):
 * nothing until it is first opened, then the next page with the last answer's marker when the user reaches the end
 * of the options, until an answer is not truncated. Never every page at once.
 */
export function useRoleList(endpoint: string | undefined): RoleList {
  const [mount] = useState(() => (mounts += 1));
  const [opened, setOpened] = useState(false);
  const query = useInfiniteQuery({
    queryKey: [...lambdaKey(endpoint), 'list-roles', mount],
    queryFn: ({ pageParam, signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return listRoles(endpoint, pageParam, signal);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextMarker,
    enabled: endpoint !== undefined && opened,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const { fetchNextPage, hasNextPage, isFetching, isError, refetch, data } = query;

  const load = useCallback(
    (firstPage: boolean) => {
      if (!opened) {
        setOpened(true);
        return;
      }
      if (!firstPage && hasNextPage && !isFetching) {
        void fetchNextPage();
      }
    },
    [opened, hasNextPage, isFetching, fetchNextPage],
  );

  const retry = useCallback(() => {
    if (query.isFetchNextPageError) {
      void fetchNextPage();
    } else {
      void refetch();
    }
  }, [query.isFetchNextPageError, fetchNextPage, refetch]);

  const roles = data?.pages.flatMap((page) => page.roles) ?? [];
  const status = !opened
    ? 'pending'
    : isFetching
      ? 'loading'
      : isError
        ? 'error'
        : hasNextPage
          ? 'pending'
          : 'finished';
  return {
    roles,
    status,
    failure: isError ? failureOf(query.error, 'ListRoles') : undefined,
    load,
    retry,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Invoke, change the code, change the configuration (issue 516, design "Task 2", "Task 3", "Task 5")

/**
 * Reads the function `name` again where its page shows it, keeping what is shown until the answer arrives: its
 * reading is refetched under its own key.
 */
export function useReadAgain(endpoint: string | undefined, name: string): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    () => client.invalidateQueries({ queryKey: functionKey(endpoint, name) }),
    [client, endpoint, name],
  );
}

/** A new signal per request; the last one aborts when the screen unmounts. */
function useAbortOnUnmount(): () => AbortSignal {
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  return useCallback(() => {
    controller.current = new AbortController();
    return controller.current.signal;
  }, []);
}

/** The invocation state kept by the function page while its Test tab comes and goes. */
export interface Invocation {
  mutate: (eventText: string, qualifier?: string) => void;
  isPending: boolean;
  /** The last completed request, kept until the next answer or failure replaces it. */
  data: InvokeAnswer | undefined;
  error: RequestFailure | undefined;
  qualifier: string | undefined;
  /** One more per answer or failure, so a screen says each outcome once. */
  answers: number;
  isUnsupported: (qualifier: string | undefined) => boolean;
}

export function useInvoke(endpoint: string | undefined, name: string, session = 0): Invocation {
  const readAgain = useReadAgain(endpoint, name);
  const scope = JSON.stringify([endpoint, name, session]);
  const request = useRef<AbortController | undefined>(undefined);
  const [saved, setLast] = useState(() => emptyInvocation(scope));
  const last = saved.scope === scope ? saved : emptyInvocation(scope);
  if (saved !== last) {
    setLast(last);
  }

  useLayoutEffect(
    () => () => {
      request.current?.abort();
      request.current = undefined;
    },
    [scope],
  );

  const mutation = useMutation({
    mutationFn: (input: {
      endpoint: string;
      name: string;
      eventText: string;
      qualifier: string | undefined;
      signal: AbortSignal;
      scope: string;
    }) => invoke(input.endpoint, input.name, input.eventText, input.signal, input.qualifier),
    onSettled: (data, error, { qualifier, signal, scope }) => {
      if (signal.aborted) {
        return;
      }
      const failure = error === null ? undefined : requestFailure(INVOKE, error);
      setLast((current) => ({
        scope,
        data,
        error: failure,
        qualifier,
        answers: current.answers + 1,
        unsupported:
          failure?.kind === 'not-implemented'
            ? new Set([...current.unsupported, qualifier !== undefined])
            : current.unsupported,
      }));
      request.current = undefined;
      void readAgain();
    },
  });

  const isUnsupported = (qualifier: string | undefined) => last.unsupported.has(qualifier !== undefined);
  const mutate = (eventText: string, qualifier?: string) => {
    if (endpoint === undefined || request.current !== undefined || isUnsupported(qualifier)) {
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    mutation.mutate({ endpoint, name, eventText, qualifier, signal: controller.signal, scope });
  };

  return {
    mutate,
    isPending: mutation.isPending && mutation.variables.scope === scope && !mutation.variables.signal.aborted,
    data: last.data,
    error: last.error,
    qualifier: last.qualifier,
    answers: last.answers,
    isUnsupported,
  };
}

function emptyInvocation(scope: string) {
  return {
    scope,
    data: undefined as InvokeAnswer | undefined,
    error: undefined as RequestFailure | undefined,
    qualifier: undefined as string | undefined,
    answers: 0,
    unsupported: new Set<boolean>(),
  };
}

/** What a change of the function asks of the screen that sends it. */
export interface ChangeCallbacks {
  /** The emulator accepted the change. */
  onSuccess?: () => void;
  /** The change failed; not called once the screen has left. */
  onError?: (failure: RequestFailure) => void;
}

/** A change of a function (an upload, a "Save"): one request at a time, and its failure as the area words it. */
export interface FunctionChange<Input> {
  /** Sends the change; a call while one is in flight sends nothing. */
  mutate: (input: Input, callbacks?: ChangeCallbacks) => void;
  /** The change is in flight. */
  isPending: boolean;
  /** Why the last change failed; `undefined` while none did, while one is in flight, or after `reset`. */
  error: RequestFailure | undefined;
  /** Forgets the last failure. */
  reset: () => void;
}

function useFunctionChange<Input>(
  endpoint: string | undefined,
  name: string,
  operation: string,
  send: (endpoint: string, input: Input, signal: AbortSignal) => Promise<void>,
): FunctionChange<Input> {
  const readAgain = useReadAgain(endpoint, name);
  const nextSignal = useAbortOnUnmount();
  const mutation = useMutation<unknown, unknown, { input: Input; signal: AbortSignal }>({
    mutationFn: ({ input, signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return send(endpoint, input, signal);
    },
    onSuccess: () => readAgain(),
    onError: (error, { signal }) => {
      // A function deleted elsewhere: its page then shows "Function not found".
      if (!signal.aborted && isFunctionNotFound(requestFailure(operation, error))) {
        return readAgain();
      }
      return undefined;
    },
  });
  const { mutate: run, isPending, error, reset } = mutation;
  const mutate = useCallback(
    (input: Input, callbacks?: ChangeCallbacks) => {
      if (isPending) {
        return;
      }
      const signal = nextSignal();
      run(
        { input, signal },
        {
          onSuccess: () => callbacks?.onSuccess?.(),
          onError: (failed) => {
            if (!signal.aborted) {
              callbacks?.onError?.(requestFailure(operation, failed));
            }
          },
        },
      );
    },
    [isPending, run, nextSignal, operation],
  );
  return {
    mutate,
    isPending,
    error: error === null ? undefined : requestFailure(operation, error),
    reset,
  };
}

/** Uploads a .zip file's bytes as the code of the function `name` (task 3); a success reads the function again. */
export function useUpdateFunctionCode(endpoint: string | undefined, name: string): FunctionChange<Uint8Array> {
  return useFunctionChange(endpoint, name, UPDATE_FUNCTION_CODE, (at, zipFile: Uint8Array, signal) =>
    updateFunctionCode(at, name, zipFile, signal),
  );
}

/** Saves one form's fields of the function `name` (task 5); a success reads the function again. */
export function useUpdateFunctionConfiguration(
  endpoint: string | undefined,
  name: string,
): FunctionChange<ConfigurationChange> {
  return useFunctionChange(endpoint, name, UPDATE_FUNCTION_CONFIGURATION, (at, change: ConfigurationChange, signal) =>
    updateFunctionConfiguration(at, name, change, signal),
  );
}
