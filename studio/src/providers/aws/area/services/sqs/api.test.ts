import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  cancelMessageMoveTask,
  createQueue,
  deleteMessages,
  deleteQueue,
  getQueueArn,
  getQueueAttributes,
  getQueueUrl,
  isNoSuchQueue,
  isQueueNameTaken,
  listDeadLetterChoices,
  listMessageMoveTasks,
  listQueuePage,
  NO_SUCH_QUEUE,
  NotBase64Error,
  purgeQueue,
  readQueue,
  receiveMessages,
  sendMessage,
  startMessageMoveTask,
} from './api';

// The test plays the engine behind the page's `fetch`: its session route, and every SQS request as it leaves the
// browser (JSON 1.0, one `X-Amz-Target` per operation), answered by the case.

const AWS_HOST = 'https://sqs.us-east-1.amazonaws.com/000000000000';
const ARN = 'arn:aws:sqs:us-east-1:000000000000';
const JSON_1_0 = 'application/x-amz-json-1.0';

interface Sent {
  url: string;
  operation: string;
  contentType: string | null;
  body: Record<string, unknown>;
}

interface Answer {
  status: number;
  body: unknown;
  /** The query error header of the JSON protocol's query compatibility: `<code>;Sender`. */
  queryError?: string;
}

type Handler = (body: Record<string, unknown>) => Answer;

class FakeEngine {
  readonly sent: Sent[] = [];
  readonly handlers = new Map<string, Handler>();

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-481' }), { status: 200 });
    }
    const target = request.headers.get('x-amz-target') ?? '';
    const operation = target.replace(/^AmazonSQS\./, '');
    const body = JSON.parse((await request.text()) || '{}') as Record<string, unknown>;
    this.sent.push({ url: request.url, operation, contentType: request.headers.get('content-type'), body });
    const handler = this.handlers.get(operation);
    const answer = handler === undefined ? ok({}) : handler(body);
    const headers: Record<string, string> = { 'content-type': JSON_1_0 };
    if (answer.queryError !== undefined) {
      headers['x-amzn-query-error'] = answer.queryError;
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers });
  };

  on(operation: string, handler: Handler) {
    this.handlers.set(operation, handler);
  }

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }
}

function ok(body: unknown): Answer {
  return { status: 200, body };
}

function refused(status: number, type: string, message: string, queryCode?: string): Answer {
  return {
    status,
    body: { __type: `com.amazonaws.sqs#${type}`, message },
    ...(queryCode === undefined ? {} : { queryError: `${queryCode};Sender` }),
  };
}

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

async function failure(promise: Promise<unknown>): Promise<RequestFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RequestError);
    return (error as RequestError).failure;
  }
  throw new Error('the request resolved');
}

let nextPort = 8900;
let engine: FakeEngine;
let endpoint: string;
const signal = () => new AbortController().signal;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request', () => {
  it('goes to the engine only for a queue URL on an AWS host, with X-Amz-Target and the JSON 1.0 type', async () => {
    engine.on('GetQueueAttributes', () => ok({ Attributes: { QueueArn: `${ARN}:orders` } }));

    await getQueueAttributes(endpoint, `${AWS_HOST}/orders`, signal());

    expect(engine.sent).toHaveLength(1);
    const [sent] = engine.sent;
    expect(new URL(sent?.url ?? '').origin).toBe(endpoint);
    expect(sent?.operation).toBe('GetQueueAttributes');
    expect(sent?.contentType).toBe(JSON_1_0);
    expect(sent?.body).toEqual({ QueueUrl: `${AWS_HOST}/orders`, AttributeNames: ['All'] });
  });
});

