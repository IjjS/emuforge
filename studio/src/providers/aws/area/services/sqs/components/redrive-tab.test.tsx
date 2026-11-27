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
import { MOVE_TASKS_POLL_MS } from '../queries';

// S2's tab "Redrive" on a dead-letter queue, on the queue's page inside the area's layout, as Studio's frame renders
// the area, against a fake engine behind the page's `fetch` that answers SQS's JSON 1.0 protocol (issue 481,
// test-criteria.md, "Unit s4").

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
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

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

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

function standard(name: string, counts: [number, number, number] = [0, 0, 0]) {
  return {
    QueueArn: `${ARN}:${name}`,
    ApproximateNumberOfMessages: String(counts[0]),
    ApproximateNumberOfMessagesNotVisible: String(counts[1]),
    ApproximateNumberOfMessagesDelayed: String(counts[2]),
    MaximumMessageSize: '1024',
  };
}

const ORDERS: FakeQueue = {
  name: 'orders',
  attributes: {
    ...standard('orders'),
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: `${ARN}:orders-dlq`, maxReceiveCount: 2 }),
  },
};
const DLQ: FakeQueue = { name: 'orders-dlq', attributes: standard('orders-dlq', [8, 0, 0]), sources: ['orders'] };
const PARKING: FakeQueue = { name: 'parking', attributes: standard('parking') };
const PAYMENTS: FakeQueue = { name: 'payments', attributes: standard('payments') };

const STARTED_MS = 1_790_000_000_000;

/** A task of `ListMessageMoveTasks`, as the wire carries it. */
function wireTask(status: string, extra: Record<string, unknown> = {}) {
  return {
    Status: status,
    SourceArn: `${ARN}:orders-dlq`,
    ApproximateNumberOfMessagesMoved: 3,
    ApproximateNumberOfMessagesToMove: 8,
    StartedTimestamp: STARTED_MS,
    ...extra,
  };
}

/** The queue's page of the dead-letter queue, on its tab "Redrive". */
async function openRedrive(queue: FakeQueue = DLQ) {
  engine.queues = [queue, ...[DLQ, ORDERS, PARKING, PAYMENTS].filter((other) => other.name !== queue.name)];
  open(`/aws/sqs/queues/queue/${queue.name}`);
  await screen.findByRole('heading', { name: 'Details' });
  const link = (PAGE.findTabs()?.findTabLinks() ?? []).find((each) => text(each.getElement()) === 'Redrive');
  expect(link).toBeDefined();
  act(() => {
    link?.click();
  });
  await screen.findByRole('heading', { name: /^Move messages/ });
}

/** The form's description: the sentence of the move. */
function description(): string {
  const header = PAGE.findAllHeaders().find((each) =>
    text(each.findHeadingText().getElement()).startsWith('Move messages'),
  );
  expect(header).toBeDefined();
  return text(header?.findDescription()?.getElement() as HTMLElement);
}

function chooseAnother() {
  act(() => {
    PAGE.findRadioGroup()?.findInputByValue('another')?.click();
  });
}

