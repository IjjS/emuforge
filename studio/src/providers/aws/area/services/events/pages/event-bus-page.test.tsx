import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageResourcesContext } from '../../../components/page-resources';
import { getEventBus, listResourceTags, type EventBusRead } from '../bus-api';
import { listRules } from '../rule-api';
import { EventBusPage } from './event-bus-page';

vi.mock('../bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bus-api')>()),
  getEventBus: vi.fn(),
  listResourceTags: vi.fn(),
}));

vi.mock('../rule-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rule-api')>()),
  listRules: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const arn = 'arn:aws:events:us-east-1:123:event-bus/..';
const operation = 'DescribeEventBus';
const read = vi.mocked(getEventBus);
const bus: EventBusRead = { kind: 'found', bus: { Name: '..', Arn: arn } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listResourceTags).mockResolvedValue({});
  vi.mocked(listRules).mockResolvedValue({ items: [] });
});

function renderPage(result: AreaConnection['result'] = undefined) {
  const resources = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <EventBusPage connection={{ engineOrigin: endpoint, result }} params={{ bus: '*..' }} />
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const layout = createWrapper(container).findContentLayout();
  if (!layout) throw new Error('Expected the event bus page');
  return { layout, resources };
}

it('reads its bus, then the tags by returned ARN and rules by name, and offers links with the bus query', async () => {
  let answer!: (value: EventBusRead) => void;
  read.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  const { layout, resources } = renderPage();
  expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, '..', expect.any(AbortSignal));
  expect(listResourceTags).not.toHaveBeenCalled();
  expect(listRules).not.toHaveBeenCalled();
  expect(resources).toHaveBeenCalledWith({ word: 'rules' });
  expect(layout.findHeader()?.findHeader()?.findHeadingText().getElement().textContent).toBe('..');
  expect(layout.findContent().findStatusIndicator()?.getElement().textContent).toBe('Loading event bus');

  await act(async () => answer(bus));
  await waitFor(() => {
    expect(listResourceTags).toHaveBeenCalledExactlyOnceWith(endpoint, arn, expect.any(AbortSignal));
    expect(listRules).toHaveBeenCalledExactlyOnceWith(endpoint, '..', '', undefined, expect.any(AbortSignal));
  });
  const header = layout.findHeader();
  const create = header?.findButton('a[href^="/aws/events/rules/create"]')?.getElement();
  expect(create).toHaveAccessibleName('Create rule');
  expect(create).toHaveAttribute('href', '/aws/events/rules/create?bus=..');
  const send = header?.findButton('a[href^="/aws/events/send-events"]')?.getElement();
  expect(send).toHaveAccessibleName('Send events');
  expect(send).toHaveAttribute('href', '/aws/events/send-events?bus=..');
});

it('shows the missing bus and back link without reading tags or rules', async () => {
  read.mockResolvedValueOnce({ kind: 'not-found' });
  const { layout } = renderPage();
  const content = layout.findContent();
  await waitFor(() =>
    expect(content.findContainer()?.findContent().getElement()).toHaveTextContent('Event bus not found'),
  );
  const link = content.findLink()?.getElement();
  expect(link).toHaveAccessibleName('Event buses');
  expect(link).toHaveAttribute('href', '/aws/events/event-buses');
  expect(listResourceTags).not.toHaveBeenCalled();
  expect(listRules).not.toHaveBeenCalled();
});

const failures: [RequestFailure, string, string?][] = [
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator', operation],
  [{ kind: 'access-denied', operation, message: 'Denied' }, 'Access denied', 'Denied'],
  [{ kind: 'emulator-did-not-answer', operation, message: 'Timed out' }, 'The emulator did not answer', 'Timed out'],
  [{ kind: 'engine-did-not-answer', operation }, `The EmuForge engine at ${endpoint} did not answer`],
  [
    { kind: 'other', operation, code: 'ValidationException', message: 'Invalid name' },
    'The event bus could not be read',
    'ValidationException: Invalid name',
  ],
];

it.each(failures)('shows a failed DescribeEventBus read and retries (%s)', async (failure, status, detail) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(bus);
  const { layout } = renderPage();
  const content = layout.findContent();
  await waitFor(() => expect(content.findStatusIndicator()?.getElement().textContent).toBe(status));
  if (detail !== undefined) expect(content.findContainer()?.findContent().getElement()).toHaveTextContent(detail);
  expect(listResourceTags).not.toHaveBeenCalled();
  expect(listRules).not.toHaveBeenCalled();
  const retry = content.findButton();
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  retry?.click();
  await waitFor(() => expect(content.findAllTables()).toHaveLength(2));
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(['not_started', 'connection_failed'] as const)(
  'shows connection recovery and retries when the emulator is %s',
  async (reason) => {
    const emulator = { port: 9313, endpoint: 'https://127.0.0.1:9313' };
    read
      .mockRejectedValueOnce(new RequestError({ kind: 'emulator-did-not-answer', operation, message: '' }))
      .mockResolvedValueOnce(bus);
    const { layout } = renderPage({ kind: 'emulator-unreachable', checkedAt: 0, emulator, reason, message: '' });
    const content = layout.findContent();
    const status = reason === 'not_started' ? 'Not started on port 9313' : `Not answering at ${emulator.endpoint}`;
    await waitFor(() => expect(content.findStatusIndicator()?.getElement().textContent).toBe(status));
    expect(content.findLink()?.getElement()).toHaveAccessibleName('Connection status');
    expect(content.findLink()?.getElement()).toHaveAttribute('href', '/');
    const retry = content.findButton();
    expect(retry?.getElement()).toHaveAccessibleName('Retry');
    retry?.click();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  },
);
