import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  allowDelivery,
  createTopic,
  deleteTopic,
  getTopic,
  listFunctionChoices,
  listQueueChoices,
  listSubscriptions,
  listTopics,
  OPERATIONS,
  publish,
  readDelivery,
  readQueue,
  subscribe,
  unsubscribe,
  type AllowOutcome,
  type AllowTarget,
  type Delivery,
  type DeliveryProtocol,
  type FunctionChoice,
  type NewSubscription,
  type NewTopic,
  type NotFound,
  type OutgoingMessage,
  type Published,
  type QueueChoice,
  type QueuePolicy,
  type Subscription,
  type TopicRead,
} from './api';

// The TanStack Query hooks of SNS's screens (issue 536, design "States and reading again"). Every read is a request of
// its own on every mount, "Refresh" and "Retry", under a key that begins with the service's key and the engine's
// address and holds every token and argument; a read no longer wanted is aborted, and its late answer, under a key
// nobody shows any more, changes nothing shown. An action that succeeded reads again the topic list, the topic, its
// subscriptions and the deliveries; one that failed reads nothing again.

/** The start of every key of SNS's reads. */
const SNS_KEY = ['aws', 'sns'] as const;

/** The queue choices' prefix is sent once it has not changed for this long. */
export const FILTER_DELAY_MS = 300;

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** The failure of a rejected read or action of `operation`. */
export function failureOf(error: unknown, operation: string): RequestFailure {
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

/**
 * A signal for an action of a page: aborted once the page is left, so an action's answer changes nothing shown after
 * it.
 */
export function usePageSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, []);
  return useCallback(() => {
    if (controller.current === null) {
      controller.current = new AbortController();
    }
    return controller.current.signal;
  }, []);
}

// ---------------------------------------------------------------------------------------------------------------
// Listings by the API's token

/** One listing of pages by token, as a table shows it. */
export interface Listing<T> {
  /** The shown page's items, in the emulator's order; `undefined` until its answer arrives or when it failed. */
  items: T[] | undefined;
  /** Why the shown page's read failed. */
  failure: RequestFailure | undefined;
  /** A read of the shown page is in flight, or waits for the engine's address. */
  loading: boolean;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this listing knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read carried a token: a next page follows. */
  openEnd: boolean;
  /** Shows page `page` (from 1), read again; a page this listing has no token for is ignored. */
  goToPage: (page: number) => void;
  /** Reads the listing again from page 1, dropping every token ("Refresh"). */
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

interface PagedOptions<T> {
  /** The key's parts after the service's key: what the listing is of. */
  key: readonly unknown[];
  endpoint: string | undefined;
  enabled: boolean;
  operation: string;
  read: (endpoint: string, token: string | undefined, signal: AbortSignal) => Promise<{ items: T[]; next?: string }>;
}

function usePagedListing<T>({ key, endpoint, enabled, operation, read }: PagedOptions<T>): Listing<T> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const listing = JSON.stringify([...key, endpoint ?? null, generation]);
  const [stored, setPosition] = useState<Position>(fresh(listing));
  const position = stored.listing === listing ? stored : fresh(listing);
  const token = position.page === 0 ? undefined : position.tokens[position.page - 1];

  const query = useQuery({
    queryKey: [...SNS_KEY, ...key, endpoint, mount, generation, position.page, token, position.visit],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const page = position.page;
      const answer = await read(endpoint, token, signal);
      // Kept as this page's token only while the user is still on it in the same listing.
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        return at.page === page ? { ...at, tokens: withToken(at.tokens, page, answer.next) } : current;
      });
      return answer;
    },
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const answer = query.data;
  const tokens = answer === undefined ? position.tokens : withToken(position.tokens, position.page, answer.next);
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
    items: answer?.items,
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: query.isFetching || (enabled && endpoint === undefined && answer === undefined),
    currentPage: position.page + 1,
    pagesCount: Math.max(tokens.length, position.page + 1),
    openEnd,
    goToPage,
    refresh,
  };
}

/** S1: the topics' ARNs, a page of `ListTopics` at a time on its own tokens. */
export function useTopicListing(endpoint: string | undefined): Listing<string> {
  return usePagedListing({
    key: ['topics'],
    endpoint,
    enabled: true,
    operation: OPERATIONS.listTopics,
    read: async (at, token, signal) => {
      const page = await listTopics(at, token, signal);
      return page.nextToken === undefined ? { items: page.arns } : { items: page.arns, next: page.nextToken };
    },
  });
}

