import type { MetricAlarm } from '@aws-sdk/client-cloudwatch';
import { expect, it } from 'vitest';

import { alarmConditionText, alarmsFromAnswer, isEditableAlarm, type Alarm } from './alarm';

const metric: MetricAlarm = {
  Namespace: 'App',
  MetricName: 'Errors',
  Period: 60,
  EvaluationPeriods: 3,
  Threshold: 0,
  ComparisonOperator: 'GreaterThanThreshold',
  Statistic: 'Sum',
};

it('combines the three answer lists in name order by code point and labels their types', () => {
  expect(
    alarmsFromAnswer({
      MetricAlarms: [
        { AlarmName: '😀' },
        { AlarmName: '_math', Metrics: [] },
        { AlarmName: 'é', EvaluationCriteria: { PromQLCriteria: { Query: 'up' } } },
      ],
      CompositeAlarms: [{ AlarmName: 'Ｚ' }, { AlarmName: 'Z' }],
      LogAlarms: [{ AlarmName: 'a' }],
    }).map(({ type, data }) => [type, data.AlarmName]),
  ).toEqual([
    ['composite', 'Z'],
    ['metric-math', '_math'],
    ['log', 'a'],
    ['metric', 'é'],
    ['composite', 'Ｚ'],
    ['metric', '😀'],
  ]);
});

it.each([
  { alarm: { type: 'metric', data: metric }, text: 'Errors greater than 0 (3 out of 3 periods, 1 minute each)' },
  {
    alarm: { type: 'metric', data: { ...metric, DatapointsToAlarm: 2 } },
    text: 'Errors greater than 0 (2 out of 3 periods, 1 minute each)',
  },
  {
    alarm: { type: 'metric-math', data: { Metrics: [{ Id: 'm1' }, { Id: 'e1', Expression: 'm1 / 10' }] } },
    text: 'm1 / 10',
  },
  { alarm: { type: 'composite', data: { AlarmRule: 'ALARM("one")' } }, text: 'ALARM("one")' },
  {
    alarm: {
      type: 'log',
      data: {
        ScheduledQueryConfiguration: {
          QueryString: 'fields @message',
          ScheduledQueryRoleARN: undefined,
          ScheduleConfiguration: undefined,
          AggregationExpression: undefined,
        },
      },
    },
    text: 'fields @message',
  },
  {
    alarm: { type: 'metric', data: { EvaluationCriteria: { PromQLCriteria: { Query: 'sum(up)' } } } },
    text: 'sum(up)',
  },
] satisfies { alarm: Alarm; text: string }[])('writes the condition $text for the alarm', ({ alarm, text }) => {
  expect(alarmConditionText(alarm)).toBe(text);
});

it('edits a complete fixed-threshold metric alarm with a standard or extended statistic', () => {
  expect(isEditableAlarm({ type: 'metric', data: metric })).toBe(true);
  expect(isEditableAlarm({ type: 'metric', data: { ...metric, Statistic: undefined, ExtendedStatistic: 'p99' } })).toBe(
    true,
  );
});

it.each([
  'Namespace',
  'MetricName',
  'Period',
  'EvaluationPeriods',
  'Threshold',
  'ComparisonOperator',
  'Statistic',
] as const)('does not edit a row without %s', (key) => {
  expect(isEditableAlarm({ type: 'metric', data: { ...metric, [key]: undefined } })).toBe(false);
});

it.each<Partial<MetricAlarm>>([
  { ComparisonOperator: 'LessThanLowerThreshold' },
  { ComparisonOperator: 'GreaterThanUpperThreshold' },
  { ComparisonOperator: 'LessThanLowerOrGreaterThanUpperThreshold' },
  { Metrics: [] },
  { ThresholdMetricId: 'b1' },
  { EvaluationCriteria: { PromQLCriteria: { Query: 'up' } } },
])('does not edit a metric row with %j', (members) => {
  expect(isEditableAlarm({ type: 'metric', data: { ...metric, ...members } })).toBe(false);
});

it('does not edit metric math, composite or log alarms', () => {
  expect(isEditableAlarm({ type: 'metric-math', data: { ...metric, Metrics: [] } })).toBe(false);
  expect(isEditableAlarm({ type: 'composite', data: {} })).toBe(false);
  expect(isEditableAlarm({ type: 'log', data: {} })).toBe(false);
});
