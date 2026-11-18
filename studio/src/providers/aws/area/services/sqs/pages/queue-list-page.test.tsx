import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// SQS's queue list rendered inside the area's layout, as Studio's frame renders the area, against a fake engine behind
// the page's `fetch` that answers SQS's JSON 1.0 protocol (issue 481, test-criteria.md, "Unit s2").

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

class FakeEngine {
  /** The queues the emulator holds, in its order. */
  queues: FakeQueue[] = [];
  readonly sent: Sent[] = [];
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

function open(path = '/aws/sqs') {
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

/** The data rows' cells as text, in the columns' order. */
function rows(): string[][] {
  return (table().findRows() ?? []).map((row) => [...row.getElement().querySelectorAll('td, th')].map(text));
}

function names(): string[] {
  return rows().map((row) => row[0] ?? '');
}

async function expectNames(expected: string[]) {
  await waitFor(() => {
    expect(names()).toEqual(expected);
  });
}

function slot(): HTMLElement {
  const found = table().findEmptySlot()?.getElement();
  expect(found).toBeDefined();
  return found as HTMLElement;
}

function refreshButton(): HTMLElement {
  return within(table().getElement()).getByRole('button', { name: 'Refresh' });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function nextPage(): HTMLButtonElement {
  return table().findPagination()?.findNextPageButton().getElement() as HTMLButtonElement;
}

function filterInput(): HTMLInputElement {
  return screen.getByRole('searchbox', { name: 'Search by name prefix' });
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

const ORDERS: FakeQueue = {
  name: 'orders',
  attributes: standard('orders', [3, 1, 1], {
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: `${ARN}:orders-dlq`, maxReceiveCount: 2 }),
  }),
};
const DLQ: FakeQueue = { name: 'orders-dlq', attributes: standard('orders-dlq'), sources: ['orders'] };
const FIFO: FakeQueue = { name: 'jobs.fifo', attributes: standard('jobs.fifo', [5, 0, 0], { FifoQueue: 'true' }) };

async function openLoaded(queues: FakeQueue[] = [ORDERS, DLQ, FIFO], path?: string) {
  engine.queues = queues;
  const opened = open(path);
  await expectNames(queues.map((queue) => queue.name));
  return opened;
}

// ---------------------------------------------------------------------------------------------------------------

describe('the queue list, loaded', () => {
  it('one row per queue with its name link, type, the three counts, dead-letter links and "-" where none', async () => {
    await openLoaded();

    const headers = (table().findColumnHeaders() ?? []).map((header) => text(header.getElement()));
    expect(headers).toEqual([
      'Name',
      'Available',
      'In flight',
      'Delayed',
      'Type',
      'Dead-letter queue',
      'Dead-letter queue for',
    ]);
    expect(rows()).toEqual([
      ['orders', '3', '1', '1', 'Standard', 'orders-dlq', '-'],
      ['orders-dlq', '0', '0', '0', 'Standard', '-', 'orders'],
      ['jobs.fifo', '5', '0', '0', 'FIFO', '-', '-'],
    ]);

    const [first, second, third] = (table().findRows() ?? []).map((row) => row.getElement());
    const links = (row: HTMLElement | undefined) =>
      within(row as HTMLElement)
        .getAllByRole('link')
        .map((link) => [text(link), link.getAttribute('href')]);
    expect(links(first)).toEqual([
      ['orders', '/aws/sqs/queues/queue/orders'],
      ['orders-dlq', '/aws/sqs/queues/queue/orders-dlq'],
    ]);
    expect(links(second)).toEqual([
      ['orders-dlq', '/aws/sqs/queues/queue/orders-dlq'],
      ['orders', '/aws/sqs/queues/queue/orders'],
    ]);
    expect(links(third)).toEqual([['jobs.fifo', '/aws/sqs/queues/queue/jobs.fifo']]);
  });

  it('each queue of the page is read with GetQueueAttributes All and ListDeadLetterSourceQueues', async () => {
    await openLoaded();

    expect(engine.of('ListQueues').map((sent) => sent.body)).toEqual([{ MaxResults: 10 }]);
    expect(engine.of('GetQueueAttributes').map((sent) => sent.body)).toEqual(
      [ORDERS, DLQ, FIFO].map((queue) => ({ QueueUrl: urlOf(queue.name), AttributeNames: ['All'] })),
    );
    expect(engine.of('ListDeadLetterSourceQueues').map((sent) => sent.body['QueueUrl'])).toEqual(
      [ORDERS, DLQ, FIFO].map((queue) => urlOf(queue.name)),
    );
  });

  it('the h1 "Queues" with the page’s count and the requirement’s description; the notice names "queues"', async () => {
    await openLoaded();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(text(heading)).toBe('Queues (3)');
    expect(screen.getByText('Message counts are as of the last refresh.')).toBeInTheDocument();
    expect(screen.getByText('These queues are in your local emulator')).toBeInTheDocument();
    expect(screen.getByText('Matches the start of a name, upper and lower case told apart.')).toBeInTheDocument();
  });

  it('at /aws/sqs/queues: the same list, the side navigation "SQS" with "Queues" current, the crumbs', async () => {
    const { router } = await openLoaded(undefined, '/aws/sqs/queues');

    expect(router.state.location.pathname).toBe('/aws/sqs/queues');
    const navigation = PAGE.findSideNavigation();
    expect(text(navigation?.findHeaderLink()?.getElement() as HTMLElement)).toBe('SQS');
    expect(text(navigation?.findActiveLink()?.getElement() as HTMLElement)).toBe('Queues');
    expect(navigation?.findActiveLink()?.getElement()).toHaveAttribute('href', '/aws/sqs/queues');
    const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) => text(crumb.getElement()));
    expect(crumbs).toEqual(['EmuForge', 'AWS', 'SQS', 'Queues']);
  });
});

