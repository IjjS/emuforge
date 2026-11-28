import {
  AuthorizeSecurityGroupEgressCommand,
  AuthorizeSecurityGroupIngressCommand,
  CreateSecurityGroupCommand,
  type IpPermission,
  type TagSpecification,
} from '@aws-sdk/client-ec2';

import { sendEc2, text } from '../../lib/ec2-client';
import type { TagRow } from '../../lib/tag-rows';
import type { RulePeer } from './group-api';
import { hasPorts, type RuleProtocol } from './group-form';

// The calls of S5 and S7 (issue 553, design task 4): one `CreateSecurityGroup`, and one
// `AuthorizeSecurityGroupIngress` or `AuthorizeSecurityGroupEgress` with one permission, through `sendEc2` with each
// operation's name, so a refusal rejects with its `RequestError` carrying the emulator's code and message as they
// came, and a 501 as "not implemented" with the operation. Only what was given is sent.

/** The operations of S5 and S7, as a failure names them. */
export const GROUP_FORM_OPERATIONS = {
  createSecurityGroup: 'CreateSecurityGroup',
  authorizeSecurityGroupIngress: 'AuthorizeSecurityGroupIngress',
  authorizeSecurityGroupEgress: 'AuthorizeSecurityGroupEgress',
} as const;

/** What S5 creates. */
export interface NewSecurityGroup {
  name: string;
  description: string;
  /** None sent when absent: the emulator then creates the group in the default VPC. */
  vpcId?: string;
  tags?: readonly TagRow[];
}

function tagSpecifications(resourceType: 'security-group' | 'security-group-rule', tags?: readonly TagRow[]) {
  if (tags === undefined || tags.length === 0) return {};
  const specification: TagSpecification = {
    ResourceType: resourceType,
    Tags: tags.map(({ key, value }) => ({ Key: key, Value: value })),
  };
  return { TagSpecifications: [specification] };
}

/** Creates the group and returns its ID. */
export async function createSecurityGroup(
  endpoint: string,
  group: NewSecurityGroup,
  signal: AbortSignal,
): Promise<string> {
  const output = await sendEc2(
    endpoint,
    GROUP_FORM_OPERATIONS.createSecurityGroup,
    (client, abortSignal) =>
      client.send(
        new CreateSecurityGroupCommand({
          GroupName: group.name,
          Description: group.description,
          ...tagSpecifications('security-group', group.tags),
          ...(group.vpcId === undefined || group.vpcId === '' ? {} : { VpcId: group.vpcId }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const id = text(output.GroupId);
  if (id === undefined) {
    throw new Error('CreateSecurityGroup answered with no group ID.');
  }
  return id;
}

/** What S7 adds to a group. */
export interface NewRule {
  /** An outbound rule. */
  egress: boolean;
  protocol: RuleProtocol;
  /** TCP and UDP only: the first port, and the last (the first again when absent). */
  fromPort?: number;
  toPort?: number;
  peer: RulePeer;
  description?: string;
  tags?: readonly TagRow[];
}

/** The operation that adds a rule of its direction. */
export function authorizeOperation(egress: boolean): string {
  return egress
    ? GROUP_FORM_OPERATIONS.authorizeSecurityGroupEgress
    : GROUP_FORM_OPERATIONS.authorizeSecurityGroupIngress;
}

/** The one permission `rule` is sent as: ICMP and All with every port. */
export function permissionOf(rule: NewRule): IpPermission {
  const ports = hasPorts(rule.protocol);
  const from = ports ? (rule.fromPort ?? -1) : -1;
  const to = ports ? (rule.toPort ?? from) : -1;
  const description =
    rule.description === undefined || rule.description === '' ? {} : { Description: rule.description };
  const permission: IpPermission = {
    IpProtocol: rule.protocol === 'all' ? '-1' : rule.protocol,
    FromPort: from,
    ToPort: to,
  };
  switch (rule.peer.kind) {
    case 'ipv4':
      permission.IpRanges = [{ CidrIp: rule.peer.value, ...description }];
      break;
    case 'ipv6':
      permission.Ipv6Ranges = [{ CidrIpv6: rule.peer.value, ...description }];
      break;
    case 'group':
      permission.UserIdGroupPairs = [{ GroupId: rule.peer.value, ...description }];
      break;
  }
  return permission;
}

/** Adds `rule` to the group `groupId`: the authorize of its direction, with the group's ID and one permission. */
export async function addSecurityGroupRule(
  endpoint: string,
  groupId: string,
  rule: NewRule,
  signal: AbortSignal,
): Promise<void> {
  const input = {
    GroupId: groupId,
    IpPermissions: [permissionOf(rule)],
    ...tagSpecifications('security-group-rule', rule.tags),
  };
  await sendEc2(
    endpoint,
    authorizeOperation(rule.egress),
    (client, abortSignal) =>
      rule.egress
        ? client.send(new AuthorizeSecurityGroupEgressCommand(input), { abortSignal })
        : client.send(new AuthorizeSecurityGroupIngressCommand(input), { abortSignal }),
    signal,
  );
}
