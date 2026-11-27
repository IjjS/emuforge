import { expect, it } from 'vitest';

import type { EditableAlarm } from './alarm';
import { alarmEditValues, mergeAlarmEdit } from './alarm-edit';

const name = 'Requests / local';
const alarm = (fields: Partial<EditableAlarm['data']> = {}): EditableAlarm => ({
  type: 'metric',
  data: {
    AlarmName: name,
    Namespace: 'App',
    MetricName: 'Requests',
    Statistic: 'Sum',
    Period: 120,
    ComparisonOperator: 'LessThanThreshold',
    Threshold: 5,
    EvaluationPeriods: 3,
    ...fields,
  } as EditableAlarm['data'],
});

it('fills the form with the alarm values, defaults, and an extended statistic', () => {
  const original = alarm({
    ExtendedStatistic: 'p99',
    AlarmDescription: 'before',
    Dimensions: [{ Name: 'Stage', Value: 'local' }],
    ActionsEnabled: false,
    OKActions: ['ok'],
  });
  expect(alarmEditValues(name, original)).toEqual({
    name,
    description: 'before',
    metric: { namespace: 'App', name: 'Requests', dimensions: [{ Name: 'Stage', Value: 'local' }] },
    statistic: { kind: 'Other', text: 'p99' },
    period: 120,
    comparison: 'LessThanThreshold',
    threshold: '5',
    evaluationPeriods: '3',
    datapointsToAlarm: '3',
    missingData: 'missing',
    actionsEnabled: false,
    alarmActions: [],
    okActions: ['ok'],
    insufficientDataActions: [],
  });
});

it('preserves the write members exactly when nothing changed, including unset defaults', () => {
  const original = alarm();
  const latest = alarm({ AlarmDescription: '', Dimensions: [], AlarmActions: [], ActionsEnabled: true });
  expect(mergeAlarmEdit(name, original, alarmEditValues(name, original), latest)).toMatchObject({
    kind: 'ready',
    input: latest.data,
  });
  expect(mergeAlarmEdit(name, original, alarmEditValues(name, original), latest)).toHaveProperty('input', latest.data);
});

it('sends explicitly edited defaulted fields', () => {
  const original = alarm();
  const values = { ...alarmEditValues(name, original), datapointsToAlarm: '2', missingData: 'breaching' as const };
  expect(mergeAlarmEdit(name, original, values, original)).toMatchObject({
    kind: 'ready',
    input: { DatapointsToAlarm: 2, TreatMissingData: 'breaching' },
  });
});

it('preserves every extra write member from the latest read and leaves out response-only members', () => {
  const original = alarm({ Unit: 'Count', EvaluationInterval: 60 });
  const extras = {
    Unit: 'Seconds',
    EvaluateLowSampleCountPercentile: 'ignore',
    EvaluationWindow: { SlidingWindow: {} },
    WarmUpConfiguration: { WarmUpPeriodDurationInMinutes: 10 },
    EvaluationInterval: 120,
  } as const;
  const latest = alarm({ ...extras, AlarmArn: 'read-only' });
  expect(mergeAlarmEdit(name, original, alarmEditValues(name, original), latest)).toHaveProperty('input', {
    ...original.data,
    ...extras,
  });
});

it('combines an edited field with untouched fields changed outside, then reports the new values', () => {
  const original = alarm({ ActionsEnabled: true, AlarmDescription: 'before' });
  const latest = alarm({ ActionsEnabled: false, AlarmDescription: 'after' });
  const values = { ...alarmEditValues(name, original), threshold: '7' };
  expect(mergeAlarmEdit(name, original, values, latest)).toMatchObject({
    kind: 'ready',
    input: { ActionsEnabled: false, AlarmDescription: 'after', Threshold: 7 },
    values: { actionsEnabled: false, description: 'after', threshold: '7' },
  });
});

