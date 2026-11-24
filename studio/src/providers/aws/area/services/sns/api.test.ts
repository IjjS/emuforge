import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  allowDelivery,
  createTopic,
  deleteTopic,
  getSubscriptionSettings,
  getTopic,
  GONE_REASON,
  listFunctionChoices,
  listQueueChoices,
  listSubscriptions,
  listTopicTags,
  listTopics,
  publish,
  readDelivery,
  setSubscriptionSetting,
  setTopicSetting,
  subscribe,
  tagTopic,
  type SubscriptionSetting,
  type TopicSetting,
  unsubscribe,
  untagTopic,
} from './api';
import { DENY_REASON } from './policy';

// The test plays the engine behind the page's `fetch`: its session route, and each request as it leaves the browser,
// answered in the protocol of its service as the emulator answers: SNS's Query protocol (form in, XML out), SQS's
// JSON 1.0 and Lambda's REST JSON.

const TOPIC = 'arn:aws:sns:us-east-1:000000000000:orders';
const QUEUE = 'arn:aws:sqs:us-east-1:000000000000:jobs';
const QUEUE_URL = 'http://sqs.us-east-1.localhost:4566/000000000000/jobs';
const FUNCTION = 'arn:aws:lambda:us-east-1:000000000000:function:printer';
const XMLNS = 'http://sns.amazonaws.com/doc/2010-03-31/';

interface Answer {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

interface Sent {
  service: 'sns' | 'sqs' | 'lambda';
  /** The SNS action, the SQS operation, or the Lambda method and path. */
  operation: string;
  /** SNS: the form; SQS and Lambda: the JSON body; Lambda's query too. */
  params: URLSearchParams;
  json: Record<string, unknown>;
  path: string;
}

type Handler = (sent: Sent) => Answer | 'hold';

class FakeEngine {
  readonly sent: Sent[] = [];
  readonly handlers = new Map<string, Handler>();

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-536' }), { status: 200 });
    }
    const text = await request.text();
    const target = request.headers.get('x-amz-target');
    let sent: Sent;
    if (target !== null) {
      sent = {
        service: 'sqs',
        operation: target.replace(/^AmazonSQS\./, ''),
        params: new URLSearchParams(),
        json: JSON.parse(text || '{}') as Record<string, unknown>,
        path: url.pathname,
      };
    } else if (url.pathname.startsWith('/2015-03-31/')) {
      sent = {
        service: 'lambda',
        operation: `${request.method} ${decodeURIComponent(url.pathname)}`,
        params: url.searchParams,
        json: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown>,
        path: url.pathname,
      };
    } else {
      const params = new URLSearchParams(text);
      sent = { service: 'sns', operation: params.get('Action') ?? '', params, json: {}, path: url.pathname };
    }
    this.sent.push(sent);
    const answer = this.handlers.get(sent.operation)?.(sent) ?? defaultAnswer(sent);
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    return new Response(answer.body, { status: answer.status, headers: answer.headers ?? {} });
  };

  on(operation: string, handler: Handler) {
    this.handlers.set(operation, handler);
  }

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }
}

function defaultAnswer(sent: Sent): Answer {
  if (sent.service === 'sns') {
    return snsOk(sent.operation, '');
  }
  return sent.service === 'sqs' ? sqsOk({}) : lambdaOk({});
}

function snsOk(action: string, result: string): Answer {
  return {
    status: 200,
    body: `<${action}Response xmlns="${XMLNS}"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
    headers: { 'content-type': 'text/xml' },
  };
}

function snsRefused(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<ErrorResponse xmlns="${XMLNS}"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
    headers: { 'content-type': 'text/xml' },
  };
}

function sqsOk(body: unknown): Answer {
  return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/x-amz-json-1.0' } };
}

function sqsRefused(type: string, queryCode: string): Answer {
  return {
    status: 400,
    body: JSON.stringify({ __type: `com.amazonaws.sqs#${type}`, message: 'The specified queue does not exist.' }),
    headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amzn-query-error': `${queryCode};Sender` },
  };
}

function lambdaOk(body: unknown): Answer {
  return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
}

function lambdaNotFound(message = 'The resource you requested does not exist.'): Answer {
  return {
    status: 404,
    body: JSON.stringify({ Type: 'User', Message: message }),
    headers: { 'content-type': 'application/json', 'x-amzn-errortype': 'ResourceNotFoundException' },
  };
}

const notImplemented: Answer = { status: 501, body: '', headers: {} };

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9600;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;

