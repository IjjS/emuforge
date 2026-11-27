// The emulator side and the words of EventBridge's screens (test-criteria.md, issue 75), for the `events-*.spec.ts`
// checks.
//
// - Direct calls: EventBridge's own sender here, over `directJson` of `support/aws-clients-general.ts`, and that
//   file's `directSqs`, `directSns` and `directLogs` for what a rule points at (straight to the emulator,
//   SigV4-signed with the key it wrote for this run, TLS verified against its `ca.pem`).
//   A refusal is read from its JSON `__type` and `message`; "the emulator's reason" a line asks for is the `message`
//   of a direct call that is refused the same way, compared with what the screen shows.
// - `EventsSeeded`: what a check makes, every name under the check's prefix `<p>`. When the check ends it removes
//   every event bus of the emulator whose name starts with `<p>` with its rules and their targets, every rule of
//   `default` whose name starts with `<p>`, and the queues, topics and log groups the check made, those Studio's
//   actions made included.
// - The screens' words (requirement.md, section 4) and readers of what a screen shows.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import {
  createdTopicArn,
  directJson,
  directLogs,
  directSns,
  directSqs,
  type DirectAnswer,
} from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { creationDateText } from '../../support/service-screens';
import { waitFor } from '../../support/wait';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** A direct answer, parsed: its status, its JSON body (`{}` when empty), and for a refusal its type and message. */
export interface Answer {
  status: number;
  json: Record<string, unknown>;
  type: string | null;
  message: string | null;
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
  const text = json.message ?? json.Message;
  return { status: answer.status, json, type, message: typeof text === 'string' ? text : null };
}

/** An EventBridge action (AWS JSON 1.1) with its JSON input, straight to the emulator. */
function directEvents(ctx: Ctx, port: number, action: string, input: object): Promise<DirectAnswer> {
  return directJson(ctx, port, 'events', '1.1', `AWSEvents.${action}`, input);
}

type Direct = (ctx: Ctx, port: number, action: string, input: object) => Promise<DirectAnswer>;

/** A sender of one service's JSON operations: sends, parses and logs the status. */
function sender(service: string, direct: Direct) {
  return async (ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> => {
    const answer = parsed(await direct(ctx, port, operation, input), `direct ${service} ${operation}`);
    ctx.log(`direct ${service} ${operation}: status ${String(answer.status)}${answer.type ? ` ${answer.type}` : ''}`);
    return answer;
  };
}

/** Fails the check unless `answer` is a 200. */
function ok(answer: Answer, what: string): Answer {
  if (answer.status !== 200) throw new Error(`direct ${what} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  return answer;
}

/** Sends the EventBridge `operation` with `input` straight to the emulator and logs its status. */
export const events = sender('events', directEvents);
const sqs = sender('sqs', directSqs);
const logs = sender('logs', directLogs);

/** Sends the EventBridge `operation` and fails the check unless the emulator answered 200. */
export async function eventsOk(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  return ok(await events(ctx, port, operation, input), operation);
}

/** A refusal of the emulator's: its code (the last part of `__type`) and its message. */
export interface Refusal {
  code: string;
  message: string;
}

/**
 * The emulator's reason for refusing the EventBridge `operation` with `input`, directly: the code and the `message`
 * of its refusal. Fails the check when the emulator does not refuse it with both.
 */
export async function refusalDirect(ctx: Ctx, port: number, operation: string, input: object): Promise<Refusal> {
  const answer = await events(ctx, port, operation, input);
  if (answer.status === 200 || !answer.type || !answer.message) {
    throw new Error(`direct ${operation} was not refused with a reason: ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  }
  return { code: answer.type, message: answer.message };
}

/** What a failed write shows for `refusal`: its heading and, below it, the emulator's code and message. */
export function writeRefused(operation: string, refusal: Refusal): { header: string; content: string } {
  return { header: `${operation} failed`, content: `${refusal.code}: ${refusal.message}` };
}

/** An event bus as `ListEventBuses` and `DescribeEventBus` report it; the times are seconds since the epoch. */
export interface DirectBus {
  Name: string;
  Arn: string;
  Description?: string;
  CreationTime?: number;
  LastModifiedTime?: number;
  DeadLetterConfig?: { Arn?: string };
}

/** Every event bus whose name starts with `prefix`, directly, every page. */
export async function busesDirect(ctx: Ctx, port: number, prefix: string): Promise<DirectBus[]> {
  const buses: DirectBus[] = [];
  let token: string | undefined;
  do {
    const answer = await eventsOk(ctx, port, 'ListEventBuses', {
      NamePrefix: prefix,
      Limit: 100,
      ...(token === undefined ? {} : { NextToken: token }),
    });
    buses.push(...((answer.json.EventBuses ?? []) as DirectBus[]));
    token = answer.json.NextToken as string | undefined;
  } while (token !== undefined);
  return buses;
}

/** The event buses named exactly `name`, directly: none, or one. */
export async function busesNamedDirect(ctx: Ctx, port: number, name: string): Promise<DirectBus[]> {
  return (await busesDirect(ctx, port, name)).filter((bus) => bus.Name === name);
}

/** The event bus `name` as `DescribeEventBus` reports it; fails the check when the emulator holds none. */
export async function busDirect(ctx: Ctx, port: number, name: string): Promise<DirectBus> {
  return (await eventsOk(ctx, port, 'DescribeEventBus', { Name: name })).json as unknown as DirectBus;
}

/** The tags of the resource `arn`, directly. */
export async function tagsDirect(ctx: Ctx, port: number, arn: string): Promise<Record<string, string>> {
  const answer = await eventsOk(ctx, port, 'ListTagsForResource', { ResourceARN: arn });
  return Object.fromEntries(((answer.json.Tags ?? []) as { Key: string; Value: string }[]).map((t) => [t.Key, t.Value]));
}

/** A rule as `ListRules` and `DescribeRule` report it. */
export interface DirectRule {
  Name: string;
  Arn?: string;
  State?: string;
  Description?: string;
  EventPattern?: string;
  ScheduleExpression?: string;
  EventBusName?: string;
}

/** Every rule of `bus` whose name starts with `prefix`, directly, every page. */
export async function rulesDirect(ctx: Ctx, port: number, bus: string, prefix = ''): Promise<DirectRule[]> {
  const rules: DirectRule[] = [];
  let token: string | undefined;
  do {
    const answer = await eventsOk(ctx, port, 'ListRules', {
      EventBusName: bus,
      Limit: 100,
      ...(prefix === '' ? {} : { NamePrefix: prefix }),
      ...(token === undefined ? {} : { NextToken: token }),
    });
    rules.push(...((answer.json.Rules ?? []) as DirectRule[]));
    token = answer.json.NextToken as string | undefined;
  } while (token !== undefined);
  return rules;
}

/** The rules of `bus` named exactly `name`, directly: none, or one. */
export async function rulesNamedDirect(ctx: Ctx, port: number, bus: string, name: string): Promise<DirectRule[]> {
  return (await rulesDirect(ctx, port, bus, name)).filter((rule) => rule.Name === name);
}

/** The rule `name` of `bus` as `DescribeRule` reports it; fails the check when the emulator holds none. */
export async function ruleDirect(ctx: Ctx, port: number, bus: string, name: string): Promise<DirectRule> {
  return (await eventsOk(ctx, port, 'DescribeRule', { Name: name, EventBusName: bus })).json as unknown as DirectRule;
}

/** A target as `ListTargetsByRule` reports it and `PutTargets` takes it. */
export interface DirectTarget {
  Id: string;
  Arn: string;
  Input?: string;
  InputPath?: string;
  InputTransformer?: { InputPathsMap?: Record<string, string>; InputTemplate: string };
  SqsParameters?: { MessageGroupId: string };
  DeadLetterConfig?: { Arn: string };
  RetryPolicy?: { MaximumRetryAttempts?: number; MaximumEventAgeInSeconds?: number };
}

/** The targets of the rule `rule` of `bus`, directly, by ID. */
export async function targetsDirect(ctx: Ctx, port: number, bus: string, rule: string): Promise<DirectTarget[]> {
  const targets: DirectTarget[] = [];
  let token: string | undefined;
  do {
    const answer = await eventsOk(ctx, port, 'ListTargetsByRule', {
      Rule: rule,
      EventBusName: bus,
      ...(token === undefined ? {} : { NextToken: token }),
    });
    targets.push(...((answer.json.Targets ?? []) as DirectTarget[]));
    token = answer.json.NextToken as string | undefined;
  } while (token !== undefined);
  return targets.sort((a, b) => (a.Id < b.Id ? -1 : 1));
}

/** Whether the emulator still reports the topic `arn`, directly (`GetTopicAttributes` answers 200). */
export async function topicReported(ctx: Ctx, port: number, arn: string): Promise<boolean> {
  const answer = await directSns(ctx, port, 'GetTopicAttributes', { TopicArn: arn });
  if ('error' in answer) throw new EnvError(`direct sns GetTopicAttributes: ${answer.error}`);
  ctx.log(`direct sns GetTopicAttributes: status ${String(answer.status)}`);
  return answer.status === 200;
}

/** One bounded read of a queue: the bodies it returned and the moment `ReceiveMessage` answered. */
export interface DirectRead {
  bodies: string[];
  /** Taken when `ReceiveMessage` answered, before any message is deleted. */
  answeredAt: number;
}

/**
 * One bounded read of the queue `url`, directly: the bodies it returned and the moment the read answered, each
 * message deleted from the queue after that moment is taken.
 */
export async function receiveDirect(ctx: Ctx, port: number, url: string): Promise<DirectRead> {
  const answer = ok(
    await sqs(ctx, port, 'ReceiveMessage', { QueueUrl: url, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }),
    'ReceiveMessage',
  );
  const answeredAt = Date.now();
  const messages = (answer.json.Messages ?? []) as { Body: string; ReceiptHandle: string }[];
  for (const message of messages) {
    ok(await sqs(ctx, port, 'DeleteMessage', { QueueUrl: url, ReceiptHandle: message.ReceiptHandle }), 'DeleteMessage');
  }
  return { bodies: messages.map((message) => message.Body), answeredAt };
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

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** What a seeded event bus is made with. */
export interface BusSeed {
  description?: string;
  deadLetterArn?: string;
  tags?: Record<string, string>;
}

/** What a seeded rule is made with: a pattern, a schedule, or both. */
export interface RuleSeed {
  pattern?: string;
  schedule?: string;
  disabled?: boolean;
  description?: string;
}

/** A queue the check made: its URL and its ARN as the emulator gives them. */
export interface SeededQueue {
  name: string;
  url: string;
  arn: string;
}

/** The policy that lets EventBridge send to a queue (test-criteria.md: a queue "that lets EventBridge in"). */
const LET_EVENTS_IN = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    { Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: '*' },
  ],
});

