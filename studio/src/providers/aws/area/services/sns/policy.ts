// What a queue's or a function's policy says of a topic's delivery (issue 536, requirement "S3 'Subscriptions'",
// design task 1 step 4 and task 2 steps 5 and 6), and the statement Studio adds. No call: the policy text comes from
// `api.ts`. Studio does not evaluate a policy: it recognises the statement shapes the emulator was seen to deliver by
// (probe-2, probe-3), says "Cannot tell" for a policy with a `Deny` or one it cannot read, and "No permission" for any
// other.

/** What a policy reads as for one topic. */
export type PolicyReading =
  /** A statement of a shape seen to deliver, and no `Deny`. */
  | { kind: 'allowed' }
  /** No policy, or none of its statements has such a shape. */
  | { kind: 'none' }
  /** A `Deny` statement, or text Studio cannot read; `reason` says which. */
  | { kind: 'unknown'; reason: string };

/** The reason of a "Cannot tell" for text that is not a policy Studio can read. */
export const UNREADABLE_REASON = 'Studio cannot read it';

/** The reason of a "Cannot tell" for a policy with a `Deny` statement. */
export const DENY_REASON = 'it has a Deny statement, which Studio does not evaluate';

/** Whose policy is read, and for which topic. */
export interface PolicyTarget {
  /** A queue's policy (SQS) or a function's resource policy (Lambda). */
  kind: 'queue' | 'function';
  /** The queue's or the function's ARN, the statement's `Resource`. */
  resource: string;
  /** The topic that is to deliver. */
  topicArn: string;
}

type Json = Record<string, unknown>;