async function failureOf(pending: Promise<unknown>) {
  const error: unknown = await pending.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(RequestError);
  return (error as RequestError).failure;
}

const LAMBDA_POLICY = `GET /2015-03-31/functions/${FUNCTION}/policy`;
const LAMBDA_FUNCTION = `GET /2015-03-31/functions/${FUNCTION}`;
const LAMBDA_ADD = `POST /2015-03-31/functions/${FUNCTION}/policy`;

function queuePolicy(...statements: Record<string, unknown>[]) {
  return JSON.stringify({ Version: '2012-10-17', Statement: statements });
}

const ALLOWING = {
  Sid: 'sns',
  Effect: 'Allow',
  Principal: { Service: 'sns.amazonaws.com' },
  Action: 'sqs:SendMessage',
  Resource: QUEUE,
  Condition: { ArnEquals: { 'aws:SourceArn': TOPIC } },
};

/** A queue `jobs` the emulator holds, with `attributes` answered by `GetQueueAttributes`. */
function holdQueue(attributes: Record<string, string>) {
  engine.on('GetQueueUrl', () => sqsOk({ QueueUrl: QUEUE_URL }));
  engine.on('GetQueueAttributes', () => sqsOk({ Attributes: attributes }));
}

describe('topics', () => {
  it('the topics page: without and with a token, the ARNs in order and the next token', async () => {
    engine.on('ListTopics', () =>
      snsOk(
        'ListTopics',
        `<Topics><member><TopicArn>${TOPIC}</TopicArn></member><member><TopicArn>${TOPIC}-b</TopicArn></member></Topics><NextToken>100</NextToken>`,
      ),
    );
    expect(await listTopics(endpoint, undefined, signal())).toEqual({ arns: [TOPIC, `${TOPIC}-b`], nextToken: '100' });
    expect(engine.of('ListTopics')[0]?.params.has('NextToken')).toBe(false);
    engine.on('ListTopics', () =>
      snsOk('ListTopics', `<Topics><member><TopicArn>${TOPIC}-c</TopicArn></member></Topics>`),
    );
    expect(await listTopics(endpoint, '100', signal())).toEqual({ arns: [`${TOPIC}-c`] });
    expect(engine.of('ListTopics')[1]?.params.get('NextToken')).toBe('100');
  });

  it('a topic: its attributes; NotFound → not found; InvalidParameter → a failure with code and message', async () => {
    const entries = {
      TopicArn: 'arn:aws:sns:us-east-1:000000000000:o.fifo',
      DisplayName: '  Orders  ',
      Policy: ' {\n  "Version": "2012-10-17",\n  "Statement": []\n} ',
      FifoTopic: 'true',
      ContentBasedDeduplication: 'true',
      SubscriptionsConfirmed: '2',
      SubscriptionsPending: '1',
    };
    engine.on('GetTopicAttributes', () =>
      snsOk(
        'GetTopicAttributes',
        `<Attributes>${Object.entries(entries)
          .map(([key, value]) => `<entry><key>${key}</key><value>${value}</value></entry>`)
          .join('')}</Attributes>`,
      ),
    );
    expect(await getTopic(endpoint, entries.TopicArn, signal())).toEqual({
      found: true,
      topic: {
        arn: entries.TopicArn,
        displayName: entries.DisplayName,
        policy: entries.Policy,
        fifo: true,
        contentBasedDeduplication: true,
        confirmed: 2,
        pending: 1,
      },
    });
    expect(engine.of('GetTopicAttributes')[0]?.params.get('TopicArn')).toBe(entries.TopicArn);

    engine.on('GetTopicAttributes', () =>
      snsOk(
        'GetTopicAttributes',
        `<Attributes><entry><key>TopicArn</key><value>${TOPIC}</value></entry><entry><key>DisplayName</key><value></value></entry></Attributes>`,
      ),
    );
    expect(await getTopic(endpoint, TOPIC, signal())).toEqual({
      found: true,
      topic: { arn: TOPIC, fifo: false, contentBasedDeduplication: false },
    });

    engine.on('GetTopicAttributes', () => snsRefused(404, 'NotFound', 'Topic does not exist'));
    expect(await getTopic(endpoint, TOPIC, signal())).toEqual({ found: false });

    const message = 'Invalid parameter: TopicArn Reason: An ARN must have at least 6 elements, not 1';
    engine.on('GetTopicAttributes', () => snsRefused(400, 'InvalidParameter', message));
    expect(await failureOf(getTopic(endpoint, 'nope', signal()))).toEqual({
      kind: 'other',
      operation: 'GetTopicAttributes',
      code: 'InvalidParameter',
      message,
    });
  });

  it("a topic's subscriptions page: protocol, endpoint, ARN, pending, and the token", async () => {
    engine.on('ListSubscriptionsByTopic', () =>
      snsOk(
        'ListSubscriptionsByTopic',
        `<Subscriptions><member><SubscriptionArn>${TOPIC}:1</SubscriptionArn><Owner>000000000000</Owner><Protocol>sqs</Protocol><Endpoint>${QUEUE}</Endpoint><TopicArn>${TOPIC}</TopicArn></member><member><SubscriptionArn>PendingConfirmation</SubscriptionArn><Owner>000000000000</Owner><Protocol>email</Protocol><Endpoint>a@example.com</Endpoint><TopicArn>${TOPIC}</TopicArn></member></Subscriptions><NextToken>100</NextToken>`,
      ),
    );
    expect(await listSubscriptions(endpoint, TOPIC, 'tok', signal())).toEqual({
      subscriptions: [
        { arn: `${TOPIC}:1`, protocol: 'sqs', endpoint: QUEUE, pending: false },
        { arn: 'PendingConfirmation', protocol: 'email', endpoint: 'a@example.com', pending: true },
      ],
      nextToken: '100',
    });
    const sent = engine.of('ListSubscriptionsByTopic')[0];
    expect(sent?.params.get('TopicArn')).toBe(TOPIC);
    expect(sent?.params.get('NextToken')).toBe('tok');
  });

  it('create a topic: standard with and without a display name, FIFO with its deduplication; the ARN', async () => {
    engine.on('CreateTopic', () => snsOk('CreateTopic', `<TopicArn>${TOPIC}</TopicArn>`));
    const attributesOf = (index: number) => {
      const params = engine.of('CreateTopic')[index]?.params ?? new URLSearchParams();
      const attributes: Record<string, string> = {};
      for (let n = 1; params.has(`Attributes.entry.${String(n)}.key`); n += 1) {
        attributes[params.get(`Attributes.entry.${String(n)}.key`) ?? ''] =
          params.get(`Attributes.entry.${String(n)}.value`) ?? '';
      }
      return { name: params.get('Name'), attributes };
    };

    expect(
      await createTopic(
        endpoint,
        { name: 'orders', displayName: 'Orders', fifo: false, contentBasedDeduplication: false },
        signal(),
      ),
    ).toBe(TOPIC);
    expect(attributesOf(0)).toEqual({ name: 'orders', attributes: { DisplayName: 'Orders' } });

    await createTopic(
      endpoint,
      { name: 'plain', displayName: '', fifo: false, contentBasedDeduplication: true },
      signal(),
    );
    expect(attributesOf(1)).toEqual({ name: 'plain', attributes: {} });

    await createTopic(endpoint, { name: 'o.fifo', fifo: true, contentBasedDeduplication: true }, signal());
    expect(attributesOf(2)).toEqual({
      name: 'o.fifo',
      attributes: { FifoTopic: 'true', ContentBasedDeduplication: 'true' },
    });
    await createTopic(endpoint, { name: 'p.fifo', fifo: true, contentBasedDeduplication: false }, signal());
    expect(attributesOf(3).attributes).toEqual({ FifoTopic: 'true', ContentBasedDeduplication: 'false' });
  });

  it("unsubscribe sends the subscription's ARN; delete a topic sends the topic's ARN", async () => {
    await unsubscribe(endpoint, `${TOPIC}:1`, signal());
    expect(engine.of('Unsubscribe')[0]?.params.get('SubscriptionArn')).toBe(`${TOPIC}:1`);
    await deleteTopic(endpoint, TOPIC, signal());
    expect(engine.of('DeleteTopic')[0]?.params.get('TopicArn')).toBe(TOPIC);
  });
});

