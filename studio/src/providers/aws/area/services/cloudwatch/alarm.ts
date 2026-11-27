import type {
  ComparisonOperator,
  CompositeAlarm,
  DescribeAlarmsOutput,
  LogAlarm,
  MetricAlarm,
  Statistic,
} from '@aws-sdk/client-cloudwatch';

import { comparisonText, periodText } from './format';

export type Alarm =
  | { type: 'metric'; data: MetricAlarm }
  | { type: 'metric-math'; data: MetricAlarm }
  | { type: 'composite'; data: CompositeAlarm }
  | { type: 'log'; data: LogAlarm };

export type AlarmType = Alarm['type'];

export const FIXED_COMPARISONS = [
  'GreaterThanThreshold',
  'GreaterThanOrEqualToThreshold',
  'LessThanThreshold',
  'LessThanOrEqualToThreshold',
] as const satisfies readonly ComparisonOperator[];

type FixedComparison = (typeof FIXED_COMPARISONS)[number];

type EditableMetric = MetricAlarm & {
  Namespace: string;
  MetricName: string;
  Period: number;
  EvaluationPeriods: number;
  Threshold: number;
  ComparisonOperator: FixedComparison;
} & ({ Statistic: Statistic } | { ExtendedStatistic: string });

export type EditableAlarm = { type: 'metric'; data: EditableMetric };

function compareNames(first: string, second: string): number {
  const firstPoints = Array.from(first);
  const secondPoints = Array.from(second);
  for (const [index, part] of firstPoints.entries()) {
    const other = secondPoints[index];
    if (other === undefined) return 1;
    const difference = (part.codePointAt(0) ?? 0) - (other.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return firstPoints.length - secondPoints.length;
}

export function alarmsFromAnswer(answer: DescribeAlarmsOutput): Alarm[] {
  const metric: Alarm[] = (answer.MetricAlarms ?? []).map((data) => ({
    type: data.Metrics === undefined ? 'metric' : 'metric-math',
    data,
  }));
  const composite: Alarm[] = (answer.CompositeAlarms ?? []).map((data) => ({ type: 'composite', data }));
  const log: Alarm[] = (answer.LogAlarms ?? []).map((data) => ({ type: 'log', data }));
  return [...metric, ...composite, ...log].sort((a, b) => compareNames(a.data.AlarmName ?? '', b.data.AlarmName ?? ''));
}

export function isEditableAlarm(alarm: Alarm): alarm is EditableAlarm {
  if (alarm.type !== 'metric') return false;
  const data = alarm.data;
  return (
    Boolean(data.Namespace) &&
    Boolean(data.MetricName) &&
    data.Period !== undefined &&
    data.EvaluationPeriods !== undefined &&
    data.Threshold !== undefined &&
    FIXED_COMPARISONS.some((comparison) => comparison === data.ComparisonOperator) &&
    (Boolean(data.Statistic) || Boolean(data.ExtendedStatistic)) &&
    data.Metrics === undefined &&
    data.ThresholdMetricId === undefined &&
    data.EvaluationCriteria === undefined
  );
}

export function alarmConditionText(alarm: Alarm): string {
  switch (alarm.type) {
    case 'composite':
      return alarm.data.AlarmRule ?? '-';
    case 'log':
      return alarm.data.ScheduledQueryConfiguration?.QueryString ?? '-';
    case 'metric-math': {
      const expressions = alarm.data.Metrics?.flatMap(({ Expression }) => Expression ?? []) ?? [];
      return expressions.length === 0 ? '-' : expressions.join(', ');
    }
    case 'metric': {
      const {
        ComparisonOperator,
        DatapointsToAlarm,
        EvaluationCriteria,
        EvaluationPeriods,
        MetricName,
        Period,
        Threshold,
      } = alarm.data;
      const query = EvaluationCriteria?.PromQLCriteria?.Query;
      if (query !== undefined) return query;
      const comparison = ComparisonOperator === undefined ? undefined : comparisonText(ComparisonOperator);
      const evaluation =
        EvaluationPeriods === undefined
          ? undefined
          : `${String(DatapointsToAlarm ?? EvaluationPeriods)} out of ${String(EvaluationPeriods)} periods${Period === undefined ? '' : `, ${periodText(Period)} each`}`;
      const parts = [
        MetricName,
        comparison?.toLowerCase(),
        Threshold,
        evaluation === undefined ? undefined : `(${evaluation})`,
      ];
      return parts.filter((part) => part !== undefined).join(' ') || '-';
    }
  }
}
