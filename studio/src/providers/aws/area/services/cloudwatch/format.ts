import type { ComparisonOperator, StateValue, Statistic } from '@aws-sdk/client-cloudwatch';

import type { AlarmType } from './alarm';

const TYPE_TEXT: Record<AlarmType, string> = {
  metric: 'Metric alarm',
  'metric-math': 'Metric math alarm',
  composite: 'Composite alarm',
  log: 'Log alarm',
};

const STATE_TEXT: Record<StateValue, string> = {
  OK: 'OK',
  ALARM: 'In alarm',
  INSUFFICIENT_DATA: 'Insufficient data',
};

const COMPARISON_TEXT: Record<ComparisonOperator, string> = {
  GreaterThanThreshold: 'Greater than',
  GreaterThanOrEqualToThreshold: 'Greater than or equal to',
  LessThanThreshold: 'Less than',
  LessThanOrEqualToThreshold: 'Less than or equal to',
  LessThanLowerOrGreaterThanUpperThreshold: 'Outside the lower and upper thresholds',
  LessThanLowerThreshold: 'Below the lower threshold',
  GreaterThanUpperThreshold: 'Above the upper threshold',
};

const STATISTIC_TEXT: Record<Statistic, string> = {
  Average: 'Average',
  Sum: 'Sum',
  Minimum: 'Minimum',
  Maximum: 'Maximum',
  SampleCount: 'Sample count',
};

export function alarmTypeText(type: AlarmType | undefined): string {
  return type === undefined ? '-' : TYPE_TEXT[type];
}

export function alarmStateText(state: StateValue | undefined): string {
  return state === undefined ? '-' : (STATE_TEXT[state] ?? state);
}

export function actionsEnabledText(enabled: boolean | undefined): string {
  return enabled === undefined ? '-' : enabled ? 'On' : 'Off';
}

export function comparisonText(comparison: ComparisonOperator | undefined): string {
  return comparison === undefined ? '-' : (COMPARISON_TEXT[comparison] ?? comparison);
}

export function statisticText(statistic: Statistic | undefined, extendedStatistic?: string): string {
  return extendedStatistic ?? (statistic === undefined ? '-' : (STATISTIC_TEXT[statistic] ?? statistic));
}

const PERIOD_UNITS = [
  { seconds: 86400, unit: 'day' },
  { seconds: 3600, unit: 'hour' },
  { seconds: 60, unit: 'minute' },
  { seconds: 1, unit: 'second' },
] as const;

export function periodText(seconds: number | undefined): string {
  if (seconds === undefined) return '-';
  const { seconds: divisor, unit } =
    PERIOD_UNITS.find((part) => seconds >= part.seconds && seconds % part.seconds === 0) ?? PERIOD_UNITS[3];
  const count = seconds / divisor;
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}
