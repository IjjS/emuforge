import { CopyObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  copyObject,
  createBucket,
  deleteBucket,
  deleteObjects,
  enableBucketVersioning,
  findBucket,
  getBucketEncryption,
  getBucketNotificationConfiguration,
  getBucketTagging,
  getBucketVersioning,
  getBucketWebsite,
  headObject,
  isBucketEmpty,
  listBuckets,
  listObjects,
  listObjectVersions,
  NO_SUCH_BUCKET,
  NOT_FOUND,
  putBucketEncryption,
  putBucketNotificationConfiguration,
  putPublicAccessBlock,
} from './api';
import {
  filterValue,
  notificationDraft,
  notificationRules,
  OBJECT_PUT,
  replaceNotification,
  sameNotifications,
} from './notifications';
// @ts-expect-error -- the S3 folder keeps no failure of its own (issue 445, R8): the shared module's is the one.
import type { ReadFailure as GoneReadFailure, S3ReadError as GoneS3ReadError } from './api';

// The test plays the engine behind the page's `fetch`: its session route, and every AWS request as it leaves the
// browser, with the URL the SDK built.

interface Answer {
  status: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
}

type EngineAnswer = Answer | 'network-error' | 'hold';

const TOKEN = 'emuforge-test-token-56';

class FakeEngine {
  /** The URL of every AWS request, as it was sent. */
  readonly awsRequests: string[] = [];
  /** Every AWS request, as it was sent, its body unread. */
  readonly sent: Request[] = [];
  /**
   * The signal of every AWS request the fetch received. A clone's signal is not read for an abort: Node's
   * `Request.clone()` holds the controller of the clone's signal only weakly, so after a garbage collection the
   * clone's signal never aborts (issue 463).
   */
  readonly signals: AbortSignal[] = [];
  session: () => EngineAnswer = () => ({ status: 200, body: JSON.stringify({ token: TOKEN }) });
  aws: () => EngineAnswer = () => bucketList([]);

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    let answer: EngineAnswer;
    if (url.pathname === '/__emuforge/session') {
      answer = this.session();
    } else {
      this.awsRequests.push(request.url);
      this.sent.push(request.clone());
      this.signals.push(request.signal);
      answer = this.aws();
    }
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    // A 204 answer has no body at all.
    return new Response(answer.status === 204 || request.method === 'HEAD' ? null : (answer.body ?? ''), {
      status: answer.status,
      ...(answer.headers === undefined ? {} : { headers: answer.headers }),
      ...(answer.statusText === undefined ? {} : { statusText: answer.statusText }),
    });
  };
}

interface XmlBucket {
  name: string;
  region?: string;
  date?: string;
  arn?: string;
}