it.each([false, true])('reports competing fields and allows resubmission on the new baseline (%s)', (twoFields) => {
  const original = alarm({ AlarmDescription: 'before' });
  const latest = alarm({ Threshold: 8, AlarmDescription: 'outside' });
  const modified = { ...alarmEditValues(name, original), threshold: '7', description: twoFields ? 'mine' : 'before' };
  const result = mergeAlarmEdit(name, original, modified, latest);
  expect(result).toEqual({
    kind: 'conflict',
    fields: twoFields ? ['description', 'threshold'] : ['threshold'],
    baseline: latest,
    values: { ...modified, description: twoFields ? 'mine' : 'outside' },
  });
  if (result.kind !== 'conflict') throw new Error('Expected a conflict');
  expect(alarmEditValues(name, result.baseline)).toMatchObject({ threshold: '8', description: 'outside' });
  expect(mergeAlarmEdit(name, result.baseline, result.values, latest)).toMatchObject({
    kind: 'ready',
    input: { Threshold: 7, AlarmDescription: twoFields ? 'mine' : 'outside' },
  });
});

it('keeps an unlisted ARN on an untouched list, allows removal and reports a competing list change', () => {
  const arn = 'arn:aws:lambda:us-east-1:000000000000:function:local';
  const original = alarm({ AlarmActions: [arn] });
  const latest = alarm({ AlarmActions: [arn, 'another'] });
  const values = alarmEditValues(name, original);
  expect(mergeAlarmEdit(name, original, values, latest)).toMatchObject({
    kind: 'ready',
    input: { AlarmActions: [arn, 'another'] },
  });
  const removed = { ...values, alarmActions: [] };
  const result = mergeAlarmEdit(name, original, removed, original);
  expect(result.kind).toBe('ready');
  expect(result).not.toHaveProperty('input.AlarmActions');
  expect(mergeAlarmEdit(name, original, removed, latest)).toMatchObject({ kind: 'conflict', fields: ['alarmActions'] });
});

it('lets a field put back adopt the value from the fresh read', () => {
  const original = alarm();
  const values = alarmEditValues(name, original);
  values.threshold = '10';
  values.threshold = '5';
  expect(mergeAlarmEdit(name, original, values, alarm({ Threshold: 8 }))).toMatchObject({
    kind: 'ready',
    input: { Threshold: 8 },
  });
});

it('returns no input when the alarm is gone or no longer editable', () => {
  const original = alarm();
  const values = alarmEditValues(name, original);
  expect(mergeAlarmEdit(name, original, values)).toEqual({ kind: 'gone' });
  expect(mergeAlarmEdit(name, original, values, { type: 'composite', data: {} })).toEqual({ kind: 'not-editable' });
});

it.each([1, 3])('validates the data point count against the merged periods (%i)', (periods) => {
  const original = alarm({ EvaluationPeriods: 2, DatapointsToAlarm: 1 });
  const values = { ...alarmEditValues(name, original), datapointsToAlarm: '2' };
  if (periods === 3) original.data.EvaluationPeriods = 1;
  const latest = alarm({ EvaluationPeriods: periods, DatapointsToAlarm: 1 });
  const result = mergeAlarmEdit(name, original, values, latest);
  if (periods === 1) {
    expect(result).toMatchObject({
      kind: 'invalid',
      errors: { datapointsToAlarm: 'Data points to alarm cannot exceed the evaluation periods.' },
      values: { datapointsToAlarm: '2', evaluationPeriods: '1' },
      baseline: latest,
    });
    expect(result).not.toHaveProperty('input');
  } else {
    expect(result).toMatchObject({ kind: 'ready', input: { DatapointsToAlarm: 2, EvaluationPeriods: 3 } });
  }
});

it('validates the evaluation span against the latest period', () => {
  const original = alarm({ Period: 60, EvaluationPeriods: 1 });
  const values = { ...alarmEditValues(name, original), evaluationPeriods: '25' };
  const latest = alarm({ Period: 3540, EvaluationPeriods: 1 });
  expect(mergeAlarmEdit(name, original, values, latest)).toMatchObject({
    kind: 'invalid',
    errors: { evaluationPeriods: 'The evaluation periods cannot cover more than one day for a period under one hour.' },
    values: { period: 3540, evaluationPeriods: '25' },
  });
});