/** What a check makes under its prefix; all of it is removed when the check ends. */
export class EventsSeeded {
  private readonly queues: string[] = [];
  private readonly topics: string[] = [];
  private readonly groups: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  /** Whether the removal was already made: it is made once, by the check's own end or else by the teardown. */
  private removed = false;

  /**
   * The removal as the check's own last act (`finish`): what could not be removed fails the check. The shared
   * teardown only logs an error of `dispose`, so a check that ends by itself does not leave it to that.
   */
  async removeAll(): Promise<void> {
    this.removed = true;
    await this.remove();
  }

  /** The teardown's removal, for a check that stopped before its end; nothing is done after `removeAll`. */
  async dispose(): Promise<void> {
    if (this.removed) return;
    this.removed = true;
    await this.remove();
  }

  private under(name: string): void {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
  }

  /** `CreateEventBus name` with `seed`'s description, dead-letter queue and tags; returns the bus as described. */
  async bus(name: string, seed: BusSeed = {}): Promise<DirectBus> {
    this.under(name);
    await eventsOk(this.ctx, this.port, 'CreateEventBus', {
      Name: name,
      ...(seed.description === undefined ? {} : { Description: seed.description }),
      ...(seed.deadLetterArn === undefined ? {} : { DeadLetterConfig: { Arn: seed.deadLetterArn } }),
      ...(seed.tags === undefined
        ? {}
        : { Tags: Object.entries(seed.tags).map(([Key, Value]) => ({ Key, Value })) }),
    });
    return busDirect(this.ctx, this.port, name);
  }

  /**
   * `PutRule name` on `bus` with `seed`; returns its name. A rule on `default` carries the check's prefix; a rule on
   * a bus of the check is removed with its bus.
   */
  async rule(bus: string, name: string, seed: RuleSeed): Promise<string> {
    if (bus === 'default') this.under(name);
    else this.under(bus);
    await eventsOk(this.ctx, this.port, 'PutRule', {
      Name: name,
      EventBusName: bus,
      State: seed.disabled === true ? 'DISABLED' : 'ENABLED',
      ...(seed.pattern === undefined ? {} : { EventPattern: seed.pattern }),
      ...(seed.schedule === undefined ? {} : { ScheduleExpression: seed.schedule }),
      ...(seed.description === undefined ? {} : { Description: seed.description }),
    });
    return name;
  }

  /** `PutTargets` of `targets` on the rule `rule` of `bus`; fails the check when the emulator refuses an entry. */
  async targets(bus: string, rule: string, targets: DirectTarget[]): Promise<void> {
    const answer = await eventsOk(this.ctx, this.port, 'PutTargets', { Rule: rule, EventBusName: bus, Targets: targets });
    if (answer.json.FailedEntryCount !== 0) {
      throw new Error(`the emulator did not store every seeded target: ${JSON.stringify(answer.json)}`);
    }
  }

