import {
  CancelMessageMoveTaskCommand,
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListDeadLetterSourceQueuesCommand,
  ListMessageMoveTasksCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  StartMessageMoveTaskCommand,
  type Message,
  type MessageAttributeValue,
} from '@aws-sdk/client-sqs';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { RequestError, sendRequest, type RequestFailure } from '../../../../../lib/aws/request';
import { base64ToBytes, bytesToBase64, queueNameFromUrl, wholeNumber } from './format';

// The SQS calls of the AWS area (issue 481, design tasks 1 to 5), through the engine, mapped to plain typed results.
// Every command goes through the shared `sendRequest` with its operation's name, so a failed request rejects with
// its `RequestError` and an aborted one with the signal's reason. A queue is named by the `QueueUrl` the emulator
// returned, never by one built here, and that URL is never followed: the client sends every request to the engine
// (`useQueueUrlAsEndpoint: false`, issue 79 R2). Every value of a result is the emulator's, as it came.

/** The operations of the SQS screens, as a failure names them. */
export const OPERATIONS = {
  listQueues: 'ListQueues',
  getQueueAttributes: 'GetQueueAttributes',
  getQueueUrl: 'GetQueueUrl',
  listDeadLetterSourceQueues: 'ListDeadLetterSourceQueues',
  receiveMessage: 'ReceiveMessage',
  sendMessage: 'SendMessage',
  deleteMessageBatch: 'DeleteMessageBatch',
  purgeQueue: 'PurgeQueue',
  startMessageMoveTask: 'StartMessageMoveTask',
  listMessageMoveTasks: 'ListMessageMoveTasks',
  cancelMessageMoveTask: 'CancelMessageMoveTask',
} as const;

/** The emulator holds no queue of the name or URL asked. */
export const NO_SUCH_QUEUE = 'no-such-queue';
export type NoSuchQueue = typeof NO_SUCH_QUEUE;

/** The codes with which SQS says it holds no such queue: the query code, and the JSON protocol's own. */
const NO_SUCH_QUEUE_CODES: ReadonlySet<string> = new Set([
  'AWS.SimpleQueueService.NonExistentQueue',
  'QueueDoesNotExist',
]);

/** The failure says the emulator holds no such queue. */
export function isNoSuchQueue(failure: RequestFailure): boolean {
  return failure.kind === 'other' && NO_SUCH_QUEUE_CODES.has(failure.code);
}

const clients = new Map<string, SQSClient>();

/** The area's SQS client for the engine at `endpoint`, one per endpoint for the life of the page. */
function sqsClient(endpoint: string): SQSClient {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(SQSClient, { endpoint }, { useQueueUrlAsEndpoint: false });
    clients.set(endpoint, client);
  }
  return client;
}

function send<Output>(
  endpoint: string,
  operation: string,
  call: (client: SQSClient, abortSignal: AbortSignal) => Promise<Output>,
  signal: AbortSignal,
): Promise<Output> {
  return sendRequest(operation, (abortSignal) => call(sqsClient(endpoint), abortSignal), signal);
}

/** `pending`, with a "no such queue" answer as `NO_SUCH_QUEUE`; every other failure rejects as it came. */
async function orNoSuchQueue<T>(pending: Promise<T>): Promise<T | NoSuchQueue> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof RequestError && isNoSuchQueue(error.failure)) {
      return NO_SUCH_QUEUE;
    }
    throw error;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Queues

/** What one page of the queue list is asked with. */
export interface QueuePageRequest {
  /** `MaxResults`. */
  pageSize: number;
  /** `QueueNamePrefix`; an empty text is not sent. */
  prefix?: string;
  /** `NextToken`, the token of the page before. */
  token?: string;
}

/** One page of `ListQueues`: the queue URLs in the emulator's order, and its token when more follow. */
export interface QueueUrlPage {
  urls: string[];
  nextToken?: string;
}

