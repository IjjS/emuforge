import { describe, expect, it } from 'vitest';

import {
  DENY_REASON,
  permissionStatementId,
  policySids,
  queuePolicyWithStatement,
  queueStatementSid,
  readPolicy,
  UNREADABLE_REASON,
  type PolicyTarget,
} from './policy';

const TOPIC = 'arn:aws:sns:us-east-1:000000000000:orders';
const OTHER_TOPIC = 'arn:aws:sns:us-east-1:000000000000:other';
const QUEUE = 'arn:aws:sqs:us-east-1:000000000000:jobs';
const FUNCTION = 'arn:aws:lambda:us-east-1:000000000000:function:printer';

const QUEUE_TARGET: PolicyTarget = { kind: 'queue', resource: QUEUE, topicArn: TOPIC };
const FUNCTION_TARGET: PolicyTarget = { kind: 'function', resource: FUNCTION, topicArn: TOPIC };

/** The statement of the shape the emulator delivers by, with `changes` over it. */
function statement(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Effect: 'Allow',
    Principal: { Service: 'sns.amazonaws.com' },
    Action: 'sqs:SendMessage',
    Resource: QUEUE,
    Condition: { ArnEquals: { 'aws:SourceArn': TOPIC } },
    ...changes,
  };
}

function policy(...statements: Record<string, unknown>[]): string {
  return JSON.stringify({ Version: '2012-10-17', Statement: statements });
}

describe('readPolicy', () => {
  it('no policy text → no permission; text that is not JSON, or JSON without a statement → cannot tell', () => {
    expect(readPolicy(undefined, QUEUE_TARGET)).toEqual({ kind: 'none' });
    expect(readPolicy('', QUEUE_TARGET)).toEqual({ kind: 'none' });
    const unreadable = { kind: 'unknown', reason: UNREADABLE_REASON };
    expect(UNREADABLE_REASON).toBe('Studio cannot read it');
    expect(readPolicy('{not json', QUEUE_TARGET)).toEqual(unreadable);
    expect(readPolicy('{"Version":"2012-10-17"}', QUEUE_TARGET)).toEqual(unreadable);
    expect(readPolicy('[1,2]', QUEUE_TARGET)).toEqual(unreadable);
    expect(readPolicy('{"Statement":["x"]}', QUEUE_TARGET)).toEqual(unreadable);
  });

  const allowedShapes: [string, Record<string, unknown>][] = [
    ['the principal as the service', {}],
    ['the principal "*"', { Principal: '*' }],
    ['the principal {"AWS":"*"}', { Principal: { AWS: '*' } }],
    ['sqs:SendMessage', { Action: 'sqs:SendMessage' }],
    ['SQS:SendMessage', { Action: 'SQS:SendMessage' }],
    ['sqs:*', { Action: 'sqs:*' }],
    ['an action list holding it', { Action: ['sqs:ReceiveMessage', 'sqs:sendmessage'] }],
    ['no condition', { Condition: undefined }],
    ['ArnEquals aws:SourceArn', { Condition: { ArnEquals: { 'aws:SourceArn': TOPIC } } }],
    ['ArnLike aws:SourceArn', { Condition: { ArnLike: { 'aws:SourceArn': TOPIC } } }],
    ['ArnEquals AWS:SourceArn', { Condition: { ArnEquals: { 'AWS:SourceArn': TOPIC } } }],
    ['ArnLike AWS:SourceArn', { Condition: { ArnLike: { 'AWS:SourceArn': TOPIC } } }],
    ['a pattern with * that matches the topic', { Condition: { ArnLike: { 'aws:SourceArn': 'arn:aws:sns:*:ord*' } } }],
  ];
  for (const [shape, changes] of allowedShapes) {
    it(`a queue policy with ${shape} → allowed`, () => {
      expect(readPolicy(policy(statement(changes)), QUEUE_TARGET)).toEqual({ kind: 'allowed' });
    });
  }

  const withheldShapes: [string, Record<string, unknown>][] = [
    ['naming another topic', { Condition: { ArnEquals: { 'aws:SourceArn': OTHER_TOPIC } } }],
    ['with the account as the principal', { Principal: { AWS: 'arn:aws:iam::000000000000:root' } }],
    ['with another service as the principal', { Principal: { Service: 'events.amazonaws.com' } }],
    ['with another action', { Action: 'sqs:ReceiveMessage' }],
    ['naming another queue as the resource', { Resource: 'arn:aws:sqs:us-east-1:000000000000:other' }],
  ];
  for (const [shape, changes] of withheldShapes) {
    it(`a queue policy whose only statement is ${shape} → no permission`, () => {
      expect(readPolicy(policy(statement(changes)), QUEUE_TARGET)).toEqual({ kind: 'none' });
    });
  }

  it('an allowing statement beside a Deny → cannot tell, with its reason', () => {
    expect(readPolicy(policy(statement(), statement({ Effect: 'Deny' })), QUEUE_TARGET)).toEqual({
      kind: 'unknown',
      reason: 'it has a Deny statement, which Studio does not evaluate',
    });
    expect(DENY_REASON).toBe('it has a Deny statement, which Studio does not evaluate');
  });

  it('a single statement that is not in a list is read like a list of one', () => {
    expect(readPolicy(JSON.stringify({ Statement: statement() }), QUEUE_TARGET)).toEqual({ kind: 'allowed' });
    expect(readPolicy(JSON.stringify({ Statement: statement({ Action: 'sqs:Get*' }) }), QUEUE_TARGET)).toEqual({
      kind: 'none',
    });
  });

  it('a function policy: the service with ArnLike AWS:SourceArn or no condition → allowed; another topic or "*" → no permission', () => {
    const fn = (changes: Record<string, unknown>) =>
      policy(
        statement({
          Sid: 'p',
          Action: 'lambda:InvokeFunction',
          Resource: FUNCTION,
          Condition: { ArnLike: { 'AWS:SourceArn': TOPIC } },
          ...changes,
        }),
      );
    expect(readPolicy(fn({}), FUNCTION_TARGET)).toEqual({ kind: 'allowed' });
    expect(readPolicy(fn({ Condition: undefined }), FUNCTION_TARGET)).toEqual({ kind: 'allowed' });
    expect(readPolicy(fn({ Condition: { ArnLike: { 'AWS:SourceArn': OTHER_TOPIC } } }), FUNCTION_TARGET)).toEqual({
      kind: 'none',
    });
    expect(readPolicy(fn({ Principal: '*' }), FUNCTION_TARGET)).toEqual({ kind: 'none' });
  });
});