  /** `CreateQueue name` (a FIFO queue when the name ends `.fifo`), with the policy that lets EventBridge in when asked. */
  async queue(name: string, seed: { letsEventsIn?: boolean } = {}): Promise<SeededQueue> {
    this.under(name);
    const attributes = {
      ...(name.endsWith('.fifo') ? { FifoQueue: 'true' } : {}),
      ...(seed.letsEventsIn === true ? { Policy: LET_EVENTS_IN } : {}),
    };
    const made = ok(
      await sqs(this.ctx, this.port, 'CreateQueue', {
        QueueName: name,
        ...(Object.keys(attributes).length === 0 ? {} : { Attributes: attributes }),
      }),
      'CreateQueue',
    );
    const url = made.json.QueueUrl as string;
    this.queues.push(url);
    const read = ok(
      await sqs(this.ctx, this.port, 'GetQueueAttributes', { QueueUrl: url, AttributeNames: ['QueueArn'] }),
      'GetQueueAttributes',
    );
    const arn = (read.json.Attributes as Record<string, string> | undefined)?.QueueArn;
    if (arn === undefined) throw new Error(`the emulator gave no ARN for the queue ${name}`);
    return { name, url, arn };
  }

  /** `CreateTopic name`; returns the topic's ARN. */
  async topic(name: string): Promise<string> {
    this.under(name);
    const answer = await directSns(this.ctx, this.port, 'CreateTopic', { Name: name });
    if ('error' in answer) throw new EnvError(`direct sns CreateTopic: ${answer.error}`);
    const arn = answer.status === 200 ? createdTopicArn(answer.body) : '';
    if (arn === '') throw new Error(`direct sns CreateTopic ${name} answered ${String(answer.status)} ${answer.body}`);
    this.topics.push(arn);
    return arn;
  }

  /**
   * `CreateLogGroup name`, the check's prefix somewhere in the name; returns the ARN the emulator reports as
   * `logGroupArn` (the form without `:*`).
   */
  async logGroup(name: string): Promise<string> {
    if (!name.includes(this.prefix)) throw new Error(`${name} does not hold the check's prefix ${this.prefix}`);
    ok(await logs(this.ctx, this.port, 'CreateLogGroup', { logGroupName: name }), 'CreateLogGroup');
    this.groups.push(name);
    const read = ok(await logs(this.ctx, this.port, 'DescribeLogGroups', { logGroupNamePrefix: name }), 'DescribeLogGroups');
    const group = ((read.json.logGroups ?? []) as { logGroupName: string; logGroupArn?: string }[]).find(
      (each) => each.logGroupName === name,
    );
    if (group?.logGroupArn === undefined) throw new Error(`the emulator gave no logGroupArn for ${name}`);
    return group.logGroupArn;
  }

