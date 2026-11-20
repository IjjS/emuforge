import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { ChoiceSource } from '../../components/use-paged-choices';
import { noEndpoint } from '../../components/use-token-listing';
import {
  listSubnetChoices,
  listVpcChoices,
  NETWORK_CHOICE_OPERATIONS,
  type ChoicePage,
  type SubnetChoice,
  type VpcChoice,
} from '../../lib/ec2-network-choices';
import {
  CHOICE_OPERATIONS,
  getDefaultVpc,
  listGroupChoices,
  listImageChoices,
  listInstanceTypeChoices,
  listKeyPairChoices,
  type GroupChoice,
  type ImageChoice,
  type InstanceTypeChoice,
  type KeyPairChoice,
} from './choices-api';
import { EC2_KEYS } from './queries';

// Where EC2's forms take their choices from (issue 553, design task 2): each list a source of the area's paged
// choice field, read by its own reader a page of 50 at a time, under a key of `EC2_KEYS.choices` that holds what the
// source filters by. The images', the instance types' and the groups' typed text is sent as their filter; the
// subnets' and the VPCs' fields take none; the key pairs come in one answer and a typed text narrows it. The
// security groups of the launch form are those of one VPC: the chosen subnet's, else the default VPC's, else every
// group's.

function tokenPage<T>(page: ChoicePage<T>) {
  return page.nextToken === undefined ? { items: page.choices } : { items: page.choices, next: page.nextToken };
}

/** The present values of `values`, in order. */
function present(...values: (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined && value !== '');
}

/** The images: each its name, with its ID, architecture and platform. */
export function imageChoices(endpoint: string | undefined): ChoiceSource<ImageChoice> {
  return {
    key: EC2_KEYS.choices('images'),
    endpoint,
    operation: CHOICE_OPERATIONS.describeImages,
    filtering: 'sent',
    read: async (at, text, token, signal) => tokenPage(await listImageChoices(at, text, token, signal)),
    optionOf: (image) => ({
      value: image.id,
      label: image.name ?? image.id,
      tags: present(image.id, image.architecture, image.platform),
    }),
  };
}

/** The instance types: each the type, with its vCPUs, memory and architectures. */
export function instanceTypeChoices(endpoint: string | undefined): ChoiceSource<InstanceTypeChoice> {
  return {
    key: EC2_KEYS.choices('instance-types'),
    endpoint,
    operation: CHOICE_OPERATIONS.describeInstanceTypes,
    filtering: 'sent',
    read: async (at, text, token, signal) => tokenPage(await listInstanceTypeChoices(at, text, token, signal)),
    optionOf: (info) => ({
      value: info.type,
      label: info.type,
      tags: present(
        info.vcpus === undefined ? undefined : `${String(info.vcpus)} vCPU${info.vcpus === 1 ? '' : 's'}`,
        info.memoryMiB === undefined ? undefined : `${String(info.memoryMiB)} MiB`,
        info.architectures.join(', '),
      ),
    }),
  };
}

/** The subnets: each its ID, with its Availability Zone, CIDR block and VPC. The field takes no typed text. */
export function subnetChoices(endpoint: string | undefined): ChoiceSource<SubnetChoice> {
  return {
    key: EC2_KEYS.choices('subnets'),
    endpoint,
    operation: NETWORK_CHOICE_OPERATIONS.describeSubnets,
    filtering: 'none',
    read: async (at, _text, token, signal) => tokenPage(await listSubnetChoices(at, token, signal)),
    optionOf: (subnet) => ({
      value: subnet.id,
      label: subnet.id,
      tags: present(subnet.zone, subnet.cidr, subnet.vpcId),
    }),
  };
}

/** The VPCs: each its ID, with its CIDR block and whether it is the default. The field takes no typed text. */
export function vpcChoices(endpoint: string | undefined): ChoiceSource<VpcChoice> {
  return {
    key: EC2_KEYS.choices('vpcs'),
    endpoint,
    operation: NETWORK_CHOICE_OPERATIONS.describeVpcs,
    filtering: 'none',
    read: async (at, _text, token, signal) => tokenPage(await listVpcChoices(at, token, signal)),
    optionOf: (vpc) => ({
      value: vpc.id,
      label: vpc.id,
      tags: present(vpc.cidr, vpc.isDefault ? 'Default' : undefined),
    }),
  };
}

