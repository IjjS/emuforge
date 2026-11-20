import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import {
  deleteSecurityGroup,
  deleteSecurityGroupRule,
  getSecurityGroup,
  GROUP_OPERATIONS,
  listSecurityGroupRules,
  listSecurityGroups,
  type GroupRead,
  type SecurityGroup,
  type SecurityGroupRule,
} from './group-api';
import { EC2_KEYS, type Ec2Read } from './queries';

// The TanStack Query hooks of S4 and S6 (issue 553, design task 4), under the keys of `queries.ts`. Every read is a
// request of its own on every mount, "Refresh" and "Retry", under a key that holds its filter and token; a read no
// longer wanted is aborted, and its late answer changes nothing shown. A delete reads again what it changed.

/** S4: the groups, a page of `DescribeSecurityGroups` at a time on its tokens; a changed name starts from page 1. */
export function useGroupListing(endpoint: string | undefined, name: string): TokenListing<SecurityGroup> {
  return useTokenListing({
    key: EC2_KEYS.securityGroups(name),
    endpoint,
    operation: GROUP_OPERATIONS.describeSecurityGroups,
    read: async (at, token, signal) => {
      const page = await listSecurityGroups(at, name, token, signal);
      return page.nextToken === undefined ? { items: page.groups } : { items: page.groups, next: page.nextToken };
    },
  });
}

/** S6: the rules of the group `groupId`, a page of `DescribeSecurityGroupRules` at a time on its tokens. */
export function useRuleListing(endpoint: string | undefined, groupId: string): TokenListing<SecurityGroupRule> {
  return useTokenListing({
    key: EC2_KEYS.rules(groupId),
    endpoint,
    operation: GROUP_OPERATIONS.describeSecurityGroupRules,
    read: async (at, token, signal) => {
      const page = await listSecurityGroupRules(at, groupId, token, signal);
      return page.nextToken === undefined ? { items: page.rules } : { items: page.rules, next: page.nextToken };
    },
  });
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** S6's read of the group `id`: the group, or "not found". */
export function useSecurityGroup(endpoint: string | undefined, id: string): Ec2Read<GroupRead> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...EC2_KEYS.securityGroup(id), endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getSecurityGroup(endpoint, id, signal)),
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const value = query.isError ? undefined : query.data;
  return {
    value,
    failure: query.isError ? failureOf(query.error, GROUP_OPERATIONS.describeSecurityGroups) : undefined,
    loading: endpoint === undefined || (value === undefined && !query.isError),
    refresh,
  };
}

/** "Delete" of a group. Once it succeeds the group lists and the group choices are read again. */
export function useDeleteGroup(endpoint: string | undefined): (id: string, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (id: string, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteSecurityGroup(endpoint, id, signal);
      void client.invalidateQueries({ queryKey: EC2_KEYS.securityGroups() });
      void client.invalidateQueries({ queryKey: EC2_KEYS.choices('security-groups') });
    },
    [endpoint, client],
  );
}

/** "Delete" of a rule of the group `groupId`. Once it succeeds that group's rules are read again. */
export function useDeleteRule(
  endpoint: string | undefined,
): (groupId: string, rule: Pick<SecurityGroupRule, 'id' | 'egress'>, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (groupId: string, rule: Pick<SecurityGroupRule, 'id' | 'egress'>, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await deleteSecurityGroupRule(endpoint, groupId, rule, signal);
      void client.invalidateQueries({ queryKey: EC2_KEYS.rules(groupId) });
    },
    [endpoint, client],
  );
}