describe('topic settings', () => {
  const settings: TopicSetting[] = [
    { name: 'DisplayName', value: 'Local orders' },
    { name: 'DisplayName', value: '' },
    { name: 'Policy', value: ' {\n  "Statement": []\n} ' },
  ];

  it.each(settings)('sends only $name with the exact value "$value" for the given ARN', async (setting) => {
    await setTopicSetting(endpoint, TOPIC, setting, signal());
    expect(engine.of('SetTopicAttributes')).toHaveLength(1);
    expect(Object.fromEntries(engine.of('SetTopicAttributes')[0]?.params ?? [])).toEqual({
      Action: 'SetTopicAttributes',
      Version: '2010-03-31',
      TopicArn: TOPIC,
      AttributeName: setting.name,
      AttributeValue: setting.value,
    });
  });

  it('keeps the code and reason when a policy write is refused', async () => {
    const message = 'Invalid parameter: Policy Error: null';
    engine.on('SetTopicAttributes', () => snsRefused(400, 'InvalidParameter', message));
    expect(await failureOf(setTopicSetting(endpoint, TOPIC, { name: 'Policy', value: 'invalid' }, signal()))).toEqual({
      kind: 'other',
      operation: 'SetTopicAttributes',
      code: 'InvalidParameter',
      message,
    });
  });

  it('reads an empty tag response as an empty list', async () => {
    engine.on('ListTagsForResource', () => snsOk('ListTagsForResource', '<Tags/>'));
    expect(await listTopicTags(endpoint, TOPIC, signal())).toEqual([]);
    expect(engine.of('ListTagsForResource')[0]?.params.get('ResourceArn')).toBe(TOPIC);
  });

  it('preserves the keys and values of all returned tags', async () => {
    engine.on('ListTagsForResource', () =>
      snsOk(
        'ListTagsForResource',
        '<Tags><member><Key> color </Key><Value> blue </Value></member><member><Key>keep</Key><Value/></member></Tags>',
      ),
    );
    expect(await listTopicTags(endpoint, TOPIC, signal())).toEqual([
      { key: ' color ', value: ' blue ' },
      { key: 'keep', value: '' },
    ]);
  });

  it('saves one exact tag key and value on the given ARN', async () => {
    await tagTopic(endpoint, TOPIC, { key: ' color ', value: ' blue ' }, signal());
    expect(engine.of('TagResource')).toHaveLength(1);
    expect(Object.fromEntries(engine.of('TagResource')[0]?.params ?? [])).toEqual({
      Action: 'TagResource',
      Version: '2010-03-31',
      ResourceArn: TOPIC,
      'Tags.member.1.Key': ' color ',
      'Tags.member.1.Value': ' blue ',
    });
  });

  it('removes only the selected key on the given ARN', async () => {
    await untagTopic(endpoint, TOPIC, ' color ', signal());
    expect(engine.of('UntagResource')).toHaveLength(1);
    expect(Object.fromEntries(engine.of('UntagResource')[0]?.params ?? [])).toEqual({
      Action: 'UntagResource',
      Version: '2010-03-31',
      ResourceArn: TOPIC,
      'TagKeys.member.1': ' color ',
    });
  });
});

