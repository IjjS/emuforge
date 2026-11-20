import {
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  type EC2Client,
  type Filter,
} from '@aws-sdk/client-ec2';

import type { ChoiceSource } from './use-paged-choices';
import type { TokenPage } from './use-token-listing';

// The subnets and a VPC's security groups as choices of the area's choice fields (issue 575, design "What is
// shared"): a page of 50 at a time on EC2's own tokens. It holds no client: every read goes through the `send` its
// caller hands it, the sender of that service's `api.ts`, with the operation's name, so a failed read rejects with
// its `RequestError` under that name and an aborted one with the signal's reason. Every value is the emulator's, as it
// came. It names no service.

/** The operations of the choices, as a failure names them. */
export const NETWORK_OPERATIONS = {
  describeSubnets: 'DescribeSubnets',
  describeSecurityGroups: 'DescribeSecurityGroups',
} as const;

/** How many choices one page asks for. */
export const NETWORK_PAGE_SIZE = 50;

/** The sender a service's `api.ts` hands in: `send` is given the client and the signal to send its command with. */
export type Ec2Send = <T>(
  endpoint: string,
  operation: string,
  send: (client: EC2Client, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
) => Promise<T>;

export interface SubnetChoice {
  id: string;
  vpcId?: string;
  zone?: string;
}

export interface GroupChoice {
  id: string;
  name?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** `MaxResults`, the filter `vpc-id` when a VPC is given, and the token when there is one. */
function paged(vpcId: string | undefined, token: string | undefined) {
  const filters: Filter[] = vpcId === undefined || vpcId === '' ? [] : [{ Name: 'vpc-id', Values: [vpcId] }];
  return {
    MaxResults: NETWORK_PAGE_SIZE,
    ...(filters.length === 0 ? {} : { Filters: filters }),
    ...(token === undefined ? {} : { NextToken: token }),
  };
}

function pageOf<T>(items: T[], next: unknown): TokenPage<T> {
  const token = text(next);
  return token === undefined ? { items } : { items, next: token };
}

/** One page of the subnets, of the VPC `vpcId` when it is given: `DescribeSubnets`. */
export async function listSubnets(
  send: Ec2Send,
  endpoint: string,
  vpcId: string | undefined,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<SubnetChoice>> {
  const output = await send(
    endpoint,
    NETWORK_OPERATIONS.describeSubnets,
    (client, abortSignal) => client.send(new DescribeSubnetsCommand(paged(vpcId, token)), { abortSignal }),
    signal,
  );
  const items = (output.Subnets ?? []).flatMap((subnet) => {
    const id = text(subnet.SubnetId);
    if (id === undefined) {
      return [];
    }
    const choice: SubnetChoice = { id };
    const vpc = text(subnet.VpcId);
    if (vpc !== undefined) choice.vpcId = vpc;
    const zone = text(subnet.AvailabilityZone);
    if (zone !== undefined) choice.zone = zone;
    return [choice];
  });
  return pageOf(items, output.NextToken);
}

/** One page of the security groups of the VPC `vpcId`: `DescribeSecurityGroups` with the filter `vpc-id`. */
export async function listGroups(
  send: Ec2Send,
  endpoint: string,
  vpcId: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<GroupChoice>> {
  const output = await send(
    endpoint,
    NETWORK_OPERATIONS.describeSecurityGroups,
    (client, abortSignal) => client.send(new DescribeSecurityGroupsCommand(paged(vpcId, token)), { abortSignal }),
    signal,
  );
  const items = (output.SecurityGroups ?? []).flatMap((group) => {
    const id = text(group.GroupId);
    if (id === undefined) {
      return [];
    }
    const name = text(group.GroupName);
    return [name === undefined ? { id } : { id, name }];
  });
  return pageOf(items, output.NextToken);
}

/**
 * The subnets, of the VPC `vpcId` when it is given: each its id, with its VPC and Availability Zone as its
 * description. `key` is the caller's root of these choices; the VPC is added to it.
 */
export function subnetChoices(
  send: Ec2Send,
  key: readonly unknown[],
  endpoint: string | undefined,
  vpcId?: string,
): ChoiceSource<SubnetChoice> {
  return {
    key: [...key, 'subnets', vpcId ?? null],
    endpoint,
    operation: NETWORK_OPERATIONS.describeSubnets,
    filtering: 'none',
    read: (at, _text, token, signal) => listSubnets(send, at, vpcId, token, signal),
    optionOf: (subnet) => {
      const description = [subnet.vpcId, subnet.zone].filter((each) => each !== undefined).join(', ');
      return description === ''
        ? { value: subnet.id, label: subnet.id }
        : { value: subnet.id, label: subnet.id, description };
    },
  };
}

/**
 * The security groups of the VPC `vpcId`: each its id, labelled with its id and its name. Not ready, asking nothing,
 * while no VPC is given. `key` is the caller's root of these choices; the VPC is added to it.
 */
export function groupChoices(
  send: Ec2Send,
  key: readonly unknown[],
  endpoint: string | undefined,
  vpcId: string | undefined,
): ChoiceSource<GroupChoice> {
  const given = vpcId !== undefined && vpcId !== '';
  return {
    key: [...key, 'security-groups', vpcId ?? null],
    endpoint,
    operation: NETWORK_OPERATIONS.describeSecurityGroups,
    filtering: 'none',
    ready: given,
    read: (at, _text, token, signal) => listGroups(send, at, vpcId ?? '', token, signal),
    optionOf: (group) => ({
      value: group.id,
      label: group.name === undefined ? group.id : `${group.id} (${group.name})`,
    }),
  };
}