export async function listQueues(
  endpoint: string,
  { pageSize, prefix, token }: QueuePageRequest,
  signal: AbortSignal,
): Promise<QueueUrlPage> {
  const output = await send(
    endpoint,
    OPERATIONS.listQueues,
    (client, abortSignal) =>
      client.send(
        new ListQueuesCommand({
          MaxResults: pageSize,
          ...(prefix === undefined || prefix === '' ? {} : { QueueNamePrefix: prefix }),
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: QueueUrlPage = { urls: (output.QueueUrls ?? []).filter((url) => url !== '') };
  const next = text(output.NextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  return page;
}

/** Every attribute of the queue at `url` (`AttributeNames: ['All']`), or `NO_SUCH_QUEUE`. */
export function getQueueAttributes(
  endpoint: string,
  url: string,
  signal: AbortSignal,
): Promise<Record<string, string> | NoSuchQueue> {
  return orNoSuchQueue(
    send(
      endpoint,
      OPERATIONS.getQueueAttributes,
      (client, abortSignal) =>
        client.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['All'] }), { abortSignal }),
      signal,
    ).then((output) => ({ ...output.Attributes })),
  );
}

/** The `QueueArn` attribute of the queue at `url`, as it came; `undefined` when the answer gave none. */
export function getQueueArn(endpoint: string, url: string, signal: AbortSignal): Promise<string | NoSuchQueue | undefined> {
  return orNoSuchQueue(
    send(
      endpoint,
      OPERATIONS.getQueueAttributes,
      (client, abortSignal) =>
        client.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }), { abortSignal }),
      signal,
    ).then((output) => text(output.Attributes?.QueueArn)),
  );
}

/** The URL the emulator gives for the queue named `name`, or `NO_SUCH_QUEUE`. */
export function getQueueUrl(endpoint: string, name: string, signal: AbortSignal): Promise<string | NoSuchQueue> {
  return orNoSuchQueue(
    send(
      endpoint,
      OPERATIONS.getQueueUrl,
      (client, abortSignal) => client.send(new GetQueueUrlCommand({ QueueName: name }), { abortSignal }),
      signal,
    ).then((output) => {
      const url = text(output.QueueUrl);
      return url ?? NO_SUCH_QUEUE;
    }),
  );
}

/** The URLs of the queues whose dead-letter queue is the one at `url` (every source, no `MaxResults`). */
export function listDeadLetterSourceQueues(
  endpoint: string,
  url: string,
  signal: AbortSignal,
): Promise<string[] | NoSuchQueue> {
  return orNoSuchQueue(
    send(
      endpoint,
      OPERATIONS.listDeadLetterSourceQueues,
      (client, abortSignal) => client.send(new ListDeadLetterSourceQueuesCommand({ QueueUrl: url }), { abortSignal }),
      signal,
    ).then((output) => (output.queueUrls ?? []).filter((source) => source !== '')),
  );
}

/** What the screens read of one queue: its attributes and the queues it is the dead-letter queue for. */
export interface QueueDetails {
  url: string;
  name: string;
  attributes: Record<string, string>;
  /** The names of the source queues, in the answer's order. */
  sources: string[];
}

/** The two reads of the queue at `url`, in parallel; `NO_SUCH_QUEUE` when either says it is gone. */
export async function readQueueDetails(
  endpoint: string,
  url: string,
  signal: AbortSignal,
): Promise<QueueDetails | NoSuchQueue> {
  const [attributes, sources] = await Promise.all([
    getQueueAttributes(endpoint, url, signal),
    listDeadLetterSourceQueues(endpoint, url, signal),
  ]);
  if (attributes === NO_SUCH_QUEUE || sources === NO_SUCH_QUEUE) {
    return NO_SUCH_QUEUE;
  }
  return { url, name: queueNameFromUrl(url), attributes, sources: sources.map(queueNameFromUrl) };
}

/** S2's read: `GetQueueUrl` of the route's name, then the queue's details; `NO_SUCH_QUEUE` when it is not held. */
export async function readQueue(endpoint: string, name: string, signal: AbortSignal): Promise<QueueDetails | NoSuchQueue> {
  const url = await getQueueUrl(endpoint, name, signal);
  return url === NO_SUCH_QUEUE ? url : readQueueDetails(endpoint, url, signal);
}

/** One row of the queue list: its name always, and its details, or why they could not be read. */
export interface QueueRow {
  url: string;
  name: string;
  details:
    | { kind: 'read'; attributes: Record<string, string>; sources: string[] }
    | { kind: 'gone' }
    | { kind: 'failed'; failure: RequestFailure };
}

/** One page of the queue list, in the emulator's order. */
export interface QueuePage {
  queues: QueueRow[];
  nextToken?: string;
}

async function queueRow(endpoint: string, url: string, signal: AbortSignal): Promise<QueueRow> {
  const name = queueNameFromUrl(url);
  try {
    const details = await readQueueDetails(endpoint, url, signal);
    return details === NO_SUCH_QUEUE
      ? { url, name, details: { kind: 'gone' } }
      : { url, name, details: { kind: 'read', attributes: details.attributes, sources: details.sources } };
  } catch (error) {
    if (error instanceof RequestError) {
      return { url, name, details: { kind: 'failed', failure: error.failure } };
    }
    throw error;
  }
}

