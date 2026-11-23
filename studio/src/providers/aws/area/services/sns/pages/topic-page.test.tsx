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
import type { PublishTabProps } from '../components/publish-tab';
import type { SubscriptionsTabProps } from '../components/subscriptions-tab';
import type { PublishForm } from '../publish-form';

// S3 rendered inside the area's layout, with the calls of `api.ts` answered by the case and its two tabs replaced by
// stand-ins that record what the page hands them (`api.test.ts` proves the calls against a fake engine).

function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getTopic: vi.fn(), deleteTopic: vi.fn(), listTopics: vi.fn(), setSubscriptionSetting: vi.fn() };
});

const handed: { subscriptions?: SubscriptionsTabProps; publish?: PublishTabProps } = {};

const TYPED: PublishForm = {
  message: 'kept message',
  subject: 'kept subject',
  attributes: [{ name: 'color', type: 'String', value: 'red' }],
  groupId: '',
  deduplicationId: '',
};

vi.mock('../components/subscriptions-tab', () => ({
  SubscriptionsTab: (props: SubscriptionsTabProps) => {
    handed.subscriptions = props;
    return (
      <div data-testid="stand-in-subscriptions">
        <button
          type="button"
          onClick={() => {
            void props.onSaveSetting(`${ARN}:subscription`, { name: 'RawMessageDelivery', value: 'true' });
          }}
        >
          Stand-in save subscription settings
        </button>
      </div>
    );
  },
}));

vi.mock('../components/publish-tab', () => ({
  PublishTab: (props: PublishTabProps) => {
    handed.publish = props;
    return (
      <div data-testid="stand-in-publish">
        <button
          type="button"
          onClick={() => {
            props.onFormChange(TYPED);
            props.onResultChange({ kind: 'published', published: { messageId: 'm-1' } });
          }}
        >
          Stand-in publish
        </button>
      </div>
    );
  },
}));

