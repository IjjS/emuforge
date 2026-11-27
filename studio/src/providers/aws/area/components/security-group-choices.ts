import { DescribeSecurityGroupsCommand, EC2Client, type Filter } from '@aws-sdk/client-ec2';

import { createAwsClient } from '../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../lib/aws/request';
import type { ChoiceSource } from './use-paged-choices';
import type { TokenPage } from './use-token-listing';

// EC2's security groups as the choices of a form's field (issue 573, design "What is shared"): lifted into the area
// when a second service's form chose among them (`aws-area.md`, point 9). One page of `DescribeSecurityGroups` at a
// time by the API's own token, 50 a page, of one VPC when one is given, a typed text sent as the filter `group-name`
// with `*` around it. A part of the area no service owns has no `api.ts` to hand its client from, so it hands EC2's
// client class to the factory itself, one client per engine endpoint. It names no service's folder.

/** The operation of the choices, as a failure names it. */
export const DESCRIBE_SECURITY_GROUPS = 'DescribeSecurityGroups';

/** How many security groups one page asks for. */
export const SECURITY_GROUPS_PAGE_SIZE = 50;

/** A security group as a field offers it. */
export interface SecurityGroupChoice {
  id: string;
  name?: string;
  vpcId?: string;
  description?: string;
}

/** One page of security groups in the API's order, and its token when it gave one. */
export interface SecurityGroupPage {
  choices: SecurityGroupChoice[];
  nextToken?: string;
}

/** What the groups are chosen among: one VPC's when it is given, and a text of their names when one is typed. */
export interface SecurityGroupFilters {
  vpcId?: string | undefined;
  name?: string | undefined;
  ids?: readonly string[] | undefined;
}

const clients = new Map<string, EC2Client>();

function ec2Client(endpoint: string): EC2Client {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(EC2Client, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** One page of `DescribeSecurityGroups`: `MaxResults` 50, the token, `vpc-id` and `group-name` when given. */
export async function listSecurityGroupChoices(
  endpoint: string,
  { vpcId, name, ids }: SecurityGroupFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<SecurityGroupPage> {
  const filters: Filter[] = [
    ...(ids === undefined || ids.length === 0 ? [] : [{ Name: 'group-id', Values: [...ids] }]),
    ...(vpcId === undefined || vpcId === '' ? [] : [{ Name: 'vpc-id', Values: [vpcId] }]),
    ...(name === undefined || name === '' ? [] : [{ Name: 'group-name', Values: [`*${name}*`] }]),
  ];
  const output = await sendRequest(
    DESCRIBE_SECURITY_GROUPS,
    (abortSignal) =>
      ec2Client(endpoint).send(
        new DescribeSecurityGroupsCommand({
          MaxResults: SECURITY_GROUPS_PAGE_SIZE,
          ...(filters.length === 0 ? {} : { Filters: filters }),
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const choices = (output.SecurityGroups ?? []).flatMap((group): SecurityGroupChoice[] => {
    const id = text(group.GroupId);
    if (id === undefined) {
      return [];
    }
    const choice: SecurityGroupChoice = { id };
    const groupName = text(group.GroupName);
    if (groupName !== undefined) {
      choice.name = groupName;
    }
    const description = text(group.Description);
    if (description !== undefined) {
      choice.description = description;
    }
    const groupVpc = text(group.VpcId);
    if (groupVpc !== undefined) {
      choice.vpcId = groupVpc;
    }
    return [choice];
  });
  const nextToken = text(output.NextToken);
  return nextToken === undefined ? { choices } : { choices, nextToken };
}

/** Read existing groups by id. The emulator leaves unknown ids out of its answer to this filter. */
export async function readSecurityGroupsById(
  endpoint: string,
  ids: readonly string[],
  signal: AbortSignal,
): Promise<SecurityGroupChoice[]> {
  if (ids.length === 0) return [];

  const groups: SecurityGroupChoice[] = [];
  let token: string | undefined;
  do {
    const page = await listSecurityGroupChoices(endpoint, { ids }, token, signal);
    groups.push(...page.choices);
    token = page.nextToken;
  } while (token !== undefined);
  return groups;
}

/** The area's key of the security groups' choices of the VPC `vpcId`, or of every VPC's (`null`). */
export function securityGroupChoicesKey(vpcId: string | undefined): readonly unknown[] {
  return ['aws', 'area', 'security-group-choices', vpcId ?? null];
}

function tokenPage(page: SecurityGroupPage): TokenPage<SecurityGroupChoice> {
  return page.nextToken === undefined ? { items: page.choices } : { items: page.choices, next: page.nextToken };
}

/**
 * The security groups of the VPC `vpcId`, or of every VPC when it is `undefined`, as a field's source: each its name
 * (its ID when it has none), with its ID and its VPC ID. A typed text is sent as the filter; the groups are read again
 * each time the field is opened again, so a group made in another tab is offered.
 */
export function securityGroupChoices(
  endpoint: string | undefined,
  vpcId?: string | undefined,
): ChoiceSource<SecurityGroupChoice> {
  return {
    key: securityGroupChoicesKey(vpcId),
    endpoint,
    operation: DESCRIBE_SECURITY_GROUPS,
    filtering: 'sent',
    readAgainOnOpen: true,
    read: async (at, typed, token, signal) =>
      tokenPage(await listSecurityGroupChoices(at, { vpcId, name: typed }, token, signal)),
    optionOf: (group) => ({
      value: group.id,
      label: group.name ?? group.id,
      description: group.description === undefined ? group.id : `${group.id} · ${group.description}`,
      tags: group.vpcId === undefined ? [group.id] : [group.id, group.vpcId],
    }),
  };
}
