import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { securityGroupChoices, type SecurityGroupChoice } from '../../components/security-group-choices';
import type { ChoiceSource } from '../../components/use-paged-choices';
import { noEndpoint } from '../../components/use-token-listing';
import { listSubnetChoices, NETWORK_CHOICE_OPERATIONS, type SubnetChoice } from '../../lib/ec2-network-choices';
import { DEFINITION_CHOICE_KEYS, listRevisionChoices, type RevisionChoice } from './definition-choices';
import { ECS_KEY, ECS_KEYS } from './queries';
import { runTask, type RunOutcome } from './run-api';
import type { RunRequest } from './run-form';

// The hooks of S6, "Run task" (issue 575, design task 2): the run, which reads again what it changed; the subnet and
// security group choices, the subnets read through the area's `lib/ec2-network-choices.ts` and the groups the area's
// `components/security-group-choices.ts`; and the first page of a choice, read at once, so a field that has nothing
// to offer says why before it is opened.

/** The root of S6's subnet choices. */
const SUBNETS_KEY = [...ECS_KEY, 'choices', 'subnets'] as const;

/**
 * The subnets, of the VPC `vpcId` when it is given: each its id, with its VPC and Availability Zone as its
 * description. The field takes no typed text.
 */
export function runSubnetChoices(endpoint: string | undefined, vpcId: string | undefined): ChoiceSource<SubnetChoice> {
  return {
    key: [...SUBNETS_KEY, vpcId ?? null],
    endpoint,
    operation: NETWORK_CHOICE_OPERATIONS.describeSubnets,
    filtering: 'none',
    read: async (at, _text, token, signal) => {
      const page = await listSubnetChoices(at, token, signal, vpcId);
      return page.nextToken === undefined ? { items: page.choices } : { items: page.choices, next: page.nextToken };
    },
    optionOf: (subnet) => {
      const description = [subnet.vpcId, subnet.zone].filter((each) => each !== undefined).join(', ');
      return description === ''
        ? { value: subnet.id, label: subnet.id }
        : { value: subnet.id, label: subnet.id, description };
    },
  };
}

/** The security groups of the VPC `vpcId`, as the area offers them; not ready, asking nothing, while it is none. */
export function runGroupChoices(
  endpoint: string | undefined,
  vpcId: string | undefined,
): ChoiceSource<SecurityGroupChoice> {
  const given = vpcId !== undefined && vpcId !== '';
  return { ...securityGroupChoices(endpoint, given ? vpcId : undefined), ready: given };
}

/**
 * Runs `request` and answers what `RunTask` started. Once it started a task or more, the cluster's read and every
 * read of the cluster's tasks are read again, so S3 and S5 open on counts of after the run; a refusal, and an answer
 * that started none, change nothing held.
 */
export function useRunTask(
  endpoint: string | undefined,
): (request: RunRequest, signal: AbortSignal) => Promise<RunOutcome> {
  const client = useQueryClient();
  return useCallback(
    async (request: RunRequest, signal: AbortSignal) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const outcome = await runTask(endpoint, request, signal);
      if (outcome.taskIds.length > 0) {
        void client.invalidateQueries({ queryKey: ECS_KEYS.cluster(request.cluster) });
        void client.invalidateQueries({ queryKey: ECS_KEYS.clusterTasks(request.cluster) });
      }
      return outcome;
    },
    [endpoint, client],
  );
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/**
 * Whether `source` has a choice to offer: its first page, read at once on mount. `undefined` while it is read, waits,
 * or failed (a failure is the field's own to show once it is opened).
 */
export function useHasChoices<T>(source: ChoiceSource<T>): boolean | undefined {
  const [mount] = useState(() => (mounts += 1));
  const { endpoint, read, ready = true } = source;
  const query = useQuery({
    queryKey: [...source.key, 'first', endpoint, mount],
    queryFn: async ({ signal }) =>
      endpoint === undefined ? noEndpoint() : (await read(endpoint, '', undefined, signal)).items.length > 0,
    enabled: endpoint !== undefined && ready,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return query.isSuccess ? query.data : undefined;
}

/** The newest active revision of `family`, read once it is given; `undefined` until then, or when it has none. */
export function useNewestRevision(
  endpoint: string | undefined,
  family: string | undefined,
): RevisionChoice | undefined {
  const [mount] = useState(() => (mounts += 1));
  const given = family !== undefined && family !== '';
  const query = useQuery({
    queryKey: [...DEFINITION_CHOICE_KEYS.revisions, family ?? '', 'newest', endpoint, mount],
    queryFn: async ({ signal }) =>
      endpoint === undefined || !given
        ? noEndpoint()
        : ((await listRevisionChoices(endpoint, family, undefined, signal)).items[0] ?? null),
    enabled: endpoint !== undefined && given,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return query.isSuccess ? (query.data ?? undefined) : undefined;
}
