import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { VPC_KEYS } from './queries';
import * as api from './route-changes-api';
import { useAddRoute, useAssociateSubnet, useDeleteRoute, useDisassociateSubnet } from './route-changes';

// The mutations over `route-changes-api.ts`, whose calls the case answers (`route-changes-api.test.ts` proves the calls).

vi.mock('./route-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./route-changes-api')>();
  return {
    ...real,
    createRoute: vi.fn(),
    deleteRoute: vi.fn(),
    associateSubnet: vi.fn(),
    disassociateSubnet: vi.fn(),
  };
});

const ENDPOINT = 'http://127.0.0.1:9961';
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
const refusal = new RequestError({ kind: 'other', operation: 'X', code: 'RouteAlreadyExists', message: 'exists' });

function hooks() {
  return renderHook(
    () => ({
      add: useAddRoute(ENDPOINT),
      remove: useDeleteRoute(ENDPOINT),
      associate: useAssociateSubnet(ENDPOINT),
      disassociate: useDisassociateSubnet(ENDPOINT),
    }),
    { wrapper },
  ).result.current;
}

describe("a route table's routes and associations", () => {
  it('after a route is added → the route table lists (every filter) and that table are asked again', async () => {
    vi.mocked(api.createRoute).mockResolvedValue(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const route = { routeTableId: 'rtb-1', destination: '0.0.0.0/0', gatewayId: 'igw-1' };
    await hooks().add(route, signal());
    expect(vi.mocked(api.createRoute).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, route]);
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after a route is deleted → the same reads are asked again', async () => {
    vi.mocked(api.deleteRoute).mockResolvedValue(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');
    await hooks().remove('rtb-1', '0.0.0.0/0', signal());
    expect(vi.mocked(api.deleteRoute).mock.calls[0]?.slice(0, 3)).toEqual([ENDPOINT, 'rtb-1', '0.0.0.0/0']);
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after a subnet is associated → the same reads are asked again', async () => {
    vi.mocked(api.associateSubnet).mockResolvedValue('rtbassoc-1');
    const spy = vi.spyOn(client, 'invalidateQueries');
    expect(await hooks().associate('rtb-1', 'subnet-1', signal())).toBe('rtbassoc-1');
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after a subnet is disassociated → the same reads are asked again', async () => {
    vi.mocked(api.disassociateSubnet).mockResolvedValue(undefined);
    const spy = vi.spyOn(client, 'invalidateQueries');
    await hooks().disassociate('rtb-1', 'rtbassoc-1', signal());
    expect(vi.mocked(api.disassociateSubnet).mock.calls[0]?.slice(0, 2)).toEqual([ENDPOINT, 'rtbassoc-1']);
    expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey)).sort()).toEqual(EXPECTED);
  });

  it('after one fails → none is', async () => {
    vi.mocked(api.createRoute).mockRejectedValue(refusal);
    vi.mocked(api.deleteRoute).mockRejectedValue(refusal);
    vi.mocked(api.associateSubnet).mockRejectedValue(refusal);
    vi.mocked(api.disassociateSubnet).mockRejectedValue(refusal);
    const spy = vi.spyOn(client, 'invalidateQueries');
    const current = hooks();
    await expect(
      current.add({ routeTableId: 'rtb-1', destination: '0.0.0.0/0', gatewayId: 'igw-1' }, signal()),
    ).rejects.toBe(refusal);
    await expect(current.remove('rtb-1', '0.0.0.0/0', signal())).rejects.toBe(refusal);
    await expect(current.associate('rtb-1', 'subnet-1', signal())).rejects.toBe(refusal);
    await expect(current.disassociate('rtb-1', 'rtbassoc-1', signal())).rejects.toBe(refusal);
    expect(spy).not.toHaveBeenCalled();
  });
});
