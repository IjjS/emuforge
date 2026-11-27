import { CreateVpcCommand, DeleteVpcCommand } from '@aws-sdk/client-ec2';

import { sendEc2, text } from '../../lib/ec2-client';
import type { TagRow } from '../../lib/tag-rows';
import { tagSpecifications } from './form';

// The changes of a VPC (issue 574, design task 2): `CreateVpc` from S2 and `DeleteVpc` from S1 and S3, each through
// the area's `sendEc2` with its operation's name, so a refusal (`DependencyViolation` for a VPC in use) rejects with
// its `RequestError` as the emulator gave it.

/** The operations of a VPC's changes, as a failure names them. */
export const VPC_CHANGE_OPERATIONS = {
  createVpc: 'CreateVpc',
  deleteVpc: 'DeleteVpc',
} as const;

/** What S2 sends: the block and optional tags. */
export interface NewVpc {
  cidr: string;
  name?: string;
  tags?: readonly TagRow[];
}

/** `CreateVpc` with `CidrBlock` and optional tags; the new VPC's ID. */
export async function createVpc(endpoint: string, vpc: NewVpc, signal: AbortSignal): Promise<string> {
  const output = await sendEc2(
    endpoint,
    VPC_CHANGE_OPERATIONS.createVpc,
    (client, abortSignal) =>
      client.send(
        new CreateVpcCommand({
          CidrBlock: vpc.cidr,
          ...tagSpecifications('vpc', vpc.name, vpc.tags),
        }),
        { abortSignal },
      ),
    signal,
  );
  return text(output.Vpc?.VpcId) ?? '';
}

/** `DeleteVpc` of the VPC `id`. */
export async function deleteVpc(endpoint: string, id: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    VPC_CHANGE_OPERATIONS.deleteVpc,
    (client, abortSignal) => client.send(new DeleteVpcCommand({ VpcId: id }), { abortSignal }),
    signal,
  );
}
