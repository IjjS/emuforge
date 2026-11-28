import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import { getEventBus } from './bus-api';
import { useBusChoice } from './use-bus-choice';

vi.mock('./bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bus-api')>()),
  getEventBus: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const read = vi.mocked(getEventBus);
const operation = 'DescribeEventBus';

beforeEach(() => {
  read.mockReset();
});

function choose(addressBus: string | null) {
  const client = new QueryClient();
  return renderHook(() => useBusChoice(endpoint, addressBus), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }).result;
}

it('chooses default without a read when the bus parameter is absent', () => {
  expect(choose(null).current).toEqual({ kind: 'chosen', name: 'default' });
  expect(read).not.toHaveBeenCalled();
});

it('reads a plausible name and chooses the bus with that exact name', async () => {
  read.mockResolvedValueOnce({ kind: 'found', bus: { Name: 'orders' } });
  const choice = choose('orders');
  expect(choice.current).toEqual({ kind: 'loading' });
  await waitFor(() => expect(choice.current).toEqual({ kind: 'chosen', name: 'orders' }));
  expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
});

it.each([{ kind: 'not-found' }, { kind: 'found', bus: { Name: 'Orders' } }] as const)(
  'keeps the address unchosen when there is no exact match ($kind)',
  async (answer) => {
    read.mockResolvedValueOnce(answer);
    const choice = choose('orders');
    await waitFor(() => expect(choice.current).toMatchObject({ kind: 'invalid', name: 'orders' }));
    expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
  },
);

it.each(['', 'arn:aws:events:us-east-1:123:event-bus/orders', 'my bus', 'a'.repeat(257)])(
  'keeps invalid address %s as text without reading it',
  (name) => {
    expect(choose(name).current).toEqual({
      kind: 'invalid',
      name,
      message:
        name === ''
          ? 'The address names no event bus. Choose an event bus.'
          : `Event bus ${name} is not in your local emulator. Choose an event bus.`,
    });
    expect(read).not.toHaveBeenCalled();
  },
);

const failures: RequestFailure[] = [
  { kind: 'other', operation, code: 'Throttling', message: 'Try again' },
  { kind: 'not-implemented', operation },
];

it.each(failures)('leaves the bus unchosen for $kind and retries DescribeEventBus', async (failure) => {
  read
    .mockRejectedValueOnce(new RequestError(failure))
    .mockResolvedValueOnce({ kind: 'found', bus: { Name: 'orders' } });
  const choice = choose('orders');
  await waitFor(() => expect(choice.current).toMatchObject({ kind: 'failed', failure }));
  if (choice.current.kind !== 'failed') throw new Error('Expected a failed bus choice');
  act(choice.current.retry);
  await waitFor(() => expect(choice.current).toEqual({ kind: 'chosen', name: 'orders' }));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(endpoint, 'orders', expect.any(AbortSignal));
});