describe('a failure', () => {
  it('whose code is AWS.SimpleQueueService.NonExistentQueue is told apart as no such queue', async () => {
    const gone = () =>
      refused(
        400,
        'QueueDoesNotExist',
        'The specified queue does not exist.',
        'AWS.SimpleQueueService.NonExistentQueue',
      );
    engine.on('GetQueueUrl', gone);
    engine.on('GetQueueAttributes', gone);
    engine.on('SendMessage', gone);

    await expect(getQueueUrl(endpoint, 'orders', signal())).resolves.toBe(NO_SUCH_QUEUE);
    await expect(readQueue(endpoint, 'orders', signal())).resolves.toBe(NO_SUCH_QUEUE);
    await expect(getQueueAttributes(endpoint, `${AWS_HOST}/orders`, signal())).resolves.toBe(NO_SUCH_QUEUE);

    // An action keeps the code and message, which its item shows as they came; it is still told apart.
    const sendFailure = await failure(
      sendMessage(endpoint, { url: `${AWS_HOST}/orders`, fifo: false }, { body: 'x', attributes: [] }, signal()),
    );
    expect(sendFailure).toEqual({
      kind: 'other',
      operation: 'SendMessage',
      code: 'AWS.SimpleQueueService.NonExistentQueue',
      message: 'The specified queue does not exist.',
    });
    expect(isNoSuchQueue(sendFailure)).toBe(true);
  });

  it('keeps every other kind, code and message', async () => {
    engine.on('PurgeQueue', () =>
      refused(
        400,
        'PurgeQueueInProgress',
        'Only one PurgeQueue operation on orders is allowed every 60 seconds.',
        'AWS.SimpleQueueService.PurgeQueueInProgress',
      ),
    );
    const purge = await failure(purgeQueue(endpoint, `${AWS_HOST}/orders`, signal()));
    expect(purge).toEqual({
      kind: 'other',
      operation: 'PurgeQueue',
      code: 'AWS.SimpleQueueService.PurgeQueueInProgress',
      message: 'Only one PurgeQueue operation on orders is allowed every 60 seconds.',
    });
    expect(isNoSuchQueue(purge)).toBe(false);

    engine.on('ReceiveMessage', () => ({ status: 501, body: { __type: 'NotImplemented', message: 'no' } }));
    expect(await failure(receiveMessages(endpoint, `${AWS_HOST}/orders`, 0, signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'ReceiveMessage',
    });

    engine.on('GetQueueUrl', () => refused(403, 'AccessDenied', 'Not allowed'));
    expect(await failure(getQueueUrl(endpoint, 'orders', signal()))).toEqual({
      kind: 'access-denied',
      operation: 'GetQueueUrl',
      message: 'Not allowed',
    });
  });
});

describe('a read of messages', () => {
  it('asks for 10, visibility 0, the wait given and every attribute, and gives each message as it came', async () => {
    const body = '{"orderId":1}';
    engine.on('ReceiveMessage', () =>
      ok({
        Messages: [
          {
            MessageId: 'm-1',
            ReceiptHandle: 'h-1',
            Body: body,
            MD5OfBody: md5(body),
            Attributes: {
              SenderId: 'AIDA',
              SentTimestamp: '1763000000000',
              ApproximateReceiveCount: '2',
              ApproximateFirstReceiveTimestamp: '1763000001000',
              MessageGroupId: 'ga',
              MessageDeduplicationId: 'd-1',
              SequenceNumber: '18800000000000000001',
              DeadLetterQueueSourceArn: `${ARN}:orders`,
            },
            MessageAttributes: {
              kind: { DataType: 'String', StringValue: 'order' },
              n: { DataType: 'Number', StringValue: '7' },
              b: { DataType: 'Binary', BinaryValue: 'aGk=' },
            },
          },
        ],
      }),
    );

    const messages = await receiveMessages(endpoint, `${AWS_HOST}/orders`, 20, signal());

    expect(engine.of('ReceiveMessage')[0]?.body).toEqual({
      QueueUrl: `${AWS_HOST}/orders`,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 0,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ['All'],
      MessageSystemAttributeNames: ['All'],
    });
    expect(messages).toEqual([
      {
        id: 'm-1',
        receiptHandle: 'h-1',
        body,
        sent: new Date(1763000000000),
        firstReceived: new Date(1763000001000),
        receiveCount: 2,
        senderId: 'AIDA',
        groupId: 'ga',
        deduplicationId: 'd-1',
        sequenceNumber: '18800000000000000001',
        deadLetterSourceArn: `${ARN}:orders`,
        attributes: [
          { name: 'kind', type: 'String', value: 'order' },
          { name: 'n', type: 'Number', value: '7' },
          { name: 'b', type: 'Binary', value: 'aGk=' },
        ],
      },
    ]);
  });

  it('gives none for an empty answer, and sends the wait of "Don’t wait"', async () => {
    engine.on('ReceiveMessage', () => ok({}));
    await expect(receiveMessages(endpoint, `${AWS_HOST}/orders`, 0, signal())).resolves.toEqual([]);
    expect(engine.of('ReceiveMessage')[0]?.body['WaitTimeSeconds']).toBe(0);
  });

  it('ends at once when its signal aborts', async () => {
    engine.on('ReceiveMessage', () => ok({}));
    const controller = new AbortController();
    const reason = new Error('left the page');
    controller.abort(reason);
    await expect(receiveMessages(endpoint, `${AWS_HOST}/orders`, 20, controller.signal)).rejects.toBe(reason);
  });
});

describe('a send', () => {
  function answerSend(body: Record<string, unknown>): Answer {
    return ok({
      MessageId: 'sent-1',
      MD5OfMessageBody: md5(String(body['MessageBody'])),
      ...(body['MessageGroupId'] === undefined ? {} : { SequenceNumber: '1880001' }),
    });
  }

  it('to a standard queue sends no field empty and a Binary attribute as the bytes its Base64 decodes to', async () => {
    engine.on('SendMessage', answerSend);

    const sent = await sendMessage(
      endpoint,
      { url: `${AWS_HOST}/orders`, fifo: false },
      {
        body: 'hello',
        delaySeconds: 30,
        groupId: 'ignored',
        deduplicationId: 'ignored',
        attributes: [
          { name: 'kind', type: 'String', value: 'order' },
          { name: 'n', type: 'Number', value: '7' },
          { name: 'b', type: 'Binary', value: 'aGk=' },
        ],
      },
      signal(),
    );

    expect(sent).toEqual({ messageId: 'sent-1' });
    // The JSON protocol writes bytes as Base64: "aGk=" is the two bytes of "hi", sent once, not the text re-encoded.
    expect(engine.of('SendMessage')[0]?.body).toEqual({
      QueueUrl: `${AWS_HOST}/orders`,
      MessageBody: 'hello',
      DelaySeconds: 30,
      MessageAttributes: {
        kind: { DataType: 'String', StringValue: 'order' },
        n: { DataType: 'Number', StringValue: '7' },
        b: { DataType: 'Binary', BinaryValue: 'aGk=' },
      },
    });
  });

  it('sends neither attributes nor a delay it was not given', async () => {
    engine.on('SendMessage', answerSend);
    await sendMessage(endpoint, { url: `${AWS_HOST}/orders`, fifo: false }, { body: 'x', attributes: [] }, signal());
    expect(engine.of('SendMessage')[0]?.body).toEqual({ QueueUrl: `${AWS_HOST}/orders`, MessageBody: 'x' });
  });

  it('to a FIFO queue sends group and deduplication ids, no delay, and gives the sequence number', async () => {
    engine.on('SendMessage', answerSend);

    const sent = await sendMessage(
      endpoint,
      { url: `${AWS_HOST}/jobs.fifo`, fifo: true },
      { body: 'a1', delaySeconds: 0, groupId: 'g', deduplicationId: 'd', attributes: [] },
      signal(),
    );
    await sendMessage(
      endpoint,
      { url: `${AWS_HOST}/jobs.fifo`, fifo: true },
      { body: 'a2', groupId: 'g', deduplicationId: '', attributes: [] },
      signal(),
    );

    expect(sent).toEqual({ messageId: 'sent-1', sequenceNumber: '1880001' });
    const [first, second] = engine.of('SendMessage');
    expect(first?.body).toEqual({
      QueueUrl: `${AWS_HOST}/jobs.fifo`,
      MessageBody: 'a1',
      MessageGroupId: 'g',
      MessageDeduplicationId: 'd',
    });
    expect(second?.body).toEqual({ QueueUrl: `${AWS_HOST}/jobs.fifo`, MessageBody: 'a2', MessageGroupId: 'g' });
  });

  it('refuses a Binary value that is not Base64 before sending', async () => {
    await expect(
      sendMessage(
        endpoint,
        { url: `${AWS_HOST}/orders`, fifo: false },
        { body: 'x', attributes: [{ name: 'b', type: 'Binary', value: 'not base64!' }] },
        signal(),
      ),
    ).rejects.toBeInstanceOf(NotBase64Error);
    expect(engine.sent).toEqual([]);
  });
});

describe('a delete of several', () => {
  it('is one DeleteMessageBatch, its answer split into deleted and failed with id, code and message', async () => {
    engine.on('DeleteMessageBatch', () =>
      ok({
        Successful: [{ Id: '0' }, { Id: '2' }],
        Failed: [
          { Id: '1', SenderFault: true, Code: 'ReceiptHandleIsInvalid', Message: 'The receipt handle is not valid.' },
        ],
      }),
    );

    const result = await deleteMessages(
      endpoint,
      `${AWS_HOST}/orders`,
      [
        { id: 'm-a', receiptHandle: 'h-a' },
        { id: 'm-b', receiptHandle: 'h-b' },
        { id: 'm-c', receiptHandle: 'h-c' },
      ],
      signal(),
    );

    expect(engine.of('DeleteMessageBatch')).toHaveLength(1);
    expect(engine.of('DeleteMessageBatch')[0]?.body).toEqual({
      QueueUrl: `${AWS_HOST}/orders`,
      Entries: [
        { Id: '0', ReceiptHandle: 'h-a' },
        { Id: '1', ReceiptHandle: 'h-b' },
        { Id: '2', ReceiptHandle: 'h-c' },
      ],
    });
    expect(result).toEqual({
      deleted: ['m-a', 'm-c'],
      failed: [{ id: 'm-b', code: 'ReceiptHandleIsInvalid', message: 'The receipt handle is not valid.' }],
    });
  });
});

describe('a redrive', () => {
  it('without a destination sends the queue’s ARN as source and no destination', async () => {
    engine.on('StartMessageMoveTask', () => ok({ TaskHandle: 'task-1' }));
    await expect(startMessageMoveTask(endpoint, { sourceArn: `${ARN}:orders-dlq` }, signal())).resolves.toBe('task-1');
    expect(engine.of('StartMessageMoveTask')[0]?.body).toEqual({ SourceArn: `${ARN}:orders-dlq` });
  });

  it('with a destination sends its ARN, and the rate when given', async () => {
    engine.on('StartMessageMoveTask', () => ok({ TaskHandle: 'task-2' }));
    await startMessageMoveTask(
      endpoint,
      { sourceArn: `${ARN}:orders-dlq`, destinationArn: `${ARN}:third`, maxPerSecond: 1 },
      signal(),
    );
    expect(engine.of('StartMessageMoveTask')[0]?.body).toEqual({
      SourceArn: `${ARN}:orders-dlq`,
      DestinationArn: `${ARN}:third`,
      MaxNumberOfMessagesPerSecond: 1,
    });
  });

  it('reads a destination’s ARN from its own attribute', async () => {
    engine.on('GetQueueAttributes', () => ok({ Attributes: { QueueArn: `${ARN}:third` } }));
    await expect(getQueueArn(endpoint, `${AWS_HOST}/third`, signal())).resolves.toBe(`${ARN}:third`);
    expect(engine.of('GetQueueAttributes')[0]?.body).toEqual({
      QueueUrl: `${AWS_HOST}/third`,
      AttributeNames: ['QueueArn'],
    });
  });

  it('lists the tasks of the source, at most 10, and cancels one by its handle', async () => {
    engine.on('ListMessageMoveTasks', () =>
      ok({
        Results: [
          {
            TaskHandle: 'task-2',
            Status: 'RUNNING',
            SourceArn: `${ARN}:orders-dlq`,
            DestinationArn: `${ARN}:third`,
            ApproximateNumberOfMessagesMoved: 3,
            ApproximateNumberOfMessagesToMove: 8,
            StartedTimestamp: 1763000000000,
          },
          { Status: 'FAILED', SourceArn: `${ARN}:orders-dlq`, FailureReason: 'gone', StartedTimestamp: 1762999990000 },
        ],
      }),
    );
    engine.on('CancelMessageMoveTask', () => ok({ ApproximateNumberOfMessagesMoved: 4 }));

    const tasks = await listMessageMoveTasks(endpoint, `${ARN}:orders-dlq`, signal());
    const moved = await cancelMessageMoveTask(endpoint, 'task-2', signal());

    expect(engine.of('ListMessageMoveTasks')[0]?.body).toEqual({ SourceArn: `${ARN}:orders-dlq`, MaxResults: 10 });
    expect(tasks).toEqual([
      {
        taskHandle: 'task-2',
        status: 'RUNNING',
        destinationArn: `${ARN}:third`,
        moved: 3,
        toMove: 8,
        started: new Date(1763000000000),
      },
      { status: 'FAILED', failureReason: 'gone', started: new Date(1762999990000) },
    ]);
    expect(engine.of('CancelMessageMoveTask')[0]?.body).toEqual({ TaskHandle: 'task-2' });
    expect(moved).toBe(4);
  });
});

describe('the queue list', () => {
  it('reads ListQueues, then each queue’s attributes and ListDeadLetterSourceQueues, keeping a failed row', async () => {
    engine.on('ListQueues', () =>
      ok({
        QueueUrls: [`${AWS_HOST}/orders`, `${AWS_HOST}/orders-dlq`, `${AWS_HOST}/gone`, `${AWS_HOST}/odd`],
        NextToken: 't2',
      }),
    );
    engine.on('GetQueueAttributes', (body) => {
      const url = String(body['QueueUrl']);
      if (url.endsWith('/gone')) {
        return refused(400, 'QueueDoesNotExist', 'gone', 'AWS.SimpleQueueService.NonExistentQueue');
      }
      if (url.endsWith('/odd')) {
        return refused(400, 'InvalidAddress', 'broken');
      }
      return ok({ Attributes: { ApproximateNumberOfMessages: '3' } });
    });
    engine.on('ListDeadLetterSourceQueues', (body) =>
      ok({ queueUrls: String(body['QueueUrl']).endsWith('/orders-dlq') ? [`${AWS_HOST}/orders`] : [] }),
    );

    const page = await listQueuePage(endpoint, { pageSize: 10, prefix: 'o', token: 't1' }, signal());

    expect(engine.of('ListQueues')[0]?.body).toEqual({ MaxResults: 10, QueueNamePrefix: 'o', NextToken: 't1' });
    expect(engine.of('GetQueueAttributes')).toHaveLength(4);
    expect(engine.of('ListDeadLetterSourceQueues').map((sent) => sent.body)).toEqual(
      expect.arrayContaining([
        { QueueUrl: `${AWS_HOST}/orders` },
        { QueueUrl: `${AWS_HOST}/orders-dlq` },
        { QueueUrl: `${AWS_HOST}/gone` },
        { QueueUrl: `${AWS_HOST}/odd` },
      ]),
    );
    expect(page.nextToken).toBe('t2');
    expect(page.queues).toEqual([
      {
        url: `${AWS_HOST}/orders`,
        name: 'orders',
        details: { kind: 'read', attributes: { ApproximateNumberOfMessages: '3' }, sources: [] },
      },
      {
        url: `${AWS_HOST}/orders-dlq`,
        name: 'orders-dlq',
        details: { kind: 'read', attributes: { ApproximateNumberOfMessages: '3' }, sources: ['orders'] },
      },
      { url: `${AWS_HOST}/gone`, name: 'gone', details: { kind: 'gone' } },
      {
        url: `${AWS_HOST}/odd`,
        name: 'odd',
        details: {
          kind: 'failed',
          failure: { kind: 'other', operation: 'GetQueueAttributes', code: 'InvalidAddress', message: 'broken' },
        },
      },
    ]);
  });

  it('sends no prefix or token it was not given, and rejects when ListQueues fails', async () => {
    engine.on('ListQueues', () => ok({}));
    await expect(listQueuePage(endpoint, { pageSize: 25, prefix: '' }, signal())).resolves.toEqual({ queues: [] });
    expect(engine.of('ListQueues')[0]?.body).toEqual({ MaxResults: 25 });

    engine.on('ListQueues', () => refused(403, 'AccessDenied', 'nope'));
    expect(await failure(listQueuePage(endpoint, { pageSize: 25 }, signal()))).toEqual({
      kind: 'access-denied',
      operation: 'ListQueues',
      message: 'nope',
    });
  });

  it('reads a queue’s page by GetQueueUrl of its name, then its details', async () => {
    engine.on('GetQueueUrl', () => ok({ QueueUrl: `${AWS_HOST}/orders-dlq` }));
    engine.on('GetQueueAttributes', () => ok({ Attributes: { QueueArn: `${ARN}:orders-dlq` } }));
    engine.on('ListDeadLetterSourceQueues', () => ok({ queueUrls: [`${AWS_HOST}/orders`] }));

    await expect(readQueue(endpoint, 'orders-dlq', signal())).resolves.toEqual({
      url: `${AWS_HOST}/orders-dlq`,
      name: 'orders-dlq',
      attributes: { QueueArn: `${ARN}:orders-dlq` },
      sources: ['orders'],
    });
    expect(engine.of('GetQueueUrl')[0]?.body).toEqual({ QueueName: 'orders-dlq' });
  });
});

describe('create a queue (issue 489)', () => {
  const created = (name: string) => () => ok({ QueueUrl: `${AWS_HOST}/${name}` });

  it('standard: CreateQueue with the name and no FifoQueue, ContentBasedDeduplication or RedrivePolicy', async () => {
    engine.on('CreateQueue', created('orders'));

    await expect(
      createQueue(endpoint, { name: 'orders', kind: 'standard', contentBasedDeduplication: true }, signal()),
    ).resolves.toBe(`${AWS_HOST}/orders`);

    expect(engine.of('CreateQueue').map((sent) => sent.body)).toEqual([{ QueueName: 'orders' }]);
  });

  it('FIFO, deduplication off: FifoQueue "true" and ContentBasedDeduplication "false"', async () => {
    engine.on('CreateQueue', created('orders.fifo'));

    await createQueue(endpoint, { name: 'orders.fifo', kind: 'fifo', contentBasedDeduplication: false }, signal());

    expect(engine.of('CreateQueue')[0]?.body).toEqual({
      QueueName: 'orders.fifo',
      Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' },
    });
  });

  it('with a dead-letter queue: RedrivePolicy {"deadLetterTargetArn":"<arn>","maxReceiveCount":"3"}', async () => {
    engine.on('CreateQueue', created('orders'));

    await createQueue(
      endpoint,
      {
        name: 'orders',
        kind: 'standard',
        contentBasedDeduplication: false,
        deadLetter: { arn: `${ARN}:dead`, maxReceiveCount: 3 },
      },
      signal(),
    );

    const attributes = engine.of('CreateQueue')[0]?.body['Attributes'] as Record<string, string>;
    expect(Object.keys(attributes)).toEqual(['RedrivePolicy']);
    expect(attributes['RedrivePolicy']).toBe(`{"deadLetterTargetArn":"${ARN}:dead","maxReceiveCount":"3"}`);
  });

  it('a refusal rejects with its code and message', async () => {
    engine.on('CreateQueue', () =>
      refused(
        400,
        'InvalidParameterValue',
        'Value {...} for parameter RedrivePolicy is invalid. Reason: Dead letter target does not exist.',
      ),
    );
    expect(
      await failure(
        createQueue(endpoint, { name: 'orders', kind: 'standard', contentBasedDeduplication: false }, signal()),
      ),
    ).toEqual({
      kind: 'other',
      operation: 'CreateQueue',
      code: 'InvalidParameterValue',
      message: 'Value {...} for parameter RedrivePolicy is invalid. Reason: Dead letter target does not exist.',
    });
  });

  it('is a name taken: a URL → taken; NonExistentQueue → free; another failure → that failure', async () => {
    engine.on('GetQueueUrl', () => ok({ QueueUrl: `${AWS_HOST}/orders` }));
    await expect(isQueueNameTaken(endpoint, 'orders', signal())).resolves.toBe(true);
    expect(engine.of('GetQueueUrl')[0]?.body).toEqual({ QueueName: 'orders' });

    engine.on('GetQueueUrl', () =>
      refused(
        400,
        'QueueDoesNotExist',
        'The specified queue does not exist.',
        'AWS.SimpleQueueService.NonExistentQueue',
      ),
    );
    await expect(isQueueNameTaken(endpoint, 'orders', signal())).resolves.toBe(false);

    engine.on('GetQueueUrl', () => ({ status: 501, body: { __type: 'NotImplemented', message: 'no' } }));
    expect(await failure(isQueueNameTaken(endpoint, 'orders', signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'GetQueueUrl',
    });
  });
});

describe('delete a queue (issue 490)', () => {
  it('DeleteQueue with the queue’s URL; a refusal rejects with its code and message', async () => {
    await deleteQueue(endpoint, `${AWS_HOST}/orders`, signal());
    expect(engine.of('DeleteQueue').map((sent) => sent.body)).toEqual([{ QueueUrl: `${AWS_HOST}/orders` }]);

    engine.on('DeleteQueue', () =>
      refused(
        400,
        'QueueDoesNotExist',
        'The specified queue does not exist.',
        'AWS.SimpleQueueService.NonExistentQueue',
      ),
    );
    expect(await failure(deleteQueue(endpoint, `${AWS_HOST}/orders`, signal()))).toEqual({
      kind: 'other',
      operation: 'DeleteQueue',
      code: 'AWS.SimpleQueueService.NonExistentQueue',
      message: 'The specified queue does not exist.',
    });
  });
});

describe('the dead-letter choices (issue 489)', () => {
  const urls = ['dead', 'dead.fifo', 'plain', 'jobs.fifo'].map((name) => `${AWS_HOST}/${name}`);

  it('ListQueues with the typed prefix and the page token; only names of the type kept; the next token returned', async () => {
    engine.on('ListQueues', () => ok({ QueueUrls: urls, NextToken: 'next-2' }));

    await expect(
      listDeadLetterChoices(endpoint, { kind: 'fifo', prefix: 'd', token: 'next-1' }, signal()),
    ).resolves.toEqual({
      choices: [
        { name: 'dead.fifo', url: `${AWS_HOST}/dead.fifo` },
        { name: 'jobs.fifo', url: `${AWS_HOST}/jobs.fifo` },
      ],
      nextToken: 'next-2',
    });
    expect(engine.of('ListQueues')[0]?.body).toEqual({ MaxResults: 50, QueueNamePrefix: 'd', NextToken: 'next-1' });

    engine.on('ListQueues', () => ok({ QueueUrls: urls }));
    await expect(listDeadLetterChoices(endpoint, { kind: 'standard', prefix: '' }, signal())).resolves.toEqual({
      choices: [
        { name: 'dead', url: `${AWS_HOST}/dead` },
        { name: 'plain', url: `${AWS_HOST}/plain` },
      ],
    });
    expect(engine.of('ListQueues')[1]?.body).toEqual({ MaxResults: 50 });
  });
});
