import { DescribeSubnetsCommand, DescribeVpcsCommand, type Filter } from '@aws-sdk/client-ec2';

import { nameOf, sendEc2, tagsOf, text, withValues } from './ec2-client';

// The VPCs and the subnets a form of the area chooses from, a page of 50 at a time by the API's own token (EC2's
// launch and security group forms, VPC's forms). Lifted from `services/ec2` when VPC came to need them (issue 574);
// how a choice is shown stays each service's own. Each read is sent through `sendEc2` with its operation's name, so
// a failed request rejects with its `RequestError` and an aborted one with the signal's reason.

/** The operations of the two reads, as a failure names them. */
export const NETWORK_CHOICE_OPERATIONS = {
  describeVpcs: 'DescribeVpcs',
  describeSubnets: 'DescribeSubnets',
} as const;

/** How many choices one page asks for. */
export const CHOICES_PAGE_SIZE = 50;

/** One page of choices in the API's order, and its token when it gave one. */
export interface ChoicePage<T> {
  choices: T[];
  nextToken?: string;
}

export interface SubnetChoice {
  id: string;
  /** The value of its tag `Name`. */
  name?: string;
  zone?: string;
  cidr?: string;
  vpcId?: string;
}

export interface VpcChoice {
  id: string;
  /** The value of its tag `Name`. */
  name?: string;
  cidr?: string;
  isDefault: boolean;
}

/** `MaxResults`, the filters when there are any, and the token when there is one. */
export function paged(filters: Filter[], token: string | undefined) {
  return {
    MaxResults: CHOICES_PAGE_SIZE,
    ...(filters.length === 0 ? {} : { Filters: filters }),
    ...(token === undefined ? {} : { NextToken: token }),
  };
}

/** A page of `choices` with the answer's token `next` when it gave one. */
export function pageOf<T>(choices: T[], next: unknown): ChoicePage<T> {
  const nextToken = text(next);
  return nextToken === undefined ? { choices } : { choices, nextToken };
}

/** Subnets: `DescribeSubnets`, the filter `vpc-id` when a VPC is given, none without. */
export async function listSubnetChoices(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
  vpcId?: string,
): Promise<ChoicePage<SubnetChoice>> {
  const filters: Filter[] = vpcId === undefined || vpcId === '' ? [] : [{ Name: 'vpc-id', Values: [vpcId] }];
  const output = await sendEc2(
    endpoint,
    NETWORK_CHOICE_OPERATIONS.describeSubnets,
    (client, abortSignal) => client.send(new DescribeSubnetsCommand(paged(filters, token)), { abortSignal }),
    signal,
  );
  const choices = (output.Subnets ?? []).flatMap((subnet) => {
    const id = text(subnet.SubnetId);
    return id === undefined
      ? []
      : [
          withValues<SubnetChoice>(
            { id },
            {
              name: nameOf(tagsOf(subnet.Tags)),
              zone: text(subnet.AvailabilityZone),
              cidr: text(subnet.CidrBlock),
              vpcId: text(subnet.VpcId),
            },
          ),
        ];
  });
  return pageOf(choices, output.NextToken);
}

/** VPCs: `DescribeVpcs`, with no filter. */
export async function listVpcChoices(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<VpcChoice>> {
  const output = await sendEc2(
    endpoint,
    NETWORK_CHOICE_OPERATIONS.describeVpcs,
    (client, abortSignal) => client.send(new DescribeVpcsCommand(paged([], token)), { abortSignal }),
    signal,
  );
  const choices = (output.Vpcs ?? []).flatMap((vpc) => {
    const id = text(vpc.VpcId);
    return id === undefined
      ? []
      : [
          withValues<VpcChoice>(
            { id, isDefault: vpc.IsDefault === true },
            { name: nameOf(tagsOf(vpc.Tags)), cidr: text(vpc.CidrBlock) },
          ),
        ];
  });
  return pageOf(choices, output.NextToken);
}
