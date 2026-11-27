// @vitest-environment node
import { CloudWatchClient, ListMetricsCommand, type ListMetricsCommandOutput } from '@aws-sdk/client-cloudwatch';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { listDimensionSets, listMetricNames, listNamespaces } from './metric-api';

const endpoint = 'http://127.0.0.1:9682';
const signal = () => new AbortController().signal;
const answer = vi.fn<() => ListMetricsCommandOutput>();
const requests: ListMetricsCommand['input'][] = [];
const host = { Name: 'Host', Value: 'a' };
const zone = { Name: 'Zone', Value: 'b' };

beforeEach(() => {
  requests.length = 0;
  answer.mockReset();
  vi.spyOn(CloudWatchClient.prototype, 'send').mockImplementation(async (command) => {
    if (!(command instanceof ListMetricsCommand)) throw new Error('Expected ListMetricsCommand');
    requests.push(command.input);
    return answer();
  });
});

afterEach(() => vi.restoreAllMocks());

it('lists distinct namespaces and counts names across all API pages in name order', async () => {
  answer.mockReturnValueOnce({
    $metadata: {},
    Metrics: [
      { Namespace: 'Z', MetricName: 'Jobs' },
      { Namespace: 'A', MetricName: 'Load' },
    ],
    NextToken: 'next',
  });
  answer.mockReturnValueOnce({
    $metadata: {},
    Metrics: [
      { Namespace: 'A', MetricName: 'Load', Dimensions: [host] },
      { Namespace: 'A', MetricName: 'Jobs' },
    ],
  });
  await expect(listNamespaces(endpoint, signal())).resolves.toEqual([
    { name: 'A', metricCount: 2 },
    { name: 'Z', metricCount: 1 },
  ]);
  expect(requests).toEqual([{}, { NextToken: 'next' }]);
});

it('lists unique metric names in the chosen namespace, with dimension sets counted across its pages', async () => {
  answer.mockReturnValueOnce({
    $metadata: {},
    Metrics: [
      { Namespace: 'A', MetricName: 'Load', Dimensions: [host, zone] },
      { Namespace: 'A', MetricName: 'Jobs' },
    ],
    NextToken: 'next',
  });
  answer.mockReturnValueOnce({
    $metadata: {},
    Metrics: [
      { Namespace: 'A', MetricName: 'Load', Dimensions: [zone, host] },
      { Namespace: 'A', MetricName: 'Load' },
    ],
  });
  await expect(listMetricNames(endpoint, 'A', signal())).resolves.toEqual([
    { name: 'Jobs', dimensionSetCount: 1 },
    { name: 'Load', dimensionSetCount: 2 },
  ]);
  expect(requests).toEqual([{ Namespace: 'A' }, { Namespace: 'A', NextToken: 'next' }]);
});

it('lists unique sets for the chosen metric, including the empty set', async () => {
  answer.mockReturnValueOnce({
    $metadata: {},
    Metrics: [{ Namespace: 'A', MetricName: 'Load', Dimensions: [zone, host] }],
    NextToken: 'next',
  });
  answer.mockReturnValueOnce({
    $metadata: {},
    Metrics: [
      { Namespace: 'A', MetricName: 'Load', Dimensions: [host, zone] },
      { Namespace: 'A', MetricName: 'Load' },
    ],
  });
  await expect(listDimensionSets(endpoint, 'A', 'Load', signal())).resolves.toEqual([[host, zone], []]);
  expect(requests).toEqual([
    { Namespace: 'A', MetricName: 'Load' },
    { Namespace: 'A', MetricName: 'Load', NextToken: 'next' },
  ]);
});

it('names ListMetrics when a later page fails', async () => {
  answer.mockReturnValueOnce({ $metadata: {}, NextToken: 'next' });
  answer.mockImplementationOnce(() => {
    throw { $metadata: { httpStatusCode: 501 } };
  });
  await expect(listNamespaces(endpoint, signal())).rejects.toMatchObject({
    failure: { kind: 'not-implemented', operation: 'ListMetrics' },
  });
});

it('stops when the signal aborts between pages', async () => {
  const controller = new AbortController();
  const reason = new DOMException('Cancelled between pages', 'AbortError');
  answer.mockReturnValueOnce({
    $metadata: {},
    get NextToken() {
      controller.abort(reason);
      return 'next';
    },
  });
  await expect(listNamespaces(endpoint, controller.signal)).rejects.toBe(reason);
  expect(requests).toEqual([{}]);
});
