import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  cancelMessageMoveTask,
  createQueue,
  deleteMessages,
  deleteQueue,
  getQueueArn,
  isQueueNameTaken,
  listDeadLetterChoices,
  listMessageMoveTasks,
  listQueuePage,
  listQueues,
  OPERATIONS,
  purgeQueue,
  readQueue,
  receiveMessages,
  sendMessage,
  startMessageMoveTask,
  type ChoicePage,
  type DeleteMessagesResult,
  type MessageToDelete,
  type MoveRequest,
  type MoveTask,
  type NewQueue,
  type NoSuchQueue,
  type OutgoingMessage,
  type QueueDetails,
  type QueueChoice,
  type QueuePage,
  type QueueRow,
  type ReadMessage,
  type SendTarget,
  type SentMessage,
} from './api';
import { queueNameFromUrl, type QueueKind } from './format';

export type { QueueChoice } from './api';

// The TanStack Query hooks of the SQS screens (issue 481, design tasks 1 to 5). Every read is a request of its own
// on every mount, "Refresh" and "Retry", under a key that holds what it was asked with; a read no longer wanted is
// aborted, and its late answer, under a key nobody shows any more, changes nothing shown. Every action that succeeded
// reads the shown SQS reads again, since each can change a queue's counts; a failed one reads nothing again, so its
// result stays an item of the area's flash and never becomes a state of the page.

/** The start of every key of SQS's reads. */
const SQS_KEY = ['aws', 'sqs'] as const;

/** The search's text is sent once it has not changed for this long. */
export const FILTER_DELAY_MS = 300;

/** The move tasks are read again this often while one is RUNNING or CANCELLING. */
export const MOVE_TASKS_POLL_MS = 2000;

/** How many queues the redrive's destination select offers for one prefix. */
export const QUEUE_CHOICES = 25;

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

function failureOf(error: unknown, operation: string): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

function noEndpoint(): never {
  throw new Error('The engine endpoint is not known yet.');
}

/** `value`, once it has not changed for `delay` ms. */
function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return settled;
}

// ---------------------------------------------------------------------------------------------------------------
// S1, the queue list

/** What the listing is asked for. */
export interface QueueListingOptions {
  /** The engine's address; nothing is asked while it is not known. */
  endpoint: string | undefined;
  /** `MaxResults` of every page. */
  pageSize: number;
  /** The search's text as typed; sent as `QueueNamePrefix` `FILTER_DELAY_MS` after its last change. */
  filter: string;
}

export interface QueueListing {
  /** The prefix of this listing, the search's text as last sent; `''` for none. */
  prefix: string;
  /** The shown page's queues, in the emulator's order; `undefined` until its answer arrives or when it failed. */
  queues: QueueRow[] | undefined;
  /** Why `ListQueues` of the shown page failed. */
  failure: RequestFailure | undefined;
  /** A read of the shown page is in flight. */
  loading: boolean;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this listing knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read carried a `NextToken`: a next page follows. */
  openEnd: boolean;
  /** Shows page `page` (from 1), read again; a page this listing has no token for is ignored. */
  goToPage: (page: number) => void;
  /** Reads the list again from page 1, dropping every token ("Refresh"). */
  refresh: () => void;
}

/** Where the user is in one listing: the shown page, and the token each page read gave, from page 0. */
interface Position {
  listing: string;
  page: number;
  /** One more on every move, so a page shown again is read again. */
  visit: number;
  tokens: readonly (string | undefined)[];
}

function fresh(listing: string): Position {
  return { listing, page: 0, visit: 0, tokens: [] };
}

/** `tokens` with page `page`'s answer; the later pages are kept only while its token is the same. */
function withToken(tokens: readonly (string | undefined)[], page: number, next: string | undefined) {
  const later = tokens[page] === next && next !== undefined ? tokens.slice(page + 1) : [];
  return [...tokens.slice(0, page), next, ...later];
}

/**
 * The queue list of the emulator behind the engine at `endpoint`, one page at a time on `ListQueues`' own tokens,
 * the search sent as `QueueNamePrefix`. Each page's rows are read with it (`listQueuePage`).
 */
