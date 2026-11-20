import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as network from '../../components/network-choices';
import { sendEc2 } from './api';
import { ECS_KEYS } from './queries';
import * as api from './run-api';
import type { RunRequest } from './run-form';
import { runGroupChoices, runSubnetChoices, useRunTask } from './run-queries';

// The hooks over `run-api.ts`, whose call the case answers (`run-api.test.ts` proves the call), and the choices over
// the area's `network-choices.ts`, whose calls are spied on.

vi.mock('./run-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./run-api')>();
  return { ...real, runTask: vi.fn() };
});

vi.mock('../../components/network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/network-choices')>();
  return { ...real, subnetChoices: vi.fn(real.subnetChoices), groupChoices: vi.fn(real.groupChoices) };
});

const ENDPOINT = 'http://127.0.0.1:9997';
const REQUEST: RunRequest = {
  cluster: 'dev',
  taskDefinition: 'web:1',
  count: 2,
  launchType: 'FARGATE',
  networkConfiguration: { awsvpcConfiguration: { subnets: ['subnet-a'], assignPublicIp: 'ENABLED' } },
};

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Whether `key` starts with `root`. */
function under(key: readonly unknown[], root: readonly unknown[]): boolean {
  return root.length <= key.length && root.every((part, index) => key[index] === part);
}

/** Holds a read under each of `keys`, as the screens would. */
function hold(...keys: unknown[][]) {
  for (const key of keys) {
    client.setQueryData(key, 'held');
  }
}

const HELD = [
  [...ECS_KEYS.cluster('dev'), ENDPOINT, 1, 0],
  [...ECS_KEYS.clusterTasks('dev'), 'RUNNING', null],
  [...ECS_KEYS.clusterTasks('dev'), 'task', 'abc'],
  [...ECS_KEYS.clusters(), ENDPOINT],
  [...ECS_KEYS.cluster('other'), ENDPOINT, 1, 0],
  [...ECS_KEYS.clusterTasks('other'), 'RUNNING', null],
];

function stale(): unknown[][] {
  return client
    .getQueryCache()
    .getAll()
    .filter((query) => query.isStale())
    .map((query) => [...query.queryKey]);
}

describe('useRunTask', () => {
  it("an answer that started a task → the cluster's read and its tasks' reads are invalidated; nothing else", async () => {
    hold(...HELD);
    vi.mocked(api.runTask).mockResolvedValueOnce({ taskIds: ['t1'], failures: [] });
    const { result } = renderHook(() => useRunTask(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;
    await expect(result.current(REQUEST, signal)).resolves.toEqual({ taskIds: ['t1'], failures: [] });
    expect(api.runTask).toHaveBeenCalledWith(ENDPOINT, REQUEST, signal);
    const invalidated = stale();
    expect(invalidated).toHaveLength(3);
    for (const key of invalidated) {
      expect(under(key, ECS_KEYS.cluster('dev')) || under(key, ECS_KEYS.clusterTasks('dev'))).toBe(true);
    }
  });

  it('a refusal, and an answer that started no task → nothing is invalidated', async () => {
    hold(...HELD);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRunTask(ENDPOINT), { wrapper });
    const signal = new AbortController().signal;

    vi.mocked(api.runTask).mockResolvedValueOnce({ taskIds: [], failures: ['RESOURCE:ENI'] });
    await result.current(REQUEST, signal);
    const refusal = new RequestError({ kind: 'other', operation: 'RunTask', code: 'ClientException', message: 'no' });
    vi.mocked(api.runTask).mockRejectedValueOnce(refusal);
    await expect(result.current(REQUEST, signal)).rejects.toBe(refusal);

    expect(invalidate).not.toHaveBeenCalled();
    expect(stale()).toEqual([]);
  });
});

describe('the network choices', () => {
  it("subnets and security groups → read through the area's network-choices.ts with api.ts's sendEc2", () => {
    const subnets = runSubnetChoices(ENDPOINT, 'vpc-1');
    const groups = runGroupChoices(ENDPOINT, 'vpc-1');
    expect(network.subnetChoices).toHaveBeenCalledWith(sendEc2, expect.any(Array), ENDPOINT, 'vpc-1');
    expect(network.groupChoices).toHaveBeenCalledWith(sendEc2, expect.any(Array), ENDPOINT, 'vpc-1');
    expect(subnets.operation).toBe('DescribeSubnets');
    expect(groups.operation).toBe('DescribeSecurityGroups');
    expect(under([...subnets.key], ECS_KEYS.cluster('dev'))).toBe(false);
  });
});