function queueSelect() {
  const found = PAGE.findSelect();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

/** Opens the select, types `prefix` and waits for the queues it is answered with. */
async function filterQueues(prefix: string, expected: string[]) {
  act(() => {
    queueSelect().openDropdown();
  });
  act(() => {
    queueSelect().findFilteringInput()?.setInputValue(prefix);
  });
  await waitFor(() => {
    expect(
      engine.of('ListQueues').some((sent) => (sent.body['QueueNamePrefix'] ?? '') === prefix || prefix === ''),
    ).toBe(true);
  });
  await waitFor(() => {
    const labels = (queueSelect().findDropdown().findOptions() ?? []).map((option) =>
      text(option.findLabel().getElement()),
    );
    expect(labels).toEqual(expected);
  });
}

async function chooseQueue(name: string) {
  act(() => {
    queueSelect().selectOptionByValue(urlOf(name));
  });
  await waitFor(() => {
    expect(
      engine
        .of('GetQueueAttributes')
        .some(
          (sent) =>
            sent.body['QueueUrl'] === urlOf(name) &&
            JSON.stringify(sent.body['AttributeNames']) === JSON.stringify(['QueueArn']),
        ),
    ).toBe(true);
  });
}

function setRate(value: string) {
  const found = PAGE.findAllFormFields().find((each) =>
    text(each.findLabel()?.getElement() as HTMLElement).startsWith('Messages per second'),
  );
  expect(found).toBeDefined();
  act(() => {
    found?.findControl()?.findInput()?.setInputValue(value);
  });
}

async function start() {
  const before = engine.of('StartMessageMoveTask').length;
  await waitFor(() => {
    expect(button('Start').getAttribute('aria-disabled')).not.toBe('true');
  });
  fireEvent.click(button('Start'));
  await waitFor(() => {
    expect(engine.of('StartMessageMoveTask')).toHaveLength(before + 1);
  });
}

function tasksTable() {
  const found = PAGE.findAllTables().find((each) =>
    text(each.findHeaderSlot()?.getElement() ?? document.body).startsWith('Move tasks'),
  );
  expect(found).toBeDefined();
  return found as NonNullable<typeof found>;
}

function taskRows(): string[][] {
  return (tasksTable().findRows() ?? []).map((row) => [...row.getElement().querySelectorAll('td')].map(text));
}

const STARTED_TEXT = new Intl.DateTimeFormat('en-US', { year: 'numeric' }).format(new Date(STARTED_MS));

// ---------------------------------------------------------------------------------------------------------------

/** The dead-letter queue of two sources. */
const SHARED_DLQ: FakeQueue = {
  name: 'shared-dlq',
  attributes: standard('shared-dlq', [4, 0, 0]),
  sources: ['orders', 'payments'],
};

/** The radio button of `value`: whether it is checked and disabled, its label and its description. */
function radio(value: string) {
  const button = (PAGE.findRadioGroup()?.findButtons() ?? []).find(
    (each) => (each.findNativeInput().getElement() as HTMLInputElement).value === value,
  );
  expect(button).toBeDefined();
  const input = button?.findNativeInput().getElement() as HTMLInputElement;
  const description = text(button?.findDescription()?.getElement() ?? document.createElement('i'));
  // The label's element holds the description after the label's own text.
  const label = text(button?.findLabel().getElement() as HTMLElement);
  return {
    checked: input.checked,
    disabled: input.disabled,
    label: description === '' ? label : label.slice(0, label.length - description.length).trim(),
    description,
  };
}

/** A form field's description and constraint text, by its label. */
function formField(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement() as HTMLElement) === label);
  expect(found).toBeDefined();
  return {
    description: text(found?.findDescription()?.getElement() ?? document.createElement('i')),
    constraint: text(found?.findConstraint()?.getElement() ?? document.createElement('i')),
  };
}

/** The open select's options' descriptions, in order. */
function optionDescriptions(): string[] {
  return (queueSelect().findDropdown().findOptions() ?? []).map((option) =>
    text(option.findDescription()?.getElement() ?? document.createElement('i')),
  );
}

