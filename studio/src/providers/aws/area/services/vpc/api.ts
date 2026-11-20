import {
  DescribeInternetGatewaysCommand,
  DescribeRouteTablesCommand,
  DescribeSubnetsCommand,
  DescribeVpcAttributeCommand,
  DescribeVpcsCommand,
  type Filter,
  type InternetGateway as SdkInternetGateway,
  type Route as SdkRoute,
  type RouteTable as SdkRouteTable,
  type Subnet as SdkSubnet,
  type Vpc as SdkVpc,
} from '@aws-sdk/client-ec2';

import { sendEc2, tagsOf, text, withValues, type Tag } from '../../lib/ec2-client';

// Every read of VPC's screens (issue 574, design tasks 1 to 3): a page of each list by its name filter, a filter of
// its VPC (or subnet) and its token; one VPC, subnet, route table or internet gateway by the filter of its id, never
// by the `…Ids` argument, so an id the emulator does not hold is an empty answer, "not found"; a VPC's DNS setting.
// Each sent through the area's `sendEc2` with its operation's name, so a failed request rejects with its
// `RequestError` and an aborted one with the signal's reason. Every value is the emulator's, as it came.

/** The operations of the reads, as a failure names them. */
export const READ_OPERATIONS = {
  describeVpcs: 'DescribeVpcs',
  describeVpcAttribute: 'DescribeVpcAttribute',
  describeSubnets: 'DescribeSubnets',
  describeRouteTables: 'DescribeRouteTables',
  describeInternetGateways: 'DescribeInternetGateways',
} as const;

/** How many items one page of a list asks for. */
export const PAGE_SIZE = 50;

/** A VPC as S1 and S3 show it. A value the answer lacks is absent. */
export interface Vpc {
  id: string;
  /** `State` as the API names it; empty when the answer gave none. */
  state: string;
  /** Its primary IPv4 block, `CidrBlock`. */
  cidr?: string;
  /** Every IPv4 block of `CidrBlockAssociationSet`, in the answer's order. */
  cidrs: string[];
  isDefault: boolean;
  tags: Tag[];
}

/** A subnet as S4 and S6 show it. */
export interface Subnet {
  id: string;
  arn?: string;
  state: string;
  vpcId?: string;
  cidr?: string;
  zone?: string;
  /** `AvailableIpAddressCount`. */
  freeAddresses?: number;
  /** `DefaultForAz`. */
  isDefault: boolean;
  /** `MapPublicIpOnLaunch`. */
  publicAddresses: boolean;
  tags: Tag[];
}

/** Where a route leads from: an IPv4 block, an IPv6 block or a prefix list's ID. */
export interface RouteDestination {
  kind: 'ipv4' | 'ipv6' | 'prefix-list';
  value: string;
}

/** A route of a route table. */
export interface Route {
  destination?: RouteDestination;
  /** The one id the route names as its target, `local` as it is. */
  target?: string;
  /** `State` as the API names it (`active`, `blackhole`). */
  state?: string;
}

/** An association of a route table: with a subnet, or the VPC's main one. */
export interface Association {
  id: string;
  subnetId?: string;
  main: boolean;
}

/** A route table as S3, S6, S7 and S9 show it. */
export interface RouteTable {
  id: string;
  vpcId?: string;
  /** One of its associations is the main one: it is its VPC's main table. */
  main: boolean;
  routes: Route[];
  associations: Association[];
  /** How many of its associations have a subnet. */
  subnetCount: number;
  tags: Tag[];
}

/** An internet gateway as S3, S12 and S14 show it. */
export interface InternetGateway {
  id: string;
  /** The VPC of its attachment; none when it has no attachment. */
  vpcId?: string;
  tags: Tag[];
}

/** One page of a list in the API's order, and its token when it gave one. */
export interface Page<T> {
  items: T[];
  nextToken?: string;
}

/** A read of one resource: it, or "not found" (an empty answer). */
export type Read<T> = { found: true; value: T } | { found: false };

