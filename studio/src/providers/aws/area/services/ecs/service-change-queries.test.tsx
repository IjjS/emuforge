import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { ECS_KEYS } from './queries';
import * as api from './service-change-api';
import { useDeleteService, useUpdateService } from './service-change-queries';
import { serviceKey } from './service-queries';
import { tasksKey } from './task-queries';

// The hooks over `service-change-api.ts`, whose calls the case answers (`service-change-api.test.ts` proves them).

vi.mock('./service-change-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./service-change-api')>();
  return { ...real, updateService: vi.fn(), deleteService: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9996';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SERVICE = [...serviceKey('dev', 'api'), ENDPOINT, 1, 0];
const SERVICE_TASKS = [...tasksKey('dev', { desiredStatus: 'RUNNING', service: 'api' }), 'token'];
const SERVICE_STOPPED = [...tasksKey('dev', { desiredStatus: 'STOPPED', service: 'api' })];
const CLUSTER_TASKS = [...tasksKey('dev', { desiredStatus: 'RUNNING' })];
const A_TASK = ECS_KEYS.clusterTasks('dev', 'task', 'abc');
const SERVICES = [...ECS_KEYS.clusterServices('dev', 'list'), null];
const OTHER_SERVICE = [...serviceKey('dev', 'web'), ENDPOINT, 1, 0];
const CLUSTER = [...ECS_KEYS.cluster('dev'), ENDPOINT, 1, 0];
const OTHER_CLUSTER = [...ECS_KEYS.cluster('other'), ENDPOINT, 1, 0];
const OTHER_TASKS = [...tasksKey('other', { desiredStatus: 'RUNNING' })];
const CLUSTERS = [...ECS_KEYS.clusters(), ENDPOINT];

const HELD = [
  SERVICE,
  SERVICE_TASKS,
  SERVICE_STOPPED,
  CLUSTER_TASKS,
  A_TASK,
  SERVICES,
  OTHER_SERVICE,
  CLUSTER,
  OTHER_CLUSTER,
  OTHER_TASKS,
  CLUSTERS,
];

function hold() {
  for (const key of HELD) {
    client.setQueryData(key, 'held');
  }
}

function stale(): string[] {
  return client
    .getQueryCache()
    .getAll()
    .filter((query) => query.isStale())
    .map((query) => JSON.stringify(query.queryKey))
    .sort();
}

const keys = (...list: unknown[][]) => list.map((key) => JSON.stringify(key)).sort();

const REFUSAL = new RequestError({ kind: 'other', operation: 'UpdateService', code: 'InvalidParameterException' });

describe('the changes of a service', () => {
  it("a successful update invalidates the service and its tasks; a successful delete the cluster's services, the root of the cluster's tasks and the cluster; a refused one nothing", async () => {
    // A successful update.
    hold();
    vi.mocked(api.updateService).mockResolvedValueOnce(undefined);
    const update = renderHook(() => useUpdateService(ENDPOINT, 'dev'), { wrapper }).result.current;
    await update('api', { desiredCount: 2 }, new AbortController().signal);
    expect(api.updateService).toHaveBeenCalledWith(ENDPOINT, 'dev', 'api', { desiredCount: 2 }, expect.anything());
    expect(stale()).toEqual(keys(SERVICE, SERVICE_TASKS, SERVICE_STOPPED));

    // A successful delete.
    client.clear();
    hold();
    vi.mocked(api.deleteService).mockResolvedValueOnce(undefined);
    const remove = renderHook(() => useDeleteService(ENDPOINT, 'dev'), { wrapper }).result.current;
    await remove('api', new AbortController().signal);
    expect(api.deleteService).toHaveBeenCalledWith(ENDPOINT, 'dev', 'api', expect.anything());
    expect(stale()).toEqual(
      keys(SERVICE, SERVICE_TASKS, SERVICE_STOPPED, CLUSTER_TASKS, A_TASK, SERVICES, OTHER_SERVICE, CLUSTER),
    );

    // Refused ones.
    client.clear();
    hold();
    vi.mocked(api.updateService).mockRejectedValueOnce(REFUSAL);
    vi.mocked(api.deleteService).mockRejectedValueOnce(REFUSAL);
    const update2 = renderHook(() => useUpdateService(ENDPOINT, 'dev'), { wrapper }).result.current;
    const remove2 = renderHook(() => useDeleteService(ENDPOINT, 'dev'), { wrapper }).result.current;
    await expect(update2('api', { desiredCount: 2 }, new AbortController().signal)).rejects.toBe(REFUSAL);
    await expect(remove2('api', new AbortController().signal)).rejects.toBe(REFUSAL);
    expect(stale()).toEqual([]);
  });
});
