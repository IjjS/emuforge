import {
  AddPermissionCommand,
  GetFunctionCommand,
  GetPolicyCommand,
  LambdaClient,
  ListFunctionsCommand,
} from '@aws-sdk/client-lambda';
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  ListTopicsCommand,
  PublishCommand,
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
  type MessageAttributeValue,
} from '@aws-sdk/client-sns';
import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  SQSClient,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest } from '../../../../../lib/aws/request';
import { endpointName, topicName } from './format';
import { permissionStatementId, policySids, queuePolicyWithStatement, readPolicy, type PolicyReading } from './policy';

// The calls of SNS's screens (issue 536, design tasks 1 to 6), through the engine, mapped to plain typed results: the
// SNS client, and an SQS and a Lambda client made by the same factory for the policies of the queues and functions a
// topic delivers to. Every command goes through the shared `sendRequest` with its operation's name, so a failed
// request rejects with its `RequestError` and an aborted one with the signal's reason. Every value is the emulator's,
// as it came; a queue URL is never followed (`useQueueUrlAsEndpoint: false`).

/** The operations of the SNS screens, as a failure names them. */
export const OPERATIONS = {
  listTopics: 'ListTopics',
  getTopicAttributes: 'GetTopicAttributes',
  listSubscriptionsByTopic: 'ListSubscriptionsByTopic',
  createTopic: 'CreateTopic',
  deleteTopic: 'DeleteTopic',
  subscribe: 'Subscribe',
  unsubscribe: 'Unsubscribe',
  publish: 'Publish',
  listQueues: 'ListQueues',
  getQueueUrl: 'GetQueueUrl',
  getQueueAttributes: 'GetQueueAttributes',
  setQueueAttributes: 'SetQueueAttributes',
  listFunctions: 'ListFunctions',
  getPolicy: 'GetPolicy',
  getFunction: 'GetFunction',
  addPermission: 'AddPermission',
} as const;

/** How many queues or functions one page of S4's choices asks for. */
export const CHOICES_PAGE_SIZE = 50;

/** SNS's answer for a topic it does not hold. */
const TOPIC_NOT_FOUND = 'NotFound';

/** The codes with which SQS says it holds no such queue: the query code, and the JSON protocol's own. */
const NO_SUCH_QUEUE_CODES: ReadonlySet<string> = new Set([
  'AWS.SimpleQueueService.NonExistentQueue',
  'QueueDoesNotExist',
]);

/** Lambda's answer for a function it does not hold, and for a function without a policy. */
const LAMBDA_NOT_FOUND = 'ResourceNotFoundException';

const snsClients = new Map<string, SNSClient>();
const sqsClients = new Map<string, SQSClient>();
const lambdaClients = new Map<string, LambdaClient>();

function snsClient(endpoint: string): SNSClient {
  let client = snsClients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(SNSClient, { endpoint });
    snsClients.set(endpoint, client);
  }
  return client;
}

function sqsClient(endpoint: string): SQSClient {
  let client = sqsClients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(SQSClient, { endpoint }, { useQueueUrlAsEndpoint: false });
    sqsClients.set(endpoint, client);
  }
  return client;
}

