import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import * as api from './api';
import {
  changedKeys,
  readAgainAfter,
  useAppliedRouteTable,
  useDnsSetting,
  useGatewayListing,
  useRouteTableListing,
  useSubnetListing,
  useVpc,
  useVpcListing,
  VPC_KEYS,
  type VpcChange,
} from './queries';

// The hooks over `api.ts`, whose calls the case answers (`api.test.ts` proves the calls).

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return {
    ...real,
    listVpcs: vi.fn(),
    listSubnets: vi.fn(),
    listRouteTables: vi.fn(),
    listInternetGateways: vi.fn(),
    getVpc: vi.fn(),
    getDnsSetting: vi.fn(),
    getSubnet: vi.fn(),
    getRouteTable: vi.fn(),
    getInternetGateway: vi.fn(),
  };
});

notifyManager.setScheduler((callback) => queueMicrotask(callback));

const ENDPOINT = 'http://127.0.0.1:9931';

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

const VPC: api.Vpc = { id: 'vpc-1', state: 'available', cidrs: [], isDefault: false, tags: [] };
const table = (id: string, main = false): api.RouteTable => ({
  id,
  vpcId: 'vpc-1',
  main,
  routes: [],
  associations: [],
  subnetCount: 0,
  tags: [],
});

describe('the four listings', () => {
  const listings = [
    ['VPCs', api.listVpcs, (name: string) => useVpcListing(ENDPOINT, name)],
    ['subnets', api.listSubnets, (name: string) => useSubnetListing(ENDPOINT, { name })],
    ['route tables', api.listRouteTables, (name: string) => useRouteTableListing(ENDPOINT, { name })],
    ['internet gateways', api.listInternetGateways, (name: string) => useGatewayListing(ENDPOINT, { name })],
  ] as const;
  for (const [what, list, use] of listings) {
    it(`${what}: by token; a changed name asks the first page again with the new filter`, async () => {
      const mocked = vi.mocked(list as (...args: unknown[]) => Promise<api.Page<{ id: string }>>);
      mocked.mockImplementation((_at, _filters, token) =>
        Promise.resolve(token === undefined ? { items: [{ id: 'a' }], nextToken: 't-2' } : { items: [{ id: 'b' }] }),
      );
      const hook = renderHook(({ name }) => use(name), { wrapper, initialProps: { name: '' } });
      await waitFor(() => {
        expect(hook.result.current.items).toEqual([{ id: 'a' }]);
      });
      expect(mocked.mock.calls[0]?.slice(0, 3)).toEqual([ENDPOINT, {}, undefined]);
      act(() => {
        hook.result.current.goToPage(2);
      });
      await waitFor(() => {
        expect(hook.result.current.items).toEqual([{ id: 'b' }]);
      });
      expect(mocked.mock.lastCall?.slice(1, 3)).toEqual([{}, 't-2']);

      hook.rerender({ name: 'web' });
      await waitFor(() => {
        expect(hook.result.current.currentPage).toBe(1);
        expect(hook.result.current.items).toEqual([{ id: 'a' }]);
      });
      expect(mocked.mock.lastCall?.slice(1, 3)).toEqual([{ name: 'web' }, undefined]);
    });
  }

  it('a section of S3 is narrowed by its VPC', async () => {
    vi.mocked(api.listSubnets).mockResolvedValue({ items: [] });
    renderHook(() => useSubnetListing(ENDPOINT, { name: '', vpcId: 'vpc-1' }), { wrapper });
    await waitFor(() => {
      expect(vi.mocked(api.listSubnets).mock.calls[0]?.[1]).toEqual({ vpcId: 'vpc-1' });
    });
  });
});

