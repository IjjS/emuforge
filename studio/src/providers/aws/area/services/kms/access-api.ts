import {
  CreateGrantCommand,
  GetKeyPolicyCommand,
  ListGrantsCommand,
  ListKeyPoliciesCommand,
  PutKeyPolicyCommand,
  RevokeGrantCommand,
  type GrantOperation,
} from '@aws-sdk/client-kms';

import { RequestError, UNREADABLE_ANSWER } from '../../../../../lib/aws/request';
import type { TokenPage } from '../../components/use-token-listing';
import { sendKms } from './api';

export const DEFAULT_POLICY = 'default';

export const ACCESS_OPERATIONS = {
  listPolicies: 'ListKeyPolicies',
  getPolicy: 'GetKeyPolicy',
  putPolicy: 'PutKeyPolicy',
  listGrants: 'ListGrants',
  createGrant: 'CreateGrant',
  revokeGrant: 'RevokeGrant',
} as const;

export interface KeyGrant {
  id: string;
  grantee: string | undefined;
  operations: GrantOperation[];
}

export async function hasDefaultPolicy(endpoint: string, keyId: string, signal: AbortSignal): Promise<boolean> {
  const answer = await sendKms(
    endpoint,
    ACCESS_OPERATIONS.listPolicies,
    (client, abortSignal) => client.send(new ListKeyPoliciesCommand({ KeyId: keyId }), { abortSignal }),
    signal,
  );
  return answer.PolicyNames?.includes(DEFAULT_POLICY) ?? false;
}

export async function getDefaultPolicy(endpoint: string, keyId: string, signal: AbortSignal): Promise<string> {
  const operation = ACCESS_OPERATIONS.getPolicy;
  const answer = await sendKms(
    endpoint,
    operation,
    (client, abortSignal) =>
      client.send(new GetKeyPolicyCommand({ KeyId: keyId, PolicyName: DEFAULT_POLICY }), { abortSignal }),
    signal,
  );
  if (answer.Policy === undefined) {
    throw new RequestError({ kind: 'other', operation, code: UNREADABLE_ANSWER });
  }
  return answer.Policy;
}

export function putDefaultPolicy(endpoint: string, keyId: string, document: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    ACCESS_OPERATIONS.putPolicy,
    (client, abortSignal) =>
      client.send(new PutKeyPolicyCommand({ KeyId: keyId, PolicyName: DEFAULT_POLICY, Policy: document }), {
        abortSignal,
      }),
    signal,
  );
}

export async function listGrants(
  endpoint: string,
  keyId: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<KeyGrant>> {
  const answer = await sendKms(
    endpoint,
    ACCESS_OPERATIONS.listGrants,
    (client, abortSignal) =>
      client.send(new ListGrantsCommand({ KeyId: keyId, Marker: marker, Limit: 20 }), { abortSignal }),
    signal,
  );
  const items = (answer.Grants ?? []).flatMap(({ GrantId, GranteePrincipal, Operations }) =>
    GrantId ? [{ id: GrantId, grantee: GranteePrincipal, operations: Operations ?? [] }] : [],
  );
  return answer.Truncated && answer.NextMarker ? { items, next: answer.NextMarker } : { items };
}

export async function createGrant(
  endpoint: string,
  keyId: string,
  grantee: string,
  operations: GrantOperation[],
  signal: AbortSignal,
): Promise<void> {
  await sendKms(
    endpoint,
    ACCESS_OPERATIONS.createGrant,
    (client, abortSignal) =>
      client.send(new CreateGrantCommand({ KeyId: keyId, GranteePrincipal: grantee, Operations: operations }), {
        abortSignal,
      }),
    signal,
  );
}

export function revokeGrant(endpoint: string, keyId: string, grantId: string, signal: AbortSignal) {
  return sendKms(
    endpoint,
    ACCESS_OPERATIONS.revokeGrant,
    (client, abortSignal) => client.send(new RevokeGrantCommand({ KeyId: keyId, GrantId: grantId }), { abortSignal }),
    signal,
  );
}