export function useQueueListing({ endpoint, pageSize, filter }: QueueListingOptions): QueueListing {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const prefix = useSettled(filter, FILTER_DELAY_MS);
  const listing = JSON.stringify([endpoint ?? null, generation, pageSize, prefix]);

  const [stored, setPosition] = useState<Position>(fresh(listing));
  const position = stored.listing === listing ? stored : fresh(listing);
  const token = position.page === 0 ? undefined : position.tokens[position.page - 1];

  const query = useQuery({
    queryKey: [...SQS_KEY, 'list', endpoint, mount, generation, pageSize, prefix, position.page, token, position.visit],
    queryFn: async ({ signal }): Promise<QueuePage> => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const page = position.page;
      const answer = await listQueuePage(
        endpoint,
        { pageSize, ...(prefix === '' ? {} : { prefix }), ...(token === undefined ? {} : { token }) },
        signal,
      );
      // Kept as this page's token only while the user is still on it in the same listing.
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        return at.page === page ? { ...at, tokens: withToken(at.tokens, page, answer.nextToken) } : current;
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
  const tokens = answer === undefined ? position.tokens : withToken(position.tokens, position.page, answer.nextToken);
  const openEnd = tokens.length > 0 && tokens[tokens.length - 1] !== undefined;

  const goToPage = useCallback(
    (page: number) => {
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        const index = page - 1;
        const known = index === 0 || at.tokens[index - 1] !== undefined;
        return Number.isInteger(index) && index >= 0 && known ? { ...at, page: index, visit: at.visit + 1 } : current;
      });
    },
    [listing, setPosition],
  );
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  return {
    prefix,
    queues: answer?.queues,
    failure: query.isError ? failureOf(query.error, OPERATIONS.listQueues) : undefined,
    loading: query.isFetching || (endpoint === undefined && answer === undefined),
    currentPage: position.page + 1,
    pagesCount: Math.max(tokens.length, position.page + 1),
    openEnd,
    goToPage,
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// S2, a queue

/** One read of a screen as the screen shows it. */
export interface SqsRead<T> {
  /** The answer of the current read; `undefined` while it is first in flight or when it failed. */
  value: T | undefined;
  /** Why the current read failed. */
  failure: RequestFailure | undefined;
  /** A read is in flight, or waits for the engine's address. */
  loading: boolean;
  /** Reads again, from nothing shown ("Refresh", "Retry"). */
  refresh: () => void;
}

function queueKey(name: string) {
  return [...SQS_KEY, 'queue', name] as const;
}

/**
 * S2's read of the queue named `name`: `GetQueueUrl`, then its attributes and dead-letter sources; `NO_SUCH_QUEUE`
 * when the emulator holds none. Read again after every action, keeping the shown details while it is.
 */
export function useQueue(endpoint: string | undefined, name: string): SqsRead<QueueDetails | NoSuchQueue> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...queueKey(name), 'details', endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : readQueue(endpoint, name, signal)),
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return {
    value: query.data,
    failure: query.isError ? failureOf(query.error, OPERATIONS.getQueueUrl) : undefined,
    loading: query.isFetching || endpoint === undefined,
    refresh,
  };
}

/** A task that may still change: the move tasks are read again while one is. */
function isActive(task: MoveTask): boolean {
  return task.status === 'RUNNING' || task.status === 'CANCELLING';
}

/**
 * The move tasks of the dead-letter queue named `name`, whose ARN is `sourceArn` (nothing is read without one). While
 * any is RUNNING or CANCELLING they are read again every `MOVE_TASKS_POLL_MS`, and the queue's details with them,
 * once more after the last such answer; never otherwise.
 */
