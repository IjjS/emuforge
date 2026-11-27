import { IAMClient, ListInstanceProfilesCommand } from '@aws-sdk/client-iam';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';
import type { ChoiceSource } from '../../components/use-paged-choices';
import { text } from '../../lib/ec2-client';
import { EC2_KEYS } from './queries';

const LIST_INSTANCE_PROFILES = 'ListInstanceProfiles';
const clients = new Map<string, IAMClient>();

export interface InstanceProfileChoice {
  name: string;
  arn: string;
  roleCount: number;
}

function iamClient(endpoint: string): IAMClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(IAMClient, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

export function instanceProfileChoices(endpoint: string | undefined): ChoiceSource<InstanceProfileChoice> {
  return {
    key: EC2_KEYS.choices('instance-profiles'),
    endpoint,
    operation: LIST_INSTANCE_PROFILES,
    filtering: 'none',
    readAgainOnOpen: true,
    read: async (at, _typed, marker, signal) => {
      const client = iamClient(at);
      const result = await sendRequest(
        LIST_INSTANCE_PROFILES,
        (abortSignal) =>
          client.send(
            new ListInstanceProfilesCommand({ MaxItems: 50, ...(marker === undefined ? {} : { Marker: marker }) }),
            { abortSignal },
          ),
        signal,
      );
      const items = (result.InstanceProfiles ?? []).flatMap((profile) => {
        const name = text(profile.InstanceProfileName);
        const arn = text(profile.Arn);
        return name === undefined || arn === undefined ? [] : [{ name, arn, roleCount: profile.Roles?.length ?? 0 }];
      });
      const next = result.IsTruncated ? text(result.Marker) : undefined;
      return next === undefined ? { items } : { items, next };
    },
    optionOf: ({ name, roleCount }) => ({ value: name, label: name, description: `${String(roleCount)} roles` }),
  };
}