const SNS_SERVICE = 'sns.amazonaws.com';

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value that may be one item or a list, as a list. */
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** The policy's object, or `undefined` for text that is not a JSON object. */
function parsed(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The policy's statements, one statement read as a list of one; `undefined` when it has none Studio can read. */
function statementsOf(policy: Json): Json[] | undefined {
  const statement = policy['Statement'];
  if (statement === undefined) {
    return undefined;
  }
  const statements = list(statement);
  return statements.every(isObject) ? statements : undefined;
}

/** `pattern` with `*` (any run) and `?` (one character) matches `value` whole. */
function matchesPattern(pattern: string, value: string): boolean {
  const source = pattern
    .split('')
    .map((character) => {
      if (character === '*') {
        return '.*';
      }
      if (character === '?') {
        return '.';
      }
      return character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`).test(value);
}

function hasResource(statement: Json, resource: string): boolean {
  return list(statement['Resource']).some((value) => value === resource);
}

function hasPrincipal(statement: Json, kind: PolicyTarget['kind']): boolean {
  const principal = statement['Principal'];
  if (kind === 'queue' && principal === '*') {
    return true;
  }
  if (!isObject(principal)) {
    return false;
  }
  if (list(principal['Service']).some((value) => value === SNS_SERVICE)) {
    return true;
  }
  return kind === 'queue' && list(principal['AWS']).some((value) => value === '*');
}

function hasAction(statement: Json, kind: PolicyTarget['kind']): boolean {
  const allowed = kind === 'queue' ? ['sqs:sendmessage', 'sqs:*'] : ['lambda:invokefunction'];
  return list(statement['Action']).some((value) => typeof value === 'string' && allowed.includes(value.toLowerCase()));
}

/** No condition, or one `ArnEquals` or `ArnLike` on `aws:SourceArn` (any letter case) that names or matches the topic. */
function hasCondition(statement: Json, topicArn: string): boolean {
  const condition = statement['Condition'];
  if (condition === undefined) {
    return true;
  }
  if (!isObject(condition)) {
    return false;
  }
  const operators = Object.entries(condition);
  if (operators.length === 0) {
    return true;
  }
  if (operators.length !== 1) {
    return false;
  }
  const [operator, keys] = operators[0] as [string, unknown];
  if ((operator !== 'ArnEquals' && operator !== 'ArnLike') || !isObject(keys)) {
    return false;
  }
  const entries = Object.entries(keys);
  if (entries.length !== 1) {
    return false;
  }
  const [key, value] = entries[0] as [string, unknown];
  if (key.toLowerCase() !== 'aws:sourcearn') {
    return false;
  }
  return list(value).some((pattern) => typeof pattern === 'string' && matchesPattern(pattern, topicArn));
}

function allows(statement: Json, target: PolicyTarget): boolean {
  return (
    statement['Effect'] === 'Allow' &&
    hasResource(statement, target.resource) &&
    hasPrincipal(statement, target.kind) &&
    hasAction(statement, target.kind) &&
    hasCondition(statement, target.topicArn)
  );
}

/** What the policy text `text` (absent or empty for no policy) says of `target`'s delivery. */
export function readPolicy(text: string | undefined, target: PolicyTarget): PolicyReading {
  if (text === undefined || text === '') {
    return { kind: 'none' };
  }
  const policy = parsed(text);
  const statements = policy === undefined ? undefined : statementsOf(policy);
  if (statements === undefined) {
    return { kind: 'unknown', reason: UNREADABLE_REASON };
  }
  if (statements.some((statement) => statement['Effect'] === 'Deny')) {
    return { kind: 'unknown', reason: DENY_REASON };
  }
  return statements.some((statement) => allows(statement, target)) ? { kind: 'allowed' } : { kind: 'none' };
}

/** The `Sid`s the policy text's statements hold; none for no policy or text Studio cannot read. */
export function policySids(text: string | undefined): string[] {
  if (text === undefined || text === '') {
    return [];
  }
  const policy = parsed(text);
  const statements = policy === undefined ? undefined : statementsOf(policy);
  return (statements ?? []).flatMap((statement) => {
    const sid = statement['Sid'];
    return typeof sid === 'string' ? [sid] : [];
  });
}

/** `EmuForgeSns` and the topic's name with every character but letters and digits left out, numbered from 2 while taken. */
export function queueStatementSid(topic: string, taken: readonly string[]): string {
  const base = `EmuForgeSns${topic.replace(/[^A-Za-z0-9]/g, '')}`;
  if (!taken.includes(base)) {
    return base;
  }
  for (let number = 2; ; number += 1) {
    const sid = `${base}${String(number)}`;
    if (!taken.includes(sid)) {
      return sid;
    }
  }
}

/** The longest statement id Lambda's `AddPermission` takes. */
export const MAX_STATEMENT_ID = 100;

/**
 * `emuforge-sns-` and the topic's name with every character but letters, digits, `-` and `_` replaced by `-`, cut to
 * 100 characters; while the function's policy has that `Sid`, the same cut so that it is 100 characters at most with
 * `-` and a number from 2 up.
 */
export function permissionStatementId(topic: string, taken: readonly string[]): string {
  const base = `emuforge-sns-${topic.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const first = base.slice(0, MAX_STATEMENT_ID);
  if (!taken.includes(first)) {
    return first;
  }
  for (let number = 2; ; number += 1) {
    const suffix = `-${String(number)}`;
    const id = `${base.slice(0, MAX_STATEMENT_ID - suffix.length)}${suffix}`;
    if (!taken.includes(id)) {
      return id;
    }
  }
}

/** What the queue's statement names. */
export interface QueueStatementTarget {
  queueArn: string;
  topicArn: string;
  /** The topic's name, from which the `Sid` is derived. */
  topicName: string;
}

/**
 * The queue policy `text` (absent or empty for none) with the statement that lets the topic send: `Allow`, the SNS
 * service, `sqs:SendMessage`, the queue's ARN and `ArnEquals` `aws:SourceArn` the topic, with a `Sid` no statement
 * holds. Every other member and statement is kept as it was read, the new statement last; a single statement becomes
 * a list of two; no policy becomes one of version `2012-10-17`. Only for a policy `readPolicy` can read.
 */
export function queuePolicyWithStatement(text: string | undefined, target: QueueStatementTarget): string {
  const policy = text === undefined || text === '' ? undefined : parsed(text);
  const statement = {
    Sid: queueStatementSid(target.topicName, policySids(text)),
    Effect: 'Allow',
    Principal: { Service: SNS_SERVICE },
    Action: 'sqs:SendMessage',
    Resource: target.queueArn,
    Condition: { ArnEquals: { 'aws:SourceArn': target.topicArn } },
  };
  if (policy === undefined) {
    return JSON.stringify({ Version: '2012-10-17', Statement: [statement] });
  }
  const existing = policy['Statement'] === undefined ? [] : list(policy['Statement']);
  return JSON.stringify({ ...policy, Statement: [...existing, statement] });
}
