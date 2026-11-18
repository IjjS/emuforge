import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// A queue's page, S2, rendered inside the area's layout, as Studio's frame renders the area, against a fake engine
// behind the page's `fetch` that answers SQS's JSON 1.0 protocol (issue 481, test-criteria.md, "Unit s3").

// ---------------------------------------------------------------------------------------------------------------
// The fake engine.
// ---------------------------------------------------------------------------------------------------------------

const AWS_HOST = 'https://sqs.us-east-1.amazonaws.com/000000000000';
const ARN = 'arn:aws:sqs:us-east-1:000000000000';
const JSON_1_0 = 'application/x-amz-json-1.0';

interface FakeQueue {
  name: string;
  attributes: Record<string, string>;
  /** The names of the queues whose redrive policy names this one. */
  sources?: string[];
}

interface Answer {
  status: number;
  body: unknown;
  /** The query error header of the JSON protocol's query compatibility: `<code>;Sender`. */
  queryError?: string;
}

type EngineAnswer = Answer | 'network-error' | Promise<Answer>;

type Handler = (body: Record<string, unknown>) => EngineAnswer | undefined;

interface Sent {
  operation: string;
  body: Record<string, unknown>;
}

function ok(body: unknown): Answer {
  return { status: 200, body };
}

function refused(status: number, type: string, message: string, queryCode?: string): Answer {
  return {
    status,
    body: { __type: `com.amazonaws.sqs#${type}`, message },
    ...(queryCode === undefined ? {} : { queryError: `${queryCode};Sender` }),
  };
}

const urlOf = (name: string) => `${AWS_HOST}/${name}`;

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

/** `SendMessage`'s answer to `body`, with the digest of its body the SDK checks. */
function sentAnswer(body: Record<string, unknown>, id: string, sequence?: string): Answer {
  return ok({
    MessageId: id,
    MD5OfMessageBody: md5(String(body['MessageBody'])),
    ...(sequence === undefined ? {} : { SequenceNumber: sequence }),
  });
}

function noSuchQueue(): Answer {
  return refused(
    400,
    'QueueDoesNotExist',
    'The specified queue does not exist.',
    'AWS.SimpleQueueService.NonExistentQueue',
  );
}

class FakeEngine {
  /** The queues the emulator holds, in its order. */
  queues: FakeQueue[] = [];
  readonly sent: Sent[] = [];
  /** What `ReceiveMessage` returns, as the wire carries it. */
  messages: Record<string, unknown>[] = [];
  /** A case's own answer to an operation; `undefined` from it leaves the emulator's. */
  readonly handlers = new Map<string, Handler>();

  on(operation: string, handler: Handler) {
    this.handlers.set(operation, handler);
  }

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }

  private queue(url: unknown): FakeQueue | undefined {
    return this.queues.find((queue) => urlOf(queue.name) === url);
  }

  /** The emulator's answer: `ListQueues` pages by the index of the next queue as its token. */
  private emulator(operation: string, body: Record<string, unknown>): Answer {
    switch (operation) {
      case 'ListQueues': {
        const prefix = typeof body['QueueNamePrefix'] === 'string' ? body['QueueNamePrefix'] : '';
        const size = typeof body['MaxResults'] === 'number' ? body['MaxResults'] : 1000;
        const from = typeof body['NextToken'] === 'string' ? Number(body['NextToken']) : 0;
        const matching = this.queues.filter((queue) => queue.name.startsWith(prefix));
        const page = matching.slice(from, from + size);
        const next = from + size < matching.length ? String(from + size) : undefined;
        return ok({
          QueueUrls: page.map((queue) => urlOf(queue.name)),
          ...(next === undefined ? {} : { NextToken: next }),
        });
      }
      case 'GetQueueAttributes': {
        const queue = this.queue(body['QueueUrl']);
        return queue === undefined
          ? refused(
              400,
              'QueueDoesNotExist',
              'The specified queue does not exist.',
              'AWS.SimpleQueueService.NonExistentQueue',
            )
          : ok({ Attributes: queue.attributes });
      }
      case 'ListDeadLetterSourceQueues': {
        const queue = this.queue(body['QueueUrl']);
        return queue === undefined
          ? refused(
              400,
              'QueueDoesNotExist',
              'The specified queue does not exist.',
              'AWS.SimpleQueueService.NonExistentQueue',
            )
          : ok({ queueUrls: (queue.sources ?? []).map(urlOf) });
      }
      case 'GetQueueUrl': {
        const queue = this.queues.find((held) => held.name === body['QueueName']);
        return queue === undefined ? noSuchQueue() : ok({ QueueUrl: urlOf(queue.name) });
      }
      case 'ReceiveMessage':
        return ok({ Messages: this.messages });
      case 'SendMessage':
        return sentAnswer(body, 'sent-0001');
      case 'DeleteMessageBatch': {
        const entries = (body['Entries'] ?? []) as { Id: string }[];
        return ok({ Successful: entries.map((entry) => ({ Id: entry.Id })) });
      }
      default:
        return ok({});
    }
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-481' }), { status: 200 });
    }
    const operation = (request.headers.get('x-amz-target') ?? '').replace(/^AmazonSQS\./, '');
    const body = JSON.parse((await request.text()) || '{}') as Record<string, unknown>;
    this.sent.push({ operation, body });
    const own = this.handlers.get(operation)?.(body);
    const answer = await Promise.race([
      Promise.resolve(own ?? this.emulator(operation, body)),
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    const headers: Record<string, string> = { 'content-type': JSON_1_0 };
    if (answer.queryError !== undefined) {
      headers['x-amzn-query-error'] = answer.queryError;
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers });
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.
// ---------------------------------------------------------------------------------------------------------------

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  set(result: CheckResult | undefined) {
    this.value = { ...this.value, result };
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

const EMULATOR_PORT = 9304;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

function notStartedResult(): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT },
    reason: 'not_started',
    message: '',
  };
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 9400;
let engine: FakeEngine;
let connection: Connection;
let engineOrigin: string;

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', matchMedia);
  nextPort += 1;
  engineOrigin = engineEndpoint(nextPort);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router };
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The data rows' cells as text, in the columns' order, the selection's cell left out. */
function rows(): string[][] {
  return (table().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')].map(text).filter((_, index) => index > 0),
  );
}

