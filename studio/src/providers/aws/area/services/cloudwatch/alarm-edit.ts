import type { Dimension, PutMetricAlarmCommandInput } from '@aws-sdk/client-cloudwatch';

import { isEditableAlarm, type Alarm, type EditableAlarm } from './alarm';
import {
  alarmFormInput,
  validateAlarmRelationships,
  type AlarmFormErrors,
  type AlarmFormValues,
  type MetricDimension,
  type MissingData,
} from './alarm-form';
import { dimensionSetKey } from './metric-api';

const WRITE_FIELDS = {
  description: ['AlarmDescription'],
  metric: ['Namespace', 'MetricName', 'Dimensions'],
  statistic: ['Statistic', 'ExtendedStatistic'],
  period: ['Period'],
  comparison: ['ComparisonOperator'],
  threshold: ['Threshold'],
  evaluationPeriods: ['EvaluationPeriods'],
  datapointsToAlarm: ['DatapointsToAlarm'],
  missingData: ['TreatMissingData'],
  actionsEnabled: ['ActionsEnabled'],
  alarmActions: ['AlarmActions'],
  okActions: ['OKActions'],
  insufficientDataActions: ['InsufficientDataActions'],
} as const satisfies Record<Exclude<keyof AlarmFormValues, 'name'>, readonly (keyof PutMetricAlarmCommandInput)[]>;

const EXTRA_FIELDS = [
  'Unit',
  'EvaluateLowSampleCountPercentile',
  'EvaluationWindow',
  'WarmUpConfiguration',
  'EvaluationInterval',
] as const;

export type EditField = keyof typeof WRITE_FIELDS;
const fields = Object.keys(WRITE_FIELDS) as EditField[];

function missingData(value: string | undefined): MissingData {
  switch (value) {
    case 'notBreaching':
    case 'breaching':
    case 'ignore':
      return value;
    default:
      return 'missing';
  }
}

function formDimensions(dimensions: Dimension[] = []): MetricDimension[] {
  return dimensions.map(({ Name, Value }) => ({ Name: Name ?? '', Value: Value ?? '' }));
}

export type AlarmEditValues = Omit<AlarmFormValues, 'datapointsToAlarm'> & { datapointsToAlarm: string | undefined };

export function alarmDatapointCount(values: AlarmEditValues): string {
  return values.datapointsToAlarm ?? values.evaluationPeriods;
}

export function restoreImplicitDatapointCount(
  { data }: EditableAlarm,
  previous: AlarmEditValues,
  entries: AlarmEditValues,
): AlarmEditValues {
  const openingPeriods = data.EvaluationPeriods;
  if (data.DatapointsToAlarm !== undefined || !Number.isSafeInteger(openingPeriods) || openingPeriods < 1) {
    return entries;
  }

  const matchesOpeningCondition = ({ datapointsToAlarm, evaluationPeriods }: AlarmEditValues) =>
    [datapointsToAlarm, evaluationPeriods].every(
      (entry) => entry !== undefined && /^[0-9]+$/.test(entry.trim()) && Number(entry) === openingPeriods,
    );

  // A rebase can match the opening numbers while still holding an explicit count.
  if (matchesOpeningCondition(entries) && !matchesOpeningCondition(previous)) {
    return { ...entries, datapointsToAlarm: undefined };
  }
  return entries;
}

export function alarmEditValues(name: string, { data }: EditableAlarm): AlarmEditValues {
  return {
    name,
    description: data.AlarmDescription ?? '',
    metric: {
      namespace: data.Namespace,
      name: data.MetricName,
      dimensions: formDimensions(data.Dimensions),
    },
    statistic:
      data.ExtendedStatistic !== undefined
        ? { kind: 'Other', text: data.ExtendedStatistic }
        : { kind: data.Statistic ?? 'Average' },
    period: data.Period,
    comparison: data.ComparisonOperator,
    threshold: String(data.Threshold),
    evaluationPeriods: String(data.EvaluationPeriods),
    datapointsToAlarm: data.DatapointsToAlarm === undefined ? undefined : String(data.DatapointsToAlarm),
    missingData: missingData(data.TreatMissingData),
    actionsEnabled: data.ActionsEnabled ?? true,
    alarmActions: data.AlarmActions ?? [],
    okActions: data.OKActions ?? [],
    insufficientDataActions: data.InsufficientDataActions ?? [],
  };
}

