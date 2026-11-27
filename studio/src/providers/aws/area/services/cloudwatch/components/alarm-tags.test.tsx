import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { readAlarmTags } from '../alarm-page-api';
import { useAlarmTags } from '../alarm-queries';
import { AlarmTags } from './alarm-tags';

vi.mock('../alarm-page-api', async (load) => ({
  ...(await load<typeof import('../alarm-page-api')>()),
  readAlarmTags: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8310';
const EMULATOR = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const operation = 'ListTagsForResource';
const read = vi.mocked(readAlarmTags);
const arn = 'arn:aws:cloudwatch:us-east-1:000000000000:alarm:local-alarm';

beforeEach(() => read.mockReset());

function open(result: AreaConnection['result'] = CONNECTED) {
  const connection = { engineOrigin: ENGINE, result };
  function Section() {
    return <AlarmTags connection={connection} tags={useAlarmTags(ENGINE, arn)} />;
  }
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <Section />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const table = createWrapper(container).findTable();
  if (!table) throw new Error('Tags table missing');
  return table;
}

it('shows loading and then the tag keys and values, preserving an empty value', async () => {
  read.mockResolvedValue([
    { Key: 'Project', Value: 'EmuForge' },
    { Key: 'Empty', Value: '' },
  ]);
  const table = open();
  expect(table.findLoadingText()?.getElement().textContent).toBe('Loading tags');
  await waitFor(() => expect(table.findRows()).toHaveLength(2));
  expect([1, 2].map((row) => [1, 2].map((col) => table.findBodyCell(row, col)?.getElement().textContent))).toEqual([
    ['Project', 'EmuForge'],
    ['Empty', ''],
  ]);
});

it('shows No tags for an empty answer', async () => {
  read.mockResolvedValue([]);
  const table = open();
  await waitFor(() => expect(table.findEmptySlot()?.getElement().textContent).toBe('No tags'));
});

const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator: EMULATOR,
  reason,
  message: '',
});

const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, CONNECTED, '501 Not Implemented for ListTagsForResource'],
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

it.each(failures)('shows %s within tags and retries', async (_, failure, result, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce([]);
  const table = open(result);
  await waitFor(() => expect(table.findEmptySlot()?.getElement()).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') {
    expect(table.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe(
      'Not implemented by the emulator',
    );
  }
  table.findEmptySlot()?.findButton()?.click();
  await waitFor(() => expect(table.findEmptySlot()?.getElement().textContent).toBe('No tags'));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(ENGINE, arn, expect.any(AbortSignal));
});
