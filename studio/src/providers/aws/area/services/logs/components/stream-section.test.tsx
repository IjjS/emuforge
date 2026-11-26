import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { listLogStreams } from '../stream-api';
import { StreamSection } from './stream-section';

vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));

const operation = 'DescribeLogStreams';
const emulator = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const engineOrigin = 'http://127.0.0.1:8310';
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator,
  reason,
  message: '',
});
const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, connected, `501 Not Implemented for ${operation}`],
  [
    'access denied',
    { kind: 'access-denied', operation, message: 'policy refusal' },
    connected,
    `${operation} was refused: policy refusal`,
  ],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9310',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    `Not answering at ${emulator.endpoint}`,
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: emulator.port },
    `The EmuForge engine at ${engineOrigin} is not answering`,
  ],
  [
    'other refusal',
    { kind: 'other', operation, code: 'InvalidParameterException', message: 'request refused' },
    connected,
    'InvalidParameterException: request refused',
  ],
];

const group = '/app#Group';
const read = vi.mocked(listLogStreams);

beforeEach(() => read.mockReset());

function renderSection(result: AreaConnection['result'] = connected) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <StreamSection connection={{ engineOrigin, result }} group={group} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function enterPrefix(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by prefix' }), { target: { value } });
}

function expectRead(prefix: string, token?: string) {
  expect(read).toHaveBeenLastCalledWith(engineOrigin, group, prefix, token, expect.any(AbortSignal));
}

it('lists the stream name as a single-segment link, then the last event, first event and creation times', async () => {
  const time = Date.UTC(2026, 10, 26, 12);
  read.mockResolvedValueOnce({
    items: [
      {
        logStreamName: 'a/b#c?d%e',
        creationTime: time,
        firstEventTimestamp: time + 1000,
        lastEventTimestamp: time + 2000,
      },
      { logStreamName: 'empty', creationTime: time },
    ],
  });
  const { container } = renderSection();
  expect(await screen.findByRole('link', { name: 'a/b#c?d%e' })).toHaveAttribute(
    'href',
    '/aws/logs/log-groups/group/%2Fapp%23Group/stream/a%2Fb%23c%3Fd%25e',
  );
  const table = createWrapper(container).findTable();
  expect(table?.findRows()).toHaveLength(2);
  const rowValues = (row: number) =>
    [1, 2, 3, 4].map((column) => table?.findBodyCell(row, column)?.getElement().textContent);
  expect(rowValues(1)).toEqual([
    'a/b#c?d%e',
    creationDateText(new Date(time + 2000)),
    creationDateText(new Date(time + 1000)),
    creationDateText(new Date(time)),
  ]);
  expect(rowValues(2)).toEqual(['empty', '-', '-', creationDateText(new Date(time))]);
});

it('shows loading and distinguishes an empty list from an empty prefix result', async () => {
  read.mockResolvedValue({ items: [] });
  renderSection();
  expect(screen.getByText('Loading log streams')).toBeVisible();
  expect(await screen.findByText('No log streams')).toBeVisible();
  enterPrefix('Absent');
  expect(await screen.findByText('No log streams match')).toBeVisible();
  expectRead('Absent');
});

it('sends the typed prefix and explains that prefix matches are listed by name', async () => {
  read
    .mockResolvedValueOnce({ items: [{ logStreamName: 'initial' }] })
    .mockResolvedValueOnce({ items: [{ logStreamName: 'MiXeD/match' }] });
  renderSection();
  expect(screen.getByText('Streams that start with the prefix are listed by name.')).toBeVisible();
  await screen.findByRole('link', { name: 'initial' });
  enterPrefix('MiXeD');
  expect(await screen.findByRole('link', { name: 'MiXeD/match' })).toBeVisible();
  expectRead('MiXeD');
});

it('uses the returned token for the next page and rereads the first page when going back', async () => {
  read
    .mockResolvedValueOnce({ items: [{ logStreamName: 'first' }], next: 'second-token' })
    .mockResolvedValueOnce({ items: [{ logStreamName: 'second' }] })
    .mockResolvedValueOnce({ items: [{ logStreamName: 'first again' }], next: 'second-token' });
  renderSection();
  await screen.findByRole('link', { name: 'first' });
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByRole('link', { name: 'second' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'true');
  expectRead('', 'second-token');
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(await screen.findByRole('link', { name: 'first again' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'true');
  expectRead('');
  expect(read).toHaveBeenCalledTimes(3);
});

it.each(failures)('shows %s in the table and retries the stream read', async (_label, failure, result, text) => {
  read
    .mockRejectedValueOnce(new RequestError(failure))
    .mockResolvedValueOnce({ items: [{ logStreamName: 'retried' }] });
  const { container } = renderSection(result);
  const table = createWrapper(container).findTable()?.getElement();
  await waitFor(() => expect(table).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') expect(table).toHaveTextContent('Not implemented by the emulator');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('link', { name: 'retried' })).toBeVisible();
  expectRead('');
  expect(read).toHaveBeenCalledTimes(2);
});

it('puts the supplied actions in the header and allows selecting only one row', async () => {
  read.mockResolvedValueOnce({ items: [{ logStreamName: 'first' }, { logStreamName: 'second' }] });
  function Selectable() {
    const [name, setName] = useState<string>();
    return (
      <StreamSection
        connection={{ engineOrigin, result: connected }}
        group={group}
        selection={{ name, onChange: setName }}
        actions={() => <button type="button">Change stream</button>}
      />
    );
  }
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <Selectable />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const tableHeader = createWrapper(container).findHeader()?.getElement();
  expect(tableHeader).toContainElement(screen.getByRole('button', { name: 'Change stream' }));
  const first = await screen.findByRole('radio', { name: 'first' });
  const second = screen.getByRole('radio', { name: 'second' });
  fireEvent.click(first);
  expect(first).toBeChecked();
  fireEvent.click(second);
  expect(second).toBeChecked();
  expect(first).not.toBeChecked();
});

it('omits the supplied actions and selection controls in the read-only listing', async () => {
  read.mockResolvedValueOnce({ items: [{ logStreamName: 'first' }] });
  renderSection();
  expect(await screen.findByRole('link', { name: 'first' })).toBeVisible();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Change stream' })).not.toBeInTheDocument();
});