  /** Removes the rule `name` of `bus` with its targets, directly; what the emulator refused is returned. */
  private async removeRule(bus: string, name: string): Promise<string | null> {
    try {
      const ids = (await targetsDirect(this.ctx, this.port, bus, name)).map((target) => target.Id);
      if (ids.length > 0) {
        const removed = await events(this.ctx, this.port, 'RemoveTargets', { Rule: name, EventBusName: bus, Ids: ids });
        if (removed.status !== 200) return `RemoveTargets answered ${String(removed.status)} ${JSON.stringify(removed.json)}`;
      }
      const deleted = await events(this.ctx, this.port, 'DeleteRule', { Name: name, EventBusName: bus });
      return deleted.status === 200 ? null : `DeleteRule answered ${String(deleted.status)} ${JSON.stringify(deleted.json)}`;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Removes the event bus `name` with its rules and their targets, directly (a check that removes one outside). */
  async removeBus(name: string): Promise<void> {
    this.under(name);
    for (const rule of await rulesDirect(this.ctx, this.port, name)) {
      const refused = await this.removeRule(name, rule.Name);
      if (refused !== null) throw new Error(`the rule ${rule.Name} of ${name} could not be removed: ${refused}`);
    }
    await eventsOk(this.ctx, this.port, 'DeleteEventBus', { Name: name });
  }

  /**
   * Removes everything of the check: the rules of `default` under the prefix, every bus under the prefix with its
   * rules, then the queues, topics and log groups it made. One thing that could not be removed does not stop the
   * rest; what is still there at the end is an error that names it.
   */
  private async remove(): Promise<void> {
    const refused: string[] = [];
    const attempt = async (what: string, act: () => Promise<Answer | null>): Promise<void> => {
      try {
        const answer = await act();
        if (answer !== null && answer.status !== 200) {
          refused.push(`${what}: ${String(answer.status)} ${JSON.stringify(answer.json)}`);
        }
      } catch (e) {
        refused.push(`${what}: ${(e as Error).message}`);
      }
    };
    const removeRules = async (bus: string, prefix: string): Promise<void> => {
      let rules: DirectRule[] = [];
      await attempt(`ListRules ${bus}`, async () => {
        rules = await rulesDirect(this.ctx, this.port, bus, prefix);
        return null;
      });
      for (const rule of rules) {
        const said = await this.removeRule(bus, rule.Name);
        if (said !== null) refused.push(`rule ${rule.Name} of ${bus}: ${said}`);
      }
    };
    await removeRules('default', this.prefix);
    let buses: DirectBus[] = [];
    await attempt('ListEventBuses', async () => {
      buses = await busesDirect(this.ctx, this.port, this.prefix);
      return null;
    });
    for (const bus of buses) {
      await removeRules(bus.Name, '');
      await attempt(`DeleteEventBus ${bus.Name}`, () => events(this.ctx, this.port, 'DeleteEventBus', { Name: bus.Name }));
    }
    for (const url of this.queues) {
      await attempt(`DeleteQueue ${url}`, () => sqs(this.ctx, this.port, 'DeleteQueue', { QueueUrl: url }));
    }
    for (const arn of this.topics) {
      await attempt(`DeleteTopic ${arn}`, async () => {
        const answer = await directSns(this.ctx, this.port, 'DeleteTopic', { TopicArn: arn });
        return 'error' in answer
          ? { status: 0, json: { error: answer.error }, type: null, message: null }
          : { status: answer.status, json: { body: answer.body }, type: null, message: null };
      });
    }
    for (const name of this.groups) {
      await attempt(`DeleteLogGroup ${name}`, () => logs(this.ctx, this.port, 'DeleteLogGroup', { logGroupName: name }));
    }
    const left = [
      ...(await busesDirect(this.ctx, this.port, this.prefix)).map((bus) => `event bus ${bus.Name}`),
      ...(await rulesDirect(this.ctx, this.port, 'default', this.prefix)).map((rule) => `rule ${rule.Name} of default`),
    ];
    if (left.length > 0 || refused.length > 0) {
      throw new Error(
        `what the check made under ${this.prefix} could not all be removed: still there: ${left.join(', ') || 'nothing of EventBridge'}; refused: ${refused.join('; ') || 'nothing'}`,
      );
    }
  }
}

/**
 * The end of a check: removes what it made, then fails the check when a criteria line failed or when something
 * could not be removed (both are named when both happened). The removal is attempted whatever the lines did.
 */
export async function finish(lines: { end(): void }, seeded: EventsSeeded): Promise<void> {
  let cleanup: Error | undefined;
  try {
    await seeded.removeAll();
  } catch (e) {
    cleanup = e as Error;
  }
  try {
    lines.end();
  } catch (e) {
    if (cleanup === undefined) throw e;
    throw new Error(`${(e as Error).message}\n${cleanup.message}`);
  }
  if (cleanup !== undefined) throw cleanup;
}

// ---------------------------------------------------------------------------------------------------------------
// Paths and words.
// ---------------------------------------------------------------------------------------------------------------

export const EVENT_BUSES_PATH = '/aws/events/event-buses';
export const CREATE_EVENT_BUS_PATH = `${EVENT_BUSES_PATH}/create`;
export const RULES_PATH = '/aws/events/rules';
export const CREATE_RULE_PATH = `${RULES_PATH}/create`;
export const SEND_EVENTS_PATH = '/aws/events/send-events';

/** A name as one segment of an address (requirement, section 3): percent-encoded, `.` and `..` behind a `*`. */
function segment(name: string): string {
  return name === '.' || name === '..' ? `*${name}` : encodeURIComponent(name);
}
/** S3's path for the event bus `bus`. */
export function busPath(bus: string): string {
  return `${EVENT_BUSES_PATH}/bus/${segment(bus)}`;
}
/** S6's path for the rule `rule` of `bus`. */
export function rulePath(bus: string, rule: string): string {
  return `${RULES_PATH}/rule/${segment(bus)}/${segment(rule)}`;
}
/** S4's, S5's and S7's address with `bus` as its `?bus=`, written as the screens write it. */
export function withBus(path: string, bus: string): string {
  return `${path}?${new URLSearchParams({ bus }).toString()}`;
}

export const NAVIGATION_HEADER = 'EventBridge';
export const EVENT_BUSES = 'Event buses';
export const RULES = 'Rules';
export const CREATE_EVENT_BUS = 'Create event bus';
export const CREATE_RULE = 'Create rule';
export const SEND_EVENTS = 'Send events';
export const SEND = 'Send';
export const DELETE = 'Delete';
export const DELETE_RULE = 'Delete rule';
export const SAVE = 'Save';
export const CANCEL = 'Cancel';
export const REMOVE = 'Remove';
export const ENABLE = 'Enable';
export const DISABLE = 'Disable';
export const ADD_TARGET = 'Add target';
export const ADD_TAG = 'Add tag';
export const EDIT_DESCRIPTION = 'Edit description';
export const MANAGE_TAGS = 'Manage tags';
export const NO_BUSES_MATCH = 'No event buses match';
export const NO_RULES = 'No rules';
export const NO_RULES_MATCH = 'No rules match';
export const BUS_NOT_FOUND = 'Event bus not found';
export const RULE_NOT_FOUND = 'Rule not found';
export const DEFAULT_BUS_CANNOT_BE_DELETED = 'The default event bus cannot be deleted.';
export const AT_MOST_FIVE_TARGETS = 'A rule holds at most 5 targets.';
export const TARGET_ID_HELD = 'The rule already holds a target with this ID.';
export const ADDRESS_NAMES_NO_BUS = 'The address names no event bus. Choose an event bus.';
export const EVENT_PATTERN = 'Event pattern';

export function busCreated(name: string): string {
  return `Event bus ${name} created.`;
}
export function busDeleted(name: string): string {
  return `Event bus ${name} deleted.`;
}
export function descriptionSaved(name: string): string {
  return `Description of ${name} saved.`;
}
export function tagsSaved(name: string): string {
  return `Tags of ${name} saved.`;
}
export function ruleCreated(name: string): string {
  return `Rule ${name} created.`;
}
export function ruleDeleted(name: string): string {
  return `Rule ${name} deleted.`;
}
export function ruleSwitched(name: string, to: 'enabled' | 'disabled'): string {
  return `Rule ${name} ${to}.`;
}
export function targetAdded(id: string, rule: string): string {
  return `Target ${id} added to ${rule}.`;
}
export function targetRemoved(id: string, rule: string): string {
  return `Target ${id} removed from ${rule}.`;
}
/** What the bus field says of a bus the emulator does not hold. */
export function busNotInEmulator(name: string): string {
  return `Event bus ${name} is not in your local emulator. Choose an event bus.`;
}
/** What the name's field says of a rule name the bus holds. */
export function ruleNameTaken(name: string, bus: string): string {
  return `A rule named ${name} already exists on ${bus}. Creating it again would replace it.`;
}
/** What the delete dialog says is removed with a rule of `count` targets (two or more): its whole sentence. */
export function ruleAndTargetsRemoved(count: number): string {
  return `The rule and its ${String(count)} targets are removed from your local emulator. This cannot be undone.`;
}
/** What Send events says of the accepted event `id`: the whole receipt. */
export function eventAccepted(bus: string, id: string): string {
  return `The emulator accepted the event for ${bus}. Event ID ${id}.`;
}
/** The heading of what Send events says when nothing was sent, and what stands below it. */
export const EVENT_NOT_SENT = 'The event was not sent.';
export const CHECK_THE_FORM = 'Check the form for details.';
export const CHECK_THE_BUS_FIELD = 'Check the event bus field.';
/** The accessible name of the control that removes the target `id` from its rule. */
export function removeTarget(id: string): string {
  return `Remove target ${id}`;
}

/** The state a screen shows for the `State` of a direct answer. */
export function stateText(state: string | undefined): string {
  return { ENABLED: 'Enabled', DISABLED: 'Disabled' }[state ?? ''] ?? '-';
}
/**
 * The date a screen shows for the time `seconds` of a direct answer, in the zone of the machine the check and its
 * browser run on: "October 30, 2026, 23:18:34 (UTC+09:00)"; "-" without a time.
 */
export function dateText(seconds: number | undefined): string {
  if (seconds === undefined) return '-';
  const ms = Math.floor(seconds * 1000);
  const offsetMinutes = -new Date(ms).getTimezoneOffset();
  const two = (n: number) => String(Math.trunc(n)).padStart(2, '0');
  const size = Math.abs(offsetMinutes);
  const label = `UTC${offsetMinutes < 0 ? '-' : '+'}${two(size / 60)}:${two(size % 60)}`;
  return creationDateText(new Date(ms).toISOString(), { offsetMinutes, label });
}

/** A group of the service's entries as the requirement's table has it (section 3, "The service's entries"). */
export interface EntryGroup {
  name: string;
  /** The sub-service's own link in its group; the first group is the service's own and has none. */
  subService?: { name: string; path: string };
  entries: { label: string; path: string; screen: boolean }[];
}

export const ENTRY_GROUPS: EntryGroup[] = [
  {
    name: 'EventBridge',
    entries: [
      { label: 'Event buses', path: '/aws/events/event-buses', screen: true },
      { label: 'Rules', path: '/aws/events/rules', screen: true },
      { label: 'API destinations', path: '/aws/events/api-destinations', screen: false },
      { label: 'Archives', path: '/aws/events/archives', screen: false },
      { label: 'Connections', path: '/aws/events/connections', screen: false },
      { label: 'Endpoints', path: '/aws/events/endpoints', screen: false },
      { label: 'Replays', path: '/aws/events/replays', screen: false },
      { label: 'Targets', path: '/aws/events/targets', screen: false },
    ],
  },
  {
    name: 'EventBridge Scheduler',
    subService: { name: 'EventBridge Scheduler', path: '/aws/events/eventbridge-scheduler' },
    entries: [
      { label: 'Schedule groups', path: '/aws/events/schedule-groups', screen: false },
      { label: 'Schedules', path: '/aws/events/schedules', screen: false },
    ],
  },
  {
    name: 'EventBridge Pipes',
    subService: { name: 'EventBridge Pipes', path: '/aws/events/eventbridge-pipes' },
    entries: [{ label: 'Pipes', path: '/aws/events/pipes', screen: false }],
  },
  {
    name: 'EventBridge Schemas',
    subService: { name: 'EventBridge Schemas', path: '/aws/events/eventbridge-schemas' },
    entries: [
      { label: 'Discoverers', path: '/aws/events/discoverers', screen: false },
      { label: 'Registries', path: '/aws/events/registries', screen: false },
      { label: 'Schemas', path: '/aws/events/schemas', screen: false },
    ],
  },
];
/** The entry "Targets" and the place its page says they are shown in (the requirement's table, `shownIn`). */
export const TARGETS_ENTRY = { label: 'Targets', path: '/aws/events/targets', shownPlace: "a rule's page" };

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
const HEADING_TEXT = rel(wrapper.findHeader().findHeadingText());
const TEXT_FILTER = rel(wrapper.findTextFilter().findInput().findNativeInput());
const NEXT_PAGE = rel(wrapper.findPagination().findNextPageButton());
const PREVIOUS_PAGE = rel(wrapper.findPagination().findPreviousPageButton());
const ALERT = rel(wrapper.findAlert());
const CONTAINER = rel(wrapper.findContainer());
const FORM_FIELD = rel(wrapper.findFormField());
const FORM_FIELD_LABEL = inside(wrapper.findFormField().findLabel());
const FORM_FIELD_ERROR = inside(wrapper.findFormField().findError());
const SELECT = rel(wrapper.findSelect());
const SELECT_TRIGGER = inside(wrapper.findSelect().findTrigger());
const SELECT_OPEN = inside(wrapper.findSelect().findDropdown().findOpenDropdown());
const SELECT_OPTIONS = inside(wrapper.findSelect().findDropdown().findOptions());
const SELECT_FILTER = inside(wrapper.findSelect().findFilteringInput().findNativeInput());
const EDITOR_ROWS = rel(wrapper.findAttributeEditor().findRows());
/** The part of `whole` below `root`, for a locator that is `root`'s element. */
function below(root: { toSelector(): string }, whole: { toSelector(): string }): string {
  return whole.toSelector().slice(root.toSelector().length).trim();
}
const FIRST_FLASH = wrapper.findFlashbar().findItems().get(1);
/** A flash item's heading and content, below the item. */
const FLASH_HEADER = below(FIRST_FLASH, FIRST_FLASH.findHeader());
const FLASH_CONTENT = below(FIRST_FLASH, FIRST_FLASH.findContent());
/** An alert's heading and content, below the alert. */
const ALERT_HEADER = below(wrapper.findAlert(), wrapper.findAlert().findHeader());
const ALERT_CONTENT = below(wrapper.findAlert(), wrapper.findAlert().findContent());
const MODAL_CONTENT = below(wrapper.findModal(), wrapper.findModal().findContent());
const FIRST_PAIR = wrapper.findKeyValuePairs().findItems().get(1);
const PAIRS = rel(wrapper.findKeyValuePairs().findItems());
const PAIR_LABEL = below(FIRST_PAIR, FIRST_PAIR.findLabel());
const PAIR_VALUE = below(FIRST_PAIR, FIRST_PAIR.findValue());
/** The native input of the choice whose value is `value`, in a radio group. */
function radioByValue(value: string): string {
  return rel(wrapper.findRadioGroup().findInputByValue(value));
}
/** A text as a screen draws it: every run of white space one space, none at its ends. */
const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
/** An option of a select by its value. */
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}
/** The native input of field `column` (1 the first) of row `row` (1 the first) of an attribute editor. */
function editorInput(row: number, column: number): string {
  return rel(wrapper.findAttributeEditor().findRow(row).findField(column).findControl().findInput().findNativeInput());
}
/** The remove button of row `row` (1 the first) of an attribute editor. */
function editorRemove(row: number): string {
  return rel(wrapper.findAttributeEditor().findRow(row).findRemoveButton());
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens `path` and waits for its `h1` `name`. */
export async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(heading(page, h1), `the h1 "${h1}" at ${path}`).toBeVisible({ timeout: 15_000 });
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
 * selection column has no heading and is left out). Headings, rows and cells are found with Cloudscape's selectors:
 * the cell under the heading `c` of the row `r` is `findBodyCell(r, c)`. No row is left out: a cell that is not there
 * under a named heading leaves its row without that heading, which no expectation of a text equals. A table that is
 * loading, empty or failed has no data row.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  const headers = (await table.locator(TABLE_HEADERS).allTextContents()).map(norm);
  const count = await rowsIn(table).count();
  return Promise.all(
    Array.from({ length: count }, async (_, r) => {
      const row: Record<string, string> = {};
      await Promise.all(
        headers.map(async (header, c) => {
          if (header === '') return;
          const [text] = await table.locator(bodyCell(r + 1, c + 1)).allTextContents();
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
  await expect(table.locator(TABLE_EMPTY), `the table's empty state "${text}"`).toHaveText(text, { timeout: 15_000 });
  expect(await rowsOf(table), 'the rows beside the empty state').toEqual([]);
}

/** The table of the page's content whose header's heading reads `title` ("Rules", "Targets", "Tags"). */
export function tableTitled(page: Page, title: string): Locator {
  return page
    .getByRole('main')
    .locator(TABLE)
    .filter({ has: page.locator(HEADING_TEXT).filter({ hasText: new RegExp(`^${escaped(title)}$`) }) });
}

/** The flash items of type `type`, as one locator. */
export function flashItems(page: Page, type: 'success' | 'error' | 'info' | 'warning'): Locator {
  return page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
}

/** What a flash item shows: its heading (`null` without one) and its content, each whole. */
export interface ShownFlash {
  header: string | null;
  content: string;
}

/** The flash items of `type` as shown: the heading and the content of each, found with Cloudscape's selectors. */
export async function shownFlashes(page: Page, type: 'success' | 'error' | 'info' | 'warning'): Promise<ShownFlash[]> {
  const items = flashItems(page, type);
  const count = await items.count();
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const item = items.nth(i);
      const [header] = await item.locator(FLASH_HEADER).allTextContents();
      const [content] = await item.locator(FLASH_CONTENT).allTextContents();
      // A flash without a heading may still hold the heading's element, empty.
      const heading = norm(header ?? '');
      return { header: heading === '' ? null : heading, content: norm(content ?? '') };
    }),
  );
}

/**
 * Waits until the flash items of `type` are one, whose content is `content`, whole, and whose heading is `header`
 * (none when omitted).
 */
export async function expectFlash(
  page: Page,
  type: 'success' | 'error' | 'warning',
  content: string,
  header: string | null = null,
): Promise<void> {
  await expect
    .poll(() => shownFlashes(page, type), { message: `the one ${type} flash "${content}"`, timeout: 15_000 })
    .toEqual([{ header, content: norm(content) }]);
}

/** Whether a request the page sent to the engine is the EventBridge operation `operation`. */
export function isOperation(headers: Record<string, string>, operation: string): boolean {
  return headers['x-amz-target'] === `AWSEvents.${operation}`;
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
 * Runs `act` and waits for the page's answer to the SQS operation `operation`: the read of a queue's ARN a target's
 * queue field makes once a queue is chosen (`GetQueueAttributes`).
 */
export async function answeredBySqs(page: Page, operation: string, act: () => Promise<void>): Promise<void> {
  const answer = page.waitForResponse((r) => r.request().headers()['x-amz-target'] === `AmazonSQS.${operation}`, {
    timeout: 30_000,
  });
  await act();
  await answer;
}

/** The form fields of `scope` labelled exactly `label`, in document order. */
export function fields(scope: Locator, label: string): Locator {
  return scope
    .locator(FORM_FIELD)
    .filter({ has: scope.page().locator(FORM_FIELD_LABEL).filter({ hasText: new RegExp(`^${escaped(label)}$`) }) });
}

/** The form field of `scope` labelled exactly `label`: the innermost when one field holds another. */
export function field(scope: Locator, label: string): Locator {
  return fields(scope, label).last();
}

/** The error text of the form field `of`. */
export function fieldError(of: Locator): Locator {
  return of.locator(FORM_FIELD_ERROR);
}

/**
 * In the one select inside `scope`: opens it, types `find` into its own search when given (a list read from the
 * emulator, narrowed to what the check made), and chooses the option whose value is `value`.
 */
export async function chooseOption(scope: Locator, value: string, find?: string): Promise<void> {
  const select = scope.locator(SELECT).first();
  await select.locator(SELECT_TRIGGER).click(ACTION);
  if (find !== undefined) await select.locator(SELECT_FILTER).fill(find, ACTION);
  const option = select.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(select.locator(SELECT_OPEN), 'the list after the choice').toHaveCount(0);
}

/**
 * In the one select inside `scope`, whose list is read from the emulator a page at a time and takes no search:
 * opens it and chooses the option whose value is `value`, asking for a further page with "Load more" while the
 * option is not among those read. Every page is waited for by what the list then shows (the option, more options,
 * or "Load more" again), within a bound; the emulator's list holds what other checks made too.
 */
export async function chooseListed(scope: Locator, value: string): Promise<void> {
  const select = scope.locator(SELECT).first();
  const option = select.locator(optionByValue(value));
  const options = select.locator(SELECT_OPTIONS);
  const more = select.getByRole('button', { name: 'Load more', exact: true });
  await select.locator(SELECT_TRIGGER).click(ACTION);
  let read = -1;
  for (let pages = 0; pages < 200; pages++) {
    const state = await waitFor(20_000, async () => {
      if ((await option.count()) > 0) return 'found' as const;
      const count = await options.count();
      // A page asked for is read once the list holds more options than before; "Load more" then stands again.
      if (count > read && (await more.isVisible())) return 'more' as const;
      return undefined;
    });
    if (state === 'found') {
      await option.click(ACTION);
      await expect(select.locator(SELECT_OPEN), 'the list after the choice').toHaveCount(0);
      return;
    }
    if (state === undefined) break;
    read = await options.count();
    await more.click(ACTION);
  }
  throw new Error(`the list never offered the option ${value}`);
}

/** The select inside `scope`, for what it shows as chosen. */
export function selectOf(scope: Locator): Locator {
  return scope.locator(SELECT).first().locator(SELECT_TRIGGER);
}

/** The alerts of `scope`. */
export function alerts(scope: Locator): Locator {
  return scope.locator(ALERT);
}

/**
 * Waits until the announced alerts of `scope` are one, whose heading is `shown.header` and whose content is `shown.content`,
 * each whole. A reason of the emulator's may hold a line break, which the alert draws as a space: both sides are
 * read with every run of white space as one space.
 */
export async function expectAlert(scope: Locator, shown: { header: string; content: string }): Promise<void> {
  const read = async () => {
    // The result of a write is announced: its alert stands in an element of the role `alert`. The area's own notice
    // of the local emulator, an alert too, does not.
    const all = alerts(scope.getByRole('alert'));
    const count = await all.count();
    return Promise.all(
      Array.from({ length: count }, async (_, i) => ({
        header: norm((await all.nth(i).locator(ALERT_HEADER).allTextContents()).join(' ')),
        content: norm((await all.nth(i).locator(ALERT_CONTENT).allTextContents()).join(' ')),
      })),
    );
  };
  await expect
    .poll(read, { message: `the one alert "${shown.header}": "${shown.content}"`, timeout: 15_000 })
    .toEqual([{ header: norm(shown.header), content: norm(shown.content) }]);
}

/** The content of the open dialog `dialog`, below its heading and above its actions. */
export function dialogContent(dialog: Locator): Locator {
  return dialog.locator(MODAL_CONTENT);
}

/** The key-value pairs inside `scope` (a table's cell) as shown: each label with its value, whole. */
export async function pairsIn(scope: Locator): Promise<Record<string, string>> {
  const pairs = scope.locator(PAIRS);
  const count = await pairs.count();
  const read = await Promise.all(
    Array.from({ length: count }, async (_, i) => [
      norm((await pairs.nth(i).locator(PAIR_LABEL).allTextContents()).join(' ')),
      norm((await pairs.nth(i).locator(PAIR_VALUE).allTextContents()).join(' ')),
    ]),
  );
  return Object.fromEntries(read) as Record<string, string>;
}

/** The choice of the radio group inside the form field `of` whose value is `value`. */
export function radioOf(of: Locator, value: string): Locator {
  return of.locator(radioByValue(value));
}

/** The open dialog: Cloudscape's modal that is shown (one that is closed stays in the page, hidden). */
export function dialogOf(page: Page): Locator {
  return page.locator(MODAL).filter({ visible: true });
}

/** In the open dialog: types `name` into its one text field and chooses `action`. */
export async function confirmWith(page: Page, name: string, action: string): Promise<void> {
  const dialog = dialogOf(page);
  await expect(dialog, 'the dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(name, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

/** The text `text`, whole, inside a container of the page's content (a state in the place of the data). */
export function stateShown(page: Page, text: string): Locator {
  return page.getByRole('main').locator(CONTAINER).getByText(text, { exact: true });
}

/**
 * The text `text`, whole, in the place of a page's data when the page holds a field too: inside a container of the
 * page's content that holds no form field (the field says the same text as its error).
 */
export function stateBesideFields(page: Page, text: string): Locator {
  return page
    .getByRole('main')
    .locator(CONTAINER)
    .filter({ hasNot: page.locator(FORM_FIELD) })
    .getByText(text, { exact: true });
}

/**
 * The reason a button that cannot be pressed gives: the text its `aria-describedby` names; `null` when the button
 * can be pressed or names none.
 */
export async function unavailableReason(button: Locator): Promise<string | null> {
  await expect(button, 'the button is on the page').toHaveCount(1);
  return button.evaluate((el) => {
    const off = el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled;
    if (!off) return null;
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id !== '');
    const text = ids
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text === '' ? null : text;
  });
}

/** Waits until `button` cannot be pressed and gives `reason` for it. */
export async function expectUnavailable(button: Locator, reason: string): Promise<void> {
  await expect.poll(() => unavailableReason(button), { message: `the button says "${reason}"`, timeout: 15_000 }).toBe(reason);
}

// --- The bus field (S4, S5, S7) ---------------------------------------------------------------------------------

/** The field "Event bus" of the page's content. */
export function busField(page: Page): Locator {
  return field(page.getByRole('main'), 'Event bus');
}

/** Chooses the event bus `name` in the bus field, from the emulator's list narrowed to that name. */
export async function chooseBus(page: Page, name: string): Promise<void> {
  await chooseOption(busField(page), name, name);
}

/** Waits until the bus field shows `name` as chosen and says nothing against it. */
export async function expectBusChosen(page: Page, name: string): Promise<void> {
  await expect(selectOf(busField(page)), `the bus field shows ${name}`).toHaveText(name, { timeout: 15_000 });
  await expect(fieldError(busField(page)), 'the bus field has no error').toHaveCount(0);
}

// --- S1, Event buses --------------------------------------------------------------------------------------------

/** The parts of S1 a check acts on. */
export function busList(page: Page) {
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  return {
    main,
    table,
    filter: table.locator(TEXT_FILTER),
    /** The selection control of the row whose Name cell is, whole, `name`: Cloudscape's row selection area. */
    select: async (name: string) => {
      const index = (await rowsOf(table)).findIndex((row) => row.Name === name);
      if (index < 0) throw new Error(`"Event buses" shows no row whose Name is ${name}`);
      await table.locator(inside(wrapper.findTable().findRowSelectionArea(index + 1))).click(ACTION);
    },
    link: (name: string) => rowsIn(table).getByRole('link', { name, exact: true }),
    del: main.getByRole('button', { name: DELETE, exact: true }),
    next: main.locator(NEXT_PAGE),
    previous: main.locator(PREVIOUS_PAGE),
  };
}

/**
 * Types `text` into the event bus list's filter and waits for the page's `ListEventBuses` of that prefix to be
 * answered, so nothing that follows meets the list while it is read again. `text` differs from the filter's text.
 */
export async function filterBuses(page: Page, text: string): Promise<void> {
  const answer = answerTo(page, 'ListEventBuses', (body) => (body.NamePrefix ?? '') === text);
  await busList(page).filter.fill(text, ACTION);
  await answer;
}

/** Waits until the names the event bus list shows are `want`, in that order. */
export async function expectBuses(page: Page, want: string[]): Promise<void> {
  await expectRows(busList(page).table, (r) => r.Name, want, `the event buses listed: ${want.join(', ')}`);
}

// --- S2, Create event bus ---------------------------------------------------------------------------------------

/** The parts of S2 a check acts on. */
export function createBusScreen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    name: main.getByRole('textbox', { name: 'Event bus name', exact: true }),
    description: main.getByRole('textbox', { name: 'Description - optional', exact: true }),
    addTag: main.getByRole('button', { name: ADD_TAG, exact: true }),
    tagKey: (row: number) => main.locator(editorInput(row, 1)),
    tagValue: (row: number) => main.locator(editorInput(row, 2)),
    submit: main.getByRole('button', { name: CREATE_EVENT_BUS, exact: true }),
  };
}

// --- S3, an event bus's page ------------------------------------------------------------------------------------

/** The parts of S3 a check acts on. */
export function busScreen(page: Page) {
  const main = page.getByRole('main');
  const rules = tableTitled(page, RULES);
  return {
    main,
    button: (name: string) => main.getByRole('button', { name, exact: true }),
    link: (name: string) => main.getByRole('link', { name, exact: true }),
    tags: tableTitled(page, 'Tags'),
    rules,
    ruleLink: (name: string) => rowsIn(rules).getByRole('link', { name, exact: true }),
  };
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
  };
}

// --- The rules listing (S3's section and S4) --------------------------------------------------------------------

/** What a rules listing shows of a rule. */
export interface ShownRule {
  name: string | undefined;
  state: string | undefined;
  trigger: string | undefined;
  description: string | undefined;
}

/** A row of a rules listing as `ShownRule`. */
export function shownRule(row: Record<string, string>): ShownRule {
  return { name: row.Name, state: row.State, trigger: row.Trigger, description: row.Description };
}

/**
 * Types `prefix` into the filter of the rules table `table` and waits for the page's `ListRules` of that prefix to
 * be answered. `prefix` differs from the filter's text and is not empty.
 */
export async function filterRules(page: Page, table: Locator, prefix: string): Promise<void> {
  const answer = answerTo(page, 'ListRules', (body) => body.NamePrefix === prefix);
  await table.locator(TEXT_FILTER).fill(prefix, ACTION);
  await answer;
}

/** The name filter of the rules table `table`. */
export function ruleFilter(table: Locator): Locator {
  return table.locator(TEXT_FILTER);
}

/** Waits until the rule names the table `table` shows are `want`, in that order. */
export async function expectRules(table: Locator, want: string[]): Promise<void> {
  await expectRows(table, (r) => r.Name, want, `the rules listed: ${want.join(', ') || 'none'}`);
}

// --- S5, Create rule --------------------------------------------------------------------------------------------

/** The parts of S5 a check acts on. A target's fields are those of its row, the first row 1. */
export function createRuleScreen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    name: main.getByRole('textbox', { name: 'Rule name', exact: true }),
    nameField: field(main, 'Rule name'),
    description: main.getByRole('textbox', { name: 'Description - optional', exact: true }),
    /** The choices of "State", "What starts the rule" and "Unit", each by its value in its radio group. */
    state: (value: 'ENABLED' | 'DISABLED') => radioOf(field(main, 'State'), value),
    trigger: (value: 'pattern' | 'schedule') => radioOf(field(main, 'What starts the rule'), value),
    pattern: main.getByRole('textbox', { name: EVENT_PATTERN, exact: true }),
    rate: main.getByRole('textbox', { name: 'Rate', exact: true }),
    unit: (value: 'minute' | 'hour' | 'day') => radioOf(field(main, 'Unit'), value),
    addTarget: main.getByRole('button', { name: ADD_TARGET, exact: true }),
    /** The field labelled `label` of the targets, the `nth` of that label (1 the first) in document order. */
    targetField: (label: string, nth: number) => fields(main, label).nth(nth - 1),
    submit: main.getByRole('button', { name: CREATE_RULE, exact: true }),
  };
}