function flashItems(): [string, string][] {
  return (PAGE.findFlashbar()?.findItems() ?? []).map((item) => [
    text(item.findHeader()?.getElement() ?? document.createElement('i')),
    text(item.findContent()?.getElement() ?? document.createElement('i')),
  ]);
}

async function expectFlash(expected: [string, string][]) {
  await waitFor(() => {
    expect(flashItems()).toEqual(expected);
  });
}

/** The details' values, by label, as text. */
function details(): Record<string, string> {
  const pairs = PAGE.findAllKeyValuePairs();
  expect(pairs.length).toBeGreaterThan(0);
  return Object.fromEntries(
    pairs
      .flatMap((each) => each.findItems())
      .map((item) => [
        text(item.findLabel()?.getElement() as HTMLElement),
        text(item.findValue()?.getElement() as HTMLElement),
      ]),
  );
}

function detailValue(label: string): HTMLElement {
  const item = PAGE.findAllKeyValuePairs()
    .flatMap((each) => each.findItems())
    .find((found) => text(found.findLabel()?.getElement() as HTMLElement) === label);
  expect(item).toBeDefined();
  return item?.findValue()?.getElement() as HTMLElement;
}

/** What the page's polite live regions say now. */
function announcements(): string[] {
  return [...document.querySelectorAll('.aws-area-announcer')].map(text);
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement() as HTMLElement) === label);
  expect(found).toBeDefined();
  return found as NonNullable<typeof found>;
}

function tab(label: string) {
  const tabs = PAGE.findTabs();
  const link = (tabs?.findTabLinks() ?? []).find((each) => text(each.getElement()) === label);
  return link;
}

function openTab(label: string) {
  const link = tab(label);
  expect(link).toBeDefined();
  act(() => {
    link?.click();
  });
}

/** The read warning: the alert directly above "Read messages". */
function readWarning() {
  const alerts = PAGE.findAllAlerts().filter((alert) => text(alert.getElement()).startsWith('Reading counts'));
  expect(alerts).toHaveLength(1);
  return alerts[0] as NonNullable<(typeof alerts)[0]>;
}

function standard(name: string, counts: [number, number, number] = [0, 0, 0], extra: Record<string, string> = {}) {
  return {
    QueueArn: `${ARN}:${name}`,
    ApproximateNumberOfMessages: String(counts[0]),
    ApproximateNumberOfMessagesNotVisible: String(counts[1]),
    ApproximateNumberOfMessagesDelayed: String(counts[2]),
    ...extra,
  };
}

const SIZE = { MaximumMessageSize: '1024' };

const ORDERS: FakeQueue = {
  name: 'orders',
  attributes: standard('orders', [3, 1, 1], {
    ...SIZE,
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: `${ARN}:orders-dlq`, maxReceiveCount: 2 }),
  }),
};
const DLQ: FakeQueue = { name: 'orders-dlq', attributes: standard('orders-dlq', [2, 0, 0], SIZE), sources: ['orders'] };
const PLAIN: FakeQueue = { name: 'plain', attributes: standard('plain', [15, 0, 0], SIZE) };
const FIFO: FakeQueue = {
  name: 'jobs.fifo',
  attributes: standard('jobs.fifo', [5, 0, 0], { ...SIZE, FifoQueue: 'true', ContentBasedDeduplication: 'false' }),
};
const FIFO_CBD: FakeQueue = {
  name: 'events.fifo',
  attributes: standard('events.fifo', [0, 0, 0], { ...SIZE, FifoQueue: 'true', ContentBasedDeduplication: 'true' }),
};

const SENT_MS = 1_790_000_000_000;

function wire(id: string, body: string, system: Record<string, string> = {}, attributes?: Record<string, unknown>) {
  return {
    MessageId: id,
    ReceiptHandle: `handle-${id}`,
    Body: body,
    MD5OfBody: md5(body),
    Attributes: {
      SenderId: 'AIDAEMULATOR',
      SentTimestamp: String(SENT_MS),
      ApproximateFirstReceiveTimestamp: String(SENT_MS + 1000),
      ApproximateReceiveCount: '1',
      ...system,
    },
    ...(attributes === undefined ? {} : { MessageAttributes: attributes }),
  };
}

async function openQueue(queue: FakeQueue, others: FakeQueue[] = []) {
  engine.queues = [queue, ...others];
  const opened = open(`/aws/sqs/queues/queue/${encodeURIComponent(queue.name)}`);
  await screen.findByRole('heading', { name: 'Details' });
  return opened;
}

