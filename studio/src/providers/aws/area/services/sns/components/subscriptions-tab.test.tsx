import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';

// S3's "Subscriptions" tab rendered on the topic's page inside the area's layout, as Studio's frame renders it, with
// the calls of `api.ts` answered by the case (`api.test.ts` proves the calls against a fake engine).

function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    getTopic: vi.fn(),
    getSubscriptionSettings: vi.fn(),
    setSubscriptionSetting: vi.fn(),
    listSubscriptions: vi.fn(),
    readDelivery: vi.fn(),
    allowDelivery: vi.fn(),
    unsubscribe: vi.fn(),
  };
});

const TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:orders';
const queueArn = (name: string) => `arn:aws:sqs:us-east-1:000000000000:${name}`;
const functionArn = (name: string) => `arn:aws:lambda:us-east-1:000000000000:function:${name}`;
const subscriptionArn = (id: string) => `${TOPIC_ARN}:${id}`;

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.

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

const EMULATOR = { port: 9309, endpoint: 'https://127.0.0.1:9309' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8309';

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
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
  vi.mocked(api.getTopic).mockResolvedValue({
    found: true,
    topic: { arn: TOPIC_ARN, fifo: false, contentBasedDeduplication: false, confirmed: 1, pending: 0 },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [`/aws/sns/topics/topic/${encodeURIComponent(TOPIC_ARN)}`] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const sqs = (name: string, id = name): api.Subscription => ({
  arn: subscriptionArn(id),
  protocol: 'sqs',
  endpoint: queueArn(name),
  pending: false,
});
const lambda = (name: string): api.Subscription => ({
  arn: subscriptionArn(name),
  protocol: 'lambda',
  endpoint: functionArn(name),
  pending: false,
});
const email = (address: string): api.Subscription => ({
  arn: api.PENDING_CONFIRMATION,
  protocol: 'email',
  endpoint: address,
  pending: true,
});

/** `listSubscriptions` answers each page from `pages`, by token. */
function holdSubscriptions(pages: Record<string, api.SubscriptionPage>) {
  vi.mocked(api.listSubscriptions).mockImplementation((_, __, token) =>
    Promise.resolve(pages[token ?? ''] ?? { subscriptions: [] }),
  );
}

/** `readDelivery` answers by the endpoint, from `deliveries` (by the endpoint's ARN). */
function holdDeliveries(deliveries: Record<string, api.Delivery>) {
  vi.mocked(api.readDelivery).mockImplementation((_, target) =>
    Promise.resolve(deliveries[target.endpoint] ?? { kind: 'none' }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function rows(): string[][] {
  return (table().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => !/selection-control/.test(cell.className) && cell.querySelector('input') === null)
      .map(text),
  );
}

function action(name: string): HTMLElement {
  return within(table().getElement()).getByRole('button', { name });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** A disabled button's reason, as Cloudscape names it to assistive technology. */
function disabledReason(element: HTMLElement): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

function select(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

async function expectRows(expected: string[][]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

function hasText(content: string) {
  return screen.queryAllByText((_, element) => element !== null && text(element) === content).length > 0;
}

async function expectText(content: string) {
  await waitFor(() => {
    expect(hasText(content)).toBe(true);
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('the "Subscriptions" tab', () => {
  it('a row per subscription with protocol, endpoint, status and delivery; sqs and lambda endpoints link to their pages', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('jobs'), lambda('printer'), email('dev@example.com')] } });
    holdDeliveries({ [queueArn('jobs')]: { kind: 'allowed' }, [functionArn('printer')]: { kind: 'none' } });
    const router = open();
    await expectRows([
      ['sqs', queueArn('jobs'), 'Confirmed', 'Allowed'],
      ['lambda', functionArn('printer'), 'Confirmed', 'No permission'],
      ['email', 'dev@example.com', 'Pending confirmation', '-'],
    ]);
    expect(screen.getByRole('heading', { level: 2, name: /Subscriptions/ })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Delivery says what the policy of the subscribed queue or function allows. The emulator delivers a notification only where that policy lets this topic deliver.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: queueArn('jobs') })).toHaveAttribute('href', '/aws/sqs/queues/queue/jobs');
    expect(screen.getByRole('link', { name: functionArn('printer') })).toHaveAttribute(
      'href',
      '/aws/lambda/functions/function/printer',
    );
    expect(screen.queryByRole('link', { name: 'dev@example.com' })).toBeNull();
    expect(vi.mocked(api.readDelivery).mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([
        { topicArn: TOPIC_ARN, protocol: 'sqs', endpoint: queueArn('jobs') },
        { topicArn: TOPIC_ARN, protocol: 'lambda', endpoint: functionArn('printer') },
      ]),
    );
    expect(vi.mocked(api.readDelivery).mock.calls.some((call) => call[1].endpoint === 'dev@example.com')).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: queueArn('jobs') }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sqs/queues/queue/jobs');
    });
  });

  it('none → "No subscriptions" with "Create subscription", which leads to the subscribe address', async () => {
    holdSubscriptions({});
    const router = open();
    await waitFor(() => {
      expect(screen.getByText('No subscriptions')).toBeInTheDocument();
    });
    expect(screen.getByText('Nothing published to this topic is delivered anywhere yet.')).toBeInTheDocument();
    const create = within(table().findEmptySlot()?.getElement() as HTMLElement).getByRole('link', {
      name: 'Create subscription',
    });
    fireEvent.click(create);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/aws/sns/topics/topic/${encodeURIComponent(TOPIC_ARN)}/subscribe`);
    });
  });

  it('while loading → "Loading subscriptions"', async () => {
    vi.mocked(api.listSubscriptions).mockImplementation(() => new Promise(() => undefined));
    open();
    await waitFor(() => {
      expect(screen.getByText('Loading subscriptions')).toBeInTheDocument();
    });
  });

  it('a delivery still read → "Checking"', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('jobs')] } });
    vi.mocked(api.readDelivery).mockImplementation(() => new Promise(() => undefined));
    open();
    await expectRows([['sqs', queueArn('jobs'), 'Confirmed', 'Checking']]);
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'ListSubscriptionsByTopic' },
      /501 Not Implemented for ListSubscriptionsByTopic/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'ListSubscriptionsByTopic', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'ListSubscriptionsByTopic', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'ListSubscriptionsByTopic' },
      /did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'ListSubscriptionsByTopic', code: 'InternalError', message: 'broke' },
      /The subscription list could not be read.*InternalError/,
    ],
  ];
  for (const [kind, failure, shown] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      vi.mocked(api.listSubscriptions).mockRejectedValue(new RequestError(failure));
      holdDeliveries({});
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listSubscriptions).mock.calls.length;
      holdSubscriptions({ '': { subscriptions: [sqs('back')] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([['sqs', queueArn('back'), 'Confirmed', 'No permission']]);
      expect(vi.mocked(api.listSubscriptions).mock.calls.length).toBe(calls + 1);
    });
  }

  it('a failed read while not connected → the connection’s state; read again once connected', async () => {
    vi.mocked(api.listSubscriptions).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'ListSubscriptionsByTopic', code: 'X' }),
    );
    open();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    connection.set(notStartedResult());
    await waitFor(() => {
      expect(table().findEmptySlot()?.getElement().textContent).toMatch(/Not started on port/);
    });
    holdSubscriptions({});
    connection.set(connectedResult());
    await waitFor(() => {
      expect(screen.getByText('No subscriptions')).toBeInTheDocument();
    });
  });

  it('a row whose delivery read failed shows the failure and the table stays', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('jobs'), sqs('mail')] } });
    vi.mocked(api.readDelivery).mockImplementation((_, target) =>
      target.endpoint === queueArn('jobs')
        ? Promise.reject(
            new RequestError({ kind: 'other', operation: 'GetQueueAttributes', code: 'InternalError', message: 'x' }),
          )
        : Promise.resolve({ kind: 'allowed' }),
    );
    open();
    await expectRows([
      ['sqs', queueArn('jobs'), 'Confirmed', 'The delivery could not be read'],
      ['sqs', queueArn('mail'), 'Confirmed', 'Allowed'],
    ]);
  });

  it('"Allow delivery" only for a selected row that reads "No permission", with its reason otherwise', async () => {
    holdSubscriptions({
      '': {
        subscriptions: [sqs('allowed'), sqs('denied'), sqs('open'), sqs('gone'), email('dev@example.com')],
      },
    });
    holdDeliveries({
      [queueArn('allowed')]: { kind: 'allowed' },
      [queueArn('denied')]: { kind: 'unknown', reason: 'it has a Deny statement, which Studio does not evaluate' },
      [queueArn('open')]: { kind: 'none' },
      [queueArn('gone')]: { kind: 'queue-not-found' },
    });
    open();
    await waitFor(() => {
      expect(rows().map((row) => row[3])).toEqual(['Allowed', 'Cannot tell', 'No permission', 'Queue not found', '-']);
    });
    const allow = action('Allow delivery');
    expect(isDisabled(allow)).toBe(true);
    for (const name of [queueArn('allowed'), queueArn('denied'), queueArn('gone'), 'dev@example.com']) {
      select(`${name === 'dev@example.com' ? 'email' : 'sqs'} ${name}`);
      expect(isDisabled(action('Allow delivery'))).toBe(true);
    }
    expect(disabledReason(action('Allow delivery'))).toContain(
      'Select a subscription whose delivery says No permission.',
    );
    select(`sqs ${queueArn('open')}`);
    expect(isDisabled(action('Allow delivery'))).toBe(false);
    expect(api.allowDelivery).not.toHaveBeenCalled();
  });

  it('"Allow delivery" chosen → the permission is added, the result is shown and the row is read again', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('jobs')] } });
    let delivery: api.Delivery = { kind: 'none' };
    vi.mocked(api.readDelivery).mockImplementation(() => Promise.resolve(delivery));
    vi.mocked(api.allowDelivery).mockImplementation(() => {
      delivery = { kind: 'allowed' };
      return Promise.resolve({ outcome: 'added' });
    });
    open();
    await expectRows([['sqs', queueArn('jobs'), 'Confirmed', 'No permission']]);
    const reads = vi.mocked(api.readDelivery).mock.calls.length;
    select(`sqs ${queueArn('jobs')}`);
    fireEvent.click(action('Allow delivery'));
    await expectText('jobs may now receive from orders.');
    expect(vi.mocked(api.allowDelivery).mock.calls[0]?.[1]).toEqual({
      topicArn: TOPIC_ARN,
      protocol: 'sqs',
      endpoint: queueArn('jobs'),
    });
    await expectRows([['sqs', queueArn('jobs'), 'Confirmed', 'Allowed']]);
    expect(vi.mocked(api.readDelivery).mock.calls.length).toBeGreaterThan(reads);
  });

  const outcomes: [string, api.AllowOutcome, string][] = [
    ['already allowed', { outcome: 'already-allowed' }, 'printer already receives from orders. Nothing was changed.'],
    [
      'not changed',
      { outcome: 'not-changed', reason: 'it has a Deny statement, which Studio does not evaluate' },
      'The policy of printer was not changed: it has a Deny statement, which Studio does not evaluate.',
    ],
  ];
  for (const [what, outcome, shown] of outcomes) {
    it(`"Allow delivery" ending ${what} → "${shown}" and the row is read again`, async () => {
      holdSubscriptions({ '': { subscriptions: [lambda('printer')] } });
      holdDeliveries({});
      vi.mocked(api.allowDelivery).mockResolvedValue(outcome);
      open();
      await expectRows([['lambda', functionArn('printer'), 'Confirmed', 'No permission']]);
      const reads = vi.mocked(api.readDelivery).mock.calls.length;
      select(`lambda ${functionArn('printer')}`);
      fireEvent.click(action('Allow delivery'));
      await expectText(shown);
      await waitFor(() => {
        expect(vi.mocked(api.readDelivery).mock.calls.length).toBeGreaterThan(reads);
      });
    });
  }

  it('"Allow delivery" failing → the failure in the Flashbar', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('jobs')] } });
    holdDeliveries({});
    vi.mocked(api.allowDelivery).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'SetQueueAttributes', code: 'InternalError', message: 'broke' }),
    );
    open();
    await expectRows([['sqs', queueArn('jobs'), 'Confirmed', 'No permission']]);
    select(`sqs ${queueArn('jobs')}`);
    fireEvent.click(action('Allow delivery'));
    await expectText('Allow delivery to jobs failed');
    expect(screen.getByText('InternalError')).toBeInTheDocument();
  });

  it('"Delete" is unavailable for a pending row, with its reason', async () => {
    holdSubscriptions({ '': { subscriptions: [email('dev@example.com')] } });
    open();
    await expectRows([['email', 'dev@example.com', 'Pending confirmation', '-']]);
    expect(isDisabled(action('Delete'))).toBe(true);
    select('email dev@example.com');
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(disabledReason(action('Delete'))).toContain(
      'A subscription that is pending confirmation has no ARN to delete it by.',
    );
  });

  it('"Delete" confirmed → the subscription is deleted and "Deleted the subscription of {endpoint}"', async () => {
    let subscriptions = [sqs('jobs'), sqs('keep')];
    vi.mocked(api.listSubscriptions).mockImplementation(() => Promise.resolve({ subscriptions }));
    vi.mocked(api.unsubscribe).mockImplementation((_, arn) => {
      subscriptions = subscriptions.filter((item) => item.arn !== arn);
      return Promise.resolve();
    });
    holdDeliveries({});
    open();
    await expectRows([
      ['sqs', queueArn('jobs'), 'Confirmed', 'No permission'],
      ['sqs', queueArn('keep'), 'Confirmed', 'No permission'],
    ]);
    select(`sqs ${queueArn('jobs')}`);
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await expectText('Deleted the subscription of jobs');
    expect(vi.mocked(api.unsubscribe).mock.calls[0]?.[1]).toBe(subscriptionArn('jobs'));
    await expectRows([['sqs', queueArn('keep'), 'Confirmed', 'No permission']]);
  });

  it('a failed delete → the failure in the Flashbar and the row stays', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('jobs')] } });
    holdDeliveries({});
    vi.mocked(api.unsubscribe).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'Unsubscribe', code: 'InternalError', message: 'it broke' }),
    );
    open();
    await expectRows([['sqs', queueArn('jobs'), 'Confirmed', 'No permission']]);
    select(`sqs ${queueArn('jobs')}`);
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await expectText('Delete the subscription of jobs failed');
    expect(rows()).toEqual([['sqs', queueArn('jobs'), 'Confirmed', 'No permission']]);
  });

  it('the Status and Delivery columns keep room for their longest label with its icon', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('jobs'), email('dev@example.com')] } });
    holdDeliveries({ [queueArn('jobs')]: { kind: 'function-not-found' } });
    open();
    await expectRows([
      ['sqs', queueArn('jobs'), 'Confirmed', 'Function not found'],
      ['email', 'dev@example.com', 'Pending confirmation', '-'],
    ]);
    const headers = [...table().getElement().querySelectorAll('th')];
    const minWidthOf = (label: string) => {
      const header = headers.find((cell) => text(cell) === label);
      return Number.parseFloat(/^([\d.]+)ch$/.exec(header?.style.minWidth ?? '')?.[1] ?? '0');
    };
    // The label's characters, the indicator's icon with its gap and the cell's padding (eight characters at the least).
    expect(minWidthOf('Status')).toBeGreaterThanOrEqual('Pending confirmation'.length + 8);
    for (const label of [
      'Allowed',
      'No permission',
      'Cannot tell',
      'Queue not found',
      'Function not found',
      'Checking',
    ]) {
      expect(minWidthOf('Delivery')).toBeGreaterThanOrEqual(label.length + 8);
    }
  });

  it('"Cannot tell" lets its reason be reached; "Allow delivery" on it is disabled with a reason of its own', async () => {
    holdSubscriptions({ '': { subscriptions: [sqs('denied')] } });
    holdDeliveries({
      [queueArn('denied')]: { kind: 'unknown', reason: 'it has a Deny statement, which Studio does not evaluate' },
    });
    open();
    await expectRows([['sqs', queueArn('denied'), 'Confirmed', 'Cannot tell']]);
    select(`sqs ${queueArn('denied')}`);
    expect(isDisabled(action('Allow delivery'))).toBe(true);
    expect(disabledReason(action('Allow delivery'))).toContain(
      'The policy of denied is not one Studio evaluates: it has a Deny statement, which Studio does not evaluate.',
    );
    const popover = table().findBodyCell(1, 5)?.findPopover();
    expect(popover).not.toBeUndefined();
    popover?.findTrigger().click();
    await waitFor(() => {
      expect(text(popover?.findContent()?.getElement() as HTMLElement)).toBe(
        'Studio cannot tell whether this topic may deliver: it has a Deny statement, which Studio does not evaluate.',
      );
    });
  });

  it('the next page asks with the token', async () => {
    holdSubscriptions({
      '': { subscriptions: [sqs('a')], nextToken: 'next-1' },
      'next-1': { subscriptions: [sqs('b')] },
    });
    holdDeliveries({});
    open();
    await expectRows([['sqs', queueArn('a'), 'Confirmed', 'No permission']]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([['sqs', queueArn('b'), 'Confirmed', 'No permission']]);
    const last = vi.mocked(api.listSubscriptions).mock.calls.at(-1);
    expect(last?.[1]).toBe(TOPIC_ARN);
    expect(last?.[2]).toBe('next-1');
  });
});

describe('the selected subscription settings', () => {
  const first = sqs('jobs');
  const second = sqs('archive');
  const policy = '{"color":["red"]}';
  const replacement = '{"color":["blue"]}';

  function editor() {
    return PAGE.findAllContainers().find(
      (container) =>
        container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent === 'Subscription settings',
    );
  }

  function expectSettingsFlash() {
    const item = PAGE.findFlashbar()?.findItemsByType('success')[0];
    expect(item?.getElement()).toBeVisible();
    expect(item?.findHeader()?.getElement()).toHaveTextContent('Subscription settings updated');
    expect(item?.findContent()?.getElement()).toHaveTextContent(first.arn);
  }

  function openSettings(row: api.Subscription) {
    select(`${row.protocol} ${row.endpoint}`);
    fireEvent.click(action('Subscription settings'));
  }

  it('gives the disabled reasons and identifies the confirmed subscription when opened', async () => {
    const pending = email('dev@example.com');
    holdSubscriptions({ '': { subscriptions: [first, pending] } });
    holdDeliveries({});
    vi.mocked(api.getSubscriptionSettings).mockResolvedValue({});
    open();
    await screen.findByRole('radio', { name: `email ${pending.endpoint}` });
    const button = action('Subscription settings');
    expect(isDisabled(button)).toBe(true);
    expect(disabledReason(button)).toBe('Select a subscription.');
    select(`email ${pending.endpoint}`);
    expect(isDisabled(button)).toBe(true);
    expect(disabledReason(button)).toBe('A pending subscription has no ARN.');
    expect(api.getSubscriptionSettings).not.toHaveBeenCalled();
    openSettings(first);
    expect(editor()?.getElement()).toBeVisible();
    expect(
      screen.getByText((_, element) => element?.textContent === first.arn, { selector: '.aws-area-value-address' }),
    ).toBeVisible();
    expect(
      screen.getAllByText((_, element) => element?.textContent === first.endpoint, {
        selector: '.aws-area-value-address',
      }),
    ).toHaveLength(2);
  });

  it('keeps the second subscription when the first subscription answers late', async () => {
    const readFirst = hold<api.SubscriptionSettingsAttributes>();
    const readSecond = hold<api.SubscriptionSettingsAttributes>();
    holdSubscriptions({ '': { subscriptions: [first, second] } });
    holdDeliveries({});
    vi.mocked(api.getSubscriptionSettings)
      .mockReturnValueOnce(readFirst.promise)
      .mockReturnValueOnce(readSecond.promise);
    open();
    await screen.findByRole('radio', { name: `sqs ${first.endpoint}` });
    openSettings(first);
    await waitFor(() => {
      const loading = editor()?.findContent().findStatusIndicator()?.getElement();
      expect(loading).toHaveTextContent('Loading subscription settings');
    });
    select(`sqs ${second.endpoint}`);
    expect(editor()).toBeUndefined();
    fireEvent.click(action('Subscription settings'));
    readSecond.resolve({ FilterPolicy: replacement });
    expect(await screen.findByDisplayValue(replacement)).toBeVisible();
    await act(async () => {
      readFirst.resolve({ FilterPolicy: policy });
    });
    expect(screen.getByDisplayValue(replacement)).toBeVisible();
    expect(screen.queryByDisplayValue(policy)).not.toBeInTheDocument();
    expect(
      screen.queryByText((_, element) => element?.textContent === first.arn, { selector: '.aws-area-value-address' }),
    ).not.toBeInTheDocument();
  });

  it.each(['detail first', 'list first'] as const)(
    'keeps the write result when the follow-up reads resolve %s',
    async (order) => {
      const refreshedDetails = hold<api.SubscriptionSettingsAttributes>();
      const refreshedList = hold<api.SubscriptionPage>();
      vi.mocked(api.listSubscriptions)
        .mockResolvedValueOnce({ subscriptions: [first] })
        .mockReturnValueOnce(refreshedList.promise);
      vi.mocked(api.getSubscriptionSettings)
        .mockResolvedValueOnce({ FilterPolicy: policy })
        .mockReturnValueOnce(refreshedDetails.promise);
      vi.mocked(api.setSubscriptionSetting).mockResolvedValue(undefined);
      holdDeliveries({});
      open();
      await screen.findByRole('radio', { name: `sqs ${first.endpoint}` });
      openSettings(first);
      const policyInput = await screen.findByDisplayValue(policy);
      fireEvent.change(policyInput, { target: { value: replacement } });
      fireEvent.click(screen.getByRole('button', { name: 'Save filter policy' }));
      await waitFor(expectSettingsFlash);
      await waitFor(() => {
        expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2);
        expect(api.listSubscriptions).toHaveBeenCalledTimes(2);
      });
      expect(editor()?.getElement()).toBeVisible();
      if (order === 'detail first') {
        refreshedDetails.resolve({ FilterPolicy: replacement, RawMessageDelivery: 'true' });
        await waitFor(() => {
          const rawDelivery = editor()
            ?.findContent()
            .findAllFormFields()
            .find((field) => field.findLabel()?.getElement().textContent === 'Raw message delivery');
          expect(rawDelivery?.findControl()?.findSelect()?.findTrigger().getElement()).toHaveTextContent('On');
        });
        expect(screen.getByDisplayValue(replacement)).toBeVisible();
        refreshedList.resolve({ subscriptions: [first] });
        await waitFor(() => {
          expect(isDisabled(action('Subscription settings'))).toBe(false);
        });
        expect(editor()?.getElement()).toBeVisible();
        expect(
          screen.getAllByText((_, element) => element?.textContent === first.arn, {
            selector: '.aws-area-value-address',
          }),
        ).toHaveLength(2);
      } else {
        refreshedList.resolve({ subscriptions: [] });
        await waitFor(() => {
          expect(editor()).toBeUndefined();
        });
        await act(async () => {
          refreshedDetails.resolve({ FilterPolicy: replacement });
        });
        expectSettingsFlash();
      }
    },
  );
});