/**
 * S1's read of one page: `ListQueues`, then for each URL of the page, in parallel, `GetQueueAttributes` and
 * `ListDeadLetterSourceQueues`. A row whose own reads fail keeps its name and its failure; only a failure of
 * `ListQueues` rejects.
 */
export async function listQueuePage(endpoint: string, request: QueuePageRequest, signal: AbortSignal): Promise<QueuePage> {
  const { urls, nextToken } = await listQueues(endpoint, request, signal);
  const queues = await Promise.all(urls.map((url) => queueRow(endpoint, url, signal)));
  return nextToken === undefined ? { queues } : { queues, nextToken };
}

// ---------------------------------------------------------------------------------------------------------------
// Messages

/** One message attribute, its value as text: a Binary value as Base64 of its bytes. */
export interface MessageAttribute {
  name: string;
  /** `DataType`, as it came (`String`, `Number`, `Binary`, with an optional `.label`). */
  type: string;
  value: string;
}

/** One message of a read, every value as it came. */
export interface ReadMessage {
  id: string;
  receiptHandle: string;
  body: string;
  /** `SentTimestamp`. */
  sent?: Date;
  /** `ApproximateFirstReceiveTimestamp`. */
  firstReceived?: Date;
  /** `ApproximateReceiveCount`. */
  receiveCount?: number;
  senderId?: string;
  groupId?: string;
  deduplicationId?: string;
  sequenceNumber?: string;
  /** `DeadLetterQueueSourceArn`. */
  deadLetterSourceArn?: string;
  /** The message attributes, in the answer's order. */
  attributes: MessageAttribute[];
}

/** The longest wait `ReceiveMessage` takes, in seconds (21 was refused). */
export const MAX_WAIT_SECONDS = 20;

function timestamp(value: string | undefined): Date | undefined {
  const ms = wholeNumber(value);
  return ms === undefined ? undefined : new Date(ms);
}

function attributeValue({ DataType, StringValue, BinaryValue }: MessageAttributeValue): string {
  if (BinaryValue !== undefined && (DataType ?? '').startsWith('Binary')) {
    return bytesToBase64(BinaryValue);
  }
  return StringValue ?? (BinaryValue === undefined ? '' : bytesToBase64(BinaryValue));
}

function toMessage({ MessageId, ReceiptHandle, Body, Attributes, MessageAttributes }: Message): ReadMessage {
  const system: Partial<Record<string, string>> = Attributes ?? {};
  const message: ReadMessage = {
    id: MessageId ?? '',
    receiptHandle: ReceiptHandle ?? '',
    body: Body ?? '',
    attributes: Object.entries(MessageAttributes ?? {}).map(([name, value]) => ({
      name,
      type: value.DataType ?? '',
      value: attributeValue(value),
    })),
  };
  const sent = timestamp(system['SentTimestamp']);
  if (sent !== undefined) {
    message.sent = sent;
  }
  const firstReceived = timestamp(system['ApproximateFirstReceiveTimestamp']);
  if (firstReceived !== undefined) {
    message.firstReceived = firstReceived;
  }
  const receiveCount = wholeNumber(system['ApproximateReceiveCount']);
  if (receiveCount !== undefined) {
    message.receiveCount = receiveCount;
  }
  const texts = [
    ['senderId', 'SenderId'],
    ['groupId', 'MessageGroupId'],
    ['deduplicationId', 'MessageDeduplicationId'],
    ['sequenceNumber', 'SequenceNumber'],
    ['deadLetterSourceArn', 'DeadLetterQueueSourceArn'],
  ] as const;
  for (const [field, attribute] of texts) {
    const value = text(system[attribute]);
    if (value !== undefined) {
      message[field] = value;
    }
  }
  return message;
}

/**
 * A read of up to 10 messages of the queue at `url` that leaves them in it (`VisibilityTimeout: 0`), waiting up
 * to `waitSeconds` for one, with every message attribute and system attribute. Each read counts as a receive.
 */
export async function receiveMessages(
  endpoint: string,
  url: string,
  waitSeconds: number,
  signal: AbortSignal,
): Promise<ReadMessage[]> {
  const output = await send(
    endpoint,
    OPERATIONS.receiveMessage,
    (client, abortSignal) =>
      client.send(
        new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 0,
          WaitTimeSeconds: waitSeconds,
          MessageAttributeNames: ['All'],
          MessageSystemAttributeNames: ['All'],
        }),
        { abortSignal },
      ),
    signal,
  );
  return (output.Messages ?? []).map(toMessage);
}

