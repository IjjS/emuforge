import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as groupsArea from '../../components/security-group-choices';
import type { SecurityGroupChoice } from '../../components/security-group-choices';
import type { ChoiceSource } from '../../components/use-paged-choices';
import * as network from '../../lib/ec2-network-choices';
import { ECS_KEYS } from './queries';
import * as api from './run-api';
import type { RunRequest } from './run-form';
import { runGroupChoices, runSubnetChoices, useHasChoices, useRunTask } from './run-queries';

// The hooks over `run-api.ts`, whose call the case answers (`run-api.test.ts` proves the call), and the choices over
// the area's `lib/ec2-network-choices.ts` and `components/security-group-choices.ts`, whose calls are spied on.

vi.mock('./run-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./run-api')>();
  return { ...real, runTask: vi.fn() };
});

vi.mock('../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/ec2-network-choices')>();
  return { ...real, listSubnetChoices: vi.fn() };
});

vi.mock('../../components/security-group-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/security-group-choices')>();
  return { ...real, securityGroupChoices: vi.fn(real.securityGroupChoices) };
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
  it('the subnets → listSubnetChoices with the chosen VPC; each option its id, described by its VPC and zone', async () => {
    vi.mocked(network.listSubnetChoices).mockResolvedValueOnce({
      choices: [
        { id: 'subnet-a', vpcId: 'vpc-1', zone: 'us-east-1a', cidr: '10.0.0.0/24', name: 'a' },
        { id: 'subnet-b' },
      ],
      nextToken: 'more',
    });
    const source = runSubnetChoices(ENDPOINT, 'vpc-1');
    const signal = new AbortController().signal;
    const page = await source.read(ENDPOINT, '', 'token', signal);
    expect(network.listSubnetChoices).toHaveBeenCalledWith(ENDPOINT, 'token', signal, 'vpc-1');
    expect(source.operation).toBe('DescribeSubnets');
    expect(source.filtering).toBe('none');
    expect(page.next).toBe('more');
    expect(page.items.map((subnet) => source.optionOf(subnet))).toEqual([
      { value: 'subnet-a', label: 'subnet-a', description: 'vpc-1, us-east-1a' },
      { value: 'subnet-b', label: 'subnet-b' },
    ]);
    expect(under([...source.key], ECS_KEYS.cluster('dev'))).toBe(false);
    expect(runSubnetChoices(ENDPOINT, 'vpc-2').key).not.toEqual(source.key);
  });

  it("the security groups → the area's securityGroupChoices of the chosen VPC; with none given not ready", () => {
    const groups = runGroupChoices(ENDPOINT, 'vpc-1');
    expect(groupsArea.securityGroupChoices).toHaveBeenCalledWith(ENDPOINT, 'vpc-1');
    expect(groups.ready).toBe(true);
    expect(groups.key).toEqual(groupsArea.securityGroupChoicesKey('vpc-1'));
    expect(groups.optionOf({ id: 'sg-1', name: 'web', vpcId: 'vpc-1' }).value).toBe('sg-1');

    expect(runGroupChoices(ENDPOINT, undefined).ready).toBe(false);
    expect(runGroupChoices(ENDPOINT, '').ready).toBe(false);
  });

  it('the security groups with no VPC given → nothing is asked', async () => {
    const read = vi.fn<ChoiceSource<SecurityGroupChoice>['read']>();
    const { result } = renderHook(() => useHasChoices({ ...runGroupChoices(ENDPOINT, undefined), read }), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