export function useMoveTasks(
  endpoint: string | undefined,
  name: string,
  sourceArn: string | undefined,
): SqsRead<MoveTask[]> {
  const client = useQueryClient();
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const wasActive = useRef(false);
  const query = useQuery({
    queryKey: [...queueKey(name), 'move-tasks', endpoint, sourceArn, mount, generation],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined || sourceArn === undefined) {
        noEndpoint();
      }
      const tasks = await listMessageMoveTasks(endpoint, sourceArn, signal);
      const active = tasks.some(isActive);
      if (active || wasActive.current) {
        void client.invalidateQueries({ queryKey: [...queueKey(name), 'details'] });
      }
      wasActive.current = active;
      return tasks;
    },
    enabled: endpoint !== undefined && sourceArn !== undefined,
    refetchInterval: (current) => (current.state.data?.some(isActive) === true ? MOVE_TASKS_POLL_MS : false),
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return {
    value: query.data,
    failure: query.isError ? failureOf(query.error, OPERATIONS.listMessageMoveTasks) : undefined,
    loading: query.isFetching || endpoint === undefined,
    refresh,
  };
}

/** The queues whose names start with `filter`, as typed: the first `QUEUE_CHOICES` of `ListQueues`. */
export function useQueueChoices(
  endpoint: string | undefined,
  filter: string,
  enabled: boolean,
): SqsRead<QueueChoice[]> & { prefix: string } {
  const prefix = useSettled(filter, FILTER_DELAY_MS);
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...SQS_KEY, 'choices', endpoint, mount, generation, prefix],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const { urls } = await listQueues(
        endpoint,
        { pageSize: QUEUE_CHOICES, ...(prefix === '' ? {} : { prefix }) },
        signal,
      );
      return urls.map((url) => ({ name: queueNameFromUrl(url), url }));
    },
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return {
    prefix,
    value: query.data,
    failure: query.isError ? failureOf(query.error, OPERATIONS.listQueues) : undefined,
    loading: query.isFetching || (enabled && endpoint === undefined),
    refresh,
  };
}

/** The dead-letter field's choices as "Create queue" shows them (issue 489). */
export interface DeadLetterChoices {
  /** The prefix of this list, the field's filter as last sent; `''` for none. */
  prefix: string;
  /** The queues of the type, every page read so far in the emulator's order; `undefined` until the first arrives. */
  choices: QueueChoice[] | undefined;
  /** Why the last `ListQueues` failed. */
  failure: RequestFailure | undefined;
  /** A page is in flight, or waits for the engine's address. */
  loading: boolean;
  /** The last page read carried a `NextToken`. */
  more: boolean;
  /** Reads the next page, on the last page's token. */
  loadMore: () => void;
  /** Reads the list again from its first page ("Retry"). */
  refresh: () => void;
}

/**
 * The dead-letter choices of a queue of `kind`: `ListQueues` a page at a time on its own tokens, the filter as typed
 * its `QueueNamePrefix` once it has settled, only the queues of `kind` kept. Its key holds the prefix and the type, so
 * a change of either asks again from the first page.
 */
