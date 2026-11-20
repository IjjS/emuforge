import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import {
  getDnsSetting,
  getInternetGateway,
  getRouteTable,
  getSubnet,
  getVpc,
  listInternetGateways,
  listRouteTables,
  listSubnets,
  listVpcs,
  READ_OPERATIONS,
  type DnsSetting,
  type InternetGateway,
  type ListFilters,
  type Page,
  type Read,
  type RouteTable,
  type Subnet,
  type Vpc,
} from './api';

// The TanStack Query hooks of VPC's reads and the query keys of every resource of VPC (issue 574, design "Where a
// result is shown"), so a change of one unit reads again what another unit shows. Every read is a request of its own
// on every mount, "Refresh" and "Retry", under a key that holds every filter and token; a read no longer wanted is
// aborted, and an answer of a read asked earlier, once a newer one of the same key is asked, is never shown.

/** The start of every key of VPC's reads. */
export const VPC_KEY = ['aws', 'vpc'] as const;

/**
 * The keys of VPC's reads, each a prefix of the reads it names: with its filters given, the key of one list; with
 * fewer, of every list of the resource it starts, which is what a change reads again.
 */
export const VPC_KEYS = {
  /** The VPC lists: by name. */
  vpcs: (...filters: unknown[]) => [...VPC_KEY, 'vpcs', ...filters],
  /** The reads of one VPC, its DNS settings included. */
  vpc: (id: string, ...parts: unknown[]) => [...VPC_KEY, 'vpc', id, ...parts],
  /** The subnet lists: by VPC, then by name. */
  subnets: (...filters: unknown[]) => [...VPC_KEY, 'subnets', ...filters],
  /** The reads of one subnet. */
  subnet: (id: string, ...parts: unknown[]) => [...VPC_KEY, 'subnet', id, ...parts],
  /** The route table lists: by VPC, then by name; and the route table that applies to a subnet. */
  routeTables: (...filters: unknown[]) => [...VPC_KEY, 'route-tables', ...filters],
  /** The reads of one route table; with no id, of every one. */
  routeTable: (id?: string, ...parts: unknown[]) =>
    id === undefined ? [...VPC_KEY, 'route-table'] : [...VPC_KEY, 'route-table', id, ...parts],
  /** The internet gateway lists: by VPC, then by name. */
  gateways: (...filters: unknown[]) => [...VPC_KEY, 'internet-gateways', ...filters],
  /** The reads of one internet gateway. */
  gateway: (id: string, ...parts: unknown[]) => [...VPC_KEY, 'internet-gateway', id, ...parts],
  /** A form's choices, by what they are of ("vpcs", "subnets") and filter. */
  choices: (of?: string, ...filters: unknown[]) =>
    of === undefined ? [...VPC_KEY, 'choices'] : [...VPC_KEY, 'choices', of, ...filters],
};

// ---------------------------------------------------------------------------------------------------------------
// The lists

function tokenPage<T>(page: Page<T>) {
  return page.nextToken === undefined ? { items: page.items } : { items: page.items, next: page.nextToken };
}

/** What a list is narrowed by on screen: the settled name text (`''` for none) and, for a section of S3, its VPC. */
export interface ListingFilters {
  name: string;
  vpcId?: string;
}

function sent({ name, vpcId }: ListingFilters): ListFilters {
  return { ...(name === '' ? {} : { name }), ...(vpcId === undefined ? {} : { vpcId }) };
}

/** S1: the VPCs, a page of `DescribeVpcs` at a time on its tokens; a changed name starts from page 1. */
export function useVpcListing(endpoint: string | undefined, name: string): TokenListing<Vpc> {
  return useTokenListing({
    key: VPC_KEYS.vpcs(name),
    endpoint,
    operation: READ_OPERATIONS.describeVpcs,
    read: async (at, token, signal) => tokenPage(await listVpcs(at, sent({ name }), token, signal)),
  });
}

/** S4 and S3's "Subnets": the subnets, of one VPC when it is given. */
export function useSubnetListing(endpoint: string | undefined, filters: ListingFilters): TokenListing<Subnet> {
  return useTokenListing({
    key: VPC_KEYS.subnets(filters.vpcId ?? null, filters.name),
    endpoint,
    operation: READ_OPERATIONS.describeSubnets,
    read: async (at, token, signal) => tokenPage(await listSubnets(at, sent(filters), token, signal)),
  });
}

