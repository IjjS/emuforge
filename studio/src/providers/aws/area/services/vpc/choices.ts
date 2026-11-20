import type { ChoiceSource } from '../../components/use-paged-choices';
import {
  listSubnetChoices,
  listVpcChoices,
  NETWORK_CHOICE_OPERATIONS,
  type ChoicePage,
  type SubnetChoice,
  type VpcChoice,
} from '../../lib/ec2-network-choices';
import { VPC_KEYS } from './queries';

// Where VPC's forms take their VPC and subnet choices from (issue 574, requirement "A choice of a VPC or a subnet"):
// the area's lifted reads, a page of 50 at a time by the API's token, under VPC's own keys; what is typed narrows the
// choices already read and is never sent. A choice's label is its ID; its name, block and more are shown with it.

function tokenPage<T>(page: ChoicePage<T>) {
  return page.nextToken === undefined ? { items: page.choices } : { items: page.choices, next: page.nextToken };
}

function present(...values: (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined && value !== '');
}

/** The VPCs: each its ID, with its name, its block and "default VPC" for the default one. */
export function vpcChoices(endpoint: string | undefined): ChoiceSource<VpcChoice> {
  return {
    key: VPC_KEYS.choices('vpcs'),
    endpoint,
    operation: NETWORK_CHOICE_OPERATIONS.describeVpcs,
    filtering: 'local',
    read: async (at, _text, token, signal) => tokenPage(await listVpcChoices(at, token, signal)),
    optionOf: (vpc) => ({
      value: vpc.id,
      label: vpc.id,
      ...(vpc.name === undefined ? {} : { description: vpc.name }),
      tags: present(vpc.cidr, vpc.isDefault ? 'default VPC' : undefined),
    }),
  };
}

/** The subnets of the VPC `vpcId`: each its ID, with its name, its block and its Availability Zone. */
export function subnetChoices(endpoint: string | undefined, vpcId: string): ChoiceSource<SubnetChoice> {
  return {
    key: VPC_KEYS.choices('subnets', vpcId),
    endpoint,
    operation: NETWORK_CHOICE_OPERATIONS.describeSubnets,
    filtering: 'local',
    read: async (at, _text, token, signal) => tokenPage(await listSubnetChoices(at, token, signal, vpcId)),
    optionOf: (subnet) => ({
      value: subnet.id,
      label: subnet.id,
      ...(subnet.name === undefined ? {} : { description: subnet.name }),
      tags: present(subnet.cidr, subnet.zone),
    }),
  };
}
