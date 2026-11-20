// The emulator side and the words of SNS's screens (test-criteria.md, issue 536), for the `sns-*.spec.ts` checks.
//
// - Direct calls: `directSns` (AWS Query, XML answers), `directSqs`, `directLambda`, `directIam` and `directLogs` of
//   `support/aws-clients-general.ts`, straight to the emulator, SigV4-signed with the key it wrote for this run, TLS
//   verified against its `ca.pem`, never through the engine. A service's folder imports no other service's folder
//   (`references/services-and-manifest.md`), so the few queue and function calls these checks need are written here.
// - `SnsSeeded`: the topics, queues, functions and roles a check makes, every one named under the check's prefix
//   `<p>`. When the check ends it deletes every topic and queue of the emulator under `<p>`, those Studio's actions
//   made included, and the functions, roles and log groups it made.
// - printer: the check's own function (Python 3.13, a stored zip written here). It prints `sns-line <Message>` for
//   each record of its event, so its log group shows which notifications the emulator delivered to it.
// - The screens' words (requirement.md, "EmuForge's own text"; design.md) and readers of what a screen shows.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import {
  directIam,
  directLambda,
  directLogs,
  directSns,
  directSqs,
  type DirectAnswer,
} from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { waitFor } from '../../support/wait';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** A direct answer: its status, its body as it came, and for a refusal the emulator's code. */
export interface Answer {
  status: number;
  body: string;
  code: string | null;
}

/** The text of an XML element's content, its entities decoded. */
function xmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** The content of the first element `tag` of `xml`, decoded; `null` when it has none. The tag may carry attributes. */
function element(xml: string, tag: string): string | null {
  const found = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return found === null ? null : xmlText(found[1] ?? '');
}

function arrived(answer: DirectAnswer, what: string): { status: number; body: string } {
  if ('error' in answer) throw new EnvError(`${what}: ${answer.error}`);
  return answer;
}

/** The code of a JSON refusal: its `__type`'s name, or `null`. */
function jsonCode(body: string): string | null {
  try {
    const type = (JSON.parse(body) as { __type?: unknown }).__type;
    return typeof type === 'string' ? (type.split('#').at(-1) ?? null) : null;
  } catch {
    return null;
  }
}

/** An SNS action with its parameters, straight to the emulator; logs its status. */
export async function sns(ctx: Ctx, port: number, action: string, params: Record<string, string> = {}): Promise<Answer> {
  const answer = arrived(await directSns(ctx, port, action, params), `direct ${action}`);
  const code = answer.status === 200 ? null : element(answer.body, 'Code');
  ctx.log(`direct sns ${action}: status ${String(answer.status)}${code ? ` ${code}` : ''}`);
  return { ...answer, code };
}

/** An SNS action that must answer 200; an `EnvError` otherwise (a check's Given that does not hold). */
async function snsGiven(ctx: Ctx, port: number, action: string, params: Record<string, string>): Promise<Answer> {
  const answer = await sns(ctx, port, action, params);
  if (answer.status !== 200) throw new EnvError(`direct ${action} answered ${String(answer.status)} ${answer.body}`);
  return answer;
}

/** An SQS action with its JSON input, straight to the emulator; logs its status. */
export async function sqs(ctx: Ctx, port: number, action: string, input: object = {}): Promise<Answer> {
  const answer = arrived(await directSqs(ctx, port, action, input), `direct ${action}`);
  const code = answer.status === 200 ? null : jsonCode(answer.body);
  ctx.log(`direct sqs ${action}: status ${String(answer.status)}${code ? ` ${code}` : ''}`);
  return { ...answer, code };
}

async function sqsGiven(ctx: Ctx, port: number, action: string, input: object): Promise<Record<string, unknown>> {
  const answer = await sqs(ctx, port, action, input);
  if (answer.status !== 200) throw new EnvError(`direct ${action} answered ${String(answer.status)} ${answer.body}`);
  return answer.body.trim() === '' ? {} : (JSON.parse(answer.body) as Record<string, unknown>);
}

/** A Lambda request, straight to the emulator; logs its status under `what`. */
async function lambda(
  ctx: Ctx,
  port: number,
  what: string,
  method: string,
  pathname: string,
  input: object | null = null,
  query: Record<string, string> = {},
): Promise<Answer> {
  const answer = arrived(await directLambda(ctx, port, method, pathname, query, input), `direct ${what}`);
  ctx.log(`direct lambda ${what}: status ${String(answer.status)}`);
  return { ...answer, code: answer.status < 300 ? null : jsonCode(answer.body) };
}

const FUNCTIONS = '/2015-03-31/functions';

/** The name of a topic, a queue or a function: the text after its ARN's last `:`, or its URL's last `/`. */
export function nameOf(arnOrUrl: string): string {
  return arnOrUrl.slice(Math.max(arnOrUrl.lastIndexOf('/'), arnOrUrl.lastIndexOf(':')) + 1);
}

// --- SNS: what the emulator holds ---

