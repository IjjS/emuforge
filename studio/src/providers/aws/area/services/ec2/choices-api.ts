import {
  DescribeImagesCommand,
  DescribeInstanceTypesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  type Filter,
} from '@aws-sdk/client-ec2';

import { sendEc2, text } from './api';

// The reads EC2's forms choose from (issue 553, design task 2): images, instance types, subnets, VPCs, security
// groups a page of 50 at a time by the API's own token, and key pairs in one answer. Each sent through `sendEc2`
// with its operation's name, so a failed request rejects with its `RequestError` and an aborted one with the
// signal's reason. A typed text is sent as the API's filter with `*` before and after it; every value is the
// emulator's, as it came.

/** The operations of the choices, as a failure names them. */
export const CHOICE_OPERATIONS = {
  describeImages: 'DescribeImages',
  describeInstanceTypes: 'DescribeInstanceTypes',
  describeSubnets: 'DescribeSubnets',
  describeVpcs: 'DescribeVpcs',
  describeSecurityGroups: 'DescribeSecurityGroups',
  describeKeyPairs: 'DescribeKeyPairs',
} as const;

/** How many choices one page asks for. */
export const CHOICES_PAGE_SIZE = 50;

/** One page of choices in the API's order, and its token when it gave one. */
export interface ChoicePage<T> {
  choices: T[];
  nextToken?: string;
}

export interface ImageChoice {
  id: string;
  name?: string;
  architecture?: string;
  platform?: string;
}

export interface InstanceTypeChoice {
  type: string;
  vcpus?: number;
  memoryMiB?: number;
  architectures: string[];
}

export interface SubnetChoice {
  id: string;
  zone?: string;
  cidr?: string;
  vpcId?: string;
}

export interface VpcChoice {
  id: string;
  cidr?: string;
  isDefault: boolean;
}

export interface GroupChoice {
  id: string;
  name?: string;
}

export interface KeyPairChoice {
  name: string;
}

/** Copies the values of `values` that are not `undefined` onto `target`. */
function withValues<T extends object>(target: T, values: { [K in keyof T]?: T[K] | undefined }): T {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The filter `name` with `*` around `typed`, or none for an empty text. */
function contains(name: string, typed: string | undefined): Filter[] {
  return typed === undefined || typed === '' ? [] : [{ Name: name, Values: [`*${typed}*`] }];
}

/** `MaxResults`, the filters when there are any, and the token when there is one. */
function paged(filters: Filter[], token: string | undefined) {
  return {
    MaxResults: CHOICES_PAGE_SIZE,
    ...(filters.length === 0 ? {} : { Filters: filters }),
    ...(token === undefined ? {} : { NextToken: token }),
  };
}

function pageOf<T>(choices: T[], next: unknown): ChoicePage<T> {
  const nextToken = text(next);
  return nextToken === undefined ? { choices } : { choices, nextToken };
}

/** Images: `DescribeImages`, the filter `name` when a text is typed. */
export async function listImageChoices(
  endpoint: string,
  typed: string | undefined,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<ImageChoice>> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeImages,
    (client, abortSignal) =>
      client.send(new DescribeImagesCommand(paged(contains('name', typed), token)), { abortSignal }),
    signal,
  );
  const choices = (output.Images ?? []).flatMap((image) => {
    const id = text(image.ImageId);
    return id === undefined
      ? []
      : [
          withValues<ImageChoice>(
            { id },
            {
              name: text(image.Name),
              architecture: text(image.Architecture),
              platform: text(image.PlatformDetails),
            },
          ),
        ];
  });
  return pageOf(choices, output.NextToken);
}