describe('the choices of S4', () => {
  it('queues: MaxResults 50, the prefix when not empty, the token; names, URLs and the next token', async () => {
    engine.on('ListQueues', () =>
      sqsOk({ QueueUrls: [QUEUE_URL, 'http://sqs.us-east-1.localhost:4566/000000000000/jobs-2'], NextToken: 'n2' }),
    );
    expect(await listQueueChoices(endpoint, { prefix: 'jo', token: 'n1' }, signal())).toEqual({
      choices: [
        { name: 'jobs', url: QUEUE_URL },
        { name: 'jobs-2', url: 'http://sqs.us-east-1.localhost:4566/000000000000/jobs-2' },
      ],
      nextToken: 'n2',
    });
    expect(engine.of('ListQueues')[0]?.json).toEqual({ MaxResults: 50, QueueNamePrefix: 'jo', NextToken: 'n1' });
    engine.on('ListQueues', () => sqsOk({ QueueUrls: [] }));
    expect(await listQueueChoices(endpoint, { prefix: '' }, signal())).toEqual({ choices: [] });
    expect(engine.of('ListQueues')[1]?.json).toEqual({ MaxResults: 50 });
  });

  it('functions: MaxItems 50 and the marker; names, ARNs and the next marker', async () => {
    engine.on('GET /2015-03-31/functions', () =>
      lambdaOk({ Functions: [{ FunctionName: 'printer', FunctionArn: FUNCTION }], NextMarker: 'm2' }),
    );
    expect(await listFunctionChoices(endpoint, 'm1', signal())).toEqual({
      choices: [{ name: 'printer', arn: FUNCTION }],
      nextMarker: 'm2',
    });
    const sent = engine.of('GET /2015-03-31/functions')[0];
    expect(sent?.params.get('MaxItems')).toBe('50');
    expect(sent?.params.get('Marker')).toBe('m1');
    engine.on('GET /2015-03-31/functions', () => lambdaOk({ Functions: [] }));
    expect(await listFunctionChoices(endpoint, undefined, signal())).toEqual({ choices: [] });
    expect(engine.of('GET /2015-03-31/functions')[1]?.params.has('Marker')).toBe(false);
  });
});

