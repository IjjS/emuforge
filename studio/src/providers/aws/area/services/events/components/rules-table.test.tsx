import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { listRules } from '../rule-api';
import { RulesTable } from './rules-table';

vi.mock('../rule-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rule-api')>()),
  listRules: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const operation = 'ListRules';
const read = vi.mocked(listRules);

beforeEach(() => {
  read.mockReset();
});

type ListingOptions = Pick<ComponentProps<typeof RulesTable>, 'holdListing' | 'readsEnabled'>;

function mountTable(options: ListingOptions = {}, result: AreaConnection['result'] = undefined) {
  const client = new QueryClient();
  const view = (props: ListingOptions) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RulesTable connection={{ engineOrigin: endpoint, result }} bus=".." {...props} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const rendered = render(view(options));
  const page = createWrapper(rendered.container);
  const table = page.findTable();
  if (!table) throw new Error('Expected the rules table');
  return { table, page, client, update: (props: ListingOptions) => rendered.rerender(view(props)) };
}

function renderTable(result: AreaConnection['result'] = undefined) {
  return mountTable({}, result).table;
}

it('shows one linked row per rule with state, trigger and description', async () => {
  read.mockResolvedValueOnce({
    items: [
      { Name: '.', State: 'ENABLED', EventPattern: '{}', Description: 'Routes order events' },
      { Name: 'nightly', State: 'DISABLED', ScheduleExpression: 'rate(1 day)' },
      {
        Name: '..',
        State: 'ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS',
        EventPattern: '{}',
        ScheduleExpression: 'rate(1 hour)',
      },
    ],
  });
  const table = renderTable();
  await waitFor(() => expect(table.findRows()).toHaveLength(3));
  const rows = table.findRows();
  expect(rows.map((row) => row.findLink()?.getElement().getAttribute('href'))).toEqual([
    '/aws/events/rules/rule/*../*.',
    '/aws/events/rules/rule/*../nightly',
    '/aws/events/rules/rule/*../*..',
  ]);
  expect(rows.map((row) => row.getElement().textContent)).toEqual([
    '.EnabledEvent patternRoutes order events',
    'nightlyDisabledrate(1 day)-',
    '..Enabled, with all CloudTrail management eventsEvent pattern, rate(1 hour)-',
  ]);
});

it('shows loading, pages by token, and starts a typed prefix from page one', async () => {
  read
    .mockResolvedValueOnce({ items: [{ Name: 'first' }], next: 'page2' })
    .mockResolvedValueOnce({ items: [{ Name: 'second' }] })
    .mockResolvedValueOnce({ items: [] })
    .mockResolvedValueOnce({ items: [] });
  const table = renderTable();
  expect(table.findLoadingText()?.getElement()).toHaveTextContent(/^Loading rules$/);
  await waitFor(() => expect(table.findRows()[0]?.findLink()?.getElement()).toHaveTextContent(/^first$/));
  const next = table.findPagination()?.findNextPageButton();
  if (!next) throw new Error('Expected the next page control');
  fireEvent.click(next.getElement());
  await waitFor(() => expect(table.findRows()[0]?.findLink()?.getElement()).toHaveTextContent(/^second$/));
  expect(read).toHaveBeenLastCalledWith(endpoint, '..', '', 'page2', expect.any(AbortSignal));

  const filter = table.findFilterSlot();
  expect(filter?.findFormField()?.findDescription()?.getElement().textContent).toBe(
    'Finds rules whose name starts with the text. Upper and lower case are different.',
  );
  const input = filter?.findTextFilter()?.findInput().findNativeInput();
  if (!input) throw new Error('Expected the filter input');
  fireEvent.change(input.getElement(), { target: { value: 'Ord' } });
  await waitFor(() => expect(table.findEmptySlot()?.getElement().textContent).toBe('No rules match'));
  expect(read).toHaveBeenLastCalledWith(endpoint, '..', 'Ord', undefined, expect.any(AbortSignal));
  fireEvent.change(input.getElement(), { target: { value: '' } });
  await waitFor(() => expect(table.findEmptySlot()?.getElement().textContent).toBe('No rules'));
  expect(read).toHaveBeenLastCalledWith(endpoint, '..', '', undefined, expect.any(AbortSignal));
});

