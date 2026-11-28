import {
  AttachInternetGatewayCommand,
  CreateInternetGatewayCommand,
  DeleteInternetGatewayCommand,
  DetachInternetGatewayCommand,
} from '@aws-sdk/client-ec2';

import { sendEc2, text } from '../../lib/ec2-client';
import type { TagRow } from '../../lib/tag-rows';
import { tagSpecifications } from './form';

// The changes of an internet gateway (issue 574, design task 3): `CreateInternetGateway` from S13,
// `AttachInternetGateway` from S14, `DetachInternetGateway` and `DeleteInternetGateway` from S12, each through the
// area's `sendEc2` with its operation's name, so a refusal (`Resource.AlreadyAssociated`, `InvalidParameterValue`,
// `Gateway.NotAttached`, `DependencyViolation`) rejects with its `RequestError` as the emulator gave it.

/** The operations of an internet gateway's changes, as a failure names them. */
export const GATEWAY_CHANGE_OPERATIONS = {
  createInternetGateway: 'CreateInternetGateway',
  attachInternetGateway: 'AttachInternetGateway',
  detachInternetGateway: 'DetachInternetGateway',
  deleteInternetGateway: 'DeleteInternetGateway',
} as const;

/** What S13 sends: an optional name and further tags. */
export interface NewGateway {
  name?: string;
  tags?: readonly TagRow[];
}

/** `CreateInternetGateway`, with optional tags; the new gateway's ID. */
export async function createInternetGateway(
  endpoint: string,
  gateway: NewGateway,
  signal: AbortSignal,
): Promise<string> {
  const output = await sendEc2(
    endpoint,
    GATEWAY_CHANGE_OPERATIONS.createInternetGateway,
    (client, abortSignal) =>
      client.send(new CreateInternetGatewayCommand(tagSpecifications('internet-gateway', gateway.name, gateway.tags)), {
        abortSignal,
      }),
    signal,
  );
  return text(output.InternetGateway?.InternetGatewayId) ?? '';
}

/** `AttachInternetGateway` of the gateway `id` to the VPC `vpcId`. */
export async function attachInternetGateway(
  endpoint: string,
  id: string,
  vpcId: string,
  signal: AbortSignal,
): Promise<void> {
  await sendEc2(
    endpoint,
    GATEWAY_CHANGE_OPERATIONS.attachInternetGateway,
    (client, abortSignal) =>
      client.send(new AttachInternetGatewayCommand({ InternetGatewayId: id, VpcId: vpcId }), { abortSignal }),
    signal,
  );
}

/** `DetachInternetGateway` of the gateway `id` from the VPC `vpcId` of its attachment. */
export async function detachInternetGateway(
  endpoint: string,
  id: string,
  vpcId: string,
  signal: AbortSignal,
): Promise<void> {
  await sendEc2(
    endpoint,
    GATEWAY_CHANGE_OPERATIONS.detachInternetGateway,
    (client, abortSignal) =>
      client.send(new DetachInternetGatewayCommand({ InternetGatewayId: id, VpcId: vpcId }), { abortSignal }),
    signal,
  );
}

/** `DeleteInternetGateway` of the gateway `id`. */
export async function deleteInternetGateway(endpoint: string, id: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    GATEWAY_CHANGE_OPERATIONS.deleteInternetGateway,
    (client, abortSignal) => client.send(new DeleteInternetGatewayCommand({ InternetGatewayId: id }), { abortSignal }),
    signal,
  );
}