/** Every topic ARN of the emulator, every page. */
export async function topicArnsDirect(ctx: Ctx, port: number): Promise<string[]> {
  const arns: string[] = [];
  let token: string | null = null;
  do {
    const answer: Answer = await sns(ctx, port, 'ListTopics', token === null ? {} : { NextToken: token });
    if (answer.status !== 200) throw new Error(`direct ListTopics answered ${String(answer.status)}`);
    for (const m of answer.body.matchAll(/<TopicArn>([^<]*)<\/TopicArn>/g)) arns.push(xmlText(m[1] ?? ''));
    token = element(answer.body, 'NextToken');
  } while (token !== null && token !== '');
  return arns;
}

/** The attributes of the topic `arn` as the emulator gives them; `null` when it holds no such topic (404). */
export async function topicAttributesDirect(ctx: Ctx, port: number, arn: string): Promise<Record<string, string> | null> {
  const answer = await sns(ctx, port, 'GetTopicAttributes', { TopicArn: arn });
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`direct GetTopicAttributes ${arn} answered ${String(answer.status)}`);
  const attributes: Record<string, string> = {};
  for (const m of answer.body.matchAll(/<entry(?:\s[^>]*)?>\s*<key>([^<]*)<\/key>\s*<value>([\s\S]*?)<\/value>\s*<\/entry>/g)) {
    attributes[xmlText(m[1] ?? '')] = xmlText(m[2] ?? '');
  }
  return attributes;
}

/** A subscription as `ListSubscriptionsByTopic` gives it. */
export interface DirectSubscription {
  arn: string;
  protocol: string;
  endpoint: string;
}

/** Every subscription of the topic `arn`, every page. */
export async function subscriptionsDirect(ctx: Ctx, port: number, arn: string): Promise<DirectSubscription[]> {
  const found: DirectSubscription[] = [];
  let token: string | null = null;
  do {
    const answer: Answer = await sns(ctx, port, 'ListSubscriptionsByTopic', {
      TopicArn: arn,
      ...(token === null ? {} : { NextToken: token }),
    });
    if (answer.status !== 200) throw new Error(`direct ListSubscriptionsByTopic answered ${String(answer.status)}`);
    // The emulator writes each `member` with its namespace as an attribute (probe-5.log).
    for (const m of answer.body.matchAll(/<member(?:\s[^>]*)?>([\s\S]*?)<\/member>/g)) {
      const member = m[1] ?? '';
      found.push({
        arn: element(member, 'SubscriptionArn') ?? '',
        protocol: element(member, 'Protocol') ?? '',
        endpoint: element(member, 'Endpoint') ?? '',
      });
    }
    token = element(answer.body, 'NextToken');
  } while (token !== null && token !== '');
  return found;
}

/** `Publish message` to the topic `arn`, directly; its message id. */
export async function publishDirect(ctx: Ctx, port: number, arn: string, message: string): Promise<string> {
  const answer = await snsGiven(ctx, port, 'Publish', { TopicArn: arn, Message: message });
  return element(answer.body, 'MessageId') ?? '';
}

// --- SQS: what the emulator holds ---

/** A policy document as its owner holds it: its statements as a list, whatever shape `Statement` had. */
export interface Policy {
  document: Record<string, unknown>;
  statements: Record<string, unknown>[];
}

function policyOf(text: string): Policy {
  const document = JSON.parse(text) as Record<string, unknown>;
  const statement = document.Statement;
  const statements = (Array.isArray(statement) ? statement : statement === undefined ? [] : [statement]) as Record<
    string,
    unknown
  >[];
  return { document, statements };
}

/** The policy of the queue at `url`, parsed; `null` when the queue has none. */
export async function queuePolicyDirect(ctx: Ctx, port: number, url: string): Promise<Policy | null> {
  const answer = await sqsGiven(ctx, port, 'GetQueueAttributes', { QueueUrl: url, AttributeNames: ['Policy'] });
  const text = ((answer.Attributes ?? {}) as Record<string, string>).Policy;
  return text === undefined || text === '' ? null : policyOf(text);
}

/** A message of a queue as a direct read returns it. */
export interface DirectMessage {
  body: string;
  attributes: Record<string, string>;
}

/** `ReceiveMessage` of up to 10 messages with their system attributes, left available (`VisibilityTimeout` 0). */
export async function receiveDirect(ctx: Ctx, port: number, url: string): Promise<DirectMessage[]> {
  const answer = await sqsGiven(ctx, port, 'ReceiveMessage', {
    QueueUrl: url,
    MaxNumberOfMessages: 10,
    VisibilityTimeout: 0,
    MessageSystemAttributeNames: ['All'],
  });
  return ((answer.Messages ?? []) as Record<string, unknown>[]).map((m) => ({
    body: m.Body as string,
    attributes: (m.Attributes ?? {}) as Record<string, string>,
  }));
}

/** A notification as SNS writes it into a queue's message body. */
export interface Notification {
  MessageId?: string;
  Subject?: string;
  Message?: string;
  TopicArn?: string;
  MessageAttributes?: Record<string, { Type?: string; Value?: string }>;
}

/** How long a check waits for a notification the emulator delivers. */
export const DELIVERY_BOUND_MS = 20_000;

/**
 * Waits, with a bound, until the queue at `url` holds a notification whose `Message` is `message`; returns it with
 * the queue message's system attributes, or `null` when none arrived within the bound.
 */