/** S7 and S3's "Route tables": the route tables, of one VPC when it is given. */
export function useRouteTableListing(endpoint: string | undefined, filters: ListingFilters): TokenListing<RouteTable> {
  return useTokenListing({
    key: VPC_KEYS.routeTables(filters.vpcId ?? null, filters.name),
    endpoint,
    operation: READ_OPERATIONS.describeRouteTables,
    read: async (at, token, signal) => tokenPage(await listRouteTables(at, sent(filters), token, signal)),
  });
}

/** S12 and S3's "Internet gateway": the internet gateways, those attached to one VPC when it is given. */
export function useGatewayListing(
  endpoint: string | undefined,
  filters: ListingFilters,
): TokenListing<InternetGateway> {
  return useTokenListing({
    key: VPC_KEYS.gateways(filters.vpcId ?? null, filters.name),
    endpoint,
    operation: READ_OPERATIONS.describeInternetGateways,
    read: async (at, token, signal) => tokenPage(await listInternetGateways(at, sent(filters), token, signal)),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The reads of one resource

/** One read as a screen shows it. */
export interface VpcRead<T> {
  /** The answer of the current read; `undefined` while it is first in flight or when it failed. */
  value: T | undefined;
  /** Why the current read failed. */
  failure: RequestFailure | undefined;
  /** The read is in flight with nothing of it shown, or waits for the engine's address. */
  loading: boolean;
  /** Reads again, from nothing shown ("Refresh", "Retry"). */
  refresh: () => void;
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

interface ReadOptions<T> {
  key: readonly unknown[];
  endpoint: string | undefined;
  operation: string;
  read: (endpoint: string, signal: AbortSignal) => Promise<T>;
  /** Whether it reads at all; `false` leaves it loading and asks nothing. */
  enabled?: boolean;
}

function useRead<T>({ key, endpoint, operation, read, enabled = true }: ReadOptions<T>): VpcRead<T> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...key, endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : read(endpoint, signal)),
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const value = query.isError ? undefined : query.data;
  return {
    value,
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: endpoint === undefined || (value === undefined && !query.isError),
    refresh,
  };
}

/** S3's read of the VPC `id` (and a form's, for the VPC of `?vpc=`): the VPC, or "not found". */
export function useVpc(endpoint: string | undefined, id: string, enabled = true): VpcRead<Read<Vpc>> {
  return useRead({
    key: VPC_KEYS.vpc(id),
    endpoint,
    enabled,
    operation: READ_OPERATIONS.describeVpcs,
    read: (at, signal) => getVpc(at, id, signal),
  });
}

/** S3's read of one DNS setting of the VPC `id`, a read of its own: `true` for on. */
export function useDnsSetting(endpoint: string | undefined, id: string, setting: DnsSetting): VpcRead<boolean> {
  return useRead({
    key: VPC_KEYS.vpc(id, 'dns', setting),
    endpoint,
    operation: READ_OPERATIONS.describeVpcAttribute,
    read: (at, signal) => getDnsSetting(at, id, setting, signal),
  });
}

/** S6's read of the subnet `id`. */
export function useSubnet(endpoint: string | undefined, id: string): VpcRead<Read<Subnet>> {
  return useRead({
    key: VPC_KEYS.subnet(id),
    endpoint,
    operation: READ_OPERATIONS.describeSubnets,
    read: (at, signal) => getSubnet(at, id, signal),
  });
}

/** S9's read of the route table `id` (and S10's and S11's, for the table of their address). */
export function useRouteTable(endpoint: string | undefined, id: string): VpcRead<Read<RouteTable>> {
  return useRead({
    key: VPC_KEYS.routeTable(id),
    endpoint,
    operation: READ_OPERATIONS.describeRouteTables,
    read: (at, signal) => getRouteTable(at, id, signal),
  });
}

/** S14's read of the internet gateway `id`. */
export function useInternetGateway(endpoint: string | undefined, id: string): VpcRead<Read<InternetGateway>> {
  return useRead({
    key: VPC_KEYS.gateway(id),
    endpoint,
    operation: READ_OPERATIONS.describeInternetGateways,
    read: (at, signal) => getInternetGateway(at, id, signal),
  });
}

/**
 * S14's read of which internet gateway each VPC holds: `DescribeInternetGateways`, the read of S12, every page to its
 * end, as the ID of the gateway attached to a VPC by that VPC's ID. Under the gateways' key, so a change of a gateway
 * reads it again.
 */
export function useGatewayAttachments(endpoint: string | undefined): VpcRead<ReadonlyMap<string, string>> {
  return useRead({
    key: VPC_KEYS.gateways('attachments'),
    endpoint,
    operation: READ_OPERATIONS.describeInternetGateways,
    read: async (at, signal) => {
      const attached = new Map<string, string>();
      let token: string | undefined;
      do {
        const page = await listInternetGateways(at, {}, token, signal);
        for (const gateway of page.items) {
          if (gateway.vpcId !== undefined && !attached.has(gateway.vpcId)) {
            attached.set(gateway.vpcId, gateway.id);
          }
        }
        token = page.nextToken;
      } while (token !== undefined);
      return attached;
    },
  });
}

/** The route table whose routes apply to a subnet, and which of the two it is. */
export interface AppliedRouteTable {
  table: RouteTable;
  /** `associated`: the subnet's own association; `main`: none, so its VPC's main table. */
  how: 'associated' | 'main';
}

/** What S6's "Route table" shows: the table, or `null` when neither read answered one. */
export type AppliedRead = AppliedRouteTable | null;

/**
 * S6's "Route table": the table of the subnet's own association (`association.subnet-id`); only when that answers
 * none, the main table of the subnet's VPC (`vpc-id` with `association.main` `true`). Loading until the read that
 * decides has answered; read again with the route tables, under whose key it is.
 */
export function useAppliedRouteTable(
  endpoint: string | undefined,
  subnetId: string,
  vpcId: string | undefined,
): VpcRead<AppliedRead> {
  return useRead({
    key: VPC_KEYS.routeTables('of-subnet', subnetId, vpcId ?? null),
    endpoint,
    operation: READ_OPERATIONS.describeRouteTables,
    read: async (at, signal) => {
      const own = (await listRouteTables(at, { subnetId }, undefined, signal)).items[0];
      if (own !== undefined) {
        return { table: own, how: 'associated' };
      }
      if (vpcId === undefined) {
        return null;
      }
      const main = (await listRouteTables(at, { vpcId, main: true }, undefined, signal)).items[0];
      return main === undefined ? null : { table: main, how: 'main' };
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------
// What a change reads again

/** A change that succeeded, by what it changed. */
export type VpcChange =
  | { kind: 'vpc'; id: string }
  | { kind: 'subnet'; id: string; deleted?: boolean }
  | { kind: 'subnet-addresses'; id: string }
  | { kind: 'route-table'; id: string }
  | { kind: 'gateway'; id: string; detached?: boolean };

/** The keys `change` reads again (design, "Where a result is shown"). */
export function changedKeys(change: VpcChange): (readonly unknown[])[] {
  switch (change.kind) {
    case 'vpc':
      // A new VPC has a main table, and a deleted one's tables go with it.
      return [VPC_KEYS.vpcs(), VPC_KEYS.vpc(change.id), VPC_KEYS.choices('vpcs'), VPC_KEYS.routeTables()];
    case 'subnet':
      return [
        VPC_KEYS.subnets(),
        VPC_KEYS.subnet(change.id),
        VPC_KEYS.choices('subnets'),
        // A deleted subnet's association goes with it.
        ...(change.deleted === true ? [VPC_KEYS.routeTables()] : []),
      ];
    case 'subnet-addresses':
      return [VPC_KEYS.subnet(change.id), VPC_KEYS.subnets()];
    case 'route-table':
      // The route table that applies to a subnet (S6) is keyed under the route tables' kind, so it is among them.
      return [VPC_KEYS.routeTables(), VPC_KEYS.routeTable(change.id)];
    case 'gateway':
      return [
        VPC_KEYS.gateways(),
        VPC_KEYS.gateway(change.id),
        // A detached gateway's routes turn `blackhole`.
        ...(change.detached === true ? [VPC_KEYS.routeTables(), VPC_KEYS.routeTable()] : []),
      ];
  }
}

/** Reads again what `change` changed. */
export function readAgainAfter(client: QueryClient, change: VpcChange): void {
  for (const queryKey of changedKeys(change)) {
    void client.invalidateQueries({ queryKey });
  }
}

/** `readAgainAfter` with the page's query client. */
export function useReadAgain(): (change: VpcChange) => void {
  const client = useQueryClient();
  return useCallback(
    (change: VpcChange) => {
      readAgainAfter(client, change);
    },
    [client],
  );
}
