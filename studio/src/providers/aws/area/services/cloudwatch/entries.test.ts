import { expect, it } from 'vitest';

import { entryFaults, entryHasScreen } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const folder = 'cloudwatch';
const screens = collectScreens([{ folder, screens: SCREENS }]);
const entries = ENTRIES.flatMap(({ entries }) => entries);

it('lists the seven entries in order in one unnamed group', () => {
  expect(ENTRIES.map(({ name, subService }) => [name, subService])).toEqual([[undefined, undefined]]);
  expect(entries.map(({ label, path, listedBy }) => [label, path, listedBy])).toEqual([
    ['Alarms', '/aws/cloudwatch/alarms', 'DescribeAlarms'],
    ['Alarm mute rules', '/aws/cloudwatch/alarm-mute-rules', 'ListAlarmMuteRules'],
    ['Anomaly detectors', '/aws/cloudwatch/anomaly-detectors', 'DescribeAnomalyDetectors'],
    ['Dashboards', '/aws/cloudwatch/dashboards', 'ListDashboards'],
    ['Insight rules', '/aws/cloudwatch/insight-rules', 'DescribeInsightRules'],
    ['Metric streams', '/aws/cloudwatch/metric-streams', 'ListMetricStreams'],
    ['Metrics', '/aws/cloudwatch/metrics', 'ListMetrics'],
  ]);
});

it('meets the area entry rules for this service', () => {
  expect(entryFaults([{ folder, groups: ENTRIES }], screens)).toEqual([]);
});

it('builds only the Alarms entry and serves its list at both paths', () => {
  const built = entries.filter(({ path }) => entryHasScreen(screens, '/cloudwatch', path));
  expect(built.map(({ label }) => label)).toEqual(['Alarms']);
  const list = SCREENS.find(({ paths }) => paths.includes('/aws/cloudwatch'));
  expect(list?.title).toBe('Alarms');
  expect(SCREENS.find(({ paths }) => paths.includes('/aws/cloudwatch/alarms'))).toBe(list);
});
