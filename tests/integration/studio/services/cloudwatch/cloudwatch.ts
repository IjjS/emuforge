// The emulator side and the words of CloudWatch's alarm screens (test-criteria.md, issue 70), for the
// `cloudwatch-*.spec.ts` checks.
//
// - Direct calls: `directCloudWatch` here, AWS JSON 1.0 through `directPost` of `support/aws-clients-general.ts`
//   (straight to the emulator, SigV4-signed with the key it wrote for this run, TLS verified against its `ca.pem`).
//   A refusal is read from its JSON `__type` and `message`, and its code from the header `x-amzn-query-error`, which
//   the emulator sends to a request that carries `x-amzn-query-mode` as AWS's SDK's does; "the emulator's
//   reason" or "code" a line asks for is that of a direct call that is refused the same way, compared with what
//   the screen shows.
// - `CloudWatchSeeded`: the alarms and topics a check makes, every one named under the check's prefix `<p>`. When
//   the check ends it deletes every alarm of the emulator whose name starts with `<p>`, those Studio's actions made
//   included, composite alarms first, and the topics it made. A check ends with `finish`, which cleans up inside the
//   check so that what could not be removed fails it.
// - The screens' words (requirement.md) and readers of what a screen shows.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { createdTopicArn, directPost, directSns, type DirectAnswer } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION } from '../../support/frame';
import { creationDateText } from '../../support/service-screens';
import type { Lines } from '../../support/lines';
import { waitFor } from '../../support/wait';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/**
 * A CloudWatch action (AWS JSON 1.0) with its JSON input, straight to the emulator. It carries
 * `x-amzn-query-mode: true`, as AWS's SDK does for this service, so a refusal comes with the header
 * `x-amzn-query-error` that holds the code the SDK reports.
 */
function directCloudWatch(ctx: Ctx, port: number, action: string, input: object): Promise<DirectAnswer> {
  return directPost(ctx, port, 'monitoring', JSON.stringify(input), {
    'content-type': 'application/x-amz-json-1.0',
    'x-amz-target': `GraniteServiceVersion20100801.${action}`,
    'x-amzn-query-mode': 'true',
  });
}

/**
 * A direct answer, parsed: its status, its JSON body (`{}` when empty), and for a refusal its type, its message and
 * its code: the first part of the header `x-amzn-query-error` ("ValidationError;Sender") when the emulator sent it,
 * else the type.
 */
export interface Answer {
  status: number;
  json: Record<string, unknown>;
  type: string | null;
  message: string | null;
  code: string | null;
}

function parsed(answer: DirectAnswer, what: string): Answer {
  if ('error' in answer) throw new EnvError(`${what}: ${answer.error}`);
  let json: Record<string, unknown> = {};
  if (answer.body.trim() !== '') {
    try {
      json = JSON.parse(answer.body) as Record<string, unknown>;
    } catch {
      json = { raw: answer.body };
    }
  }
  const type = typeof json.__type === 'string' ? (json.__type.split('#').at(-1) ?? null) : null;
  const message = typeof json.message === 'string' ? json.message : null;
  const queryError = answer.headers?.['x-amzn-query-error'];
  const queryCode = (Array.isArray(queryError) ? queryError[0] : queryError)?.split(';')[0]?.trim();
  return { status: answer.status, json, type, message, code: queryCode ? queryCode : type };
}

/** Sends `operation` with `input` straight to the emulator and logs its status. */
export async function cw(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  const answer = parsed(await directCloudWatch(ctx, port, operation, input), `direct ${operation}`);
  ctx.log(`direct ${operation}: status ${String(answer.status)}${answer.type ? ` ${answer.type}` : ''}`);
  return answer;
}

