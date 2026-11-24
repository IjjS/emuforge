import {
  AddTagsToResourceCommand,
  DeleteResourcePolicyCommand,
  GetResourcePoliciesCommand,
  ListTagsForResourceCommand,
  PutResourcePolicyCommand,
  RemoveTagsFromResourceCommand,
  type GetResourcePoliciesResponseEntry,
  type Tag,
} from '@aws-sdk/client-ssm';

import { sendRequest } from '../../../../../lib/aws/request';
import { ssmClient } from './api';

export const LIST_TAGS = 'ListTagsForResource';
export const ADD_TAGS = 'AddTagsToResource';
export const REMOVE_TAGS = 'RemoveTagsFromResource';
export const GET_RESOURCE_POLICIES = 'GetResourcePolicies';
export const PUT_RESOURCE_POLICY = 'PutResourcePolicy';
export const DELETE_RESOURCE_POLICY = 'DeleteResourcePolicy';

export type PolicyRevision = { PolicyId: string; PolicyHash: string };

export async function listParameterTags(endpoint: string, ResourceId: string, signal: AbortSignal) {
  const { TagList = [] } = await sendRequest(
    LIST_TAGS,
    (abortSignal) =>
      ssmClient(endpoint).send(new ListTagsForResourceCommand({ ResourceType: 'Parameter', ResourceId }), {
        abortSignal,
      }),
    signal,
  );
  return TagList;
}

export function addParameterTag(endpoint: string, ResourceId: string, tag: Tag, signal: AbortSignal) {
  return sendRequest(
    ADD_TAGS,
    (abortSignal) =>
      ssmClient(endpoint).send(new AddTagsToResourceCommand({ ResourceType: 'Parameter', ResourceId, Tags: [tag] }), {
        abortSignal,
      }),
    signal,
  );
}

export function removeParameterTag(endpoint: string, ResourceId: string, key: string, signal: AbortSignal) {
  return sendRequest(
    REMOVE_TAGS,
    (abortSignal) =>
      ssmClient(endpoint).send(
        new RemoveTagsFromResourceCommand({ ResourceType: 'Parameter', ResourceId, TagKeys: [key] }),
        {
          abortSignal,
        },
      ),
    signal,
  );
}

export async function listResourcePolicies(endpoint: string, ResourceArn: string, signal: AbortSignal) {
  const policies: GetResourcePoliciesResponseEntry[] = [];
  let NextToken: string | undefined;
  do {
    const page = await sendRequest(
      GET_RESOURCE_POLICIES,
      (abortSignal) =>
        ssmClient(endpoint).send(new GetResourcePoliciesCommand({ ResourceArn, NextToken }), { abortSignal }),
      signal,
    );
    signal.throwIfAborted();
    policies.push(...(page.Policies ?? []));
    NextToken = page.NextToken;
  } while (NextToken);
  return policies;
}

export function putResourcePolicy(
  endpoint: string,
  ResourceArn: string,
  Policy: string,
  revision: PolicyRevision | undefined,
  signal: AbortSignal,
) {
  return sendRequest(
    PUT_RESOURCE_POLICY,
    (abortSignal) =>
      ssmClient(endpoint).send(new PutResourcePolicyCommand({ ResourceArn, Policy, ...revision }), { abortSignal }),
    signal,
  );
}

export function deleteResourcePolicy(
  endpoint: string,
  ResourceArn: string,
  revision: PolicyRevision,
  signal: AbortSignal,
) {
  return sendRequest(
    DELETE_RESOURCE_POLICY,
    (abortSignal) =>
      ssmClient(endpoint).send(new DeleteResourcePolicyCommand({ ResourceArn, ...revision }), { abortSignal }),
    signal,
  );
}
