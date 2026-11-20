import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { ECS_KEYS } from './queries';
import * as api from './task-api';
import { useStopTask, useTask, useTaskListing } from './task-queries';

// The hooks over `task-api.ts`, whose calls the case answers (`task-api.test.ts` proves the calls).

vi.mock('./task-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./task-api')>();
  return { ...real, listTasks: vi.fn(), getTask: vi.fn(), stopTask: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9997';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Whether `key` starts with `root`. */
function under(key: readonly unknown[], root: readonly unknown[]): boolean {
  return root.length <= key.length && root.every((part, index) => key[index] === part);
}

const keys = () =>
  client
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);

const task = (id: string, lastStatus: string): api.Task => ({
  id,
  arn: `arn:aws:ecs:us-east-1:0:task/dev/${id}`,
  lastStatus,
  containers: [],
});

describe('the keys', () => {
  it("the tasks key starts with the cluster's tasks root and holds the desired status, the service and the token; the task's key holds the id", async () => {
    vi.mocked(api.listTasks).mockImplementation((_at, _cluster, _filters, token) =>
      Promise.resolve(token === undefined ? { tasks: [], nextToken: 'tok-1' } : { tasks: [] }),
    );
    vi.mocked(api.getTask).mockResolvedValue({ found: true, task: task('abc', 'STOPPED') });
    const { result } = renderHook(
      () => ({
        listing: useTaskListing(ENDPOINT, 'dev', { desiredStatus: 'STOPPED', service: 'api' }),
        task: useTask(ENDPOINT, 'dev', 'abc'),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.listing.openEnd).toBe(true);
    });
    act(() => {
      result.current.listing.goToPage(2);
    });
    await waitFor(() => {
      expect(api.listTasks).toHaveBeenCalledTimes(2);
    });
    const root = ECS_KEYS.clusterTasks('dev');
    expect(
      keys().some((key) => under(key, root) && key.includes('STOPPED') && key.includes('api') && key.includes('tok-1')),
    ).toBe(true);
    await waitFor(() => {
      expect(result.current.task.value?.found).toBe(true);
    });
    expect(keys().some((key) => under(key, root) && key.includes('abc'))).toBe(true);
  });
});

describe('following one task', () => {
  it('a task read as RUNNING is read again after 3 seconds; one read as STOPPED is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getTask)
      .mockResolvedValueOnce({ found: true, task: task('abc', 'RUNNING') })
      .mockResolvedValue({ found: true, task: task('abc', 'STOPPED') });
    const { result } = renderHook(() => useTask(ENDPOINT, 'dev', 'abc'), { wrapper });
    await waitFor(() => {
      expect(result.current.value?.found).toBe(true);
    });
    expect(api.getTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_900);
    });
    expect(api.getTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => {
      expect(api.getTask).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(api.getTask).toHaveBeenCalledTimes(2);
  });
});

describe('stop', () => {
  it("a successful stop invalidates the task, the cluster's tasks and the cluster's read; a refused one invalidates nothing", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useStopTask(ENDPOINT, 'dev'), { wrapper });

    vi.mocked(api.stopTask).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation: 'StopTask', code: 'InvalidParameterException' }),
    );
    await expect(result.current('abc', new AbortController().signal)).rejects.toBeInstanceOf(RequestError);
    expect(invalidate).not.toHaveBeenCalled();

    vi.mocked(api.stopTask).mockResolvedValueOnce();
    await result.current('abc', new AbortController().signal);
    expect(api.stopTask).toHaveBeenLastCalledWith(ENDPOINT, 'dev', 'abc', expect.any(AbortSignal));
    const invalidated = invalidate.mock.calls.map((call) => call[0]?.queryKey ?? []);
    const covered = (key: readonly unknown[]) => invalidated.some((root) => under(key, root));
    expect(covered(ECS_KEYS.clusterTasks('dev', 'task', 'abc'))).toBe(true);
    expect(covered(ECS_KEYS.clusterTasks('dev', 'list', 'RUNNING', null))).toBe(true);
    expect(covered(ECS_KEYS.cluster('dev'))).toBe(true);
    expect(covered(ECS_KEYS.cluster('other'))).toBe(false);
  });
});
