import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './api';
import { RDS_KEYS, useInstance, useInstanceAction, useInstanceListing } from './queries';

// The hooks over `api.ts`, whose calls the case answers: each call waits until the case settles it, so the case
// decides the order in which answers arrive. `api.test.ts` proves the calls themselves against a fake engine.

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return { ...real, listInstances: vi.fn(), getInstance: vi.fn(), actOnInstance: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9999';

interface Call {
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** Each call of a mocked function, held until the case settles it. */
function held(fn: unknown): Call[] {
  const calls: Call[] = [];
  vi.mocked(fn as (...args: unknown[]) => Promise<unknown>).mockImplementation(
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        calls.push({ args, resolve, reject });
      }),
  );
  return calls;
}

async function nth(calls: Call[], n: number): Promise<Call> {
  await waitFor(() => {
    expect(calls.length).toBeGreaterThan(n);
  });
  return calls[n] as Call;
}

const SIX = ['creating', 'starting', 'stopping', 'rebooting', 'modifying', 'deleting'] as const;

function instance(id: string, status: string): api.DbInstance {
  return { id, status, parameterGroups: [], securityGroups: [], deletionProtection: false, tags: [] };
}

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the instances listing', () => {
  for (const status of SIX) {
    it(`while a row is ${status} → asked again after 3 seconds with the same marker; no more once none is`, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const calls = held(api.listInstances);
      const { result } = renderHook(() => useInstanceListing(ENDPOINT), { wrapper });
      act(() => {
        calls[0]?.resolve({ instances: [instance('a', 'available')], marker: 'm1' });
      });
      await waitFor(() => {
        expect(result.current.openEnd).toBe(true);
      });
      expect(calls[0]?.args[1]).toBeUndefined();
      act(() => {
        result.current.goToPage(2);
      });
      const second = await nth(calls, 1);
      expect(second.args[1]).toBe('m1');
      act(() => {
        second.resolve({ instances: [instance('b', status), instance('c', 'available')] });
      });
      await waitFor(() => {
        expect(result.current.items).toHaveLength(2);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_900);
      });
      expect(calls).toHaveLength(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      const polled = await nth(calls, 2);
      expect(polled.args[1]).toBe('m1');
      expect(result.current.currentPage).toBe(2);
      act(() => {
        polled.resolve({ instances: [instance('b', 'available'), instance('c', 'available')] });
      });
      await waitFor(() => {
        expect(result.current.items?.[0]?.status).toBe('available');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9_000);
      });
      expect(calls).toHaveLength(3);
    });
  }

  it('with no such row → not asked again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = held(api.listInstances);
    const { result } = renderHook(() => useInstanceListing(ENDPOINT), { wrapper });
    act(() => {
      calls[0]?.resolve({ instances: [instance('a', 'available'), instance('b', 'stopped'), instance('c', 'failed')] });
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(3);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toHaveLength(1);
  });
});

describe('an instance', () => {
  for (const status of SIX) {
    it(`while its status is ${status} → read again every 3 seconds, and no more once it is not`, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const calls = held(api.getInstance);
      const { result } = renderHook(() => useInstance(ENDPOINT, 'db-1'), { wrapper });
      expect(result.current.loading).toBe(true);
      act(() => {
        calls[0]?.resolve({ found: true, instance: instance('db-1', status) });
      });
      await waitFor(() => {
        expect(result.current.value).toBeDefined();
      });
      expect(calls[0]?.args[1]).toBe('db-1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      const again = await nth(calls, 1);
      expect(again.args[1]).toBe('db-1');
      act(() => {
        again.resolve({ found: true, instance: instance('db-1', 'stopped') });
      });
      await waitFor(() => {
        expect(result.current.value).toEqual({ found: true, instance: instance('db-1', 'stopped') });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9_000);
      });
      expect(calls).toHaveLength(2);
    });
  }
});

