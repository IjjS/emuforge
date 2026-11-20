import {
  DeleteSecurityGroupCommand,
  DescribeSecurityGroupRulesCommand,
  DescribeSecurityGroupsCommand,
  RevokeSecurityGroupEgressCommand,
  RevokeSecurityGroupIngressCommand,
  type SecurityGroup as SdkSecurityGroup,
  type SecurityGroupRule as SdkRule,
} from '@aws-sdk/client-ec2';

import { RequestError } from '../../../../../lib/aws/request';
import { sendEc2, text } from './api';

// The calls of EC2's security group screens, S4 and S6 (issue 553, design task 4), through `sendEc2` with each
// operation's name, mapped to plain typed results. Every value is the emulator's, as it came.

/** The operations of S4, S6 and the two delete dialogs, as a failure names them. */
export const GROUP_OPERATIONS = {
  describeSecurityGroups: 'DescribeSecurityGroups',
  describeSecurityGroupRules: 'DescribeSecurityGroupRules',
  deleteSecurityGroup: 'DeleteSecurityGroup',
  revokeSecurityGroupIngress: 'RevokeSecurityGroupIngress',
  revokeSecurityGroupEgress: 'RevokeSecurityGroupEgress',
} as const;

/** How many groups one page of S4 asks for. */
export const GROUPS_PAGE_SIZE = 50;

/** How many rules one page of S6's "Rules" asks for. */
export const RULES_PAGE_SIZE = 100;

/** The code the emulator answers for a group it does not hold. */
const NOT_FOUND = 'InvalidGroup.NotFound';

/** A security group as S4 and S6 show it. A value the answer lacks is absent. */
export interface SecurityGroup {
  id: string;
  name: string;
  description?: string;
  vpcId?: string;
  arn?: string;
}

/** What a rule lets in or out: an IPv4 range, an IPv6 range, or another group by its ID. */
export interface RulePeer {
  kind: 'ipv4' | 'ipv6' | 'group';
  value: string;
}

/** A rule of a group as S6 shows it. */
export interface SecurityGroupRule {
  id: string;
  /** An outbound rule. */
  egress: boolean;
  /** `IpProtocol` as the API gives it: `tcp`, `udp`, `icmp`, `-1`, or a number. */
  protocol: string;
  fromPort?: number;
  toPort?: number;
  /** The source of an inbound rule, the destination of an outbound one. */
  peer?: RulePeer;
  description?: string;
}

/** One page of a listing and its token. */
export interface GroupPage {
  groups: SecurityGroup[];
  nextToken?: string;
}

export interface RulePage {
  rules: SecurityGroupRule[];
  nextToken?: string;
}

function groupOf(raw: SdkSecurityGroup): SecurityGroup | undefined {
  const id = text(raw.GroupId);
  if (id === undefined) {
    return undefined;
  }
  const group: SecurityGroup = { id, name: raw.GroupName ?? '' };
  const description = text(raw.Description);
  const vpcId = text(raw.VpcId);
  const arn = text(raw.SecurityGroupArn);
  if (description !== undefined) group.description = description;
  if (vpcId !== undefined) group.vpcId = vpcId;
  if (arn !== undefined) group.arn = arn;
  return group;
}

function groupsOf(raw: readonly SdkSecurityGroup[] | undefined): SecurityGroup[] {
  return (raw ?? []).flatMap((one) => {
    const group = groupOf(one);
    return group === undefined ? [] : [group];
  });
}

function peerOf(raw: SdkRule): RulePeer | undefined {
  const ipv4 = text(raw.CidrIpv4);
  if (ipv4 !== undefined) return { kind: 'ipv4', value: ipv4 };
  const ipv6 = text(raw.CidrIpv6);
  if (ipv6 !== undefined) return { kind: 'ipv6', value: ipv6 };
  const group = text(raw.ReferencedGroupInfo?.GroupId);
  if (group !== undefined) return { kind: 'group', value: group };
  return undefined;
}

function ruleOf(raw: SdkRule): SecurityGroupRule | undefined {
  const id = text(raw.SecurityGroupRuleId);
  if (id === undefined) {
    return undefined;
  }
  const rule: SecurityGroupRule = { id, egress: raw.IsEgress === true, protocol: raw.IpProtocol ?? '' };
  if (typeof raw.FromPort === 'number') rule.fromPort = raw.FromPort;
  if (typeof raw.ToPort === 'number') rule.toPort = raw.ToPort;
  const peer = peerOf(raw);
  if (peer !== undefined) rule.peer = peer;
  const description = text(raw.Description);
  if (description !== undefined) rule.description = description;
  return rule;
}