/** What a list is narrowed by: a text of the name, and the VPC (or the subnet) it is of. */
export interface ListFilters {
  /** A text of the tag `Name`, sent with `*` before and after it; none when empty. */
  name?: string;
  vpcId?: string;
}

/** What the route tables are narrowed by, besides the name and the VPC. */
export interface RouteTableFilters extends ListFilters {
  /** The tables associated with this subnet (`association.subnet-id`). */
  subnetId?: string;
  /** The VPC's main table alone (`association.main` `true`). */
  main?: boolean;
}

function filter(name: string, value: string | undefined): Filter[] {
  return value === undefined || value === '' ? [] : [{ Name: name, Values: [value] }];
}

function nameFilter(name: string | undefined): Filter[] {
  return name === undefined || name === '' ? [] : [{ Name: 'tag:Name', Values: [`*${name}*`] }];
}

/** `MaxResults` 50, the filters when there are any, and the token when there is one. */
function paged(filters: Filter[], token: string | undefined) {
  return {
    MaxResults: PAGE_SIZE,
    ...(filters.length === 0 ? {} : { Filters: filters }),
    ...(token === undefined ? {} : { NextToken: token }),
  };
}

function pageOf<T>(items: T[], next: unknown): Page<T> {
  const nextToken = text(next);
  return nextToken === undefined ? { items } : { items, nextToken };
}