function lambdaClient(endpoint: string): LambdaClient {
  let client = lambdaClients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(LambdaClient, { endpoint });
    lambdaClients.set(endpoint, client);
  }
  return client;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function wholeNumber(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

/** The error is a failure answered with one of `codes`. */
function isCode(error: unknown, codes: ReadonlySet<string> | string): boolean {
  if (!(error instanceof RequestError) || error.failure.kind !== 'other') {
    return false;
  }
  return typeof codes === 'string' ? error.failure.code === codes : codes.has(error.failure.code);
}

/** `pending`, with an answer of one of `codes` as `fallback`; every other failure rejects as it came. */
async function orWhen<T, const F>(
  pending: Promise<T>,
  codes: ReadonlySet<string> | string,
  fallback: F,
): Promise<T | F> {
  try {
    return await pending;
  } catch (error) {
    if (isCode(error, codes)) {
      return fallback;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Topics

/** One page of `ListTopics`: the topics' ARNs in the emulator's order, and its token when more follow. */
export interface TopicPage {
  arns: string[];
  nextToken?: string;
}

export async function listTopics(endpoint: string, token: string | undefined, signal: AbortSignal): Promise<TopicPage> {
  const output = await sendRequest(
    OPERATIONS.listTopics,
    (abortSignal) =>
      snsClient(endpoint).send(new ListTopicsCommand(token === undefined ? {} : { NextToken: token }), { abortSignal }),
    signal,
  );
  const page: TopicPage = {
    arns: (output.Topics ?? []).flatMap((topic) => {
      const arn = text(topic.TopicArn);
      return arn === undefined ? [] : [arn];
    }),
  };
  const next = text(output.NextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  return page;
}

/** A topic as its page shows it, from `GetTopicAttributes`. A value the answer lacks is absent. */
export interface Topic {
  arn: string;
  /** `DisplayName`; absent when empty. */
  displayName?: string;
  fifo: boolean;
  contentBasedDeduplication: boolean;
  /** `SubscriptionsConfirmed`. */
  confirmed?: number;
  /** `SubscriptionsPending`. */
  pending?: number;
}

/** A topic read: the topic, or "not found" (404 `NotFound`). */
export type TopicRead = { found: true; topic: Topic } | { found: false };

export async function getTopic(endpoint: string, arn: string, signal: AbortSignal): Promise<TopicRead> {
  const read = await orWhen(
    sendRequest(
      OPERATIONS.getTopicAttributes,
      (abortSignal) => snsClient(endpoint).send(new GetTopicAttributesCommand({ TopicArn: arn }), { abortSignal }),
      signal,
    ),
    TOPIC_NOT_FOUND,
    undefined,
  );
  if (read === undefined) {
    return { found: false };
  }
  const attributes = read.Attributes ?? {};
  const topic: Topic = {
    arn: text(attributes['TopicArn']) ?? arn,
    fifo: attributes['FifoTopic'] === 'true',
    contentBasedDeduplication: attributes['ContentBasedDeduplication'] === 'true',
  };
  const displayName = text(attributes['DisplayName']);
  if (displayName !== undefined) {
    topic.displayName = displayName;
  }
  const confirmed = wholeNumber(attributes['SubscriptionsConfirmed']);
  if (confirmed !== undefined) {
    topic.confirmed = confirmed;
  }
  const pending = wholeNumber(attributes['SubscriptionsPending']);
  if (pending !== undefined) {
    topic.pending = pending;
  }
  return { found: true, topic };
}

/** What "Create topic" sends. */
export interface NewTopic {
  name: string;
  /** Sent only when not empty. */
  displayName?: string;
  fifo: boolean;
  /** Sent for a FIFO topic only. */
  contentBasedDeduplication: boolean;
}

/** `CreateTopic`: the topic's ARN as the emulator answered it. */
export async function createTopic(endpoint: string, topic: NewTopic, signal: AbortSignal): Promise<string> {
  const attributes: Record<string, string> = {};
  if (topic.displayName !== undefined && topic.displayName !== '') {
    attributes['DisplayName'] = topic.displayName;
  }
  if (topic.fifo) {
    attributes['FifoTopic'] = 'true';
    attributes['ContentBasedDeduplication'] = topic.contentBasedDeduplication ? 'true' : 'false';
  }
  const output = await sendRequest(
    OPERATIONS.createTopic,
    (abortSignal) =>
      snsClient(endpoint).send(
        new CreateTopicCommand({
          Name: topic.name,
          ...(Object.keys(attributes).length === 0 ? {} : { Attributes: attributes }),
        }),
        { abortSignal },
      ),
    signal,
  );
  return output.TopicArn ?? '';
}

export async function deleteTopic(endpoint: string, arn: string, signal: AbortSignal): Promise<void> {
  await sendRequest(
    OPERATIONS.deleteTopic,
    (abortSignal) => snsClient(endpoint).send(new DeleteTopicCommand({ TopicArn: arn }), { abortSignal }),
    signal,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Subscriptions

/** The `SubscriptionArn` of a subscription that waits for a confirmation. */
export const PENDING_CONFIRMATION = 'PendingConfirmation';

/** One subscription of a topic, as `ListSubscriptionsByTopic` gives it. */
export interface Subscription {
  /** `SubscriptionArn`, as it came: `PendingConfirmation` for a pending one. */
  arn: string;
  protocol: string;
  endpoint: string;
  /** The subscription waits for a confirmation, so it has no ARN. */
  pending: boolean;
}

/** One page of a topic's subscriptions, in the emulator's order, and its token when more follow. */
export interface SubscriptionPage {
  subscriptions: Subscription[];
  nextToken?: string;
}

export async function listSubscriptions(
  endpoint: string,
  topicArn: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<SubscriptionPage> {
  const output = await sendRequest(
    OPERATIONS.listSubscriptionsByTopic,
    (abortSignal) =>
      snsClient(endpoint).send(
        new ListSubscriptionsByTopicCommand({
          TopicArn: topicArn,
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: SubscriptionPage = {
    subscriptions: (output.Subscriptions ?? []).map((subscription) => {
      const arn = subscription.SubscriptionArn ?? '';
      return {
        arn,
        protocol: subscription.Protocol ?? '',
        endpoint: subscription.Endpoint ?? '',
        pending: arn === PENDING_CONFIRMATION,
      };
    }),
  };
  const next = text(output.NextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  return page;
}

/** The two protocols S4 subscribes, and whose delivery the subscriptions table reads. */
export type DeliveryProtocol = 'sqs' | 'lambda';

/** What `Subscribe` sends. */
export interface NewSubscription {
  topicArn: string;
  protocol: DeliveryProtocol;
  /** The queue's or the function's ARN. */
  endpoint: string;
}

/** `Subscribe` with `ReturnSubscriptionArn`: the subscription's ARN as it came. */
export async function subscribe(
  endpoint: string,
  subscription: NewSubscription,
  signal: AbortSignal,
): Promise<string | undefined> {
  const output = await sendRequest(
    OPERATIONS.subscribe,
    (abortSignal) =>
      snsClient(endpoint).send(
        new SubscribeCommand({
          TopicArn: subscription.topicArn,
          Protocol: subscription.protocol,
          Endpoint: subscription.endpoint,
          ReturnSubscriptionArn: true,
        }),
        { abortSignal },
      ),
    signal,
  );
  return text(output.SubscriptionArn);
}

export async function unsubscribe(endpoint: string, subscriptionArn: string, signal: AbortSignal): Promise<void> {
  await sendRequest(
    OPERATIONS.unsubscribe,
    (abortSignal) =>
      snsClient(endpoint).send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }), { abortSignal }),
    signal,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The choices of S4

/** A queue S4 offers: its name, from its URL, and its URL. */
export interface QueueChoice {
  name: string;
  url: string;
}

export interface QueueChoicePage {
  choices: QueueChoice[];
  nextToken?: string;
}

/** What one page of the queue choices is asked with. */
export interface QueueChoiceRequest {
  /** `QueueNamePrefix`; an empty text is not sent. */
  prefix?: string;
  /** `NextToken` of the page before. */
  token?: string;
}

/** One page of `ListQueues`, `MaxResults` 50. */
export async function listQueueChoices(
  endpoint: string,
  { prefix, token }: QueueChoiceRequest,
  signal: AbortSignal,
): Promise<QueueChoicePage> {
  const output = await sendRequest(
    OPERATIONS.listQueues,
    (abortSignal) =>
      sqsClient(endpoint).send(
        new ListQueuesCommand({
          MaxResults: CHOICES_PAGE_SIZE,
          ...(prefix === undefined || prefix === '' ? {} : { QueueNamePrefix: prefix }),
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: QueueChoicePage = {
    choices: (output.QueueUrls ?? [])
      .filter((url) => url !== '')
      .map((url) => ({ name: url.slice(url.lastIndexOf('/') + 1), url })),
  };
  const next = text(output.NextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  return page;
}

/** A function S4 offers: its name and its ARN, as `ListFunctions` gave them. */
export interface FunctionChoice {
  name: string;
  arn: string;
}

export interface FunctionChoicePage {
  choices: FunctionChoice[];
  nextMarker?: string;
}

/** One page of `ListFunctions`, `MaxItems` 50, from `marker`. */
export async function listFunctionChoices(
  endpoint: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<FunctionChoicePage> {
  const output = await sendRequest(
    OPERATIONS.listFunctions,
    (abortSignal) =>
      lambdaClient(endpoint).send(
        new ListFunctionsCommand({ MaxItems: CHOICES_PAGE_SIZE, ...(marker === undefined ? {} : { Marker: marker }) }),
        { abortSignal },
      ),
    signal,
  );
  const page: FunctionChoicePage = {
    choices: (output.Functions ?? []).flatMap((fn) => {
      const name = text(fn.FunctionName);
      const arn = text(fn.FunctionArn);
      return name === undefined || arn === undefined ? [] : [{ name, arn }];
    }),
  };
  const next = text(output.NextMarker);
  if (next !== undefined) {
    page.nextMarker = next;
  }
  return page;
}

// ---------------------------------------------------------------------------------------------------------------
// Queues and functions: their policies

/** A queue's ARN and policy, as `GetQueueAttributes` gave them; a value it lacks is absent. */
export interface QueuePolicy {
  arn?: string;
  policy?: string;
}

/** The emulator holds no such queue or function. */
export const NOT_FOUND = 'not-found';
export type NotFound = typeof NOT_FOUND;

/** `GetQueueAttributes` (`QueueArn`, `Policy`) of the queue at `url`, or `NOT_FOUND`. */
export async function readQueue(endpoint: string, url: string, signal: AbortSignal): Promise<QueuePolicy | NotFound> {
  const output = await orWhen(
    sendRequest(
      OPERATIONS.getQueueAttributes,
      (abortSignal) =>
        sqsClient(endpoint).send(
          new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn', 'Policy'] }),
          { abortSignal },
        ),
      signal,
    ),
    NO_SUCH_QUEUE_CODES,
    NOT_FOUND,
  );
  if (output === NOT_FOUND) {
    return NOT_FOUND;
  }
  const read: QueuePolicy = {};
  const arn = text(output.Attributes?.QueueArn);
  if (arn !== undefined) {
    read.arn = arn;
  }
  const policy = text(output.Attributes?.Policy);
  if (policy !== undefined) {
    read.policy = policy;
  }
  return read;
}

/** The URL of the queue named `name`, or `NOT_FOUND`. */
async function queueUrl(endpoint: string, name: string, signal: AbortSignal): Promise<string | NotFound> {
  const output = await orWhen(
    sendRequest(
      OPERATIONS.getQueueUrl,
      (abortSignal) => sqsClient(endpoint).send(new GetQueueUrlCommand({ QueueName: name }), { abortSignal }),
      signal,
    ),
    NO_SUCH_QUEUE_CODES,
    NOT_FOUND,
  );
  return output === NOT_FOUND ? NOT_FOUND : (text(output.QueueUrl) ?? NOT_FOUND);
}

const QUEUE_ARN = /^arn:[^:]+:sqs:[^:]+:[^:]+:([^:]+)$/;
const FUNCTION_ARN = /^arn:[^:]+:lambda:([^:]+):([^:]+):function:[^:]+(?::[^:]+)?$/;
const TOPIC_ARN = /^arn:[^:]+:sns:([^:]+):([^:]+):/;

/** The queue the endpoint `arn` names, with its URL and its policy; `NOT_FOUND` as the delivery column reads it. */
async function queueOfEndpoint(
  endpoint: string,
  arn: string,
  signal: AbortSignal,
  knownUrl?: string,
): Promise<QueuePolicy | NotFound> {
  const name = QUEUE_ARN.exec(arn)?.[1];
  if (name === undefined) {
    return NOT_FOUND;
  }
  const url = knownUrl ?? (await queueUrl(endpoint, name, signal));
  if (url === NOT_FOUND) {
    return NOT_FOUND;
  }
  const read = await readQueue(endpoint, url, signal);
  // A queue of the same name whose ARN differs (an endpoint of another Region or account) is not the one subscribed.
  if (read === NOT_FOUND || read.arn !== arn) {
    return NOT_FOUND;
  }
  return read;
}

/** The endpoint names a function of the topic's Region and account; any other the emulator cannot be holding. */
function isFunctionOfTopic(functionArn: string, topicArn: string): boolean {
  const fn = FUNCTION_ARN.exec(functionArn);
  const topic = TOPIC_ARN.exec(topicArn);
  return fn !== null && topic !== null && fn[1] === topic[1] && fn[2] === topic[2];
}

/** The function's policy text; `undefined` for a function without one or not held (`ResourceNotFoundException`). */
async function functionPolicy(endpoint: string, functionArn: string, signal: AbortSignal): Promise<string | undefined> {
  const output = await orWhen(
    sendRequest(
      OPERATIONS.getPolicy,
      (abortSignal) =>
        lambdaClient(endpoint).send(new GetPolicyCommand({ FunctionName: functionArn }), { abortSignal }),
      signal,
    ),
    LAMBDA_NOT_FOUND,
    undefined,
  );
  return output === undefined ? undefined : (text(output.Policy) ?? '');
}

/** Whether the emulator holds the function: `GetFunction`, its `ResourceNotFoundException` "no". */
async function functionExists(endpoint: string, functionArn: string, signal: AbortSignal): Promise<boolean> {
  const output = await orWhen(
    sendRequest(
      OPERATIONS.getFunction,
      (abortSignal) =>
        lambdaClient(endpoint).send(new GetFunctionCommand({ FunctionName: functionArn }), { abortSignal }),
      signal,
    ),
    LAMBDA_NOT_FOUND,
    NOT_FOUND,
  );
  return output !== NOT_FOUND;
}

/** Whether a notification of a topic can reach one subscriber, as the subscriptions table's "Delivery" says. */
export type Delivery = PolicyReading | { kind: 'queue-not-found' } | { kind: 'function-not-found' };

/** Whose delivery is read: the topic, the protocol and the endpoint's ARN. */
export interface DeliveryTarget {
  topicArn: string;
  protocol: DeliveryProtocol;
  endpoint: string;
}

/**
 * The delivery of a queue (`GetQueueUrl`, `GetQueueAttributes`) or a function (`GetPolicy`, and `GetFunction` when
 * that answers "not found") for the topic, as design task 1 step 4 reads it.
 */
export async function readDelivery(endpoint: string, target: DeliveryTarget, signal: AbortSignal): Promise<Delivery> {
  if (target.protocol === 'sqs') {
    const queue = await queueOfEndpoint(endpoint, target.endpoint, signal);
    if (queue === NOT_FOUND) {
      return { kind: 'queue-not-found' };
    }
    return readPolicy(queue.policy, { kind: 'queue', resource: target.endpoint, topicArn: target.topicArn });
  }
  if (!isFunctionOfTopic(target.endpoint, target.topicArn)) {
    return { kind: 'function-not-found' };
  }
  const policy = await functionPolicy(endpoint, target.endpoint, signal);
  if (policy === undefined) {
    return (await functionExists(endpoint, target.endpoint, signal))
      ? { kind: 'none' }
      : { kind: 'function-not-found' };
  }
  return readPolicy(policy, { kind: 'function', resource: target.endpoint, topicArn: target.topicArn });
}

/** What "Allow delivery" did. */
export type AllowOutcome =
  /** The statement or the permission was added. */
  | { outcome: 'added' }
  /** The policy read again already lets the topic deliver: nothing was sent. */
  | { outcome: 'already-allowed' }
  /** The policy was not changed: `reason` says why. */
  | { outcome: 'not-changed'; reason: string };

/** The reason of a "not changed" for a queue or a function the emulator no longer holds. */
export const GONE_REASON = 'the emulator no longer holds it';

/** What "Allow delivery" is asked for; a queue's URL when the caller has it (S4), else it is looked up by name. */
export interface AllowTarget extends DeliveryTarget {
  queueUrl?: string;
}

/**
 * "Allow delivery" (design task 1 step 5, task 2 steps 5 and 6): the policy read again first, then by what it reads,
 * for a queue `SetQueueAttributes` with the policy plus the statement, for a function `AddPermission` with a statement
 * id numbered against the policy's `Sid`s; nothing sent when it already allows or Studio cannot tell.
 */
export async function allowDelivery(endpoint: string, target: AllowTarget, signal: AbortSignal): Promise<AllowOutcome> {
  const name = topicName(target.topicArn);
  if (target.protocol === 'sqs') {
    const queue = await queueOfEndpoint(endpoint, target.endpoint, signal, target.queueUrl);
    if (queue === NOT_FOUND) {
      return { outcome: 'not-changed', reason: GONE_REASON };
    }
    const reading = readPolicy(queue.policy, { kind: 'queue', resource: target.endpoint, topicArn: target.topicArn });
    if (reading.kind !== 'none') {
      return reading.kind === 'allowed'
        ? { outcome: 'already-allowed' }
        : { outcome: 'not-changed', reason: reading.reason };
    }
    const url = target.queueUrl ?? (await queueUrl(endpoint, endpointName(target.endpoint), signal));
    if (url === NOT_FOUND) {
      return { outcome: 'not-changed', reason: GONE_REASON };
    }
    const policy = queuePolicyWithStatement(queue.policy, {
      queueArn: target.endpoint,
      topicArn: target.topicArn,
      topicName: name,
    });
    await sendRequest(
      OPERATIONS.setQueueAttributes,
      (abortSignal) =>
        sqsClient(endpoint).send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: { Policy: policy } }), {
          abortSignal,
        }),
      signal,
    );
    return { outcome: 'added' };
  }
  const policy = await functionPolicy(endpoint, target.endpoint, signal);
  const reading = readPolicy(policy, { kind: 'function', resource: target.endpoint, topicArn: target.topicArn });
  if (reading.kind !== 'none') {
    return reading.kind === 'allowed'
      ? { outcome: 'already-allowed' }
      : { outcome: 'not-changed', reason: reading.reason };
  }
  await sendRequest(
    OPERATIONS.addPermission,
    (abortSignal) =>
      lambdaClient(endpoint).send(
        new AddPermissionCommand({
          FunctionName: target.endpoint,
          StatementId: permissionStatementId(name, policySids(policy)),
          Action: 'lambda:InvokeFunction',
          Principal: 'sns.amazonaws.com',
          SourceArn: target.topicArn,
        }),
        { abortSignal },
      ),
    signal,
  );
  return { outcome: 'added' };
}

// ---------------------------------------------------------------------------------------------------------------
// Publish

/** One message attribute as the publish form holds it. */
export interface OutgoingAttribute {
  name: string;
  type: string;
  value: string;
}

/** What "Publish" sends; an empty subject, group ID or deduplication ID is not sent. */
export interface OutgoingMessage {
  topicArn: string;
  message: string;
  subject?: string;
  attributes?: readonly OutgoingAttribute[];
  groupId?: string;
  deduplicationId?: string;
}

/** What `Publish` answered. */
export interface Published {
  messageId: string;
  /** For a FIFO topic. */
  sequenceNumber?: string;
}

export async function publish(endpoint: string, message: OutgoingMessage, signal: AbortSignal): Promise<Published> {
  const attributes: Record<string, MessageAttributeValue> = {};
  for (const attribute of message.attributes ?? []) {
    attributes[attribute.name] = { DataType: attribute.type, StringValue: attribute.value };
  }
  const output = await sendRequest(
    OPERATIONS.publish,
    (abortSignal) =>
      snsClient(endpoint).send(
        new PublishCommand({
          TopicArn: message.topicArn,
          Message: message.message,
          ...(message.subject === undefined || message.subject === '' ? {} : { Subject: message.subject }),
          ...(Object.keys(attributes).length === 0 ? {} : { MessageAttributes: attributes }),
          ...(message.groupId === undefined || message.groupId === '' ? {} : { MessageGroupId: message.groupId }),
          ...(message.deduplicationId === undefined || message.deduplicationId === ''
            ? {}
            : { MessageDeduplicationId: message.deduplicationId }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const published: Published = { messageId: output.MessageId ?? '' };
  const sequence = text(output.SequenceNumber);
  if (sequence !== undefined) {
    published.sequenceNumber = sequence;
  }
  return published;
}
