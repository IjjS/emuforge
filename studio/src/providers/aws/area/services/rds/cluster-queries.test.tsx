import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './api';
import * as clusterApi from './cluster-api';
import {
  useAddInstance,
  useClusterDelete,
  useClusterListing,
  useClusterOnce,
  useClusterRound,
} from './cluster-queries';
import { RDS_KEYS, useInstance, useInstanceListing } from './queries';

// The hooks over `cluster-api.ts`, whose calls the case answers: each call waits until the case settles it, so the
// case decides the order in which answers arrive. `cluster-api.test.ts` proves the calls against a fake engine.

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return { ...real, listInstances: vi.fn(), getInstance: vi.fn() };
});

vi.mock('./cluster-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./cluster-api')>();
  return {
    ...real,
    listClusters: vi.fn(),
    getCluster: vi.fn(),
    listMembers: vi.fn(),
    deleteCluster: vi.fn(),
    addInstance: vi.fn(),
    operateCluster: vi.fn(),
  };
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

function cluster(id: string, status: string, members: clusterApi.ClusterMember[] = []): clusterApi.DbCluster {
  return { id, status, securityGroups: [], members, deletionProtection: false, tags: [] };
}

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

describe('the clusters listing', () => {
  for (const status of SIX) {
    it(`while a row is ${status} → asked again after 3 seconds with the same marker; no more once none is`, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const calls = held(clusterApi.listClusters);
      const { result } = renderHook(() => useClusterListing(ENDPOINT), { wrapper });
      act(() => {
        calls[0]?.resolve({ clusters: [cluster('a', 'available')], marker: 'm1' });
      });
      await waitFor(() => {
        expect(result.current.openEnd).toBe(true);
      });
      act(() => {
        result.current.goToPage(2);
      });
      const second = await nth(calls, 1);
      expect(second.args[1]).toBe('m1');
      act(() => {
        second.resolve({ clusters: [cluster('b', status)] });
      });
      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
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
      act(() => {
        polled.resolve({ clusters: [cluster('b', 'available')] });
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
    const calls = held(clusterApi.listClusters);
    const { result } = renderHook(() => useClusterListing(ENDPOINT), { wrapper });
    act(() => {
      calls[0]?.resolve({ clusters: [cluster('a', 'available'), cluster('b', 'backing-up')] });
    });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(calls).toHaveLength(1);
  });
});

describe('a cluster and its members', () => {
  for (const status of SIX) {
    for (const what of ['the cluster', 'a member'] as const) {
      it(`while ${what} is ${status} → both asked again after 3 seconds, and no more once none is`, async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const reads = held(clusterApi.getCluster);
        const members = held(clusterApi.listMembers);
        const { result } = renderHook(() => useClusterRound(ENDPOINT, 'aur-1'), { wrapper });
        expect(result.current.loading).toBe(true);
        await nth(reads, 0);
        await nth(members, 0);
        expect(reads[0]?.args[1]).toBe('aur-1');
        expect(members[0]?.args[1]).toBe('aur-1');
        act(() => {
          reads[0]?.resolve({
            found: true,
            cluster: cluster('aur-1', what === 'the cluster' ? status : 'available', [{ id: 'm', writer: true }]),
          });
          members[0]?.resolve([instance('m', what === 'a member' ? status : 'available')]);
        });
        await waitFor(() => {
          expect(result.current.value).toBeDefined();
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_000);
        });
        await nth(reads, 1);
        await nth(members, 1);
        act(() => {
          reads[1]?.resolve({ found: true, cluster: cluster('aur-1', 'available', [{ id: 'm', writer: true }]) });
          members[1]?.resolve([instance('m', 'available')]);
        });
        await waitFor(() => {
          expect(result.current.value?.members).toEqual({ ok: true, instances: [instance('m', 'available')] });
        });
        expect(result.current.value?.cluster).toEqual({
          found: true,
          cluster: cluster('aur-1', 'available', [{ id: 'm', writer: true }]),
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(9_000);
        });
        expect(reads).toHaveLength(2);
        expect(members).toHaveLength(2);
      });
    }
  }

  it('a failed read of the members fails the members alone; one of the cluster fails the read', async () => {
    const reads = held(clusterApi.getCluster);
    const members = held(clusterApi.listMembers);
    const { result } = renderHook(() => useClusterRound(ENDPOINT, 'aur-1'), { wrapper });
    await nth(reads, 0);
    await nth(members, 0);
    const failure = { kind: 'other', operation: 'DescribeDBInstances', code: 'InternalFailure' } as const;
    act(() => {
      reads[0]?.resolve({ found: true, cluster: cluster('aur-1', 'available') });
      members[0]?.reject(new RequestError(failure));
    });
    await waitFor(() => {
      expect(result.current.value?.members).toEqual({ ok: false, failure });
    });
    expect(result.current.failure).toBeUndefined();
    act(() => {
      result.current.refresh();
    });
    await nth(reads, 1);
    act(() => {
      reads[1]?.reject(new RequestError({ ...failure, operation: 'DescribeDBClusters' }));
      members[1]?.resolve([]);
    });
    await waitFor(() => {
      expect(result.current.failure?.operation).toBe('DescribeDBClusters');
    });
  });
});