describe('the destinations', () => {
  it('one source: "Back to their source queues" is enabled and chosen, with no description', async () => {
    await openRedrive();
    expect(radio('source')).toEqual({
      checked: true,
      disabled: false,
      label: 'Back to their source queues',
      description: '',
    });
    expect(radio('another')).toMatchObject({ checked: false, disabled: false });
    expect(PAGE.findSelect()).toBeNull();
  });

  it('one source: the Destination field has no description; the Queue field no constraint, its options none', async () => {
    await openRedrive();
    expect(formField('Destination').description).toBe('');
    chooseAnother();
    expect(formField('Queue').constraint).toBe('');
    await filterQueues('', ['orders', 'parking', 'payments']);
    expect(optionDescriptions()).toEqual(['', '', '']);
  });

  it('more than one source: "Back to their source queues" is disabled; "Another queue" is chosen', async () => {
    await openRedrive(SHARED_DLQ);
    expect(radio('source')).toEqual({
      checked: false,
      disabled: true,
      label: 'Back to their source queues',
      description: '',
    });
    expect(radio('another')).toMatchObject({ checked: true, disabled: false });
    expect(PAGE.findSelect()).not.toBeNull();

    await filterQueues('park', ['parking']);
    await chooseQueue('parking');
    await start();
    expect(engine.of('StartMessageMoveTask')[0]?.body).toEqual({
      SourceArn: `${ARN}:shared-dlq`,
      DestinationArn: `${ARN}:parking`,
    });
  });

  it('more than one source: the reason is the Destination field’s description', async () => {
    await openRedrive(SHARED_DLQ);
    expect(formField('Destination').description).toBe(
      "shared-dlq is the dead-letter queue of 2 queues, so the emulator cannot tell each message's source queue. Choose the queue to move them to.",
    );
  });

  it('more than one source: "… to the queue you choose" until one is chosen, then "… to {destination}"', async () => {
    await openRedrive(SHARED_DLQ);
    expect(description()).toBe('Move the messages of shared-dlq to the queue you choose');
    await filterQueues('park', ['parking']);
    await chooseQueue('parking');
    expect(description()).toBe('Move the messages of shared-dlq to parking');
  });

  it('more than one source: the Queue field’s constraint, and "A source of {name}" on each source', async () => {
    await openRedrive(SHARED_DLQ);
    expect(formField('Queue').constraint).toBe(
      'All messages of shared-dlq go to this queue, whatever queue they came from.',
    );
    await filterQueues('', ['orders-dlq', 'orders', 'parking', 'payments']);
    expect(optionDescriptions()).toEqual(['', 'A source of shared-dlq', '', 'A source of shared-dlq']);
  });
});

describe('the move form', () => {
  it('the destination chooser leaves out this queue itself', async () => {
    await openRedrive();
    chooseAnother();
    await filterQueues('orders', ['orders']);
    expect(engine.of('ListQueues').at(-1)?.body['QueueNamePrefix']).toBe('orders');
  });

  it('Start is disabled while the chosen queue’s ARN is read, with "Reading the queue\'s ARN"', async () => {
    let answer: (value: Answer) => void = () => undefined;
    engine.on('GetQueueAttributes', (body) =>
      body['QueueUrl'] === urlOf('parking')
        ? new Promise<Answer>((done) => {
            answer = done;
          })
        : undefined,
    );
    await openRedrive();
    chooseAnother();
    await filterQueues('park', ['parking']);
    await chooseQueue('parking');
    const startElement = button('Start');
    const startButton = PAGE.findAllButtons().find((each) => each.getElement() === startElement);
    expect(startButton).toBeDefined();
    expect(startButton?.getElement().getAttribute('aria-disabled')).toBe('true');
    act(() => {
      startButton?.focus();
    });
    await waitFor(() => {
      expect(text(startButton?.findDisabledReason()?.getElement() ?? document.createElement('i'))).toBe(
        "Reading the queue's ARN",
      );
    });

    act(() => {
      answer(ok({ Attributes: { QueueArn: `${ARN}:parking` } }));
    });
    await waitFor(() => {
      expect(startButton?.getElement().getAttribute('aria-disabled')).not.toBe('true');
    });
  });

  it('the description is "… back to its source queues", and "… to {destination}" once another queue is chosen', async () => {
    await openRedrive();
    expect(description()).toBe('Move the messages of orders-dlq back to its source queues');

    chooseAnother();
    expect(description()).toBe('Move the messages of orders-dlq back to its source queues');
    await filterQueues('', ['orders', 'parking', 'payments']);
    await chooseQueue('parking');
    expect(description()).toBe('Move the messages of orders-dlq to parking');
  });

  it('"Another queue" → a select filled by prefix from the queue list; choosing one reads its ARN', async () => {
    await openRedrive();
    expect(PAGE.findSelect()).toBeNull();
    chooseAnother();
    await filterQueues('pa', ['parking', 'payments']);
    const listed = engine.of('ListQueues').filter((sent) => sent.body['QueueNamePrefix'] === 'pa');
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0]?.body['MaxResults']).toBe(25);

    await chooseQueue('payments');
    await start();
    expect(engine.of('StartMessageMoveTask').at(-1)?.body).toEqual({
      SourceArn: `${ARN}:orders-dlq`,
      DestinationArn: `${ARN}:payments`,
    });
  });

  it('"Another queue" with none chosen, or a rate that is not a whole number → refused before starting', async () => {
    await openRedrive();
    chooseAnother();
    fireEvent.click(button('Start'));
    await screen.findByText('Choose a queue.');
    setRate('1.5');
    fireEvent.click(button('Start'));
    await screen.findByText('Enter a whole number.');
    expect(engine.of('StartMessageMoveTask')).toHaveLength(0);
  });
});

