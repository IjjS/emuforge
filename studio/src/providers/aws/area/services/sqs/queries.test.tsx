import { createHash } from 'node:crypto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import {
  FILTER_DELAY_MS,
  MOVE_TASKS_POLL_MS,
  useDeleteMessages,
  useMoveTasks,
  usePurgeQueue,
  useQueue,
  useQueueListing,
  useSendMessage,
  useStartMoveTask,
  type QueueListingOptions,
} from './queries';

// The test plays the engine behind the page's `fetch`. A case may hold an operation's answers, so it decides the
// order in which they arrive.

const AWS_HOST = 'https://sqs.us-east-1.amazonaws.com/000000000000';
const ARN = 'arn:aws:sqs:us-east-1:000000000000';
const JSON_1_0 = { 'content-type': 'application/x-amz-json-1.0' };

interface Sent {
  operation: string;
  body: Record<string, unknown>;
  signal: AbortSignal;
  answer: (body: unknown) => void;
}

type Handler = (body: Record<string, unknown>) => unknown;

class FakeEngine {
  readonly sent: Sent[] = [];
  readonly handlers = new Map<string, Handler>();
  /** Operations whose answers wait for the case. */
  readonly held = new Set<string>();

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-481' }), { status: 200 });
    }
    const operation = (request.headers.get('x-amz-target') ?? '').replace(/^AmazonSQS\./, '');
    const body = JSON.parse((await request.text()) || '{}') as Record<string, unknown>;
    return new Promise((resolve) => {
      const answer = (answerBody: unknown) => {
        resolve(new Response(JSON.stringify(answerBody), { status: 200, headers: JSON_1_0 }));
      };
      this.sent.push({ operation, body, signal: request.signal, answer });
      if (!this.held.has(operation)) {
        answer(this.handlers.get(operation)?.(body) ?? {});
      }
    });
  };

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }

  async nth(operation: string, n: number): Promise<Sent> {
    await waitFor(() => {
      expect(this.of(operation).length).toBeGreaterThan(n);
    });
    return this.of(operation)[n] as Sent;
  }
}

let nextPort = 9100;
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
  vi.unstubAllGlobals();
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderListing(options: Partial<QueueListingOptions> = {}) {
  return renderHook((props: QueueListingOptions) => useQueueListing(props), {
    initialProps: { endpoint, pageSize: 10, filter: '', ...options },
    wrapper,
  });
}

function urls(...names: string[]): string[] {
  return names.map((name) => `${AWS_HOST}/${name}`);
}

/** The keys of the list's reads in the query cache. */
function listKeys(): unknown[][] {
  return client
    .getQueryCache()
    .getAll()
    .map((query) => [...query.queryKey])
    .filter((key) => key[2] === 'list');
}

describe('the list', () => {
  it('keys each read by the prefix, the page’s token and the page size, and reads the next page with its token', async () => {
    engine.handlers.set('ListQueues', (body) =>
      body['NextToken'] === undefined ? { QueueUrls: urls('a-1'), NextToken: 'tok-2' } : { QueueUrls: urls('a-2') },
    );
    const { result } = renderListing({ pageSize: 10, filter: 'a' });

    await waitFor(() => {
      expect(result.current.queues?.map((queue) => queue.name)).toEqual(['a-1']);
    });
    expect(engine.of('ListQueues')[0]?.body).toEqual({ MaxResults: 10, QueueNamePrefix: 'a' });
    expect(result.current.openEnd).toBe(true);
    const [first] = listKeys();
    expect(first).toEqual(expect.arrayContaining([10, 'a']));

    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => {
      expect(result.current.queues?.map((queue) => queue.name)).toEqual(['a-2']);
    });
    expect(engine.of('ListQueues')[1]?.body).toEqual({ MaxResults: 10, QueueNamePrefix: 'a', NextToken: 'tok-2' });
    expect(listKeys().some((key) => key.includes('tok-2') && key.includes(10) && key.includes('a'))).toBe(true);
    expect(result.current.currentPage).toBe(2);
    expect(result.current.openEnd).toBe(false);
  });

  it('does not let a late answer replace a newer one', async () => {
    engine.held.add('ListQueues');
    const { result, rerender } = renderListing({ filter: 'old' });
    const older = await engine.nth('ListQueues', 0);

    rerender({ endpoint, pageSize: 10, filter: 'new' });
    const newer = await engine.nth('ListQueues', 1);
    expect(newer.body['QueueNamePrefix']).toBe('new');
    expect(older.signal.aborted).toBe(true);

    act(() => {
      newer.answer({ QueueUrls: urls('new-1') });
    });
    await waitFor(() => {
      expect(result.current.queues?.map((queue) => queue.name)).toEqual(['new-1']);
    });
    act(() => {
      older.answer({ QueueUrls: urls('old-1') });
    });
    await new Promise((resolve) => setTimeout(resolve, FILTER_DELAY_MS));
    expect(result.current.queues?.map((queue) => queue.name)).toEqual(['new-1']);
    expect(result.current.prefix).toBe('new');
  });
});

/** Answers for a queue named `name` with `available` messages. */
function playQueue(name: string, available: () => number) {
  engine.handlers.set('GetQueueUrl', () => ({ QueueUrl: `${AWS_HOST}/${name}` }));
  engine.handlers.set('GetQueueAttributes', () => ({
    Attributes: { QueueArn: `${ARN}:${name}`, ApproximateNumberOfMessages: String(available()) },
  }));
  engine.handlers.set('ListDeadLetterSourceQueues', () => ({ queueUrls: [] }));
}

