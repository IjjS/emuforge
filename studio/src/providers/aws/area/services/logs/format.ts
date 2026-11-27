import type { LogGroupClass } from '@aws-sdk/client-cloudwatch-logs';

import { nameIdentity } from '../../components/name-identity';
import { nameSegment, normalizeLineBreaks } from '../../components/name-segment';

export { LINE_BREAK, nameFromSegment, nameSegment, normalizeLineBreaks } from '../../components/name-segment';

export const LOGS_PATH = '/aws/logs';
export const LOG_GROUPS_PATH = `${LOGS_PATH}/log-groups`;
export const CREATE_LOG_GROUP_PATH = `${LOG_GROUPS_PATH}/create`;
export const LOG_GROUP_PATH = `${LOG_GROUPS_PATH}/group/{group}`;
export const LOG_STREAM_PATH = `${LOG_GROUP_PATH}/stream/{stream}`;
export const LOG_EVENTS_PATH = `${LOGS_PATH}/log-events`;
export const LOG_STREAMS_PATH = `${LOGS_PATH}/log-streams`;

export const LOG_GROUPS_TITLE = 'Log groups';
export const CREATE_LOG_GROUP_TITLE = 'Create log group';

export function logGroupPath(group: string): string {
  return `${LOG_GROUPS_PATH}/group/${nameSegment(group)}`;
}

export function logStreamPath(group: string, stream: string): string {
  return `${logGroupPath(group)}/stream/${nameSegment(stream)}`;
}

export const streamNameForDisplay = normalizeLineBreaks;

export function streamNameLabel(name: string): string {
  return nameIdentity(name);
}

export const RETENTION_DAYS = [
  1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653,
] as const;

export function retentionText(days: number | undefined): string {
  if (days === undefined) return 'Never expire';
  return days === 1 ? '1 day' : `${String(days)} days`;
}

const CLASS_LABELS: Record<LogGroupClass, string> = {
  STANDARD: 'Standard',
  INFREQUENT_ACCESS: 'Infrequent Access',
  DELIVERY: 'Delivery',
};

export function logGroupClassText(logClass: LogGroupClass | undefined): string {
  return logClass === undefined ? '-' : (CLASS_LABELS[logClass] ?? logClass);
}

export function deletionProtectionText(enabled: boolean | undefined): string {
  return enabled ? 'On' : 'Off';
}