export async function notificationIn(
  ctx: Ctx,
  port: number,
  url: string,
  message: string,
): Promise<{ notification: Notification; attributes: Record<string, string> } | null> {
  const found = await waitFor(DELIVERY_BOUND_MS, async () => {
    for (const each of await receiveDirect(ctx, port, url)) {
      let notification: Notification;
      try {
        notification = JSON.parse(each.body) as Notification;
      } catch {
        continue;
      }
      if (notification.Message === message) return { notification, attributes: each.attributes };
    }
    return undefined;
  });
  return found ?? null;
}

/** The `Message` of every notification the queue at `url` holds now (one read of up to 10). */
export async function messagesIn(ctx: Ctx, port: number, url: string): Promise<string[]> {
  return (await receiveDirect(ctx, port, url)).map((each) => {
    try {
      return (JSON.parse(each.body) as Notification).Message ?? each.body;
    } catch {
      return each.body;
    }
  });
}

/** The statement that lets the topic `topicArn` send to the queue `queueArn`, as an app would set it. */
export function sendStatement(queueArn: string, topicArn: string): Record<string, unknown> {
  return {
    Sid: 'check-lets-topic-send',
    Effect: 'Allow',
    Principal: { Service: 'sns.amazonaws.com' },
    Action: 'sqs:SendMessage',
    Resource: queueArn,
    Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
  };
}

/** Whether `statement` names `sns.amazonaws.com`, `action` and the topic `topicArn`. */
export function namesTopic(statement: Record<string, unknown>, action: string, topicArn: string): boolean {
  const text = JSON.stringify(statement);
  return (
    text.includes('sns.amazonaws.com') && text.toLowerCase().includes(action.toLowerCase()) && text.includes(topicArn)
  );
}

// --- Lambda: what the emulator holds ---

/** The policy of the function `name`, parsed; `null` when it has none (404). */
export async function functionPolicyDirect(ctx: Ctx, port: number, name: string): Promise<Policy | null> {
  const answer = await lambda(ctx, port, `GetPolicy ${name}`, 'GET', `${FUNCTIONS}/${encodeURIComponent(name)}/policy`);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`direct GetPolicy ${name} answered ${String(answer.status)}`);
  return policyOf((JSON.parse(answer.body) as { Policy: string }).Policy);
}

/** The lines the function `name` has logged, oldest first; none while it has no log group. */
export async function logLinesDirect(ctx: Ctx, port: number, name: string): Promise<string[]> {
  const answer = arrived(
    await directLogs(ctx, port, 'FilterLogEvents', { logGroupName: `/aws/lambda/${name}` }),
    'direct FilterLogEvents',
  );
  if (answer.status !== 200) return [];
  const events = ((JSON.parse(answer.body) as { events?: { message?: string }[] }).events ?? []) as {
    message?: string;
  }[];
  return events.map((e) => (e.message ?? '').trim());
}

/** The line printer logs for a notification whose `Message` is `message`. */
export function printerLine(message: string): string {
  return `sns-line ${message}`;
}

/** Waits, with a bound, until the function `name` has logged `line`; whether it has. */
export async function logged(ctx: Ctx, port: number, name: string, line: string): Promise<boolean> {
  const found = await waitFor(DELIVERY_BOUND_MS, async () =>
    (await logLinesDirect(ctx, port, name)).some((each) => each.includes(line)) ? true : undefined,
  );
  ctx.log(`the log of ${name} ${found ? 'holds' : 'does not hold'} "${line}"`);
  return found === true;
}

// --- A stored zip, for printer ---

let crcTable: Uint32Array | null = null;

/** CRC-32 (ISO 3309, the polynomial 0xEDB88320 reflected), as a zip archive records it. */
function crc32(data: Buffer): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive of one stored (uncompressed) file `name` holding `text` (PKWARE APPNOTE 6.3). */
function storedZip(name: string, text: string): Buffer {
  const fileName = Buffer.from(name, 'utf8');
  const data = Buffer.from(text, 'utf8');
  const crc = crc32(data);
  const dosDate = (1 << 5) | 1; // 1980-01-01
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(local.length + fileName.length + data.length, 16);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

const PRINTER_CODE = [
  'def handler(event, context):',
  '    for record in event.get("Records", []):',
  '        print("sns-line " + record["Sns"]["Message"])',
  '    return "ok"',
  '',
].join('\n');

const LAMBDA_TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
});

const BASIC_EXECUTION_POLICY = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** A queue a check made: its name, the URL the emulator returned and its own ARN. */
export interface MadeQueue {
  name: string;
  url: string;
  arn: string;
}

/** A function a check made: its name and the ARN the emulator returned. */
export interface MadeFunction {
  name: string;
  arn: string;
}

/**
 * The topics, queues, functions and roles a check makes directly on the emulator on `port`, each named under the
 * check's prefix. Making one that the emulator refuses is an environment failure: the check's Given would not hold.
 */
export class SnsSeeded {
  private readonly functions: string[] = [];
  private readonly roles: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  private named(name: string): void {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
  }

  /** `CreateTopic name` with `attributes`; its ARN as returned. */
  async topic(name: string, attributes: Record<string, string> = {}): Promise<string> {
    this.named(name);
    const params: Record<string, string> = { Name: name };
    Object.entries(attributes).forEach(([key, value], i) => {
      params[`Attributes.entry.${String(i + 1)}.key`] = key;
      params[`Attributes.entry.${String(i + 1)}.value`] = value;
    });
    const arn = element((await snsGiven(this.ctx, this.port, 'CreateTopic', params)).body, 'TopicArn');
    if (arn === null || arn === '') throw new EnvError(`the emulator gave ${name} no TopicArn`);
    return arn;
  }

