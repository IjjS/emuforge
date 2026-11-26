import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageResourcesContext } from '../../../components/page-resources';
import type { TokenPage } from '../../../components/use-token-listing';
import { listLogGroups } from '../api';
import { LogGroupListPage } from './log-group-list-page';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listLogGroups: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8306';
const EMULATOR = { port: 9306, endpoint: 'https://127.0.0.1:9306' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const operation = 'DescribeLogGroups';
const read = vi.mocked(listLogGroups);

beforeEach(() => read.mockReset());

function renderPage(result: AreaConnection['result'] = CONNECTED) {
  const resources = vi.fn();
  const client = new QueryClient();
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PageResourcesContext.Provider value={resources}>
          <main>
            <LogGroupListPage connection={{ engineOrigin: ENGINE, result }} />
          </main>
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(createWrapper(rendered.container).findTable()).not.toBeNull();
  return { ...rendered, resources };
}

const group = (name: string): TokenPage<LogGroup> => ({ items: [{ logGroupName: name }] });

function changeFilter(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by name' }), { target: { value } });
}

const nextPage = () => screen.getByRole('button', { name: 'Next page' });

function refresh() {
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
}

function expectRead(pattern: string, token?: string) {
  expect(read).toHaveBeenLastCalledWith(ENGINE, pattern, token, expect.any(AbortSignal));
}

it('shows the group values, the name link and the resource notice word', async () => {
  const creationTime = Date.UTC(2026, 10, 26, 12);
  read.mockResolvedValueOnce({
    items: [
      {
        logGroupName: '/app#Cold',
        retentionInDays: 7,
        logGroupClass: 'INFREQUENT_ACCESS',
        deletionProtectionEnabled: true,
        creationTime,
      },
      { logGroupName: 'app', logGroupClass: 'STANDARD', deletionProtectionEnabled: false },
    ],
  });
  const { container, resources } = renderPage();
  expect(resources).toHaveBeenCalledWith({ word: 'log groups' });
  expect(await screen.findByRole('link', { name: '/app#Cold' })).toHaveAttribute(
    'href',
    '/aws/logs/log-groups/group/%2Fapp%23Cold',
  );
  const rows = createWrapper(container).findTable()?.findRows();
  expect(rows).toHaveLength(2);
  expect(rows?.[0]?.getElement()).toHaveTextContent(
    `/app#Cold7 daysInfrequent AccessOn${creationDateText(new Date(creationTime))}`,
  );
  expect(rows?.[1]?.getElement()).toHaveTextContent('appNever expireStandardOff');
});

it('shows loading, an empty emulator and a filter with no matches', async () => {
  read.mockResolvedValue({ items: [] });
  renderPage();
  expect(screen.getByText('Loading log groups')).toBeVisible();
  expect(await screen.findByText('No log groups')).toBeVisible();
  changeFilter('absent');
  expect(await screen.findByText('No log groups match')).toBeVisible();
  expectRead('absent');
});

it('waits for the entered filter and reads its first page after paging the unfiltered list', async () => {
  read
    .mockResolvedValueOnce({ ...group('first'), next: 'second' })
    .mockResolvedValueOnce(group('unfiltered second'))
    .mockResolvedValueOnce(group('mixed-case match'));
  renderPage();
  await screen.findByRole('link', { name: 'first' });
  fireEvent.click(nextPage());
  await screen.findByRole('link', { name: 'unfiltered second' });
  expectRead('', 'second');

  changeFilter('MiXeD');
  expect(read).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole('link', { name: 'mixed-case match' })).toBeVisible();
  expectRead('MiXeD');
  expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
});

