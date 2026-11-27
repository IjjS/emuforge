import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint } from '../../components/use-token-listing';
import { BUS_OPERATIONS, getEventBus, listResourceTags } from './bus-api';
import { RULE_OPERATIONS, getRule, listRuleTargets } from './rule-api';

interface EventsRead<T> {
  value: T | undefined;
  failure: RequestFailure | undefined;
  loading: boolean;
  refresh: () => void;
}

let mounts = 0;

function useEventsRead<T>(
  key: readonly string[],
  endpoint: string | undefined,
  enabled: boolean,
  operation: string,
  read: (endpoint: string, signal: AbortSignal) => Promise<T>,
): EventsRead<T> {
  const [mount] = useState(() => (mounts += 1));
  const [visit, setVisit] = useState(0);
  const query = useQuery({
    queryKey: [...key, endpoint, mount, visit],
    queryFn: ({ signal }) => read(endpoint ?? noEndpoint(), signal),
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  return {
    value: enabled && !query.isError ? query.data : undefined,
    failure: enabled && query.isError ? failureOf(query.error, operation) : undefined,
    loading: enabled && (endpoint === undefined || query.isPending),
    refresh: () => setVisit((current) => current + 1),
  };
}

export function useEventBus(endpoint: string | undefined, name: string, enabled = true) {
  return useEventsRead(['events', 'bus', name], endpoint, enabled, BUS_OPERATIONS.describeEventBus, (at, signal) =>
    getEventBus(at, name, signal),
  );
}

export function useResourceTags(endpoint: string | undefined, arn: string, enabled = true) {
  return useEventsRead(['events', 'tags', arn], endpoint, enabled, BUS_OPERATIONS.listTagsForResource, (at, signal) =>
    listResourceTags(at, arn, signal),
  );
}

export function useRule(endpoint: string | undefined, bus: string, name: string, enabled = true) {
  return useEventsRead(['events', 'rule', bus, name], endpoint, enabled, RULE_OPERATIONS.describeRule, (at, signal) =>
    getRule(at, bus, name, signal),
  );
}

export function useRuleTargets(endpoint: string | undefined, bus: string, name: string, enabled = true) {
  return useEventsRead(
    ['events', 'targets', bus, name],
    endpoint,
    enabled,
    RULE_OPERATIONS.listTargetsByRule,
    (at, signal) => listRuleTargets(at, bus, name, signal),
  );
}
