import { RunInstancesCommand, type _InstanceType } from '@aws-sdk/client-ec2';

import { sendEc2, text } from '../../lib/ec2-client';

// The launch of S2 (issue 553, design task 2): one `RunInstances` of one instance, through `sendEc2` with its
// operation's name, so a refusal rejects with its `RequestError` carrying the emulator's code and message as they
// came, and a 501 as "not implemented" with `RunInstances`. Only what was chosen is sent.

/** The operation of the launch, as a failure names it. */
export const LAUNCH_OPERATION = 'RunInstances';

/** What S2 launches: an image and a type, and what else was chosen. */
export interface NewInstance {
  imageId: string;
  instanceType: string;
  /** Sent as the tag `Name` of the instance; none when absent or empty. */
  name?: string;
  keyName?: string;
  subnetId?: string;
  /** None sent when absent or empty: the emulator then gives the group `default`. */
  securityGroupIds?: readonly string[];
}

/** `RunInstances` with `MinCount` and `MaxCount` 1; the ID of the instance it answers with. */
export async function launchInstance(endpoint: string, launch: NewInstance, signal: AbortSignal): Promise<string> {
  const { imageId, instanceType, name, keyName, subnetId, securityGroupIds } = launch;
  const output = await sendEc2(
    endpoint,
    LAUNCH_OPERATION,
    (client, abortSignal) =>
      client.send(
        new RunInstancesCommand({
          ImageId: imageId,
          // A type as the emulator listed it; the SDK's list of names is not the emulator's.
          InstanceType: instanceType as _InstanceType,
          MinCount: 1,
          MaxCount: 1,
          ...(keyName === undefined || keyName === '' ? {} : { KeyName: keyName }),
          ...(subnetId === undefined || subnetId === '' ? {} : { SubnetId: subnetId }),
          ...(securityGroupIds === undefined || securityGroupIds.length === 0
            ? {}
            : { SecurityGroupIds: [...securityGroupIds] }),
          ...(name === undefined || name === ''
            ? {}
            : { TagSpecifications: [{ ResourceType: 'instance', Tags: [{ Key: 'Name', Value: name }] }] }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const id = (output.Instances ?? []).map((instance) => text(instance.InstanceId)).find((each) => each !== undefined);
  if (id === undefined) {
    throw new Error('RunInstances answered with no instance ID.');
  }
  return id;
}
