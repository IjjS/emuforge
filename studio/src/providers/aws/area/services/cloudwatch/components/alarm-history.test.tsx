import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { readAlarmHistory } from '../alarm-page-api';
import { useAlarmHistory } from '../alarm-queries';
import { AlarmHistory } from './alarm-history';

vi.mock('../alarm-page-api', async (load) => ({
  ...(await load<typeof import('../alarm-page-api')>()),
  readAlarmHistory: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8310';
const EMULATOR = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const operation = 'DescribeAlarmHistory';
const read = vi.mocked(readAlarmHistory);
const name = 'local-alarm';

beforeEach(() => read.mockReset());

function open(result: AreaConnection['result'] = CONNECTED) {
  const connection = { engineOrigin: ENGINE, result };
  function Section() {
    return <AlarmHistory connection={connection} listing={useAlarmHistory(ENGINE, name)} />;
  }
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <Section />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const table = createWrapper(container).findTable();
  if (!table) throw new Error('History table missing');
  return table;
}

it('shows loading, then history in the order answered with time, type and summary', async () => {
  const first = new Date('2026-11-27T00:00:00Z');
  const second = new Date('2026-11-26T00:00:00Z');
  read.mockResolvedValue({
    items: [
      { time: first, type: 'Action', summary: 'SNS topic notified' },
      { time: second, type: 'State', summary: 'Alarm entered ALARM' },
    ],
  });
  const table = open();
  expect(table.findLoadingText()?.getElement().textContent).toBe('Loading history');
  await waitFor(() => expect(table.findRows()).toHaveLength(2));
  expect([1, 2].map((row) => [1, 2, 3].map((col) => table.findBodyCell(row, col)?.getElement().textContent))).toEqual([
    [creationDateText(first), 'Action', 'SNS topic notified'],
    [creationDateText(second), 'State', 'Alarm entered ALARM'],
  ]);
});

it('shows No history for an empty first page', async () => {
  read.mockResolvedValue({ items: [] });
  const table = open();
  await waitFor(() => expect(table.findEmptySlot()?.getElement().textContent).toBe('No history'));
});

it('uses the next token and refreshes the page reached by that token', async () => {
  read
    .mockResolvedValueOnce({ items: [{ time: undefined, type: 'State', summary: 'First' }], next: 'next' })
    .mockResolvedValue({ items: [{ time: undefined, type: 'Configuration', summary: 'Second' }] });
  const table = open();
  await waitFor(() => expect(table.findBodyCell(1, 3)?.getElement().textContent).toBe('First'));
  table.findPagination()?.findNextPageButton().click();
  await waitFor(() => expect(table.findBodyCell(1, 3)?.getElement().textContent).toBe('Second'));
  expect(read).toHaveBeenLastCalledWith(ENGINE, name, 'next', expect.any(AbortSignal));
  const refresh = table.findHeaderSlot()?.findHeader()?.findActions()?.findButton();
  expect(refresh?.getElement()).toHaveAccessibleName('Refresh');
  refresh?.click();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(read).toHaveBeenLastCalledWith(ENGINE, name, 'next', expect.any(AbortSignal));
});

const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator: EMULATOR,
  reason,
  message: '',
});

const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, CONNECTED, '501 Not Implemented for DescribeAlarmHistory'],
  ['access denied', { kind: 'access-denied', operation, message: 'policy refusal' }, CONNECTED, 'policy refusal'],
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
    'Not answering at https://127.0.0.1:9310',
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: EMULATOR.port },
    `The EmuForge engine at ${ENGINE} is not answering`,
  ],
  [
    'another refusal',
    { kind: 'other', operation, code: 'InvalidParameterValue', message: 'bad parameter' },
    CONNECTED,
    'InvalidParameterValue: bad parameter',
  ],
];

it.each(failures)('shows %s within history and retries', async (_, failure, result, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [] });
  const table = open(result);
  await waitFor(() => expect(table.findEmptySlot()?.getElement()).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') {
    expect(table.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe(
      'Not implemented by the emulator',
    );
  }
  table.findEmptySlot()?.findButton()?.click();
  await waitFor(() => expect(table.findEmptySlot()?.getElement().textContent).toBe('No history'));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(ENGINE, name, undefined, expect.any(AbortSignal));
});