/** One message attribute as the send form gives it: a Binary value as Base64 text. */
export interface OutgoingAttribute {
  name: string;
  type: 'String' | 'Number' | 'Binary';
  value: string;
}

/** A message to send. A field left empty is not sent. */
export interface OutgoingMessage {
  body: string;
  /** Seconds; standard queues only. */
  delaySeconds?: number;
  /** FIFO queues only. */
  groupId?: string;
  /** FIFO queues only. */
  deduplicationId?: string;
  attributes: readonly OutgoingAttribute[];
}

/** The queue a message is sent to. */
export interface SendTarget {
  url: string;
  fifo: boolean;
}

/** `SendMessage`'s answer. */
export interface SentMessage {
  messageId: string;
  sequenceNumber?: string;
}

/** A Binary attribute's value that is not Base64: refused before anything is sent. */
export class NotBase64Error extends Error {
  readonly attribute: string;

  constructor(attribute: string) {
    super(`The value of ${attribute} is not Base64 text.`);
    this.name = 'NotBase64Error';
    this.attribute = attribute;
  }
}

function outgoingAttributes(attributes: readonly OutgoingAttribute[]): Record<string, MessageAttributeValue> {
  const values: Record<string, MessageAttributeValue> = {};
  for (const { name, type, value } of attributes) {
    if (type === 'Binary') {
      const bytes = base64ToBytes(value);
      if (bytes === undefined) {
        throw new NotBase64Error(name);
      }
      values[name] = { DataType: 'Binary', BinaryValue: bytes };
    } else {
      values[name] = { DataType: type, StringValue: value };
    }
  }
  return values;
}

/**
 * Sends `message` to the queue at `target.url`. The delay goes only to a standard queue, the group and
 * deduplication ids only to a FIFO queue, and no field is sent empty. Rejects with `NotBase64Error`, before sending,
 * for a Binary value that is not Base64.
 */