function formFieldValue(values: AlarmEditValues, field: EditField): unknown {
  switch (field) {
    case 'metric': {
      const { namespace, name, dimensions } = values.metric;
      return [namespace, name, dimensions === undefined ? undefined : dimensionSetKey(dimensions)];
    }
    case 'threshold':
    case 'evaluationPeriods':
      return Number(values[field]);
    case 'datapointsToAlarm':
      return values[field] === undefined ? undefined : Number(values[field]);
    default:
      return values[field];
  }
}

function changedOnRead(before: EditableAlarm['data'], now: EditableAlarm['data'], field: EditField): boolean {
  return WRITE_FIELDS[field].some((key) => {
    if (key === 'Dimensions') {
      return dimensionSetKey(formDimensions(before.Dimensions)) !== dimensionSetKey(formDimensions(now.Dimensions));
    }
    return JSON.stringify(before[key]) !== JSON.stringify(now[key]);
  });
}

function copyMember<K extends keyof PutMetricAlarmCommandInput>(
  input: PutMetricAlarmCommandInput,
  key: K,
  value: PutMetricAlarmCommandInput[K],
) {
  if (value !== undefined) input[key] = value;
}

function applyEditedField<K extends EditField>(target: AlarmEditValues, source: AlarmEditValues, field: K) {
  target[field] = source[field];
}

interface RebasedEdit {
  baseline: EditableAlarm;
  values: AlarmEditValues;
}

export type AlarmEdit =
  | { kind: 'gone' }
  | { kind: 'not-editable' }
  | ({ kind: 'conflict'; fields: EditField[] } & RebasedEdit)
  | ({ kind: 'invalid'; errors: AlarmFormErrors } & RebasedEdit)
  | ({ kind: 'ready'; input: PutMetricAlarmCommandInput } & RebasedEdit);

export function mergeAlarmEdit(
  name: string,
  baseline: EditableAlarm,
  submitted: AlarmEditValues,
  latest?: Alarm,
): AlarmEdit {
  if (latest === undefined) return { kind: 'gone' };
  if (!isEditableAlarm(latest)) return { kind: 'not-editable' };

  const initial = alarmEditValues(name, baseline);
  const changed = new Set(
    fields.filter(
      (field) => JSON.stringify(formFieldValue(submitted, field)) !== JSON.stringify(formFieldValue(initial, field)),
    ),
  );
  const values = alarmEditValues(name, latest);
  for (const field of changed) applyEditedField(values, submitted, field);
  const rebased = { baseline: latest, values };
  const conflicts = fields.filter((field) => changed.has(field) && changedOnRead(baseline.data, latest.data, field));
  if (conflicts.length > 0) return { kind: 'conflict', fields: conflicts, ...rebased };

  const input: PutMetricAlarmCommandInput = { AlarmName: name };
  const editedInput = alarmFormInput({ ...submitted, datapointsToAlarm: alarmDatapointCount(submitted) });
  if (submitted.datapointsToAlarm === undefined) delete editedInput.DatapointsToAlarm;
  for (const field of fields) {
    const source = changed.has(field) ? editedInput : latest.data;
    for (const key of WRITE_FIELDS[field]) copyMember(input, key, source[key]);
  }
  for (const key of EXTRA_FIELDS) copyMember(input, key, latest.data[key]);

  const errors = validateAlarmRelationships({ ...values, datapointsToAlarm: alarmDatapointCount(values) });
  if (Object.keys(errors).length > 0) return { kind: 'invalid', errors, ...rebased };
  return { kind: 'ready', input, ...rebased };
}
