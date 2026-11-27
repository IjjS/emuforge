import { ListMetricsCommand, type ListMetricsCommandInput, type Metric } from '@aws-sdk/client-cloudwatch';

import type { MetricDimension } from './alarm-form';
import { sendCloudWatch } from './clients';

export const LIST_METRICS = 'ListMetrics';

export interface NamespaceChoice {
  name: string;
  metricCount: number;
}

export interface MetricChoice {
  name: string;
  dimensionSetCount: number;
}

function compare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function dimensionSetKey(dimensions: readonly MetricDimension[]): string {
  const pairs = dimensions.map(({ Name, Value }) => [Name, Value] as const);
  pairs.sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
  return JSON.stringify(pairs);
}

function dimensionSets(metrics: Metric[]): MetricDimension[][] {
  const sets = new Map<string, MetricDimension[]>();
  for (const { Dimensions = [] } of metrics) {
    const dimensions = Dimensions.flatMap(({ Name, Value }) =>
      Name === undefined || Value === undefined ? [] : [{ Name, Value }],
    );
    if (dimensions.length !== Dimensions.length) continue;
    dimensions.sort((a, b) => compare(a.Name, b.Name) || compare(a.Value, b.Value));
    sets.set(dimensionSetKey(dimensions), dimensions);
  }
  return [...sets.values()];
}

async function readMetrics(
  endpoint: string,
  filters: Pick<ListMetricsCommandInput, 'Namespace' | 'MetricName'>,
  signal: AbortSignal,
): Promise<Metric[]> {
  const metrics: Metric[] = [];
  let token: string | undefined;
  do {
    signal.throwIfAborted();
    const command = new ListMetricsCommand({ ...filters, ...(token === undefined ? {} : { NextToken: token }) });
    const answer = await sendCloudWatch(
      endpoint,
      LIST_METRICS,
      (client, abortSignal) => client.send(command, { abortSignal }),
      signal,
    );
    metrics.push(...(answer.Metrics ?? []));
    token = answer.NextToken;
  } while (token);
  signal.throwIfAborted();
  return metrics;
}

export async function listNamespaces(endpoint: string, signal: AbortSignal): Promise<NamespaceChoice[]> {
  const namespaces = new Map<string, Set<string>>();
  for (const { Namespace, MetricName } of await readMetrics(endpoint, {}, signal)) {
    if (!Namespace || !MetricName) continue;
    const names = namespaces.get(Namespace) ?? new Set<string>();
    names.add(MetricName);
    namespaces.set(Namespace, names);
  }
  return [...namespaces.keys()].sort(compare).map((name) => ({
    name,
    metricCount: namespaces.get(name)?.size ?? 0,
  }));
}

export async function listMetricNames(
  endpoint: string,
  namespace: string,
  signal: AbortSignal,
): Promise<MetricChoice[]> {
  const byName = new Map<string, Metric[]>();
  for (const metric of await readMetrics(endpoint, { Namespace: namespace }, signal)) {
    const name = metric.MetricName;
    if (metric.Namespace !== namespace || !name) continue;
    const matches = byName.get(name) ?? [];
    matches.push(metric);
    byName.set(name, matches);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([name, metrics]) => ({
      name,
      dimensionSetCount: dimensionSets(metrics).length,
    }));
}

export async function listDimensionSets(
  endpoint: string,
  namespace: string,
  name: string,
  signal: AbortSignal,
): Promise<MetricDimension[][]> {
  const metrics = await readMetrics(endpoint, { Namespace: namespace, MetricName: name }, signal);
  return dimensionSets(metrics.filter(({ Namespace, MetricName }) => Namespace === namespace && MetricName === name));
}
