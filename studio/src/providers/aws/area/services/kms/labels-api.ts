import {
  CreateAliasCommand,
  DeleteAliasCommand,
  ListResourceTagsCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateAliasCommand,
} from '@aws-sdk/client-kms';

import type { TokenPage } from '../../components/use-token-listing';
import { sendKms } from './api';

export const LABEL_OPERATIONS = {
  createAlias: 'CreateAlias',
  updateAlias: 'UpdateAlias',
  deleteAlias: 'DeleteAlias',
  listTags: 'ListResourceTags',
  tag: 'TagResource',
  untag: 'UntagResource',
} as const;

export interface KeyTag {
  name: string;
  value: string;
}

export async function listKeyTags(
  endpoint: string,
  keyId: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<KeyTag>> {
  const answer = await sendKms(
    endpoint,
    LABEL_OPERATIONS.listTags,
    (client, abortSignal) =>
      client.send(new ListResourceTagsCommand({ KeyId: keyId, Marker: marker }), { abortSignal }),
    signal,
  );
  const items = (answer.Tags ?? []).flatMap(({ TagKey, TagValue }) =>
    TagKey === undefined ? [] : [{ name: TagKey, value: TagValue ?? '' }],
  );
  return answer.Truncated && answer.NextMarker ? { items, next: answer.NextMarker } : { items };
}

export function createAlias(endpoint: string, alias: string, keyId: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LABEL_OPERATIONS.createAlias,
    (client, abortSignal) =>
      client.send(new CreateAliasCommand({ AliasName: alias, TargetKeyId: keyId }), { abortSignal }),
    signal,
  );
}

export function updateAlias(endpoint: string, alias: string, targetId: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LABEL_OPERATIONS.updateAlias,
    (client, abortSignal) =>
      client.send(new UpdateAliasCommand({ AliasName: alias, TargetKeyId: targetId }), { abortSignal }),
    signal,
  );
}

export function deleteAlias(endpoint: string, alias: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LABEL_OPERATIONS.deleteAlias,
    (client, abortSignal) => client.send(new DeleteAliasCommand({ AliasName: alias }), { abortSignal }),
    signal,
  );
}

export function tagKey(endpoint: string, keyId: string, tag: KeyTag, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LABEL_OPERATIONS.tag,
    (client, abortSignal) =>
      client.send(new TagResourceCommand({ KeyId: keyId, Tags: [{ TagKey: tag.name, TagValue: tag.value }] }), {
        abortSignal,
      }),
    signal,
  );
}

export function untagKey(endpoint: string, keyId: string, name: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    LABEL_OPERATIONS.untag,
    (client, abortSignal) => client.send(new UntagResourceCommand({ KeyId: keyId, TagKeys: [name] }), { abortSignal }),
    signal,
  );
}