export async function sendMessage(
  endpoint: string,
  target: SendTarget,
  message: OutgoingMessage,
  signal: AbortSignal,
): Promise<SentMessage> {
  const attributes = outgoingAttributes(message.attributes);
  const { body, delaySeconds, groupId, deduplicationId } = message;
  const output = await send(
    endpoint,
    OPERATIONS.sendMessage,
    (client, abortSignal) =>
      client.send(
        new SendMessageCommand({
          QueueUrl: target.url,
          MessageBody: body,
          ...(Object.keys(attributes).length === 0 ? {} : { MessageAttributes: attributes }),
          ...(target.fifo || delaySeconds === undefined ? {} : { DelaySeconds: delaySeconds }),
          ...(!target.fifo || groupId === undefined || groupId === '' ? {} : { MessageGroupId: groupId }),
          ...(!target.fifo || deduplicationId === undefined || deduplicationId === ''
            ? {}
            : { MessageDeduplicationId: deduplicationId }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const sent: SentMessage = { messageId: output.MessageId ?? '' };
  const sequence = text(output.SequenceNumber);
  if (sequence !== undefined) {
    sent.sequenceNumber = sequence;
  }
  return sent;
}

/** A message to delete: its id, and its receipt handle from a read. */
export interface MessageToDelete {
  id: string;
  receiptHandle: string;
}

/** A message `DeleteMessageBatch` did not delete, with the emulator's code and message as they came. */
export interface DeleteFailure {
  id: string;
  code: string;
  message?: string;
}

/** `DeleteMessageBatch`'s answer, split: the ids deleted and the failures, each in the order asked. */
export interface DeleteMessagesResult {
  deleted: string[];
  failed: DeleteFailure[];
}

/** Deletes `messages` (at most 10, as a read gives) in one `DeleteMessageBatch`, entry ids `0` to `n-1`. */
export async function deleteMessages(
  endpoint: string,
  url: string,
  messages: readonly MessageToDelete[],
  signal: AbortSignal,
): Promise<DeleteMessagesResult> {
  const output = await send(
    endpoint,
    OPERATIONS.deleteMessageBatch,
    (client, abortSignal) =>
      client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: url,
          Entries: messages.map(({ receiptHandle }, index) => ({ Id: String(index), ReceiptHandle: receiptHandle })),
        }),
        { abortSignal },
      ),
    signal,
  );
  const succeeded = new Set((output.Successful ?? []).map((entry) => entry.Id));
  const failures = new Map((output.Failed ?? []).map((entry) => [entry.Id, entry]));
  const result: DeleteMessagesResult = { deleted: [], failed: [] };
  messages.forEach(({ id }, index) => {
    const failure = failures.get(String(index));
    if (failure !== undefined) {
      const message = text(failure.Message);
      result.failed.push(
        message === undefined ? { id, code: failure.Code ?? '' } : { id, code: failure.Code ?? '', message },
      );
    } else if (succeeded.has(String(index))) {
      result.deleted.push(id);
    }
  });
  return result;
}

export async function purgeQueue(endpoint: string, url: string, signal: AbortSignal): Promise<void> {
  await send(
    endpoint,
    OPERATIONS.purgeQueue,
    (client, abortSignal) => client.send(new PurgeQueueCommand({ QueueUrl: url }), { abortSignal }),
    signal,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Redrive

/** A move of the dead letters of the queue whose ARN is `sourceArn`. */
export interface MoveRequest {
  /** The dead-letter queue's own `QueueArn`. */
  sourceArn: string;
  /** The destination's `QueueArn`; absent to move them back to their source queues. */
  destinationArn?: string;
  /** `MaxNumberOfMessagesPerSecond`. */
  maxPerSecond?: number;
}

/** Starts a move task; its `TaskHandle`. */
export async function startMessageMoveTask(
  endpoint: string,
  { sourceArn, destinationArn, maxPerSecond }: MoveRequest,
  signal: AbortSignal,
): Promise<string> {
  const output = await send(
    endpoint,
    OPERATIONS.startMessageMoveTask,
    (client, abortSignal) =>
      client.send(
        new StartMessageMoveTaskCommand({
          SourceArn: sourceArn,
          ...(destinationArn === undefined || destinationArn === '' ? {} : { DestinationArn: destinationArn }),
          ...(maxPerSecond === undefined ? {} : { MaxNumberOfMessagesPerSecond: maxPerSecond }),
        }),
        { abortSignal },
      ),
    signal,
  );
  return output.TaskHandle ?? '';
}

/** One move task, as `ListMessageMoveTasks` lists it. */
export interface MoveTask {
  /** Given only while the task is running. */
  taskHandle?: string;
  /** `RUNNING`, `COMPLETED`, `CANCELLING`, `CANCELLED`, `FAILED`, as it came. */
  status: string;
  destinationArn?: string;
  moved?: number;
  toMove?: number;
  failureReason?: string;
  started?: Date;
}

/** The move tasks of the queue whose ARN is `sourceArn`, newest first, at most 10. */
export async function listMessageMoveTasks(endpoint: string, sourceArn: string, signal: AbortSignal): Promise<MoveTask[]> {
  const output = await send(
    endpoint,
    OPERATIONS.listMessageMoveTasks,
    (client, abortSignal) =>
      client.send(new ListMessageMoveTasksCommand({ SourceArn: sourceArn, MaxResults: 10 }), { abortSignal }),
    signal,
  );
  return (output.Results ?? []).map((entry) => {
    const task: MoveTask = { status: entry.Status ?? '' };
    const handle = text(entry.TaskHandle);
    if (handle !== undefined) {
      task.taskHandle = handle;
    }
    const destination = text(entry.DestinationArn);
    if (destination !== undefined) {
      task.destinationArn = destination;
    }
    if (typeof entry.ApproximateNumberOfMessagesMoved === 'number') {
      task.moved = entry.ApproximateNumberOfMessagesMoved;
    }
    if (typeof entry.ApproximateNumberOfMessagesToMove === 'number') {
      task.toMove = entry.ApproximateNumberOfMessagesToMove;
    }
    const reason = text(entry.FailureReason);
    if (reason !== undefined) {
      task.failureReason = reason;
    }
    if (typeof entry.StartedTimestamp === 'number') {
      task.started = new Date(entry.StartedTimestamp);
    }
    return task;
  });
}

/** Cancels the running task `taskHandle`; the number of messages it had moved. */
export async function cancelMessageMoveTask(
  endpoint: string,
  taskHandle: string,
  signal: AbortSignal,
): Promise<number | undefined> {
  const output = await send(
    endpoint,
    OPERATIONS.cancelMessageMoveTask,
    (client, abortSignal) => client.send(new CancelMessageMoveTaskCommand({ TaskHandle: taskHandle }), { abortSignal }),
    signal,
  );
  return output.ApproximateNumberOfMessagesMoved;
}
