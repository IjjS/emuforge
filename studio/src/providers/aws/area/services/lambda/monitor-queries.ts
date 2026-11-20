import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { defaultLogGroup, readLogPage, readMetricTotal, type FunctionMetric } from './monitor-api';
import { lambdaKey } from './queries';

const HOUR_MS = 60 * 60 * 1_000;

export function useMonitorReadings(endpoint: string, name: string, logGroup: string | undefined) {
  const visit = useId();
  const [window] = useState(() => {
    const end = Date.now();
    return { start: new Date(end - HOUR_MS), end: new Date(end) };
  });
  const key = [...lambdaKey(endpoint), 'monitor', name, visit];
  const group = defaultLogGroup(name);
  const customGroup = logGroup !== undefined && logGroup !== group;

  const logs = useInfiniteQuery({
    queryKey: [...key, 'logs', group],
    queryFn: ({ pageParam, signal }) => readLogPage(endpoint, group, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.kind === 'events' ? page.next : undefined),
    enabled: !customGroup,
    retry: false,
    gcTime: 0,
  });

  function metricOptions(metric: FunctionMetric) {
    return {
      queryKey: [...key, 'metric', metric, window.start.getTime(), window.end.getTime()],
      queryFn: ({ signal }: { signal: AbortSignal }) => readMetricTotal(endpoint, name, metric, window, signal),
      retry: false,
      gcTime: 0,
    };
  }

  const invocations = useQuery(metricOptions('Invocations'));
  const errors = useQuery(metricOptions('Errors'));
  return { logs, invocations, errors, customGroup };
}
