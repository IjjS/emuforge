import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageResourcesContext } from '../../../components/page-resources';
import { listEventBuses } from '../bus-api';
import { EventBusListPage } from './event-bus-list-page';

vi.mock('../bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bus-api')>()),
  listEventBuses: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8306';
const emulator = { port: 9306, endpoint: 'https://127.0.0.1:9306' };
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const operation = 'ListEventBuses';
const read = vi.mocked(listEventBuses);

beforeEach(() => {
  read.mockReset();
});

function renderPage(result: AreaConnection['result'] = connected) {
  const resources = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <EventBusListPage connection={{ engineOrigin: endpoint, result }} />
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const table = createWrapper(container).findTable();
  if (!table) throw new Error('Expected the event bus table');
  return { table, resources };
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected a Cloudscape wrapper');
  return value;
}

function expectRead(prefix: string, token?: string) {
  expect(read).toHaveBeenLastCalledWith(endpoint, prefix, token, expect.any(AbortSignal));
}

it('shows the bus values, links, resource notice word and create action', async () => {
  const creation = new Date('2026-11-24T03:00:00Z');
  const lastChange = new Date('2026-11-27T03:00:00Z');
  read.mockResolvedValueOnce({
    items: [
      { Name: 'default', LastModifiedTime: lastChange },
      { Name: '..', Description: 'Routes orders', CreationTime: creation, LastModifiedTime: lastChange },
    ],
  });
  const { table, resources } = renderPage();
  expect(resources).toHaveBeenCalledWith({ word: 'event buses' });
  await waitFor(() => expect(table.findRows()).toHaveLength(2));
  const [defaultRow, dotRow] = table.findRows();
  expect(defaultRow?.findLink()?.getElement()).toHaveAttribute('href', '/aws/events/event-buses/bus/default');
  expect(dotRow?.findLink()?.getElement()).toHaveAttribute('href', '/aws/events/event-buses/bus/*..');
  expect(defaultRow?.getElement()).toHaveTextContent(`default--${creationDateText(lastChange)}`);
  expect(dotRow?.getElement()).toHaveTextContent(
    `..Routes orders${creationDateText(creation)}${creationDateText(lastChange)}`,
  );
  const create = table.findHeaderSlot()?.findButton('a')?.getElement();
  expect(create).toHaveAccessibleName('Create event bus');
  expect(create).toHaveAttribute('href', '/aws/events/event-buses/create');
});

it('shows loading and reads a settled filter from the first page', async () => {
  read
    .mockResolvedValueOnce({ items: [{ Name: 'default' }], next: 'more' })
    .mockResolvedValueOnce({ items: [{ Name: 'orders' }] })
    .mockResolvedValueOnce({ items: [] });
  const { table } = renderPage();
  expect(table.findLoadingText()?.getElement()).toHaveTextContent(/^Loading event buses$/);
  await waitFor(() => expect(table.findRows()).toHaveLength(1));
  const pagination = required(table.findPagination());
  fireEvent.click(pagination.findNextPageButton().getElement());
  await waitFor(() => expectRead('', 'more'));
  await waitFor(() => expect(table.findRows()[0]?.getElement()).toHaveTextContent('orders'));

  const field = required(table.findFilterSlot()?.findFormField());
  expect(field.findDescription()?.getElement()).toHaveTextContent(
    /^Finds event buses whose name starts with the text\. Upper and lower case are different\.$/,
  );
  const input = required(table.findFilterSlot()?.findTextFilter()?.findInput().findNativeInput());
  fireEvent.change(input.getElement(), { target: { value: 'Ord' } });
  fireEvent.change(input.getElement(), { target: { value: 'Orders' } });
  expect(read).toHaveBeenCalledTimes(2);
  await waitFor(() => expectRead('Orders'));
  await waitFor(() => expect(table.findEmptySlot()?.getElement()).toHaveTextContent(/^No event buses match$/));
  expect(read).toHaveBeenCalledTimes(3);
});

it('refreshes the current page with the token that opened it', async () => {
  read
    .mockResolvedValueOnce({ items: [{ Name: 'default' }], next: 'more' })
    .mockResolvedValueOnce({ items: [{ Name: 'orders' }] })
    .mockResolvedValueOnce({ items: [{ Name: 'updated' }] });
  const { table } = renderPage();
  await waitFor(() => expect(table.findRows()).toHaveLength(1));
  fireEvent.click(required(table.findPagination()?.findNextPageButton()).getElement());
  await waitFor(() => expect(table.findRows()[0]?.getElement()).toHaveTextContent('orders'));
  expectRead('', 'more');
  fireEvent.click(required(table.findHeaderSlot()?.findButton('[aria-label="Refresh"]')).getElement());
  await waitFor(() => expect(table.findRows()[0]?.getElement()).toHaveTextContent('updated'));
  expectRead('', 'more');
  expect(read).toHaveBeenCalledTimes(3);
});

const refusals: { failure: RequestFailure; status: string; detail?: string }[] = [
  { failure: { kind: 'not-implemented', operation }, status: 'Not implemented by the emulator', detail: operation },
  { failure: { kind: 'access-denied', operation, message: 'Denied' }, status: 'Access denied', detail: 'Denied' },
  {
    failure: { kind: 'emulator-did-not-answer', operation, message: 'Timed out' },
    status: 'The emulator did not answer',
    detail: 'Timed out',
  },
  {
    failure: { kind: 'engine-did-not-answer', operation },
    status: `The EmuForge engine at ${endpoint} did not answer`,
  },
  {
    failure: { kind: 'other', operation, code: 'ValidationException', message: 'Invalid page token' },
    status: 'The event bus list could not be read',
    detail: 'Invalid page token',
  },
];

it.each(refusals)('shows $status in place of the list and retries', async ({ failure, status, detail }) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [{ Name: 'default' }] });
  const { table } = renderPage();
  await waitFor(() => expect(table.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe(status));
  const empty = required(table.findEmptySlot());
  if (detail !== undefined) expect(empty.getElement()).toHaveTextContent(detail);
  const retry = required(empty.findButton());
  expect(retry.getElement()).toHaveAccessibleName('Retry');
  fireEvent.click(retry.getElement());
  await waitFor(() => expect(table.findRows()).toHaveLength(1));
  expectRead('');
});

it.each([
  ['not_started', 'Not started on port 9306'],
  ['connection_failed', 'Not answering at https://127.0.0.1:9306'],
])('shows the connection recovery for an emulator that is %s', async (reason, status) => {
  read.mockRejectedValueOnce(new RequestError({ kind: 'emulator-did-not-answer', operation, message: '' }));
  const { table } = renderPage({ kind: 'emulator-unreachable', checkedAt: 0, emulator, reason, message: '' });
  await waitFor(() => expect(table.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe(status));
  const recovery = table.findEmptySlot()?.findLink()?.getElement();
  expect(recovery).toHaveAccessibleName('Connection status');
  expect(recovery).toHaveAttribute('href', '/');
});
