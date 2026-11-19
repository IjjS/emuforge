import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './api';
import {
  FILTER_DELAY_MS,
  useAllowDelivery,
  useCreateTopic,
  useDeleteTopic,
  useDelivery,
  useFunctionChoices,
  useQueueChoices,
  useSubscribe,
  useSubscriptionListing,
  useTopic,
  useTopicListing,
  useUnsubscribe,
} from './queries';

// The hooks over `api.ts`, whose calls the case answers: each call waits until the case settles it, so the case
// decides the order in which answers arrive. `api.test.ts` proves the calls themselves against a fake engine.

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return {
    ...real,
    listTopics: vi.fn(),
    listSubscriptions: vi.fn(),
    getTopic: vi.fn(),
    readDelivery: vi.fn(),
    listQueueChoices: vi.fn(),
    listFunctionChoices: vi.fn(),
    createTopic: vi.fn(),
    deleteTopic: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    allowDelivery: vi.fn(),
  };
});

const TOPIC = 'arn:aws:sns:us-east-1:000000000000:orders';
const QUEUE = 'arn:aws:sqs:us-east-1:000000000000:jobs';
const ENDPOINT = 'http://127.0.0.1:9999';

interface Call {
  args: unknown[];
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** Each call of a mocked function, held until the case settles it. */
function held(fn: unknown): Call[] {
  const calls: Call[] = [];
  vi.mocked(fn as (...args: unknown[]) => Promise<unknown>).mockImplementation((...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      calls.push({ args, signal: args[args.length - 1] as AbortSignal, resolve, reject });
    });
  });
  return calls;
}

async function nth(calls: Call[], n: number): Promise<Call> {
  await waitFor(() => {
    expect(calls.length).toBeGreaterThan(n);
  });
  return calls[n] as Call;
}