describe('the actions', () => {
  for (const outcome of ['200', 'a failure'] as const) {
    it(`after start, stop, reboot or delete is answered with ${outcome} → the instance lists, that instance and the clusters' reads are read again`, async () => {
      const lists = held(api.listInstances);
      const reads = held(api.getInstance);
      const actions = held(api.actOnInstance);
      const clusterReads = { lists: 0, cluster: 0, members: 0, other: 0 };
      const { result } = renderHook(
        () => ({
          list: useInstanceListing(ENDPOINT),
          instance: useInstance(ENDPOINT, 'db-1'),
          other: useInstance(ENDPOINT, 'db-2'),
          clusters: useQuery({
            queryKey: RDS_KEYS.clusters(undefined),
            queryFn: () => (clusterReads.lists += 1),
          }),
          cluster: useQuery({ queryKey: RDS_KEYS.cluster('aur-1'), queryFn: () => (clusterReads.cluster += 1) }),
          members: useQuery({ queryKey: RDS_KEYS.members('aur-1', 100), queryFn: () => (clusterReads.members += 1) }),
          choices: useQuery({ queryKey: RDS_KEYS.choices('subnet-groups'), queryFn: () => (clusterReads.other += 1) }),
          act: useInstanceAction(ENDPOINT),
        }),
        { wrapper },
      );
      await nth(lists, 0);
      await nth(reads, 1);
      act(() => {
        for (const call of lists) call.resolve({ instances: [instance('db-1', 'available')] });
        for (const call of reads) call.resolve({ found: true, instance: instance(String(call.args[1]), 'available') });
      });
      await waitFor(() => {
        expect(result.current.members.data).toBe(1);
      });
      for (const action of ['start', 'stop', 'reboot', 'delete'] as const) {
        const [listsBefore, readsBefore] = [lists.length, reads.length];
        const clustersBefore = { ...clusterReads };
        let settled: Promise<void> | undefined;
        act(() => {
          settled = result.current.act(action, 'db-1', new AbortController().signal).catch(() => undefined);
        });
        const sent = await nth(actions, actions.length - 1);
        expect(sent.args.slice(1, 3)).toEqual([action, 'db-1']);
        expect(lists).toHaveLength(listsBefore);
        act(() => {
          if (outcome === '200') {
            sent.resolve(undefined);
          } else {
            sent.reject(new RequestError({ kind: 'other', operation: 'X', code: 'InvalidDBInstanceState' }));
          }
        });
        await settled;
        await waitFor(() => {
          expect(lists.length).toBe(listsBefore + 1);
        });
        await waitFor(() => {
          expect(reads.length).toBe(readsBefore + 1);
        });
        expect(reads[reads.length - 1]?.args[1]).toBe('db-1');
        await waitFor(() => {
          expect(clusterReads).toEqual({
            lists: clustersBefore.lists + 1,
            cluster: clustersBefore.cluster + 1,
            members: clustersBefore.members + 1,
            other: clustersBefore.other,
          });
        });
        act(() => {
          lists[lists.length - 1]?.resolve({ instances: [instance('db-1', 'available')] });
          reads[reads.length - 1]?.resolve({ found: true, instance: instance('db-1', 'available') });
        });
      }
    });
  }
});

describe('the keys', () => {
  it("of two lists of different resources or markers differ, and so do an instance's and a cluster's of one identifier", () => {
    const keys = [
      RDS_KEYS.instances(),
      RDS_KEYS.instances('m1'),
      RDS_KEYS.instances('m2'),
      RDS_KEYS.clusters(),
      RDS_KEYS.clusters('m1'),
      RDS_KEYS.instance('x-1'),
      RDS_KEYS.instance('x-2'),
      RDS_KEYS.cluster('x-1'),
      RDS_KEYS.members('x-1'),
      RDS_KEYS.choices('engine-versions', 'postgres'),
      RDS_KEYS.choices('engine-versions', 'mysql'),
      RDS_KEYS.choices('subnet-groups'),
    ].map((key) => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("of two pages' reads differ by their markers", async () => {
    const calls = held(api.listInstances);
    const { result } = renderHook(() => useInstanceListing(ENDPOINT), { wrapper });
    act(() => {
      calls[0]?.resolve({ instances: [instance('a', 'available')], marker: 'm1' });
    });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    const keyNow = () =>
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.getObserversCount() > 0)
        .map((query) => JSON.stringify(query.queryKey));
    const [first] = keyNow();
    act(() => {
      result.current.goToPage(2);
    });
    await nth(calls, 1);
    const keys = keyNow();
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(first);
    expect(keys.some((key) => key.includes('"m1"'))).toBe(true);
  });
});