describe('subscribe', () => {
  it('sends TopicArn, Protocol, Endpoint and ReturnSubscriptionArn true', async () => {
    engine.on('Subscribe', () => snsOk('Subscribe', `<SubscriptionArn>${TOPIC}:9</SubscriptionArn>`));
    expect(await subscribe(endpoint, { topicArn: TOPIC, protocol: 'sqs', endpoint: QUEUE }, signal())).toBe(
      `${TOPIC}:9`,
    );
    const params = engine.of('Subscribe')[0]?.params;
    expect(params?.get('TopicArn')).toBe(TOPIC);
    expect(params?.get('Protocol')).toBe('sqs');
    expect(params?.get('Endpoint')).toBe(QUEUE);
    expect(params?.get('ReturnSubscriptionArn')).toBe('true');
  });
});

describe('subscription settings', () => {
  const arn = `${TOPIC}:9`;
  const operation = 'GetSubscriptionAttributes';

  it('requests the subscription ARN, preserving the supplied settings and any omissions', async () => {
    const policy = '{ "color": ["red"] }';
    engine.on(operation, () =>
      snsOk(
        operation,
        `<Attributes><entry><key>FilterPolicy</key><value>${policy}</value></entry><entry><key>FilterPolicyScope</key><value>MessageBody</value></entry><entry><key>RawMessageDelivery</key><value>true</value></entry></Attributes>`,
      ),
    );
    expect(await getSubscriptionSettings(endpoint, arn, signal())).toEqual({
      FilterPolicy: policy,
      FilterPolicyScope: 'MessageBody',
      RawMessageDelivery: 'true',
    });
    expect(engine.of(operation)[0]?.params.get('SubscriptionArn')).toBe(arn);
    engine.on(operation, () =>
      snsOk(operation, '<Attributes><entry><key>RawMessageDelivery</key><value>false</value></entry></Attributes>'),
    );
    expect(await getSubscriptionSettings(endpoint, arn, signal())).toEqual({ RawMessageDelivery: 'false' });
    engine.on(operation, () => snsOk(operation, ''));
    expect(await getSubscriptionSettings(endpoint, arn, signal())).toEqual({});
  });

  const settings: SubscriptionSetting[] = [
    { name: 'FilterPolicy', value: '{ "color": ["blue"] }' },
    { name: 'FilterPolicy', value: '' },
    { name: 'FilterPolicyScope', value: 'MessageBody' },
    { name: 'FilterPolicyScope', value: 'MessageAttributes' },
    { name: 'RawMessageDelivery', value: 'true' },
    { name: 'RawMessageDelivery', value: 'false' },
  ];

  it.each(settings)('sends only $name with the exact value "$value" for the given ARN', async (setting) => {
    await setSubscriptionSetting(endpoint, arn, setting, signal());
    expect(engine.of('SetSubscriptionAttributes')).toHaveLength(1);
    expect(Object.fromEntries(engine.of('SetSubscriptionAttributes')[0]?.params ?? [])).toEqual({
      Action: 'SetSubscriptionAttributes',
      Version: '2010-03-31',
      SubscriptionArn: arn,
      AttributeName: setting.name,
      AttributeValue: setting.value,
    });
  });
});