describe('a row whose own reads fail', () => {
  it('its attributes fail: its name and the failure’s first line; the other rows as they are', async () => {
    engine.on('GetQueueAttributes', (body) =>
      body['QueueUrl'] === urlOf('orders-dlq') ? refused(500, 'InternalError', 'boom') : undefined,
    );
    await openLoaded();

    expect(rows()).toEqual([
      ['orders', '3', '1', '1', 'Standard', 'orders-dlq', '-'],
      ['orders-dlq', 'The queue could not be read', '', '', '', '', ''],
      ['jobs.fifo', '5', '0', '0', 'FIFO', '-', '-'],
    ]);
    const second = table().findRows()?.[1]?.getElement() as HTMLElement;
    expect(within(second).getByRole('link', { name: 'orders-dlq' })).toHaveAttribute(
      'href',
      '/aws/sqs/queues/queue/orders-dlq',
    );
  });

  it('no such queue: "No longer in the emulator"', async () => {
    engine.on('ListDeadLetterSourceQueues', (body) =>
      body['QueueUrl'] === urlOf('jobs.fifo')
        ? refused(
            400,
            'QueueDoesNotExist',
            'The specified queue does not exist.',
            'AWS.SimpleQueueService.NonExistentQueue',
          )
        : undefined,
    );
    await openLoaded();

    expect(rows()[2]).toEqual(['jobs.fifo', 'No longer in the emulator', '', '', '', '', '']);
    expect(rows()[0]).toEqual(['orders', '3', '1', '1', 'Standard', 'orders-dlq', '-']);
  });
});