export function useDeadLetterChoices(
  endpoint: string | undefined,
  kind: QueueKind,
  filter: string,
  enabled: boolean,
): DeadLetterChoices {
  const prefix = useSettled(filter, FILTER_DELAY_MS);
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useInfiniteQuery({
    queryKey: [...SQS_KEY, 'dead-letter-choices', endpoint, mount, generation, kind, prefix],
    queryFn: ({ signal, pageParam }): Promise<ChoicePage> =>
      endpoint === undefined
        ? noEndpoint()
        : listDeadLetterChoices(
            endpoint,
            { kind, prefix, ...(pageParam === undefined ? {} : { token: pageParam }) },
            signal,
          ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextToken,
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const { hasNextPage, isFetching, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return {
    prefix,
    choices: query.data?.pages.flatMap((page) => page.choices),
    failure: query.isError ? failureOf(query.error, OPERATIONS.listQueues) : undefined,
    loading: isFetching || (enabled && endpoint === undefined),
    more: hasNextPage,
    loadMore,
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

/** Reads every shown SQS read again (the list's, the queue's details, its move tasks); the rest are dropped. */
function useReadAgain(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: SQS_KEY });
  }, [client]);
}

/** `action` at the engine's address, the shown SQS reads read again once it has succeeded, and only then. */
function useAction<Args extends unknown[], Result>(
  endpoint: string | undefined,
  action: (endpoint: string, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  const readAgain = useReadAgain();
  return useCallback(
    async (...args: Args) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const result = await action(endpoint, ...args);
      readAgain();
      return result;
    },
    [endpoint, action, readAgain],
  );
}

/** "Read messages": a read that leaves them in the queue; it counts as a receive, so the counts are read again. */
export function useReceiveMessages(
  endpoint: string | undefined,
): (url: string, waitSeconds: number, signal: AbortSignal) => Promise<ReadMessage[]> {
  return useAction(endpoint, receiveMessages);
}

/** "Send". */
export function useSendMessage(
  endpoint: string | undefined,
): (target: SendTarget, message: OutgoingMessage, signal: AbortSignal) => Promise<SentMessage> {
  return useAction(endpoint, sendMessage);
}

/** "Delete" of the selected messages. */
export function useDeleteMessages(
  endpoint: string | undefined,
): (url: string, messages: readonly MessageToDelete[], signal: AbortSignal) => Promise<DeleteMessagesResult> {
  return useAction(endpoint, deleteMessages);
}

/** "Purge". */
export function usePurgeQueue(endpoint: string | undefined): (url: string, signal: AbortSignal) => Promise<void> {
  return useAction(endpoint, purgeQueue);
}

/** "Start" of a redrive; the move tasks are read again with the rest. */
export function useStartMoveTask(
  endpoint: string | undefined,
): (request: MoveRequest, signal: AbortSignal) => Promise<string> {
  return useAction(endpoint, startMessageMoveTask);
}

/** "Cancel" of a running move task: the number it had moved. */
export function useCancelMoveTask(
  endpoint: string | undefined,
): (taskHandle: string, signal: AbortSignal) => Promise<number | undefined> {
  return useAction(endpoint, cancelMessageMoveTask);
}

/** The `QueueArn` of a destination chosen in the redrive's select. Changes nothing, so reads nothing again. */
export function useQueueArn(
  endpoint: string | undefined,
): (url: string, signal: AbortSignal) => Promise<string | NoSuchQueue | undefined> {
  return useCallback(
    (url: string, signal: AbortSignal) => (endpoint === undefined ? noEndpoint() : getQueueArn(endpoint, url, signal)),
    [endpoint],
  );
}

/** What "Create queue" ends with when no request failed. */
export type CreateQueueOutcome = { outcome: 'taken' } | { outcome: 'created'; url: string };

/**
 * "Create queue" (issue 489): `GetQueueUrl` of the name first, and `CreateQueue` only when the emulator holds no queue
 * of it. A failure of either rejects as it came, and nothing more is sent. Once created, the listing is read again.
 */
export function useCreateQueue(
  endpoint: string | undefined,
): (queue: NewQueue, signal: AbortSignal) => Promise<CreateQueueOutcome> {
  const client = useQueryClient();
  return useCallback(
    async (queue: NewQueue, signal: AbortSignal): Promise<CreateQueueOutcome> => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      if (await isQueueNameTaken(endpoint, queue.name, signal)) {
        return { outcome: 'taken' };
      }
      const url = await createQueue(endpoint, queue, signal);
      void client.invalidateQueries({ queryKey: [...SQS_KEY, 'list'] });
      return { outcome: 'created', url };
    },
    [endpoint, client],
  );
}

/**
 * "Delete" of the queue `name` at `url` (issue 490). The listing is read again whether it succeeded or not, since a
 * refusal may say the queue is already gone; once deleted, the queue's own reads are dropped, not read again.
 */
export function useDeleteQueue(
  endpoint: string | undefined,
): (name: string, url: string, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (name: string, url: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      try {
        await deleteQueue(endpoint, url, signal);
        client.removeQueries({ queryKey: queueKey(name) });
      } finally {
        void client.invalidateQueries({ queryKey: [...SQS_KEY, 'list'] });
      }
    },
    [endpoint, client],
  );
}
