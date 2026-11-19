import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';

// S4 rendered inside the area's layout, with the calls of `api.ts` answered by the case and the topic page's tabs
// replaced by stand-ins (`api.test.ts` proves the calls against a fake engine; `endpoint-select.test.tsx` the paging).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    getTopic: vi.fn(),
    listQueueChoices: vi.fn(),
    listFunctionChoices: vi.fn(),
    readQueue: vi.fn(),
    subscribe: vi.fn(),
    allowDelivery: vi.fn(),
  };
});

vi.mock('../components/subscriptions-tab', () => ({
  SubscriptionsTab: () => <div data-testid="stand-in-subscriptions" />,
}));

vi.mock('../components/publish-tab', () => ({
  PublishTab: () => <div data-testid="stand-in-publish" />,
}));

const ARN = 'arn:aws:sns:us-east-1:000000000000:orders';
const TOPIC_PATH = `/aws/sns/topics/topic/${encodeURIComponent(ARN)}`;
const SUBSCRIBE_PATH = `${TOPIC_PATH}/subscribe`;

const QUEUE: api.QueueChoice = { name: 'inbox', url: 'https://127.0.0.1:9314/000000000000/inbox' };
const QUEUE_ARN = 'arn:aws:sqs:us-east-1:000000000000:inbox';
const FUNCTION: api.FunctionChoice = {
  name: 'worker',
  arn: 'arn:aws:lambda:us-east-1:000000000000:function:worker',
};

const ENGINE = 'http://127.0.0.1:8314';
const EMULATOR = { port: 9314, endpoint: 'https://127.0.0.1:9314' };
const connection: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: EMULATOR } satisfies CheckResult,
  engineOrigin: ENGINE,
};

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
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
      connection={connection}
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

function open(path = SUBSCRIBE_PATH) {
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

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function found(): api.TopicRead {
  return { found: true, topic: { arn: ARN, fifo: false, contentBasedDeduplication: false } };
}

const refused = (operation: string, code: string, message: string) =>
  new RequestError({ kind: 'other', operation, code, message });

async function loaded() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create subscription' })).toBeInTheDocument();
  });
}

function endpointSelect() {
  const select = PAGE.findSelect();
  if (select === null) {
    throw new Error('no endpoint field');
  }
  return select;
}

async function choose(value: string, label: string) {
  endpointSelect().openDropdown();
  await waitFor(() => {
    expect((endpointSelect().findDropdown().findOptions() ?? []).map((o) => text(o.getElement()))).toContain(label);
  });
  endpointSelect().selectOptionByValue(value);
}

function protocolTiles() {
  const tiles = PAGE.findTiles();
  if (tiles === null) {
    throw new Error('no protocol tiles');
  }
  return tiles;
}

function allowCheckbox() {
  const checkbox = PAGE.findCheckbox();
  if (checkbox === null) {
    throw new Error('no checkbox');
  }
  return checkbox;
}

/** The form's own alert, not the local-emulator notice. */
function formAlert() {
  const form = PAGE.findForm();
  return form === null ? null : createWrapper(form.getElement()).findAlert();
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create subscription' }));
}

async function onTopicPage(router: ReturnType<typeof open>) {
  await waitFor(() => {
    expect(router.state.location.pathname).toBe(TOPIC_PATH);
  });
}

function flashText(): string {
  return text(PAGE.findFlashbar()?.getElement());
}