  /** `DeleteTopic arn`, as an app or the AWS CLI would while a screen shows the topic. */
  async deleteTopic(arn: string): Promise<void> {
    await snsGiven(this.ctx, this.port, 'DeleteTopic', { TopicArn: arn });
  }

  /** `Subscribe protocol endpoint` to the topic `topicArn`; the subscription's ARN as returned. */
  async subscribe(topicArn: string, protocol: string, endpoint: string): Promise<string> {
    const answer = await snsGiven(this.ctx, this.port, 'Subscribe', {
      TopicArn: topicArn,
      Protocol: protocol,
      Endpoint: endpoint,
      ReturnSubscriptionArn: 'true',
    });
    return element(answer.body, 'SubscriptionArn') ?? '';
  }

  /** `CreateQueue name` with `attributes`; its URL as returned and its `QueueArn`. */
  async queue(name: string, attributes: Record<string, string> = {}): Promise<MadeQueue> {
    this.named(name);
    const made = await sqsGiven(this.ctx, this.port, 'CreateQueue', { QueueName: name, Attributes: attributes });
    const url = made.QueueUrl as string;
    const read = await sqsGiven(this.ctx, this.port, 'GetQueueAttributes', {
      QueueUrl: url,
      AttributeNames: ['QueueArn'],
    });
    const arn = ((read.Attributes ?? {}) as Record<string, string>).QueueArn;
    if (arn === undefined) throw new EnvError(`the emulator gave ${name} no QueueArn`);
    return { name, url, arn };
  }

  /** Sets the policy of `queue` to one of version `2012-10-17` holding `statements`. */
  async policy(queue: MadeQueue, statements: Record<string, unknown>[]): Promise<void> {
    await sqsGiven(this.ctx, this.port, 'SetQueueAttributes', {
      QueueUrl: queue.url,
      Attributes: { Policy: JSON.stringify({ Version: '2012-10-17', Statement: statements }) },
    });
  }

  /** A queue `name` whose policy lets the topic `topicArn` send to it. */
  async queueFor(name: string, topicArn: string, attributes: Record<string, string> = {}): Promise<MadeQueue> {
    const queue = await this.queue(name, attributes);
    await this.policy(queue, [sendStatement(queue.arn, topicArn)]);
    return queue;
  }

  /** The function printer as `name`, with a role of its own, waited for until it is `Active`. */
  async printer(name: string): Promise<MadeFunction> {
    this.named(name);
    const roleName = `${name}-role`;
    const role = arrived(
      await directIam(this.ctx, this.port, 'CreateRole', {
        RoleName: roleName,
        AssumeRolePolicyDocument: LAMBDA_TRUST_POLICY,
      }),
      `direct CreateRole ${roleName}`,
    );
    this.ctx.log(`direct iam CreateRole ${roleName}: status ${String(role.status)}`);
    if (role.status !== 200) throw new EnvError(`direct CreateRole ${roleName} answered ${String(role.status)}`);
    this.roles.push(roleName);
    const roleArn = element(role.body, 'Arn');
    if (roleArn === null) throw new EnvError(`the emulator gave the role ${roleName} no Arn`);
    const attached = arrived(
      await directIam(this.ctx, this.port, 'AttachRolePolicy', { RoleName: roleName, PolicyArn: BASIC_EXECUTION_POLICY }),
      `direct AttachRolePolicy ${roleName}`,
    );
    if (attached.status !== 200) throw new EnvError(`direct AttachRolePolicy answered ${String(attached.status)}`);

    this.functions.push(name);
    const made = await lambda(this.ctx, this.port, `CreateFunction ${name}`, 'POST', FUNCTIONS, {
      FunctionName: name,
      Runtime: 'python3.13',
      Role: roleArn,
      Handler: 'index.handler',
      Code: { ZipFile: storedZip('index.py', PRINTER_CODE).toString('base64') },
    });
    if (made.status !== 201) throw new EnvError(`direct CreateFunction ${name} answered ${String(made.status)} ${made.body}`);
    const arn = (JSON.parse(made.body) as { FunctionArn: string }).FunctionArn;
    let state: string | null = null;
    await waitFor(30_000, async () => {
      const read = await lambda(
        this.ctx,
        this.port,
        `GetFunctionConfiguration ${name}`,
        'GET',
        `${FUNCTIONS}/${encodeURIComponent(name)}/configuration`,
      );
      state = read.status === 200 ? ((JSON.parse(read.body) as { State?: string }).State ?? null) : null;
      return state === 'Active' ? true : undefined;
    });
    if (state !== 'Active') throw new EnvError(`function ${name} was ${String(state)}, not Active, within 30 s`);
    return { name, arn };
  }

