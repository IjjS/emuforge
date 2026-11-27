import type { PutMetricAlarmCommandInput, Statistic } from '@aws-sdk/client-cloudwatch';

import type { FIXED_COMPARISONS } from './alarm';

export interface MetricDimension {
  Name: string;
  Value: string;
}

export interface MetricEntry {
  namespace: string;
  name: string;
  dimensions: MetricDimension[] | undefined;
}

export type StatisticEntry = { kind: Statistic } | { kind: 'Other'; text: string };
export type MissingData = 'missing' | 'notBreaching' | 'breaching' | 'ignore';

export const ACTION_FIELDS = ['alarmActions', 'okActions', 'insufficientDataActions'] as const;
export type ActionField = (typeof ACTION_FIELDS)[number];

export interface AlarmFormValues {
  name: string;
  description: string;
  metric: MetricEntry;
  statistic: StatisticEntry;
  period: number;
  comparison: (typeof FIXED_COMPARISONS)[number];
  threshold: string;
  evaluationPeriods: string;
  datapointsToAlarm: string;
  missingData: MissingData;
  actionsEnabled: boolean;
  alarmActions: string[];
  okActions: string[];
  insufficientDataActions: string[];
}

export type FormFieldName = keyof AlarmFormValues | 'namespace' | 'metricName' | 'dimensions';
export type AlarmFormErrors = Partial<Record<FormFieldName, string>>;

export const NAME_RULE = '1 to 255 characters. No line breaks or other control characters.';
export const DESCRIPTION_RULE = 'Up to 1024 characters.';
export const NAMESPACE_RULE = '1 to 255 characters. Cannot start with a colon.';
export const METRIC_NAME_RULE = '1 to 255 characters.';
export const COUNT_RULE = 'Enter a whole number of at least 1.';

export function emptyMetric(): MetricEntry {
  return { namespace: '', name: '', dimensions: undefined };
}

export function newAlarmForm(): AlarmFormValues {
  return {
    name: '',
    description: '',
    metric: emptyMetric(),
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
  };
}

function lengthIn(value: string, min: number, max: number): boolean {
  const length = Array.from(value).length;
  return length >= min && length <= max;
}

function wholePositive(value: string): boolean {
  return /^[0-9]+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) && Number(value) >= 1;
}

export function validateAlarmFields(values: AlarmFormValues, mode: 'create' | 'edit' = 'create'): AlarmFormErrors {
  const errors: AlarmFormErrors = {};
  if (mode === 'create' && (!lengthIn(values.name, 1, 255) || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(values.name))) {
    errors.name = NAME_RULE;
  }
  if (!lengthIn(values.description, 0, 1024)) errors.description = DESCRIPTION_RULE;

  const { namespace, name, dimensions } = values.metric;
  if (!lengthIn(namespace, 1, 255) || namespace.startsWith(':')) errors.namespace = NAMESPACE_RULE;
  if (!lengthIn(name, 1, 255)) errors.metricName = METRIC_NAME_RULE;
  if (dimensions === undefined) {
    errors.dimensions = 'Choose the dimensions for the metric.';
  } else if (dimensions.length > 30) {
    errors.dimensions = 'Enter at most 30 dimensions.';
  } else if (dimensions.some(({ Name, Value }) => Name === '' || Value === '')) {
    errors.dimensions = 'Enter a name and a value for each dimension.';
  }

  if (values.statistic.kind === 'Other' && values.statistic.text.trim() === '') {
    errors.statistic = 'Enter an extended statistic.';
  }
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(values.threshold.trim()) ||
    !Number.isFinite(Number(values.threshold))
  ) {
    errors.threshold = 'Enter a number for the threshold.';
  }
  if (!wholePositive(values.datapointsToAlarm)) errors.datapointsToAlarm = COUNT_RULE;
  if (!wholePositive(values.evaluationPeriods)) errors.evaluationPeriods = COUNT_RULE;
  for (const field of ACTION_FIELDS) {
    if (values[field].length > 5) errors[field] = 'Choose at most 5 actions.';
  }
  return errors;
}

export function validateAlarmRelationships({
  period,
  evaluationPeriods,
  datapointsToAlarm,
}: Pick<AlarmFormValues, 'period' | 'evaluationPeriods' | 'datapointsToAlarm'>): AlarmFormErrors {
  const errors: AlarmFormErrors = {};
  if (!wholePositive(evaluationPeriods)) return errors;
  if (wholePositive(datapointsToAlarm) && Number(datapointsToAlarm) > Number(evaluationPeriods)) {
    errors.datapointsToAlarm = 'Data points to alarm cannot exceed the evaluation periods.';
  }
  const underHour = period < 3600;
  if (Number(evaluationPeriods) * period > (underHour ? 86400 : 604800)) {
    errors.evaluationPeriods = underHour
      ? 'The evaluation periods cannot cover more than one day for a period under one hour.'
      : 'The evaluation periods cannot cover more than one week for a period of one hour or longer.';
  }
  return errors;
}

/** Builds the write from validated form entries. */
export function alarmFormInput(values: AlarmFormValues): PutMetricAlarmCommandInput {
  const { description, metric, statistic, alarmActions, okActions, insufficientDataActions } = values;
  return {
    AlarmName: values.name,
    ...(description === '' ? {} : { AlarmDescription: description }),
    Namespace: metric.namespace,
    MetricName: metric.name,
    ...(metric.dimensions?.length ? { Dimensions: metric.dimensions } : {}),
    ...(statistic.kind === 'Other' ? { ExtendedStatistic: statistic.text } : { Statistic: statistic.kind }),
    Period: values.period,
    ComparisonOperator: values.comparison,
    Threshold: Number(values.threshold),
    EvaluationPeriods: Number(values.evaluationPeriods),
    DatapointsToAlarm: Number(values.datapointsToAlarm),
    TreatMissingData: values.missingData,
    ActionsEnabled: values.actionsEnabled,
    ...(alarmActions.length ? { AlarmActions: alarmActions } : {}),
    ...(okActions.length ? { OKActions: okActions } : {}),
    ...(insufficientDataActions.length ? { InsufficientDataActions: insufficientDataActions } : {}),
  };
}
