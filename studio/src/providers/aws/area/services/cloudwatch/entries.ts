import type { EntryGroup } from '../../entries';
import { ALARMS_PATH, CLOUDWATCH_PATH } from './paths';

export const ENTRIES: readonly EntryGroup[] = [
  {
    entries: [
      { label: 'Alarms', path: ALARMS_PATH, listedBy: 'DescribeAlarms' },
      { label: 'Alarm mute rules', path: `${CLOUDWATCH_PATH}/alarm-mute-rules`, listedBy: 'ListAlarmMuteRules' },
      {
        label: 'Anomaly detectors',
        path: `${CLOUDWATCH_PATH}/anomaly-detectors`,
        listedBy: 'DescribeAnomalyDetectors',
      },
      { label: 'Dashboards', path: `${CLOUDWATCH_PATH}/dashboards`, listedBy: 'ListDashboards' },
      { label: 'Insight rules', path: `${CLOUDWATCH_PATH}/insight-rules`, listedBy: 'DescribeInsightRules' },
      { label: 'Metric streams', path: `${CLOUDWATCH_PATH}/metric-streams`, listedBy: 'ListMetricStreams' },
      { label: 'Metrics', path: `${CLOUDWATCH_PATH}/metrics`, listedBy: 'ListMetrics' },
    ],
  },
];