describe('starting a move', () => {
  it('back to the sources: the sentence as the success header, the tasks read again', async () => {
    await openRedrive();
    await waitFor(() => {
      expect(engine.of('ListMessageMoveTasks')).toHaveLength(1);
    });
    expect(engine.of('ListMessageMoveTasks')[0]?.body).toEqual({ SourceArn: `${ARN}:orders-dlq`, MaxResults: 10 });
    engine.on('StartMessageMoveTask', () => ok({ TaskHandle: 'handle-1' }));
    await start();
    expect(engine.of('StartMessageMoveTask')[0]?.body).toEqual({ SourceArn: `${ARN}:orders-dlq` });

    await expectFlash([['Started: move the messages of orders-dlq back to its source queues', '']]);
    await waitFor(() => {
      expect(engine.of('ListMessageMoveTasks').length).toBeGreaterThan(1);
    });
  });

  it('to another queue at a rate: its ARN and the rate sent; the header names the destination', async () => {
    await openRedrive();
    chooseAnother();
    await filterQueues('park', ['parking']);
    await chooseQueue('parking');
    setRate('1');
    await start();
    expect(engine.of('StartMessageMoveTask')[0]?.body).toEqual({
      SourceArn: `${ARN}:orders-dlq`,
      DestinationArn: `${ARN}:parking`,
      MaxNumberOfMessagesPerSecond: 1,
    });
    await expectFlash([['Started: move the messages of orders-dlq to parking', '']]);
  });

  it('a refusal → "Starting the move failed" with its code and message as they came', async () => {
    engine.on('StartMessageMoveTask', () =>
      refused(
        400,
        'UnsupportedOperation',
        'There is already a task running. Only one active task is allowed for a source queue arn at a given time.',
        'AWS.SimpleQueueService.UnsupportedOperation',
      ),
    );
    await openRedrive();
    await start();
    await expectFlash([
      [
        'Starting the move failed',
        'AWS.SimpleQueueService.UnsupportedOperation: There is already a task running. Only one active task is allowed for a source queue arn at a given time.',
      ],
    ]);
  });
});