/**
 * S4's page: `DescribeSecurityGroups` with `MaxResults` 50, the page's token, and the filter `group-name` with `*`
 * around `name` when it is not empty. The emulator gives a token with the last group too.
 */
export async function listSecurityGroups(
  endpoint: string,
  name: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<GroupPage> {
  const output = await sendEc2(
    endpoint,
    GROUP_OPERATIONS.describeSecurityGroups,
    (client, abortSignal) =>
      client.send(
        new DescribeSecurityGroupsCommand({
          MaxResults: GROUPS_PAGE_SIZE,
          ...(name === '' ? {} : { Filters: [{ Name: 'group-name', Values: [`*${name}*`] }] }),
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: GroupPage = { groups: groupsOf(output.SecurityGroups) };
  const next = text(output.NextToken);
  if (next !== undefined) page.nextToken = next;
  return page;
}

/** A group read: the group, or "not found". */
export type GroupRead = { found: true; group: SecurityGroup } | { found: false };

/** S6's read: `DescribeSecurityGroups` by `GroupIds`; `InvalidGroup.NotFound` is "not found", not a failure. */
export async function getSecurityGroup(endpoint: string, id: string, signal: AbortSignal): Promise<GroupRead> {
  try {
    const output = await sendEc2(
      endpoint,
      GROUP_OPERATIONS.describeSecurityGroups,
      (client, abortSignal) => client.send(new DescribeSecurityGroupsCommand({ GroupIds: [id] }), { abortSignal }),
      signal,
    );
    const group = groupsOf(output.SecurityGroups).find((candidate) => candidate.id === id);
    return group === undefined ? { found: false } : { found: true, group };
  } catch (error) {
    if (error instanceof RequestError && error.failure.kind === 'other' && error.failure.code === NOT_FOUND) {
      return { found: false };
    }
    throw error;
  }
}

/** S6's rules page: `DescribeSecurityGroupRules` with the filter `group-id`, `MaxResults` 100 and the token. */
export async function listSecurityGroupRules(
  endpoint: string,
  groupId: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<RulePage> {
  const output = await sendEc2(
    endpoint,
    GROUP_OPERATIONS.describeSecurityGroupRules,
    (client, abortSignal) =>
      client.send(
        new DescribeSecurityGroupRulesCommand({
          Filters: [{ Name: 'group-id', Values: [groupId] }],
          MaxResults: RULES_PAGE_SIZE,
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: RulePage = {
    rules: (output.SecurityGroupRules ?? []).flatMap((raw) => {
      const rule = ruleOf(raw);
      return rule === undefined ? [] : [rule];
    }),
  };
  const next = text(output.NextToken);
  if (next !== undefined) page.nextToken = next;
  return page;
}

/** "Delete" of a group: `DeleteSecurityGroup` with its ID. */
export async function deleteSecurityGroup(endpoint: string, id: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    GROUP_OPERATIONS.deleteSecurityGroup,
    (client, abortSignal) => client.send(new DeleteSecurityGroupCommand({ GroupId: id }), { abortSignal }),
    signal,
  );
}

/** The operation that deletes a rule of its direction. */
export function revokeOperation(egress: boolean): string {
  return egress ? GROUP_OPERATIONS.revokeSecurityGroupEgress : GROUP_OPERATIONS.revokeSecurityGroupIngress;
}

/** "Delete" of a rule: the revoke of its direction, with the group's ID and the one rule ID. */
export async function deleteSecurityGroupRule(
  endpoint: string,
  groupId: string,
  rule: Pick<SecurityGroupRule, 'id' | 'egress'>,
  signal: AbortSignal,
): Promise<void> {
  const input = { GroupId: groupId, SecurityGroupRuleIds: [rule.id] };
  await sendEc2(
    endpoint,
    revokeOperation(rule.egress),
    (client, abortSignal) =>
      rule.egress
        ? client.send(new RevokeSecurityGroupEgressCommand(input), { abortSignal })
        : client.send(new RevokeSecurityGroupIngressCommand(input), { abortSignal }),
    signal,
  );
}
