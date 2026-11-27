import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { getEventBus, listResourceTags, type EventBusRead } from './bus-api';
import { useEventBus, useResourceTags, useRule, useRuleTargets } from './queries';
import { getRule, listRuleTargets } from './rule-api';

vi.mock('./bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bus-api')>()),
  getEventBus: vi.fn(),
  listResourceTags: vi.fn(),
}));

vi.mock('./rule-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rule-api')>()),
  getRule: vi.fn(),
  listRuleTargets: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8306';
const reads = [getEventBus, listResourceTags, getRule, listRuleTargets];
const operations = ['DescribeEventBus', 'ListTagsForResource', 'DescribeRule', 'ListTargetsByRule'];

beforeEach(() => vi.resetAllMocks());

function queryWrapper() {
  const client = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const bus = (name: string): EventBusRead => ({ kind: 'found', bus: { Name: name } });

function useReads(at?: string) {
  return [
    useEventBus(at, 'orders'),
    useResourceTags(at, 'arn:orders'),
    useRule(at, 'orders', 'route'),
    useRuleTargets(at, 'orders', 'route'),
  ];
}

it('waits for the address, then sends each read with its arguments and shows its answer', async () => {
  const busAnswer = deferred<EventBusRead>();
  const tagsAnswer = deferred<Record<string, string>>();
  const rule = { kind: 'found', rule: { Name: 'route' } } as const;
  const targets = [{ Id: 'queue', Arn: 'arn:queue' }];
  const { result, rerender } = renderHook(({ at }: { at?: string }) => useReads(at), {
    initialProps: {},
    wrapper: queryWrapper(),
  });
  vi.mocked(getEventBus).mockReturnValueOnce(busAnswer.promise);
  vi.mocked(listResourceTags).mockReturnValueOnce(tagsAnswer.promise);
  vi.mocked(getRule).mockResolvedValueOnce(rule);
  vi.mocked(listRuleTargets).mockResolvedValueOnce(targets);

  for (const read of reads) expect(read).not.toHaveBeenCalled();
  expect(result.current.map(({ loading }) => loading)).toEqual([true, true, true, true]);
  rerender({ at: endpoint });
  await waitFor(() => {
    expect(getEventBus).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
    expect(listResourceTags).toHaveBeenCalledExactlyOnceWith(endpoint, 'arn:orders', expect.any(AbortSignal));
    expect(getRule).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', 'route', expect.any(AbortSignal));
    expect(listRuleTargets).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', 'route', expect.any(AbortSignal));
  });
  expect(result.current[0]).toMatchObject({ loading: true, value: undefined });
  await act(async () => {
    busAnswer.resolve(bus('orders'));
    tagsAnswer.resolve({ env: 'local' });
  });
  await waitFor(() => {
    expect(result.current.map(({ value }) => value)).toEqual([bus('orders'), { env: 'local' }, rule, targets]);
    expect(result.current.map(({ loading }) => loading)).toEqual([false, false, false, false]);
  });
});

it('shows each read’s failure with its operation', async () => {
  const failures = operations.map((operation) => ({ kind: 'not-implemented', operation }) as const);
  reads.forEach((read, index) => {
    const failure = failures[index];
    if (!failure) throw new Error('Expected a failure for each read');
    vi.mocked(read).mockRejectedValueOnce(new RequestError(failure));
  });
  const { result } = renderHook(() => useReads(endpoint), { wrapper: queryWrapper() });
  await waitFor(() => expect(result.current.map(({ failure }) => failure)).toEqual(failures));
  expect(result.current.map(({ value, loading }) => ({ value, loading }))).toEqual(
    failures.map(() => ({ value: undefined, loading: false })),
  );
});

it.each([true, false])(
  'a refresh starts another read while the first is pending, old answer first: %s',
  async (oldFirst) => {
    const first = deferred<EventBusRead>();
    const second = deferred<EventBusRead>();
    vi.mocked(getEventBus).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useEventBus(endpoint, 'orders'), { wrapper: queryWrapper() });
    await waitFor(() => expect(getEventBus).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(getEventBus).toHaveBeenCalledTimes(2));

    if (oldFirst) {
      await act(async () => first.resolve(bus('old')));
      expect(result.current.value).toBeUndefined();
    }
    await act(async () => second.resolve(bus('new')));
    await waitFor(() => expect(result.current.value).toEqual(bus('new')));
    if (!oldFirst) {
      await act(async () => first.resolve(bus('old')));
      expect(result.current.value).toEqual(bus('new'));
    }
  },
);

it('refreshes an answered rule and reads a rule of the same name on another bus', async () => {
  const rule = (bus: string, description: string) =>
    ({
      kind: 'found',
      rule: { Name: 'route', EventBusName: bus, Description: description },
    }) as const;
  vi.mocked(getRule)
    .mockResolvedValueOnce(rule('orders', 'old'))
    .mockResolvedValueOnce(rule('orders', 'new'))
    .mockResolvedValueOnce(rule('billing', 'other'));
  const { result, rerender } = renderHook(({ bus }) => useRule(endpoint, bus, 'route'), {
    initialProps: { bus: 'orders' },
    wrapper: queryWrapper(),
  });
  await waitFor(() => expect(result.current.value).toEqual(rule('orders', 'old')));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.value).toEqual(rule('orders', 'new')));
  rerender({ bus: 'billing' });
  await waitFor(() => expect(result.current.value).toEqual(rule('billing', 'other')));
  expect(vi.mocked(getRule).mock.calls.map(([, bus]) => bus)).toEqual(['orders', 'orders', 'billing']);
});

it('starts empty and reads again after leaving and reopening a page', async () => {
  const fresh = deferred<EventBusRead>();
  vi.mocked(getEventBus).mockResolvedValueOnce(bus('old')).mockReturnValueOnce(fresh.promise);
  const wrapper = queryWrapper();
  const previous = renderHook(() => useEventBus(endpoint, 'orders'), { wrapper });
  await waitFor(() => expect(previous.result.current.value).toEqual(bus('old')));
  previous.unmount();

  const { result } = renderHook(() => useEventBus(endpoint, 'orders'), { wrapper });
  expect(result.current).toMatchObject({ value: undefined, loading: true });
  await waitFor(() => expect(getEventBus).toHaveBeenCalledTimes(2));
  await act(async () => fresh.resolve(bus('fresh')));
  await waitFor(() => expect(result.current.value).toEqual(bus('fresh')));
});