describe('the keys', () => {
  it('two reads of different resources, ids, filters or tokens differ', () => {
    const keys = [
      VPC_KEYS.vpcs(''),
      VPC_KEYS.vpcs('web'),
      VPC_KEYS.vpc('vpc-1'),
      VPC_KEYS.vpc('vpc-2'),
      VPC_KEYS.vpc('vpc-1', 'dns', 'enableDnsSupport'),
      VPC_KEYS.vpc('vpc-1', 'dns', 'enableDnsHostnames'),
      VPC_KEYS.subnets(null, ''),
      VPC_KEYS.subnets('vpc-1', ''),
      VPC_KEYS.subnet('subnet-1'),
      VPC_KEYS.routeTables(null, ''),
      VPC_KEYS.routeTables('of-subnet', 'subnet-1', 'vpc-1'),
      VPC_KEYS.routeTable('rtb-1'),
      VPC_KEYS.gateways(null, ''),
      VPC_KEYS.gateway('igw-1'),
      VPC_KEYS.choices('vpcs'),
      VPC_KEYS.choices('subnets', 'vpc-1'),
      VPC_KEYS.choices('subnets', 'vpc-2'),
    ].map((key) => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('the route table of a subnet', () => {
  it('the table of its own association when that read answers one; the second read is not asked', async () => {
    vi.mocked(api.listRouteTables).mockResolvedValue({ items: [table('rtb-own')] });
    const hook = renderHook(() => useAppliedRouteTable(ENDPOINT, 'subnet-1', 'vpc-1'), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.value).toEqual({ table: table('rtb-own'), how: 'associated' });
    });
    expect(vi.mocked(api.listRouteTables).mock.calls.map((call) => call[1])).toEqual([{ subnetId: 'subnet-1' }]);
  });

  it("none → the main table of the subnet's VPC, marked as the main one", async () => {
    vi.mocked(api.listRouteTables).mockImplementation((_at, filters) =>
      Promise.resolve(filters.main === true ? { items: [table('rtb-main', true)] } : { items: [] }),
    );
    const hook = renderHook(() => useAppliedRouteTable(ENDPOINT, 'subnet-1', 'vpc-1'), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.value).toEqual({ table: table('rtb-main', true), how: 'main' });
    });
    expect(vi.mocked(api.listRouteTables).mock.calls.map((call) => call[1])).toEqual([
      { subnetId: 'subnet-1' },
      { vpcId: 'vpc-1', main: true },
    ]);
  });

  it('both answer none → none', async () => {
    vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
    const hook = renderHook(() => useAppliedRouteTable(ENDPOINT, 'subnet-1', 'vpc-1'), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.loading).toBe(false);
    });
    expect(hook.result.current.value).toBeNull();
    expect(hook.result.current.failure).toBeUndefined();
  });

  it('loading until the read that decides has answered', async () => {
    const pending: ((page: api.Page<api.RouteTable>) => void)[] = [];
    vi.mocked(api.listRouteTables).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const hook = renderHook(() => useAppliedRouteTable(ENDPOINT, 'subnet-1', 'vpc-1'), { wrapper });
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    expect(hook.result.current.loading).toBe(true);
    act(() => {
      pending[0]?.({ items: [] });
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.value).toBeUndefined();
    act(() => {
      pending[1]?.({ items: [table('rtb-main', true)] });
    });
    await waitFor(() => {
      expect(hook.result.current.loading).toBe(false);
    });
    expect(hook.result.current.value).toEqual({ table: table('rtb-main', true), how: 'main' });
  });
});