const failures: [RequestFailure, string, string?][] = [
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator', operation],
  [{ kind: 'access-denied', operation, message: 'Denied' }, 'Access denied', 'Denied'],
  [{ kind: 'emulator-did-not-answer', operation, message: 'Timed out' }, 'The emulator did not answer', 'Timed out'],
  [{ kind: 'engine-did-not-answer', operation }, `The EmuForge engine at ${endpoint} did not answer`],
  [
    { kind: 'other', operation, code: 'ValidationException', message: 'Invalid token' },
    'The rule list could not be read',
    'ValidationException: Invalid token',
  ],
];

it.each(failures)('shows a failed ListRules read and retries (%s)', async (failure, status, detail) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [] });
  const table = renderTable();
  await waitFor(() => expect(table.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe(status));
  const empty = table.findEmptySlot();
  if (detail !== undefined) expect(empty?.getElement()).toHaveTextContent(detail);
  const retry = empty?.findButton();
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  retry?.click();
  await waitFor(() => expect(table.findEmptySlot()?.getElement().textContent).toBe('No rules'));
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(['not_started', 'connection_failed'] as const)(
  'offers connection recovery when the emulator is %s',
  async (reason) => {
    const emulator = { port: 9313, endpoint: 'https://127.0.0.1:9313' };
    read
      .mockRejectedValueOnce(new RequestError({ kind: 'emulator-did-not-answer', operation, message: '' }))
      .mockResolvedValueOnce({ items: [] });
    const table = renderTable({ kind: 'emulator-unreachable', checkedAt: 0, emulator, reason, message: '' });
    const status = reason === 'not_started' ? 'Not started on port 9313' : `Not answering at ${emulator.endpoint}`;
    await waitFor(() => expect(table.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe(status));
    const empty = table.findEmptySlot();
    const link = empty?.findLink()?.getElement();
    expect(link).toHaveAccessibleName('Connection status');
    expect(link).toHaveAttribute('href', '/');
    const retry = empty?.findButton();
    expect(retry?.getElement()).toHaveAccessibleName('Retry');
    retry?.click();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  },
);

it.each([
  ['fails', new RequestError({ kind: 'not-implemented', operation }), 'Not implemented by the emulator'],
  ['is empty', { items: [] }, 'No more rules.'],
  ['has new rows', { items: [{ Name: 'later' }] }, ''],
] as const)(
  'holds the displayed page until released when an outstanding read %s',
  async (_outcome, answer, message) => {
    let finish!: () => void;
    read.mockResolvedValueOnce({ items: [{ Name: 'visible' }], next: 'page2' }).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = () => {
            if (answer instanceof RequestError) reject(answer);
            else resolve({ items: [...answer.items] });
          };
        }),
    );
    const { table, page, client, update } = mountTable();
    const shownRule = () => table.findRows()[0]?.findLink()?.getElement().textContent;
    const announcement = () => page.find('.aws-area-announcer')?.getElement().textContent;
    await waitFor(() => expect(shownRule()).toBe('visible'));
    const next = table.findPagination()?.findNextPageButton();
    if (!next) throw new Error('Expected the next page control');
    fireEvent.click(next.getElement());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(table.findLoadingText()?.getElement()).toHaveTextContent(/^Loading rules$/);

    update({ holdListing: true });
    expect(shownRule()).toBe('visible');
    expect(table.findLoadingText()).toBeNull();
    await act(async () => finish());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(shownRule()).toBe('visible');
    expect(table.findEmptySlot()).toBeNull();
    expect(announcement()).toBe('');

    update({ holdListing: false });
    if (message === '') {
      await waitFor(() => expect(shownRule()).toBe('later'));
    } else {
      await waitFor(() => expect(table.findEmptySlot()?.getElement()).toHaveTextContent(message));
      await waitFor(() => expect(announcement()).toBe(message));
    }
    expect(read).toHaveBeenCalledTimes(2);
  },
);

it('does not request rules on mount or refresh while reads are disabled', async () => {
  read.mockResolvedValue({ items: [{ Name: 'visible' }] });
  const { table, update } = mountTable({ readsEnabled: false });
  const refresh = table.findHeaderSlot()?.findButton('[aria-label="Refresh"]');
  if (!refresh) throw new Error('Expected the refresh control');

  await act(async () => {
    fireEvent.click(refresh.getElement());
  });
  expect(read).not.toHaveBeenCalled();

  update({ readsEnabled: true });
  await waitFor(() => expect(table.findRows()[0]?.findLink()?.getElement().textContent).toBe('visible'));
  expect(read).toHaveBeenCalledTimes(1);

  update({ holdListing: true, readsEnabled: false });
  await act(async () => {
    fireEvent.click(refresh.getElement());
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(table.findRows()[0]?.findLink()?.getElement().textContent).toBe('visible');
});
