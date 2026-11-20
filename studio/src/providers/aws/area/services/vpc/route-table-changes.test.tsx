import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { VPC_KEYS } from './queries';
import * as api from './route-table-changes-api';
import { useCreateRouteTable, useDeleteRouteTable } from './route-table-changes';

// The mutations over `vpc-changes-api.ts`, whose calls the case answers (`vpc-changes-api.test.ts` proves the calls).

vi.mock('./route-table-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./route-table-changes-api')>();
  return { ...real, createRouteTable: vi.fn(), deleteRouteTable: vi.fn() };
});

const ENDPOINT = 'http://127.0.0.1:9941';
const key = (value: readonly unknown[] | undefined) => JSON.stringify(value ?? []);
const EXPECTED = [VPC_KEYS.routeTables(), VPC_KEYS.routeTable('rtb-1')].map(key).sort();

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

describe("a route table's changes", () => {
  it('after a create succeeds → the route table lists (every filter) and that table are asked again', async () => {
    vi.mocked(api.createRouteTable).mockResolvedValue('rtb-1');
    const spy = vi.spyOn(client, 'invalidateQueries');
    const create = renderHook(() => useCreateRouteTable(ENDPOINT), { wrapper }).result.current;
    expect(await create({ vpcId: 'vpc-1' }, signal())).toBe('rtb-1');
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after a delete succeeds → the same reads are asked again', async () => {
    vi.mocked(api.deleteRouteTable).mockResolvedValue(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const remove = renderHook(() => useDeleteRouteTable(ENDPOINT), { wrapper }).result.current;
    await remove('rtb-1', signal());
    expect(vi.mocked(api.deleteRouteTable).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, 'rtb-1']);
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after one fails → none is', async () => {
    vi.mocked(api.createRouteTable).mockRejectedValue(refusal);
    vi.mocked(api.deleteRouteTable).mockRejectedValue(refusal);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const hooks = renderHook(() => ({ create: useCreateRouteTable(ENDPOINT), remove: useDeleteRouteTable(ENDPOINT) }), {
      wrapper,
    });
    await expect(hooks.result.current.create({ vpcId: 'vpc-1' }, signal())).rejects.toBe(refusal);
    await expect(hooks.result.current.remove('rtb-1', signal())).rejects.toBe(refusal);
    expect(spy).not.toHaveBeenCalled();
  });
});