describe("a VPC's DNS settings", () => {
  it("a failed read of one setting leaves the VPC's read and the other setting as they are", async () => {
    vi.mocked(api.getVpc).mockResolvedValue({ found: true, value: VPC });
    vi.mocked(api.getDnsSetting).mockImplementation((_at, _id, setting) =>
      setting === 'enableDnsSupport'
        ? Promise.reject(
            new RequestError({ kind: 'other', operation: 'DescribeVpcAttribute', code: 'X', message: 'no' }),
          )
        : Promise.resolve(true),
    );
    const hook = renderHook(
      () => ({
        vpc: useVpc(ENDPOINT, 'vpc-1'),
        support: useDnsSetting(ENDPOINT, 'vpc-1', 'enableDnsSupport'),
        hostnames: useDnsSetting(ENDPOINT, 'vpc-1', 'enableDnsHostnames'),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(hook.result.current.support.failure).toBeDefined();
      expect(hook.result.current.hostnames.value).toBe(true);
      expect(hook.result.current.vpc.value).toEqual({ found: true, value: VPC });
    });
    expect(hook.result.current.support.failure).toEqual({
      kind: 'other',
      operation: 'DescribeVpcAttribute',
      code: 'X',
      message: 'no',
    });
    expect(hook.result.current.vpc.failure).toBeUndefined();
    expect(hook.result.current.hostnames.failure).toBeUndefined();
  });
});

describe('what each change reads again', () => {
  const key = (value: readonly unknown[]) => JSON.stringify(value);
  const cases: [VpcChange, (readonly unknown[])[]][] = [
    [
      { kind: 'vpc', id: 'vpc-1' },
      [VPC_KEYS.vpcs(), VPC_KEYS.vpc('vpc-1'), VPC_KEYS.choices('vpcs'), VPC_KEYS.routeTables()],
    ],
    [
      { kind: 'subnet', id: 'subnet-1' },
      [VPC_KEYS.subnets(), VPC_KEYS.subnet('subnet-1'), VPC_KEYS.choices('subnets')],
    ],
    [
      { kind: 'subnet', id: 'subnet-1', deleted: true },
      [VPC_KEYS.subnets(), VPC_KEYS.subnet('subnet-1'), VPC_KEYS.choices('subnets'), VPC_KEYS.routeTables()],
    ],
    [{ kind: 'subnet-addresses', id: 'subnet-1' }, [VPC_KEYS.subnet('subnet-1'), VPC_KEYS.subnets()]],
    [{ kind: 'route-table', id: 'rtb-1' }, [VPC_KEYS.routeTables(), VPC_KEYS.routeTable('rtb-1')]],
    [{ kind: 'gateway', id: 'igw-1' }, [VPC_KEYS.gateways(), VPC_KEYS.gateway('igw-1')]],
    [
      { kind: 'gateway', id: 'igw-1', detached: true },
      [VPC_KEYS.gateways(), VPC_KEYS.gateway('igw-1'), VPC_KEYS.routeTables(), VPC_KEYS.routeTable()],
    ],
  ];
  for (const [change, expected] of cases) {
    it(`${JSON.stringify(change)} → the design's reads`, () => {
      expect(changedKeys(change).map(key).sort()).toEqual(expected.map(key).sort());
      const spy = vi.spyOn(client, 'invalidateQueries');
      readAgainAfter(client, change);
      expect(spy.mock.calls.map(([filters]) => key(filters?.queryKey ?? [])).sort()).toEqual(expected.map(key).sort());
    });
  }

  it('after a create or delete of a VPC the VPC lists, that VPC, the VPC choices and the route table lists are asked again', async () => {
    vi.mocked(api.listVpcs).mockResolvedValue({ items: [VPC] });
    vi.mocked(api.getVpc).mockResolvedValue({ found: true, value: VPC });
    vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
    vi.mocked(api.getSubnet).mockResolvedValue({ found: false });
    const hook = renderHook(
      () => ({
        list: useVpcListing(ENDPOINT, ''),
        vpc: useVpc(ENDPOINT, 'vpc-1'),
        tables: useRouteTableListing(ENDPOINT, { name: '' }),
        other: useSubnetListing(ENDPOINT, { name: '' }),
      }),
      { wrapper },
    );
    vi.mocked(api.listSubnets).mockResolvedValue({ items: [] });
    await waitFor(() => {
      expect(hook.result.current.list.items).toBeDefined();
      expect(hook.result.current.vpc.value).toBeDefined();
      expect(hook.result.current.tables.items).toBeDefined();
    });
    const subnetsBefore = vi.mocked(api.listSubnets).mock.calls.length;
    readAgainAfter(client, { kind: 'vpc', id: 'vpc-1' });
    await waitFor(() => {
      expect(vi.mocked(api.listVpcs)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.getVpc)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.listRouteTables)).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(api.listSubnets).mock.calls.length).toBe(subnetsBefore);
  });

  it('after an association or a disassociation the route table that applies to a subnet is asked again too', async () => {
    vi.mocked(api.listRouteTables).mockResolvedValue({ items: [table('rtb-own')] });
    renderHook(() => useAppliedRouteTable(ENDPOINT, 'subnet-1', 'vpc-1'), { wrapper });
    await waitFor(() => {
      expect(vi.mocked(api.listRouteTables)).toHaveBeenCalledTimes(1);
    });
    readAgainAfter(client, { kind: 'route-table', id: 'rtb-own' });
    await waitFor(() => {
      expect(vi.mocked(api.listRouteTables)).toHaveBeenCalledTimes(2);
    });
  });
});

describe('a late answer', () => {
  it('a read asked earlier that answers after a newer one of the same key is not shown', async () => {
    const pending: ((read: api.Read<api.Vpc>) => void)[] = [];
    vi.mocked(api.getVpc).mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const hook = renderHook(() => useVpc(ENDPOINT, 'vpc-1'), { wrapper });
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    act(() => {
      pending[0]?.({ found: true, value: VPC });
    });
    await waitFor(() => {
      expect(hook.result.current.value).toEqual({ found: true, value: VPC });
    });
    readAgainAfter(client, { kind: 'vpc', id: 'vpc-1' });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    readAgainAfter(client, { kind: 'vpc', id: 'vpc-1' });
    await waitFor(() => {
      expect(pending).toHaveLength(3);
    });
    const newer: api.Vpc = { ...VPC, state: 'newer' };
    act(() => {
      pending[2]?.({ found: true, value: newer });
    });
    await waitFor(() => {
      expect(hook.result.current.value).toEqual({ found: true, value: newer });
    });
    act(() => {
      pending[1]?.({ found: true, value: { ...VPC, state: 'older' } });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(hook.result.current.value).toEqual({ found: true, value: newer });
  });
});