/** Sends `operation` and fails the check unless the emulator answered 200. */
export async function cwOk(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  const answer = await cw(ctx, port, operation, input);
  if (answer.status !== 200) {
    throw new Error(`direct ${operation} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  }
  return answer;
}

/** The emulator's refusal of a direct call: its code (`Answer.code`) and its reason (`message`). */
export interface Refusal {
  code: string;
  message: string;
}

/**
 * The emulator's refusal of `operation` with `input`, directly. Fails the check when the emulator does not refuse it
 * with a code and a reason.
 */
export async function refusalDirect(ctx: Ctx, port: number, operation: string, input: object): Promise<Refusal> {
  const answer = await cw(ctx, port, operation, input);
  if (answer.status === 200 || answer.code === null || answer.message === null || answer.message === '') {
    throw new Error(
      `direct ${operation} was not refused with a code and a reason: ${String(answer.status)} ${JSON.stringify(answer.json)}`,
    );
  }
  return { code: answer.code, message: answer.message };
}

/**
 * The emulator's code for refusing `operation` with `input`, directly, of a refusal that carries no reason. Fails
 * the check when the emulator does not refuse it with a code, or gives a reason (`refusalDirect` is for that one).
 */
export async function refusalCodeDirect(ctx: Ctx, port: number, operation: string, input: object): Promise<string> {
  const answer = await cw(ctx, port, operation, input);
  if (answer.status === 200 || answer.code === null || (answer.message !== null && answer.message !== '')) {
    throw new Error(`direct ${operation} was not refused with a code and no reason: ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  }
  return answer.code;
}

/**
 * What AWS's SDK puts in the place of a refusal's reason when the emulator's answer has none, which a screen then
 * shows after the code.
 */
export const NO_REASON = 'UnknownError';

const ALARM_TYPES = ['CompositeAlarm', 'MetricAlarm', 'LogAlarm'];

/** An alarm as `DescribeAlarms` reports it; the members a check reads are named, the others kept as they came. */
export interface DirectAlarm {
  AlarmName: string;
  AlarmArn: string;
  AlarmDescription?: string;
  ActionsEnabled?: boolean;
  AlarmActions?: string[];
  OKActions?: string[];
  InsufficientDataActions?: string[];
  StateValue?: string;
  StateReason?: string;
  Namespace?: string;
  MetricName?: string;
  Dimensions?: { Name: string; Value: string }[];
  Statistic?: string;
  ExtendedStatistic?: string;
  Period?: number;
  Unit?: string;
  EvaluationPeriods?: number;
  DatapointsToAlarm?: number;
  Threshold?: number;
  ComparisonOperator?: string;
  TreatMissingData?: string;
  AlarmRule?: string;
  [member: string]: unknown;
}

/** The alarms of a direct `DescribeAlarms`, by the list they came in. */
export interface DirectAlarms {
  metric: DirectAlarm[];
  composite: DirectAlarm[];
  log: DirectAlarm[];
}

/** Every alarm of a `DescribeAlarms` with `input`, of the three types, every page. */
async function describeAlarms(ctx: Ctx, port: number, input: object): Promise<DirectAlarms> {
  const alarms: DirectAlarms = { metric: [], composite: [], log: [] };
  let token: string | undefined;
  do {
    const answer = await cwOk(ctx, port, 'DescribeAlarms', {
      AlarmTypes: ALARM_TYPES,
      MaxRecords: 100,
      ...input,
      ...(token === undefined ? {} : { NextToken: token }),
    });
    alarms.metric.push(...((answer.json.MetricAlarms ?? []) as DirectAlarm[]));
    alarms.composite.push(...((answer.json.CompositeAlarms ?? []) as DirectAlarm[]));
    alarms.log.push(...((answer.json.LogAlarms ?? []) as DirectAlarm[]));
    token = answer.json.NextToken as string | undefined;
  } while (token !== undefined);
  return alarms;
}

/** Every alarm whose name starts with `prefix`, directly. */
export function alarmsDirect(ctx: Ctx, port: number, prefix: string): Promise<DirectAlarms> {
  return describeAlarms(ctx, port, { AlarmNamePrefix: prefix });
}

/** The alarms named exactly `name`, directly: none, or one in one of the three lists. */
export function alarmDirect(ctx: Ctx, port: number, name: string): Promise<DirectAlarms> {
  return describeAlarms(ctx, port, { AlarmNames: [name] });
}

/** The names of `alarms`, of every type, sorted. */
export function namesOf(alarms: DirectAlarms): string[] {
  return [...alarms.metric, ...alarms.composite, ...alarms.log].map((alarm) => alarm.AlarmName).sort();
}

/** The one metric alarm named `name`, directly; fails the check when the emulator holds none, or another type. */
export async function metricAlarmDirect(ctx: Ctx, port: number, name: string): Promise<DirectAlarm> {
  const alarms = await alarmDirect(ctx, port, name);
  const [alarm] = alarms.metric;
  if (alarm === undefined || alarms.metric.length !== 1 || alarms.composite.length + alarms.log.length !== 0) {
    throw new Error(`the emulator holds no single metric alarm named ${name}: ${JSON.stringify(alarms)}`);
  }
  return alarm;
}

/** The tags of the resource `arn`, directly, sorted by key. */
export async function tagsDirect(ctx: Ctx, port: number, arn: string): Promise<{ Key: string; Value: string }[]> {
  const answer = await cwOk(ctx, port, 'ListTagsForResource', { ResourceARN: arn });
  return ((answer.json.Tags ?? []) as { Key: string; Value: string }[])
    .map(({ Key, Value }) => ({ Key, Value }))
    .sort((x, y) => (x.Key < y.Key ? -1 : 1));
}

/** A history item as `DescribeAlarmHistory` reports it. */
export interface DirectHistoryItem {
  HistoryItemType?: string;
  HistorySummary?: string;
  Timestamp?: number;
}

/** The history of the alarm `name`, directly, every page, in the order the emulator gives (the newest first). */
export async function historyDirect(ctx: Ctx, port: number, name: string): Promise<DirectHistoryItem[]> {
  const items: DirectHistoryItem[] = [];
  let token: string | undefined;
  do {
    const answer = await cwOk(ctx, port, 'DescribeAlarmHistory', {
      AlarmName: name,
      AlarmTypes: ALARM_TYPES,
      MaxRecords: 100,
      ...(token === undefined ? {} : { NextToken: token }),
    });
    items.push(...((answer.json.AlarmHistoryItems ?? []) as DirectHistoryItem[]));
    token = answer.json.NextToken as string | undefined;
  } while (token !== undefined);
  return items;
}

/** Waits until a condition read directly holds, within `boundMs`; returns its last value. */
export async function eventually<T>(boundMs: number, read: () => Promise<T>, holds: (v: T) => boolean): Promise<T> {
  let last = await read();
  const found = await waitFor(boundMs, async () => {
    last = await read();
    return holds(last) ? last : undefined;
  });
  return found ?? last;
}

/** Waits, within `boundMs`, until the emulator reports the metric alarm `name` in `state`; fails the check otherwise. */
export async function waitState(ctx: Ctx, port: number, name: string, state: string, boundMs = 15_000): Promise<void> {
  const last = await eventually(
    boundMs,
    async () => (await alarmDirect(ctx, port, name)).metric[0]?.StateValue,
    (value) => value === state,
  );
  if (last !== state) throw new Error(`the emulator reports ${name} in ${String(last)}, not ${state}`);
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** The role a seeded log alarm's scheduled query names; the emulator stores it and reads nothing through it. */
const QUERY_ROLE = 'arn:aws:iam::000000000000:role/emuforge-it-scheduled-query';

/**
 * The alarms and topics a check makes under its prefix; every alarm of that prefix, and each topic made here, is
 * deleted when the check ends.
 */
export class CloudWatchSeeded {
  private readonly topics: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  /** The namespace the seeded metric alarms watch unless told otherwise: `<p>/ns`. */
  get namespace(): string {
    return `${this.prefix}/ns`;
  }

  private under(name: string): void {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
  }

  /**
   * `PutMetricAlarm name`: the metric `Errors` of `<p>/ns`, Sum over 60 seconds, greater than 1, 1 period, with
   * `overrides` over those (a member given as `undefined` is left out); returns the name. Put again for a name that
   * exists, it replaces the alarm, as the operation does.
   */
  async metricAlarm(name: string, overrides: Record<string, unknown> = {}): Promise<string> {
    this.under(name);
    await cwOk(this.ctx, this.port, 'PutMetricAlarm', {
      AlarmName: name,
      Namespace: this.namespace,
      MetricName: 'Errors',
      Statistic: 'Sum',
      Period: 60,
      EvaluationPeriods: 1,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanThreshold',
      ...overrides,
    });
    return name;
  }

  /** `PutMetricAlarm name` on a metric math expression: two entries of `Metrics`, `m1` a metric and `e1` `m1*2`. */
  async mathAlarm(name: string): Promise<string> {
    this.under(name);
    await cwOk(this.ctx, this.port, 'PutMetricAlarm', {
      AlarmName: name,
      Metrics: [
        {
          Id: 'm1',
          MetricStat: { Metric: { Namespace: this.namespace, MetricName: 'Errors' }, Period: 60, Stat: 'Sum' },
          ReturnData: false,
        },
        { Id: 'e1', Expression: 'm1*2', ReturnData: true },
      ],
      EvaluationPeriods: 1,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanThreshold',
    });
    return name;
  }

  /** `PutCompositeAlarm name` with the rule `rule`; returns the name. */
  async compositeAlarm(name: string, rule: string): Promise<string> {
    this.under(name);
    await cwOk(this.ctx, this.port, 'PutCompositeAlarm', { AlarmName: name, AlarmRule: rule });
    return name;
  }

  /** `PutLogAlarm name`: the query `fields @message` on the log group `group`, every 5 minutes; returns the name. */
  async logAlarm(name: string, group: string): Promise<string> {
    this.under(name);
    await cwOk(this.ctx, this.port, 'PutLogAlarm', {
      AlarmName: name,
      ScheduledQueryConfiguration: {
        QueryString: LOG_QUERY,
        LogGroupIdentifiers: [group],
        ScheduledQueryRoleARN: QUERY_ROLE,
        ScheduleConfiguration: { ScheduleExpression: 'rate(5 minutes)', StartTimeOffset: 300 },
        AggregationExpression: 'count(*)',
      },
      QueryResultsToEvaluate: 1,
      QueryResultsToAlarm: 1,
      Threshold: 1,
      ComparisonOperator: 'GreaterThanThreshold',
    });
    return name;
  }

  /** SNS `CreateTopic name`; returns the topic's ARN. The topic is deleted when the check ends. */
  async topic(name: string): Promise<string> {
    this.under(name);
    const answer = await directSns(this.ctx, this.port, 'CreateTopic', { Name: name });
    if ('error' in answer) throw new EnvError(`direct CreateTopic: ${answer.error}`);
    const arn = createdTopicArn(answer.body);
    if (answer.status !== 200 || arn === '') {
      throw new Error(`direct CreateTopic answered ${String(answer.status)} ${answer.body}`);
    }
    this.topics.push(arn);
    return arn;
  }

  /** `SetAlarmState name` to `state` with `reason`, as an app or the AWS CLI would. */
  async setState(name: string, state: string, reason = 'set outside'): Promise<void> {
    await cwOk(this.ctx, this.port, 'SetAlarmState', { AlarmName: name, StateValue: state, StateReason: reason });
  }

  /** `DeleteAlarms name`, as an app or the AWS CLI would while a screen shows the alarm. */
  async deleteAlarm(name: string): Promise<void> {
    await cwOk(this.ctx, this.port, 'DeleteAlarms', { AlarmNames: [name] });
  }

  /** `PutMetricData`: one data point, now, for `metric` of `namespace` with `dimensions`. */
  async metricData(namespace: string, metric: string, dimensions: { Name: string; Value: string }[]): Promise<void> {
    await cwOk(this.ctx, this.port, 'PutMetricData', {
      Namespace: namespace,
      MetricData: [{ MetricName: metric, Dimensions: dimensions, Value: 1, Timestamp: Math.floor(Date.now() / 1000) }],
    });
  }

  /**
   * Deletes every alarm of the emulator under the check's prefix, one name a call and the composite alarms first (a
   * composite alarm that names another keeps that one from being deleted), then the topics made here, then reads the
   * prefix again. No step keeps the next from being tried: a read of the prefix that fails, a refusal and a call that
   * did not get through are each noted, and the topics are deleted whatever became of the alarms. Whatever was
   * noted, and each alarm still there at the end with what the emulator answered for it, is one error.
   */
  async clean(): Promise<void> {
    const problems: string[] = [];
    const refused = new Map<string, string>();
    const remove = async (name: string): Promise<void> => {
      try {
        const answer = await cw(this.ctx, this.port, 'DeleteAlarms', { AlarmNames: [name] });
        if (answer.status !== 200) {
          refused.set(name, `DeleteAlarms answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
        }
      } catch (e) {
        refused.set(name, `DeleteAlarms: ${(e as Error).message}`);
      }
    };
    try {
      const held = await alarmsDirect(this.ctx, this.port, this.prefix);
      for (const alarm of [...held.composite, ...held.log, ...held.metric]) await remove(alarm.AlarmName);
    } catch (e) {
      problems.push(`the alarms under ${this.prefix} could not be read for their removal: ${(e as Error).message}`);
    }

    for (const arn of [...this.topics]) {
      let problem: string | undefined;
      try {
        const answer = await directSns(this.ctx, this.port, 'DeleteTopic', { TopicArn: arn });
        if ('error' in answer) problem = answer.error;
        else if (answer.status !== 200) problem = `DeleteTopic answered ${String(answer.status)}`;
      } catch (e) {
        problem = (e as Error).message;
      }
      if (problem === undefined) this.topics.splice(this.topics.indexOf(arn), 1);
      else problems.push(`the topic ${arn} could not be removed: ${problem}`);
    }

    try {
      const left = namesOf(await alarmsDirect(this.ctx, this.port, this.prefix));
      if (left.length > 0) {
        problems.push(
          `the alarms under ${this.prefix} that could not be removed: ${left
            .map((name) => `${JSON.stringify(name)} (${refused.get(name) ?? 'deleted with 200 and still reported'})`)
            .join('; ')}`,
        );
      }
    } catch (e) {
      problems.push(`the alarms under ${this.prefix} could not be read after their removal: ${(e as Error).message}`);
    }
    if (problems.length > 0) throw new Error(problems.join('\n'));
  }

  /**
   * The cleanup of a check that did not reach its `finish` (a check that threw on its way): the same as `clean`. The
   * fixture only logs what this throws, which is why a check that runs to its end cleans up through `finish`.
   */
  async dispose(): Promise<void> {
    await this.clean();
  }
}

/**
 * Ends a check: removes what it made under its prefix (`CloudWatchSeeded.clean`), inside the check, then fails it
 * when a criteria line failed or the cleanup left something behind, naming both.
 */
export async function finish(lines: Lines, seeded: CloudWatchSeeded): Promise<void> {
  let cleanup: string | undefined;
  try {
    await seeded.clean();
  } catch (e) {
    if (e instanceof EnvError) throw e;
    cleanup = `cleanup: ${(e as Error).message}`;
  }
  try {
    lines.end();
  } catch (e) {
    throw cleanup === undefined ? e : new Error(`${(e as Error).message}\n${cleanup}`);
  }
  if (cleanup !== undefined) throw new Error(cleanup);
}

// ---------------------------------------------------------------------------------------------------------------
// Paths and words.
// ---------------------------------------------------------------------------------------------------------------

export const CLOUDWATCH_PATH = '/aws/cloudwatch';
export const ALARMS_PATH = `${CLOUDWATCH_PATH}/alarms`;
export const ALARM_PATH = `${ALARMS_PATH}/alarm`;
export const CREATE_ALARM_PATH = `${ALARMS_PATH}/create`;
export const EDIT_ALARM_PATH = `${ALARMS_PATH}/edit`;

/** The address of the page of the alarm `name`: the name is the query parameter `name`. */
export function alarmPath(name: string): string {
  return `${ALARM_PATH}?${new URLSearchParams({ name }).toString()}`;
}
/** The address of the edit form of the alarm `name`. */
export function editAlarmPath(name: string): string {
  return `${EDIT_ALARM_PATH}?${new URLSearchParams({ name }).toString()}`;
}

export const NAVIGATION_HEADER = 'CloudWatch';
export const ALARMS = 'Alarms';
export const CREATE_ALARM = 'Create alarm';
export const EDIT_ALARM = 'Edit alarm';
export const SAVE_CHANGES = 'Save changes';
export const EDIT = 'Edit';
export const DELETE = 'Delete';
export const SAVE = 'Save';
export const REFRESH = 'Refresh';
export const SET_STATE = 'Set state';
export const TURN_ACTIONS_OFF = 'Turn actions off';
export const TURN_ACTIONS_ON = 'Turn actions on';
export const MANAGE_TAGS = 'Manage tags';
export const ADD_TAG = 'Add tag';
export const VIEW_HISTORY = 'View history';
export const BACK_TO_ALARM = 'Back to alarm';
export const NO_ALARMS_MATCH = 'No alarms match';
export const ALARM_NOT_FOUND = 'Alarm not found';
export const CANNOT_EDIT = 'Studio cannot edit this alarm yet';
export const CHANGED_WHILE_EDITING = 'This alarm changed while you were editing it';
export const LOG_ALARM_STATE = 'The emulator does not set the state of a log alarm.';
export const DEFAULT_REASON = 'Set by hand in EmuForge Studio';
export const NO_ACTIONS = 'No actions';
export const NOT_A_TOPIC = 'Not a topic in the emulator';
export const NO_DATA_YET = 'Enter a metric that has no data yet';
export const CHOOSE_A_METRIC_NAME = 'Choose a metric name';
export const CHOOSE_A_METRIC_NAME_FIRST = 'Choose a metric name first';
export const ADDED_OUTSIDE = 'Added outside this dialog';
export const REMOVALS_SAVED = 'The removals were saved. The added and changed tags were not:';
/** The query of a seeded log alarm. */
export const LOG_QUERY = 'fields @message';

export function alarmCreated(name: string): string {
  return `Alarm ${name} created.`;
}
export function alarmSaved(name: string): string {
  return `Alarm ${name} saved.`;
}
export function alarmDeleted(name: string): string {
  return `Alarm ${name} deleted.`;
}
export function alarmExists(name: string): string {
  return `An alarm named ${name} already exists.`;
}
export function stateSet(name: string, state: string): string {
  return `State of ${name} set to ${state}.`;
}
export function actionsTurned(name: string, to: 'off' | 'on'): string {
  return `Actions of ${name} turned ${to}.`;
}
export function tagsSaved(name: string): string {
  return `Tags of ${name} saved.`;
}
export function deleteHeading(name: string): string {
  return `Delete alarm ${name}?`;
}
/** The sentence of the form's condition: how many periods of how many. */
export function alarmWhen(datapoints: number, periods: number): string {
  return `Alarm when ${String(datapoints)} out of ${String(periods)} periods meet the condition.`;
}
/** What a refused write shows above its code and reason. */
export function failed(operation: string): string {
  return `${operation} failed`;
}
/** A refusal as a screen writes it: its code, then its reason. */
export function codeAndMessage(refusal: Refusal): string {
  return `${refusal.code}: ${refusal.message}`;
}

/** The state a screen shows for the `StateValue` of a direct answer. */
export function stateText(state: string | undefined): string {
  return { OK: 'OK', ALARM: 'In alarm', INSUFFICIENT_DATA: 'Insufficient data' }[state ?? ''] ?? '-';
}
/** The actions a screen shows for the `ActionsEnabled` of a direct answer. */
export function actionsText(enabled: boolean | undefined): string {
  return enabled === undefined ? '-' : enabled ? 'On' : 'Off';
}
/** The type a history row shows for the `HistoryItemType` of a direct answer. */
export function historyTypeText(type: string | undefined): string {
  return { ConfigurationUpdate: 'Configuration', StateUpdate: 'State', Action: 'Action' }[type ?? ''] ?? (type ?? '-');
}

/** The service's entries as the requirement's table has them: label and path; only Alarms has a screen. */
export const ENTRIES: { label: string; path: string; screen: boolean }[] = [
  { label: 'Alarms', path: '/aws/cloudwatch/alarms', screen: true },
  { label: 'Alarm mute rules', path: '/aws/cloudwatch/alarm-mute-rules', screen: false },
  { label: 'Anomaly detectors', path: '/aws/cloudwatch/anomaly-detectors', screen: false },
  { label: 'Dashboards', path: '/aws/cloudwatch/dashboards', screen: false },
  { label: 'Insight rules', path: '/aws/cloudwatch/insight-rules', screen: false },
  { label: 'Metric streams', path: '/aws/cloudwatch/metric-streams', screen: false },
  { label: 'Metrics', path: '/aws/cloudwatch/metrics', screen: false },
];

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** A selector of Cloudscape's, usable inside a scoped locator (no leading `body`). */
function rel(selector: { toSelector(): string }): string {
  return selector.toSelector().replace(/^body /, '');
}
/** The part of a selector below its component's root, for a locator that is that root. */
function inside(selector: { toSelector(): string }): string {
  return rel(selector).replace(/^\[class\*="awsui_root_\w+"\] /, '');
}

export const TABLE = rel(wrapper.findTable());
/** The data rows of a table, below its root: a loading or an empty table has none. */
const TABLE_ROWS = inside(wrapper.findTable().findRows());
/** The column headings of a table, below its root, the selection column's (without a text) included. */
const TABLE_HEADERS = inside(wrapper.findTable().findColumnHeaders());
const TABLE_EMPTY = inside(wrapper.findTable().findEmptySlot());
const MODAL = wrapper.findModal().toSelector();
const MODAL_HEADER = inside(wrapper.findModal().findHeader());
const HEADING_TEXT = rel(wrapper.findHeader().findHeadingText());
const TEXT_FILTER = rel(wrapper.findTextFilter().findInput().findNativeInput());
const NEXT_PAGE = rel(wrapper.findPagination().findNextPageButton());
const PREVIOUS_PAGE = rel(wrapper.findPagination().findPreviousPageButton());
const ALERT = rel(wrapper.findAlert());
const ALERT_HEADER = inside(wrapper.findAlert().findHeader());
const ALERT_CONTENT = inside(wrapper.findAlert().findContent());
const FIRST_FLASH = wrapper.findFlashbar().findItems().get(1);
/** A flash item's content, as a selector below the item. */
const FLASH_CONTENT = FIRST_FLASH.findContent().toSelector().slice(FIRST_FLASH.toSelector().length).trim();
const CONTAINER = rel(wrapper.findContainer());
const FORM_FIELD = rel(wrapper.findFormField());
const FORM_FIELD_ERROR = inside(wrapper.findFormField().findError());
const SELECT = rel(wrapper.findSelect());
const SELECT_TRIGGER = inside(wrapper.findSelect().findTrigger());
const SELECT_OPEN = inside(wrapper.findSelect().findDropdown().findOpenDropdown());
const SELECT_FILTER = inside(wrapper.findSelect().findFilteringInput().findNativeInput());
const MULTISELECT = rel(wrapper.findMultiselect());
const MULTISELECT_TRIGGER = inside(wrapper.findMultiselect().findTrigger());
const MULTISELECT_OPEN = inside(wrapper.findMultiselect().findDropdown().findOpenDropdown());
const TOGGLE = rel(wrapper.findToggle().findNativeInput());
const INPUT = rel(wrapper.findInput().findNativeInput());
const TEXTAREA = rel(wrapper.findTextarea().findNativeTextarea());
const EDITOR_ROWS = rel(wrapper.findAttributeEditor().findRows());
/** Every option of a select's open list, below the select's root. */
const SELECT_OPTIONS = inside(wrapper.findSelect().findDropdown().findOptions());
const FIRST_PAIR = wrapper.findKeyValuePairs().findItems().get(1);
/** The pairs of a key-value list, and a pair's label and value as selectors below the pair. */
const PAIR = rel(wrapper.findKeyValuePairs().findItems());
const PAIR_LABEL = FIRST_PAIR.findLabel().toSelector().slice(FIRST_PAIR.toSelector().length).trim();
const PAIR_VALUE = FIRST_PAIR.findValue().toSelector().slice(FIRST_PAIR.toSelector().length).trim();
/** The reason a button that cannot be pressed shows while the pointer or the keyboard is on it. */
const DISABLED_REASON = wrapper.findButton().findDisabledReason().toSelector();
const COPY_ROOT = wrapper.findCopyToClipboard();
/** A copy control (Cloudscape's `CopyToClipboard`), and what a press of it says, as a selector below the control. */
const COPY = rel(COPY_ROOT);
const COPY_STATUS = COPY_ROOT.findStatusText().toSelector().slice(COPY_ROOT.toSelector().length).trim();
/** An option of a select or a multiselect by its value. */
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}
/** The tags of the option the token `token` (1 the first) of a multiselect shows, below the multiselect's root. */
function tokenTags(token: number): string {
  return inside(wrapper.findMultiselect().findToken(token).findOption().findTags());
}
/** The description of the option the token `token` (1 the first) of a multiselect shows. */
function tokenDescription(token: number): string {
  return inside(wrapper.findMultiselect().findToken(token).findOption().findDescription());
}
/** The native input of field `column` (1 the first) of row `row` (1 the first) of an attribute editor. */
function editorInput(row: number, column: number): string {
  return rel(wrapper.findAttributeEditor().findRow(row).findField(column).findControl().findInput().findNativeInput());
}
/** The remove button of row `row` (1 the first) of an attribute editor. */
function editorRemove(row: number): string {
  return rel(wrapper.findAttributeEditor().findRow(row).findRemoveButton());
}

const norm = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The text each element of `found` draws, character for character: its text nodes that are drawn (not under
 * `display: none`, `visibility: hidden`, a zero opacity or a clipped-away box, and, but for white space alone, with a
 * box of their own), joined
 * in document order. A text that is in the page and not shown is no part of it, so a value hidden inside a shown
 * row, pair, alert or flash reads as absent. White space is as written; nothing is folded.
 */
export async function shownTexts(found: Locator): Promise<string[]> {
  return found.evaluateAll((els) => {
    const hidden = (from: Element): boolean => {
      for (let a: Element | null = from; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
        if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
        if (/inset\(\s*50%/.test(cs.clipPath)) return true;
        const box = a.getBoundingClientRect();
        if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
      }
      return false;
    };
    return els.map((el) => {
      let text = '';
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const holder = node.parentElement;
        if (holder === null || hidden(holder)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        // White space between two words has no box of its own where the line breaks: it is kept with its holder.
        if ((node.textContent ?? '').trim() !== '' && range.getClientRects().length === 0) continue;
        text += node.textContent ?? '';
      }
      return text;
    });
  });
}

/** Waits until the texts the elements of `found` draw, white space folded, are `want`, each whole, in that order. */
export async function expectShown(found: Locator, want: string[], what: string, timeout = 15_000): Promise<void> {
  await expect
    .poll(async () => (await shownTexts(found)).map(norm), {
      message: what,
      timeout,
    })
    .toEqual(want.map(norm));
}

/** A text as an element draws it and how its white space is drawn. */
export interface DrawnText {
  /** The text the element draws, whole: every character, white space as written (`shownTexts`). */
  text: string;
  /** The computed `white-space` of the element that holds the text's first characters. */
  whiteSpace: string;
}

/**
 * The text `element` draws, whole, and the computed `white-space` of the parent of its first text node. A name is
 * read so, never by an accessible name, which folds white space.
 */
export async function drawnText(element: Locator): Promise<DrawnText> {
  const [text] = await shownTexts(element);
  const whiteSpace = await element.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let first: Node | null = walker.nextNode();
    while (first !== null && (first.textContent ?? '') === '') first = walker.nextNode();
    return getComputedStyle(first?.parentElement ?? el).whiteSpace;
  });
  return { text: text ?? '', whiteSpace };
}

/** The heading text of the page's `h1`, found with Cloudscape's selector. */
export function pageHeading(page: Page): Locator {
  return page.locator(HEADING_TEXT).and(page.locator('h1 *')).first();
}

/**
 * The titles the page draws: the heading text of every `h1`, found with Cloudscape's selector, so a counter or
 * another part of a header is no part of a title; white space folded.
 */
export async function shownTitles(page: Page): Promise<string[]> {
  return (await shownTexts(page.locator(HEADING_TEXT).and(page.locator('h1 *')))).map(norm);
}

/** Waits until the page's `h1` is shown and reads `text`, character for character. */
export async function expectHeading(page: Page, text: string, timeout = 15_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const heading = pageHeading(page);
        return (await heading.count()) === 1 && (await heading.isVisible()) ? (await drawnText(heading)).text : null;
      },
      { message: `the h1 ${JSON.stringify(text)}`, timeout },
    )
    .toBe(text);
}

/**
 * Waits until the page's `h1` is shown and holds the alarm name `name`, character for character, in an element
 * that keeps white space (`pre-wrap`), so its repeated spaces and its line feeds are drawn.
 */
export async function expectNameHeading(page: Page, name: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const heading = pageHeading(page);
        return (await heading.count()) === 1 && (await heading.isVisible()) ? drawnText(heading) : null;
      },
      { message: `the h1 ${JSON.stringify(name)}, its white space kept`, timeout: 15_000 },
    )
    .toEqual({ text: name, whiteSpace: 'pre-wrap' });
}

/** Opens `path` and waits for its `h1` `h1`, character for character. */
export async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expectHeading(page, h1);
}

/** The data rows of the table `table`, found with Cloudscape's selector: what a row holds is looked for inside them. */
export function rowsIn(table: Locator): Locator {
  return table.locator(TABLE_ROWS);
}

/** The cell of data row `row` under heading `column` (each 1 the first) of a table, below its root. */
function bodyCell(row: number, column: number): string {
  return inside(wrapper.findTable().findBodyCell(row, column));
}

/**
 * The data rows of the table `table` as shown, each a record of its column headings' texts to its cells' texts (the
 * selection column has no heading and is left out), white space folded: a cell's text is what the cell draws
 * (`shownTexts`), so a value hidden inside a shown row reads as empty. Headings, rows and cells are found with
 * Cloudscape's selectors. A table that is loading, empty or failed has no data row; a row that is in the page and
 * not shown is an empty record, which no expectation of a text equals.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  const headers = (await table.locator(TABLE_HEADERS).allTextContents()).map(norm);
  const count = await rowsIn(table).count();
  return Promise.all(
    Array.from({ length: count }, async (_, r) => {
      const row: Record<string, string> = {};
      if (!(await rowsIn(table).nth(r).isVisible())) return row;
      await Promise.all(
        headers.map(async (header, c) => {
          if (header === '') return;
          const [text] = await shownTexts(table.locator(bodyCell(r + 1, c + 1)));
          if (text !== undefined) row[header] = norm(text);
        }),
      );
      return row;
    }),
  );
}

/** Waits until the rows of `table`, mapped by `pick`, equal `want`. */
export async function expectRows<T>(
  table: Locator,
  pick: (row: Record<string, string>) => T,
  want: T[],
  what: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => (await rowsOf(table)).map(pick), { message: what, timeout }).toEqual(want);
}

/** Waits until `table` shows no data row and its empty state reads `text`. */
export async function expectEmpty(table: Locator, text: string): Promise<void> {
  await expectShown(table.locator(TABLE_EMPTY), [text], `the table's empty state "${text}"`);
  expect(await rowsOf(table), 'the rows beside the empty state').toEqual([]);
}

/** The flash items of type `type`, as one locator. */
export function flashItems(page: Page, type: 'success' | 'error' | 'info' | 'warning'): Locator {
  return page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
}

/**
 * Waits until one flash item of `type` that is shown, and no more, draws `sentence`, whole (white space folded; the
 * content's drawn text, `shownTexts`); with `link`, the content is the sentence followed by a link of that name,
 * shown, and nothing else.
 */
export async function expectFlash(
  page: Page,
  type: 'success' | 'error' | 'warning',
  sentence: string,
  link?: string,
): Promise<void> {
  const contents = flashItems(page, type).filter({ visible: true }).locator(FLASH_CONTENT);
  const whole = (shown: string) => {
    const text = norm(shown);
    if (link === undefined) return text === norm(sentence);
    return text.endsWith(link) && norm(text.slice(0, text.length - link.length)) === norm(sentence);
  };
  await expect
    .poll(async () => (await shownTexts(contents)).filter(whole).length, {
      message: `one ${type} flash reading "${sentence}"${link === undefined ? '' : ` with the link "${link}"`}`,
      timeout: 15_000,
    })
    .toBe(1);
  if (link !== undefined) {
    await expect(
      flashItems(page, type).filter({ visible: true }).getByRole('link', { name: link, exact: true }),
      `the flash's link "${link}"`,
    ).toBeVisible();
  }
}

/** Whether a request the page sent to the engine is the CloudWatch operation `operation`. */
export function isOperation(headers: Record<string, string>, operation: string): boolean {
  return headers['x-amz-target'] === `GraniteServiceVersion20100801.${operation}`;
}

/** The answer to the page's `operation` whose JSON input satisfies `input` (any input when omitted). */
function answerTo(page: Page, operation: string, input?: (body: Record<string, unknown>) => boolean) {
  return page.waitForResponse(
    (r) => {
      if (!isOperation(r.request().headers(), operation)) return false;
      if (input === undefined) return true;
      try {
        return input(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
}

/** Runs `act` and waits for the page's answer to its `operation`. */
export async function answered(page: Page, operation: string, act: () => Promise<void>): Promise<void> {
  const answer = answerTo(page, operation);
  await act();
  await answer;
}

/**
 * From now on, counts the requests of the page that are the CloudWatch operation `operation`; the returned function
 * gives the count so far.
 */
export function countSent(page: Page, operation: string): () => number {
  let sent = 0;
  page.on('request', (request) => {
    if (isOperation(request.headers(), operation)) sent++;
  });
  return () => sent;
}

/**
 * The form field of `scope` whose control is labelled exactly `label`: the field is found from its control, which
 * the field's label names (an input, a text area, the trigger of a select or a multiselect).
 */
export function field(scope: Locator, label: string): Locator {
  return scope
    .locator(FORM_FIELD)
    .filter({ has: scope.page().getByLabel(label, { exact: true }) })
    .last();
}

/** The error of the form field `formField`, found with Cloudscape's selector. */
export function errorOf(formField: Locator): Locator {
  return formField.locator(FORM_FIELD_ERROR);
}

/** The select of `scope`, opened: its trigger pressed, its list shown. */
async function opened(scope: Locator): Promise<Locator> {
  const select = scope.locator(SELECT).first();
  await select.locator(SELECT_TRIGGER).click(ACTION);
  await expect(select.locator(SELECT_OPEN), 'the list of the select').toBeVisible(ACTION);
  return select;
}

/**
 * In the one select inside `scope`: opens it, types `find` into its own search when given (a list read from the
 * emulator, narrowed to what the check made), and chooses the option whose value is `value`.
 */
export async function chooseOption(scope: Locator, value: string, find?: string): Promise<void> {
  const select = await opened(scope);
  if (find !== undefined) await select.locator(SELECT_FILTER).fill(find, ACTION);
  const option = select.locator(optionByValue(value));
  await expect(option, `the option ${value === '' ? '(the first, fixed one)' : value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(select.locator(SELECT_OPEN), 'the list after the choice').toHaveCount(0);
}

/**
 * Opens the one select inside `scope`, waits until what it offers is the options of the values `values` and no
 * other (each of them shown, and as many options as values), and closes it again with nothing chosen.
 */
export async function expectOffered(scope: Locator, values: string[], what: string): Promise<void> {
  const select = await opened(scope);
  await expect
    .poll(
      async () => ({
        options: await select.locator(SELECT_OPTIONS).count(),
        shown: await Promise.all(values.map((value) => select.locator(optionByValue(value)).isVisible())),
      }),
      { message: what, timeout: 20_000 },
    )
    .toEqual({ options: values.length, shown: values.map(() => true) });
  await select.page().keyboard.press('Escape');
  await expect(select.locator(SELECT_OPEN), 'the list after Escape').toHaveCount(0);
}

/** The select inside `scope`, for what it shows as chosen. */
export function selectOf(scope: Locator): Locator {
  return scope.locator(SELECT).first().locator(SELECT_TRIGGER);
}

/** In the one multiselect inside `scope`: opens it, chooses the option whose value is `value`, and closes it. */
export async function chooseInMultiselect(scope: Locator, value: string): Promise<void> {
  const multiselect = scope.locator(MULTISELECT).first();
  await multiselect.locator(MULTISELECT_TRIGGER).click(ACTION);
  const option = multiselect.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await multiselect.page().keyboard.press('Escape');
  await expect(multiselect.locator(MULTISELECT_OPEN), 'the list after the choice').toHaveCount(0);
}

/** What the token `token` (1 the first) of the one multiselect inside `scope` shows: its description and tags. */
export function tokenOf(scope: Locator, token: number) {
  const multiselect = scope.locator(MULTISELECT).first();
  return {
    description: multiselect.locator(tokenDescription(token)),
    tags: multiselect.locator(tokenTags(token)),
  };
}

/** The alerts of `scope`. */
export function alerts(scope: Locator): Locator {
  return scope.locator(ALERT);
}

/** The contents of the alerts of `scope`, found with Cloudscape's selector. */
export function alertContents(scope: Locator): Locator {
  return alerts(scope).locator(ALERT_CONTENT);
}

/** The headers of the alerts of `scope`, found with Cloudscape's selector. */
export function alertHeaders(scope: Locator): Locator {
  return alerts(scope).locator(ALERT_HEADER);
}

/**
 * Waits until `scope` (a dialog, a form) holds one alert and no more, its header reading `header` and its content
 * `content`, each whole and drawn (`expectShown`).
 */
export async function expectAlert(scope: Locator, header: string, content: string): Promise<void> {
  await expectShown(alertHeaders(scope), [header], `the one alert is headed "${header}"`);
  await expectShown(alertContents(scope), [content], `the alert "${header}" reads "${content}"`);
}

/**
 * The reason the button under the pointer shows for not being pressable, found with Cloudscape's selector: one is
 * in the page at a time, that of the button the pointer or the keyboard is on.
 */
export function disabledReason(page: Page): Locator {
  return page.locator(DISABLED_REASON);
}

/** The open dialog: Cloudscape's modal that is shown (one that is closed stays in the page, hidden). */
export function dialogOf(page: Page): Locator {
  return page.locator(MODAL).filter({ visible: true });
}

/** The header of the open dialog, found with Cloudscape's selector. */
export function dialogHeader(page: Page): Locator {
  return dialogOf(page).locator(MODAL_HEADER);
}

/** In the open dialog: types `typed` into its one text field and chooses `action`. */
export async function confirmWith(page: Page, typed: string, action: string): Promise<void> {
  const dialog = dialogOf(page);
  await expect(dialog, 'the dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(typed, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

// --- S1, Alarms -------------------------------------------------------------------------------------------------

/** The parts of S1 a check acts on. */
export function alarmList(page: Page) {
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  return {
    main,
    table,
    filter: table.locator(TEXT_FILTER),
    state: field(main, 'State'),
    /** The selection control of the alarm `name`: its accessible name is the alarm's name. */
    radio: (name: string) => rowsIn(table).getByRole('radio', { name, exact: true }),
    link: (name: string) => rowsIn(table).getByRole('link', { name, exact: true }),
    /** The link of the name in data row `row` (0 the first): a name with unusual white space is found by its place. */
    nameLink: (row: number) => rowsIn(table).nth(row).getByRole('link'),
    edit: main.getByRole('button', { name: EDIT, exact: true }),
    editLink: main.getByRole('link', { name: EDIT, exact: true }),
    del: main.getByRole('button', { name: DELETE, exact: true }),
    next: main.locator(NEXT_PAGE),
    previous: main.locator(PREVIOUS_PAGE),
  };
}

/**
 * Types `text` into the alarm list's filter and waits for the page's `DescribeAlarms` of that name prefix to be
 * answered, so nothing that follows meets the list while it is read again. `text` differs from the filter's text.
 */
export async function filterAlarms(page: Page, text: string): Promise<void> {
  const answer = answerTo(page, 'DescribeAlarms', (body) => (body.AlarmNamePrefix ?? '') === text);
  await alarmList(page).filter.fill(text, ACTION);
  await answer;
}

/**
 * Chooses the state of value `value` (`''` any state) in the alarm list's "State" and waits for the page's
 * `DescribeAlarms` of that state to be answered. `value` differs from the state chosen.
 */
export async function chooseState(page: Page, value: '' | 'OK' | 'ALARM' | 'INSUFFICIENT_DATA'): Promise<void> {
  const answer = answerTo(page, 'DescribeAlarms', (body) => (body.StateValue ?? '') === value);
  await chooseOption(alarmList(page).state, value);
  await answer;
}

/** Waits until the names the alarm list shows are `want`, in that order (white space folded). */
export async function expectAlarms(page: Page, want: string[]): Promise<void> {
  await expectRows(alarmList(page).table, (r) => r.Name, want, `the alarms listed: ${want.join(', ') || 'none'}`);
}

/** Opens Alarms and filters it by `prefix`. */
export async function openAlarms(page: Page, prefix: string): Promise<void> {
  await open(page, ALARMS_PATH, ALARMS);
  await filterAlarms(page, prefix);
}

// --- S3, an alarm's page ----------------------------------------------------------------------------------------

/** The parts of S3 a check acts on. */
export function alarmScreen(page: Page) {
  const main = page.getByRole('main');
  const history = page.getByRole('region', { name: 'History', exact: true });
  return {
    main,
    button: (name: string) => main.getByRole('button', { name, exact: true }),
    /** The page's own "Refresh", not the history's. */
    refresh: main.getByRole('button', { name: REFRESH, exact: true }).first(),
    edit: main.getByRole('link', { name: EDIT, exact: true }),
    history,
    historyTable: history.locator(TABLE),
    historyRefresh: history.getByRole('button', { name: REFRESH, exact: true }),
    historyNext: history.locator(NEXT_PAGE),
    /** The table of the tags: the one that holds "Manage tags". */
    tags: main.locator(TABLE).filter({ has: page.getByRole('button', { name: MANAGE_TAGS, exact: true }) }),
    /** "Alarm not found" in the place of the alarm, whatever heading holds it. */
    notFound: main.getByRole('heading', { name: ALARM_NOT_FOUND, exact: true }),
    /** The way back to Alarms from a page that has no alarm to show: the link in the page's own container. */
    backToAlarms: main.locator(CONTAINER).getByRole('link', { name: ALARMS, exact: true }),
  };
}

/** Opens the page of the alarm `name` and waits for its `h1`, the name character for character. */
export async function openAlarm(page: Page, name: string): Promise<void> {
  await open(page, alarmPath(name), name);
}

/** A history item as its row shows it. */
export interface HistoryRow {
  time: string;
  type: string;
  summary: string;
}

/** The rows of the history as shown: time, type and summary, in order. */
export async function historyRows(page: Page): Promise<HistoryRow[]> {
  return (await rowsOf(alarmScreen(page).historyTable)).map((r) => ({
    time: r.Time ?? '',
    type: r.Type ?? '',
    summary: r.Summary ?? '',
  }));
}

/**
 * The row the history shows for the item `item` of a direct answer: its time as the screen writes it, to the second,
 * in the zone of the machine the check and its browser run on ("October 30, 2026, 23:18:34 (UTC+09:00)"), the words
 * of its type and its summary.
 */
export function historyRowOf(item: DirectHistoryItem): HistoryRow {
  if (item.Timestamp === undefined) throw new EnvError('a history item of the direct answer has no Timestamp');
  const ms = item.Timestamp * 1000;
  const offsetMinutes = -new Date(ms).getTimezoneOffset();
  const two = (n: number) => String(Math.trunc(n)).padStart(2, '0');
  const size = Math.abs(offsetMinutes);
  const label = `UTC${offsetMinutes < 0 ? '-' : '+'}${two(size / 60)}:${two(size % 60)}`;
  return {
    time: creationDateText(new Date(ms).toISOString(), {
      offsetMinutes,
      label,
    }),
    type: historyTypeText(item.HistoryItemType),
    summary: norm(item.HistorySummary ?? '-'),
  };
}

/**
 * The values the alarm's page draws for the pairs labelled `label`, character for character. Pairs, labels and
 * values are found with Cloudscape's key-value selectors, and the pair is told by its label's drawn text; a value
 * that is in the page and not shown reads as empty.
 */
export async function shownPairValues(page: Page, label: string): Promise<string[]> {
  const pairs = page.getByRole('main').locator(PAIR);
  const [labels, values] = await Promise.all([
    shownTexts(pairs.locator(PAIR_LABEL)),
    shownTexts(pairs.locator(PAIR_VALUE)),
  ]);
  // Every pair has one label and one value, both in document order: the two lists run side by side.
  if (labels.length !== values.length) return [];
  return values.filter((_, at) => norm(labels[at] ?? '') === label);
}

/**
 * The copy control of `scope` whose button is named `control`, found with Cloudscape's selectors: its button and
 * what a press of it says.
 */
export function copyOf(scope: Locator, control: string) {
  const button = scope.page().getByRole('button', { name: control, exact: true });
  const root = scope.locator(COPY).filter({ has: button });
  return {
    button: root.getByRole('button', { name: control, exact: true }),
    status: root.locator(COPY_STATUS),
  };
}

/** The tags the alarm's page shows, sorted by key. */
export async function shownTags(page: Page): Promise<{ Key: string; Value: string }[]> {
  return (await rowsOf(alarmScreen(page).tags))
    .map((r) => ({ Key: r.Key ?? '', Value: r.Value ?? '' }))
    .sort((x, y) => (x.Key < y.Key ? -1 : 1));
}

/** A pair of a key-value list as shown: its label, and its value's text or, when the value is a list, its pairs. */
export interface ShownPair {
  label: string;
  value: string | Record<string, string>;
}

/**
 * The pairs the alarm's page shows that are no part of another pair's value, in order, each with its label and its
 * value: the value's text (white space folded), or, for a value that is itself a list of pairs, those pairs by
 * label. Pairs, labels and values are found with Cloudscape's selectors; a pair that is not shown is left out, and
 * a label's or a value's text is what it draws, so one hidden inside a shown pair reads as empty.
 */
export async function shownPairs(page: Page): Promise<ShownPair[]> {
  return page
    .getByRole('main')
    .locator(PAIR)
    .evaluateAll(
      (els, selectors) => {
        // As `shownTexts`: the text an element draws, here with its white space folded.
        const hidden = (from: Element): boolean => {
          for (let a: Element | null = from; a; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
            if (cs.clip !== 'auto' && cs.clip !== '' && /absolute|fixed/.test(cs.position)) return true;
            if (/inset\(\s*50%/.test(cs.clipPath)) return true;
            const box = a.getBoundingClientRect();
            if (cs.overflow !== 'visible' && (box.width <= 1 || box.height <= 1)) return true;
          }
          return false;
        };
        const clean = (el: Element | null) => {
          let text = '';
          if (el === null) return text;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const holder = node.parentElement;
            if (holder === null || hidden(holder)) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            if ((node.textContent ?? '').trim() !== '' && range.getClientRects().length === 0) continue;
            text += node.textContent ?? '';
          }
          return text.replace(/\s+/g, ' ').trim();
        };
        /** The nearest pair around `el`; `null` for a pair that is no part of another. */
        const around = (el: Element): Element | null => {
          const outer = els.filter((pair) => pair !== el && pair.contains(el));
          return outer.find((pair) => outer.every((other) => other.contains(pair))) ?? null;
        };
        /** The label or value of `pair` itself, not of a pair inside its value. */
        const below = (pair: Element, selector: string) =>
          [...pair.querySelectorAll(selector)].find((el) => around(el) === pair) ?? null;
        const shown = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
        return els
          .filter((pair) => shown(pair) && around(pair) === null)
          .map((pair) => {
            const value = below(pair, selectors.value);
            const nested = els.filter((other) => shown(other) && around(other) === pair);
            return {
              label: clean(below(pair, selectors.label)),
              value:
                nested.length === 0
                  ? clean(value)
                  : Object.fromEntries(
                      nested.map((other) => [
                        clean(below(other, selectors.label)),
                        clean(below(other, selectors.value)),
                      ]),
                    ),
            };
          });
      },
      { label: PAIR_LABEL, value: PAIR_VALUE },
    );
}

/**
 * Presses `refresh` and waits for the page's answer to the `operation` it starts, then reads `read` once; repeated,
 * each try a new read of the emulator, until what is read equals `want` or `timeout` runs out.
 */
export async function refreshedUntil<T>(
  page: Page,
  refresh: Locator,
  operation: string,
  read: () => Promise<T>,
  want: T,
  what: string,
  timeout = 60_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await answered(page, operation, () => refresh.click(ACTION));
        return read();
      },
      { message: what, timeout },
    )
    .toEqual(want);
}

/** The 1-based row of the open tag editor whose key reads `key`; fails the check when no row holds it. */
export async function tagRow(dialog: Locator, key: string): Promise<number> {
  const count = await dialog.locator(EDITOR_ROWS).count();
  for (let row = 1; row <= count; row++) {
    if ((await dialog.locator(editorInput(row, 1)).inputValue()) === key) return row;
  }
  throw new Error(`the tag editor holds no row with the key ${key}`);
}

/** The parts of the tag editor of `scope` (a dialog) a check acts on. */
export function tagEditor(scope: Locator) {
  return {
    rows: scope.locator(EDITOR_ROWS),
    key: (row: number) => scope.locator(editorInput(row, 1)),
    value: (row: number) => scope.locator(editorInput(row, 2)),
    remove: (row: number) => scope.locator(editorRemove(row)),
    add: scope.getByRole('button', { name: ADD_TAG, exact: true }),
    save: scope.getByRole('button', { name: SAVE, exact: true }),
  };
}

// --- S2 and S4, the alarm form ----------------------------------------------------------------------------------

/** The parts of the alarm form (Create alarm and Edit alarm) a check acts on. */
export function alarmForm(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    /** The form itself, without the navigation and the crumbs around it. */
    form: main.locator('form'),
    name: field(main, 'Name').locator(INPUT),
    nameField: field(main, 'Name'),
    description: field(main, 'Description').locator(TEXTAREA),
    noDataYet: main.locator(TOGGLE),
    namespace: field(main, 'Namespace'),
    metricName: field(main, 'Metric name'),
    dimensions: field(main, 'Dimensions'),
    /**
     * With "Enter a metric that has no data yet" on: the typed namespace and metric name, and the dimensions in the
     * form's one attribute editor.
     */
    namespaceText: field(main, 'Namespace').locator(INPUT),
    metricNameText: field(main, 'Metric name').locator(INPUT),
    addDimension: main.getByRole('button', { name: 'Add dimension', exact: true }),
    dimensionName: (row: number) => main.locator(editorInput(row, 1)),
    dimensionValue: (row: number) => main.locator(editorInput(row, 2)),
    statistic: field(main, 'Statistic'),
    extendedStatistic: field(main, 'Extended statistic').locator(INPUT),
    period: field(main, 'Period'),
    comparison: field(main, 'Comparison'),
    threshold: field(main, 'Threshold').locator(INPUT),
    datapoints: field(main, 'Data points to alarm').locator(INPUT),
    periods: field(main, 'Evaluation periods').locator(INPUT),
    missingData: field(main, 'Missing data treatment'),
    enableActions: main.getByRole('checkbox', { name: 'Enable actions', exact: true }),
    inAlarm: field(main, 'In alarm'),
    create: main.getByRole('button', { name: CREATE_ALARM, exact: true }),
    save: main.getByRole('button', { name: SAVE_CHANGES, exact: true }),
  };
}

/** A metric named by hand, with "Enter a metric that has no data yet" on. */
export interface TypedMetric {
  namespace: string;
  metric: string;
  dimension?: { name: string; value: string };
}

/** Turns on "Enter a metric that has no data yet" and enters `typed`. */
export async function enterMetric(page: Page, typed: TypedMetric): Promise<void> {
  const form = alarmForm(page);
  await form.noDataYet.check(ACTION);
  await form.namespaceText.fill(typed.namespace, ACTION);
  await form.metricNameText.fill(typed.metric, ACTION);
  if (typed.dimension !== undefined) {
    await form.addDimension.click(ACTION);
    await form.dimensionName(1).fill(typed.dimension.name, ACTION);
    await form.dimensionValue(1).fill(typed.dimension.value, ACTION);
  }
}

/** Opens the edit form of the alarm `name` and waits until it shows the alarm's threshold `threshold`. */
export async function openEdit(page: Page, name: string, threshold: string): Promise<void> {
  await open(page, editAlarmPath(name), EDIT_ALARM);
  await expect(alarmForm(page).threshold, `the form holds the alarm's threshold ${threshold}`).toHaveValue(threshold, {
    timeout: 15_000,
  });
}
