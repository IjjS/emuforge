import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render } from '@testing-library/react';
import { expect, it } from 'vitest';

import type { Alarm } from '../alarm';
import { AlarmCondition } from './alarm-condition';

function open(alarm: Alarm) {
  const { container } = render(<AlarmCondition alarm={alarm} />);
  const items = createWrapper(container).findKeyValuePairs()?.findItems();
  return new Map(items?.map((item) => [item.findLabel()?.getElement().textContent, item.findValue()]));
}

it('shows the metric, dimensions, statistic, period and evaluation condition', () => {
  const values = open({
    type: 'metric',
    data: {
      Namespace: 'Application',
      MetricName: 'Errors',
      Dimensions: [
        { Name: 'Stage', Value: 'local' },
        { Name: 'Component', Value: 'worker' },
      ],
      ExtendedStatistic: 'p99',
      Period: 60,
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 0,
      DatapointsToAlarm: 2,
      EvaluationPeriods: 3,
      TreatMissingData: 'breaching',
    },
  });
  for (const [label, value] of Object.entries({
    Namespace: 'Application',
    Metric: 'Errors',
    Dimensions: 'Stage = localComponent = worker',
    Statistic: 'p99',
    Period: '1 minute',
    Comparison: 'Greater than',
    Threshold: '0',
    'Data points to alarm': '2 out of 3',
    'Treatment of missing data': 'breaching',
  })) {
    expect(values.get(label)?.getElement().textContent).toBe(value);
  }
});

it('shows default evaluation values and only shows optional settings when supplied', () => {
  const defaults = open({ type: 'metric', data: { EvaluationPeriods: 3 } });
  expect(defaults.get('Data points to alarm')?.getElement().textContent).toBe('3 out of 3');
  expect(defaults.get('Treatment of missing data')?.getElement().textContent).toBe('Missing');
  const values = open({
    type: 'metric',
    data: {
      Unit: 'Count',
      EvaluateLowSampleCountPercentile: 'ignore',
      EvaluationWindow: { WallClockWindow: { Timezone: 'Asia/Seoul' } },
      WarmUpConfiguration: { WarmUpPeriodDurationInMinutes: 5, OnlyStartEvaluatingAfterWarmUpPeriodEnds: false },
      EvaluationInterval: 30,
    },
  });
  for (const [label, value] of Object.entries({
    Unit: 'Count',
    'Low sample count setting': 'ignore',
    'Evaluation window': 'Wall clock window (Asia/Seoul)',
    'Warm-up configuration': 'Duration5 minutesWait for the full warm-up periodfalse',
    'Evaluation interval': '30 seconds',
  })) {
    expect(defaults.has(label)).toBe(false);
    expect(values.get(label)?.getElement().textContent).toBe(value);
  }
});

it('shows each metric math id and its expression or metric', () => {
  const values = open({
    type: 'metric-math',
    data: {
      Metrics: [
        { Id: 'e1', Expression: 'm1 * 2' },
        { Id: 'm1', MetricStat: { Metric: { Namespace: 'App', MetricName: 'Errors' }, Period: 60, Stat: 'Sum' } },
      ],
    },
  });
  expect(values.get('e1')?.getElement().textContent).toBe('m1 * 2');
  const metric = values.get('m1')?.findKeyValuePairs()?.findItems();
  expect(metric?.map((item) => item.findValue()?.getElement().textContent)).toEqual(['App', 'Errors', '-']);
});

it('shows the PromQL query as the condition', () => {
  const query = 'sum(rate(http_requests_total[5m])) > 0';
  const values = open({ type: 'metric', data: { EvaluationCriteria: { PromQLCriteria: { Query: query } } } });
  expect(values.get('PromQL query')?.getElement().textContent).toBe(query);
});

it('keeps line breaks in a composite alarm rule', () => {
  const rule = 'ALARM("one")\nOR ALARM("two")';
  const values = open({ type: 'composite', data: { AlarmRule: rule } });
  const code = values.get('Alarm rule')?.find('code')?.getElement();
  expect(code?.textContent).toBe(rule);
  expect(code).toHaveStyle({ whiteSpace: 'pre-wrap' });
});

it('shows a log alarm’s query, groups, schedule and threshold', () => {
  const values = open({
    type: 'log',
    data: {
      Threshold: 2,
      ScheduledQueryConfiguration: {
        QueryString: 'fields @message\n| filter @message like /error/',
        LogGroupIdentifiers: ['/local/app', 'arn:aws:logs:us-east-1:000000000000:log-group:second'],
        ScheduledQueryRoleARN: undefined,
        AggregationExpression: undefined,
        ScheduleConfiguration: { ScheduleExpression: 'rate(5 minutes)', StartTimeOffset: 300 },
      },
    },
  });
  expect(values.get('Query')?.getElement().textContent).toBe('fields @message\n| filter @message like /error/');
  expect(values.get('Log groups')?.getElement().textContent).toBe(
    '/local/apparn:aws:logs:us-east-1:000000000000:log-group:second',
  );
  expect(values.get('Schedule')?.getElement().textContent).toBe('rate(5 minutes)');
  expect(values.get('Threshold')?.getElement().textContent).toBe('2');
});
