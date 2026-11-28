import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { DESCRIBE_SECURITY_GROUPS } from '../../components/security-group-choices';
import type { ChoiceSource } from '../../components/use-paged-choices';
import { failureOf, noEndpoint } from '../../components/use-token-listing';
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
  listInstanceTypeOfferings,
  listKeyPairChoices,
  type GroupChoice,
  type ImageChoice,
  type InstanceTypeChoice,
  type KeyPairChoice,
} from './choices-api';
import { EC2_KEYS } from './queries';

function tokenPage<T>(page: ChoicePage<T>) {
  return page.nextToken === undefined ? { items: page.choices } : { items: page.choices, next: page.nextToken };
}

function described(...values: (string | undefined)[]) {
  const description = values.filter(Boolean).join(' · ');
  return description === '' ? {} : { description };
}

export function imageChoices(endpoint: string | undefined): ChoiceSource<ImageChoice> {
  return {
    key: EC2_KEYS.choices('images'),
    endpoint,
    operation: CHOICE_OPERATIONS.describeImages,
    filtering: 'sent',
    readAgainOnOpen: true,
    read: async (at, text, token, signal) => tokenPage(await listImageChoices(at, text, token, signal)),
    optionOf: (image) => ({
      value: image.id,
      label: image.name ?? image.id,
      tags: [image.id],
      ...described(image.architecture, image.description),
    }),
  };
}

/** Only the zone's offered types are returned, advancing past pages filtered to empty. */
export function instanceTypeChoices(
  endpoint: string | undefined,
  zone?: string,
  offerings?: ReadonlySet<string>,
): ChoiceSource<InstanceTypeChoice> {
  return {
    key: EC2_KEYS.choices('instance-types', zone ?? null),
    endpoint,
    operation: CHOICE_OPERATIONS.describeInstanceTypes,
    filtering: 'sent',
    ready: zone === undefined || offerings !== undefined,
    read: async (at, text, token, signal) => {
      if (offerings?.size === 0) return { items: [] };
      let page = await listInstanceTypeChoices(at, text, token, signal);
      if (offerings === undefined) return tokenPage(page);
      while (true) {
        const choices = page.choices.filter(({ type }) => offerings.has(type));
        if (choices.length > 0 || page.nextToken === undefined) return tokenPage({ ...page, choices });
        page = await listInstanceTypeChoices(at, text, page.nextToken, signal);
      }
    },
    optionOf: (info) => ({
      value: info.type,
      label: info.type,
      ...described(
        info.vcpus === undefined ? undefined : `${String(info.vcpus)} vCPU`,
        info.memoryMiB === undefined ? undefined : `${String(info.memoryMiB / 1024)} GiB`,
        info.architectures.join(', '),
      ),
    }),
  };
}

export function subnetChoices(endpoint: string | undefined, vpcId: string | undefined): ChoiceSource<SubnetChoice> {
  return {
    key: EC2_KEYS.choices('subnets', vpcId ?? null),
    endpoint,
    operation: NETWORK_CHOICE_OPERATIONS.describeSubnets,
    filtering: 'none',
    readAgainOnOpen: true,
    read: async (at, _text, token, signal) => tokenPage(await listSubnetChoices(at, token, signal, vpcId)),
    optionOf: (subnet) => ({
      value: subnet.id,
      label: subnet.id,
      ...described(
        subnet.zone,
        subnet.cidr,
        subnet.availableIpAddressCount === undefined
          ? undefined
          : `${String(subnet.availableIpAddressCount)} free addresses`,
      ),
    }),
  };
}

export function vpcChoices(endpoint: string | undefined): ChoiceSource<VpcChoice> {
  return {
    key: EC2_KEYS.choices('vpcs'),
    endpoint,
    operation: NETWORK_CHOICE_OPERATIONS.describeVpcs,
    filtering: 'none',
    readAgainOnOpen: true,
    read: async (at, _text, token, signal) => tokenPage(await listVpcChoices(at, token, signal)),
    optionOf: (vpc) => ({
      value: vpc.id,
      label: vpc.id,
      ...described(vpc.cidr),
      ...(vpc.isDefault ? { tags: ['Default VPC'] } : {}),
    }),
  };
}

export function groupChoices(
  endpoint: string | undefined,
  vpcId: string | undefined,
  ready = true,
): ChoiceSource<GroupChoice> {
  return {
    key: EC2_KEYS.choices('security-groups', vpcId ?? null),
    endpoint,
    operation: DESCRIBE_SECURITY_GROUPS,
    filtering: 'sent',
    ready,
    readAgainOnOpen: true,
    read: async (at, text, token, signal) =>
      tokenPage(
        await listGroupChoices(
          at,
          { ...(vpcId === undefined ? {} : { vpcId }), ...(text === '' ? {} : { name: text }) },
          token,
          signal,
        ),
      ),
    optionOf: (group) => ({
      value: group.id,
      label: group.name ?? group.id,
      ...described(group.id, group.description),
    }),
  };
}

export function keyPairChoices(endpoint: string | undefined): ChoiceSource<KeyPairChoice> {
  return {
    key: EC2_KEYS.choices('key-pairs'),
    endpoint,
    operation: CHOICE_OPERATIONS.describeKeyPairs,
    filtering: 'local',
    readAgainOnOpen: true,
    read: async (at, _text, _token, signal) => ({ items: await listKeyPairChoices(at, signal) }),
    optionOf: (pair) => ({ value: pair.name, label: pair.name, ...described(pair.type) }),
  };
}

let mounts = 0;

export function useDefaultVpc(endpoint: string | undefined) {
  const [mount] = useState(() => (mounts += 1));
  const query = useQuery({
    queryKey: [...EC2_KEYS.choices('default-vpc'), endpoint, mount],
    queryFn: async ({ signal }) =>
      endpoint === undefined ? noEndpoint() : ((await getDefaultVpc(endpoint, signal)) ?? null),
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    vpc: query.data ?? undefined,
    pending: query.isFetching,
    failure: query.isError && !query.isFetching ? failureOf(query.error, CHOICE_OPERATIONS.describeVpcs) : undefined,
    retry: () => void query.refetch(),
  };
}

export function useInstanceTypeOfferings(endpoint: string | undefined, zone: string | undefined) {
  const [mount] = useState(() => (mounts += 1));
  const operation = CHOICE_OPERATIONS.describeInstanceTypeOfferings;
  const query = useQuery({
    queryKey: [...EC2_KEYS.choices('instance-type-offerings', zone), endpoint, mount],
    queryFn: ({ signal }) =>
      endpoint === undefined || zone === undefined ? noEndpoint() : listInstanceTypeOfferings(endpoint, zone, signal),
    enabled: endpoint !== undefined && zone !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    types: query.isSuccess && !query.isFetching ? query.data : undefined,
    pending: query.isFetching,
    failure: query.isError && !query.isFetching ? failureOf(query.error, operation) : undefined,
    retry: () => void query.refetch(),
  };
}
