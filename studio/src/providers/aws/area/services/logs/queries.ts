import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { failureOf, noEndpoint } from '../../components/use-token-listing';
import { getLogGroup, listLogGroupTags, OPERATIONS, type LogGroupRead } from './api';

export const LOGS_KEYS = {
  groups: (pattern?: string) => (pattern === undefined ? ['logs', 'groups'] : ['logs', 'groups', pattern]),
  group: (name: string) => ['logs', 'group', name],
  tags: (name: string) => ['logs', 'tags', name],
};

interface LogsRead<T> {
  value: T | undefined;
  failure: RequestFailure | undefined;
  loading: boolean;
  refresh: () => void;
}

let mounts = 0;

function useLogsRead<T>(
  key: readonly string[],
  endpoint: string | undefined,
  enabled: boolean,
  operation: string,
  read: (endpoint: string, signal: AbortSignal) => Promise<T>,
): LogsRead<T> {
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

export function useLogGroup(endpoint: string | undefined, name: string, enabled = true): LogsRead<LogGroupRead> {
  return useLogsRead(LOGS_KEYS.group(name), endpoint, enabled, OPERATIONS.describeLogGroups, (at, signal) =>
    getLogGroup(at, name, signal),
  );
}

export function useLogGroupTags(
  endpoint: string | undefined,
  name: string,
  enabled = true,
): LogsRead<Record<string, string>> {
  return useLogsRead(LOGS_KEYS.tags(name), endpoint, enabled, OPERATIONS.listTagsLogGroup, (at, signal) =>
    listLogGroupTags(at, name, signal),
  );
}