/**
 * The security groups of the VPC `vpcId`, or every group's when it is `undefined`: each its name, with its ID.
 * `ready` `false` keeps the field loading and asks nothing, while what it filters by is still read.
 */
export function groupChoices(
  endpoint: string | undefined,
  vpcId: string | undefined,
  ready = true,
): ChoiceSource<GroupChoice> {
  return {
    key: EC2_KEYS.choices('security-groups', vpcId ?? null),
    endpoint,
    operation: CHOICE_OPERATIONS.describeSecurityGroups,
    filtering: 'sent',
    ready,
    read: async (at, text, token, signal) =>
      tokenPage(
        await listGroupChoices(
          at,
          { ...(vpcId === undefined ? {} : { vpcId }), ...(text === '' ? {} : { name: text }) },
          token,
          signal,
        ),
      ),
    optionOf: (group) => ({ value: group.id, label: group.name ?? group.id, description: group.id }),
  };
}

/**
 * The key pairs, in one answer with no "more"; a typed text narrows what that answer holds. They are read again each
 * time the field is opened again.
 */
export function keyPairChoices(endpoint: string | undefined): ChoiceSource<KeyPairChoice> {
  return {
    key: EC2_KEYS.choices('key-pairs'),
    endpoint,
    operation: CHOICE_OPERATIONS.describeKeyPairs,
    filtering: 'local',
    // A key pair made in another tab ("Create key pair") is offered the next time the field is opened.
    readAgainOnOpen: true,
    read: async (at, _text, _token, signal) => ({ items: await listKeyPairChoices(at, signal) }),
    optionOf: (pair) => ({ value: pair.name, label: pair.name }),
  };
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** The default VPC as the launch form knows it. */
export interface DefaultVpc {
  /** Its ID; `undefined` when the emulator answered none, or the read failed. */
  vpcId: string | undefined;
  /** The read is answered or failed. */
  settled: boolean;
}

/** The default VPC: `DescribeVpcs` with `is-default` `true`, read once on mount. A failure reads as none. */
export function useDefaultVpc(endpoint: string | undefined): DefaultVpc {
  const [mount] = useState(() => (mounts += 1));
  const query = useQuery({
    queryKey: [...EC2_KEYS.choices('default-vpc'), endpoint, mount],
    queryFn: async ({ signal }) =>
      endpoint === undefined ? noEndpoint() : ((await getDefaultVpc(endpoint, signal)) ?? null),
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return { vpcId: query.isSuccess ? (query.data ?? undefined) : undefined, settled: query.isSuccess || query.isError };
}

/** The launch form's security groups: the VPC they are chosen in, and their source. */
export interface LaunchGroups {
  /** The VPC whose groups are offered; `undefined` for every group's. */
  vpcId: string | undefined;
  /** The VPC the groups would be of for a subnet of VPC `subnetVpcId`, or with no subnet (`undefined`). */
  vpcFor: (subnetVpcId: string | undefined) => string | undefined;
  source: ChoiceSource<GroupChoice>;
}

/**
 * The launch form's security groups: those of the chosen subnet's VPC `subnetVpcId`; with no subnet chosen, the
 * default VPC's once it is read, or every group's when it is none or its read failed.
 */
export function useLaunchGroups(endpoint: string | undefined, subnetVpcId: string | undefined): LaunchGroups {
  const defaultVpc = useDefaultVpc(endpoint);
  const vpcFor = (subnet: string | undefined) => subnet ?? defaultVpc.vpcId;
  const vpcId = vpcFor(subnetVpcId);
  return {
    vpcId,
    vpcFor,
    source: groupChoices(endpoint, vpcId, subnetVpcId !== undefined || defaultVpc.settled),
  };
}