describe('an action', () => {
  it.each(['send', 'delete', 'purge', 'redrive'] as const)(
    '%s → the queue’s details are read again, and the shown list',
    async (action) => {
      let available = 3;
      playQueue('orders', () => available);
      engine.handlers.set('ListQueues', () => ({ QueueUrls: urls('orders') }));
      engine.handlers.set('SendMessage', (body) => ({
        MessageId: 'm',
        MD5OfMessageBody: createHash('md5').update(String(body['MessageBody'])).digest('hex'),
      }));
      engine.handlers.set('DeleteMessageBatch', () => ({ Successful: [{ Id: '0' }], Failed: [] }));
      engine.handlers.set('StartMessageMoveTask', () => ({ TaskHandle: 't' }));

      const { result } = renderHook(
        () => ({
          queue: useQueue(endpoint, 'orders'),
          list: useQueueListing({ endpoint, pageSize: 10, filter: '' }),
          send: useSendMessage(endpoint),
          remove: useDeleteMessages(endpoint),
          purge: usePurgeQueue(endpoint),
          start: useStartMoveTask(endpoint),
        }),
        { wrapper },
      );
      await waitFor(() => {
        expect(result.current.queue.value).toMatchObject({ attributes: { ApproximateNumberOfMessages: '3' } });
        expect(result.current.list.queues).toHaveLength(1);
      });
      const detailsBefore = engine.of('GetQueueUrl').length;
      const listBefore = engine.of('ListQueues').length;

      available = 4;
      const signal = new AbortController().signal;
      await act(async () => {
        const url = `${AWS_HOST}/orders`;
        if (action === 'send') {
          await result.current.send({ url, fifo: false }, { body: 'x', attributes: [] }, signal);
        } else if (action === 'delete') {
          await result.current.remove(url, [{ id: 'm', receiptHandle: 'h' }], signal);
        } else if (action === 'purge') {
          await result.current.purge(url, signal);
        } else {
          await result.current.start({ sourceArn: `${ARN}:orders` }, signal);
        }
      });

      await waitFor(() => {
        expect(result.current.queue.value).toMatchObject({ attributes: { ApproximateNumberOfMessages: '4' } });
      });
      expect(engine.of('GetQueueUrl').length).toBeGreaterThan(detailsBefore);
      expect(engine.of('ListQueues').length).toBeGreaterThan(listBefore);
    },
  );
});

describe('the move tasks', () => {
  it(
    'are read every 2 seconds while one is RUNNING or CANCELLING, and not after none is',
    async () => {
      const statuses = ['RUNNING', 'CANCELLING', 'CANCELLED'];
      let reads = 0;
      engine.handlers.set('ListMessageMoveTasks', () => {
        const status = statuses[Math.min(reads, statuses.length - 1)];
        reads += 1;
        return { Results: [{ Status: status, SourceArn: `${ARN}:dlq` }] };
      });
      playQueue('dlq', () => 1);

      const { result } = renderHook(
        () => ({ queue: useQueue(endpoint, 'dlq'), tasks: useMoveTasks(endpoint, 'dlq', `${ARN}:dlq`) }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.tasks.value?.[0]?.status).toBe('RUNNING');
      });
      const started = Date.now();
      await waitFor(
        () => {
          expect(result.current.tasks.value?.[0]?.status).toBe('CANCELLING');
        },
        { timeout: MOVE_TASKS_POLL_MS + 1000 },
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(MOVE_TASKS_POLL_MS - 100);
      await waitFor(
        () => {
          expect(result.current.tasks.value?.[0]?.status).toBe('CANCELLED');
        },
        { timeout: MOVE_TASKS_POLL_MS + 1000 },
      );
      // The queue's counts are read with the tasks while one may change, and once more after.
      const detailReads = engine.of('GetQueueUrl').length;
      expect(detailReads).toBeGreaterThanOrEqual(3);

      await new Promise((resolve) => setTimeout(resolve, MOVE_TASKS_POLL_MS + 500));
      expect(engine.of('ListMessageMoveTasks')).toHaveLength(3);
      expect(engine.of('GetQueueUrl')).toHaveLength(detailReads);
      expect(engine.of('ListMessageMoveTasks')[0]?.body).toEqual({ SourceArn: `${ARN}:dlq`, MaxResults: 10 });
    },
    MOVE_TASKS_POLL_MS * 4,
  );

  it(
    'are read once, and not again, when none is running',
    async () => {
      engine.handlers.set('ListMessageMoveTasks', () => ({
        Results: [{ Status: 'COMPLETED', SourceArn: `${ARN}:dlq` }],
      }));
      const { result } = renderHook(() => useMoveTasks(endpoint, 'dlq', `${ARN}:dlq`), { wrapper });
      await waitFor(() => {
        expect(result.current.value?.[0]?.status).toBe('COMPLETED');
      });
      await new Promise((resolve) => setTimeout(resolve, MOVE_TASKS_POLL_MS + 300));
      expect(engine.of('ListMessageMoveTasks')).toHaveLength(1);
      expect(engine.of('GetQueueUrl')).toHaveLength(0);
    },
    MOVE_TASKS_POLL_MS * 3,
  );

  it('reads nothing without the queue’s ARN', async () => {
    const { result } = renderHook(() => useMoveTasks(endpoint, 'dlq', undefined), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.sent).toEqual([]);
    expect(result.current.value).toBeUndefined();
  });
});
