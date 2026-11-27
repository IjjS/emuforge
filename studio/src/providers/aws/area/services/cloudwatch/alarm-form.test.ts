import { expect, it } from 'vitest';

import {
  ACTION_FIELDS,
  alarmFormInput,
  COUNT_RULE,
  DESCRIPTION_RULE,
  METRIC_NAME_RULE,
  NAME_RULE,
  NAMESPACE_RULE,
  newAlarmForm,
  validateAlarmFields,
  validateAlarmRelationships,
} from './alarm-form';

const ready = () => ({
  ...newAlarmForm(),
  name: 'alarm',
  threshold: '1',
  metric: { namespace: 'App', name: 'Jobs', dimensions: [] },
});

it('starts at five minutes, one out of one, Missing, Average and actions on, with no metric or actions', () => {
  expect(newAlarmForm()).toEqual({
    name: '',
    description: '',
    metric: { namespace: '', name: '', dimensions: undefined },
    statistic: { kind: 'Average' },
    period: 300,
    comparison: 'GreaterThanThreshold',
    threshold: '',
    evaluationPeriods: '1',
    datapointsToAlarm: '1',
    missingData: 'missing',
    actionsEnabled: true,
    alarmActions: [],
    okActions: [],
    insufficientDataActions: [],
  });
});

it.each(['', 'a'.repeat(256), ...['\n', '\t', '\u0000', '\u0085', '\u2028', '\u2029'].map((char) => `a${char}b`)])(
  'rejects an out-of-range or control-containing name %j',
  (name) => {
    expect(validateAlarmFields({ ...ready(), name })).toEqual({ name: NAME_RULE });
  },
);

it('keeps a 255-character name with spaces, and accepts 1024 description characters', () => {
  const name = ` alarm  ${'a'.repeat(246)} `;
  const description = 'd'.repeat(1024);
  const values = { ...ready(), name, description };
  expect([...name]).toHaveLength(255);
  expect(validateAlarmFields(values)).toEqual({});
  expect(alarmFormInput(values)).toMatchObject({ AlarmName: name, AlarmDescription: description });
  expect(validateAlarmFields({ ...values, description: description + 'd' })).toEqual({ description: DESCRIPTION_RULE });
});

it('requires a complete metric choice, including its dimension set', () => {
  expect(validateAlarmFields({ ...ready(), metric: newAlarmForm().metric })).toEqual({
    namespace: NAMESPACE_RULE,
    metricName: METRIC_NAME_RULE,
    dimensions: 'Choose the dimensions for the metric.',
  });
});

it.each(['', 'no number'])('rejects threshold %j at its field', (threshold) => {
  expect(validateAlarmFields({ ...ready(), threshold })).toEqual({ threshold: 'Enter a number for the threshold.' });
});

it.each(['0.25', '-3'])('accepts and converts threshold %s', (threshold) => {
  const values = { ...ready(), threshold };
  expect(validateAlarmFields(values)).toEqual({});
  expect(alarmFormInput(values).Threshold).toBe(Number(threshold));
});

it.each(['evaluationPeriods', 'datapointsToAlarm'] as const)('requires a positive whole number in %s', (field) => {
  for (const value of ['0', '1.5']) {
    expect(validateAlarmFields({ ...ready(), [field]: value })).toEqual({ [field]: COUNT_RULE });
  }
});

it('checks data points against periods separately from the rules of one field', () => {
  const values = { ...ready(), datapointsToAlarm: '2' };
  expect(validateAlarmFields(values)).toEqual({});
  expect(validateAlarmRelationships(values)).toEqual({
    datapointsToAlarm: 'Data points to alarm cannot exceed the evaluation periods.',
  });
});

it.each([
  {
    period: 300,
    limit: 288,
    message: 'The evaluation periods cannot cover more than one day for a period under one hour.',
  },
  {
    period: 3600,
    limit: 168,
    message: 'The evaluation periods cannot cover more than one week for a period of one hour or longer.',
  },
])(
  'accepts the evaluation window limit for periods of $period seconds and rejects the next period',
  ({ period, limit, message }) => {
    expect(validateAlarmRelationships({ ...ready(), period, evaluationPeriods: String(limit) })).toEqual({});
    const tooLong = { ...ready(), period, evaluationPeriods: String(limit + 1) };
    expect(validateAlarmFields(tooLong)).toEqual({});
    expect(validateAlarmRelationships(tooLong)).toEqual({ evaluationPeriods: message });
  },
);

it('requires text for Other and accepts p99', () => {
  expect(validateAlarmFields({ ...ready(), statistic: { kind: 'Other', text: '' } })).toEqual({
    statistic: 'Enter an extended statistic.',
  });
  expect(validateAlarmFields({ ...ready(), statistic: { kind: 'Other', text: 'p99' } })).toEqual({});
});

it('validates typed namespaces, metric names and dimensions at their fields', () => {
  const values = ready();
  for (const namespace of ['', 'x'.repeat(256), ':x']) {
    expect(validateAlarmFields({ ...values, metric: { ...values.metric, namespace } })).toEqual({
      namespace: NAMESPACE_RULE,
    });
  }
  for (const name of ['', 'x'.repeat(256)]) {
    expect(validateAlarmFields({ ...values, metric: { ...values.metric, name } })).toEqual({
      metricName: METRIC_NAME_RULE,
    });
  }
  for (const dimension of [
    { Name: '', Value: 'x' },
    { Name: 'x', Value: '' },
  ]) {
    expect(validateAlarmFields({ ...values, metric: { ...values.metric, dimensions: [dimension] } })).toEqual({
      dimensions: 'Enter a name and a value for each dimension.',
    });
  }
  const dimensions = Array.from({ length: 31 }, (_, i) => ({ Name: String(i), Value: 'x' }));
  expect(validateAlarmFields({ ...values, metric: { ...values.metric, dimensions } })).toEqual({
    dimensions: 'Enter at most 30 dimensions.',
  });
});

it.each(ACTION_FIELDS)('rejects a sixth action in %s', (field) => {
  expect(validateAlarmFields({ ...ready(), [field]: ['a', 'b', 'c', 'd', 'e', 'f'] })).toEqual({
    [field]: 'Choose at most 5 actions.',
  });
});

it('builds the SDK input with exactly the supplied members, without tags', () => {
  expect(alarmFormInput(ready())).toEqual({
    AlarmName: 'alarm',
    Namespace: 'App',
    MetricName: 'Jobs',
    Statistic: 'Average',
    Period: 300,
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 1,
    EvaluationPeriods: 1,
    DatapointsToAlarm: 1,
    TreatMissingData: 'missing',
    ActionsEnabled: true,
  });
  const dimensions = [{ Name: 'Worker', Value: 'east' }];
  expect(
    alarmFormInput({
      ...ready(),
      description: 'Queue depth',
      metric: { ...ready().metric, dimensions },
      statistic: { kind: 'Other', text: 'p99' },
      alarmActions: ['a'],
      okActions: ['b'],
      insufficientDataActions: ['c'],
    }),
  ).toEqual({
    AlarmName: 'alarm',
    AlarmDescription: 'Queue depth',
    Namespace: 'App',
    MetricName: 'Jobs',
    Dimensions: dimensions,
    ExtendedStatistic: 'p99',
    Period: 300,
    ComparisonOperator: 'GreaterThanThreshold',
    Threshold: 1,
    EvaluationPeriods: 1,
    DatapointsToAlarm: 1,
    TreatMissingData: 'missing',
    ActionsEnabled: true,
    AlarmActions: ['a'],
    OKActions: ['b'],
    InsufficientDataActions: ['c'],
  });
});