async function endFilteredList() {
  read
    .mockResolvedValueOnce(group('all'))
    .mockResolvedValueOnce({ ...group('Keep 1'), next: 'second' })
    .mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
  renderPage();
  await screen.findByRole('link', { name: 'all' });
  changeFilter('Keep');
  await screen.findByRole('link', { name: 'Keep 1' });
  fireEvent.click(nextPage());
  await screen.findByRole('link', { name: 'Keep 2' });
  expectRead('Keep', 'second');

  let resolveEnd!: (value: TokenPage<LogGroup>) => void;
  const end = new Promise<TokenPage<LogGroup>>((resolve) => {
    resolveEnd = resolve;
  });
  read.mockReturnValueOnce(end).mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
  fireEvent.click(nextPage());
  await waitFor(() => expectRead('Keep', 'third'));
  expect(screen.getByRole('link', { name: 'Keep 2' })).toBeVisible();
  await act(async () => resolveEnd({ items: [] }));
  await waitFor(() => expectRead('Keep', 'second'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toHaveAttribute('aria-disabled', 'true'),
  );
}

function expectEnd() {
  expect(screen.getByRole('link', { name: 'Keep 2' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Page 3' })).not.toBeInTheDocument();
  expect(nextPage()).toBeDisabled();
  expect(within(screen.getByRole('main')).getAllByText('No more log groups.').length).toBeGreaterThan(0);
}

describe('after the end of a filtered list', () => {
  it('keeps the second page, closes its end and reports why', async () => {
    await endFilteredList();
    expectEnd();
  });

  it('starts a changed filter from its own first page with a next page', async () => {
    await endFilteredList();
    read.mockResolvedValueOnce({ ...group('New 1'), next: 'new second' });
    changeFilter('New');
    expect(await screen.findByRole('link', { name: 'New 1' })).toBeVisible();
    expectRead('New');
    expect(screen.queryByText('No more log groups.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(nextPage()).toBeEnabled();
  });

  it('refreshes the ended page with its own token and clears its end until it is met again', async () => {
    await endFilteredList();
    read.mockResolvedValueOnce({ ...group('Keep 2 refreshed'), next: 'third' });
    refresh();
    expect(await screen.findByRole('link', { name: 'Keep 2 refreshed' })).toBeVisible();
    expectRead('Keep', 'second');
    expect(screen.queryByText('No more log groups.')).not.toBeInTheDocument();
    expect(nextPage()).toBeEnabled();

    read.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
    fireEvent.click(nextPage());
    await screen.findByRole('link', { name: 'Keep 2' });
    expectEnd();
  });

  it('can go back and take the next page from the first page', async () => {
    await endFilteredList();
    read
      .mockResolvedValueOnce({ ...group('Keep 1'), next: 'second' })
      .mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByRole('link', { name: 'Keep 1' })).toBeVisible();
    expectRead('Keep');
    expect(nextPage()).toBeEnabled();
    fireEvent.click(nextPage());
    expect(await screen.findByRole('link', { name: 'Keep 2' })).toBeVisible();
    expectRead('Keep', 'second');
  });
});

const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator: EMULATOR,
  reason,
  message: '',
});

const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, CONNECTED, '501 Not Implemented for DescribeLogGroups'],
  ['access denied', { kind: 'access-denied', operation, message: 'policy refusal' }, CONNECTED, 'policy refusal'],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9306',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    'Not answering at https://127.0.0.1:9306',
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: EMULATOR.port },
    `The EmuForge engine at ${ENGINE} is not answering`,
  ],
  [
    'another refusal',
    { kind: 'other', operation, code: 'InvalidParameterException', message: 'bad name pattern' },
    CONNECTED,
    'InvalidParameterException: bad name pattern',
  ],
];

it.each(failures)('shows %s in the table and lets Retry read again', async (_name, failure, connection, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(group('retried'));
  const { container } = renderPage(connection);
  const table = createWrapper(container).findTable();
  await waitFor(() => expect(table?.getElement()).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') {
    expect(table?.getElement()).toHaveTextContent('Not implemented by the emulator');
  }
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('link', { name: 'retried' })).toBeVisible();
  expectRead('');
});

it('links to the create form and disables Delete until a row is selected', async () => {
  read.mockResolvedValueOnce(group('selectable'));
  renderPage();
  await screen.findByRole('link', { name: 'selectable' });
  expect(screen.getByRole('link', { name: 'Create log group' })).toHaveAttribute('href', '/aws/logs/log-groups/create');
  const remove = screen.getByRole('button', { name: 'Delete' });
  expect(remove).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('radio', { name: 'selectable' }));
  expect(remove).toBeEnabled();
  expect(remove).not.toHaveAttribute('aria-disabled', 'true');
});