  /** Deletes what the check made, and every topic and queue of the emulator under its prefix; logs what fails. */
  async dispose(): Promise<void> {
    const { ctx, port } = this;
    try {
      for (const arn of await topicArnsDirect(ctx, port)) {
        if (nameOf(arn).startsWith(this.prefix)) await sns(ctx, port, 'DeleteTopic', { TopicArn: arn });
      }
    } catch (e) {
      ctx.log(`cleanup of the topics ${this.prefix}* failed: ${(e as Error).message}`);
    }
    try {
      const listed = await sqsGiven(ctx, port, 'ListQueues', { QueueNamePrefix: this.prefix, MaxResults: 1000 });
      for (const url of (listed.QueueUrls ?? []) as string[]) await sqs(ctx, port, 'DeleteQueue', { QueueUrl: url });
    } catch (e) {
      ctx.log(`cleanup of the queues ${this.prefix}* failed: ${(e as Error).message}`);
    }
    for (const name of this.functions) {
      try {
        await lambda(ctx, port, `DeleteFunction ${name}`, 'DELETE', `${FUNCTIONS}/${encodeURIComponent(name)}`);
        const logs = await directLogs(ctx, port, 'DeleteLogGroup', { logGroupName: `/aws/lambda/${name}` });
        ctx.log(`cleanup DeleteLogGroup /aws/lambda/${name}: ${'error' in logs ? logs.error : String(logs.status)}`);
      } catch (e) {
        ctx.log(`cleanup of the function ${name} failed: ${(e as Error).message}`);
      }
    }
    for (const role of this.roles) {
      try {
        await directIam(ctx, port, 'DetachRolePolicy', { RoleName: role, PolicyArn: BASIC_EXECUTION_POLICY });
        const deleted = await directIam(ctx, port, 'DeleteRole', { RoleName: role });
        ctx.log(`cleanup DeleteRole ${role}: ${'error' in deleted ? deleted.error : String(deleted.status)}`);
      } catch (e) {
        ctx.log(`cleanup of the role ${role} failed: ${(e as Error).message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens' words.
// ---------------------------------------------------------------------------------------------------------------

export const SNS_PATH = '/aws/sns';
export const TOPICS_PATH = '/aws/sns/topics';
export const CREATE_TOPIC_PATH = '/aws/sns/topics/create';
/** S3's path for the topic `arn`, its ARN one segment below `topic/`. */
export function topicPath(arn: string): string {
  return `${TOPICS_PATH}/topic/${encodeURIComponent(arn)}`;
}
/** S4's path for the topic `arn`. */
export function subscribePath(arn: string): string {
  return `${topicPath(arn)}/subscribe`;
}
/** SQS's page of the queue `name` and Lambda's page of the function `name`, where an endpoint leads. */
export function queuePagePath(name: string): string {
  return `/aws/sqs/queues/queue/${encodeURIComponent(name)}`;
}
export function functionPagePath(name: string): string {
  return `/aws/lambda/functions/function/${encodeURIComponent(name)}`;
}

export const LIST_H1 = 'Topics';
export const NO_TOPICS = 'No topics';
export const CREATE_TOPIC = 'Create topic';
export const COPY_ARN = 'Copy ARN';
export const ARN_COPIED = 'ARN copied';
export const DELETE = 'Delete';
export const CANCEL = 'Cancel';
export const REFRESH = 'Refresh';
export const NEXT_PAGE = 'Next page';
export const TOPIC_NOT_FOUND = 'Topic not found';
export const VIEW_TOPICS = 'View topics';
export const TAB_SUBSCRIPTIONS = 'Subscriptions';
export const TAB_PUBLISH = 'Publish';
export const NO_SUBSCRIPTIONS = 'No subscriptions';
export const CREATE_SUBSCRIPTION = 'Create subscription';
export const ALLOW_DELIVERY = 'Allow delivery';
export const ALLOW_ON_CREATE = 'Allow this topic to deliver to it';
export const PROTOCOL_SQS = 'Amazon SQS';
export const PROTOCOL_LAMBDA = 'AWS Lambda';
export const CONFIRMED = 'Confirmed';
export const PENDING = 'Pending confirmation';
export const ALLOWED = 'Allowed';
export const NO_PERMISSION = 'No permission';
export const CANNOT_TELL = 'Cannot tell';
export const QUEUE_NOT_FOUND = 'Queue not found';
export const FUNCTION_NOT_FOUND = 'Function not found';
export const PUBLISH = 'Publish';
export const PUBLISHED = 'Published';
export const NOT_PUBLISHED = 'The message was not published';
export const NOTHING_PUBLISHED = 'Nothing published yet';
export const SEE_SUBSCRIPTIONS = "See this topic's subscriptions";
export const ENTER_MESSAGE = 'Enter a message.';
export const ENTER_GROUP_ID = 'Enter a message group ID.';
export const ENTER_DEDUPLICATION_ID = 'Enter a message deduplication ID.';
export const NAME_CHARACTERS = 'A name can hold letters, digits, hyphens and underscores only.';
export const FIFO_NAME_ENDING = "A FIFO topic's name ends with .fifo.";
export const DEDUPLICATION = 'Content-based deduplication';
export const POLICY_NOT_CHANGED = 'Its policy was not changed:';
/** The reason of a policy with a `Deny` statement (design.md, task 1 step 4). */
export const DENY_REASON = 'it has a Deny statement, which Studio does not evaluate';

export function topicReady(name: string): string {
  return `Topic ${name} is ready`;
}
export function deletedTopic(name: string): string {
  return `Deleted topic ${name}`;
}
export function subscribed(endpoint: string, topic: string): string {
  return `Subscribed ${endpoint} to ${topic}.`;
}
export function mayNowReceive(endpoint: string, topic: string): string {
  return `${endpoint} may now receive from ${topic}.`;
}
export function deletedSubscription(endpoint: string): string {
  return `Deleted the subscription of ${endpoint}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** A Cloudscape table, as a selector that also matches inside a scoped locator (no leading `body`). */
export const TABLE = wrapper.findTable().toSelector().replace(/^body /, '');
const ALERT = wrapper.findAlert().toSelector().replace(/^body /, '');
const SELECT_TRIGGER = wrapper.findSelect().findTrigger().toSelector().replace(/^body /, '');
const CONTAINER = wrapper.findContainer().toSelector().replace(/^body /, '');
/** The trigger of the "Type" select (the second field) of the attribute editor's row `n`, counted from 1. */
function attributeTypeTrigger(n: number): string {
  const select = wrapper.findAttributeEditor().findRow(n).findField(2).findControl().findSelect();
  return select.findTrigger().toSelector().replace(/^body /, '');
}

/** Opens `path` and waits for its `h1` `name`. */
export async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(heading(page, h1), `the h1 "${h1}" at ${path}`).toBeVisible({ timeout: 15_000 });
}

/**
 * The option of S4's open list that holds `value` (a queue's URL, a function's ARN), by the select's own test
 * selector. Not by its text: Cloudscape writes the label of a highlighted option a second time, for screen readers.
 */
function choice(page: Page, value: string): Locator {
  return page.getByRole('main').locator(
    wrapper.findSelect().findDropdown().findOptionByValue(value).toSelector().replace(/^body /, ''),
  );
}

/** Opens S3 of the topic `arn` and waits for its details. */
export async function openTopic(page: Page, arn: string): Promise<void> {
  await open(page, topicPath(arn), nameOf(arn));
  await expect(page.getByRole('heading', { name: 'Topic details', exact: true })).toBeVisible({ timeout: 15_000 });
}

/**
 * The data rows of the table `table` as shown, each a record of its column headings' texts to its cells' texts (the
 * selection column, whose cells hold only the row's radio or checkbox, is left out). A row whose only cell spans the
 * table is not a data row.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  return table.evaluate((root) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const element = root.querySelector('table');
    if (element === null) return [];
    const headers = [...element.querySelectorAll('thead tr:first-child > th')].map((th) => norm(th.textContent));
    const rows: Record<string, string>[] = [];
    for (const tr of element.querySelectorAll('tbody > tr')) {
      const cells = [...tr.querySelectorAll(':scope > td, :scope > th')];
      if (cells.length !== headers.length) continue;
      const row: Record<string, string> = {};
      cells.forEach((cell, i) => {
        const header = headers[i] ?? '';
        const selection = cell.querySelector('input[type="radio"], input[type="checkbox"]') !== null;
        if (header !== '' && !(selection && norm(cell.textContent) === '')) row[header] = norm(cell.textContent);
      });
      rows.push(row);
    }
    return rows;
  });
}

/** The text of the value of `label` in the key-value pairs inside `scope`; `null` when it has no such label. */
export async function valueOf(scope: Locator, label: string): Promise<string | null> {
  return scope.evaluate((root, wanted) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    for (const dt of root.querySelectorAll('dt')) {
      if (norm(dt.textContent) !== wanted) continue;
      const dd = dt.nextElementSibling;
      return dd === null ? null : norm(dd.textContent);
    }
    return null;
  }, label);
}

/** Waits until the value of `label` on the page holds `want`. */
export async function expectValue(page: Page, label: string, want: string): Promise<void> {
  await expect
    .poll(() => valueOf(page.getByRole('main'), label), { message: `"${label}" holds "${want}"`, timeout: 15_000 })
    .toContain(want);
}

/** The flash items of type `type`, as one locator. */
export function flashItems(page: Page, type: 'success' | 'error' | 'info' | 'warning'): Locator {
  return page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
}

/** Waits for one flash item of `type` holding every text of `texts`. */
export async function expectFlash(
  page: Page,
  type: 'success' | 'error' | 'info' | 'warning',
  ...texts: string[]
): Promise<void> {
  let item = flashItems(page, type);
  for (const text of texts) item = item.filter({ hasText: text });
  await expect(item, `a ${type} flash holding ${texts.map((t) => `"${t}"`).join(', ')}`).toHaveCount(1, {
    timeout: 20_000,
  });
}

/** Confirms the open dialog by typing `word` and choosing `action`. */
export async function confirmWith(page: Page, word: string, action: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog, 'the confirmation dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(word, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

/** Whether a request the page sent is the SNS action `action` (AWS Query: the action is in the body). */
export function isSnsAction(postData: string | null, action: string): boolean {
  return postData !== null && new URLSearchParams(postData).get('Action') === action;
}

/** Counts, from now on, the requests of the SNS action `action` that leave the page. */
export function countActions(page: Page, action: string): { count: () => number } {
  let seen = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && isSnsAction(request.postData(), action)) seen++;
  });
  return { count: () => seen };
}

/** Runs `act` and waits for the page's answer to the SNS action `action`. */
export async function answered(page: Page, action: string, act: () => Promise<void>): Promise<void> {
  const answer = page.waitForResponse((r) => isSnsAction(r.request().postData(), action), { timeout: 30_000 });
  await act();
  await answer;
}

// --- S1 ---

/** The parts of S1, the topics list, a check acts on. */
export function listScreen(page: Page) {
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  return {
    main,
    table,
    link: (name: string) => table.getByRole('link', { name, exact: true }),
    radio: (name: string) => main.getByRole('radio', { name, exact: true }),
    copyArn: main.getByRole('button', { name: COPY_ARN, exact: true }),
    del: main.getByRole('button', { name: DELETE, exact: true }),
    create: main.getByRole('link', { name: CREATE_TOPIC, exact: true }).first(),
    refresh: main.getByRole('button', { name: REFRESH, exact: true }),
    next: main.getByRole('button', { name: NEXT_PAGE, exact: true }),
  };
}

/** The most pages of S1 a check goes through to find its topic (100 topics a page). */
const PAGES_BOUND = 30;

async function listSettled(page: Page): Promise<void> {
  const s = listScreen(page);
  await expect(s.refresh, 'the topics list has been read').toBeEnabled({ timeout: 20_000 });
}

/**
 * On S1, goes from the page shown through the following pages until one shows the topic `name`; returns its row as
 * shown, or `null` when no page up to the last (bounded) shows it. The emulator's list holds other checks' topics.
 */
export async function findTopicRow(page: Page, name: string): Promise<Record<string, string> | null> {
  const s = listScreen(page);
  for (let i = 0; i < PAGES_BOUND; i++) {
    await listSettled(page);
    const row = (await rowsOf(s.table)).find((each) => each.Name === name);
    if (row !== undefined) return row;
    if (!(await s.next.isEnabled())) return null;
    await answered(page, 'ListTopics', () => s.next.click(ACTION));
  }
  return null;
}

// --- S3 ---

/** The parts of S3, a topic's page, a check acts on. */
export function topicScreen(page: Page) {
  const main = page.getByRole('main');
  const panel = page.getByRole('tabpanel');
  const table = panel.locator(TABLE).first();
  return {
    main,
    panel,
    table,
    tab: (name: string) => page.getByRole('tab', { name, exact: true }),
    refresh: main.getByRole('button', { name: REFRESH, exact: true }).first(),
    /** "Delete" of the topic, in the page's header. */
    deleteTopic: main.getByRole('button', { name: DELETE, exact: true }).first(),
    /** The radio of the subscription of `protocol` to `endpoint`. */
    radio: (protocol: string, endpoint: string) =>
      panel.getByRole('radio', { name: `${protocol} ${endpoint}`, exact: true }),
    allow: panel.getByRole('button', { name: ALLOW_DELIVERY, exact: true }),
    deleteSubscription: panel.getByRole('button', { name: DELETE, exact: true }),
    createSubscription: panel.getByRole('link', { name: CREATE_SUBSCRIPTION, exact: true }).first(),
    /**
     * The link of the endpoint `endpoint` in the table. By its text: the screen writes an address in parts that may
     * break apart, which a link's accessible name separates with spaces.
     */
    endpointLink: (endpoint: string) => table.getByRole('link').filter({ hasText: endpoint }),
  };
}

/** A row of the "Subscriptions" table as a check compares it: protocol, endpoint, status, delivery. */
export type SubscriptionRow = [string, string, string, string];

/** Waits until the "Subscriptions" table shows exactly `want`, in any order. */
export async function expectSubscriptions(page: Page, want: SubscriptionRow[], what: string): Promise<void> {
  const sorted = (rows: SubscriptionRow[]) => [...rows].sort((a, b) => a.join('\n').localeCompare(b.join('\n')));
  await expect
    .poll(
      async () =>
        sorted(
          (await rowsOf(topicScreen(page).table)).map(
            (r) => [r.Protocol ?? '', r.Endpoint ?? '', r.Status ?? '', r.Delivery ?? ''] as SubscriptionRow,
          ),
        ),
      { message: what, timeout: 30_000 },
    )
    .toEqual(sorted(want));
}

// --- S3 "Publish" ---

/** The parts of the "Publish" tab a check acts on. */
export function publishScreen(page: Page) {
  const panel = page.getByRole('tabpanel');
  return {
    panel,
    message: panel.getByRole('textbox', { name: 'Message', exact: true }),
    subject: panel.getByRole('textbox', { name: 'Subject - optional', exact: true }),
    groupId: panel.getByRole('textbox', { name: 'Message group ID', exact: true }),
    deduplicationId: panel.getByRole('textbox', { name: 'Message deduplication ID', exact: true }),
    addAttribute: panel.getByRole('button', { name: 'Add attribute', exact: true }),
    attributeName: (n: number) => panel.getByRole('textbox', { name: `Name of attribute ${String(n)}`, exact: true }),
    attributeValue: (n: number) => panel.getByRole('textbox', { name: `Value of attribute ${String(n)}`, exact: true }),
    attributeType: (n: number) => panel.locator(attributeTypeTrigger(n)),
    /** "Result", where the outcome of a publish is shown (the tab also says it once in a live region). */
    result: panel.locator(CONTAINER).filter({ has: page.getByRole('heading', { name: 'Result', exact: true }) }),
    publish: panel.getByRole('button', { name: PUBLISH, exact: true }),
  };
}

/** Opens the "Publish" tab of the topic's page shown. */
export async function openPublish(page: Page): Promise<void> {
  await topicScreen(page).tab(TAB_PUBLISH).click(ACTION);
  await expect(publishScreen(page).message, 'the publish form').toBeVisible({ timeout: 15_000 });
}

/** Adds the attribute row `n` (the next one) with `name`, `type` and `value`. */
export async function addAttribute(
  page: Page,
  n: number,
  name: string,
  type: 'String' | 'Number',
  value: string,
): Promise<void> {
  const s = publishScreen(page);
  await s.addAttribute.click(ACTION);
  await s.attributeName(n).fill(name, ACTION);
  if (type !== 'String') {
    await s.attributeType(n).click(ACTION);
    await page.getByRole('option', { name: type, exact: true }).click(ACTION);
  }
  await s.attributeValue(n).fill(value, ACTION);
}

/**
 * Presses "Publish", waits for the page's `Publish` to be answered and for the result "Published"; returns the
 * message ID the result shows.
 */
export async function publishAndRead(page: Page): Promise<string> {
  const s = publishScreen(page);
  await answered(page, 'Publish', () => s.publish.click(ACTION));
  await expect(s.result.getByText(PUBLISHED, { exact: true }), `"${PUBLISHED}"`).toBeVisible({ timeout: 15_000 });
  await expect(s.publish, '"Publish" after its answer').toBeEnabled({ timeout: 15_000 });
  const id = await valueOf(s.result, 'Message ID');
  if (id === null || id === '') throw new Error('the result shows no message ID');
  return id;
}

/** Types `message` as the publish form's message and publishes it; the message ID shown. */
export async function publishMessage(page: Page, message: string): Promise<string> {
  await publishScreen(page).message.fill(message, ACTION);
  return publishAndRead(page);
}

// --- S2 ---

/** The parts of S2, "Create topic", a check acts on. */
export function createTopicScreen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    type: (label: 'Standard' | 'FIFO') => main.getByRole('radio', { name: new RegExp(`^${label}( |$)`) }),
    name: main.getByRole('textbox', { name: 'Name', exact: true }),
    displayName: main.getByRole('textbox', { name: 'Display name - optional', exact: true }),
    deduplication: main.getByLabel(DEDUPLICATION, { exact: true }),
    submit: main.getByRole('button', { name: CREATE_TOPIC, exact: true }),
    alert: main.locator(ALERT),
  };
}