describe('the move tasks', () => {
  it('status, destination ("Source queues" when none), moved of to move, started; "Cancel" only on RUNNING', async () => {
    engine.on('ListMessageMoveTasks', () =>
      ok({
        Results: [
          wireTask('RUNNING', { TaskHandle: 'task-running', DestinationArn: `${ARN}:parking` }),
          wireTask('COMPLETED', { ApproximateNumberOfMessagesMoved: 8 }),
          wireTask('CANCELLED'),
          wireTask('FAILED', { FailureReason: 'The destination is gone.' }),
        ],
      }),
    );
    await openRedrive();
    await waitFor(() => {
      expect(taskRows()).toHaveLength(4);
    });
    const shown = taskRows();
    expect(shown.map((row) => row.slice(0, 3))).toEqual([
      ['RUNNING', 'parking', '3 of 8'],
      ['COMPLETED', 'Source queues', '8 of 8'],
      ['CANCELLED', 'Source queues', '3 of 8'],
      ['FAILED: The destination is gone.', 'Source queues', '3 of 8'],
    ]);
    for (const row of shown) {
      expect(row[3]).toContain(STARTED_TEXT);
    }
    expect(shown.map((row) => row[4])).toEqual(['Cancel', '', '', '']);
    const link = within(tasksTable().getElement()).getByRole('link', { name: 'parking' });
    expect(link.getAttribute('href')).toBe('/aws/sqs/queues/queue/parking');
  });

  it('none: "No move tasks" and "No move tasks are listed for this queue."', async () => {
    await openRedrive();
    await within(tasksTable().getElement()).findByText('No move tasks');
    expect(within(tasksTable().getElement()).getByText('No move tasks are listed for this queue.')).toBeDefined();
  });

  it('"Cancel" → CancelMessageMoveTask with its handle; "Cancelled the move of {name}: {n} messages moved"', async () => {
    engine.on('ListMessageMoveTasks', () => ok({ Results: [wireTask('RUNNING', { TaskHandle: 'task-running' })] }));
    engine.on('CancelMessageMoveTask', () => ok({ ApproximateNumberOfMessagesMoved: 3 }));
    await openRedrive();
    fireEvent.click(await within(tasksTable().getElement()).findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(engine.of('CancelMessageMoveTask')).toHaveLength(1);
    });
    expect(engine.of('CancelMessageMoveTask')[0]?.body).toEqual({ TaskHandle: 'task-running' });
    await expectFlash([['', 'Cancelled the move of orders-dlq: 3 messages moved']]);
  });

  it('"Cancel" answered without a count → "Cancelled the move of {name}"', async () => {
    engine.on('ListMessageMoveTasks', () => ok({ Results: [wireTask('RUNNING', { TaskHandle: 'task-running' })] }));
    engine.on('CancelMessageMoveTask', () => ok({}));
    await openRedrive();
    fireEvent.click(await within(tasksTable().getElement()).findByRole('button', { name: 'Cancel' }));
    await expectFlash([['', 'Cancelled the move of orders-dlq']]);
  });

  it('a refused cancel → "Cancelling the move failed" with its code and message', async () => {
    engine.on('ListMessageMoveTasks', () => ok({ Results: [wireTask('RUNNING', { TaskHandle: 'task-running' })] }));
    engine.on('CancelMessageMoveTask', () =>
      refused(400, 'ResourceNotFoundException', 'Task does not exist.', 'ResourceNotFoundException'),
    );
    await openRedrive();
    fireEvent.click(await within(tasksTable().getElement()).findByRole('button', { name: 'Cancel' }));
    await expectFlash([['Cancelling the move failed', 'ResourceNotFoundException: Task does not exist.']]);
  });
});

