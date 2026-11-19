import ButtonWrapper from '@cloudscape-design/components/test-utils/dom/button';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor as waitForAny, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

// SQS's "Create queue" rendered inside the area's layout, as Studio's frame renders the area, against a fake engine
// behind the page's `fetch` that answers SQS's JSON 1.0 protocol (issue 489, test-criteria.md, "Unit s1").

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
      case 'GetQueueUrl': {
        const queue = this.queues.find((held) => held.name === body['QueueName']);
        return queue === undefined
          ? refused(
              400,
              'QueueDoesNotExist',
              'The specified queue does not exist.',
              'AWS.SimpleQueueService.NonExistentQueue',
            )
          : ok({ QueueUrl: urlOf(queue.name) });
      }
      case 'CreateQueue': {
        const name = String(body['QueueName']);
        const attributes = (body['Attributes'] ?? {}) as Record<string, string>;
        this.queues.push({ name, attributes: { QueueArn: `${ARN}:${name}`, ...attributes } });
        return ok({ QueueUrl: urlOf(name) });
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

function open(path = '/aws/sqs/queues/create') {
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
// ---------------------------------------------------------------------------------------------------------------
// Readers and actions.
// ---------------------------------------------------------------------------------------------------------------

const PAGE = createWrapper(document.body);

// Cloudscape's test-utils mark an element with a `data-awsui-test-scope-*` attribute for the length of a scoped query,
// which wakes `waitFor`'s observer of attribute changes: a check that reads through them and does not yet hold runs
// again at once, without end, and nothing else (a timer, an answer of the fake engine) gets a turn. Waits here are
// woken by what the page renders and by their interval, never by an attribute.
function waitFor<T>(check: () => T | Promise<T>): Promise<T> {
  return waitForAny(check, { mutationObserverOptions: { subtree: true, childList: true, characterData: true } });
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function h1(): HTMLElement {
  return screen.getByRole('heading', { level: 1 });
}

async function openForm(queues: FakeQueue[] = []) {
  engine.queues = queues;
  const opened = open();
  await screen.findByRole('heading', { level: 1, name: 'Create queue' });
  return opened;
}

function field(label: string) {
  const found = PAGE.findAllFormFields().find(
    (each) => text(each.findLabel()?.getElement() ?? document.body) === label,
  );
  expect(found, label).toBeDefined();
  return found as NonNullable<typeof found>;
}

function fieldError(label: string): string {
  return text(field(label).findError()?.getElement() ?? document.createElement('i'));
}

function typeName(value: string) {
  act(() => {
    field('Name').findControl()?.findInput()?.setInputValue(value);
  });
}

function chooseType(kind: 'standard' | 'fifo') {
  act(() => {
    PAGE.findTiles()?.findInputByValue(kind)?.click();
  });
}

function deduplication() {
  return PAGE.findCheckbox();
}

function toggleDeadLetter() {
  act(() => {
    PAGE.findToggle()?.findNativeInput().click();
  });
}

function deadLetterSelect() {
  const found = PAGE.findSelect();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

function optionLabels(): string[] {
  return (deadLetterSelect().findDropdown().findOptions() ?? []).map((option) => text(option.findLabel().getElement()));
}

async function openChoices(expected: string[]) {
  act(() => {
    deadLetterSelect().openDropdown();
  });
  await waitFor(() => {
    expect(optionLabels()).toEqual(expected);
  });
}

async function chooseDeadLetter(name: string) {
  act(() => {
    deadLetterSelect().selectOptionByValue(urlOf(name));
  });
  await waitFor(() => {
    expect(engine.of('GetQueueAttributes').some((sent) => sent.body['QueueUrl'] === urlOf(name))).toBe(true);
  });
}

function submitButton(): HTMLElement {
  return within(PAGE.findForm()?.getElement() as HTMLElement).getByRole('button', { name: /^Create queue$|Creating/ });
}

function submit() {
  fireEvent.click(submitButton());
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function flashItems(): [string, string][] {
  return (PAGE.findFlashbar()?.findItems() ?? []).map((item) => [
    text(item.findHeader()?.getElement() ?? document.createElement('i')),
    text(item.findContent()?.getElement() ?? document.createElement('i')),
  ]);
}

/** The form's own alert, not the area's notice above it. */
function formAlertElement(): HTMLElement | undefined {
  return createWrapper(PAGE.findForm()?.getElement() as HTMLElement)
    .findAlert()
    ?.getElement();
}

function formAlert(): string {
  return text(formAlertElement() ?? document.createElement('i'));
}

const standardQueue = (name: string): FakeQueue => ({ name, attributes: { QueueArn: `${ARN}:${name}` } });
const fifoQueue = (name: string): FakeQueue => ({
  name,
  attributes: { QueueArn: `${ARN}:${name}`, FifoQueue: 'true' },
});

// ---------------------------------------------------------------------------------------------------------------

describe('"Create queue", opened', () => {
  it('directly in the area’s router: the crumbs, "Queues" leading to the list and "Create queue" not a link, and SQS’s side navigation with "Queues" current', async () => {
    await openForm();

    const group = PAGE.findBreadcrumbGroup()?.getElement() as HTMLElement;
    expect(text(group)).toContain('EmuForge');
    const crumbs = (PAGE.findBreadcrumbGroup()?.findBreadcrumbLinks() ?? []).map((crumb) => text(crumb.getElement()));
    expect(crumbs).toEqual(['EmuForge', 'AWS', 'SQS', 'Queues', 'Create queue']);
    const links = within(group).getAllByRole('link');
    const queues = links.find((link) => text(link) === 'Queues');
    expect(queues).toHaveAttribute('href', '/aws/sqs/queues');
    expect(links.find((link) => text(link) === 'Create queue' && link.hasAttribute('href'))).toBeUndefined();

    const navigation = PAGE.findSideNavigation();
    expect(text(navigation?.findHeaderLink()?.getElement() as HTMLElement)).toBe('SQS');
    expect(text(navigation?.findActiveLink()?.getElement() as HTMLElement)).toBe('Queues');
  });

  it('the h1, the notice, the name’s rule, Standard chosen, no deduplication field, the switch off', async () => {
    await openForm();

    expect(h1()).toHaveTextContent('Create queue');
    expect(screen.getByText('These queues are in your local emulator')).toBeInTheDocument();
    expect(text(field('Name').findConstraint()?.getElement() as HTMLElement)).toBe(
      "1 to 80 characters: letters, numbers, hyphens (-) and underscores (_). A FIFO queue's name ends with .fifo, counted in the 80.",
    );
    expect(PAGE.findTiles()?.findInputByValue('standard')?.getElement().checked).toBe(true);
    expect(deduplication()).toBeNull();
    expect(PAGE.findToggle()?.findNativeInput().getElement().checked).toBe(false);
    expect(PAGE.findSelect()).toBeNull();
  });

  it('FIFO chosen: "Content-based deduplication" shown, off; Standard again: hidden', async () => {
    await openForm();

    chooseType('fifo');
    expect(text(deduplication()?.getElement() as HTMLElement)).toContain('Content-based deduplication');
    expect(deduplication()?.findNativeInput().getElement().checked).toBe(false);

    chooseType('standard');
    expect(deduplication()).toBeNull();
  });
});

describe('"Create queue", checked before sending', () => {
  it('a name that breaks its rule, submitted: its message under the field, nothing sent', async () => {
    await openForm();

    submit();
    expect(fieldError('Name')).toBe('Enter a name.');

    typeName('orders.fifo');
    submit();
    expect(fieldError('Name')).toBe("Only a FIFO queue's name ends with .fifo. Choose FIFO or change the name.");
    expect(document.activeElement).toBe(field('Name').findControl()?.findInput()?.findNativeInput().getElement());
    expect(engine.sent).toEqual([]);
  });

  it('the switch on, no queue chosen, submitted: "Choose a dead-letter queue.", nothing sent', async () => {
    await openForm();
    typeName('orders');
    toggleDeadLetter();

    submit();

    expect(fieldError('Dead-letter queue')).toBe('Choose a dead-letter queue.');
    expect(engine.of('GetQueueUrl')).toEqual([]);
    expect(engine.of('CreateQueue')).toEqual([]);
  });

  it('a maximum receives out of range: its message, nothing sent', async () => {
    engine.queues = [standardQueue('dead')];
    await openForm(engine.queues);
    typeName('orders');
    toggleDeadLetter();
    await openChoices(['dead']);
    await chooseDeadLetter('dead');
    act(() => {
      field('Maximum receives').findControl()?.findInput()?.setInputValue('0');
    });

    submit();

    expect(fieldError('Maximum receives')).toBe('Enter a whole number from 1 to 1000.');
    expect(engine.of('CreateQueue')).toEqual([]);
  });
});

describe('"Create queue", the dead-letter field', () => {
  it('only queues of the chosen type; a type change clears a choice of the other type', async () => {
    await openForm([standardQueue('dead'), fifoQueue('dead.fifo'), standardQueue('plain')]);
    toggleDeadLetter();

    await openChoices(['dead', 'plain']);
    await chooseDeadLetter('dead');
    expect(text(deadLetterSelect().findTrigger().getElement())).toContain('dead');

    chooseType('fifo');
    expect(text(deadLetterSelect().findTrigger().getElement())).toContain('Choose a queue');
    await openChoices(['dead.fifo']);
  });

  it('no queue of the type, no filter: "No standard queue in the emulator"; a filter zz matching none: "No standard queue name starts with zz"', async () => {
    await openForm([fifoQueue('dead.fifo')]);
    toggleDeadLetter();

    act(() => {
      deadLetterSelect().openDropdown();
    });
    await waitFor(() => {
      expect(text(deadLetterSelect().findDropdown().getElement())).toContain('No standard queue in the emulator');
    });

    act(() => {
      deadLetterSelect().findFilteringInput()?.setInputValue('zz');
    });
    await waitFor(() => {
      expect(text(deadLetterSelect().findDropdown().getElement())).toContain('No standard queue name starts with zz');
    });
    expect(engine.of('ListQueues').at(-1)?.body).toEqual({ MaxResults: 50, QueueNamePrefix: 'zz' });
  });

  it('the list fails to load: the area’s read failure in the field, with a retry', async () => {
    engine.on('ListQueues', () => refused(500, 'InternalError', 'boom'));
    await openForm([standardQueue('dead')]);
    toggleDeadLetter();

    act(() => {
      deadLetterSelect().openDropdown();
    });
    await waitFor(() => {
      expect(text(deadLetterSelect().findDropdown().getElement())).toContain('The queue list could not be read');
    });
    const retry = deadLetterSelect().findErrorRecoveryButton();
    expect(retry).not.toBeNull();
    engine.handlers.delete('ListQueues');
    const before = engine.of('ListQueues').length;
    act(() => {
      retry?.click();
    });
    await waitFor(() => {
      expect(optionLabels()).toEqual(['dead']);
    });
    expect(engine.of('ListQueues').length).toBeGreaterThan(before);
  });

  it('a chosen queue whose ARN cannot be read: the field shows the failure and the choice is cleared', async () => {
    engine.on('GetQueueAttributes', () => refused(500, 'InternalError', 'boom'));
    await openForm([standardQueue('dead')]);
    toggleDeadLetter();
    await openChoices(['dead']);

    await chooseDeadLetter('dead');

    await waitFor(() => {
      expect(fieldError('Dead-letter queue')).toContain('The queue could not be read');
    });
    expect(fieldError('Dead-letter queue')).toContain('InternalError: boom');
    expect(text(deadLetterSelect().findTrigger().getElement())).toContain('Choose a queue');
  });
});

describe('"Create queue", sent', () => {
  it('a taken name: "A queue named {name} already exists." with "Open {name}" to its page, no CreateQueue', async () => {
    await openForm([standardQueue('orders')]);
    typeName('orders');

    submit();

    await waitFor(() => {
      expect(fieldError('Name')).toContain('A queue named orders already exists.');
    });
    const link = within(field('Name').findError()?.getElement() as HTMLElement).getByRole('link', {
      name: 'Open orders',
    });
    expect(link).toHaveAttribute('href', '/aws/sqs/queues/queue/orders');
    expect(engine.of('GetQueueUrl').map((sent) => sent.body)).toEqual([{ QueueName: 'orders' }]);
    expect(engine.of('CreateQueue')).toEqual([]);
    expect(flashItems()).toEqual([]);
  });

  it('a refused CreateQueue: "Create queue failed" with code and message on the form, the fields as entered, "Create queue" enabled again', async () => {
    engine.on('CreateQueue', () =>
      refused(
        400,
        'InvalidParameterValue',
        'Value {...} for parameter RedrivePolicy is invalid. Reason: Dead letter target does not exist.',
      ),
    );
    await openForm([standardQueue('dead')]);
    typeName('orders');
    toggleDeadLetter();
    await openChoices(['dead']);
    await chooseDeadLetter('dead');

    submit();

    await waitFor(() => {
      expect(formAlert()).toContain('Create queue failed');
    });
    expect(formAlert()).toContain(
      'InvalidParameterValue: Value {...} for parameter RedrivePolicy is invalid. Reason: Dead letter target does not exist.',
    );
    expect(field('Name').findControl()?.findInput()?.getInputValue()).toBe('orders');
    expect(text(deadLetterSelect().findTrigger().getElement())).toContain('dead');
    expect(isDisabled(submitButton())).toBe(false);
    expect(flashItems()).toEqual([]);
    await waitFor(() => {
      expect(formAlertElement()?.contains(document.activeElement)).toBe(true);
    });
  });

  it.each(['GetQueueUrl', 'CreateQueue'])(
    '%s answers 501: "Not implemented by the emulator" naming it, nothing reported as created',
    async (operation) => {
      engine.on(operation, () => refused(501, 'NotImplemented', 'not here'));
      const { router } = await openForm();
      typeName('orders');

      submit();

      await waitFor(() => {
        expect(formAlert()).toContain('Not implemented by the emulator');
      });
      expect(formAlert()).toContain(`The emulator answered 501 Not Implemented for ${operation}.`);
      expect(router.state.location.pathname).toBe('/aws/sqs/queues/create');
      expect(flashItems()).toEqual([]);
      if (operation === 'GetQueueUrl') {
        expect(engine.of('CreateQueue')).toEqual([]);
      }
    },
  );

  it('success: the new queue’s page with "Created queue {name}"', async () => {
    const { router } = await openForm([fifoQueue('dead.fifo')]);
    typeName('orders.fifo');
    chooseType('fifo');
    act(() => {
      deduplication()?.findNativeInput().click();
    });
    toggleDeadLetter();
    await openChoices(['dead.fifo']);
    await chooseDeadLetter('dead.fifo');
    act(() => {
      field('Maximum receives').findControl()?.findInput()?.setInputValue('3');
    });

    submit();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sqs/queues/queue/orders.fifo');
    });
    await waitFor(() => {
      expect(flashItems()).toEqual([['', 'Created queue orders.fifo']]);
    });
    expect(engine.of('CreateQueue').map((sent) => sent.body)).toEqual([
      {
        QueueName: 'orders.fifo',
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
          RedrivePolicy: `{"deadLetterTargetArn":"${ARN}:dead.fifo","maxReceiveCount":"3"}`,
        },
      },
    ]);
  });

  it('in flight: "Create queue" loading and disabled', async () => {
    let answer: (value: Answer) => void = () => undefined;
    engine.on('CreateQueue', () => new Promise<Answer>((resolve) => (answer = resolve)));
    await openForm();
    typeName('orders');

    submit();

    await waitFor(() => {
      expect(engine.of('CreateQueue')).toHaveLength(1);
    });
    expect(isDisabled(submitButton())).toBe(true);
    expect(new ButtonWrapper(submitButton()).findLoadingIndicator()).not.toBeNull();
    expect(text(PAGE.findForm()?.getElement() as HTMLElement)).toContain('Creating the queue');
    submit();
    await act(async () => {
      answer({ status: 200, body: { QueueUrl: urlOf('orders') } });
      await Promise.resolve();
    });
    expect(engine.of('CreateQueue')).toHaveLength(1);
  });
});

describe('"Create queue", "Cancel"', () => {
  function cancel() {
    fireEvent.click(within(PAGE.findForm()?.getElement() as HTMLElement).getByRole('button', { name: 'Cancel' }));
  }

  it('untouched: the queue list at once', async () => {
    const { router } = await openForm();

    cancel();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sqs/queues');
    });
  });

  it('after a change: "Discard what you entered?"; "Keep editing" keeps the form, "Discard" leaves to the queue list', async () => {
    const { router } = await openForm();
    chooseType('fifo');

    cancel();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Discard what you entered?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/aws/sqs/queues/create');
    expect(PAGE.findTiles()?.findInputByValue('fifo')?.getElement().checked).toBe(true);

    cancel();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sqs/queues');
    });
  });
});