function flashType(): string | undefined {
  const types = ['success', 'warning', 'info', 'error'] as const;
  return types.find((type) => (PAGE.findFlashbar()?.findItemsByType(type).length ?? 0) > 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  vi.mocked(api.getTopic).mockResolvedValue(found());
  vi.mocked(api.listQueueChoices).mockResolvedValue({ choices: [QUEUE] });
  vi.mocked(api.listFunctionChoices).mockResolvedValue({ choices: [FUNCTION] });
  vi.mocked(api.readQueue).mockResolvedValue({ arn: QUEUE_ARN });
  vi.mocked(api.subscribe).mockResolvedValue(`${ARN}:sub-1`);
  vi.mocked(api.allowDelivery).mockResolvedValue({ outcome: 'added' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Create subscription', () => {
  it('opens with "Amazon SQS" chosen, no endpoint and the checkbox on; the description names the topic', async () => {
    open();
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'Create subscription' })).toBeInTheDocument();
    expect(screen.getByText('Subscribes a queue or a function to orders.')).toBeInTheDocument();
    expect(protocolTiles().findItemByValue('sqs')?.findNativeInput().getElement()).toBeChecked();
    expect(text(protocolTiles().findItemByValue('sqs')?.findLabel().getElement())).toContain('Amazon SQS');
    expect(endpointSelect().findTrigger().getElement().textContent).toContain('Choose a queue');
    expect(allowCheckbox().findNativeInput().getElement()).toBeChecked();
    expect(
      screen.getByText(/Adds a statement to the queue's policy that lets this topic send messages/),
    ).toBeInTheDocument();
    expect(vi.mocked(api.getTopic).mock.calls[0]?.[1]).toBe(ARN);
  });

  it('"Create subscription" without an endpoint → "Choose a queue." / "Choose a function.", nothing sent', async () => {
    open();
    await loaded();
    submit();
    await waitFor(() => {
      expect(screen.getByText('Choose a queue.')).toBeInTheDocument();
    });
    protocolTiles().findItemByValue('lambda')?.findNativeInput().click();
    await waitFor(() => {
      expect(screen.getByText('Choose a function.')).toBeInTheDocument();
    });
    submit();
    expect(api.readQueue).not.toHaveBeenCalled();
    expect(api.subscribe).not.toHaveBeenCalled();
    expect(api.allowDelivery).not.toHaveBeenCalled();
  });

  it('a queue chosen, the checkbox on, no permission yet → subscribe, then the permission; the topic with the result', async () => {
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    submit();
    await onTopicPage(router);
    expect(vi.mocked(api.readQueue).mock.calls[0]?.[1]).toBe(QUEUE.url);
    expect(vi.mocked(api.subscribe).mock.calls[0]?.[1]).toEqual({
      topicArn: ARN,
      protocol: 'sqs',
      endpoint: QUEUE_ARN,
    });
    expect(vi.mocked(api.allowDelivery).mock.calls[0]?.[1]).toEqual({
      topicArn: ARN,
      protocol: 'sqs',
      endpoint: QUEUE_ARN,
      queueUrl: QUEUE.url,
    });
    expect(vi.mocked(api.subscribe).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.allowDelivery).mock.invocationCallOrder[0] ?? 0,
    );
    await waitFor(() => {
      expect(flashText()).toContain('Subscribed inbox to orders.');
    });
    expect(flashType()).toBe('success');
  });

  it('the checkbox off → subscribe only', async () => {
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    allowCheckbox().findNativeInput().click();
    submit();
    await onTopicPage(router);
    expect(api.subscribe).toHaveBeenCalledTimes(1);
    expect(api.allowDelivery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(flashText()).toContain('Subscribed inbox to orders.');
    });
  });

  it('the queue already allows the topic → subscribe only, the same result', async () => {
    vi.mocked(api.allowDelivery).mockResolvedValue({ outcome: 'already-allowed' });
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    submit();
    await onTopicPage(router);
    await waitFor(() => {
      expect(flashText()).toContain('Subscribed inbox to orders.');
    });
    expect(flashText()).not.toContain('not changed');
    expect(flashType()).toBe('success');
  });

  it('the policy cannot be told → "Subscribed … Its policy was not changed:" with the reason, as a warning', async () => {
    vi.mocked(api.allowDelivery).mockResolvedValue({
      outcome: 'not-changed',
      reason: 'it has a Deny statement, which Studio does not evaluate',
    });
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    submit();
    await onTopicPage(router);
    await waitFor(() => {
      expect(flashText()).toContain(
        'Subscribed inbox to orders. Its policy was not changed: it has a Deny statement, which Studio does not evaluate.',
      );
    });
    expect(flashType()).toBe('warning');
  });

  it('adding fails → "Subscribed … Its policy was not changed:" with the code and message, as a warning', async () => {
    vi.mocked(api.allowDelivery).mockRejectedValue(
      refused('SetQueueAttributes', 'InvalidAttributeValue', 'Invalid value for the parameter Policy.'),
    );
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    submit();
    await onTopicPage(router);
    await waitFor(() => {
      expect(flashText()).toContain(
        'Subscribed inbox to orders. Its policy was not changed: InvalidAttributeValue: Invalid value for the parameter Policy.',
      );
    });
    expect(flashType()).toBe('warning');
  });

  it('`Subscribe` refused → the form stays with the code and message; no permission is sent', async () => {
    vi.mocked(api.subscribe).mockRejectedValue(
      refused(
        'Subscribe',
        'InvalidParameter',
        'Invalid parameter: Invalid parameter: Endpoint Reason: FIFO SQS Queues can not be subscribed to standard SNS topics',
      ),
    );
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    submit();
    await waitFor(() => {
      expect(formAlert()).not.toBeNull();
    });
    const alert = text(formAlert()?.getElement());
    expect(alert).toContain('InvalidParameter');
    expect(alert).toContain('FIFO SQS Queues can not be subscribed to standard SNS topics');
    expect(api.allowDelivery).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(SUBSCRIBE_PATH);
    expect(endpointSelect().findTrigger().getElement().textContent).toContain('inbox');
  });

  it('"AWS Lambda" → the field is "Function", the earlier choice is gone; a function chosen → subscribe with its ARN', async () => {
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    protocolTiles().findItemByValue('lambda')?.findNativeInput().click();
    await waitFor(() => {
      expect(PAGE.findAllFormFields().map((field) => text(field.findLabel()?.getElement()))).toContain('Function');
    });
    const labels = PAGE.findAllFormFields().map((field) => text(field.findLabel()?.getElement()));
    expect(labels).toContain('Function');
    expect(labels).not.toContain('Queue');
    expect(endpointSelect().findTrigger().getElement().textContent).toContain('Choose a function');
    expect(screen.getByText(/Adds a permission to the function that lets this topic invoke it/)).toBeInTheDocument();
    await choose(FUNCTION.arn, 'worker');
    submit();
    await onTopicPage(router);
    expect(api.readQueue).not.toHaveBeenCalled();
    expect(vi.mocked(api.subscribe).mock.calls[0]?.[1]).toEqual({
      topicArn: ARN,
      protocol: 'lambda',
      endpoint: FUNCTION.arn,
    });
    expect(vi.mocked(api.allowDelivery).mock.calls[0]?.[1]).toEqual({
      topicArn: ARN,
      protocol: 'lambda',
      endpoint: FUNCTION.arn,
    });
    await waitFor(() => {
      expect(flashText()).toContain('Subscribed worker to orders.');
    });
  });

  it('a topic the emulator does not hold → "Topic not found"', async () => {
    vi.mocked(api.getTopic).mockResolvedValue({ found: false });
    open();
    await waitFor(() => {
      expect(screen.getByText('Topic not found')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'View topics' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create subscription' })).toBeNull();
  });

  it('a failed read of the topic → its state with "Retry", which reads it again', async () => {
    vi.mocked(api.getTopic)
      .mockRejectedValueOnce(refused('GetTopicAttributes', 'InvalidParameter', 'Invalid parameter: TopicArn'))
      .mockResolvedValueOnce(found());
    open();
    await waitFor(() => {
      expect(screen.getByText('The topic could not be read')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await loaded();
  });

  it('"Cancel" with nothing changed → the topic\'s page at once', async () => {
    const router = open();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await onTopicPage(router);
  });

  it('"Cancel" after a change → "Discard what you entered?"; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await loaded();
    allowCheckbox().findNativeInput().click();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Discard what you entered?' })).toBeNull();
    });
    expect(router.state.location.pathname).toBe(SUBSCRIBE_PATH);
    expect(allowCheckbox().findNativeInput().getElement()).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const again = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
    fireEvent.click(within(again).getByRole('button', { name: 'Discard' }));
    await onTopicPage(router);
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it('while subscribing the button reads "Subscribing" and a second press sends nothing', async () => {
    let answer: (arn: string) => void = () => undefined;
    vi.mocked(api.subscribe).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const router = open();
    await loaded();
    await choose(QUEUE.url, 'inbox');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Subscribing')).toBeInTheDocument();
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /Subscribing|Create subscription/ }).closest('form') as HTMLFormElement,
    );
    expect(api.subscribe).toHaveBeenCalledTimes(1);
    answer(`${ARN}:sub-1`);
    await onTopicPage(router);
  });
});
