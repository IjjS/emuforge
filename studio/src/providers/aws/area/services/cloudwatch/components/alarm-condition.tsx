import type { Dimension, MetricAlarm } from '@aws-sdk/client-cloudwatch';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs, { type KeyValuePairsProps } from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { ValueText, type ValueKind } from '../../../components/value-text';
import type { Alarm } from '../alarm';
import { comparisonText, periodText, statisticText } from '../format';

function field(label: string, value: string | number | undefined, kind: ValueKind = 'fixed') {
  return {
    label,
    value: <ValueText kind={kind} value={value === undefined ? undefined : String(value)} none="-" />,
  };
}

function preformatted(value: string | undefined) {
  return (
    <Box
      variant="code"
      display="block"
      nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}
    >
      {value ?? '-'}
    </Box>
  );
}

function dimensions(values: Dimension[] | undefined) {
  if (!values?.length) return '-';
  return (
    <SpaceBetween size="xxs">
      {values.map(({ Name, Value }, index) => (
        <div key={index}>
          <ValueText kind="name" value={Name} none="-" /> = <ValueText kind="name" value={Value} none="-" />
        </div>
      ))}
    </SpaceBetween>
  );
}

function optionalMetricFields(data: MetricAlarm): KeyValuePairsProps.Pair[] {
  const items: KeyValuePairsProps.Pair[] = [];
  if (data.Unit !== undefined) items.push(field('Unit', data.Unit));
  if (data.EvaluateLowSampleCountPercentile !== undefined) {
    items.push(field('Low sample count setting', data.EvaluateLowSampleCountPercentile));
  }
  const window = data.EvaluationWindow;
  if (window !== undefined) {
    const zone = window.WallClockWindow?.Timezone;
    const text = window.WallClockWindow
      ? zone === undefined
        ? 'Wall clock window'
        : `Wall clock window (${zone})`
      : window.SlidingWindow
        ? 'Sliding window'
        : window.$unknown?.[0];
    items.push(field('Evaluation window', text));
  }
  const warmUp = data.WarmUpConfiguration;
  if (warmUp !== undefined) {
    const duration = warmUp.WarmUpPeriodDurationInMinutes;
    items.push({
      label: 'Warm-up configuration',
      value: (
        <KeyValuePairs
          items={[
            field('Duration', duration === undefined ? undefined : periodText(duration * 60)),
            field('Wait for the full warm-up period', warmUp.OnlyStartEvaluatingAfterWarmUpPeriodEnds?.toString()),
          ]}
        />
      ),
    });
  }
  if (data.EvaluationInterval !== undefined)
    items.push(field('Evaluation interval', periodText(data.EvaluationInterval)));
  return items;
}

function conditionFields(alarm: Alarm): KeyValuePairsProps.Pair[] {
  if (alarm.type === 'composite') {
    return [{ label: 'Alarm rule', value: preformatted(alarm.data.AlarmRule) }];
  }
  if (alarm.type === 'log') {
    const config = alarm.data.ScheduledQueryConfiguration;
    return [
      { label: 'Query', value: preformatted(config?.QueryString) },
      {
        label: 'Log groups',
        value: config?.LogGroupIdentifiers?.length ? (
          <SpaceBetween size="xxs">
            {config.LogGroupIdentifiers.map((group, index) => (
              <ValueText key={index} kind={group.startsWith('arn:') ? 'address' : 'name'} value={group} />
            ))}
          </SpaceBetween>
        ) : (
          '-'
        ),
      },
      field('Schedule', config?.ScheduleConfiguration?.ScheduleExpression),
      field('Comparison', comparisonText(alarm.data.ComparisonOperator)),
      field('Threshold', alarm.data.Threshold),
    ];
  }

  const data = alarm.data;
  const optional = optionalMetricFields(data);
  const promql = data.EvaluationCriteria?.PromQLCriteria;
  if (promql !== undefined) return [{ label: 'PromQL query', value: preformatted(promql.Query) }, ...optional];

  if (alarm.type === 'metric-math') {
    return [
      ...(data.Metrics ?? []).map(({ Id, Expression, MetricStat }) => ({
        label: <ValueText kind="name" value={Id} none="-" />,
        value:
          Expression === undefined ? (
            <KeyValuePairs
              items={[
                field('Namespace', MetricStat?.Metric?.Namespace, 'name'),
                field('Metric', MetricStat?.Metric?.MetricName, 'name'),
                { label: 'Dimensions', value: dimensions(MetricStat?.Metric?.Dimensions) },
              ]}
            />
          ) : (
            preformatted(Expression)
          ),
      })),
      ...optional,
    ];
  }

  const periods = data.EvaluationPeriods;
  const datapoints =
    periods === undefined ? undefined : `${String(data.DatapointsToAlarm ?? periods)} out of ${String(periods)}`;
  const missing = data.TreatMissingData;
  return [
    field('Namespace', data.Namespace, 'name'),
    field('Metric', data.MetricName, 'name'),
    { label: 'Dimensions', value: dimensions(data.Dimensions) },
    field('Statistic', statisticText(data.Statistic, data.ExtendedStatistic)),
    field('Period', periodText(data.Period)),
    field('Comparison', comparisonText(data.ComparisonOperator)),
    field('Threshold', data.Threshold),
    field('Data points to alarm', datapoints),
    field('Treatment of missing data', missing === undefined || missing === 'missing' ? 'Missing' : missing),
    ...optional,
  ];
}

export function AlarmCondition({ alarm }: { alarm: Alarm }) {
  const queryIsPrimary =
    alarm.type === 'composite' ||
    alarm.type === 'log' ||
    (alarm.type === 'metric' && alarm.data.EvaluationCriteria?.PromQLCriteria !== undefined);
  return (
    <Container header={<Header variant="h2">Condition</Header>}>
      <KeyValuePairs columns={queryIsPrimary ? 1 : 2} items={conditionFields(alarm)} />
    </Container>
  );
}
