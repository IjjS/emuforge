import { EC2Client, type Tag as SdkTag } from '@aws-sdk/client-ec2';

import { createAwsClient } from '../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../lib/aws/request';

// The EC2 API as more than one service of the area calls it (EC2's screens, VPC's): the one client of the SDK's EC2
// class per engine endpoint, the send every call goes through with its operation's name, and the readers of a text
// and of the tags of an answer. Lifted from `services/ec2` when VPC came to need them (issue 574); no other file of
// the area constructs or caches an EC2 client.

const clients = new Map<string, EC2Client>();

function ec2Client(endpoint: string): EC2Client {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(EC2Client, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

/**
 * One request of `operation` to EC2 at the engine `endpoint`: `send` is handed the client and the signal to send its
 * command with. A failed request rejects with its `RequestError` and an aborted one with the signal's reason.
 */
export function sendEc2<T>(
  endpoint: string,
  operation: string,
  send: (client: EC2Client, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abortSignal) => send(ec2Client(endpoint), abortSignal), signal);
}

/** `value` when it is a text that is not empty. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A tag as the API gives it. */
export interface Tag {
  key: string;
  value: string;
}

/** The tags of an answer, in its order; a tag without a key is left out. */
export function tagsOf(tags: readonly SdkTag[] | undefined): Tag[] {
  return (tags ?? []).flatMap((tag) => {
    const key = text(tag.Key);
    return key === undefined ? [] : [{ key, value: tag.Value ?? '' }];
  });
}

/** The value of the tag `Name`; `undefined` without one or with an empty one. */
export function nameOf(tags: readonly Tag[]): string | undefined {
  const value = tags.find((tag) => tag.key === 'Name')?.value;
  return value === undefined || value === '' ? undefined : value;
}

/** Copies the values of `values` that are not `undefined` onto `target`. */
export function withValues<T extends object>(target: T, values: { [K in keyof T]?: T[K] | undefined }): T {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}