/** The text field inside the form field `of`. */
export function textOf(of: Locator): Locator {
  return of.getByRole('textbox');
}

// --- S6, a rule's page ------------------------------------------------------------------------------------------

/** The parts of S6 a check acts on. */
export function ruleScreen(page: Page) {
  const main = page.getByRole('main');
  const targets = tableTitled(page, 'Targets');
  return {
    main,
    button: (name: string) => main.getByRole('button', { name, exact: true }),
    link: (name: string) => main.getByRole('link', { name, exact: true }),
    targets,
    remove: (id: string) => rowsIn(targets).getByRole('button', { name: removeTarget(id), exact: true }),
  };
}

/**
 * The cell under the heading `column` of the target `id` on a rule's page: the row is the one whose "ID" cell reads
 * `id`, whole; row, heading and cell are found with Cloudscape's selectors. Fails the check when no row holds it.
 */
export async function targetCell(page: Page, id: string, column: string): Promise<Locator> {
  const table = ruleScreen(page).targets;
  const headers = (await table.locator(TABLE_HEADERS).allTextContents()).map(norm);
  const at = headers.indexOf(column);
  const row = (await rowsOf(table)).findIndex((each) => each.ID === id);
  if (at < 0 || row < 0) throw new Error(`the targets table shows no cell "${column}" for the target ${id}`);
  return table.locator(bodyCell(row + 1, at + 1));
}