describe('reading move tasks after a start', () => {
  const list = 'ListMessageMoveTasks';
  const empty = ok({ Results: [] });
  const running = ok({
    Results: [wireTask('RUNNING', { ApproximateNumberOfMessagesMoved: 0, ApproximateNumberOfMessagesToMove: 1 })],
  });
  const completed = ok({
    Results: [wireTask('COMPLETED', { ApproximateNumberOfMessagesMoved: 1, ApproximateNumberOfMessagesToMove: 1 })],
  });
  const startSuccess: [string, string][] = [['Started: move the messages of orders-dlq back to its source queues', '']];

  function expectRow(status: string, counts: string) {
    expect(taskRows().map((row) => row.slice(0, 3))).toEqual([[status, 'Source queues', counts]]);
  }

  async function waitForEmptyTasks() {
    await waitFor(() => {
      const emptySlot = tasksTable().findEmptySlot()?.getElement();
      expect(emptySlot).toHaveTextContent('No move tasks');
      expect(emptySlot).toHaveTextContent('No move tasks are listed for this queue.');
    });
  }

  function holdRead() {
    let resolve: (answer: Answer) => void = () => undefined;
    const promise = new Promise<Answer>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  async function reply(read: ReturnType<typeof holdRead>, answer: Answer) {
    await act(async () => {
      read.resolve(answer);
    });
  }

  async function waitForReads(count: number) {
    await waitFor(() => {
      expect(engine.of(list)).toHaveLength(count);
    });
  }

  async function startWithFirstReadHeld(pollAnswer = empty) {
    const first = holdRead();
    const later = holdRead();
    engine.on(
      list,
      vi
        .fn<Handler>()
        .mockReturnValue(pollAnswer)
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(later.promise),
    );
    engine.on('StartMessageMoveTask', () => ok({ TaskHandle: 'handle-1' }));
    await openRedrive();
    await waitForReads(1);
    await start();
    await expectFlash(startSuccess);
    return { first, later };
  }

  it('lists a running task even when the first read answers empty before the later read', async () => {
    const { first, later } = await startWithFirstReadHeld();
    await reply(first, empty);
    await waitForReads(2);
    await reply(later, running);
    await waitFor(() => {
      expectRow('RUNNING', '0 of 1');
    });
    expect(tasksTable().findEmptySlot()).toBeNull();
  });

  it('keeps the running task when the first read answers empty after the later read', async () => {
    const { first, later } = await startWithFirstReadHeld();
    await waitForReads(2);
    await reply(later, running);
    await waitFor(() => {
      expectRow('RUNNING', '0 of 1');
    });
    await reply(first, empty);
    expectRow('RUNNING', '0 of 1');
  });

  // Bound: one real 2-second poll and one more interval to verify that polling stops (issue 665 s1).
  it(
    'polls after two seconds while the started task is running and stops when it completes',
    async () => {
      const { first, later } = await startWithFirstReadHeld(completed);
      await reply(first, empty);
      await waitForReads(2);
      const runningAt = Date.now();
      await reply(later, running);
      await waitFor(() => {
        expectRow('RUNNING', '0 of 1');
      });
      await waitFor(
        () => {
          expectRow('COMPLETED', '1 of 1');
        },
        { timeout: MOVE_TASKS_POLL_MS + 1000 },
      );
      expect(Date.now() - runningAt).toBeGreaterThanOrEqual(MOVE_TASKS_POLL_MS);
      await new Promise((resolve) => setTimeout(resolve, MOVE_TASKS_POLL_MS + 200));
      expect(engine.of(list)).toHaveLength(3);
    },
    MOVE_TASKS_POLL_MS * 4,
  );

  it('shows an already completed task from the later read and does not poll', async () => {
    const { first, later } = await startWithFirstReadHeld();
    await reply(first, empty);
    await waitForReads(2);
    await reply(later, completed);
    await waitFor(() => {
      expectRow('COMPLETED', '1 of 1');
    });
    await new Promise((resolve) => setTimeout(resolve, MOVE_TASKS_POLL_MS + 200));
    expect(engine.of(list)).toHaveLength(2);
  });

  it('shows the refused start and still shows the first read when it answers', async () => {
    const first = holdRead();
    engine.on(list, vi.fn<Handler>().mockReturnValue(empty).mockReturnValueOnce(first.promise));
    engine.on('StartMessageMoveTask', () =>
      refused(400, 'UnsupportedOperation', 'A move is already running.', 'UnsupportedOperation'),
    );
    await openRedrive();
    await waitForReads(1);
    await start();
    await expectFlash([['Starting the move failed', 'UnsupportedOperation: A move is already running.']]);
    await reply(first, completed);
    await waitFor(() => {
      expectRow('COMPLETED', '1 of 1');
    });
    expect(engine.of(list)).toHaveLength(1);
  });

  it('shows a failed later read in place of the table and allows retrying it', async () => {
    const { first, later } = await startWithFirstReadHeld(completed);
    await reply(first, empty);
    await waitForReads(2);
    await reply(later, refused(403, 'AccessDenied', 'no policy allows it'));
    const retry = await waitFor(() => {
      const failure = PAGE.findAllContainers().find((container) => {
        const header = container.findHeader()?.getElement();
        return header !== undefined && text(header) === 'Move tasks';
      });
      const content = failure?.findContent();
      expect(content?.findStatusIndicator()?.getElement()).toHaveTextContent(/^Access denied$/);
      expect(content?.find('p')?.getElement()).toHaveTextContent(
        /^ListMessageMoveTasks was refused: no policy allows it$/,
      );
      expect(PAGE.findTable()).toBeNull();
      const button = content?.findButton();
      expect(button?.getElement()).toHaveTextContent(/^Retry$/);
      return button;
    });
    act(() => {
      retry?.click();
    });
    await waitFor(() => {
      expectRow('COMPLETED', '1 of 1');
    });
  });

  it('replaces a held manual refresh with a read after the start', async () => {
    const refresh = holdRead();
    engine.on(
      list,
      vi.fn<Handler>().mockReturnValue(completed).mockReturnValueOnce(empty).mockReturnValueOnce(refresh.promise),
    );
    engine.on('StartMessageMoveTask', () => ok({ TaskHandle: 'handle-1' }));
    await openRedrive();
    await waitForEmptyTasks();
    fireEvent.click(button('Refresh move tasks'));
    await waitForReads(2);
    await start();
    await expectFlash(startSuccess);
    await waitFor(() => {
      expectRow('COMPLETED', '1 of 1');
    });
    expect(engine.of(list)).toHaveLength(3);
    await reply(refresh, empty);
    expectRow('COMPLETED', '1 of 1');
  });

  it('lists the task after the start when the first read has already answered empty', async () => {
    engine.on(list, vi.fn<Handler>().mockReturnValue(completed).mockReturnValueOnce(empty));
    engine.on('StartMessageMoveTask', () => ok({ TaskHandle: 'handle-1' }));
    await openRedrive();
    await waitForEmptyTasks();
    await start();
    await expectFlash(startSuccess);
    await waitFor(() => {
      expectRow('COMPLETED', '1 of 1');
    });
    expect(engine.of(list)).toHaveLength(2);
  });
});

describe('501 and AccessDenied for start, list and cancel', () => {
  const NOT_IMPLEMENTED = () => refused(501, 'NotImplemented', 'not here');
  const DENIED = () => refused(403, 'AccessDenied', 'no policy allows it');

  it('ListMessageMoveTasks: "Not implemented by the emulator" and "Access denied" in the place of the tasks', async () => {
    engine.on('ListMessageMoveTasks', NOT_IMPLEMENTED);
    await openRedrive();
    await screen.findByText('Not implemented by the emulator');
    expect(
      screen.getByText(
        'The emulator answered 501 Not Implemented for ListMessageMoveTasks, so Studio cannot show the move tasks.',
      ),
    ).toBeDefined();

    engine.on('ListMessageMoveTasks', DENIED);
    fireEvent.click(button('Retry'));
    await screen.findByText('Access denied');
    expect(screen.getByText('ListMessageMoveTasks was refused: no policy allows it')).toBeDefined();
  });

  it.each(['StartMessageMoveTask', 'CancelMessageMoveTask'])(
    '%s: "Not implemented by the emulator" with the operation, "Access denied" with the reason',
    async (operation) => {
      engine.on('ListMessageMoveTasks', () => ok({ Results: [wireTask('RUNNING', { TaskHandle: 'task-running' })] }));
      await openRedrive();
      const run = async () => {
        if (operation === 'StartMessageMoveTask') {
          await start();
        } else {
          const before = engine.of(operation).length;
          fireEvent.click(await within(tasksTable().getElement()).findByRole('button', { name: 'Cancel' }));
          await waitFor(() => {
            expect(engine.of(operation)).toHaveLength(before + 1);
          });
        }
      };
      engine.on(operation, NOT_IMPLEMENTED);
      await run();
      await expectFlash([
        ['Not implemented by the emulator', `The emulator answered 501 Not Implemented for ${operation}.`],
      ]);

      engine.on(operation, DENIED);
      await run();
      await expectFlash([['Access denied', `${operation} was refused: no policy allows it`]]);
    },
  );
});
