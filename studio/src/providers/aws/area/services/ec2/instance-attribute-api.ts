import { ModifyInstanceAttributeCommand, type ModifyInstanceAttributeCommandInput } from '@aws-sdk/client-ec2';

import { sendEc2 } from '../../lib/ec2-client';

export const MODIFY_INSTANCE_ATTRIBUTE = 'ModifyInstanceAttribute';

export type InstanceAttributeChange =
  | { kind: 'type'; type: string }
  | { kind: 'groups'; groupIds: string[] }
  | { kind: 'protection'; enabled: boolean };

/** Sends one attribute per request. For groups, the IDs are the complete replacement set. */
export async function modifyInstanceAttribute(
  endpoint: string,
  id: string,
  change: InstanceAttributeChange,
  signal: AbortSignal,
): Promise<void> {
  const input: ModifyInstanceAttributeCommandInput = { InstanceId: id };
  switch (change.kind) {
    case 'type':
      input.InstanceType = { Value: change.type };
      break;
    case 'groups':
      input.Groups = change.groupIds;
      break;
    case 'protection':
      input.DisableApiTermination = { Value: change.enabled };
      break;
  }
  await sendEc2(
    endpoint,
    MODIFY_INSTANCE_ATTRIBUTE,
    (client, abortSignal) => client.send(new ModifyInstanceAttributeCommand(input), { abortSignal }),
    signal,
  );
}