/** The targets a rule's page shows, each row as its headings' texts, in the order of their IDs. */
export async function shownTargets(page: Page): Promise<Record<string, string>[]> {
  return (await rowsOf(ruleScreen(page).targets)).sort((a, b) => ((a.ID ?? '') < (b.ID ?? '') ? -1 : 1));
}

/** Waits until the target IDs the rule's page shows are `want` (in the order of the IDs). */
export async function expectTargetIds(page: Page, want: string[]): Promise<void> {
  await expect
    .poll(async () => (await shownTargets(page)).map((row) => row.ID), {
      message: `the targets listed: ${want.join(', ') || 'none'}`,
      timeout: 15_000,
    })
    .toEqual([...want].sort());
}

/** The parts of the "Add target" dialog a check acts on. */
export function addTargetDialog(page: Page) {
  const dialog = dialogOf(page);
  return {
    dialog,
    id: dialog.getByRole('textbox', { name: 'Target ID', exact: true }),
    idField: field(dialog, 'Target ID'),
    kind: field(dialog, 'Target kind'),
    resource: (label: 'Queue' | 'Topic' | 'Log group') => field(dialog, label),
    receives: field(dialog, 'What the target receives'),
    submit: dialog.getByRole('button', { name: ADD_TARGET, exact: true }),
    cancel: dialog.getByRole('button', { name: CANCEL, exact: true }),
  };
}