/** S3 "Subscriptions": a topic's subscriptions, a page of `ListSubscriptionsByTopic` at a time on its own tokens. */
export function useSubscriptionListing(endpoint: string | undefined, topicArn: string): Listing<Subscription> {
  return usePagedListing({
    key: ['subscriptions', topicArn],
    endpoint,
    enabled: true,
    operation: OPERATIONS.listSubscriptionsByTopic,
    read: async (at, token, signal) => {
      const page = await listSubscriptions(at, topicArn, token, signal);
      return page.nextToken === undefined
        ? { items: page.subscriptions }
        : { items: page.subscriptions, next: page.nextToken };
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// A topic, a delivery

/** One read as a screen shows it. */
export interface SnsRead<T> {
  /** The answer of the current read; `undefined` while it is first in flight or when it failed. */
  value: T | undefined;
  /** Why the current read failed. */
  failure: RequestFailure | undefined;
  /** A read is in flight, or waits for the engine's address. */
  loading: boolean;
  /** Reads again, from nothing shown ("Refresh", "Retry"). */
  refresh: () => void;
}

/** S3's and S4's read of the topic `arn`: its attributes, or "not found". */
export function useTopic(endpoint: string | undefined, arn: string): SnsRead<TopicRead> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...SNS_KEY, 'topic', arn, endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getTopic(endpoint, arn, signal)),
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
    failure: query.isError ? failureOf(query.error, OPERATIONS.getTopicAttributes) : undefined,
    loading: query.isFetching || endpoint === undefined,
    refresh,
  };
}

/**
 * The delivery of one subscription's endpoint for a topic, keyed by the topic, the protocol and the endpoint, so two
 * rows of one endpoint share one read. Not read while `enabled` is false (a row of another protocol).
 */
export function useDelivery(
  endpoint: string | undefined,
  topicArn: string,
  protocol: DeliveryProtocol,
  endpointArn: string,
  enabled = true,
): SnsRead<Delivery> {
  const client = useQueryClient();
  const key = [...SNS_KEY, 'delivery', endpoint, topicArn, protocol, endpointArn];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      endpoint === undefined
        ? noEndpoint()
        : readDelivery(endpoint, { topicArn, protocol, endpoint: endpointArn }, signal),
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: [...SNS_KEY, 'delivery', endpoint, topicArn, protocol, endpointArn] });
  }, [client, endpoint, topicArn, protocol, endpointArn]);
  return {
    value: query.data,
    failure: query.isError
      ? failureOf(query.error, protocol === 'sqs' ? OPERATIONS.getQueueAttributes : OPERATIONS.getPolicy)
      : undefined,
    loading: query.isFetching || (enabled && endpoint === undefined),
    refresh,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The choices of S4

/** S4's choices, as many pages as read so far. */
export interface Choices<T> {
  /** Every page read so far in the emulator's order; `undefined` until the first arrives. */
  choices: T[] | undefined;
  /** Why the last page's read failed; the choices read before it are kept. */
  failure: RequestFailure | undefined;
  /** A page is in flight, or waits for the engine's address. */
  loading: boolean;
  /** The last page read carried a token: more follow. */
  more: boolean;
  /** Reads the next page on the last page's token. */
  loadMore: () => void;
  /** After a failure: the page that failed again, the first or a further one. */
  retry: () => void;
}

interface ChoicesOptions<T> {
  key: readonly unknown[];
  endpoint: string | undefined;
  enabled: boolean;
  operation: string;
  read: (endpoint: string, token: string | undefined, signal: AbortSignal) => Promise<{ items: T[]; next?: string }>;
}

function useChoices<T>({ key, endpoint, enabled, operation, read }: ChoicesOptions<T>): Choices<T> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useInfiniteQuery({
    queryKey: [...SNS_KEY, ...key, endpoint, mount, generation],
    queryFn: ({ signal, pageParam }) => (endpoint === undefined ? noEndpoint() : read(endpoint, pageParam, signal)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const { hasNextPage, isFetching, fetchNextPage, data } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);
  const retry = useCallback(() => {
    if (data === undefined) {
      setGeneration((current) => current + 1);
    } else if (!isFetching) {
      void fetchNextPage();
    }
  }, [data, isFetching, fetchNextPage]);
  return {
    choices: data?.pages.flatMap((page) => page.items),
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: isFetching || (enabled && endpoint === undefined),
    more: hasNextPage,
    loadMore,
    retry,
  };
}

/**
 * S4's queues: `ListQueues` 50 at a time on its own tokens, the field's text as typed its `QueueNamePrefix` once it
 * has settled; a changed prefix asks again from the first page.
 */
export function useQueueChoices(
  endpoint: string | undefined,
  filter: string,
  enabled: boolean,
): Choices<QueueChoice> & { prefix: string } {
  const prefix = useSettled(filter, FILTER_DELAY_MS);
  const choices = useChoices({
    key: ['queue-choices', prefix],
    endpoint,
    enabled,
    operation: OPERATIONS.listQueues,
    read: async (at, token, signal) => {
      const page = await listQueueChoices(
        at,
        { ...(prefix === '' ? {} : { prefix }), ...(token === undefined ? {} : { token }) },
        signal,
      );
      return page.nextToken === undefined ? { items: page.choices } : { items: page.choices, next: page.nextToken };
    },
  });
  return { ...choices, prefix };
}

/** S4's functions: `ListFunctions` 50 at a time on its own markers; it has no filter. */
export function useFunctionChoices(endpoint: string | undefined, enabled: boolean): Choices<FunctionChoice> {
  return useChoices({
    key: ['function-choices'],
    endpoint,
    enabled,
    operation: OPERATIONS.listFunctions,
    read: async (at, marker, signal) => {
      const page = await listFunctionChoices(at, marker, signal);
      return page.nextMarker === undefined ? { items: page.choices } : { items: page.choices, next: page.nextMarker };
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Actions

/** `action` at the engine's address; once it has succeeded, and only then, every shown SNS read is read again. */
function useAction<Args extends unknown[], Result>(
  endpoint: string | undefined,
  action: (endpoint: string, ...args: Args) => Promise<Result>,
  readAgain = true,
): (...args: Args) => Promise<Result> {
  const client = useQueryClient();
  return useCallback(
    async (...args: Args) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const result = await action(endpoint, ...args);
      if (readAgain) {
        void client.invalidateQueries({ queryKey: SNS_KEY });
      }
      return result;
    },
    [endpoint, action, readAgain, client],
  );
}

/** "Create topic": the new topic's ARN. */
export function useCreateTopic(
  endpoint: string | undefined,
): (topic: NewTopic, signal: AbortSignal) => Promise<string> {
  return useAction(endpoint, createTopic);
}

/** "Delete" of a topic. */
export function useDeleteTopic(endpoint: string | undefined): (arn: string, signal: AbortSignal) => Promise<void> {
  return useAction(endpoint, deleteTopic);
}

/** "Create subscription": the subscription's ARN. */
export function useSubscribe(
  endpoint: string | undefined,
): (subscription: NewSubscription, signal: AbortSignal) => Promise<string | undefined> {
  return useAction(endpoint, subscribe);
}

/** "Delete" of a subscription. */
export function useUnsubscribe(
  endpoint: string | undefined,
): (subscriptionArn: string, signal: AbortSignal) => Promise<void> {
  return useAction(endpoint, unsubscribe);
}

/** "Allow delivery", and S4's permission after `Subscribe`: what it did. */
export function useAllowDelivery(
  endpoint: string | undefined,
): (target: AllowTarget, signal: AbortSignal) => Promise<AllowOutcome> {
  return useAction(endpoint, allowDelivery);
}

/** "Publish": what the emulator answered. Changes nothing a screen reads, so reads nothing again. */
export function usePublish(
  endpoint: string | undefined,
): (message: OutgoingMessage, signal: AbortSignal) => Promise<Published> {
  return useAction(endpoint, publish, false);
}

/** The ARN and policy of a queue chosen in S4, by its URL. Changes nothing, so reads nothing again. */
export function useReadQueue(
  endpoint: string | undefined,
): (url: string, signal: AbortSignal) => Promise<QueuePolicy | NotFound> {
  return useAction(endpoint, readQueue, false);
}
