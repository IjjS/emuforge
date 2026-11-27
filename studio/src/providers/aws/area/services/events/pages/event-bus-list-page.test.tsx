import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { deleteEventBus } from '../bus-change-api';
import { listEventBuses } from '../bus-api';
import { EventBusListPage } from './event-bus-list-page';

vi.mock('../bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bus-api')>()),
  listEventBuses: vi.fn(),
}));

vi.mock('../bus-change-api', async (original) => ({
  ...(await original<typeof import('../bus-change-api')>()),
  deleteEventBus: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8306';
const emulator = { port: 9306, endpoint: 'https://127.0.0.1:9306' };
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const operation = 'ListEventBuses';
const read = vi.mocked(listEventBuses);

beforeEach(() => {
  read.mockReset();
  vi.mocked(deleteEventBus).mockReset().mockResolvedValue(undefined);
});

function renderPage(result: AreaConnection['result'] = connected) {
  const resources = vi.fn();
  const client = new QueryClient();
  const show = vi.fn<(result: FlashResult) => void>();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <PageResourcesContext.Provider value={resources}>
            <PageFlashContext.Provider value={{ show, handOver: vi.fn() }}>
              <EventBusListPage connection={{ engineOrigin: endpoint, result }} />
            </PageFlashContext.Provider>
          </PageResourcesContext.Provider>
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const table = createWrapper(container).findTable();
  if (!table) throw new Error('Expected the event bus table');
  return { table, resources, show, client };
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

const orders = { items: [{ Name: 'orders' }, { Name: 'default' }] };
const updated = { items: [{ Name: 'replacement' }] };
const listFailure = new RequestError({
  kind: 'other',
  operation,
  code: 'ValidationException',
  message: 'List refused',
});

function action() {
  return screen.getByRole('button', { name: 'Delete', exact: true });
}

function select(name: string) {
  fireEvent.click(screen.getByRole('radio', { name, exact: true }));
}

async function confirmOrdersDelete() {
  select('orders');
  fireEvent.click(action());
  const dialog = within(await screen.findByRole('dialog', { name: 'Delete event bus orders?' }));
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'orders' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
}

it('enables Delete only for an eligible selected bus and explains why default is protected', async () => {
  read.mockResolvedValueOnce(orders);
  renderPage();
  await screen.findByRole('radio', { name: 'default', exact: true });
  expect(action()).toBeDisabled();
  select('default');
  expect(action()).toHaveAttribute('aria-disabled', 'true');
  expect(action()).toHaveAccessibleDescription('The default event bus cannot be deleted.');
  select('orders');
  expect(action()).toBeEnabled();
  expect(action()).not.toHaveAttribute('aria-disabled', 'true');
});

it('reports a successful delete, clears selection, and rereads the shown page', async () => {
  read
    .mockResolvedValueOnce({ items: [{ Name: 'first' }], next: 'more' })
    .mockResolvedValueOnce(orders)
    .mockResolvedValueOnce(updated);
  const { table, show } = renderPage();
  await screen.findByRole('radio', { name: 'first', exact: true });
  fireEvent.click(required(table.findPagination()?.findNextPageButton()).getElement());
  await screen.findByRole('radio', { name: 'orders', exact: true });
  await confirmOrdersDelete();
  await screen.findByRole('radio', { name: 'replacement', exact: true });
  expect(deleteEventBus).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
  expect(read).toHaveBeenCalledTimes(3);
  expectRead('', 'more');
  expect(table.findSelectedRows()).toHaveLength(0);
  expect(screen.queryByRole('dialog')).toBeNull();
  const result = show.mock.calls[0]?.[0][0];
  expect(result?.type).toBe('success');
  expect(render(<>{result?.content}</>).container).toHaveTextContent('Event bus orders deleted.');
});

it.each([
  ['before', 'row'],
  ['after', 'row'],
  ['before', 'failure'],
  ['after', 'failure'],
] as const)('uses the post-delete read when the earlier read answers %s it with %s', async (order, staleOutcome) => {
  let settleOld!: () => void;
  let finishDelete!: () => void;
  vi.mocked(deleteEventBus).mockReturnValueOnce(
    new Promise((resolve) => {
      finishDelete = resolve;
    }),
  );
  read
    .mockResolvedValueOnce(orders)
    .mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          settleOld = () => {
            if (staleOutcome === 'failure') reject(listFailure);
            else resolve(orders);
          };
        }),
    )
    .mockResolvedValueOnce(updated);

  const { client, show } = renderPage();
  await screen.findByRole('radio', { name: 'orders', exact: true });
  const earlier = client.refetchQueries({ queryKey: ['events', 'buses'] });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await confirmOrdersDelete();
  if (order === 'before')
    await act(async () => {
      settleOld();
      await earlier;
    });
  await act(async () => finishDelete());
  await screen.findByRole('radio', { name: 'replacement', exact: true });
  if (order === 'after')
    await act(async () => {
      settleOld();
      await earlier;
    });
  expect(screen.getByRole('radio', { name: 'replacement', exact: true })).toBeVisible();
  expect(screen.queryByRole('radio', { name: 'orders', exact: true })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(show).toHaveBeenCalledOnce();
  expect(render(<>{show.mock.calls[0]?.[0][0].content}</>).container).toHaveTextContent('Event bus orders deleted.');
});

it('keeps the delete result visible when the new list request fails', async () => {
  read.mockResolvedValueOnce(orders).mockRejectedValueOnce(listFailure);
  const { show } = renderPage();
  await screen.findByRole('radio', { name: 'orders', exact: true });
  await confirmOrdersDelete();
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(show).toHaveBeenCalledOnce();
  expect(render(<>{show.mock.calls[0]?.[0][0].content}</>).container).toHaveTextContent('Event bus orders deleted.');
});