// --- S4 ---

/** The parts of S4, "Create subscription", a check acts on. */
export function subscribeScreen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    protocol: (label: string) => main.getByRole('radio', { name: new RegExp(`^${label}( |$)`) }),
    endpoint: main.locator(SELECT_TRIGGER).first(),
    filter: page.getByRole('combobox', { name: 'Queue name prefix' }),
    options: page.getByRole('option'),
    loadMore: page.getByRole('button', { name: 'Load more', exact: true }),
    allow: main.getByLabel(ALLOW_ON_CREATE, { exact: true }),
    submit: main.getByRole('button', { name: CREATE_SUBSCRIPTION, exact: true }),
    alert: main.locator(ALERT),
  };
}

/** Opens S4 of the topic `arn` and waits for its form. */
export async function openSubscribe(page: Page, arn: string): Promise<void> {
  await open(page, subscribePath(arn), CREATE_SUBSCRIPTION);
  await expect(subscribeScreen(page).endpoint, 'the endpoint field').toBeVisible({ timeout: 15_000 });
}

/** On S4 with "Amazon SQS" chosen: types the queue's name in "Queue" as the prefix and chooses that queue. */
export async function chooseQueue(page: Page, queue: MadeQueue): Promise<void> {
  const s = subscribeScreen(page);
  await s.endpoint.click(ACTION);
  await s.filter.fill(queue.name, ACTION);
  const option = choice(page, queue.url);
  await expect(option, `the choice ${queue.name}`).toHaveCount(1, { timeout: 20_000 });
  await option.click(ACTION);
  await expect(s.endpoint, `"Queue" shows ${queue.name}`).toContainText(queue.name);
}

