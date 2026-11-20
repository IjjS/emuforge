import { CreateSubnetCommand, DeleteSubnetCommand, ModifySubnetAttributeCommand } from '@aws-sdk/client-ec2';

import { DESCRIBE_AVAILABILITY_ZONES } from '../../lib/ec2-availability-zones';
import { sendEc2, text } from '../../lib/ec2-client';

// The calls of a subnet's screens (issue 574, design task 2): `CreateSubnet` from S5;
// `ModifySubnetAttribute` of the public addresses on launch from S6; and
// `DeleteSubnet` from S4 and S6. Each goes through the area's `sendEc2` with its operation's name, so a refusal
// (`InvalidSubnet.Range`, `InvalidSubnet.Conflict`, `DependencyViolation`) rejects with its `RequestError` as the
// emulator gave it.

export { listAvailabilityZones } from '../../lib/ec2-availability-zones';

/** The operations of a subnet's calls, as a failure names them. */
export const SUBNET_CHANGE_OPERATIONS = {
  describeAvailabilityZones: DESCRIBE_AVAILABILITY_ZONES,
  createSubnet: 'CreateSubnet',
  modifySubnetAttribute: 'ModifySubnetAttribute',
  deleteSubnet: 'DeleteSubnet',
} as const;

/** What S5 sends: the VPC and the block; a zone and a name when they are given. */
export interface NewSubnet {
  vpcId: string;
  cidr: string;
  zone?: string;
  name?: string;
}

/**
 * `CreateSubnet` with `VpcId` and `CidrBlock`, `AvailabilityZone` when one is chosen, and the tag `Name` in
 * `TagSpecifications` when named; the new subnet's ID.
 */
export async function createSubnet(endpoint: string, subnet: NewSubnet, signal: AbortSignal): Promise<string> {
  const output = await sendEc2(
    endpoint,
    SUBNET_CHANGE_OPERATIONS.createSubnet,
    (client, abortSignal) =>
      client.send(
        new CreateSubnetCommand({
          VpcId: subnet.vpcId,
          CidrBlock: subnet.cidr,
          ...(subnet.zone === undefined || subnet.zone === '' ? {} : { AvailabilityZone: subnet.zone }),
          ...(subnet.name === undefined || subnet.name === ''
            ? {}
            : { TagSpecifications: [{ ResourceType: 'subnet', Tags: [{ Key: 'Name', Value: subnet.name }] }] }),
        }),
        { abortSignal },
      ),
    signal,
  );
  return text(output.Subnet?.SubnetId) ?? '';
}

/** `ModifySubnetAttribute` of the subnet `id` with `MapPublicIpOnLaunch` `{Value: on}`. */
export async function setPublicAddresses(
  endpoint: string,
  id: string,
  on: boolean,
  signal: AbortSignal,
): Promise<void> {
  await sendEc2(
    endpoint,
    SUBNET_CHANGE_OPERATIONS.modifySubnetAttribute,
    (client, abortSignal) =>
      client.send(new ModifySubnetAttributeCommand({ SubnetId: id, MapPublicIpOnLaunch: { Value: on } }), {
        abortSignal,
      }),
    signal,
  );
}

/** `DeleteSubnet` of the subnet `id`. */
export async function deleteSubnet(endpoint: string, id: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    SUBNET_CHANGE_OPERATIONS.deleteSubnet,
    (client, abortSignal) => client.send(new DeleteSubnetCommand({ SubnetId: id }), { abortSignal }),
    signal,
  );
}
