import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { VPC_KEYS } from './queries';
import * as api from './vpc-changes-api';
import { useCreateVpc, useDeleteVpc } from './vpc-changes';

// The mutations over `vpc-changes-api.ts`, whose calls the case answers (`vpc-changes-api.test.ts` proves the calls).

vi.mock('./vpc-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./vpc-changes-api')>();
  return { ...real, createVpc: vi.fn(), deleteVpc: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9941';
const key = (value: readonly unknown[] | undefined) => JSON.stringify(value ?? []);
const EXPECTED = [VPC_KEYS.vpcs(), VPC_KEYS.vpc('vpc-1'), VPC_KEYS.choices('vpcs'), VPC_KEYS.routeTables()]
  .map(key)
  .sort();

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

describe("a VPC's changes", () => {
  it('after a create succeeds → the VPC lists, that VPC, the VPC choices and the route table lists are asked again', async () => {
    vi.mocked(api.createVpc).mockResolvedValue('vpc-1');
    const spy = vi.spyOn(client, 'invalidateQueries');
    const create = renderHook(() => useCreateVpc(ENDPOINT), { wrapper }).result.current;
    expect(await create({ cidr: '10.0.0.0/16' }, signal())).toBe('vpc-1');
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after a delete succeeds → the same reads are asked again', async () => {
    vi.mocked(api.deleteVpc).mockResolvedValue(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const remove = renderHook(() => useDeleteVpc(ENDPOINT), { wrapper }).result.current;
    await remove('vpc-1', signal());
    expect(vi.mocked(api.deleteVpc).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, 'vpc-1']);
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after one fails → none is', async () => {
    vi.mocked(api.createVpc).mockRejectedValue(refusal);
    vi.mocked(api.deleteVpc).mockRejectedValue(refusal);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const hooks = renderHook(() => ({ create: useCreateVpc(ENDPOINT), remove: useDeleteVpc(ENDPOINT) }), { wrapper });
    await expect(hooks.result.current.create({ cidr: '10.0.0.0/16' }, signal())).rejects.toBe(refusal);
    await expect(hooks.result.current.remove('vpc-1', signal())).rejects.toBe(refusal);
    expect(spy).not.toHaveBeenCalled();
  });
});