describe('empty and no match', () => {
  it('no queue: "No queues" and its text', async () => {
    engine.queues = [];
    open();

    await waitFor(() => {
      expect(within(slot()).getByText('No queues')).toBeInTheDocument();
    });
    expect(
      within(slot()).getByText(
        'This emulator holds no queues. Queues your app or any tool pointed at the emulator creates appear here. It starts empty each time it restarts.',
      ),
    ).toBeInTheDocument();
  });

  it('none matching: "No matches", the sentence, "Clear filter" lists the queues again', async () => {
    await openLoaded();

    fireEvent.change(filterInput(), { target: { value: 'Orders' } });

    await waitFor(() => {
      expect(within(slot()).getByText('No matches')).toBeInTheDocument();
    });
    expect(text(within(slot()).getByText('No matches').parentElement?.parentElement as HTMLElement)).toContain(
      'No queue name starts with “Orders”.',
    );
    expect(engine.of('ListQueues').at(-1)?.body).toEqual({ MaxResults: 10, QueueNamePrefix: 'Orders' });

    fireEvent.click(within(slot()).getByRole('button', { name: 'Clear filter' }));

    await expectNames(['orders', 'orders-dlq', 'jobs.fifo']);
    expect(engine.of('ListQueues').at(-1)?.body).toEqual({ MaxResults: 10 });
  });

  it('a prefix sent as QueueNamePrefix lists only the queues it starts', async () => {
    await openLoaded();

    fireEvent.change(filterInput(), { target: { value: 'orders' } });

    await expectNames(['orders', 'orders-dlq']);
  });
});