describe('the delivery of a queue', () => {
  const target = { topicArn: TOPIC, protocol: 'sqs' as const, endpoint: QUEUE };

  it('an endpoint that is no SQS ARN → queue not found, no call', async () => {
    expect(await readDelivery(endpoint, { ...target, endpoint: QUEUE_URL }, signal())).toEqual({
      kind: 'queue-not-found',
    });
    expect(engine.sent).toEqual([]);
  });

  it('GetQueueUrl answering that the queue does not exist, by either code → queue not found', async () => {
    engine.on('GetQueueUrl', () => sqsRefused('QueueDoesNotExist', 'AWS.SimpleQueueService.NonExistentQueue'));
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'queue-not-found' });
    expect(engine.of('GetQueueUrl')[0]?.json).toEqual({ QueueName: 'jobs' });
    engine.on('GetQueueUrl', () => ({
      status: 400,
      body: JSON.stringify({ __type: 'com.amazonaws.sqs#QueueDoesNotExist', message: 'gone' }),
      headers: { 'content-type': 'application/x-amz-json-1.0' },
    }));
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'queue-not-found' });
  });

  it('a QueueArn other than the endpoint → queue not found', async () => {
    holdQueue({ QueueArn: 'arn:aws:sqs:us-east-1:111111111111:jobs', Policy: queuePolicy(ALLOWING) });
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'queue-not-found' });
  });

  it('a policy → what policy.ts reads of it; no Policy attribute → no permission', async () => {
    holdQueue({ QueueArn: QUEUE, Policy: queuePolicy(ALLOWING) });
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'allowed' });
    expect(engine.of('GetQueueAttributes')[0]?.json).toEqual({
      QueueUrl: QUEUE_URL,
      AttributeNames: ['QueueArn', 'Policy'],
    });
    holdQueue({ QueueArn: QUEUE, Policy: queuePolicy(ALLOWING, { ...ALLOWING, Effect: 'Deny' }) });
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'unknown', reason: DENY_REASON });
    holdQueue({ QueueArn: QUEUE });
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'none' });
  });
});

describe('the delivery of a function', () => {
  const target = { topicArn: TOPIC, protocol: 'lambda' as const, endpoint: FUNCTION };
  const permission = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'p',
        Effect: 'Allow',
        Principal: { Service: 'sns.amazonaws.com' },
        Action: 'lambda:InvokeFunction',
        Resource: FUNCTION,
        Condition: { ArnLike: { 'AWS:SourceArn': TOPIC } },
      },
    ],
  });

  it('an endpoint of another Region or account than the topic → function not found, no call', async () => {
    for (const other of [
      'arn:aws:lambda:eu-west-1:000000000000:function:printer',
      'arn:aws:lambda:us-east-1:111111111111:function:printer',
    ]) {
      expect(await readDelivery(endpoint, { ...target, endpoint: other }, signal())).toEqual({
        kind: 'function-not-found',
      });
    }
    expect(engine.sent).toEqual([]);
  });

  it('GetPolicy not found and GetFunction not found → function not found; GetFunction answering → no permission', async () => {
    engine.on(LAMBDA_POLICY, () => lambdaNotFound());
    engine.on(LAMBDA_FUNCTION, () => lambdaNotFound(`Function not found: ${FUNCTION}`));
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'function-not-found' });
    engine.on(LAMBDA_FUNCTION, () => lambdaOk({ Configuration: { FunctionName: 'printer', FunctionArn: FUNCTION } }));
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'none' });
  });

  it('a policy → what policy.ts reads of it', async () => {
    engine.on(LAMBDA_POLICY, () => lambdaOk({ Policy: permission, RevisionId: 'r' }));
    expect(await readDelivery(endpoint, target, signal())).toEqual({ kind: 'allowed' });
    expect(engine.of(LAMBDA_FUNCTION)).toEqual([]);
  });
});

describe('allow delivery, a queue', () => {
  const target = { topicArn: TOPIC, protocol: 'sqs' as const, endpoint: QUEUE };

  it('no permission → SetQueueAttributes with the policy plus the statement, "added"', async () => {
    const own = { Sid: 'own', Effect: 'Allow', Principal: { AWS: '000000000000' }, Action: 'sqs:*', Resource: QUEUE };
    holdQueue({ QueueArn: QUEUE, Policy: queuePolicy(own) });
    expect(await allowDelivery(endpoint, target, signal())).toEqual({ outcome: 'added' });
    const set = engine.of('SetQueueAttributes')[0]?.json as { QueueUrl: string; Attributes: { Policy: string } };
    expect(set.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(set.Attributes.Policy)).toEqual({
      Version: '2012-10-17',
      Statement: [
        own,
        {
          Sid: 'EmuForgeSnsorders',
          Effect: 'Allow',
          Principal: { Service: 'sns.amazonaws.com' },
          Action: 'sqs:SendMessage',
          Resource: QUEUE,
          Condition: { ArnEquals: { 'aws:SourceArn': TOPIC } },
        },
      ],
    });
  });

  it('with the URL known (S4) → no GetQueueUrl', async () => {
    holdQueue({ QueueArn: QUEUE });
    expect(await allowDelivery(endpoint, { ...target, queueUrl: QUEUE_URL }, signal())).toEqual({ outcome: 'added' });
    expect(engine.of('GetQueueUrl')).toEqual([]);
    expect(engine.of('SetQueueAttributes')).toHaveLength(1);
  });

  it('allowed → nothing sent, "already allowed"; cannot tell → nothing sent, "not changed" with the reason', async () => {
    holdQueue({ QueueArn: QUEUE, Policy: queuePolicy(ALLOWING) });
    expect(await allowDelivery(endpoint, target, signal())).toEqual({ outcome: 'already-allowed' });
    holdQueue({ QueueArn: QUEUE, Policy: queuePolicy({ ...ALLOWING, Effect: 'Deny' }) });
    expect(await allowDelivery(endpoint, target, signal())).toEqual({ outcome: 'not-changed', reason: DENY_REASON });
    expect(engine.of('SetQueueAttributes')).toEqual([]);
  });

  it('a queue the emulator no longer holds → nothing sent, "not changed"', async () => {
    engine.on('GetQueueUrl', () => sqsRefused('QueueDoesNotExist', 'AWS.SimpleQueueService.NonExistentQueue'));
    expect(await allowDelivery(endpoint, target, signal())).toEqual({ outcome: 'not-changed', reason: GONE_REASON });
    expect(engine.of('SetQueueAttributes')).toEqual([]);
  });
});

