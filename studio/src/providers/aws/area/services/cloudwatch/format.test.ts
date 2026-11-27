import type { ComparisonOperator, StateValue, Statistic } from '@aws-sdk/client-cloudwatch';
import { expect, it } from 'vitest';

import type { AlarmType } from './alarm';
import { actionsEnabledText, alarmStateText, alarmTypeText, comparisonText, periodText, statisticText } from './format';

it.each<[AlarmType, string]>([
  ['metric', 'Metric alarm'],
  ['metric-math', 'Metric math alarm'],
  ['composite', 'Composite alarm'],
  ['log', 'Log alarm'],
])('writes type %s as %s', (value, text) => {
  expect(alarmTypeText(value)).toBe(text);
});

it.each<[StateValue, string]>([
  ['OK', 'OK'],
  ['ALARM', 'In alarm'],
  ['INSUFFICIENT_DATA', 'Insufficient data'],
])('writes state %s as %s', (value, text) => {
  expect(alarmStateText(value)).toBe(text);
});

it('writes words for the actions and a hyphen for missing values', () => {
  expect(actionsEnabledText(true)).toBe('On');
  expect(actionsEnabledText(false)).toBe('Off');
  for (const format of [actionsEnabledText, alarmStateText, alarmTypeText, comparisonText, periodText, statisticText]) {
    expect(format(undefined)).toBe('-');
  }
});

it.each([
  [10, '10 seconds'],
  [20, '20 seconds'],
  [30, '30 seconds'],
  [60, '1 minute'],
  [120, '2 minutes'],
  [300, '5 minutes'],
  [900, '15 minutes'],
  [3600, '1 hour'],
  [21600, '6 hours'],
  [86400, '1 day'],
])('writes the period %s as %s', (value, text) => {
  expect(periodText(value)).toBe(text);
});

it.each<[ComparisonOperator, string]>([
  ['GreaterThanThreshold', 'Greater than'],
  ['GreaterThanOrEqualToThreshold', 'Greater than or equal to'],
  ['LessThanThreshold', 'Less than'],
  ['LessThanOrEqualToThreshold', 'Less than or equal to'],
  ['LessThanLowerOrGreaterThanUpperThreshold', 'Outside the lower and upper thresholds'],
  ['LessThanLowerThreshold', 'Below the lower threshold'],
  ['GreaterThanUpperThreshold', 'Above the upper threshold'],
])('writes comparison %s as %s', (value, text) => {
  expect(comparisonText(value)).toBe(text);
});

it.each<[Statistic, string]>([
  ['Average', 'Average'],
  ['Sum', 'Sum'],
  ['Minimum', 'Minimum'],
  ['Maximum', 'Maximum'],
  ['SampleCount', 'Sample count'],
])('writes statistic %s as %s', (value, text) => {
  expect(statisticText(value)).toBe(text);
});

it('keeps an extended statistic as entered', () => {
  expect(statisticText(undefined, 'TM(10%:90%)')).toBe('TM(10%:90%)');
});