function each<R, T>(raw: readonly R[] | undefined, of: (one: R) => T | undefined): T[] {
  return (raw ?? []).flatMap((one) => {
    const value = of(one);
    return value === undefined ? [] : [value];
  });
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function vpcOf(raw: SdkVpc): Vpc | undefined {
  const id = text(raw.VpcId);
  if (id === undefined) {
    return undefined;
  }
  return withValues<Vpc>(
    {
      id,
      state: text(raw.State) ?? '',
      cidrs: each(raw.CidrBlockAssociationSet, (association) => text(association.CidrBlock)),
      isDefault: raw.IsDefault === true,
      tags: tagsOf(raw.Tags),
    },
    { cidr: text(raw.CidrBlock) },
  );
}

function subnetOf(raw: SdkSubnet): Subnet | undefined {
  const id = text(raw.SubnetId);
  if (id === undefined) {
    return undefined;
  }
  return withValues<Subnet>(
    {
      id,
      state: text(raw.State) ?? '',
      isDefault: raw.DefaultForAz === true,
      publicAddresses: raw.MapPublicIpOnLaunch === true,
      tags: tagsOf(raw.Tags),
    },
    {
      arn: text(raw.SubnetArn),
      vpcId: text(raw.VpcId),
      cidr: text(raw.CidrBlock),
      zone: text(raw.AvailabilityZone),
      freeAddresses: count(raw.AvailableIpAddressCount),
    },
  );
}

function destinationOf(raw: SdkRoute): RouteDestination | undefined {
  const ipv4 = text(raw.DestinationCidrBlock);
  if (ipv4 !== undefined) return { kind: 'ipv4', value: ipv4 };
  const ipv6 = text(raw.DestinationIpv6CidrBlock);
  if (ipv6 !== undefined) return { kind: 'ipv6', value: ipv6 };
  const prefixList = text(raw.DestinationPrefixListId);
  if (prefixList !== undefined) return { kind: 'prefix-list', value: prefixList };
  return undefined;
}

function targetOf(raw: SdkRoute): string | undefined {
  return [
    raw.GatewayId,
    raw.NatGatewayId,
    raw.VpcPeeringConnectionId,
    raw.TransitGatewayId,
    raw.EgressOnlyInternetGatewayId,
    raw.NetworkInterfaceId,
    raw.InstanceId,
    raw.CarrierGatewayId,
    raw.LocalGatewayId,
    raw.CoreNetworkArn,
  ]
    .map(text)
    .find((value) => value !== undefined);
}

function routeTableOf(raw: SdkRouteTable): RouteTable | undefined {
  const id = text(raw.RouteTableId);
  if (id === undefined) {
    return undefined;
  }
  const associations = each(raw.Associations, (association) => {
    const associationId = text(association.RouteTableAssociationId);
    return associationId === undefined
      ? undefined
      : withValues<Association>(
          { id: associationId, main: association.Main === true },
          { subnetId: text(association.SubnetId) },
        );
  });
  return withValues<RouteTable>(
    {
      id,
      main: associations.some((association) => association.main),
      routes: (raw.Routes ?? []).map((route) =>
        withValues<Route>(
          {},
          { destination: destinationOf(route), target: targetOf(route), state: text(route.State) },
        ),
      ),
      associations,
      subnetCount: associations.filter((association) => association.subnetId !== undefined).length,
      tags: tagsOf(raw.Tags),
    },
    { vpcId: text(raw.VpcId) },
  );
}

function gatewayOf(raw: SdkInternetGateway): InternetGateway | undefined {
  const id = text(raw.InternetGatewayId);
  if (id === undefined) {
    return undefined;
  }
  const vpcId = (raw.Attachments ?? []).map((attachment) => text(attachment.VpcId)).find((value) => value !== undefined);
  return withValues<InternetGateway>({ id, tags: tagsOf(raw.Tags) }, { vpcId });
}

function found<T extends { id: string }>(items: readonly T[], id: string): Read<T> {
  const value = items.find((candidate) => candidate.id === id);
  return value === undefined ? { found: false } : { found: true, value };
}

// ---------------------------------------------------------------------------------------------------------------
// The VPCs

async function describeVpcs(endpoint: string, input: { Filters?: Filter[] }, signal: AbortSignal) {
  return sendEc2(
    endpoint,
    READ_OPERATIONS.describeVpcs,
    (client, abortSignal) => client.send(new DescribeVpcsCommand(input), { abortSignal }),
    signal,
  );
}

/** S1's page: `DescribeVpcs`, 50 a page, `tag:Name` when a text is given. */
export async function listVpcs(
  endpoint: string,
  filters: Pick<ListFilters, 'name'>,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Page<Vpc>> {
  const output = await describeVpcs(endpoint, paged(nameFilter(filters.name), token), signal);
  return pageOf(each(output.Vpcs, vpcOf), output.NextToken);
}

/** One VPC: `DescribeVpcs` by the filter `vpc-id`. */
export async function getVpc(endpoint: string, id: string, signal: AbortSignal): Promise<Read<Vpc>> {
  const output = await describeVpcs(endpoint, { Filters: [{ Name: 'vpc-id', Values: [id] }] }, signal);
  return found(each(output.Vpcs, vpcOf), id);
}

/** A VPC's DNS settings, as `DescribeVpcAttribute` names them. */
export type DnsSetting = 'enableDnsSupport' | 'enableDnsHostnames';

/** A VPC's DNS setting: `DescribeVpcAttribute` with the attribute; `true` for on. */
export async function getDnsSetting(
  endpoint: string,
  id: string,
  setting: DnsSetting,
  signal: AbortSignal,
): Promise<boolean> {
  const output = await sendEc2(
    endpoint,
    READ_OPERATIONS.describeVpcAttribute,
    (client, abortSignal) =>
      client.send(new DescribeVpcAttributeCommand({ VpcId: id, Attribute: setting }), { abortSignal }),
    signal,
  );
  const value = setting === 'enableDnsSupport' ? output.EnableDnsSupport : output.EnableDnsHostnames;
  return value?.Value === true;
}

// ---------------------------------------------------------------------------------------------------------------
// The subnets

async function describeSubnets(endpoint: string, input: { Filters?: Filter[] }, signal: AbortSignal) {
  return sendEc2(
    endpoint,
    READ_OPERATIONS.describeSubnets,
    (client, abortSignal) => client.send(new DescribeSubnetsCommand(input), { abortSignal }),
    signal,
  );
}

/** S4's and S3's page: `DescribeSubnets`, 50 a page, `vpc-id` when a VPC is given, `tag:Name` when a text is. */
export async function listSubnets(
  endpoint: string,
  filters: ListFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Page<Subnet>> {
  const sent = [...filter('vpc-id', filters.vpcId), ...nameFilter(filters.name)];
  const output = await describeSubnets(endpoint, paged(sent, token), signal);
  return pageOf(each(output.Subnets, subnetOf), output.NextToken);
}

/** One subnet: `DescribeSubnets` by the filter `subnet-id`. */
export async function getSubnet(endpoint: string, id: string, signal: AbortSignal): Promise<Read<Subnet>> {
  const output = await describeSubnets(endpoint, { Filters: [{ Name: 'subnet-id', Values: [id] }] }, signal);
  return found(each(output.Subnets, subnetOf), id);
}

// ---------------------------------------------------------------------------------------------------------------
// The route tables

async function describeRouteTables(endpoint: string, input: { Filters?: Filter[] }, signal: AbortSignal) {
  return sendEc2(
    endpoint,
    READ_OPERATIONS.describeRouteTables,
    (client, abortSignal) => client.send(new DescribeRouteTablesCommand(input), { abortSignal }),
    signal,
  );
}

/**
 * S7's and S3's page: `DescribeRouteTables`, 50 a page; `vpc-id` when a VPC is given, `association.subnet-id` for a
 * subnet's table, `association.main` `true` for a VPC's main one, `tag:Name` when a text is given.
 */
export async function listRouteTables(
  endpoint: string,
  filters: RouteTableFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Page<RouteTable>> {
  const sent = [
    ...filter('vpc-id', filters.vpcId),
    ...filter('association.subnet-id', filters.subnetId),
    ...filter('association.main', filters.main === true ? 'true' : undefined),
    ...nameFilter(filters.name),
  ];
  const output = await describeRouteTables(endpoint, paged(sent, token), signal);
  return pageOf(each(output.RouteTables, routeTableOf), output.NextToken);
}

/** One route table: `DescribeRouteTables` by the filter `route-table-id`. */
export async function getRouteTable(endpoint: string, id: string, signal: AbortSignal): Promise<Read<RouteTable>> {
  const output = await describeRouteTables(endpoint, { Filters: [{ Name: 'route-table-id', Values: [id] }] }, signal);
  return found(each(output.RouteTables, routeTableOf), id);
}

// ---------------------------------------------------------------------------------------------------------------
// The internet gateways

async function describeInternetGateways(endpoint: string, input: { Filters?: Filter[] }, signal: AbortSignal) {
  return sendEc2(
    endpoint,
    READ_OPERATIONS.describeInternetGateways,
    (client, abortSignal) => client.send(new DescribeInternetGatewaysCommand(input), { abortSignal }),
    signal,
  );
}

/** S12's and S3's page: `DescribeInternetGateways`, 50 a page, `attachment.vpc-id` when a VPC is given, `tag:Name`. */
export async function listInternetGateways(
  endpoint: string,
  filters: ListFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<Page<InternetGateway>> {
  const sent = [...filter('attachment.vpc-id', filters.vpcId), ...nameFilter(filters.name)];
  const output = await describeInternetGateways(endpoint, paged(sent, token), signal);
  return pageOf(each(output.InternetGateways, gatewayOf), output.NextToken);
}

/** One internet gateway: `DescribeInternetGateways` by the filter `internet-gateway-id`. */
export async function getInternetGateway(
  endpoint: string,
  id: string,
  signal: AbortSignal,
): Promise<Read<InternetGateway>> {
  const output = await describeInternetGateways(
    endpoint,
    { Filters: [{ Name: 'internet-gateway-id', Values: [id] }] },
    signal,
  );
  return found(each(output.InternetGateways, gatewayOf), id);
}
