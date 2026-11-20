import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './create-api';
import { useCreateCluster, useCreateInstance } from './create-queries';
import { RDS_KEYS } from './queries';

// The create hooks over `create-api.ts`, whose calls the case answers (`create-api.test.ts` proves the calls).

vi.mock('./create-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./create-api')>();
  return { ...real, createInstance: vi.fn(), createCluster: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9896';
const PASSWORD = 'pa55-Word!x';
const INSTANCE: api.NewInstance = {
  identifier: 'app-db',
  engine: 'postgres',
  instanceClass: 'db.t3.micro',
  allocatedStorage: 20,
  masterUsername: 'admin1',
  masterPassword: PASSWORD,
};
const CLUSTER: api.NewCluster = {
  identifier: 'aur-1',
  engine: 'aurora-postgresql',
  masterUsername: 'admin1',
  masterPassword: PASSWORD,
};

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const refusal = (operation: string) =>
  new RequestError({ kind: 'other', operation, code: 'InvalidParameterCombination', message: 'no' });

describe('the create hooks', () => {
  it('after an instance is created → the instance lists are read again; after it fails → none is', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateInstance(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;

    vi.mocked(api.createInstance).mockResolvedValueOnce('app-db');
    await expect(result.current(INSTANCE, signal)).resolves.toBe('app-db');
    expect(api.createInstance).toHaveBeenCalledWith(ENDPOINT, INSTANCE, signal);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: RDS_KEYS.instances() });

    invalidate.mockClear();
    const failed = refusal('CreateDBInstance');
    vi.mocked(api.createInstance).mockRejectedValueOnce(failed);
    await expect(result.current(INSTANCE, signal)).rejects.toBe(failed);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('after a cluster is created → the cluster lists are read again; after it fails → none is', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCluster(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;

    vi.mocked(api.createCluster).mockResolvedValueOnce('aur-1');
    await expect(result.current(CLUSTER, signal)).resolves.toBe('aur-1');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: RDS_KEYS.clusters() });

    invalidate.mockClear();
    const failed = refusal('CreateDBCluster');
    vi.mocked(api.createCluster).mockRejectedValueOnce(failed);
    await expect(result.current(CLUSTER, signal)).rejects.toBe(failed);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('after a create is answered and its form left, no cached read and no retained mutation of the app holds the password', async () => {
    vi.mocked(api.createInstance).mockResolvedValueOnce('app-db');
    vi.mocked(api.createCluster).mockRejectedValueOnce(refusal('CreateDBCluster'));
    const instance = renderHook(() => useCreateInstance(ENDPOINT), { wrapper });
    const cluster = renderHook(() => useCreateCluster(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;
    await instance.result.current(INSTANCE, signal);
    await cluster.result.current(CLUSTER, signal).catch(() => undefined);
    instance.unmount();
    cluster.unmount();

    expect(client.getMutationCache().getAll()).toEqual([]);
    const held = client
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify({ key: query.queryKey, data: query.state.data ?? null }));
    expect(held.join('\n')).not.toContain(PASSWORD);
  });
});