describe('queuePolicyWithStatement', () => {
  const target = { queueArn: QUEUE, topicArn: TOPIC, topicName: 'orders' };
  const added = {
    Sid: 'EmuForgeSnsorders',
    Effect: 'Allow',
    Principal: { Service: 'sns.amazonaws.com' },
    Action: 'sqs:SendMessage',
    Resource: QUEUE,
    Condition: { ArnEquals: { 'aws:SourceArn': TOPIC } },
  };

  it('to no policy → version 2012-10-17 with the one statement', () => {
    expect(JSON.parse(queuePolicyWithStatement(undefined, target))).toEqual({
      Version: '2012-10-17',
      Statement: [added],
    });
    expect(JSON.parse(queuePolicyWithStatement('', target))).toEqual({ Version: '2012-10-17', Statement: [added] });
  });

  it('to a policy with statements → every statement and member kept, the new one last', () => {
    const own = { Sid: 'own', Effect: 'Allow', Principal: { AWS: '000000000000' }, Action: 'sqs:*', Resource: QUEUE };
    const text = JSON.stringify({ Version: '2012-10-17', Id: 'mine', Statement: [own] });
    expect(JSON.parse(queuePolicyWithStatement(text, target))).toEqual({
      Version: '2012-10-17',
      Id: 'mine',
      Statement: [own, added],
    });
  });

  it('to a policy whose Statement is a single object → a list of two', () => {
    const own = { Sid: 'own', Effect: 'Allow', Principal: '*', Action: 'sqs:GetQueueUrl', Resource: QUEUE };
    expect(JSON.parse(queuePolicyWithStatement(JSON.stringify({ Statement: own }), target))).toEqual({
      Statement: [own, added],
    });
  });

  it('numbers the Sid against the policy', () => {
    const text = policy({ ...statement(), Sid: 'EmuForgeSnsorders' });
    const parsed = JSON.parse(queuePolicyWithStatement(text, target)) as { Statement: { Sid: string }[] };
    expect(parsed.Statement.map((item) => item.Sid)).toEqual(['EmuForgeSnsorders', 'EmuForgeSnsorders2']);
  });
});

describe('the Sid and the statement id', () => {
  it("the queue statement's Sid: EmuForgeSns and the name's letters and digits, numbered while taken", () => {
    expect(queueStatementSid('orders.fifo', [])).toBe('EmuForgeSnsordersfifo');
    expect(queueStatementSid('my-topic_2', [])).toBe('EmuForgeSnsmytopic2');
    expect(queueStatementSid('orders', ['EmuForgeSnsorders'])).toBe('EmuForgeSnsorders2');
    expect(queueStatementSid('orders', ['EmuForgeSnsorders', 'EmuForgeSnsorders2'])).toBe('EmuForgeSnsorders3');
  });

  it("the function permission's statement id: emuforge-sns- and the name, . replaced by -, 100 characters at most", () => {
    expect(permissionStatementId('orders.fifo', [])).toBe('emuforge-sns-orders-fifo');
    expect(permissionStatementId('my_topic-1', [])).toBe('emuforge-sns-my_topic-1');
    const id = permissionStatementId('a'.repeat(256), []);
    expect(id).toHaveLength(100);
    expect(id.startsWith('emuforge-sns-aaa')).toBe(true);
  });

  it('numbers the statement id against the policy’s Sids', () => {
    const taken = policySids(
      policy({ Sid: 'emuforge-sns-orders-fifo', Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: FUNCTION }),
    );
    expect(taken).toEqual(['emuforge-sns-orders-fifo']);
    expect(permissionStatementId('orders.fifo', taken)).toBe('emuforge-sns-orders-fifo-2');
    expect(permissionStatementId('orders.fifo', [...taken, 'emuforge-sns-orders-fifo-2'])).toBe(
      'emuforge-sns-orders-fifo-3',
    );
    const long = 'a'.repeat(256);
    const first = permissionStatementId(long, []);
    const second = permissionStatementId(long, [first]);
    expect(second).toHaveLength(100);
    expect(second.endsWith('a-2')).toBe(true);
    expect(second).not.toBe(first);
  });

  it('policySids reads none from no policy or one Studio cannot read', () => {
    expect(policySids(undefined)).toEqual([]);
    expect(policySids('nope')).toEqual([]);
  });
});