describe('allow delivery, a function', () => {
  const target = {
    topicArn: 'arn:aws:sns:us-east-1:000000000000:orders.fifo',
    protocol: 'lambda' as const,
    endpoint: FUNCTION,
  };

  it('no policy → AddPermission with the function, the action, the service, the topic and the statement id, "added"', async () => {
    engine.on(LAMBDA_POLICY, () => lambdaNotFound());
    engine.on(LAMBDA_ADD, () => lambdaOk({ Statement: '{}' }));
    expect(await allowDelivery(endpoint, target, signal())).toEqual({ outcome: 'added' });
    expect(engine.of(LAMBDA_ADD)[0]?.json).toEqual({
      StatementId: 'emuforge-sns-orders-fifo',
      Action: 'lambda:InvokeFunction',
      Principal: 'sns.amazonaws.com',
      SourceArn: target.topicArn,
    });
  });

  it("a policy that reads no permission → the statement id numbered against that policy's Sids", async () => {
    const other = JSON.stringify({
      Statement: [
        {
          Sid: 'emuforge-sns-orders-fifo',
          Effect: 'Allow',
          Principal: { Service: 'sns.amazonaws.com' },
          Action: 'lambda:InvokeFunction',
          Resource: FUNCTION,
          Condition: { ArnLike: { 'AWS:SourceArn': 'arn:aws:sns:us-east-1:000000000000:orders-fifo' } },
        },
      ],
    });
    engine.on(LAMBDA_POLICY, () => lambdaOk({ Policy: other }));
    expect(await allowDelivery(endpoint, target, signal())).toEqual({ outcome: 'added' });
    expect(engine.of(LAMBDA_ADD)[0]?.json['StatementId']).toBe('emuforge-sns-orders-fifo-2');
  });

  it('allowed → nothing sent; cannot tell → nothing sent, "not changed" with the reason', async () => {
    const allowing = JSON.stringify({
      Statement: {
        Effect: 'Allow',
        Principal: { Service: 'sns.amazonaws.com' },
        Action: 'lambda:InvokeFunction',
        Resource: FUNCTION,
      },
    });
    engine.on(LAMBDA_POLICY, () => lambdaOk({ Policy: allowing }));
    expect(await allowDelivery(endpoint, target, signal())).toEqual({ outcome: 'already-allowed' });
    engine.on(LAMBDA_POLICY, () => lambdaOk({ Policy: 'not json' }));
    expect(await allowDelivery(endpoint, target, signal())).toEqual({
      outcome: 'not-changed',
      reason: 'Studio cannot read it',
    });
    expect(engine.of(LAMBDA_ADD)).toEqual([]);
  });
});

