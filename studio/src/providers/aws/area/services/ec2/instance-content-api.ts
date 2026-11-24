import {
  CreateTagsCommand,
  DeleteTagsCommand,
  DescribeInstanceAttributeCommand,
  ModifyInstanceAttributeCommand,
} from '@aws-sdk/client-ec2';

import { sendEc2, type Tag } from '../../lib/ec2-client';
import { OPERATIONS } from './api';
import { MODIFY_INSTANCE_ATTRIBUTE } from './instance-attribute-api';

export const CREATE_TAGS = 'CreateTags';
export const DELETE_TAGS = 'DeleteTags';

export type InstanceContentChange =
  { kind: 'put-tag'; tag: Tag } | { kind: 'delete-tag'; key: string } | { kind: 'user-data'; text: string };

export type InstanceUserData = { kind: 'text'; text: string } | { kind: 'binary' };

export function contentOperation(change: InstanceContentChange): string {
  switch (change.kind) {
    case 'put-tag':
      return CREATE_TAGS;
    case 'delete-tag':
      return DELETE_TAGS;
    case 'user-data':
      return MODIFY_INSTANCE_ATTRIBUTE;
  }
}

export async function getInstanceUserData(
  endpoint: string,
  id: string,
  signal: AbortSignal,
): Promise<InstanceUserData> {
  const output = await sendEc2(
    endpoint,
    OPERATIONS.describeInstanceAttribute,
    (client, abortSignal) =>
      client.send(new DescribeInstanceAttributeCommand({ InstanceId: id, Attribute: 'userData' }), { abortSignal }),
    signal,
  );
  try {
    const bytes = Uint8Array.from(atob(output.UserData?.Value ?? ''), (character) => character.charCodeAt(0));
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { kind: 'binary' };
  }
}

export async function changeInstanceContent(
  endpoint: string,
  id: string,
  change: InstanceContentChange,
  signal: AbortSignal,
): Promise<void> {
  const operation = contentOperation(change);
  switch (change.kind) {
    case 'put-tag':
      await sendEc2(
        endpoint,
        operation,
        (client, abortSignal) =>
          client.send(
            new CreateTagsCommand({
              Resources: [id],
              Tags: [{ Key: change.tag.key, Value: change.tag.value }],
            }),
            { abortSignal },
          ),
        signal,
      );
      break;
    case 'delete-tag':
      await sendEc2(
        endpoint,
        operation,
        (client, abortSignal) =>
          client.send(new DeleteTagsCommand({ Resources: [id], Tags: [{ Key: change.key }] }), { abortSignal }),
        signal,
      );
      break;
    case 'user-data':
      await sendEc2(
        endpoint,
        operation,
        (client, abortSignal) =>
          client.send(
            new ModifyInstanceAttributeCommand({
              InstanceId: id,
              UserData: { Value: new TextEncoder().encode(change.text) },
            }),
            { abortSignal },
          ),
        signal,
      );
      break;
  }
}