describe('failures of ListQueues', () => {
  async function expectState(lines: string[]) {
    await waitFor(() => {
      const shown = text(slot());
      for (const line of lines) {
        expect(shown).toContain(line);
      }
    });
    expect(within(slot()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  }

  it('HTTP 501: "Not implemented by the emulator" naming ListQueues', async () => {
    engine.on('ListQueues', () => refused(501, 'NotImplemented', 'not here'));
    open();

    await expectState([
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for ListQueues, so Studio cannot show the queue list.',
    ]);
  });

  it('AccessDenied: "Access denied" with the reason returned', async () => {
    engine.on('ListQueues', () => refused(403, 'AccessDenied', 'no policy allows it'));
    open();

    await expectState(['Access denied', 'ListQueues was refused: no policy allows it']);
  });

  it('the emulator did not answer', async () => {
    engine.on('ListQueues', () => refused(504, 'EmulatorTimeout', 'the emulator did not answer in time'));
    open();

    await expectState(['The emulator did not answer', 'the emulator did not answer in time']);
  });

  it('the engine did not answer', async () => {
    engine.on('ListQueues', () => 'network-error');
    open();

    await expectState([`The EmuForge engine at ${engineOrigin} did not answer`]);
  });

  it('any other failure: "The queue list could not be read" with code and message as they came', async () => {
    engine.on('ListQueues', () => refused(500, 'InternalError', 'boom'));
    open();

    await expectState(['The queue list could not be read', 'InternalError: boom']);
  });

  it('not connected: the emulator line’s words, "The queue list could not be read.", "Connection status"', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    engine.on('ListQueues', () => refused(500, 'InternalError', 'boom'));
    open();

    await expectState([`Not started on port ${String(EMULATOR_PORT)}`, 'The queue list could not be read.']);
    expect(within(slot()).getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
  });

  it('a failed read, then the connection connected again: read again by itself, and its rows', async () => {
    connection.value = { result: notStartedResult(), engineOrigin };
    let fail = true;
    engine.on('ListQueues', () => (fail ? refused(500, 'InternalError', 'boom') : undefined));
    engine.queues = [ORDERS];
    open();
    await waitFor(() => {
      expect(text(slot())).toContain('The queue list could not be read.');
    });

    fail = false;
    connection.set(connectedResult());

    await expectNames(['orders']);
  });
});

describe('"Refresh"', () => {
  it('disabled while reading, focus kept; then read again with the counts the emulator holds now', async () => {
    await openLoaded([ORDERS]);
    let release: (answer: Answer) => void = () => undefined;
    engine.on('ListQueues', () => new Promise<Answer>((resolve) => (release = resolve)));

    const button = refreshButton();
    act(() => {
      button.focus();
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(isDisabled(refreshButton())).toBe(true);
    });
    expect(document.activeElement).toBe(refreshButton());

    engine.queues = [{ ...ORDERS, attributes: standard('orders', [4, 1, 1]) }];
    engine.handlers.delete('ListQueues');
    act(() => {
      release(ok({ QueueUrls: [urlOf('orders')] }));
    });

    await waitFor(() => {
      expect(rows()[0]?.[1]).toBe('4');
    });
    expect(isDisabled(refreshButton())).toBe(false);
    expect(document.activeElement).toBe(refreshButton());
  });
});

describe('pages', () => {
  const TWELVE: FakeQueue[] = Array.from({ length: 12 }, (_, index) => {
    const name = `q-${String(index + 1).padStart(2, '0')}`;
    return { name, attributes: standard(name) };
  });

  it('a NextToken: next page enabled and read with that token; on the last page, none: disabled', async () => {
    engine.queues = TWELVE;
    open();
    await expectNames(TWELVE.slice(0, 10).map((queue) => queue.name));
    await waitFor(() => {
      expect(isDisabled(nextPage())).toBe(false);
    });

    fireEvent.click(nextPage());

    await expectNames(['q-11', 'q-12']);
    expect(engine.of('ListQueues').at(-1)?.body).toEqual({ MaxResults: 10, NextToken: '10' });
    expect(isDisabled(nextPage())).toBe(true);
  });

  it('no NextToken: next page disabled', async () => {
    await openLoaded();

    expect(isDisabled(nextPage())).toBe(true);
  });

  it('the counter: "(10+)" while a next page follows, the page’s count without a plus on the last page', async () => {
    engine.queues = TWELVE;
    open();
    await expectNames(TWELVE.slice(0, 10).map((queue) => queue.name));
    expect(text(screen.getByRole('heading', { level: 1 }))).toBe('Queues (10+)');

    fireEvent.click(nextPage());

    await expectNames(['q-11', 'q-12']);
    expect(text(screen.getByRole('heading', { level: 1 }))).toBe('Queues (2)');
  });
});

describe('the columns at a narrow width and dead letters', () => {
  it('at 390 wide with the table 1200 wide: the name column sticks while the others scroll', async () => {
    // jsdom lays nothing out: the table is given the width of its columns, everything else the viewport's.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const width = this.tagName === 'TABLE' ? 1200 : this.tagName === 'TH' || this.tagName === 'TD' ? 150 : 390;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 40,
        right: width,
        width,
        height: 40,
        toJSON: () => ({}),
      } as DOMRect;
    });
    await openLoaded();

    act(() => {
      window.dispatchEvent(new Event('resize'));
      table().getElement().querySelector('table')?.parentElement?.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      const headers = table()
        .findColumnHeaders()
        .map((header) => header.getElement().className);
      expect(headers[0]).toMatch(/sticky-cell/);
      expect(headers.slice(1).some((name) => /sticky-cell/.test(name))).toBe(false);
    });
    vi.restoreAllMocks();
  });

  it('a dead-letter queue of a source holding messages: its Available as a warning; any other queue’s count as text', async () => {
    const holding: FakeQueue = { ...DLQ, attributes: standard('orders-dlq', [2, 0, 0]) };
    const empty: FakeQueue = { name: 'pay-dlq', attributes: standard('pay-dlq'), sources: ['pay'] };
    await openLoaded([ORDERS, holding, empty]);

    const [first, second, third] = (table().findRows() ?? []).map((row) => row.getElement());
    expect(within(second as HTMLElement).getByRole('img', { name: 'Dead letters waiting' })).toBeInTheDocument();
    expect(rows()[1]?.[1]).toBe('2');
    expect(within(first as HTMLElement).queryByRole('img', { name: 'Dead letters waiting' })).toBeNull();
    expect(within(third as HTMLElement).queryByRole('img', { name: 'Dead letters waiting' })).toBeNull();
    expect(rows()[0]?.[1]).toBe('3');
  });
});
