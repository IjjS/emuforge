import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './api';
import { ECS_KEYS, useClusterListing, useCreateCluster, useDeleteCluster } from './queries';

// The hooks over `api.ts`, whose calls the case answers (`api.test.ts` proves the calls).

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return {
    ...real,
    listClusters: vi.fn(),
    getCluster: vi.fn(),
    createCluster: vi.fn(),
    deleteCluster: vi.fn(),
  };
});

const ENDPOINT = 'http://127.0.0.1:9998';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Whether `key` starts with `root`. */
function under(key: readonly unknown[], root: readonly unknown[]): boolean {
  return root.length <= key.length && root.every((part, index) => key[index] === part);
}

const signal = () => new AbortController().signal;

describe('the key roots', () => {
  it("the list's key holds the page's token; a cluster's read and its tasks' and services' roots hold its name, none under another", async () => {
    vi.mocked(api.listClusters).mockImplementation((_at, token) =>
      Promise.resolve(token === undefined ? { clusters: [], nextToken: 'tok-1' } : { clusters: [] }),
    );
    const { result } = renderHook(() => useClusterListing(ENDPOINT), { wrapper });
    await waitFor(() => {
      expect(result.current.openEnd).toBe(true);
    });
    act(() => {
      result.current.goToPage(2);
    });
    await waitFor(() => {
      expect(api.listClusters).toHaveBeenCalledTimes(2);
    });
    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys.some((key) => under(key, ECS_KEYS.clusters()) && key.includes('tok-1'))).toBe(true);

    const read = ECS_KEYS.cluster('dev');
    const tasks = ECS_KEYS.clusterTasks('dev');
    const services = ECS_KEYS.clusterServices('dev');
    for (const root of [read, tasks, services]) {
      expect(root).toContain('dev');
    }
    for (const [a, b] of [
      [tasks, services],
      [services, tasks],
      [tasks, read],
      [services, read],
      [read, tasks],
      [read, services],
    ] as const) {
      expect(under(a, b)).toBe(false);
    }
    expect(under(read, ECS_KEYS.clusters())).toBe(false);
  });

  it("the task definitions' roots: the families, a family's revisions with the family, a revision with family and number", () => {
    const families = ECS_KEYS.families();
    const revisions = ECS_KEYS.familyRevisions('web');
    const revision = ECS_KEYS.revision('web', 3);
    expect(revisions).toContain('web');
    expect(revision).toContain('web');
    expect(revision).toContain(3);
    expect(under(revision, revisions)).toBe(false);
    expect(under(revisions, families)).toBe(false);
    expect(under(revision, families)).toBe(false);
  });
});

describe('delete a cluster', () => {
  it("a successful delete invalidates the list and the cluster's own read; a refused one invalidates nothing", async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteCluster(ENDPOINT), { wrapper });
    vi.mocked(api.deleteCluster).mockResolvedValueOnce();
    await result.current('dev', signal());
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ECS_KEYS.clusters(),
      ECS_KEYS.cluster('dev'),
    ]);

    invalidate.mockClear();
    vi.mocked(api.deleteCluster).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation: 'DeleteCluster', code: 'ClusterContainsTasksException' }),
    );
    await expect(result.current('dev', signal())).rejects.toBeInstanceOf(RequestError);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('create a cluster', () => {
  it('a successful create invalidates the list, cancels a read of that cluster that is out and removes what is held', async () => {
    vi.mocked(api.getCluster).mockResolvedValue({ found: false });
    vi.mocked(api.createCluster).mockResolvedValue();
    // Held from before: a not-found of the cluster's page, and a read of it still out.
    client.setQueryData([...ECS_KEYS.cluster('dev'), ENDPOINT, 1, 0], { found: false });
    let outSignal: AbortSignal | undefined;
    const out = client
      .fetchQuery({
        queryKey: [...ECS_KEYS.cluster('dev'), ENDPOINT, 2, 0],
        queryFn: ({ signal: querySignal }) => {
          outSignal = querySignal;
          return new Promise(() => undefined);
        },
      })
      .catch(() => undefined);
    client.setQueryData([...ECS_KEYS.cluster('other'), ENDPOINT, 3, 0], { found: false });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useCreateCluster(ENDPOINT), { wrapper });
    expect(await result.current('dev', signal())).toBe('created');
    await out;
    expect(outSignal?.aborted).toBe(true);
    expect(client.getQueryCache().findAll({ queryKey: ECS_KEYS.cluster('dev') })).toEqual([]);
    expect(client.getQueryCache().findAll({ queryKey: ECS_KEYS.cluster('other') })).toHaveLength(1);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([ECS_KEYS.clusters()]);
  });

  it('an active cluster of the name → "exists", no CreateCluster, nothing changed', async () => {
    vi.mocked(api.getCluster).mockResolvedValue({ found: true, cluster: { name: 'dev', status: 'ACTIVE' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCluster(ENDPOINT), { wrapper });
    expect(await result.current('dev', signal())).toBe('exists');
    expect(api.createCluster).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('a refused create changes nothing held', async () => {
    vi.mocked(api.getCluster).mockResolvedValue({ found: false });
    vi.mocked(api.createCluster).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateCluster', code: 'InvalidParameterException' }),
    );
    const held = [...ECS_KEYS.cluster('dev'), ENDPOINT, 1, 0];
    client.setQueryData(held, { found: false });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const cancel = vi.spyOn(client, 'cancelQueries');
    const { result } = renderHook(() => useCreateCluster(ENDPOINT), { wrapper });
    await expect(result.current('dev', signal())).rejects.toBeInstanceOf(RequestError);
    expect(client.getQueryData(held)).toEqual({ found: false });
    expect(invalidate).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});
