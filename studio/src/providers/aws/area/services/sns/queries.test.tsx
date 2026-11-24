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
  useSetSubscriptionSetting,
  useSetTopicSetting,
  useSubscribe,
  useSubscriptionListing,
  useSubscriptionSettings,
  useTagTopic,
  useTopic,
  useTopicListing,
  useTopicTags,
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
    setTopicSetting: vi.fn(),
    listTopicTags: vi.fn(),
    tagTopic: vi.fn(),
    getSubscriptionSettings: vi.fn(),
    setSubscriptionSetting: vi.fn(),
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

  it('a page after the first read empty → the first page is read, never shown empty', async () => {
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
      second.resolve({ arns: ['b'] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['b']);
    });
    act(() => {
      result.current.refresh();
    });
    const again = await nth(calls, 2);
    expect(again.args[1]).toBe('100');
    act(() => {
      again.resolve({ arns: [] });
    });
    const back = await nth(calls, 3);
    expect(back.args[1]).toBeUndefined();
    expect(result.current.items).toBeUndefined();
    expect(result.current.currentPage).toBe(1);
    act(() => {
      back.resolve({ arns: ['a'], nextToken: '100' });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual(['a']);
    });
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
      second.resolve({ subscriptions: [{ ...row, arn: `${TOPIC}:2` }] });
    });
    await waitFor(() => {
      expect(result.current.items).toEqual([{ ...row, arn: `${TOPIC}:2` }]);
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

  it('a page after the first read empty → the first page is read, never shown empty', async () => {
    const calls = held(api.listSubscriptions);
    const { result } = renderHook(() => useSubscriptionListing(ENDPOINT, TOPIC), { wrapper });
    const row = { arn: `${TOPIC}:1`, protocol: 'sqs', endpoint: QUEUE, pending: false };
    const first = await nth(calls, 0);
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
    expect(second.args[2]).toBe('t2');
    act(() => {
      second.resolve({ subscriptions: [] });
    });
    const back = await nth(calls, 2);
    expect(back.args[2]).toBeUndefined();
    expect(result.current.items).toBeUndefined();
    expect(result.current.currentPage).toBe(1);
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

describe('topic settings', () => {
  const oldTopic = {
    found: true,
    topic: { arn: TOPIC, displayName: 'Original', fifo: false, contentBasedDeduplication: false },
  };
  const newTopic = { ...oldTopic, topic: { ...oldTopic.topic, displayName: 'Updated' } };
  const setting = { name: 'DisplayName', value: 'Updated' } as const;

  it('shows only the current topic tags when the previous ARN answers late', async () => {
    const tags = held(api.listTopicTags);
    const { result, rerender } = renderHook(({ arn }) => useTopicTags(ENDPOINT, arn), {
      wrapper,
      initialProps: { arn: TOPIC },
    });
    const previous = await nth(tags, 0);
    const nextArn = `${TOPIC}-next`;
    rerender({ arn: nextArn });
    const current = await nth(tags, 1);
    expect(current.args.slice(0, 2)).toEqual([ENDPOINT, nextArn]);
    expect(previous.signal.aborted).toBe(true);
    const currentTags = [{ key: 'color', value: 'blue' }];
    act(() => current.resolve(currentTags));
    await waitFor(() => expect(result.current.value).toEqual(currentTags));
    await act(async () => previous.resolve([{ key: 'color', value: 'red' }]));
    expect(result.current.value).toEqual(currentTags);
  });

  it('keeps the new attributes when a read started before the write answers late', async () => {
    const topics = held(api.getTopic);
    const write = held(api.setTopicSetting);
    const { result } = renderHook(() => ({ topic: useTopic(ENDPOINT, TOPIC), save: useSetTopicSetting(ENDPOINT) }), {
      wrapper,
    });
    const previous = await nth(topics, 0);
    const save = result.current.save(TOPIC, setting, new AbortController().signal);
    const writeCall = await nth(write, 0);
    await act(async () => {
      writeCall.resolve(undefined);
      await save;
    });

    const current = await nth(topics, 1);
    expect(current.args.slice(0, 2)).toEqual([ENDPOINT, TOPIC]);
    expect(previous.signal.aborted).toBe(true);
    act(() => current.resolve(newTopic));
    await waitFor(() => expect(result.current.topic.value).toEqual(newTopic));
    await act(async () => previous.resolve(oldTopic));
    expect(result.current.topic.value).toEqual(newTopic);
  });

  it('keeps the new tags when a read started before the write answers late', async () => {
    const tags = held(api.listTopicTags);
    const write = held(api.tagTopic);
    const { result } = renderHook(() => ({ tags: useTopicTags(ENDPOINT, TOPIC), save: useTagTopic(ENDPOINT) }), {
      wrapper,
    });
    const previous = await nth(tags, 0);
    const tag = { key: 'color', value: 'blue' };
    const save = result.current.save(TOPIC, tag, new AbortController().signal);
    const writeCall = await nth(write, 0);
    await act(async () => {
      writeCall.resolve(undefined);
      await save;
    });

    const current = await nth(tags, 1);
    expect(current.args.slice(0, 2)).toEqual([ENDPOINT, TOPIC]);
    expect(previous.signal.aborted).toBe(true);
    act(() => current.resolve([tag]));
    await waitFor(() => expect(result.current.tags.value).toEqual([tag]));
    await act(async () => previous.resolve([{ key: 'color', value: 'red' }]));
    expect(result.current.tags.value).toEqual([tag]);
  });

  it('refreshes the topic detail and list after a successful attribute write', async () => {
    const topics = held(api.getTopic);
    const lists = held(api.listTopics);
    const write = held(api.setTopicSetting);
    const { result } = renderHook(
      () => ({ topic: useTopic(ENDPOINT, TOPIC), list: useTopicListing(ENDPOINT), save: useSetTopicSetting(ENDPOINT) }),
      { wrapper },
    );
    const topic = await nth(topics, 0);
    const list = await nth(lists, 0);
    act(() => {
      topic.resolve(oldTopic);
      list.resolve({ arns: [TOPIC] });
    });
    await waitFor(() => {
      expect(result.current.topic.value).toEqual(oldTopic);
      expect(result.current.list.items).toEqual([TOPIC]);
    });

    const save = result.current.save(TOPIC, setting, new AbortController().signal);
    const writeCall = await nth(write, 0);
    expect(topics).toHaveLength(1);
    expect(lists).toHaveLength(1);
    await act(async () => {
      writeCall.resolve(undefined);
      await save;
    });
    const updatedTopic = await nth(topics, 1);
    const updatedList = await nth(lists, 1);
    const updatedArns = [TOPIC, `${TOPIC}-next`];
    act(() => {
      updatedTopic.resolve(newTopic);
      updatedList.resolve({ arns: updatedArns });
    });
    await waitFor(() => {
      expect(result.current.topic.value).toEqual(newTopic);
      expect(result.current.list.items).toEqual(updatedArns);
    });
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

it('supersedes an in-flight settings read only for the subscription that was saved', async () => {
  const firstArn = `${TOPIC}:first`;
  const secondArn = `${TOPIC}:second`;
  const details = held(api.getSubscriptionSettings);
  const listing = held(api.listSubscriptions);
  const write = held(api.setSubscriptionSetting);
  const { result } = renderHook(
    () => ({
      first: useSubscriptionSettings(ENDPOINT, firstArn),
      second: useSubscriptionSettings(ENDPOINT, secondArn),
      list: useSubscriptionListing(ENDPOINT, TOPIC),
      save: useSetSubscriptionSetting(ENDPOINT, TOPIC),
    }),
    { wrapper },
  );
  const previous = await nth(details, 0);
  const other = await nth(details, 1);
  const previousList = await nth(listing, 0);
  const save = result.current.save(
    firstArn,
    { name: 'RawMessageDelivery', value: 'true' },
    new AbortController().signal,
  );
  const writeCall = await nth(write, 0);
  await act(async () => {
    writeCall.resolve(undefined);
    await save;
  });
  const latest = await nth(details, 2);
  expect(latest.args.slice(0, 2)).toEqual([ENDPOINT, firstArn]);
  expect(previous.signal.aborted).toBe(true);
  expect(other.signal.aborted).toBe(false);
  expect(previousList.signal.aborted).toBe(true);
  const latestList = await nth(listing, 1);
  expect(latestList.args.slice(0, 2)).toEqual([ENDPOINT, TOPIC]);
  act(() => {
    latest.resolve({ RawMessageDelivery: 'true' });
    latestList.resolve({ subscriptions: [] });
    other.resolve({ FilterPolicy: '{}' });
  });
  await waitFor(() => expect(result.current.first.value).toEqual({ RawMessageDelivery: 'true' }));
  await act(async () => {
    previous.resolve({ RawMessageDelivery: 'false' });
  });
  expect(result.current.first.value).toEqual({ RawMessageDelivery: 'true' });
  expect(result.current.second.value).toEqual({ FilterPolicy: '{}' });
  expect(details).toHaveLength(3);
});
