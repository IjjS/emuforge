import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';

import { failureOf, noEndpoint, useTokenListing } from '../../components/use-token-listing';
import { DESCRIBE_ALARM_HISTORY, LIST_ALARM_TAGS, readAlarmHistory, readAlarmTags } from './alarm-page-api';
import { DESCRIBE_ALARMS, readAlarm } from './alarms-api';

function useAlarmRead<T>(
  endpoint: string | undefined,
  argument: string | undefined,
  operation: string,
  read: (endpoint: string, argument: string, signal: AbortSignal) => Promise<T>,
) {
  const client = useQueryClient();
  const mount = useId();
  const queryKey = ['cloudwatch', operation, endpoint, argument, mount] as const;
  const enabled = endpoint !== undefined && argument !== undefined;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (endpoint === undefined || argument === undefined) noEndpoint();
      return { value: await read(endpoint, argument, signal) };
    },
    enabled,
    retry: false,
    gcTime: 0,
  });

  return {
    value: query.isError ? undefined : query.data?.value,
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: argument !== undefined && !query.isError && query.data === undefined,
    async refresh() {
      if (!enabled) return undefined;
      // refetch alone joins an initial request that has no cached data yet.
      void client.cancelQueries({ queryKey, exact: true });
      const result = await query.refetch();
      return result.isError ? { failure: failureOf(result.error, operation) } : result.data;
    },
  };
}

export function useAlarm(endpoint: string | undefined, name: string | undefined) {
  return useAlarmRead(endpoint, name, DESCRIBE_ALARMS, readAlarm);
}

export function useAlarmTags(endpoint: string | undefined, arn: string | undefined) {
  return useAlarmRead(endpoint, arn, LIST_ALARM_TAGS, readAlarmTags);
}

export function useAlarmHistory(endpoint: string | undefined, name: string | undefined) {
  return useTokenListing({
    key: ['cloudwatch', 'alarm-history', name],
    endpoint,
    enabled: name !== undefined,
    operation: DESCRIBE_ALARM_HISTORY,
    read: (origin, token, signal) =>
      name === undefined ? noEndpoint() : readAlarmHistory(origin, name, token, signal),
  });
}
