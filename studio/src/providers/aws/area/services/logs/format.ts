import type { LogGroupClass } from '@aws-sdk/client-cloudwatch-logs';

export const LOGS_PATH = '/aws/logs';
export const LOG_GROUPS_PATH = `${LOGS_PATH}/log-groups`;
export const CREATE_LOG_GROUP_PATH = `${LOG_GROUPS_PATH}/create`;
export const LOG_GROUP_PATH = `${LOG_GROUPS_PATH}/group/{group}`;
export const LOG_STREAM_PATH = `${LOG_GROUP_PATH}/stream/{stream}`;
export const LOG_EVENTS_PATH = `${LOGS_PATH}/log-events`;
export const LOG_STREAMS_PATH = `${LOGS_PATH}/log-streams`;

export const LOG_GROUPS_TITLE = 'Log groups';
export const CREATE_LOG_GROUP_TITLE = 'Create log group';

const LINE_BREAK_SEGMENT_PREFIX = '**';

export function nameSegment(name: string): string {
  if (name === '.' || name === '..') return `*${name}`;
  const encoded = encodeURIComponent(name);
  // React Router decodes the path for matching, and its splat excludes the four JavaScript line terminators.
  return /[\r\n\u2028\u2029]/.test(name) ? `${LINE_BREAK_SEGMENT_PREFIX}${encodeURIComponent(encoded)}` : encoded;
}

/** The area has already percent-decoded the parameter once. */
export function nameFromSegment(segment: string): string {
  if (segment.startsWith(LINE_BREAK_SEGMENT_PREFIX)) {
    try {
      return decodeURIComponent(segment.slice(LINE_BREAK_SEGMENT_PREFIX.length));
    } catch {
      return segment;
    }
  }
  return segment.startsWith('*') ? segment.slice(1) : segment;
}

export function logGroupPath(group: string): string {
  return `${LOG_GROUPS_PATH}/group/${nameSegment(group)}`;
}

export function logStreamPath(group: string, stream: string): string {
  return `${logGroupPath(group)}/stream/${nameSegment(stream)}`;
}

export function streamNameForDisplay(name: string): string {
  return name.replace(/\r\n|[\r\u2028\u2029]/g, '\n');
}

const STREAM_LABEL_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '\r': '\\r',
  '\n': '\\n',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function streamNameLabel(name: string): string {
  return name.replace(/[\\\r\n\u2028\u2029]/g, (character) => STREAM_LABEL_ESCAPES[character] ?? character);
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