// --- S7, Send events --------------------------------------------------------------------------------------------

/** The parts of S7 a check acts on. */
export function sendScreen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    source: main.getByRole('textbox', { name: 'Source', exact: true }),
    detailType: main.getByRole('textbox', { name: 'Detail type', exact: true }),
    detail: main.getByRole('textbox', { name: 'Detail', exact: true }),
    send: main.getByRole('button', { name: SEND, exact: true }),
  };
}

/**
 * The event IDs the page's success flash shows for events accepted for `bus`: the ID of each item whose content
 * is, whole, the receipt of that bus with an ID.
 */
export async function shownEventIds(page: Page, bus: string): Promise<string[]> {
  const receipt = new RegExp(`^${escaped(eventAccepted(bus, '\u0000')).replace('\u0000', '(\\S+)')}$`);
  return (await shownFlashes(page, 'success'))
    .map((flash) => (flash.header === null ? (receipt.exec(flash.content)?.[1] ?? '') : ''))
    .filter((id) => id !== '');
}

/** One `PutEvents` of the page: the entries its request held and the event ID the emulator answered it with. */
export interface SentEvent {
  id: string;
  /** The `Entries` of the request this ID answered, as the page sent them. */
  entries: Record<string, unknown>[];
}

/**
 * Runs `act` and returns the page's `PutEvents`: the entries of its request and the event ID the emulator gave in
 * the answer to that same request (the `EventId` of its one entry). Fails the check when the answer holds none.
 */