const ARN = 'arn:aws:sns:us-east-1:000000000000:orders';
const FIFO_ARN = 'arn:aws:sns:us-east-1:000000000000:jobs.fifo';
const pathOf = (arn: string) => `/aws/sns/topics/topic/${encodeURIComponent(arn)}`;

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
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function standard(changes: Partial<api.Topic> = {}): api.TopicRead {
  return {
    found: true,
    topic: {
      arn: ARN,
      displayName: 'Orders',
      fifo: false,
      contentBasedDeduplication: false,
      confirmed: 2,
      pending: 1,
      ...changes,
    },
  };
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** "Topic details" as label → value. */
function details(): Record<string, string> {
  const pairs = PAGE.findKeyValuePairs();
  expect(pairs).not.toBeNull();
  const result: Record<string, string> = {};
  for (const item of pairs?.findItems() ?? []) {
    result[text(item.findLabel()?.getElement())] = text(item.findValue()?.getElement());
  }
  return result;
}

function activeTab(): string {
  return text(PAGE.findTabs()?.findActiveTab()?.getElement());
}

async function loaded() {
  await waitFor(() => {
    expect(screen.getByText('Topic details')).toBeInTheDocument();
  });
}

describe("a topic's page", () => {
  beforeEach(() => {
    delete handed.subscriptions;
    delete handed.publish;
  });

  it('a standard topic → its name, the ARN with its copy control, the type, the display name, the counts; no deduplication', async () => {
    vi.mocked(api.getTopic).mockResolvedValue(standard());
    open(pathOf(ARN));
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'orders' })).toBeInTheDocument();
    expect(details()).toEqual({
      ARN: ARN,
      Type: 'Standard',
      'Display name': 'Orders',
      Subscriptions: '2 confirmed, 1 pending',
    });
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    expect(vi.mocked(api.getTopic).mock.calls[0]?.[1]).toBe(ARN);
  });

  it('an empty display name → "-"; a FIFO topic → "FIFO" and "Content-based deduplication" On or Off', async () => {
    vi.mocked(api.getTopic).mockResolvedValue({
      found: true,
      topic: { arn: FIFO_ARN, fifo: true, contentBasedDeduplication: true, confirmed: 0, pending: 0 },
    });
    open(pathOf(FIFO_ARN));
    await loaded();
    expect(details()).toEqual({
      ARN: FIFO_ARN,
      Type: 'FIFO',
      'Display name': '-',
      'Content-based deduplication': 'On',
      Subscriptions: '0 confirmed, 0 pending',
    });
  });

  it('content-based deduplication off → "Off"', async () => {
    vi.mocked(api.getTopic).mockResolvedValue({
      found: true,
      topic: { arn: FIFO_ARN, fifo: true, contentBasedDeduplication: false },
    });
    open(pathOf(FIFO_ARN));
    await loaded();
    expect(details()['Content-based deduplication']).toBe('Off');
  });

  it('a topic the emulator does not hold → "Topic not found" with "View topics", and no tabs', async () => {
    vi.mocked(api.getTopic).mockResolvedValue({ found: false });
    vi.mocked(api.listTopics).mockResolvedValue({ arns: [] });
    const router = open(pathOf(ARN));
    await waitFor(() => {
      expect(screen.getByText('Topic not found')).toBeInTheDocument();
    });
    expect(screen.getByText('The emulator holds no topic with this ARN.')).toBeInTheDocument();
    expect(PAGE.findTabs()).toBeNull();
    expect(screen.queryByText('Topic details')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View topics' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sns/topics');
    });
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'a refused ARN',
      {
        kind: 'other',
        operation: 'GetTopicAttributes',
        code: 'InvalidParameter',
        message: 'Invalid parameter: TopicArn',
      },
      /InvalidParameter.*Invalid parameter: TopicArn/,
    ],
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'GetTopicAttributes' },
      /501 Not Implemented for GetTopicAttributes/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'GetTopicAttributes', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'GetTopicAttributes', message: 'slow' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'GetTopicAttributes' },
      /engine at .* did not answer/,
    ],
    ['not connected', { kind: 'other', operation: 'GetTopicAttributes', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`${kind} → its failure state with "Retry"`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.getTopic).mockRejectedValue(new RequestError(failure));
      open(pathOf('nope'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      });
      expect(text(document.querySelector('main') ?? document.body)).toMatch(shown);
      vi.mocked(api.getTopic).mockResolvedValue(standard());
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await loaded();
    });
  }

  it('no query → "Subscriptions"; ?tab=publish → "Publish"; choosing a tab changes the query alone', async () => {
    vi.mocked(api.getTopic).mockResolvedValue(standard());
    const router = open(`${pathOf(ARN)}?tab=publish`);
    await loaded();
    expect(activeTab()).toBe('Publish');
    expect(screen.getByTestId('stand-in-publish')).toBeInTheDocument();
    expect(handed.publish).toMatchObject({ topicArn: ARN, fifo: false, contentBasedDeduplication: false });
    const calls = vi.mocked(api.getTopic).mock.calls.length;

    fireEvent.click(screen.getByRole('tab', { name: 'Subscriptions' }));
    await waitFor(() => {
      expect(activeTab()).toBe('Subscriptions');
    });
    expect(router.state.location.pathname).toBe(pathOf(ARN));
    expect(router.state.location.search).toBe('');
    expect(handed.subscriptions).toMatchObject({ topicArn: ARN, topicName: 'orders' });
    expect(handed.subscriptions?.connection.engineOrigin).toBe(ENGINE);
    // The page stayed mounted: no second read of the topic.
    expect(vi.mocked(api.getTopic).mock.calls.length).toBe(calls);

    fireEvent.click(screen.getByRole('tab', { name: 'Publish' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=publish');
    });
  });

  it('any other value of tab → "Subscriptions"', async () => {
    vi.mocked(api.getTopic).mockResolvedValue(standard());
    open(`${pathOf(ARN)}?tab=other`);
    await loaded();
    expect(activeTab()).toBe('Subscriptions');
  });

  it('the publish form’s state and result handed to "Publish" are the ones it last set, after a visit to "Subscriptions"', async () => {
    vi.mocked(api.getTopic).mockResolvedValue(standard());
    open(`${pathOf(ARN)}?tab=publish`);
    await loaded();
    expect(handed.publish?.form).toEqual({
      message: '',
      subject: '',
      attributes: [],
      groupId: '',
      deduplicationId: '',
    });
    expect(handed.publish?.result).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Stand-in publish' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Subscriptions' }));
    await waitFor(() => {
      expect(screen.getByTestId('stand-in-subscriptions')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Publish' }));
    await waitFor(() => {
      expect(screen.getByTestId('stand-in-publish')).toBeInTheDocument();
    });
    expect(handed.publish?.form).toEqual(TYPED);
    expect(handed.publish?.result).toEqual({ kind: 'published', published: { messageId: 'm-1' } });
  });

  it('"Refresh" reads the topic again', async () => {
    vi.mocked(api.getTopic).mockResolvedValue(standard());
    open(pathOf(ARN));
    await loaded();
    vi.mocked(api.getTopic).mockResolvedValue(standard({ confirmed: 5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(details()['Subscriptions']).toBe('5 confirmed, 1 pending');
    });
    expect(vi.mocked(api.getTopic).mock.calls.length).toBe(2);
  });

  it('"Delete" confirmed → the topic is deleted and the topics list opens with "Deleted topic {name}"', async () => {
    vi.mocked(api.getTopic).mockResolvedValue(standard());
    vi.mocked(api.deleteTopic).mockResolvedValue();
    vi.mocked(api.listTopics).mockResolvedValue({ arns: [] });
    const router = open(pathOf(ARN));
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('orders and its subscriptions are deleted from the local emulator.');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sns/topics');
    });
    await waitFor(() => {
      expect(screen.getByText('Deleted topic orders')).toBeInTheDocument();
    });
    expect(vi.mocked(api.deleteTopic).mock.calls[0]?.[1]).toBe(ARN);
  });

  it('a failed delete → the failure in the Flashbar; the page stays', async () => {
    vi.mocked(api.getTopic).mockResolvedValue(standard());
    vi.mocked(api.deleteTopic).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DeleteTopic', code: 'InternalError', message: 'broke' }),
    );
    const router = open(pathOf(ARN));
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.getByText('Delete topic orders failed')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(pathOf(ARN));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('reports a successful settings write after a refresh finds the topic missing', async () => {
  const write = hold<void>();
  vi.mocked(api.setSubscriptionSetting).mockReturnValueOnce(write.promise);
  vi.mocked(api.getTopic).mockResolvedValueOnce(standard()).mockResolvedValueOnce({ found: false });
  open(pathOf(ARN));
  fireEvent.click(await screen.findByRole('button', { name: 'Stand-in save subscription settings' }));
  expect(api.setSubscriptionSetting).toHaveBeenCalledWith(
    ENGINE,
    `${ARN}:subscription`,
    { name: 'RawMessageDelivery', value: 'true' },
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Topic not found')).toBeVisible();
  expect(screen.queryByTestId('stand-in-subscriptions')).not.toBeInTheDocument();
  expect(vi.mocked(api.setSubscriptionSetting).mock.calls[0]?.[3].aborted).toBe(false);
  write.resolve();
  expect(await screen.findByText('Subscription settings updated')).toBeVisible();
  expect(screen.getByText(`${ARN}:subscription`)).toBeVisible();
});
