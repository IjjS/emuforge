import type { FilterRule } from '@aws-sdk/client-s3';

import type { NotificationConfiguration } from './api';

type Queue = NonNullable<NotificationConfiguration['QueueConfigurations']>[number];
type FunctionRule = NonNullable<NotificationConfiguration['LambdaFunctionConfigurations']>[number];
type Topic = NonNullable<NotificationConfiguration['TopicConfigurations']>[number];

export type DestinationType = 'SQS queue' | 'Lambda function';

export type NotificationRule =
  | { type: 'SQS queue'; data: Queue; arn: string | undefined }
  | { type: 'Lambda function'; data: FunctionRule; arn: string | undefined }
  | { type: 'SNS topic'; data: Topic; arn: string | undefined };

export type EditableNotification = Exclude<NotificationRule, { type: 'SNS topic' }>;

export function notificationRules(configuration: NotificationConfiguration): NotificationRule[] {
  return [
    ...(configuration.TopicConfigurations ?? []).map((data) => ({
      type: 'SNS topic' as const,
      data,
      arn: data.TopicArn,
    })),
    ...(configuration.QueueConfigurations ?? []).map((data) => ({
      type: 'SQS queue' as const,
      data,
      arn: data.QueueArn,
    })),
    ...(configuration.LambdaFunctionConfigurations ?? []).map((data) => ({
      type: 'Lambda function' as const,
      data,
      arn: data.LambdaFunctionArn,
    })),
  ];
}

export function filterValue(rule: NotificationRule, name: 'prefix' | 'suffix'): string | undefined {
  return rule.data.Filter?.Key?.FilterRules?.find((filter) => filter.Name?.toLowerCase() === name)?.Value;
}

export function notificationIdCounts(rules: readonly NotificationRule[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const {
    data: { Id },
  } of rules) {
    if (Id?.trim()) counts.set(Id, (counts.get(Id) ?? 0) + 1);
  }
  return counts;
}

export function editableNotification(
  rule: NotificationRule,
  counts: ReadonlyMap<string, number>,
): rule is EditableNotification {
  return rule.type !== 'SNS topic' && rule.data.Id !== undefined && counts.get(rule.data.Id) === 1;
}

export const ALL_CREATIONS = 's3:ObjectCreated:*';
export const OBJECT_PUT = 's3:ObjectCreated:Put';
export const KEEP_EVENTS = 'keep';

export interface NotificationDraft {
  id: string;
  type: DestinationType;
  arn: string;
  event: typeof ALL_CREATIONS | typeof OBJECT_PUT | typeof KEEP_EVENTS;
  prefix: string;
  suffix: string;
}

export function notificationDraft(rule?: EditableNotification): NotificationDraft {
  const events = rule?.data.Events ?? [];
  const event = events[0];
  return {
    id: rule?.data.Id ?? '',
    type: rule?.type ?? 'SQS queue',
    arn: rule?.arn ?? '',
    event:
      events.length === 1 && (event === ALL_CREATIONS || event === OBJECT_PUT)
        ? event
        : rule === undefined
          ? ALL_CREATIONS
          : KEEP_EVENTS,
    prefix: rule === undefined ? '' : (filterValue(rule, 'prefix') ?? ''),
    suffix: rule === undefined ? '' : (filterValue(rule, 'suffix') ?? ''),
  };
}

function filtersWithDraft(rule: EditableNotification | undefined, draft: NotificationDraft): Queue['Filter'] {
  const previous = rule?.data.Filter;
  const rules = [...(previous?.Key?.FilterRules ?? [])];
  for (const name of ['prefix', 'suffix'] as const) {
    if (draft[name] === (rule === undefined ? '' : (filterValue(rule, name) ?? ''))) continue;
    const index = rules.findIndex((filter) => filter.Name?.toLowerCase() === name);
    if (index >= 0) rules.splice(index, 1);
    if (draft[name] !== '') rules.push({ Name: name, Value: draft[name] });
  }
  if (rules.length === 0) return undefined;
  return { Key: { FilterRules: rules } };
}

function ruleSignature({ type, data, arn }: NotificationRule): string {
  const filterSignature = ({ Name, Value }: FilterRule) => JSON.stringify([Name?.toLowerCase(), Value]);
  return JSON.stringify([
    type,
    data.Id,
    arn,
    data.Events ?? [],
    (data.Filter?.Key?.FilterRules ?? []).map(filterSignature).sort(),
  ]);
}

export function sameNotifications(expected: NotificationConfiguration, observed: NotificationConfiguration): boolean {
  const signatures = (configuration: NotificationConfiguration) =>
    JSON.stringify(notificationRules(configuration).map(ruleSignature).sort());
  return (
    (expected.EventBridgeConfiguration !== undefined) === (observed.EventBridgeConfiguration !== undefined) &&
    signatures(expected) === signatures(observed)
  );
}

export type NotificationChange =
  | { kind: 'create'; draft: NotificationDraft }
  | { kind: 'edit'; target: EditableNotification; draft: NotificationDraft }
  | { kind: 'delete'; target: EditableNotification };

export type NotificationReplacement =
  { configuration: NotificationConfiguration } | { problem: 'duplicate' | 'changed' };

export function replaceNotification(
  configuration: NotificationConfiguration,
  change: NotificationChange,
): NotificationReplacement {
  const rules = notificationRules(configuration);
  const id = change.kind === 'create' ? change.draft.id : change.target.data.Id;
  const matches = rules.filter((rule) => rule.data.Id === id);
  let current: EditableNotification | undefined;
  if (change.kind === 'create') {
    if (matches.length !== 0) return { problem: 'duplicate' };
  } else {
    const match = matches[0];
    if (
      matches.length !== 1 ||
      match === undefined ||
      match.type === 'SNS topic' ||
      ruleSignature(match) !== ruleSignature(change.target)
    )
      return { problem: 'changed' };
    current = match;
  }

  const next = { ...configuration };
  const draft = change.kind === 'delete' ? undefined : change.draft;
  if (draft !== undefined) {
    const fields = {
      Id: id,
      Events: draft.event === KEEP_EVENTS ? current?.data.Events : [draft.event],
      Filter: filtersWithDraft(current, draft),
    };
    if (draft.type === 'SQS queue') {
      const updated = { ...fields, QueueArn: draft.arn };
      next.QueueConfigurations =
        current?.type === draft.type
          ? next.QueueConfigurations?.map((entry) => (entry === current.data ? updated : entry))
          : [...(next.QueueConfigurations ?? []), updated];
    } else {
      const updated = { ...fields, LambdaFunctionArn: draft.arn };
      next.LambdaFunctionConfigurations =
        current?.type === draft.type
          ? next.LambdaFunctionConfigurations?.map((entry) => (entry === current.data ? updated : entry))
          : [...(next.LambdaFunctionConfigurations ?? []), updated];
    }
  }
  if (current?.type === 'SQS queue' && draft?.type !== current.type) {
    next.QueueConfigurations = next.QueueConfigurations?.filter((entry) => entry !== current.data);
  }
  if (current?.type === 'Lambda function' && draft?.type !== current.type) {
    next.LambdaFunctionConfigurations = next.LambdaFunctionConfigurations?.filter((entry) => entry !== current.data);
  }
  return { configuration: next };
}