export async function sentEvent(page: Page, act: () => Promise<void>): Promise<SentEvent> {
  const answer = answerTo(page, 'PutEvents');
  await act();
  const response = await answer;
  const body = (await response.json()) as { Entries?: { EventId?: string }[] };
  const id = body.Entries?.[0]?.EventId;
  if (!id) throw new Error(`the answer to PutEvents holds no event ID: ${JSON.stringify(body)}`);
  const sent = JSON.parse(response.request().postData() ?? '{}') as { Entries?: Record<string, unknown>[] };
  return { id, entries: sent.Entries ?? [] };
}

/**
 * Waits until the page shows one success flash and its content, found with Cloudscape's selector and taken only
 * where it is visible, is, whole, the receipt of `bus` with the event ID `id`. A receipt that is in the page but
 * hidden does not hold this, nor does a visible content of another bus with the same ID.
 */
export async function expectReceiptVisible(page: Page, bus: string, id: string): Promise<void> {
  await expectFlash(page, 'success', eventAccepted(bus, id));
  await expect(
    flashItems(page, 'success').locator(FLASH_CONTENT).locator('visible=true'),
    `the visible receipt of ${bus} with the event ID ${id}, whole`,
  ).toHaveText(norm(eventAccepted(bus, id)), { timeout: 15_000 });
}

/**
 * Starts counting the `PutEvents` the page sends to the engine; the returned function gives the count so far. A
 * listener only: no request is intercepted.
 */
export function countPutEvents(page: Page): () => number {
  let sent = 0;
  page.on('request', (request) => {
    if (isOperation(request.headers(), 'PutEvents')) sent += 1;
  });
  return () => sent;
}