/** Instance types: `DescribeInstanceTypes`, the filter `instance-type` when a text is typed. */
export async function listInstanceTypeChoices(
  endpoint: string,
  typed: string | undefined,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<InstanceTypeChoice>> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeInstanceTypes,
    (client, abortSignal) =>
      client.send(new DescribeInstanceTypesCommand(paged(contains('instance-type', typed), token)), { abortSignal }),
    signal,
  );
  const choices = (output.InstanceTypes ?? []).flatMap((info) => {
    const type = text(info.InstanceType);
    return type === undefined
      ? []
      : [
          withValues<InstanceTypeChoice>(
            {
              type,
              architectures: (info.ProcessorInfo?.SupportedArchitectures ?? []).flatMap((each) => {
                const architecture = text(each);
                return architecture === undefined ? [] : [architecture];
              }),
            },
            { vcpus: number(info.VCpuInfo?.DefaultVCpus), memoryMiB: number(info.MemoryInfo?.SizeInMiB) },
          ),
        ];
  });
  return pageOf(choices, output.NextToken);
}

/** Subnets: `DescribeSubnets`, with no filter. */
export async function listSubnetChoices(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<SubnetChoice>> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeSubnets,
    (client, abortSignal) => client.send(new DescribeSubnetsCommand(paged([], token)), { abortSignal }),
    signal,
  );
  const choices = (output.Subnets ?? []).flatMap((subnet) => {
    const id = text(subnet.SubnetId);
    return id === undefined
      ? []
      : [
          withValues<SubnetChoice>(
            { id },
            { zone: text(subnet.AvailabilityZone), cidr: text(subnet.CidrBlock), vpcId: text(subnet.VpcId) },
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
    CHOICE_OPERATIONS.describeVpcs,
    (client, abortSignal) => client.send(new DescribeVpcsCommand(paged([], token)), { abortSignal }),
    signal,
  );
  const choices = (output.Vpcs ?? []).flatMap((vpc) => {
    const id = text(vpc.VpcId);
    return id === undefined
      ? []
      : [withValues<VpcChoice>({ id, isDefault: vpc.IsDefault === true }, { cidr: text(vpc.CidrBlock) })];
  });
  return pageOf(choices, output.NextToken);
}

/** The default VPC's ID: `DescribeVpcs` with the filter `is-default` `true`; `undefined` when it answers none. */
export async function getDefaultVpc(endpoint: string, signal: AbortSignal): Promise<string | undefined> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeVpcs,
    (client, abortSignal) =>
      client.send(new DescribeVpcsCommand({ Filters: [{ Name: 'is-default', Values: ['true'] }] }), { abortSignal }),
    signal,
  );
  for (const vpc of output.Vpcs ?? []) {
    const id = text(vpc.VpcId);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

/** What the security groups are chosen among: those of one VPC when it is given, and a text of their names. */
export interface GroupChoiceFilters {
  vpcId?: string;
  name?: string;
}

/** Security groups: `DescribeSecurityGroups`, the filter `vpc-id` when a VPC is given, `group-name` when typed. */
export async function listGroupChoices(
  endpoint: string,
  { vpcId, name }: GroupChoiceFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<GroupChoice>> {
  const filters: Filter[] = [
    ...(vpcId === undefined || vpcId === '' ? [] : [{ Name: 'vpc-id', Values: [vpcId] }]),
    ...contains('group-name', name),
  ];
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeSecurityGroups,
    (client, abortSignal) => client.send(new DescribeSecurityGroupsCommand(paged(filters, token)), { abortSignal }),
    signal,
  );
  const choices = (output.SecurityGroups ?? []).flatMap((group) => {
    const id = text(group.GroupId);
    return id === undefined ? [] : [withValues<GroupChoice>({ id }, { name: text(group.GroupName) })];
  });
  return pageOf(choices, output.NextToken);
}

/** Key pairs: `DescribeKeyPairs`, one answer with no page. */
export async function listKeyPairChoices(endpoint: string, signal: AbortSignal): Promise<KeyPairChoice[]> {
  const output = await sendEc2(
    endpoint,
    CHOICE_OPERATIONS.describeKeyPairs,
    (client, abortSignal) => client.send(new DescribeKeyPairsCommand({}), { abortSignal }),
    signal,
  );
  return (output.KeyPairs ?? []).flatMap((pair) => {
    const name = text(pair.KeyName);
    return name === undefined ? [] : [{ name }];
  });
}