describe('publish', () => {
  it('a message alone → TopicArn and Message only; the message ID', async () => {
    engine.on('Publish', () => snsOk('Publish', '<MessageId>m-1</MessageId>'));
    expect(
      await publish(endpoint, { topicArn: TOPIC, message: 'hello', subject: '', attributes: [] }, signal()),
    ).toEqual({
      messageId: 'm-1',
    });
    const params = engine.of('Publish')[0]?.params;
    expect([...(params?.keys() ?? [])].sort()).toEqual(['Action', 'Message', 'TopicArn', 'Version']);
  });

  it('a subject, attributes, a group ID and a deduplication ID → each sent; the sequence number', async () => {
    engine.on('Publish', () => snsOk('Publish', '<MessageId>m-2</MessageId><SequenceNumber>10000</SequenceNumber>'));
    expect(
      await publish(
        endpoint,
        {
          topicArn: TOPIC,
          message: 'hello',
          subject: 'Hi',
          attributes: [
            { name: 'color', type: 'String', value: 'red' },
            { name: 'price', type: 'Number', value: '12.5' },
          ],
          groupId: 'g1',
          deduplicationId: 'd1',
        },
        signal(),
      ),
    ).toEqual({ messageId: 'm-2', sequenceNumber: '10000' });
    const params = engine.of('Publish')[0]?.params ?? new URLSearchParams();
    expect(params.get('Subject')).toBe('Hi');
    expect(params.get('MessageGroupId')).toBe('g1');
    expect(params.get('MessageDeduplicationId')).toBe('d1');
    const attributes: Record<string, [string | null, string | null]> = {};
    for (let n = 1; params.has(`MessageAttributes.entry.${String(n)}.Name`); n += 1) {
      const prefix = `MessageAttributes.entry.${String(n)}`;
      attributes[params.get(`${prefix}.Name`) ?? ''] = [
        params.get(`${prefix}.Value.DataType`),
        params.get(`${prefix}.Value.StringValue`),
      ];
    }
    expect(attributes).toEqual({ color: ['String', 'red'], price: ['Number', '12.5'] });
  });
});

describe('every call', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['ListTopics', () => listTopics(endpoint, undefined, signal())],
    ['GetTopicAttributes', () => getTopic(endpoint, TOPIC, signal())],
    ['ListTagsForResource', () => listTopicTags(endpoint, TOPIC, signal())],
    ['TagResource', () => tagTopic(endpoint, TOPIC, { key: 'color', value: 'blue' }, signal())],
    ['UntagResource', () => untagTopic(endpoint, TOPIC, 'color', signal())],
    ['ListSubscriptionsByTopic', () => listSubscriptions(endpoint, TOPIC, undefined, signal())],
    [
      'CreateTopic',
      () => createTopic(endpoint, { name: 'x', fifo: false, contentBasedDeduplication: false }, signal()),
    ],
    ['DeleteTopic', () => deleteTopic(endpoint, TOPIC, signal())],
    ['Subscribe', () => subscribe(endpoint, { topicArn: TOPIC, protocol: 'sqs', endpoint: QUEUE }, signal())],
    ['Unsubscribe', () => unsubscribe(endpoint, `${TOPIC}:1`, signal())],
    ['Publish', () => publish(endpoint, { topicArn: TOPIC, message: 'x' }, signal())],
    ['ListQueues', () => listQueueChoices(endpoint, {}, signal())],
    ['ListFunctions', () => listFunctionChoices(endpoint, undefined, signal())],
    ['GetQueueUrl', () => readDelivery(endpoint, { topicArn: TOPIC, protocol: 'sqs', endpoint: QUEUE }, signal())],
    ['GetPolicy', () => readDelivery(endpoint, { topicArn: TOPIC, protocol: 'lambda', endpoint: FUNCTION }, signal())],
  ];

  for (const [operation, call] of calls) {
    it(`${operation}: a 501 → "not implemented" with the operation's name`, async () => {
      engine.on(operation, () => notImplemented);
      engine.on(LAMBDA_POLICY, () => notImplemented);
      engine.on('GET /2015-03-31/functions', () => notImplemented);
      expect(await failureOf(call())).toEqual({ kind: 'not-implemented', operation });
    });
  }

  it('access denied and the engine not answering are their own kinds', async () => {
    engine.on('ListTopics', () => snsRefused(403, 'AccessDenied', 'not for you'));
    expect(await failureOf(listTopics(endpoint, undefined, signal()))).toEqual({
      kind: 'access-denied',
      operation: 'ListTopics',
      message: 'not for you',
    });
  });

  it('an aborted signal ends the request', async () => {
    engine.on('ListTopics', () => 'hold');
    const controller = new AbortController();
    const pending = listTopics(endpoint, undefined, controller.signal);
    await vi.waitFor(() => {
      expect(engine.of('ListTopics')).toHaveLength(1);
    });
    const reason = new Error('left the page');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