describe('the changes', () => {
  /** Every read the changes may read again, each counted by its calls. */
  function allReads() {
    const lists = held(clusterApi.listClusters);
    const reads = held(clusterApi.getCluster);
    const members = held(clusterApi.listMembers);
    const instanceLists = held(api.listInstances);
    const instanceReads = held(api.getInstance);
    const hook = renderHook(
      () => ({
        clusters: useClusterListing(ENDPOINT),
        round: useClusterRound(ENDPOINT, 'aur-1'),
        once: useClusterOnce(ENDPOINT, 'aur-1'),
        other: useClusterRound(ENDPOINT, 'aur-2'),
        instances: useInstanceListing(ENDPOINT),
        instance: useInstance(ENDPOINT, 'db-1'),
        remove: useClusterDelete(ENDPOINT),
        add: useAddInstance(ENDPOINT),
      }),
      { wrapper },
    );
    const answerAll = () => {
      act(() => {
        for (const call of lists) call.resolve({ clusters: [] });
        for (const call of reads) call.resolve({ found: true, cluster: cluster(String(call.args[1]), 'available') });
        for (const call of members) call.resolve([]);
        for (const call of instanceLists) call.resolve({ instances: [] });
        for (const call of instanceReads) call.resolve({ found: true, instance: instance('db-1', 'available') });
      });
    };
    const counts = () => ({
      lists: lists.length,
      aur1: reads.filter((call) => call.args[1] === 'aur-1').length,
      aur2: reads.filter((call) => call.args[1] === 'aur-2').length,
      members1: members.filter((call) => call.args[1] === 'aur-1').length,
      instanceLists: instanceLists.length,
      instance: instanceReads.length,
    });
    return { hook, answerAll, counts };
  }

  for (const outcome of ['200', 'a failure'] as const) {
    it(`after a cluster is deleted, ${outcome} → the cluster lists and that cluster are read again`, async () => {
      const { hook, answerAll, counts } = allReads();
      await waitFor(() => {
        expect(counts()).toEqual({ lists: 1, aur1: 2, aur2: 1, members1: 1, instanceLists: 1, instance: 1 });
      });
      answerAll();
      await waitFor(() => {
        expect(hook.result.current.once.value).toBeDefined();
      });
      const deletes = held(clusterApi.deleteCluster);
      let settled: Promise<void> | undefined;
      act(() => {
        settled = hook.result.current.remove('aur-1', new AbortController().signal).catch(() => undefined);
      });
      const sent = await nth(deletes, 0);
      expect(sent.args[1]).toBe('aur-1');
      act(() => {
        if (outcome === '200') sent.resolve(undefined);
        else
          sent.reject(
            new RequestError({ kind: 'other', operation: 'DeleteDBCluster', code: 'InvalidDBClusterStateFault' }),
          );
      });
      await settled;
      await waitFor(() => {
        expect(counts()).toEqual({ lists: 2, aur1: 4, aur2: 1, members1: 2, instanceLists: 1, instance: 1 });
      });
    });
  }

  it('after an instance is added → that cluster, its members and the instance lists; after the add fails → none is', async () => {
    const { hook, answerAll, counts } = allReads();
    await waitFor(() => {
      expect(counts().instance).toBe(1);
    });
    answerAll();
    await waitFor(() => {
      expect(hook.result.current.once.value).toBeDefined();
    });
    const adds = held(clusterApi.addInstance);
    const member: clusterApi.NewMember = {
      id: 'aur-1-b',
      clusterId: 'aur-1',
      engine: 'aurora-postgresql',
      engineVersion: '16.4',
      instanceClass: 'db.r6g.large',
    };
    let created: Promise<string | undefined> | undefined;
    act(() => {
      created = hook.result.current.add(member, new AbortController().signal);
    });
    const sent = await nth(adds, 0);
    expect(sent.args[1]).toEqual(member);
    act(() => {
      sent.resolve('aur-1-b');
    });
    expect(await created).toBe('aur-1-b');
    await waitFor(() => {
      expect(counts()).toEqual({ lists: 1, aur1: 4, aur2: 1, members1: 2, instanceLists: 2, instance: 1 });
    });
    answerAll();

    const before = counts();
    let failed: Promise<unknown> | undefined;
    act(() => {
      failed = hook.result.current.add(member, new AbortController().signal).catch((error: unknown) => error);
    });
    const refused = await nth(adds, 1);
    act(() => {
      refused.reject(
        new RequestError({ kind: 'other', operation: 'CreateDBInstance', code: 'InvalidParameterCombination' }),
      );
    });
    expect(await failed).toBeInstanceOf(RequestError);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(counts()).toEqual(before);
  });

  it('cancels the old cluster and members and refreshes only the new identifier and lists on a rename', async () => {
    const { hook, answerAll, counts } = allReads();
    await waitFor(() => expect(counts().aur1).toBe(2));
    answerAll();
    await waitFor(() => expect(hook.result.current.round.value).toBeDefined());
    const keys = [RDS_KEYS.members('aur-1'), RDS_KEYS.members('aur-2')];
    let oldMembersSignal: AbortSignal | undefined;
    const oldMembers = client
      .fetchQuery({
        queryKey: keys[0]!,
        queryFn: ({ signal }) => {
          oldMembersSignal = signal;
          return new Promise<never>(() => undefined);
        },
      })
      .catch(() => undefined);
    client.setQueryData(keys[1]!, []);
    const before = counts();
    const cancel = vi.spyOn(client, 'cancelQueries');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(clusterApi.operateCluster).mockResolvedValue('aur-2');
    await act(async () => {
      await expect(
        hook.result.current.round.operate(
          'aur-1',
          { kind: 'modify', changes: { newIdentifier: 'aur-2' } },
          new AbortController().signal,
        ),
      ).resolves.toBe('aur-2');
    });
    await oldMembers;
    expect(oldMembersSignal?.aborted).toBe(true);
    for (const queryKey of [RDS_KEYS.cluster('aur-1'), RDS_KEYS.members('aur-1')]) {
      expect(cancel).toHaveBeenCalledWith({ queryKey });
      expect(invalidate).toHaveBeenCalledWith({ queryKey, refetchType: 'none' });
    }
    for (const queryKey of [
      RDS_KEYS.cluster('aur-2'),
      RDS_KEYS.members('aur-2'),
      RDS_KEYS.clusters(),
      RDS_KEYS.instances(),
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
    await waitFor(() =>
      expect(counts()).toEqual({
        ...before,
        aur2: before.aur2 + 1,
        lists: before.lists + 1,
        instanceLists: before.instanceLists + 1,
      }),
    );
  });

  it.each([
    { kind: 'modify', changes: { deletionProtection: true } },
    { kind: 'stop' },
    { kind: 'start' },
    { kind: 'failover', target: 'reader' },
  ] as const)('cancels and reloads the current round after $kind', async (action) => {
    const { hook, answerAll, counts } = allReads();
    await waitFor(() => expect(counts().aur1).toBe(2));
    answerAll();
    await waitFor(() => expect(hook.result.current.round.value).toBeDefined());
    const cancel = vi.spyOn(client, 'cancelQueries');
    vi.mocked(clusterApi.operateCluster).mockResolvedValue('aur-1');
    await act(async () => {
      await expect(hook.result.current.round.operate('aur-1', action, new AbortController().signal)).resolves.toBe(
        'aur-1',
      );
    });
    expect(cancel).toHaveBeenCalledWith({ queryKey: RDS_KEYS.cluster('aur-1') });
    await waitFor(() =>
      expect(counts()).toEqual({
        lists: 2,
        aur1: 4,
        aur2: 1,
        members1: 2,
        instanceLists: 2,
        instance: 1,
      }),
    );
  });
});