/** The most pages of functions (50 a page) a check loads to find its function. */
const CHOICE_PAGES_BOUND = 20;

/**
 * On S4 with "AWS Lambda" chosen: opens "Function" and chooses the function `fn`, pressing "Load more" for as long
 * as the pages shown do not hold it (`ListFunctions` has no filter, and the emulator holds other checks' functions).
 */
export async function chooseFunction(page: Page, fn: MadeFunction): Promise<void> {
  const { name } = fn;
  const s = subscribeScreen(page);
  await s.endpoint.click(ACTION);
  const option = choice(page, fn.arn);
  for (let i = 0; i < CHOICE_PAGES_BOUND; i++) {
    const shown = await waitFor(10_000, async () =>
      (await option.count()) > 0 ? 'option' : (await s.loadMore.isVisible()) ? 'more' : undefined,
    );
    if (shown === 'option') break;
    if (shown !== 'more') break;
    const before = await s.options.count();
    await s.loadMore.click(ACTION);
    await expect.poll(() => s.options.count(), { message: 'a further page of functions', timeout: 20_000 }).toBeGreaterThan(before);
  }
  await expect(option, `the choice ${name}`).toHaveCount(1, { timeout: 10_000 });
  await option.click(ACTION);
  await expect(s.endpoint, `"Function" shows ${name}`).toContainText(name);
}