async function readMessages() {
  const before = engine.of('ReceiveMessage').length;
  fireEvent.click(button('Read messages'));
  await waitFor(() => {
    expect(engine.of('ReceiveMessage')).toHaveLength(before + 1);
  });
  await waitFor(() => {
    expect(isDisabled(button('Read messages'))).toBe(false);
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------------------------------------------

describe('opening a queue', () => {
  it('sends no read of messages; the details show URL with its note and copy, ARN with copy, type, counts, DLQ', async () => {
    await openQueue(ORDERS, [DLQ]);

    expect(screen.getByRole('heading', { level: 1, name: 'orders' })).toBeInTheDocument();
    expect(engine.of('ReceiveMessage')).toEqual([]);
    expect(engine.of('GetQueueUrl').map((sent) => sent.body)).toEqual([{ QueueName: 'orders' }]);
    expect(engine.of('GetQueueAttributes').map((sent) => sent.body)).toEqual([
      { QueueUrl: urlOf('orders'), AttributeNames: ['All'] },
    ]);
    expect(details()).toEqual({
      URL: `${urlOf('orders')}As the emulator returns it. Studio never sends a request to this address.`,
      ARN: `${ARN}:orders`,
      Type: 'Standard',
      Available: '3',
      'In flight': '1',
      Delayed: '1',
      'Dead-letter queue': 'orders-dlq after 2 receives',
      'Dead-letter queue for': '-',
    });
    expect(within(detailValue('URL')).getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
    expect(within(detailValue('ARN')).getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    expect(within(detailValue('Dead-letter queue')).getByRole('link', { name: 'orders-dlq' })).toHaveAttribute(
      'href',
      '/aws/sqs/queues/queue/orders-dlq',
    );
    expect(screen.getByText('These queues are in your local emulator')).toBeInTheDocument();
    const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) => text(crumb.getElement()));
    expect(crumbs).toEqual(['EmuForge', 'AWS', 'SQS', 'Queues', 'orders']);
  });

  it('a dead-letter queue: the queues it is one for, as links; no read on a tab change or a refresh', async () => {
    await openQueue(DLQ, [ORDERS]);

    expect(details()['Dead-letter queue']).toBe('-');
    expect(within(detailValue('Dead-letter queue for')).getByRole('link', { name: 'orders' })).toHaveAttribute(
      'href',
      '/aws/sqs/queues/queue/orders',
    );
    openTab('Send message');
    openTab('Messages');
    fireEvent.click(button('Refresh'));
    await waitFor(() => {
      expect(engine.of('GetQueueUrl')).toHaveLength(2);
    });
    await screen.findByRole('heading', { name: 'Details' });
    expect(engine.of('ReceiveMessage')).toEqual([]);
  });
});

describe('a failed read of the queue', () => {
  it('no such queue: "No queue named {name}" with a link to the queues', async () => {
    engine.queues = [];
    open('/aws/sqs/queues/queue/nope');

    expect(await screen.findByText('No queue named')).toBeInTheDocument();
    const link = screen
      .getAllByRole('link', { name: 'Queues' })
      .find((each) => each.closest('nav') === null && each.getAttribute('aria-current') === null);
    expect(link).toBeDefined();
    expect(link).toHaveAttribute('href', '/aws/sqs/queues');
    expect(screen.queryByRole('button', { name: 'Purge' })).toBeNull();
    expect(text(screen.getByText('No queue named').parentElement as HTMLElement)).toBe('No queue named nope');
  });

  it.each([
    [
      'HTTP 501',
      () => refused(501, 'NotImplemented', 'not here'),
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for GetQueueUrl, so Studio cannot show the queue.',
    ],
    [
      'AccessDenied',
      () => refused(403, 'AccessDenied', 'no policy allows it'),
      'Access denied',
      'GetQueueUrl was refused: no policy allows it',
    ],
    ['another code', () => refused(500, 'InternalError', 'boom'), 'The queue could not be read', 'InternalError: boom'],
  ])('%s: its state, with "Retry"', async (_, answer, first, detail) => {
    engine.on('GetQueueUrl', answer);
    engine.queues = [ORDERS];
    open('/aws/sqs/queues/queue/orders');

    expect((await screen.findAllByText(first)).length).toBeGreaterThan(0);
    expect(text(document.body)).toContain(detail);
    expect(button('Retry')).toBeInTheDocument();
  });

  it('not connected: the emulator line’s words, then read again once connected', async () => {
    engine.on('GetQueueUrl', () => 'network-error');
    engine.queues = [ORDERS];
    connection.value = { result: notStartedResult(), engineOrigin };
    open('/aws/sqs/queues/queue/orders');

    expect(await screen.findByText('The queue could not be read.')).toBeInTheDocument();
    engine.handlers.delete('GetQueueUrl');
    connection.set(connectedResult());
    expect(await screen.findByRole('heading', { name: 'Details' })).toBeInTheDocument();
  });

  it('the emulator not answering: its state', async () => {
    engine.on('GetQueueUrl', () => 'network-error');
    engine.queues = [ORDERS];
    open('/aws/sqs/queues/queue/orders');

    expect((await screen.findAllByText(/did not answer/)).length).toBeGreaterThan(0);
  });
});

describe('the read warning', () => {
  it('without a redrive policy: the info warning’s two sentences', async () => {
    await openQueue(PLAIN);

    const warning = readWarning();
    expect(text(warning.getElement())).toBe(
      'Reading counts as receiving: each message read here has its receive count raised by one. Messages read here stay in the queue.',
    );
    expect(warning.getElement().outerHTML).toMatch(/type-info/);
    expect(warning.findDismissButton()).toBeNull();
  });

  it('with one: the warning type, the dead-letter queue’s name as a link and its maxReceiveCount', async () => {
    await openQueue(ORDERS, [DLQ]);

    const warning = readWarning();
    expect(text(warning.getElement())).toBe(
      'Reading counts as receiving: each message read here has its receive count raised by one. Once a message has been received 2 times in this queue, the next read moves it to orders-dlq instead of showing it. A message moved back keeps the receive count shown here, and is moved again after 2 more reads.',
    );
    expect(warning.getElement().outerHTML).toMatch(/type-warning/);
    expect(within(warning.getElement()).getByRole('link', { name: 'orders-dlq' })).toHaveAttribute(
      'href',
      '/aws/sqs/queues/queue/orders-dlq',
    );
  });
});

describe('singular forms at 1', () => {
  it('a policy of 1: "received 1 time", "after 1 more read", "after 1 receive"', async () => {
    const policy = JSON.stringify({ deadLetterTargetArn: `${ARN}:orders-dlq`, maxReceiveCount: 1 });
    await openQueue({ ...ORDERS, attributes: { ...ORDERS.attributes, RedrivePolicy: policy } }, [DLQ]);

    expect(text(readWarning().getElement())).toBe(
      'Reading counts as receiving: each message read here has its receive count raised by one. Once a message has been received 1 time in this queue, the next read moves it to orders-dlq instead of showing it. A message moved back keeps the receive count shown here, and is moved again after 1 more read.',
    );
    expect(details()['Dead-letter queue']).toBe('orders-dlq after 1 receive');
  });
});

describe('the tabs', () => {
  it('"Redrive" only when the queue has sources', async () => {
    const { unmount } = await openQueue(PLAIN);
    expect((PAGE.findTabs()?.findTabLinks() ?? []).map((link) => text(link.getElement()))).toEqual([
      'Messages',
      'Send message',
    ]);
    unmount();

    await openQueue(DLQ, [ORDERS]);
    expect((PAGE.findTabs()?.findTabLinks() ?? []).map((link) => text(link.getElement()))).toEqual([
      'Messages',
      'Redrive',
      'Send message',
    ]);
  });
});

describe('a read of messages', () => {
  it('the table in the order returned, "Read at", the details read again; more available → "Showing the first"', async () => {
    engine.messages = Array.from({ length: 10 }, (_, index) =>
      wire(`m${String(index + 1).padStart(2, '0')}`, index === 0 ? 'first line\nsecond line' : `body ${String(index)}`),
    );
    await openQueue(PLAIN);
    const attributeReads = engine.of('GetQueueAttributes').length;

    fireEvent.click(button('Read messages'));
    await waitFor(() => {
      expect(rows()).toHaveLength(10);
    });

    expect(engine.of('ReceiveMessage').map((sent) => sent.body)).toEqual([
      {
        QueueUrl: urlOf('plain'),
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 0,
        WaitTimeSeconds: 0,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['All'],
      },
    ]);
    const headers = (table().findColumnHeaders() ?? []).map((header) => text(header.getElement()));
    expect(headers.slice(1)).toEqual(['Message ID', 'Receive count', 'Body', 'Sent']);
    expect(rows().map((row) => row[0])).toEqual(engine.messages.map((message) => message['MessageId']));
    expect(rows()[0]?.slice(0, 3)).toEqual(['m01', '1', 'first line…']);
    expect(text(table().findHeaderSlot()?.getElement() as HTMLElement)).toMatch(/Read at \w+ \d+, \d{4}, /);
    expect(
      screen.getByText(
        'Showing the first 10 of 15 available messages. A read returns the same first messages each time, at most 10.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(engine.of('GetQueueAttributes').length).toBeGreaterThan(attributeReads);
    });
  });

  it('on a queue with a redrive policy: the header says when it was read, and no more', async () => {
    engine.messages = [wire('m1', 'a')];
    await openQueue(ORDERS, [DLQ]);
    await readMessages();
    expect(text(table().findHeaderSlot()?.getElement() as HTMLElement)).toMatch(/Read at \w+ \d+, \d{4}, [^.]*\)$/);
    expect(text(table().findHeaderSlot()?.getElement() as HTMLElement)).not.toContain('Moved to');
  });

  it('a read announces how many messages it read', async () => {
    engine.messages = [wire('m1', 'a')];
    await openQueue(PLAIN);
    await readMessages();
    await waitFor(() => {
      expect(announcements()).toContain('1 message read');
    });
    engine.messages = [wire('m1', 'a'), wire('m2', 'b')];
    await readMessages();
    await waitFor(() => {
      expect(announcements()).toContain('2 messages read');
    });
  });

  it('Message ID, Group and From keep the room of a name, as the queue list’s', async () => {
    engine.messages = [wire('f1', 'a', { MessageGroupId: 'g1', DeadLetterQueueSourceArn: `${ARN}:orders` })];
    await openQueue({ ...FIFO, sources: ['orders'] }, [ORDERS]);
    await readMessages();

    const widths = (table().findColumnHeaders() ?? []).map((header) => [
      text(header.getElement()),
      header.getElement().style.minWidth,
    ]);
    expect(widths.filter(([, width]) => width === '28ch').map(([name]) => name)).toEqual([
      'Message ID',
      'Group',
      'From',
    ]);
  });

  it('the after-read sentence is in a polite live region', async () => {
    engine.messages = [wire('m1', 'a')];
    await openQueue(PLAIN);
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region).not.toBeNull();
    await readMessages();

    const sentence = screen.getByText(
      'Showing the first 1 of 15 available messages. A read returns the same first messages each time, at most 10.',
    );
    expect(sentence.closest('[aria-live="polite"]')).toBe(region);
  });

  /** A read that moves `moved` messages of `orders` to its dead-letter queue. */
  function moving(moved: number) {
    engine.on('ReceiveMessage', () => {
      engine.queues = engine.queues.map((queue) =>
        queue.name === 'orders-dlq'
          ? { ...queue, attributes: { ...queue.attributes, ApproximateNumberOfMessages: String(2 + moved) } }
          : queue,
      );
      return ok({ Messages: [] });
    });
  }

  it('a policy read returning fewer, the DLQ’s count risen by k: the move sentence with the DLQ’s link', async () => {
    moving(3);
    await openQueue(ORDERS, [DLQ]);
    const reads = engine.of('GetQueueAttributes').length;
    await readMessages();

    const sentence = await screen.findByText(/were moved to/);
    expect(text(sentence)).toBe(
      '3 messages received 2 times in this queue were moved to orders-dlq by this read instead of being shown.',
    );
    expect(within(sentence).getByRole('link', { name: 'orders-dlq' })).toHaveAttribute(
      'href',
      '/aws/sqs/queues/queue/orders-dlq',
    );
    expect(sentence.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.queryByText(/No message is available to read/)).toBeNull();
    // The dead-letter queue's count is read just before and just after the read.
    const around = engine.sent
      .slice(engine.sent.findIndex((sent) => sent.body['QueueName'] === 'orders-dlq'))
      .filter(
        (sent) =>
          sent.operation === 'ReceiveMessage' ||
          sent.body['QueueUrl'] === urlOf('orders-dlq') ||
          sent.body['QueueName'] === 'orders-dlq',
      )
      .map((sent) => sent.operation);
    expect(around.slice(0, 4)).toEqual(['GetQueueUrl', 'GetQueueAttributes', 'ReceiveMessage', 'GetQueueAttributes']);
    expect(engine.of('GetQueueAttributes').length).toBeGreaterThan(reads + 2);
  });

  it('what was available is the queue’s own count read just before the read, not the count shown', async () => {
    engine.messages = [wire('m1', 'a')];
    await openQueue(ORDERS, [DLQ]);
    // Another consumer took two of the three shown before "Read messages" was pressed.
    engine.queues = engine.queues.map((queue) =>
      queue.name === 'orders'
        ? { ...queue, attributes: { ...queue.attributes, ApproximateNumberOfMessages: '1' } }
        : queue,
    );
    const from = engine.sent.length;
    await readMessages();

    const asked = engine.sent.slice(from).map((sent) => [sent.operation, sent.body['QueueUrl']]);
    const receive = asked.findIndex(([operation]) => operation === 'ReceiveMessage');
    expect(asked[receive - 1]).toEqual(['GetQueueAttributes', urlOf('orders')]);
    expect(screen.queryByText(/^This read returned|were moved to/)).toBeNull();
  });

  it('the moved count is at most what the read did not show of what was available', async () => {
    engine.messages = [wire('m1', 'a')];
    // The dead-letter queue's count rises by 5 across the read (some sent there by another app).
    engine.on('ReceiveMessage', () => {
      engine.queues = engine.queues.map((queue) =>
        queue.name === 'orders-dlq'
          ? { ...queue, attributes: { ...queue.attributes, ApproximateNumberOfMessages: '7' } }
          : queue,
      );
      return ok({ Messages: engine.messages });
    });
    await openQueue(ORDERS, [DLQ]);
    await readMessages();

    expect(text(await screen.findByText(/were moved to/))).toBe(
      '2 messages received 2 times in this queue were moved to orders-dlq by this read instead of being shown.',
    );
  });

  it('a rise of 1 on a policy of 1: the singular forms', async () => {
    moving(1);
    const policy = JSON.stringify({ deadLetterTargetArn: `${ARN}:orders-dlq`, maxReceiveCount: 1 });
    await openQueue({ ...ORDERS, attributes: { ...ORDERS.attributes, RedrivePolicy: policy } }, [DLQ]);
    await readMessages();

    expect(text(await screen.findByText(/was moved to/))).toBe(
      '1 message received 1 time in this queue was moved to orders-dlq by this read instead of being shown.',
    );
  });

  it('a policy read returning fewer, the DLQ’s count not risen: what the read returned of what was available', async () => {
    engine.messages = [wire('m1', 'a')];
    await openQueue(ORDERS, [DLQ]);
    await readMessages();

    const sentence = await screen.findByText(/^This read returned/);
    expect(text(sentence)).toMatch(/^This read returned 1 of the 3 messages available at \w+ \d+, \d{4}, .*\)\.$/);
    expect(text(sentence)).toContain(
      text(table().findHeaderSlot()?.getElement() as HTMLElement).replace(/^.*Read at /, ''),
    );
    expect(screen.queryByText(/were moved to/)).toBeNull();
  });

  it('a queue without a policy: the empty-read and "Showing the first" sentences, never the policy’s', async () => {
    engine.messages = [];
    await openQueue(PLAIN);
    await readMessages();
    expect(screen.getByText(/^No message is available to read\./)).toBeInTheDocument();
    engine.messages = [wire('m1', 'a')];
    await readMessages();
    expect(screen.getByText(/^Showing the first 1 of 15 available messages\./)).toBeInTheDocument();
    expect(screen.queryByText(/^This read returned|were moved to/)).toBeNull();
    expect(engine.of('GetQueueUrl').map((sent) => sent.body['QueueName'])).toEqual(
      engine.of('GetQueueUrl').map(() => 'plain'),
    );
  });

  it('a policy queue with nothing available: an empty read keeps the empty-read sentence', async () => {
    engine.messages = [];
    await openQueue({ ...ORDERS, attributes: { ...ORDERS.attributes, ApproximateNumberOfMessages: '0' } }, [DLQ]);
    await readMessages();

    expect(
      screen.getByText(
        'No message is available to read. Messages in flight or delayed are not returned until they are visible again.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/were moved to/)).toBeNull();
  });

  it('the wait chosen is sent; the button is disabled while the read waits', async () => {
    const answer = deferred<Answer>();
    engine.on('ReceiveMessage', () => answer.promise);
    await openQueue(PLAIN);

    const select = PAGE.findSelect();
    act(() => {
      select?.openDropdown();
    });
    act(() => {
      select?.selectOptionByValue('20');
    });
    fireEvent.click(button('Read messages'));
    await waitFor(() => {
      expect(engine.of('ReceiveMessage')).toHaveLength(1);
    });
    expect(engine.of('ReceiveMessage')[0]?.body['WaitTimeSeconds']).toBe(20);
    expect(isDisabled(button('Read messages'))).toBe(true);
    answer.resolve(ok({ Messages: [] }));
    await waitFor(() => {
      expect(isDisabled(button('Read messages'))).toBe(false);
    });
  });

  it('on FIFO: the Group column; fewer than available → the FIFO sentence', async () => {
    engine.messages = [wire('f1', 'a', { MessageGroupId: 'g1', MessageDeduplicationId: 'd1', SequenceNumber: '7' })];
    await openQueue(FIFO);
    await readMessages();

    const headers = (table().findColumnHeaders() ?? []).map((header) => text(header.getElement()));
    expect(headers.slice(1)).toEqual(['Message ID', 'Receive count', 'Body', 'Sent', 'Group']);
    expect(rows()[0]?.[4]).toBe('g1');
    expect(
      screen.getByText(
        'Messages of a group your app has received and not yet deleted are not returned until they are visible again.',
      ),
    ).toBeInTheDocument();
  });

  it('on a dead-letter queue: the From column with its source as a link', async () => {
    engine.messages = [wire('d1', 'dead', { DeadLetterQueueSourceArn: `${ARN}:orders` })];
    await openQueue(DLQ, [ORDERS]);
    await readMessages();

    const headers = (table().findColumnHeaders() ?? []).map((header) => text(header.getElement()));
    expect(headers.slice(1)).toEqual(['Message ID', 'Receive count', 'Body', 'Sent', 'From']);
    const row = table().findRows()[0]?.getElement() as HTMLElement;
    expect(within(row).getByRole('link', { name: 'orders' })).toHaveAttribute('href', '/aws/sqs/queues/queue/orders');
  });

  it('none: the empty-read sentence', async () => {
    engine.messages = [];
    await openQueue({ ...PLAIN, attributes: standard('plain', [0, 2, 1], SIZE) });
    await readMessages();

    expect(
      screen.getByText(
        'No message is available to read. Messages in flight or delayed are not returned until they are visible again.',
      ),
    ).toBeInTheDocument();
  });

  it('a refused read: its item with code and message', async () => {
    engine.on('ReceiveMessage', () => noSuchQueue());
    await openQueue(PLAIN);
    fireEvent.click(button('Read messages'));

    await expectFlash([
      ['Reading the messages failed', 'AWS.SimpleQueueService.NonExistentQueue: The specified queue does not exist.'],
    ]);
  });
});

describe('a message’s detail', () => {
  const JSON_BODY = '{"order":1,"items":["a"]}';

  async function openDetail(id: string) {
    fireEvent.click(within(table().getElement()).getByText(id));
    return screen.findByRole('heading', { name: `Message ${id}` });
  }

  function body(): string {
    return document.querySelector('.aws-sqs-message-body')?.textContent ?? '';
  }

  it('the body exactly; "Format JSON" for a JSON body indents it; Binary as Base64; system attributes; focus', async () => {
    engine.messages = [
      wire(
        'j1',
        JSON_BODY,
        {
          MessageGroupId: 'g',
          MessageDeduplicationId: 'dd',
          SequenceNumber: '42',
          DeadLetterQueueSourceArn: `${ARN}:orders`,
        },
        {
          kind: { DataType: 'String', StringValue: 'order' },
          weight: { DataType: 'Number', StringValue: '1.5' },
          blob: { DataType: 'Binary', BinaryValue: 'AAEC/w==' },
        },
      ),
    ];
    await openQueue(PLAIN);
    await readMessages();
    const heading = await openDetail('j1');

    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(body()).toBe(JSON_BODY);
    const toggle = PAGE.findToggle();
    expect(text(toggle?.getElement() as HTMLElement)).toBe('Format JSON');
    act(() => {
      toggle?.findNativeInput().click();
    });
    expect(body()).toBe(JSON.stringify(JSON.parse(JSON_BODY), null, 2));
    expect(screen.getByRole('button', { name: 'Copy body' })).toBeInTheDocument();

    const tables = PAGE.findAllTables();
    const attributes = tables[tables.length - 1];
    const cells = (attributes?.findRows() ?? []).map((row) =>
      [...row.getElement().querySelectorAll('td, th')].map(text),
    );
    expect(cells).toEqual([
      ['kind', 'String', 'order'],
      ['weight', 'Number', '1.5'],
      ['blob', 'Binary', 'AAEC/w=='],
    ]);
    const container = document.body;
    for (const label of [
      'Sender ID',
      'Sent',
      'First received',
      'Receive count',
      'Group ID',
      'Deduplication ID',
      'Sequence number',
      'Dead-letter source queue',
    ]) {
      expect(within(container).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(within(container).getByText('AIDAEMULATOR')).toBeInTheDocument();
    expect(within(container).getByText('42')).toBeInTheDocument();
  });

  it('a body that is not JSON: no "Format JSON"; every line exactly', async () => {
    engine.messages = [wire('t1', 'line one\n  line <b>two</b>')];
    await openQueue(PLAIN);
    await readMessages();
    await openDetail('t1');

    expect(PAGE.findToggle()).toBeNull();
    expect(body()).toBe('line one\n  line <b>two</b>');
    expect(document.querySelector('.aws-sqs-message-body b')).toBeNull();
  });
});

describe('the send form', () => {
  async function openSend(queue: FakeQueue) {
    await openQueue(queue);
    openTab('Send message');
    await screen.findByRole('heading', { name: 'Send a test message' });
  }

  function setBody(value: string) {
    act(() => {
      field('Body').findControl()?.findTextarea()?.setTextareaValue(value);
    });
  }

  function setInput(label: string, value: string) {
    act(() => {
      field(label).findControl()?.findInput()?.setInputValue(value);
    });
  }

  function editor() {
    const found = PAGE.findAttributeEditor();
    expect(found).not.toBeNull();
    return found as NonNullable<typeof found>;
  }

  function addAttribute(type: 'String' | 'Number' | 'Binary', name: string, value: string) {
    act(() => {
      editor().findAddButton().click();
    });
    const row = editor().findRow(editor().findRows().length);
    act(() => {
      row?.findField(1)?.findControl()?.findInput()?.setInputValue(name);
    });
    if (type !== 'String') {
      const select = row?.findField(2)?.findControl()?.findSelect();
      act(() => {
        select?.openDropdown();
      });
      act(() => {
        select?.selectOptionByValue(type);
      });
    }
    act(() => {
      row?.findField(3)?.findControl()?.findInput()?.setInputValue(value);
    });
  }

  function send() {
    fireEvent.click(button('Send'));
  }

  function error(label: string): string | undefined {
    const found = field(label).findError()?.getElement();
    return found === undefined ? undefined : text(found);
  }

  it('an empty body, a body over MaximumMessageSize, a delay outside 0 to 900 → refused before sending', async () => {
    await openSend(PLAIN);

    expect(text(field('Body').findConstraint()?.getElement() as HTMLElement)).toBe('Up to 1,024 bytes.');
    expect(text(field('Delay').findConstraint()?.getElement() as HTMLElement)).toBe('0 to 900 seconds.');
    send();
    expect(error('Body')).toBe('Enter a body.');
    setBody('é'.repeat(513));
    expect(error('Body')).toBe('The body is 1026 bytes; this queue takes up to 1024 bytes.');
    setBody('hello');
    setInput('Delay', '901');
    send();
    expect(error('Delay')).toBe('Enter a whole number of seconds from 0 to 900.');
    setInput('Delay', '-1');
    expect(error('Delay')).toBe('Enter a whole number of seconds from 0 to 900.');
    expect(engine.of('SendMessage')).toEqual([]);
  });

  it('a Number that is not a number, Base64 that is not → refused with their messages; an 11th cannot be added', async () => {
    await openSend(PLAIN);
    setBody('hello');
    addAttribute('Number', 'n', 'twelve');
    addAttribute('Binary', 'b', 'not base64!');
    send();

    const rowError = (row: number, column: number) =>
      text(editor().findRow(row)?.findField(column)?.findError()?.getElement() as HTMLElement);
    expect(rowError(1, 3)).toBe('Enter a number.');
    expect(rowError(2, 3)).toBe('Enter the value as Base64 text.');
    expect(engine.of('SendMessage')).toEqual([]);

    for (let index = 3; index <= 10; index += 1) {
      addAttribute('String', `s${String(index)}`, 'v');
    }
    expect(editor().findRows()).toHaveLength(10);
    expect(isDisabled(editor().findAddButton().getElement())).toBe(true);
    expect(text(editor().findAdditionalInfo()?.getElement() as HTMLElement)).toBe('Up to 10 attributes.');
  });

  it('FIFO: Group ID and Deduplication ID are two fields of the form’s spacing', async () => {
    await openSend(FIFO);

    const child = (label: string) => field(label).getElement().closest('[class*="awsui_child"]');
    expect(child('Group ID')).not.toBeNull();
    expect(child('Group ID')).not.toBe(child('Deduplication ID'));
    expect(child('Group ID')?.parentElement).toBe(child('Deduplication ID')?.parentElement);
    expect(child('Body')?.parentElement).toBe(child('Group ID')?.parentElement);
  });

  it('the size rule: grouped, and in MiB when a whole number of them', async () => {
    await openSend({ ...PLAIN, attributes: { ...PLAIN.attributes, MaximumMessageSize: '1048576' } });

    expect(text(field('Body').findConstraint()?.getElement() as HTMLElement)).toBe('Up to 1,048,576 bytes (1 MiB).');
  });

  it('FIFO: Group ID required, Deduplication ID required, no Delay', async () => {
    await openSend(FIFO);
    setBody('hello');
    send();

    expect(PAGE.findAllFormFields().map((each) => text(each.findLabel()?.getElement() as HTMLElement))).not.toContain(
      'Delay',
    );
    expect(error('Group ID')).toBe('Enter a group ID.');
    expect(error('Deduplication ID')).toBe('Enter a deduplication ID.');
    expect(engine.of('SendMessage')).toEqual([]);
  });

  it('FIFO with content-based deduplication: the Deduplication ID is optional', async () => {
    await openSend(FIFO_CBD);
    expect(text(field('Deduplication ID - optional').findDescription()?.getElement() as HTMLElement)).toBe(
      'Leave empty to deduplicate by the body.',
    );
    engine.on('SendMessage', (body) => sentAnswer(body, 'fifo-1', '18800000000000000001'));
    setBody('hello');
    setInput('Group ID', 'g1');
    send();

    await expectFlash([['Message sent to events.fifo', 'Message ID: fifo-1Sequence number: 18800000000000000001']]);
    expect(engine.of('SendMessage')[0]?.body).toEqual({
      QueueUrl: urlOf('events.fifo'),
      MessageBody: 'hello',
      MessageGroupId: 'g1',
    });
  });

  it('a send: disabled while in flight; success with its ID, the form kept, a Binary sent as its bytes', async () => {
    const answer = deferred<Answer>();
    let asked: Record<string, unknown> = {};
    engine.on('SendMessage', (body) => {
      asked = body;
      return answer.promise;
    });
    await openSend(PLAIN);
    setBody('hello');
    setInput('Delay', '5');
    addAttribute('Binary', 'b', 'AAEC/w==');
    send();

    await waitFor(() => {
      expect(engine.of('SendMessage')).toHaveLength(1);
    });
    expect(isDisabled(button('Send'))).toBe(true);
    expect(engine.of('SendMessage')[0]?.body).toEqual({
      QueueUrl: urlOf('plain'),
      MessageBody: 'hello',
      DelaySeconds: 5,
      MessageAttributes: { b: { DataType: 'Binary', BinaryValue: 'AAEC/w==' } },
    });
    answer.resolve(sentAnswer(asked, 'sent-7'));

    await expectFlash([['Message sent to plain', 'Message ID: sent-7']]);
    expect(isDisabled(button('Send'))).toBe(false);
    expect(field('Body').findControl()?.findTextarea()?.getTextareaValue()).toBe('hello');
    fireEvent.click(button('Clear'));
    expect(field('Body').findControl()?.findTextarea()?.getTextareaValue()).toBe('');
  });

  it('a refused send: "Sending the message failed" with code and message as they came', async () => {
    engine.on('SendMessage', () =>
      refused(400, 'InvalidParameterValue', 'Message must be shorter than 1024 bytes.', 'InvalidParameterValue'),
    );
    await openSend(PLAIN);
    setBody('hello');
    send();

    await expectFlash([
      ['Sending the message failed', 'InvalidParameterValue: Message must be shorter than 1024 bytes.'],
    ]);
  });
});

describe('deleting messages', () => {
  async function readThree() {
    engine.messages = [wire('m1', 'a'), wire('m2', 'b'), wire('m3', 'c')];
    await openQueue(PLAIN);
    await readMessages();
  }

  function select(row: number) {
    act(() => {
      table().findRowSelectionArea(row)?.click();
    });
  }

  function modal() {
    const found = PAGE.findModal();
    expect(found).not.toBeNull();
    return found as NonNullable<typeof found>;
  }

  async function confirmWith(word: string, action: string) {
    await waitFor(() => {
      expect(PAGE.findModal()).not.toBeNull();
    });
    const confirm = within(modal().getElement()).getByRole('button', { name: action });
    expect(isDisabled(confirm)).toBe(true);
    act(() => {
      modal().findContent().findInput()?.setInputValue(word.slice(0, -1));
    });
    expect(isDisabled(confirm)).toBe(true);
    act(() => {
      modal().findContent().findInput()?.setInputValue(word);
    });
    expect(isDisabled(confirm)).toBe(false);
    fireEvent.click(confirm);
  }

  it('the dialog needs "delete" typed; all deleted → "Deleted {n} messages from {name}"', async () => {
    await readThree();
    expect(isDisabled(within(table().getElement()).getByRole('button', { name: 'Delete' }))).toBe(true);
    select(1);
    select(3);
    fireEvent.click(within(table().getElement()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(text(modal().findHeader().getElement())).toBe('Delete 2 messages from plain?');
    });
    expect(text(modal().findContent().getElement())).toContain(
      'They are deleted from your local emulator. This cannot be undone.',
    );
    await confirmWith('delete', 'Delete');

    await expectFlash([['', 'Deleted 2 messages from plain']]);
    expect(engine.of('DeleteMessageBatch').map((sent) => sent.body)).toEqual([
      {
        QueueUrl: urlOf('plain'),
        Entries: [
          { Id: '0', ReceiptHandle: 'handle-m1' },
          { Id: '1', ReceiptHandle: 'handle-m3' },
        ],
      },
    ]);
    expect(rows().map((row) => row[0])).toEqual(['m2']);
    expect(PAGE.findModal()).toBeNull();
  });

  it('one message: "Delete 1 message from {name}?" and "It is deleted …"', async () => {
    await readThree();
    select(2);
    fireEvent.click(within(table().getElement()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(text(modal().findHeader().getElement())).toBe('Delete 1 message from plain?');
    });
    expect(text(modal().findContent().getElement())).toContain(
      'It is deleted from your local emulator. This cannot be undone.',
    );
    await confirmWith('delete', 'Delete');
    await expectFlash([['', 'Deleted 1 message from plain']]);
  });

  it('some failed → "{k} of {n} messages could not be deleted" with each ID, code and message; failed rows kept selected', async () => {
    engine.on('DeleteMessageBatch', () =>
      ok({
        Successful: [{ Id: '0' }],
        Failed: [
          { Id: '1', Code: 'ReceiptHandleIsInvalid', Message: 'The receipt handle is not valid.', SenderFault: true },
        ],
      }),
    );
    await readThree();
    select(1);
    select(2);
    fireEvent.click(within(table().getElement()).getByRole('button', { name: 'Delete' }));
    await confirmWith('delete', 'Delete');

    await expectFlash([
      ['1 of 2 messages could not be deleted', 'm2: ReceiptHandleIsInvalid: The receipt handle is not valid.1 deleted'],
    ]);
    expect(rows().map((row) => row[0])).toEqual(['m2', 'm3']);
    expect(
      table()
        .findSelectedRows()
        .map((row) => text(row.getElement()).includes('m2')),
    ).toEqual([true]);
  });
});

describe('purging', () => {
  function modal() {
    const found = PAGE.findModal();
    expect(found).not.toBeNull();
    return found as NonNullable<typeof found>;
  }

  async function purgeWithWord() {
    fireEvent.click(button('Purge'));
    await waitFor(() => {
      expect(PAGE.findModal()).not.toBeNull();
    });
    expect(text(modal().findHeader().getElement())).toBe('Purge plain?');
    expect(text(modal().findContent().getElement())).toContain(
      'Every message in plain is deleted from your local emulator. This cannot be undone.',
    );
    const confirm = within(modal().getElement()).getByRole('button', { name: 'Purge' });
    expect(isDisabled(confirm)).toBe(true);
    act(() => {
      modal().findContent().findInput()?.setInputValue('purge');
    });
    expect(isDisabled(confirm)).toBe(false);
    fireEvent.click(confirm);
  }

  it('"Purge" is disabled while the queue is read, with its reason', async () => {
    const answer = deferred<Answer>();
    engine.queues = [PLAIN];
    engine.on('GetQueueUrl', () => answer.promise);
    open('/aws/sqs/queues/queue/plain');

    const purge = await screen.findByRole('button', { name: 'Purge' });
    expect(isDisabled(purge)).toBe(true);
    expect(purge).toHaveAccessibleDescription('Reading the queue');
    answer.resolve(ok({ QueueUrl: urlOf('plain') }));
    await screen.findByRole('heading', { name: 'Details' });
    expect(isDisabled(button('Purge'))).toBe(false);
  });

  it('the dialog needs "purge" typed; success → "Purged {name}" and the read result cleared', async () => {
    engine.messages = [wire('m1', 'a')];
    await openQueue(PLAIN);
    await readMessages();
    expect(rows()).toHaveLength(1);

    await purgeWithWord();

    await expectFlash([['', 'Purged plain']]);
    expect(engine.of('PurgeQueue').map((sent) => sent.body)).toEqual([{ QueueUrl: urlOf('plain') }]);
    expect(PAGE.findTable()).toBeNull();
  });

  it('a refusal → its code and message', async () => {
    engine.on('PurgeQueue', () =>
      refused(
        403,
        'PurgeQueueInProgress',
        'Only one PurgeQueue operation on plain is allowed every 60 seconds.',
        'AWS.SimpleQueueService.PurgeQueueInProgress',
      ),
    );
    await openQueue(PLAIN);
    await purgeWithWord();

    await expectFlash([
      [
        'Purging plain failed',
        'AWS.SimpleQueueService.PurgeQueueInProgress: Only one PurgeQueue operation on plain is allowed every 60 seconds.',
      ],
    ]);
  });
});

describe('501 and AccessDenied for a read, a send, a delete and a purge', () => {
  const NOT_IMPLEMENTED = () => refused(501, 'NotImplemented', 'not here');
  const DENIED = () => refused(403, 'AccessDenied', 'no policy allows it');

  async function act501AndDenied(operation: string, run: () => Promise<void>) {
    engine.on(operation, NOT_IMPLEMENTED);
    await run();
    await expectFlash([
      ['Not implemented by the emulator', `The emulator answered 501 Not Implemented for ${operation}.`],
    ]);
  }

  it.each(['ReceiveMessage', 'SendMessage', 'DeleteMessageBatch', 'PurgeQueue'])(
    '%s: "Not implemented by the emulator" with the operation, "Access denied" with the reason',
    async (operation) => {
      engine.messages = [wire('m1', 'a')];
      await openQueue(PLAIN);
      const run = async () => {
        switch (operation) {
          case 'ReceiveMessage':
            fireEvent.click(button('Read messages'));
            break;
          case 'SendMessage':
            openTab('Send message');
            act(() => {
              field('Body').findControl()?.findTextarea()?.setTextareaValue('hello');
            });
            fireEvent.click(button('Send'));
            openTab('Messages');
            break;
          case 'DeleteMessageBatch': {
            if (PAGE.findTable() === null) {
              await readMessages();
            }
            if (table().findSelectedRows().length === 0) {
              act(() => {
                table().findRowSelectionArea(1)?.click();
              });
            }
            fireEvent.click(within(table().getElement()).getByRole('button', { name: 'Delete' }));
            await waitFor(() => {
              expect(PAGE.findModal()).not.toBeNull();
            });
            act(() => {
              PAGE.findModal()?.findContent().findInput()?.setInputValue('delete');
            });
            fireEvent.click(
              within(PAGE.findModal()?.getElement() as HTMLElement).getByRole('button', { name: 'Delete' }),
            );
            break;
          }
          case 'PurgeQueue':
            fireEvent.click(button('Purge'));
            await waitFor(() => {
              expect(PAGE.findModal()).not.toBeNull();
            });
            act(() => {
              PAGE.findModal()?.findContent().findInput()?.setInputValue('purge');
            });
            fireEvent.click(
              within(PAGE.findModal()?.getElement() as HTMLElement).getByRole('button', { name: 'Purge' }),
            );
            break;
        }
        await waitFor(() => {
          expect(PAGE.findModal()).toBeNull();
        });
      };
      await act501AndDenied(operation, run);

      engine.on(operation, DENIED);
      await run();
      await expectFlash([['Access denied', `${operation} was refused: no policy allows it`]]);
    },
  );
});