const failed = () => new RequestError({ kind: 'other', operation: 'X', code: 'InternalError', message: 'it broke' });

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the topics listing', () => {
  it('"next" asks with the last token; "previous" shows the page before; a refresh asks the shown page again', async () => {
    const calls = held(api.listTopics);
    const { result } = renderHook(() => useTopicListing(ENDPOINT), { wrapper });
    const first = await nth(calls, 0);
    expect(first.args.slice(0, 2)).toEqual([ENDPOINT, undefined]);
    act(() => {
      first.resolve({ arns: ['a', 'b'], nextToken: '100' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a', 'b']);
    });
    expect(result.current.openEnd).toBe(true);

    act(() => {
      result.current.goToPage(2);
    });
    const second = await nth(calls, 1);
    expect(second.args[1]).toBe('100');
    act(() => {
      second.resolve({ arns: ['c'] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['c']);
    });
    expect(result.current.currentPage).toBe(2);
    expect(result.current.openEnd).toBe(false);
    expect(result.current.pagesCount).toBe(2);

    act(() => {
      result.current.refresh();
    });
    const again = await nth(calls, 2);
    expect(again.args[1]).toBe('100');
    expect(result.current.currentPage).toBe(2);
    act(() => {
      again.resolve({ arns: ['c2'] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['c2']);
    });
    expect(result.current.currentPage).toBe(2);
    expect(result.current.pagesCount).toBe(2);

    act(() => {
      result.current.goToPage(1);
    });
    const back = await nth(calls, 3);
    expect(back.args[1]).toBeUndefined();
  });

  it('a late answer of an earlier page does not replace a newer one', async () => {
    const calls = held(api.listTopics);
    const { result } = renderHook(() => useTopicListing(ENDPOINT), { wrapper });
    const first = await nth(calls, 0);
    act(() => {
      first.resolve({ arns: ['a'], nextToken: '100' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a']);
    });
    act(() => {
      result.current.goToPage(2);
    });
    const second = await nth(calls, 1);
    act(() => {
      result.current.goToPage(1);
    });
    const third = await nth(calls, 2);
    expect(second.signal.aborted).toBe(true);
    act(() => {
      third.resolve({ arns: ['a-new'], nextToken: '100' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a-new']);
    });
    act(() => {
      second.resolve({ arns: ['late'] });
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.items).toEqual(['a-new']);
  });
});

describe("a topic's subscriptions", () => {
  it('a page by token, the same way; a refresh asks the shown page again', async () => {
    const calls = held(api.listSubscriptions);
    const { result } = renderHook(() => useSubscriptionListing(ENDPOINT, TOPIC), { wrapper });
    const first = await nth(calls, 0);
    expect(first.args.slice(0, 3)).toEqual([ENDPOINT, TOPIC, undefined]);
    const row = { arn: `${TOPIC}:1`, protocol: 'sqs', endpoint: QUEUE, pending: false };
    act(() => {
      first.resolve({ subscriptions: [row], nextToken: 't2' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual([row]);
    });
    act(() => {
      result.current.goToPage(2);
    });
    const second = await nth(calls, 1);
    expect(second.args.slice(0, 3)).toEqual([ENDPOINT, TOPIC, 't2']);
    act(() => {
      second.resolve({ subscriptions: [] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual([]);
    });
    act(() => {
      result.current.refresh();
    });
    const again = await nth(calls, 2);
    expect(again.args.slice(0, 3)).toEqual([ENDPOINT, TOPIC, 't2']);
    expect(result.current.currentPage).toBe(2);
    act(() => {
      result.current.goToPage(1);
    });
    expect((await nth(calls, 3)).args[2]).toBeUndefined();
  });
});

describe('actions', () => {
  /** The topic list, the topic, its subscriptions and one delivery, each read once and answered. */
  async function renderReads() {
    const lists = held(api.listTopics);
    const topics = held(api.getTopic);
    const subscriptions = held(api.listSubscriptions);
    const deliveries = held(api.readDelivery);
    renderHook(
      () => {
        useTopicListing(ENDPOINT);
        useTopic(ENDPOINT, TOPIC);
        useSubscriptionListing(ENDPOINT, TOPIC);
        useDelivery(ENDPOINT, TOPIC, 'sqs', QUEUE);
      },
      { wrapper },
    );
    for (const [calls, value] of [
      [lists, { arns: [TOPIC] }],
      [topics, { found: false }],
      [subscriptions, { subscriptions: [] }],
      [deliveries, { kind: 'none' }],
    ] as const) {
      const call = await nth(calls, 0);
      act(() => {
        call.resolve(value);
      });
    }
    const all = [lists, topics, subscriptions, deliveries];
    await new Promise((resolve) => setTimeout(resolve, 5));
    return all;
  }

  const cases: [string, unknown, (endpoint: string) => (...args: never[]) => Promise<unknown>, unknown[]][] = [
    ['create', api.createTopic, useCreateTopic, [{ name: 'x', fifo: false, contentBasedDeduplication: false }]],
    ['delete', api.deleteTopic, useDeleteTopic, [TOPIC]],
    ['subscribe', api.subscribe, useSubscribe, [{ topicArn: TOPIC, protocol: 'sqs', endpoint: QUEUE }]],
    ['unsubscribe', api.unsubscribe, useUnsubscribe, [`${TOPIC}:1`]],
    ['allow delivery', api.allowDelivery, useAllowDelivery, [{ topicArn: TOPIC, protocol: 'sqs', endpoint: QUEUE }]],
  ];

  for (const [name, fn, hook, args] of cases) {
    it(`${name} succeeded → the list, the topic, its subscriptions and the deliveries are read again`, async () => {
      const reads = await renderReads();
      vi.mocked(fn as () => Promise<unknown>).mockResolvedValue(undefined);
      const { result } = renderHook(() => hook(ENDPOINT), { wrapper });
      await act(async () => {
        await (result.current as (...a: unknown[]) => Promise<unknown>)(...args, new AbortController().signal);
      });
      for (const calls of reads) {
        await nth(calls, 1);
      }
    });

    it(`${name} failed → nothing is read again`, async () => {
      const reads = await renderReads();
      vi.mocked(fn as () => Promise<unknown>).mockRejectedValue(failed());
      const { result } = renderHook(() => hook(ENDPOINT), { wrapper });
      await act(async () => {
        await (result.current as (...a: unknown[]) => Promise<unknown>)(...args, new AbortController().signal).catch(
          () => undefined,
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const calls of reads) {
        expect(calls).toHaveLength(1);
      }
    });
  }
});

describe('the deliveries', () => {
  it('two rows of one endpoint and topic → one read', async () => {
    const calls = held(api.readDelivery);
    const { result } = renderHook(
      () => [useDelivery(ENDPOINT, TOPIC, 'sqs', QUEUE), useDelivery(ENDPOINT, TOPIC, 'sqs', QUEUE)],
      { wrapper },
    );
    const call = await nth(calls, 0);
    expect(call.args.slice(0, 2)).toEqual([ENDPOINT, { topicArn: TOPIC, protocol: 'sqs', endpoint: QUEUE }]);
    act(() => {
      call.resolve({ kind: 'allowed' });
    });
    await waitFor(() => {
      expect(result.current.map((read) => read.value)).toEqual([{ kind: 'allowed' }, { kind: 'allowed' }]);
    });
    expect(calls).toHaveLength(1);
  });
});

describe('the queue choices', () => {
  it('the first page when enabled; "more" adds the next; a changed prefix starts again; a failed page keeps the choices', async () => {
    const calls = held(api.listQueueChoices);
    const { result, rerender } = renderHook(
      ({ filter, enabled }: { filter: string; enabled: boolean }) => useQueueChoices(ENDPOINT, filter, enabled),
      { wrapper, initialProps: { filter: '', enabled: false } },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toHaveLength(0);
    rerender({ filter: '', enabled: true });
    const first = await nth(calls, 0);
    expect(first.args.slice(0, 2)).toEqual([ENDPOINT, {}]);
    act(() => {
      first.resolve({ choices: [{ name: 'a', url: 'u/a' }], nextToken: 'n2' });
    });
    await waitFor(() => {
      expect(result.current.choices).toEqual([{ name: 'a', url: 'u/a' }]);
    });
    expect(result.current.more).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    const second = await nth(calls, 1);
    expect(second.args[1]).toEqual({ token: 'n2' });
    act(() => {
      second.resolve({ choices: [{ name: 'b', url: 'u/b' }], nextToken: 'n3' });
    });
    await waitFor(() => {
      expect(result.current.choices?.map((choice) => choice.name)).toEqual(['a', 'b']);
    });

    act(() => {
      result.current.loadMore();
    });
    const third = await nth(calls, 2);
    expect(third.args[1]).toEqual({ token: 'n3' });
    act(() => {
      third.reject(failed());
    });
    await waitFor(() => {
      expect(result.current.failure).toEqual({
        kind: 'other',
        operation: 'X',
        code: 'InternalError',
        message: 'it broke',
      });
    });
    expect(result.current.choices?.map((choice) => choice.name)).toEqual(['a', 'b']);
    act(() => {
      result.current.retry();
    });
    expect((await nth(calls, 3)).args[1]).toEqual({ token: 'n3' });

    rerender({ filter: 'jo', enabled: true });
    await waitFor(
      () => {
        expect(calls.length).toBeGreaterThan(4);
      },
      { timeout: FILTER_DELAY_MS * 4 },
    );
    expect(calls[4]?.args[1]).toEqual({ prefix: 'jo' });
    expect(result.current.prefix).toBe('jo');
  });
});

describe('the function choices', () => {
  it('the first page when enabled; "more" asks with the marker and adds; no prefix; a failed page keeps the choices', async () => {
    const calls = held(api.listFunctionChoices);
    const { result } = renderHook(() => useFunctionChoices(ENDPOINT, true), { wrapper });
    const first = await nth(calls, 0);
    expect(first.args.slice(0, 2)).toEqual([ENDPOINT, undefined]);
    expect(first.args).toHaveLength(3);
    act(() => {
      first.resolve({ choices: [{ name: 'f1', arn: 'arn:f1' }], nextMarker: 'm2' });
    });
    await waitFor(() => {
      expect(result.current.choices).toEqual([{ name: 'f1', arn: 'arn:f1' }]);
    });
    act(() => {
      result.current.loadMore();
    });
    const second = await nth(calls, 1);
    expect(second.args[1]).toBe('m2');
    act(() => {
      second.reject(failed());
    });
    await waitFor(() => {
      expect(result.current.failure).toBeDefined();
    });
    expect(result.current.choices).toEqual([{ name: 'f1', arn: 'arn:f1' }]);
  });
});
