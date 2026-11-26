import { describe, expect, it } from 'vitest';

import { entryFaults, entryHasScreen } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const folder = 'logs';
const service = '/logs';
const screens = collectScreens([{ folder, screens: SCREENS }]);
const entries = ENTRIES.flatMap((group) => group.entries);

const requiredEntries = [
  ['Log groups', '/aws/logs/log-groups', 'ListLogGroups'],
  ['Log streams', '/aws/logs/log-streams', 'DescribeLogStreams'],
  ['Deliveries', '/aws/logs/deliveries', 'DescribeDeliveries'],
  ['Delivery destinations', '/aws/logs/delivery-destinations', 'DescribeDeliveryDestinations'],
  ['Delivery sources', '/aws/logs/delivery-sources', 'DescribeDeliverySources'],
  ['Destinations', '/aws/logs/destinations', 'DescribeDestinations'],
  ['Export tasks', '/aws/logs/export-tasks', 'DescribeExportTasks'],
  ['Import tasks', '/aws/logs/import-tasks', 'DescribeImportTasks'],
  ['Index policies', '/aws/logs/index-policies', 'DescribeIndexPolicies'],
  ['Integrations', '/aws/logs/integrations', 'ListIntegrations'],
  ['Log anomaly detectors', '/aws/logs/log-anomaly-detectors', 'ListLogAnomalyDetectors'],
  ['Lookup tables', '/aws/logs/lookup-tables', 'DescribeLookupTables'],
  ['Metric filters', '/aws/logs/metric-filters', 'DescribeMetricFilters'],
  ['Queries', '/aws/logs/queries', 'DescribeQueries'],
  ['Query definitions', '/aws/logs/query-definitions', 'DescribeQueryDefinitions'],
  ['Resource policies', '/aws/logs/resource-policies', 'DescribeResourcePolicies'],
  ['Scheduled queries', '/aws/logs/scheduled-queries', 'ListScheduledQueries'],
  ['Subscription filters', '/aws/logs/subscription-filters', 'DescribeSubscriptionFilters'],
];

describe('CloudWatch Logs entries', () => {
  it('lists the required entries in order in one unnamed group', () => {
    expect(ENTRIES.map(({ name, subService }) => [name, subService])).toEqual([[undefined, undefined]]);
    expect(entries.map(({ label, path, listedBy }) => [label, path, listedBy])).toEqual(requiredEntries);
  });

  it('lists the scoped entries inside Log groups', () => {
    const scopedEntries = entries.filter(({ listedInside }) => listedInside !== undefined);
    expect(scopedEntries.map(({ label, listedInside }) => [label, listedInside])).toEqual([
      ['Log streams', '/aws/logs/log-groups'],
      ['Index policies', '/aws/logs/log-groups'],
      ['Subscription filters', '/aws/logs/log-groups'],
    ]);
  });

  it('follows the area entry rules for this service', () => {
    expect(entryFaults([{ folder, groups: ENTRIES }], screens)).toEqual([]);
  });

  it('records where Log streams are shown inside a log group', () => {
    const streams = entries.find(({ path }) => path === '/aws/logs/log-streams');
    expect(streams?.shownIn).toEqual({
      entry: '/aws/logs/log-groups',
      place: 'the "Log streams" section of a log group',
    });
  });

  it('has screens for Log groups and Log streams', () => {
    const builtEntries = entries.filter(({ path }) => entryHasScreen(screens, service, path));
    expect(builtEntries.map(({ label }) => label)).toEqual(['Log groups', 'Log streams']);
  });

  it('registers the group list at both the service route and its entry path', () => {
    const list = SCREENS.find((screen) => screen.paths.includes('/aws/logs'));
    expect(list?.title).toBe('Log groups');
    expect(SCREENS.find((screen) => screen.paths.includes('/aws/logs/log-groups'))).toBe(list);
  });
});
