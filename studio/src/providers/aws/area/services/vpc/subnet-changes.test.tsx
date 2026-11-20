import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { VPC_KEYS } from './queries';
import { useCreateSubnet, useDeleteSubnet, useSetPublicAddresses } from './subnet-changes';
import * as api from './subnet-changes-api';

// The mutations over `subnet-changes-api.ts`, whose calls the case answers (`subnet-changes-api.test.ts` proves them).

vi.mock('./subnet-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./subnet-changes-api')>();
  return { ...real, createSubnet: vi.fn(), deleteSubnet: vi.fn(), setPublicAddresses: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9961';
const key = (value: readonly unknown[] | undefined) => JSON.stringify(value ?? []);
const sorted = (keys: (readonly unknown[])[]) => keys.map(key).sort();

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const signal = () => new AbortController().signal;
const refusal = new RequestError({ kind: 'other', operation: 'X', code: 'DependencyViolation', message: 'in use' });

describe("a subnet's changes", () => {
  it('after a create succeeds → the subnet lists, that subnet and the subnet choices are asked again', async () => {
    vi.mocked(api.createSubnet).mockResolvedValue('subnet-1');
    const spy = vi.spyOn(client, 'invalidateQueries');
    const create = renderHook(() => useCreateSubnet(ENDPOINT), { wrapper }).result.current;
    expect(await create({ vpcId: 'vpc-1', cidr: '10.0.1.0/24' }, signal())).toBe('subnet-1');
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(
      sorted([VPC_KEYS.subnets(), VPC_KEYS.subnet('subnet-1'), VPC_KEYS.choices('subnets')]),
    );
  });

  it('after a change of the public addresses succeeds → that subnet and the subnet lists', async () => {
    vi.mocked(api.setPublicAddresses).mockResolvedValue(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const change = renderHook(() => useSetPublicAddresses(ENDPOINT), { wrapper }).result.current;
    await change('subnet-1', true, signal());
    expect(vi.mocked(api.setPublicAddresses).mock.calls[0]?.slice(0, 3)).toEqual([ENDPOINT, 'subnet-1', true]);
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(
      sorted([VPC_KEYS.subnet('subnet-1'), VPC_KEYS.subnets()]),
    );
  });

  it('after a delete succeeds → the subnet lists, that subnet, the subnet choices and the route tables', async () => {
    vi.mocked(api.deleteSubnet).mockResolvedValue(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const remove = renderHook(() => useDeleteSubnet(ENDPOINT), { wrapper }).result.current;
    await remove('subnet-1', signal());
    expect(vi.mocked(api.deleteSubnet).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, 'subnet-1']);
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(
      sorted([VPC_KEYS.subnets(), VPC_KEYS.subnet('subnet-1'), VPC_KEYS.choices('subnets'), VPC_KEYS.routeTables()]),
    );
  });

  it('after one fails → none is', async () => {
    vi.mocked(api.createSubnet).mockRejectedValue(refusal);
    vi.mocked(api.setPublicAddresses).mockRejectedValue(refusal);
    vi.mocked(api.deleteSubnet).mockRejectedValue(refusal);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const hooks = renderHook(
      () => ({
        create: useCreateSubnet(ENDPOINT),
        change: useSetPublicAddresses(ENDPOINT),
        remove: useDeleteSubnet(ENDPOINT),
      }),
      { wrapper },
    );
    await expect(hooks.result.current.create({ vpcId: 'vpc-1', cidr: '10.0.1.0/24' }, signal())).rejects.toBe(refusal);
    await expect(hooks.result.current.change('subnet-1', false, signal())).rejects.toBe(refusal);
    await expect(hooks.result.current.remove('subnet-1', signal())).rejects.toBe(refusal);
    expect(spy).not.toHaveBeenCalled();
  });
});
