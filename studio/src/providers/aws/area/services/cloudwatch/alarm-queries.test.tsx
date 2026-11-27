import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { Alarm } from './alarm';
import { readAlarmTags } from './alarm-page-api';
import { useAlarm, useAlarmTags } from './alarm-queries';
import { readAlarm } from './alarms-api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock('./alarms-api', async (load) => ({
  ...(await load<typeof import('./alarms-api')>()),
  readAlarm: vi.fn(),
}));
vi.mock('./alarm-page-api', async (load) => ({
  ...(await load<typeof import('./alarm-page-api')>()),
  readAlarmTags: vi.fn(),
}));

const engine = 'http://127.0.0.1:8310';
const secondEngine = 'http://127.0.0.1:8311';
const read = vi.mocked(readAlarm);
const readTags = vi.mocked(readAlarmTags);
const alarm = (name: string): Alarm => ({ type: 'metric', data: { AlarmName: name, AlarmArn: `arn:${name}` } });

beforeEach(() => {
  read.mockReset();
  readTags.mockReset();
});

function setup() {
  const client = new QueryClient();
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

it('keys reads by engine and argument and awaits the ARN before asking for tags', async () => {
  const pending = deferred<Alarm>();
  read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined).mockResolvedValueOnce(alarm('one'));
  readTags.mockResolvedValue([]);
  const { client, wrapper } = setup();
  const { result, rerender } = renderHook(
    ({ endpoint, name }) => {
      const detail = useAlarm(endpoint, name);
      return { detail, tags: useAlarmTags(endpoint, detail.value?.data.AlarmArn) };
    },
    { wrapper, initialProps: { endpoint: engine, name: 'one' } },
  );

  expect(readTags).not.toHaveBeenCalled();
  await act(async () => pending.resolve(alarm('one')));
  await waitFor(() => expect(result.current.tags.value).toEqual([]));
  expect(readTags).toHaveBeenCalledExactlyOnceWith(engine, 'arn:one', expect.any(AbortSignal));
  expect(client.getQueryCache().findAll({ queryKey: ['cloudwatch', 'DescribeAlarms', engine, 'one'] })).toHaveLength(1);
  expect(
    client.getQueryCache().findAll({ queryKey: ['cloudwatch', 'ListTagsForResource', engine, 'arn:one'] }),
  ).toHaveLength(1);

  rerender({ endpoint: engine, name: 'missing' });
  await waitFor(() => expect(result.current.detail.loading).toBe(false));
  expect(result.current.detail.value).toBeUndefined();
  expect(readTags).toHaveBeenCalledTimes(1);

  rerender({ endpoint: secondEngine, name: 'one' });
  await waitFor(() => expect(readTags).toHaveBeenLastCalledWith(secondEngine, 'arn:one', expect.any(AbortSignal)));
  expect(read).toHaveBeenLastCalledWith(secondEngine, 'one', expect.any(AbortSignal));
});

it('drops an earlier name’s answer when it arrives after the new name’s', async () => {
  const first = deferred<Alarm>();
  read.mockReturnValueOnce(first.promise).mockResolvedValueOnce(alarm('two'));
  const { result, rerender } = renderHook(({ name }) => useAlarm(engine, name), {
    ...setup(),
    initialProps: { name: 'one' },
  });
  const signal = read.mock.calls[0]?.[2];
  rerender({ name: 'two' });
  await waitFor(() => expect(result.current.value).toEqual(alarm('two')));
  expect(signal?.aborted).toBe(true);
  await act(async () => first.resolve(alarm('one')));
  expect(result.current.value).toEqual(alarm('two'));
});

it('cancels and replaces an initial alarm read with the same arguments', async () => {
  const first = deferred<Alarm>();
  const current = { ...alarm('one'), data: { ...alarm('one').data, StateReason: 'new' } } as Alarm;
  read.mockReturnValueOnce(first.promise).mockResolvedValueOnce(current);
  const { result } = renderHook(() => useAlarm(engine, 'one'), setup());
  const signal = read.mock.calls[0]?.[2];
  await act(async () => expect(await result.current.refresh()).toEqual({ value: current }));
  expect(signal?.aborted).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(engine, 'one', expect.any(AbortSignal));
  await act(async () => first.resolve(alarm('one')));
  await waitFor(() => expect(result.current.value).toEqual(current));
});

it('cancels and replaces an initial tags read with the same arguments', async () => {
  const first = deferred<Awaited<ReturnType<typeof readAlarmTags>>>();
  const current = [{ Key: 'project', Value: 'current' }];
  readTags.mockReturnValueOnce(first.promise).mockResolvedValueOnce(current);
  const { result } = renderHook(() => useAlarmTags(engine, 'arn:one'), setup());
  const signal = readTags.mock.calls[0]?.[2];
  await act(async () => expect(await result.current.refresh()).toEqual({ value: current }));
  expect(signal?.aborted).toBe(true);
  expect(readTags).toHaveBeenCalledTimes(2);
  expect(readTags).toHaveBeenLastCalledWith(engine, 'arn:one', expect.any(AbortSignal));
  await act(async () => first.resolve([{ Key: 'project', Value: 'stale' }]));
  await waitFor(() => expect(result.current.value).toEqual(current));
});