function bucketList(buckets: XmlBucket[], token?: string): Answer {
  const items = buckets
    .map(
      ({ name, region, date, arn }) =>
        `<Bucket><Name>${name}</Name>${date === undefined ? '' : `<CreationDate>${date}</CreationDate>`}${
          region === undefined ? '' : `<BucketRegion>${region}</BucketRegion>`
        }${arn === undefined ? '' : `<BucketArn>${arn}</BucketArn>`}</Bucket>`,
    )
    .join('');
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>${items}</Buckets>${
      token === undefined ? '' : `<ContinuationToken>${token}</ContinuationToken>`
    }</ListAllMyBucketsResult>`,
  };
}

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
  };
}

/** The raw query of a sent URL, each value as it was written, not decoded. */
function rawQuery(url: string): Map<string, string> {
  const query = url.split('?')[1] ?? '';
  return new Map(
    query
      .split('&')
      .filter((pair) => pair !== '')
      .map((pair) => {
        const [name = '', value = ''] = pair.split('=');
        return [name, value];
      }),
  );
}

async function failure(promise: Promise<unknown>): Promise<RequestFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RequestError);
    return (error as RequestError).failure;
  }
  throw new Error('the read resolved');
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 8600;
let engine: FakeEngine;
let endpoint: string;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function list(request: Parameters<typeof listBuckets>[1], signal = new AbortController().signal) {
  return listBuckets(endpoint, request, signal);
}

describe('the request', () => {
  it('asks the engine for ListBuckets with max-buckets=25 and nothing else for page size 25 alone', async () => {
    await list({ pageSize: 25 });

    expect(engine.awsRequests).toHaveLength(1);
    const [sent = ''] = engine.awsRequests;
    expect(sent.startsWith(`${endpoint}/?`)).toBe(true);
    const query = rawQuery(sent);
    expect(query.get('x-id')).toBe('ListBuckets');
    expect(query.get('max-buckets')).toBe('25');
    expect(query.has('prefix')).toBe(false);
    expect(query.has('continuation-token')).toBe(false);
  });

  it('carries the prefix and the token, each percent-encoded once', async () => {
    await list({ pageSize: 10, prefix: 'a b%/', token: 'x/+=%' });

    const query = rawQuery(engine.awsRequests[0] ?? '');
    expect(query.get('prefix')).toBe('a%20b%25%2F');
    expect(query.get('continuation-token')).toBe('x%2F%2B%3D%25');
    expect(decodeURIComponent(query.get('prefix') ?? '')).toBe('a b%/');
    expect(decodeURIComponent(query.get('continuation-token') ?? '')).toBe('x/+=%');
    expect(query.get('max-buckets')).toBe('10');
  });
});

describe('the answer', () => {
  it('gives two buckets with name, Region code, creation time and ARN, in the answer’s order, and the token', async () => {
    engine.aws = () =>
      bucketList(
        [
          { name: 'zeta', region: 'ap-northeast-2', date: '2026-10-30T14:18:34.000Z', arn: 'arn:aws:s3:::zeta' },
          { name: 'alpha', region: 'us-east-1', date: '2026-10-31T01:02:03.000Z', arn: 'arn:aws:s3:::alpha' },
        ],
        'next-token-1',
      );

    const page = await list({ pageSize: 2 });

    expect(page).toEqual({
      buckets: [
        {
          name: 'zeta',
          region: 'ap-northeast-2',
          creationDate: new Date('2026-10-30T14:18:34.000Z'),
          arn: 'arn:aws:s3:::zeta',
        },
        {
          name: 'alpha',
          region: 'us-east-1',
          creationDate: new Date('2026-10-31T01:02:03.000Z'),
          arn: 'arn:aws:s3:::alpha',
        },
      ],
      nextToken: 'next-token-1',
    });
  });

  it('leaves out a missing Region, creation date or ARN and keeps the other buckets unchanged', async () => {
    engine.aws = () =>
      bucketList([
        { name: 'no-region', date: '2026-10-30T14:18:34.000Z', arn: 'arn:aws:s3:::no-region' },
        { name: 'no-date', region: 'us-east-1', arn: 'arn:aws:s3:::no-date' },
        { name: 'no-arn', region: 'us-east-1', date: '2026-10-30T14:18:34.000Z' },
        { name: 'whole', region: 'us-east-1', date: '2026-10-30T14:18:34.000Z', arn: 'arn:aws:s3:::whole' },
      ]);

    const { buckets } = await list({ pageSize: 25 });

    expect(buckets).toHaveLength(4);
    expect(buckets[0]).toEqual({
      name: 'no-region',
      creationDate: new Date('2026-10-30T14:18:34.000Z'),
      arn: 'arn:aws:s3:::no-region',
    });
    expect(buckets[0]).not.toHaveProperty('region');
    expect(buckets[1]).toEqual({ name: 'no-date', region: 'us-east-1', arn: 'arn:aws:s3:::no-date' });
    expect(buckets[1]).not.toHaveProperty('creationDate');
    expect(buckets[2]).toEqual({
      name: 'no-arn',
      region: 'us-east-1',
      creationDate: new Date('2026-10-30T14:18:34.000Z'),
    });
    expect(buckets[2]).not.toHaveProperty('arn');
    expect(buckets[3]).toEqual({
      name: 'whole',
      region: 'us-east-1',
      creationDate: new Date('2026-10-30T14:18:34.000Z'),
      arn: 'arn:aws:s3:::whole',
    });
  });

  it('gives an empty page without a token for an answer without buckets', async () => {
    engine.aws = () => bucketList([]);

    const page = await list({ pageSize: 25 });

    expect(page).toEqual({ buckets: [] });
    expect(page).not.toHaveProperty('nextToken');
  });
});

describe('a failed read', () => {
  it('rejects with a RequestError of the shared module, and the S3 folder exports no failure of its own', async () => {
    engine.aws = () => errorAnswer(400, 'InvalidArgument', 'The continuation token provided is incorrect');

    const error = await list({ pageSize: 25 }).then(
      () => undefined,
      (rejection: unknown) => rejection,
    );

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).name).toBe('RequestError');
    // Each is `any` only while its import is the type error the directive above it expects.
    expectTypeOf<GoneReadFailure>().toBeAny();
    expectTypeOf<GoneS3ReadError>().toBeAny();
  });

  it('is "not implemented", naming ListBuckets, when the engine answers 501', async () => {
    engine.aws = () =>
      errorAnswer(501, 'NotImplemented', 'operation ListBuckets is scaffolded but not implemented in this emulator');

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'not-implemented', operation: 'ListBuckets' });
  });

  it('is "access denied" with ListBuckets and the message returned for AccessDenied', async () => {
    engine.aws = () => errorAnswer(403, 'AccessDenied', 'User is not allowed to list buckets');

    expect(await failure(list({ pageSize: 25 }))).toEqual({
      kind: 'access-denied',
      operation: 'ListBuckets',
      message: 'User is not allowed to list buckets',
    });
  });

  it.each([
    [503, 'EmulatorUnavailable', 'The emulator at https://127.0.0.1:9411 could not be reached: connection refused'],
    [504, 'EmulatorTimeout', 'The emulator at https://127.0.0.1:9411 did not answer within 30 seconds'],
  ])(
    'is "emulator did not answer" with ListBuckets and the engine’s message for %i %s',
    async (status, code, message) => {
      engine.aws = () => errorAnswer(status, code, message);

      expect(await failure(list({ pageSize: 25 }))).toEqual({
        kind: 'emulator-did-not-answer',
        operation: 'ListBuckets',
        message,
      });
    },
  );

  it('is "engine did not answer", naming ListBuckets, when the request fails at the network level', async () => {
    engine.aws = () => 'network-error';

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'engine-did-not-answer', operation: 'ListBuckets' });
  });

  it('is "engine did not answer", naming ListBuckets, when the session request fails at the network level', async () => {
    engine.session = () => 'network-error';

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'engine-did-not-answer', operation: 'ListBuckets' });
    expect(engine.awsRequests).toHaveLength(0);
  });

  it('gives ListBuckets and any other error answer’s code and message', async () => {
    engine.aws = () => errorAnswer(400, 'InvalidArgument', 'The continuation token provided is incorrect');

    expect(await failure(list({ pageSize: 25, token: 'not-issued' }))).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: 'InvalidArgument',
      message: 'The continuation token provided is incorrect',
    });
  });

  it('gives ListBuckets and the answer’s status line in the code’s place for an error answer without a code', async () => {
    engine.aws = () => ({ status: 418, statusText: "I'm a teapot", body: '' });

    expect(await failure(list({ pageSize: 25 }))).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: "HTTP 418 I'm a teapot",
    });
  });

  it('gives ListBuckets and the status alone in the code’s place when the answer has neither a code nor a reason', async () => {
    engine.aws = () => ({ status: 409, body: 'not xml' });

    expect(await failure(list({ pageSize: 25 }))).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: 'HTTP 409',
    });
  });
});

describe('an aborted read', () => {
  it('rejects with the signal’s reason, and nothing else, once the signal aborts', async () => {
    engine.aws = () => 'hold';
    const controller = new AbortController();
    const reason = new Error('not wanted any more');

    const read = list({ pageSize: 25 }, controller.signal);
    const settled = read.then(
      (page) => ({ resolved: page as unknown }),
      (error: unknown) => ({ rejected: error }),
    );
    await vi.waitFor(() => {
      expect(engine.awsRequests).toHaveLength(1);
    });
    controller.abort(reason);

    expect(await settled).toEqual({ rejected: reason });
    expect(((await settled) as { rejected: unknown }).rejected).toBe(reason);
  });

  it('rejects with the reason of a signal aborted before the call, and sends nothing', async () => {
    const controller = new AbortController();
    const reason = new Error('aborted before');
    controller.abort(reason);

    await expect(list({ pageSize: 25 }, controller.signal)).rejects.toBe(reason);
    expect(engine.awsRequests).toHaveLength(0);
  });
});

// Issue 256: the calls of a bucket's page, of the create form, of the emptying and of the delete page.

function xml(body: string): Answer {
  return { status: 200, body: `<?xml version="1.0" encoding="UTF-8"?>${body}` };
}

const signal = () => new AbortController().signal;

describe('finding a bucket by its name', () => {
  it('gives the bucket with its Region, ARN and creation date when the first bucket under the prefix is it', async () => {
    engine.aws = () =>
      bucketList([{ name: 'abc', region: 'eu-west-1', date: '2026-11-01T10:00:00.000Z', arn: 'arn:aws:s3:::abc' }]);

    expect(await findBucket(endpoint, 'abc', signal())).toEqual({
      name: 'abc',
      region: 'eu-west-1',
      creationDate: new Date('2026-11-01T10:00:00.000Z'),
      arn: 'arn:aws:s3:::abc',
    });
    const query = rawQuery(engine.awsRequests[0] ?? '');
    expect(query.get('x-id')).toBe('ListBuckets');
    expect(query.get('prefix')).toBe('abc');
    expect(query.get('max-buckets')).toBe('1');
    expect(engine.awsRequests).toHaveLength(1);
  });

  it('is "no such bucket" when the first bucket under the prefix has a longer name, and when there is none', async () => {
    engine.aws = () => bucketList([{ name: 'abc', region: 'us-east-1' }]);
    expect(await findBucket(endpoint, 'ab', signal())).toBe(NO_SUCH_BUCKET);

    engine.aws = () => bucketList([]);
    expect(await findBucket(endpoint, 'ab', signal())).toBe(NO_SUCH_BUCKET);
  });
});

describe('the reads of a bucket’s page', () => {
  it.each([
    ['<VersioningConfiguration/>', 'Disabled'],
    ['<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>', 'Enabled'],
    ['<VersioningConfiguration><Status>Suspended</Status></VersioningConfiguration>', 'Suspended'],
  ])('gives the versioning %s as %j', async (body, status) => {
    engine.aws = () => xml(body);

    expect(await getBucketVersioning(endpoint, 'b', signal())).toEqual({ status });
    expect(new URL(engine.awsRequests[0] ?? '').pathname).toMatch(/^\/b\/?$/);
    expect(rawQuery(engine.awsRequests[0] ?? '').has('versioning')).toBe(true);
  });

  it('gives a set of two tags in the answer’s order, an empty value kept', async () => {
    engine.aws = () =>
      xml(
        '<Tagging><TagSet><Tag><Key>zeta</Key><Value>1</Value></Tag><Tag><Key>alpha</Key><Value></Value></Tag></TagSet></Tagging>',
      );

    expect(await getBucketTagging(endpoint, 'b', signal())).toEqual([
      { key: 'zeta', value: '1' },
      { key: 'alpha', value: '' },
    ]);
  });

  it('gives no tags, not a failure, for "no tag set" and for an empty set', async () => {
    engine.aws = () => errorAnswer(404, 'NoSuchTagSet', 'The TagSet does not exist');
    expect(await getBucketTagging(endpoint, 'b', signal())).toEqual([]);

    engine.aws = () => xml('<Tagging><TagSet></TagSet></Tagging>');
    expect(await getBucketTagging(endpoint, 'b', signal())).toEqual([]);
  });

  it('gives an encryption aws:kms with its key and the bucket key on, and AES256 with no key and the bucket key off', async () => {
    engine.aws = () =>
      xml(
        '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>aws:kms</SSEAlgorithm>' +
          '<KMSMasterKeyID>arn:aws:kms:us-east-1:000000000000:key/k1</KMSMasterKeyID></ApplyServerSideEncryptionByDefault>' +
          '<BucketKeyEnabled>true</BucketKeyEnabled></Rule></ServerSideEncryptionConfiguration>',
      );
    expect(await getBucketEncryption(endpoint, 'b', signal())).toEqual({
      algorithm: 'aws:kms',
      kmsKey: 'arn:aws:kms:us-east-1:000000000000:key/k1',
      bucketKey: 'Enabled',
    });

    engine.aws = () =>
      xml(
        '<ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm>' +
          '</ApplyServerSideEncryptionByDefault><BucketKeyEnabled>false</BucketKeyEnabled></Rule></ServerSideEncryptionConfiguration>',
      );
    const plain = await getBucketEncryption(endpoint, 'b', signal());
    expect(plain).toEqual({ algorithm: 'AES256', bucketKey: 'Disabled' });
    expect(plain).not.toHaveProperty('kmsKey');
  });

  it('reads all rule types and preserves the complete wire payload when editing or deleting a queue or function', async () => {
    const filter = (...rules: [name: string, value: string][]) =>
      `<Filter><S3Key>${rules.map(([name, value]) => `<FilterRule><Name>${name}</Name><Value>${value}</Value></FilterRule>`).join('')}</S3Key></Filter>`;
    const queue = (keyFilter: string) =>
      '<QueueConfiguration><Id>to-queue</Id><Queue>arn:aws:sqs:us-east-1:000000000000:q</Queue>' +
      `<Event>s3:ObjectRemoved:*</Event>${keyFilter}</QueueConfiguration>`;
    const lambda = (keyFilter: string) =>
      '<CloudFunctionConfiguration><Id>to-function</Id><CloudFunction>arn:aws:lambda:us-east-1:000000000000:function:f</CloudFunction>' +
      `<Event>s3:ObjectCreated:*</Event>${keyFilter}</CloudFunctionConfiguration>`;
    const topic =
      '<TopicConfiguration><Id>to-topic</Id><Topic>arn:aws:sns:us-east-1:000000000000:t</Topic>' +
      `<Event>s3:ObjectCreated:Put</Event><Event>s3:ObjectCreated:Post</Event>${filter(['Prefix', 'images/'], ['Suffix', '.jpg'])}</TopicConfiguration>`;
    const configurationXml = (...entries: string[]) =>
      `<NotificationConfiguration>${entries.join('')}<EventBridgeConfiguration/></NotificationConfiguration>`;
    const originalQueue = queue(filter(['Prefix', 'logs/'], ['Suffix', '.txt']));
    const originalLambda = lambda(filter(['Prefix', 'in/'], ['Suffix', '.csv']));
    engine.aws = () => xml(configurationXml(topic, originalQueue, originalLambda));

    const original = await getBucketNotificationConfiguration(endpoint, 'b', signal());
    if (original === NO_SUCH_BUCKET) throw new Error('Missing fixture bucket');
    const rules = notificationRules(original);
    expect(
      rules.map((rule) => ({
        id: rule.data.Id,
        type: rule.type,
        arn: rule.arn,
        events: rule.data.Events,
        prefix: filterValue(rule, 'prefix'),
        suffix: filterValue(rule, 'suffix'),
      })),
    ).toEqual([
      {
        id: 'to-topic',
        type: 'SNS topic',
        arn: 'arn:aws:sns:us-east-1:000000000000:t',
        events: ['s3:ObjectCreated:Put', 's3:ObjectCreated:Post'],
        prefix: 'images/',
        suffix: '.jpg',
      },
      {
        id: 'to-queue',
        type: 'SQS queue',
        arn: 'arn:aws:sqs:us-east-1:000000000000:q',
        events: ['s3:ObjectRemoved:*'],
        prefix: 'logs/',
        suffix: '.txt',
      },
      {
        id: 'to-function',
        type: 'Lambda function',
        arn: 'arn:aws:lambda:us-east-1:000000000000:function:f',
        events: ['s3:ObjectCreated:*'],
        prefix: 'in/',
        suffix: '.csv',
      },
    ]);
    expect(original.EventBridgeConfiguration).toEqual({});

    // The XML field order can differ between the fixture and Smithy. Keep the order of repeated
    // fields such as Event while comparing every element, including empty EventBridgeConfiguration.
    function xmlTree(element: Element): unknown {
      const children = [...element.children].sort((left, right) => left.localName.localeCompare(right.localName));
      return [element.localName, children.length === 0 ? element.textContent : children.map(xmlTree)];
    }
    const parseXml = (body: string) =>
      xmlTree(new DOMParser().parseFromString(body, 'application/xml').documentElement);
    const expected = {
      'SQS queue': {
        edit: configurationXml(topic, queue(filter(['Suffix', '.txt'], ['prefix', 'edited/'])), originalLambda),
        delete: configurationXml(topic, originalLambda),
      },
      'Lambda function': {
        edit: configurationXml(topic, originalQueue, lambda(filter(['Suffix', '.csv'], ['prefix', 'edited/']))),
        delete: configurationXml(topic, originalQueue),
      },
    };
    engine.aws = () => ({ status: 204 });
    for (const target of rules) {
      if (target.type === 'SNS topic') continue;
      for (const kind of ['edit', 'delete'] as const) {
        const replacement = replaceNotification(
          original,
          kind === 'edit'
            ? { kind, target, draft: { ...notificationDraft(target), prefix: 'edited/' } }
            : { kind, target },
        );
        if (!('configuration' in replacement)) throw new Error('Replacement refused');
        await putBucketNotificationConfiguration(endpoint, 'b', replacement.configuration, signal());
        const request = engine.sent.at(-1);
        if (request === undefined) throw new Error('Missing notification request');
        expect(request.method).toBe('PUT');
        expect(new URL(request.url).searchParams.has('notification')).toBe(true);
        expect(parseXml(await request.text()), `${target.type} ${kind}`).toEqual(parseXml(expected[target.type][kind]));
      }
    }
    const create = replaceNotification(original, {
      kind: 'create',
      draft: {
        ...notificationDraft(),
        id: 'new',
        arn: 'arn:aws:sqs:us-east-1:000000000000:new',
        prefix: 'uploads/',
        suffix: '.json',
      },
    });
    if (!('configuration' in create)) throw new Error('Creation refused');
    expect(notificationRules(create.configuration).filter((rule) => rule.data.Id !== 'new')).toEqual(rules);
    expect(create.configuration.EventBridgeConfiguration).toEqual({});
    await putBucketNotificationConfiguration(endpoint, 'b', create.configuration, signal());
    const request = engine.sent.at(-1);
    if (request === undefined) throw new Error('Missing create notification request');
    const newQueue =
      '<QueueConfiguration><Id>new</Id><Queue>arn:aws:sqs:us-east-1:000000000000:new</Queue>' +
      `<Event>s3:ObjectCreated:*</Event>${filter(['prefix', 'uploads/'], ['suffix', '.json'])}</QueueConfiguration>`;
    expect(request.method).toBe('PUT');
    expect(new URL(request.url).searchParams.has('notification')).toBe(true);
    expect(parseXml(await request.text())).toEqual(
      parseXml(configurationXml(topic, originalQueue, newQueue, originalLambda)),
    );
  });

  it('does not resend a notification PUT after a session refusal and renews the session for the next GET', async () => {
    const sessionResponse = engine.session;
    const session = vi.fn(sessionResponse);
    engine.session = session;
    engine.aws = () => errorAnswer(401, 'SessionInvalid', 'Expired engine session');
    expect(await failure(putBucketNotificationConfiguration(endpoint, 'b', {}, signal()))).toMatchObject({
      code: 'SessionInvalid',
    });
    expect(engine.sent.map((request) => request.method)).toEqual(['PUT']);
    expect(session).toHaveBeenCalledTimes(1);

    engine.aws = () => xml('<NotificationConfiguration/>');
    expect(await getBucketNotificationConfiguration(endpoint, 'b', signal())).not.toBe(NO_SUCH_BUCKET);
    expect(engine.sent.map((request) => request.method)).toEqual(['PUT', 'GET']);
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('represents an empty notification document without enabling EventBridge', async () => {
    engine.aws = () => xml('<NotificationConfiguration/>');
    const configuration = await getBucketNotificationConfiguration(endpoint, 'b', signal());
    expect(configuration).not.toBe(NO_SUCH_BUCKET);
    if (configuration === NO_SUCH_BUCKET) return;
    expect(notificationRules(configuration)).toEqual([]);
    expect(sameNotifications(configuration, {})).toBe(true);
    expect(sameNotifications(configuration, { EventBridgeConfiguration: {} })).toBe(false);
  });

  it('preserves external events or explicitly replaces them and refuses a stale or ambiguous target', () => {
    const queue = {
      Id: 'q',
      QueueArn: 'arn:aws:sqs:us-east-1:000000000000:q',
      Events: ['s3:ObjectCreated:Copy', 's3:ObjectRemoved:Delete'] as (
        's3:ObjectCreated:Copy' | 's3:ObjectRemoved:Delete'
      )[],
      Filter: { Key: { FilterRules: [{ Name: 'prefix' as const, Value: 'before/' }] } },
    };
    const configuration = { QueueConfigurations: [queue] };
    const target = notificationRules(configuration)[0];
    if (target?.type !== 'SQS queue') throw new Error('Missing queue');
    const draft = { ...notificationDraft(target), prefix: 'after/' };
    const sibling = { ...queue, Id: 'external' };
    const fresh = { QueueConfigurations: [queue, sibling] };
    const kept = replaceNotification(fresh, { kind: 'edit', target, draft });
    expect(kept).toMatchObject({
      configuration: {
        QueueConfigurations: [
          { ...queue, Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'after/' }] } } },
          sibling,
        ],
      },
    });
    expect(replaceNotification(fresh, { kind: 'edit', target, draft: { ...draft, event: OBJECT_PUT } })).toMatchObject({
      configuration: { QueueConfigurations: [{ Events: [OBJECT_PUT] }, sibling] },
    });
    for (const queues of [[], [queue, queue], [{ ...queue, Events: [] }]]) {
      expect(replaceNotification({ QueueConfigurations: queues }, { kind: 'delete', target })).toEqual({
        problem: 'changed',
      });
    }
    expect(replaceNotification(configuration, { kind: 'delete', target })).toEqual({
      configuration: { QueueConfigurations: [] },
    });
  });

  it('gives "no website configuration" as "Disabled", not a failure, and one with documents as "Enabled" with both', async () => {
    engine.aws = () =>
      errorAnswer(404, 'NoSuchWebsiteConfiguration', 'The specified bucket does not have a website configuration');
    expect(await getBucketWebsite(endpoint, 'b', signal())).toEqual({ status: 'Disabled' });

    engine.aws = () =>
      xml(
        '<WebsiteConfiguration><IndexDocument><Suffix>index.html</Suffix></IndexDocument>' +
          '<ErrorDocument><Key>error.html</Key></ErrorDocument></WebsiteConfiguration>',
      );
    expect(await getBucketWebsite(endpoint, 'b', signal())).toEqual({
      status: 'Enabled',
      indexDocument: 'index.html',
      errorDocument: 'error.html',
    });
  });
});

// Issue 480 (test-criteria.md, "Unit s1 — services/s3/api.test.ts").
describe('the folders and objects of a prefix', () => {
  const listing = (contents: string, prefixes: string[], truncated?: string) =>
    xml(
      `<ListBucketResult><Name>b</Name><Prefix>logs/</Prefix><Delimiter>/</Delimiter><MaxKeys>2</MaxKeys>` +
        `<IsTruncated>${truncated === undefined ? 'false' : 'true'}</IsTruncated>` +
        (truncated === undefined ? '' : `<NextContinuationToken>${truncated}</NextContinuationToken>`) +
        contents +
        prefixes.map((prefix) => `<CommonPrefixes><Prefix>${prefix}</Prefix></CommonPrefixes>`).join('') +
        '</ListBucketResult>',
    );

  it('asks ListObjectsV2 with the delimiter /, the prefix, the page size and the token', async () => {
    engine.aws = () => listing('', []);

    await listObjects(endpoint, 'b', { prefix: 'logs/2026/', pageSize: 50, token: 't/1+' }, signal());

    const url = new URL(engine.awsRequests[0] ?? '');
    expect(url.pathname).toMatch(/^\/b\/?$/);
    expect(url.searchParams.get('list-type')).toBe('2');
    expect(url.searchParams.get('delimiter')).toBe('/');
    expect(url.searchParams.get('prefix')).toBe('logs/2026/');
    expect(url.searchParams.get('max-keys')).toBe('50');
    expect(url.searchParams.get('continuation-token')).toBe('t/1+');
  });

  it('sends no prefix and no token at the root of the first page', async () => {
    engine.aws = () => listing('', []);

    await listObjects(endpoint, 'b', { prefix: '', pageSize: 100 }, signal());

    const url = new URL(engine.awsRequests[0] ?? '');
    expect(url.searchParams.has('prefix')).toBe(false);
    expect(url.searchParams.has('continuation-token')).toBe(false);
  });

  it('gives the common prefixes as folders and the contents as objects, each by the part after the prefix, and the token while truncated', async () => {
    engine.aws = () =>
      listing(
        '<Contents><Key>logs/a.txt</Key><LastModified>2026-11-18T10:00:00.000Z</LastModified><ETag>"e"</ETag>' +
          '<Size>12</Size><StorageClass>STANDARD</StorageClass></Contents>' +
          '<Contents><Key>logs/q?#%.txt</Key><Size>0</Size></Contents>',
        ['logs/2026/', 'logs/한글/'],
        'next-1',
      );

    expect(await listObjects(endpoint, 'b', { prefix: 'logs/', pageSize: 2 }, signal())).toEqual({
      folders: [
        { prefix: 'logs/2026/', name: '2026/' },
        { prefix: 'logs/한글/', name: '한글/' },
      ],
      objects: [
        {
          key: 'logs/a.txt',
          name: 'a.txt',
          size: 12,
          lastModified: new Date('2026-11-18T10:00:00.000Z'),
          storageClass: 'STANDARD',
        },
        { key: 'logs/q?#%.txt', name: 'q?#%.txt', size: 0 },
      ],
      nextToken: 'next-1',
    });
  });

  it('gives no token for an answer that is not truncated', async () => {
    engine.aws = () => listing('<Contents><Key>logs/a.txt</Key><Size>1</Size></Contents>', []);

    const page = await listObjects(endpoint, 'b', { prefix: 'logs/', pageSize: 2 }, signal());
    expect(page).not.toBe(NO_SUCH_BUCKET);
    expect(page).not.toHaveProperty('nextToken');
  });

  it('is "no such bucket" on NoSuchBucket, and "not implemented" naming ListObjectsV2 on a 501', async () => {
    engine.aws = () => errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
    expect(await listObjects(endpoint, 'b', { prefix: '', pageSize: 100 }, signal())).toBe(NO_SUCH_BUCKET);

    engine.aws = () => errorAnswer(501, 'NotImplemented', 'scaffolded');
    expect(await failure(listObjects(endpoint, 'b', { prefix: '', pageSize: 100 }, signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'ListObjectsV2',
    });
  });
});

describe('the dropped sections of issue 480', () => {
  it('have no reader left in the API; the five kept sections read as before', async () => {
    const api = await import('./api');
    for (const gone of [
      'getBucketAbac',
      'listBucketIntelligentTieringConfigurations',
      'getBucketLogging',
      'getBucketAccelerateConfiguration',
      'getObjectLockConfiguration',
      'getBucketRequestPayment',
    ]) {
      expect(api).not.toHaveProperty(gone);
    }
    for (const kept of [
      'getBucketVersioning',
      'getBucketTagging',
      'getBucketEncryption',
      'getBucketNotificationConfiguration',
      'getBucketWebsite',
    ]) {
      expect(api).toHaveProperty(kept);
    }
  });
});

describe('whether a bucket is empty', () => {
  it.each([
    ['one version', '<Version><Key>a</Key><VersionId>v1</VersionId></Version>', false],
    ['one delete marker', '<DeleteMarker><Key>a</Key><VersionId>m1</VersionId></DeleteMarker>', false],
    ['nothing', '', true],
  ])('is asked with one key at most, and a listing of %s is empty: %j', async (_, items, empty) => {
    engine.aws = () => xml(`<ListVersionsResult><IsTruncated>false</IsTruncated>${items}</ListVersionsResult>`);

    expect(await isBucketEmpty(endpoint, 'b', signal())).toBe(empty);
    const query = rawQuery(engine.awsRequests[0] ?? '');
    expect(query.has('versions')).toBe(true);
    expect(query.get('max-keys')).toBe('1');
  });
});

describe('the listing and deleting of a bucket’s items', () => {
  it('lists versions, then delete markers, with the version ids as they came and the markers of a truncated answer', async () => {
    engine.aws = () =>
      xml(
        '<ListVersionsResult><IsTruncated>true</IsTruncated><NextKeyMarker>k b</NextKeyMarker><NextVersionIdMarker>v9</NextVersionIdMarker>' +
          '<DeleteMarker><Key>gone</Key><VersionId>m1</VersionId></DeleteMarker>' +
          '<Version><Key>plain</Key><VersionId>null</VersionId></Version></ListVersionsResult>',
      );

    expect(
      await listObjectVersions(endpoint, 'b', { maxKeys: 1000, keyMarker: 'a', versionIdMarker: 'v0' }, signal()),
    ).toEqual({
      items: [
        { key: 'plain', versionId: 'null' },
        { key: 'gone', versionId: 'm1' },
      ],
      truncated: true,
      nextKeyMarker: 'k b',
      nextVersionIdMarker: 'v9',
    });
    const query = new URL(engine.awsRequests[0] ?? '').searchParams;
    expect(query.get('max-keys')).toBe('1000');
    expect(query.get('key-marker')).toBe('a');
    expect(query.get('version-id-marker')).toBe('v0');
  });

  it('deletes items quietly, each with its version id, and gives the errors of the answer by key and version', async () => {
    engine.aws = () =>
      xml(
        '<DeleteResult><Error><Key>held</Key><VersionId>v2</VersionId><Code>AccessDenied</Code>' +
          '<Message>Access Denied because object protected by object lock.</Message></Error></DeleteResult>',
      );

    const result = await deleteObjects(
      endpoint,
      'b',
      [
        { key: 'a b', versionId: 'null' },
        { key: 'held', versionId: 'v2' },
      ],
      signal(),
    );

    expect(result).toEqual({
      errors: [
        {
          key: 'held',
          versionId: 'v2',
          code: 'AccessDenied',
          message: 'Access Denied because object protected by object lock.',
        },
      ],
    });
    const [sent] = engine.sent;
    expect(sent?.method).toBe('POST');
    expect(rawQuery(sent?.url ?? '').has('delete')).toBe(true);
    const body = (await sent?.text()) ?? '';
    expect(body).toContain('<Quiet>true</Quiet>');
    expect(body).toContain('<Object><Key>a b</Key><VersionId>null</VersionId></Object>');
    expect(body).toContain('<Object><Key>held</Key><VersionId>v2</VersionId></Object>');
  });
});

describe('DeleteBucket', () => {
  it('is "deleted" on 204, "not empty", not a failure, on BucketNotEmpty, and "no such bucket" on NoSuchBucket', async () => {
    engine.aws = () => ({ status: 204 });
    expect(await deleteBucket(endpoint, 'b', signal())).toBe('deleted');
    expect(engine.sent[0]?.method).toBe('DELETE');

    engine.aws = () => errorAnswer(409, 'BucketNotEmpty', 'The bucket you tried to delete is not empty');
    expect(await deleteBucket(endpoint, 'b', signal())).toBe('not-empty');

    engine.aws = () => errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');
    expect(await deleteBucket(endpoint, 'b', signal())).toBe(NO_SUCH_BUCKET);
  });
});

describe('the create form’s requests', () => {
  it('sends CreateBucket with the ownership header and nothing else for a bucket without tags or Object Lock', async () => {
    engine.aws = () => ({ status: 200 });

    await createBucket(
      endpoint,
      { bucket: 'my-bucket', ownership: 'BucketOwnerEnforced', objectLock: false, tags: [] },
      signal(),
    );

    const [sent] = engine.sent;
    expect(sent?.method).toBe('PUT');
    expect(new URL(sent?.url ?? '').pathname).toMatch(/^\/my-bucket\/?$/);
    expect(sent?.headers.get('x-amz-object-ownership')).toBe('BucketOwnerEnforced');
    expect(sent?.headers.has('x-amz-bucket-object-lock-enabled')).toBe(false);
    expect((await sent?.text()) ?? '').not.toContain('LocationConstraint');
  });

  it('sends CreateBucket with Object Lock and the tags as typed, an empty value included, and no location', async () => {
    engine.aws = () => ({ status: 200 });

    await createBucket(
      endpoint,
      {
        bucket: 'my-bucket',
        ownership: 'ObjectWriter',
        objectLock: true,
        tags: [
          { key: 'env', value: 'dev' },
          { key: 'empty', value: '' },
        ],
      },
      signal(),
    );

    const [sent] = engine.sent;
    expect(sent?.headers.get('x-amz-object-ownership')).toBe('ObjectWriter');
    expect(sent?.headers.get('x-amz-bucket-object-lock-enabled')).toBe('true');
    const body = (await sent?.text()) ?? '';
    expect(body).toContain('<Tag><Key>env</Key><Value>dev</Value></Tag>');
    expect(body).toMatch(/<Tag><Key>empty<\/Key><Value(\/>|><\/Value>)<\/Tag>/);
    expect(body).not.toContain('LocationConstraint');
  });

  it('sends the public access block, versioning Enabled and a KMS encryption as given', async () => {
    engine.aws = () => ({ status: 200 });

    await putPublicAccessBlock(
      endpoint,
      'b',
      { blockPublicAcls: true, ignorePublicAcls: false, blockPublicPolicy: true, restrictPublicBuckets: true },
      signal(),
    );
    await enableBucketVersioning(endpoint, 'b', signal());
    await putBucketEncryption(endpoint, 'b', { algorithm: 'aws:kms', kmsKeyId: 'arn:k', bucketKey: false }, signal());
    await putBucketEncryption(endpoint, 'b', { algorithm: 'aws:kms:dsse', kmsKeyId: 'arn:d' }, signal());

    const bodies = await Promise.all(engine.sent.map((request) => request.text()));
    expect(rawQuery(engine.sent[0]?.url ?? '').has('publicAccessBlock')).toBe(true);
    expect(bodies[0]).toContain('<IgnorePublicAcls>false</IgnorePublicAcls>');
    expect(bodies[0]).toContain('<BlockPublicAcls>true</BlockPublicAcls>');
    expect(bodies[1]).toContain('<Status>Enabled</Status>');
    expect(bodies[2]).toContain('<SSEAlgorithm>aws:kms</SSEAlgorithm>');
    expect(bodies[2]).toContain('<KMSMasterKeyID>arn:k</KMSMasterKeyID>');
    expect(bodies[2]).toContain('<BucketKeyEnabled>false</BucketKeyEnabled>');
    expect(bodies[3]).toContain('<SSEAlgorithm>aws:kms:dsse</SSEAlgorithm>');
    expect(bodies[3]).toContain('<KMSMasterKeyID>arn:d</KMSMasterKeyID>');
    expect(bodies[3]).not.toContain('BucketKeyEnabled');
  });
});

/** Every call of a bucket's screens on bucket `b`, by its operation's name. */
const CALLS: [string, (abort: AbortSignal) => Promise<unknown>][] = [
  ['GetBucketVersioning', (s) => getBucketVersioning(endpoint, 'b', s)],
  ['GetBucketTagging', (s) => getBucketTagging(endpoint, 'b', s)],
  ['GetBucketEncryption', (s) => getBucketEncryption(endpoint, 'b', s)],
  ['GetBucketNotificationConfiguration', (s) => getBucketNotificationConfiguration(endpoint, 'b', s)],
  ['GetBucketWebsite', (s) => getBucketWebsite(endpoint, 'b', s)],
  ['ListObjectsV2', (s) => listObjects(endpoint, 'b', { prefix: '', pageSize: 100 }, s)],
  ['ListObjectVersions', (s) => listObjectVersions(endpoint, 'b', { maxKeys: 1000 }, s)],
  ['ListObjectVersions', (s) => isBucketEmpty(endpoint, 'b', s)],
  ['DeleteObjects', (s) => deleteObjects(endpoint, 'b', [{ key: 'k', versionId: 'null' }], s)],
  ['DeleteBucket', (s) => deleteBucket(endpoint, 'b', s)],
];

/** The calls that send a request and give no "no such bucket" of their own. */
const SENDS: [string, (abort: AbortSignal) => Promise<unknown>][] = [
  ['ListBuckets', (s) => findBucket(endpoint, 'b', s)],
  [
    'CreateBucket',
    (s) => createBucket(endpoint, { bucket: 'b', ownership: 'BucketOwnerEnforced', objectLock: false, tags: [] }, s),
  ],
  [
    'PutPublicAccessBlock',
    (s) =>
      putPublicAccessBlock(
        endpoint,
        'b',
        { blockPublicAcls: false, ignorePublicAcls: true, blockPublicPolicy: true, restrictPublicBuckets: true },
        s,
      ),
  ],
  ['PutBucketVersioning', (s) => enableBucketVersioning(endpoint, 'b', s)],
  [
    'PutBucketEncryption',
    (s) => putBucketEncryption(endpoint, 'b', { algorithm: 'aws:kms:dsse', kmsKeyId: 'arn:k' }, s),
  ],
];

describe('a bucket the emulator does not hold', () => {
  it.each(CALLS)('is "no such bucket" when %s answers NoSuchBucket', async (_, call) => {
    engine.aws = () => errorAnswer(404, 'NoSuchBucket', 'The specified bucket does not exist');

    expect(await call(signal())).toBe(NO_SUCH_BUCKET);
  });
});

describe('a failed call names the operation that was sent', () => {
  const message = 'The emulator at https://127.0.0.1:9411 could not be reached: connection refused';

  it.each(
    [
      ['ListBuckets', (s: AbortSignal) => findBucket(endpoint, 'b', s)],
      ['GetBucketVersioning', (s: AbortSignal) => getBucketVersioning(endpoint, 'b', s)],
      ['ListObjectVersions', (s: AbortSignal) => listObjectVersions(endpoint, 'b', { maxKeys: 1000 }, s)],
    ].flatMap(([operation, call]) => [
      [
        operation,
        '501',
        () => errorAnswer(501, 'NotImplemented', `operation ${String(operation)} is scaffolded`),
        call,
        { kind: 'not-implemented', operation },
      ],
      [
        operation,
        'AccessDenied',
        () => errorAnswer(403, 'AccessDenied', 'Denied by policy'),
        call,
        { kind: 'access-denied', operation, message: 'Denied by policy' },
      ],
      [
        operation,
        'EmulatorUnavailable',
        () => errorAnswer(503, 'EmulatorUnavailable', message),
        call,
        { kind: 'emulator-did-not-answer', operation, message },
      ],
      [
        operation,
        'a network error',
        () => 'network-error' as const,
        call,
        { kind: 'engine-did-not-answer', operation },
      ],
      [
        operation,
        'another code',
        () => errorAnswer(400, 'InvalidRequest', 'Bad'),
        call,
        { kind: 'other', operation, code: 'InvalidRequest', message: 'Bad' },
      ],
    ]) as [string, string, () => EngineAnswer, (s: AbortSignal) => Promise<unknown>, RequestFailure][],
  )('%s with %s → its kind and the operation', async (_, __, answer, call, expected) => {
    engine.aws = answer;

    expect(await failure(call(signal()))).toEqual(expected);
  });

  it.each([...CALLS, ...SENDS])(
    '%s answered 501 or another code → that kind, naming the operation',
    async (operation, call) => {
      engine.aws = () => errorAnswer(501, 'NotImplemented', 'scaffolded');
      expect(await failure(call(signal()))).toEqual({ kind: 'not-implemented', operation });

      engine.aws = () => errorAnswer(400, 'InvalidRequest', 'The request is not valid');
      expect(await failure(call(signal()))).toEqual({
        kind: 'other',
        operation,
        code: 'InvalidRequest',
        message: 'The request is not valid',
      });
    },
  );
});

describe('the caller’s abort signal', () => {
  it.each([...CALLS, ...SENDS])(
    'is given to the request of %s, which ends with its reason at once',
    async (_, call) => {
      engine.aws = () => 'hold';
      const controller = new AbortController();
      const reason = new Error('not wanted any more');

      const settled = call(controller.signal).then(
        () => ({ resolved: true }),
        (error: unknown) => ({ rejected: error }),
      );
      await vi.waitFor(() => {
        expect(engine.sent).toHaveLength(1);
      });
      expect(engine.signals[0]?.aborted).toBe(false);
      controller.abort(reason);

      expect(await settled).toEqual({ rejected: reason });
      // The call ends with the reason at once; the abort reaches the request it sent on its own way.
      await vi.waitFor(() => {
        expect(engine.signals[0]?.aborted).toBe(true);
      });
    },
  );
});

describe('object copy requests', () => {
  const expires = 'Tue, 01 Jan 2030 00:00:00 GMT';
  const copyResult = {
    status: 200,
    body: '<CopyObjectResult><ETag>"copy"</ETag></CopyObjectResult>',
  };
  const object = { bucket: 'source-bucket', key: 'object.txt' };
  function sentCopy(index: number) {
    const request = engine.sent[index];
    if (request === undefined) throw new Error('Expected a copy request');
    return request;
  }

  const originalHeaders = {
    'content-type': 'text/plain',
    'cache-control': 'max-age=3600',
    'content-encoding': 'identity',
    'content-disposition': 'inline',
    'content-language': 'en',
    expires,
    'x-amz-website-redirect-location': '/home',
    'x-amz-meta-owner': 'build',
  };

  it('encodes the source path once, sends the exact destination key and uses the default directives', async () => {
    engine.aws = () => copyResult;
    const key = 'inbox/한글 space%?.txt';
    await copyObject(
      endpoint,
      { bucket: 'source-bucket', key },
      { bucket: 'destination-bucket', key },
      new AbortController().signal,
    );
    const request = sentCopy(0);
    expect(request.method).toBe('PUT');
    expect(request.headers.get('x-amz-copy-source')).toBe('source-bucket/inbox/%ED%95%9C%EA%B8%80%20space%25%3F.txt');
    expect(decodeURIComponent(new URL(request.url).pathname)).toBe('/destination-bucket/' + key);
    expect(request.headers.has('x-amz-metadata-directive')).toBe(false);
    expect(request.headers.has('x-amz-tagging-directive')).toBe(false);
  });

  it('conditions a copy on the destination being absent while leaving the source unconditional', async () => {
    engine.aws = () => copyResult;
    await copyObject(endpoint, object, { bucket: 'destination-bucket', key: 'target' }, new AbortController().signal, {
      onlyIfMissing: true,
    });
    const request = sentCopy(0);
    expect(request.headers.get('if-none-match')).toBe('*');
    expect(request.headers.has('x-amz-copy-source-if-none-match')).toBe(false);
    expect(request.headers.has('x-amz-copy-source-if-match')).toBe(false);
  });

  it('changes only the media type and retains the six existing headers, metadata and default tagging', async () => {
    const signal = new AbortController().signal;
    engine.aws = () => ({ status: 200, headers: originalHeaders });
    const original = await headObject(endpoint, object.bucket, object.key, signal);
    if (original === NOT_FOUND) throw new Error('Expected an existing object');
    engine.aws = () => copyResult;
    await copyObject(endpoint, object, object, signal, {
      edit: {
        contentType: 'application/json',
        metadata: Object.fromEntries(original.user.map(({ key, value }) => [key, value])),
        headers: original.copyHeaders,
      },
    });

    const request = sentCopy(1);
    expect(request.headers.get('x-amz-copy-source')).toBe('source-bucket/object.txt');
    expect(request.headers.get('x-amz-metadata-directive')).toBe('REPLACE');
    expect(request.headers.has('x-amz-tagging-directive')).toBe(false);
    for (const [name, value] of Object.entries({ ...originalHeaders, 'content-type': 'application/json' })) {
      expect(request.headers.get(name), name).toBe(value);
    }
  });

  it('sends an empty metadata map and keeps the content type without adding absent headers', async () => {
    const signal = new AbortController().signal;
    engine.aws = () => ({ status: 200, headers: { 'content-type': 'text/plain', 'x-amz-meta-remove': 'old' } });
    const original = await headObject(endpoint, object.bucket, object.key, signal);
    if (original === NOT_FOUND || original.contentType === undefined)
      throw new Error('Expected an existing object with a content type');
    engine.aws = () => copyResult;
    const send = vi.spyOn(S3Client.prototype, 'send');
    try {
      await copyObject(endpoint, object, object, signal, {
        edit: { contentType: original.contentType, metadata: {}, headers: original.copyHeaders },
      });
      const command = send.mock.calls[0]?.[0];
      expect(command).toBeInstanceOf(CopyObjectCommand);
      expect(command).toMatchObject({ input: { Metadata: {} } });
    } finally {
      send.mockRestore();
    }

    const request = sentCopy(1);
    expect(request.headers.get('content-type')).toBe('text/plain');
    expect(request.headers.get('x-amz-metadata-directive')).toBe('REPLACE');
    for (const name of Object.keys(originalHeaders).filter((name) => name !== 'content-type')) {
      expect(request.headers.has(name), name).toBe(false);
    }
    expect([...request.headers.keys()].some((name) => name.startsWith('x-amz-meta-'))).toBe(false);
  });
});
