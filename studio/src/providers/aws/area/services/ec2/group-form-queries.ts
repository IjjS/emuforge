import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { noEndpoint } from '../../components/use-token-listing';
import { addSecurityGroupRule, createSecurityGroup, type NewRule, type NewSecurityGroup } from './group-form-api';
import { EC2_KEYS } from './queries';

// S5's create and S7's add as hooks (issue 553, design task 4): once `CreateSecurityGroup` succeeds the group lists
// and the group choices are read again; once a rule is added, that group's rules. A call that failed changed
// nothing, and nothing is read again.

/** Creates `group` and answers the new group's ID. */
export function useCreateSecurityGroup(
  endpoint: string | undefined,
): (group: NewSecurityGroup, signal: AbortSignal) => Promise<string> {
  const client = useQueryClient();
  return useCallback(
    async (group: NewSecurityGroup, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const id = await createSecurityGroup(endpoint, group, signal);
      const lists = { queryKey: EC2_KEYS.securityGroups() };
      const choices = { queryKey: EC2_KEYS.choices('security-groups') };
      await Promise.all([client.cancelQueries(lists), client.cancelQueries(choices)]);
      void client.invalidateQueries(lists);
      void client.invalidateQueries(choices);
      return id;
    },
    [endpoint, client],
  );
}

/** Adds `rule` to the group `groupId`. */
export function useAddRule(
  endpoint: string | undefined,
): (groupId: string, rule: NewRule, signal: AbortSignal) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (groupId: string, rule: NewRule, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      await addSecurityGroupRule(endpoint, groupId, rule, signal);
      const rules = { queryKey: EC2_KEYS.rules(groupId) };
      await client.cancelQueries(rules);
      void client.invalidateQueries(rules);
    },
    [endpoint, client],
  );
}
