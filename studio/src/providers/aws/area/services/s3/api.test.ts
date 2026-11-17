import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  createBucket,
  deleteBucket,
  deleteObjects,
  enableBucketVersioning,
  findBucket,
  getBucketAbac,
  getBucketAccelerateConfiguration,
  getBucketEncryption,
  getBucketLogging,
  getBucketNotificationConfiguration,
  getBucketRequestPayment,
  getBucketTagging,
  getBucketVersioning,
  getBucketWebsite,
  getObjectLockConfiguration,
  isBucketEmpty,
  listBucketIntelligentTieringConfigurations,
  listBuckets,
  listObjectVersions,
  NO_SUCH_BUCKET,
  putBucketEncryption,
  putPublicAccessBlock,
} from './api';
import { formatRetentionPeriod } from './format';
// @ts-expect-error -- the S3 folder keeps no failure of its own (issue 445, R8): the shared module's is the one.
import type { ReadFailure as GoneReadFailure, S3ReadError as GoneS3ReadError } from './api';

// The test plays the engine behind the page's `fetch`: its session route, and every AWS request as it leaves the
// browser, with the URL the SDK built.

interface Answer {
  status: number;
  statusText?: string;
  body?: string;
}

type EngineAnswer = Answer | 'network-error' | 'hold';

const TOKEN = 'emuforge-test-token-56';

class FakeEngine {
  /** The URL of every AWS request, as it was sent. */
  readonly awsRequests: string[] = [];
  /** Every AWS request, as it was sent, its body unread. */
  readonly sent: Request[] = [];
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
    return new Response(answer.status === 204 ? null : (answer.body ?? ''), {
      status: answer.status,
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

  it.each(['Enabled', 'Disabled'])('gives the ABAC status %s as the same word', async (status) => {
    engine.aws = () => xml(`<AbacStatus><Status>${status}</Status></AbacStatus>`);

    expect(await getBucketAbac(endpoint, 'b', signal())).toEqual({ status });
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

  it('gives an Intelligent-Tiering configuration with its name, status, prefix and both tiers, and one of a filter with tags by its prefix', async () => {
    engine.aws = () =>
      xml(
        '<ListBucketIntelligentTieringConfigurationsOutput><IsTruncated>false</IsTruncated>' +
          '<IntelligentTieringConfiguration><Id>archive-logs</Id><Filter><Prefix>logs/</Prefix></Filter><Status>Enabled</Status>' +
          '<Tiering><Days>90</Days><AccessTier>ARCHIVE_ACCESS</AccessTier></Tiering>' +
          '<Tiering><Days>180</Days><AccessTier>DEEP_ARCHIVE_ACCESS</AccessTier></Tiering></IntelligentTieringConfiguration>' +
          '<IntelligentTieringConfiguration><Id>tagged</Id><Filter><And><Prefix>data/</Prefix><Tag><Key>k</Key><Value>v</Value></Tag>' +
          '</And></Filter><Status>Disabled</Status><Tiering><Days>120</Days><AccessTier>ARCHIVE_ACCESS</AccessTier></Tiering>' +
          '</IntelligentTieringConfiguration></ListBucketIntelligentTieringConfigurationsOutput>',
      );

    expect(await listBucketIntelligentTieringConfigurations(endpoint, 'b', signal())).toEqual({
      configurations: [
        { name: 'archive-logs', status: 'Enabled', prefix: 'logs/', archiveDays: 90, deepArchiveDays: 180 },
        { name: 'tagged', status: 'Disabled', prefix: 'data/', archiveDays: 120 },
      ],
      more: false,
    });
  });

  it('marks a truncated Intelligent-Tiering answer as having more', async () => {
    engine.aws = () =>
      xml(
        '<ListBucketIntelligentTieringConfigurationsOutput><IsTruncated>true</IsTruncated><NextContinuationToken>t</NextContinuationToken>' +
          '<IntelligentTieringConfiguration><Id>one</Id><Status>Enabled</Status></IntelligentTieringConfiguration>' +
          '</ListBucketIntelligentTieringConfigurationsOutput>',
      );

    expect(await listBucketIntelligentTieringConfigurations(endpoint, 'b', signal())).toEqual({
      configurations: [{ name: 'one', status: 'Enabled' }],
      more: true,
    });
  });

  it('gives logging with a target bucket and prefix as "Enabled" with both, and an empty answer as "Disabled"', async () => {
    engine.aws = () =>
      xml(
        '<BucketLoggingStatus><LoggingEnabled><TargetBucket>logs-bucket</TargetBucket><TargetPrefix>access/</TargetPrefix>' +
          '</LoggingEnabled></BucketLoggingStatus>',
      );
    expect(await getBucketLogging(endpoint, 'b', signal())).toEqual({
      status: 'Enabled',
      targetBucket: 'logs-bucket',
      targetPrefix: 'access/',
    });

    engine.aws = () => xml('<BucketLoggingStatus/>');
    expect(await getBucketLogging(endpoint, 'b', signal())).toEqual({ status: 'Disabled' });
  });

  it('gives a topic, a queue and a function configuration as three rows, topic first, and EventBridge as "On"', async () => {
    const filter = (prefix: string, suffix: string) =>
      `<Filter><S3Key><FilterRule><Name>prefix</Name><Value>${prefix}</Value></FilterRule>` +
      `<FilterRule><Name>suffix</Name><Value>${suffix}</Value></FilterRule></S3Key></Filter>`;
    engine.aws = () =>
      xml(
        '<NotificationConfiguration>' +
          '<QueueConfiguration><Id>to-queue</Id><Queue>arn:aws:sqs:us-east-1:000000000000:q</Queue>' +
          `<Event>s3:ObjectRemoved:*</Event>${filter('logs/', '.txt')}</QueueConfiguration>` +
          '<TopicConfiguration><Id>to-topic</Id><Topic>arn:aws:sns:us-east-1:000000000000:t</Topic>' +
          `<Event>s3:ObjectCreated:Put</Event><Event>s3:ObjectCreated:Post</Event>${filter('images/', '.jpg')}</TopicConfiguration>` +
          '<CloudFunctionConfiguration><Id>to-function</Id><CloudFunction>arn:aws:lambda:us-east-1:000000000000:function:f</CloudFunction>' +
          `<Event>s3:ObjectCreated:*</Event>${filter('in/', '.csv')}</CloudFunctionConfiguration>` +
          '<EventBridgeConfiguration></EventBridgeConfiguration></NotificationConfiguration>',
      );

    expect(await getBucketNotificationConfiguration(endpoint, 'b', signal())).toEqual({
      notifications: [
        {
          name: 'to-topic',
          events: ['s3:ObjectCreated:Put', 's3:ObjectCreated:Post'],
          prefix: 'images/',
          suffix: '.jpg',
          destinationType: 'SNS topic',
          destination: 'arn:aws:sns:us-east-1:000000000000:t',
        },
        {
          name: 'to-queue',
          events: ['s3:ObjectRemoved:*'],
          prefix: 'logs/',
          suffix: '.txt',
          destinationType: 'SQS queue',
          destination: 'arn:aws:sqs:us-east-1:000000000000:q',
        },
        {
          name: 'to-function',
          events: ['s3:ObjectCreated:*'],
          prefix: 'in/',
          suffix: '.csv',
          destinationType: 'Lambda function',
          destination: 'arn:aws:lambda:us-east-1:000000000000:function:f',
        },
      ],
      eventBridge: 'On',
    });
  });

  it('gives no notification configuration as "Off" and no rows', async () => {
    engine.aws = () => xml('<NotificationConfiguration/>');

    expect(await getBucketNotificationConfiguration(endpoint, 'b', signal())).toEqual({
      notifications: [],
      eventBridge: 'Off',
    });
  });

  it('gives acceleration with no status as "Disabled"', async () => {
    engine.aws = () => xml('<AccelerateConfiguration/>');

    expect(await getBucketAccelerateConfiguration(endpoint, 'b', signal())).toEqual({ status: 'Disabled' });
  });

  it('gives Object Lock "configuration not found" as "Disabled" with no retention, not a failure', async () => {
    engine.aws = () =>
      errorAnswer(
        404,
        'ObjectLockConfigurationNotFoundError',
        'Object Lock configuration does not exist for this bucket',
      );

    const setting = await getObjectLockConfiguration(endpoint, 'b', signal());
    expect(setting).toEqual({ status: 'Disabled', defaultRetention: 'Disabled' });
    expect(setting).not.toHaveProperty('mode');
    expect(setting).not.toHaveProperty('period');
  });

  it('gives a default retention of 1 day in governance mode as "Enabled", "Governance", "1 day"', async () => {
    engine.aws = () =>
      xml(
        '<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention>' +
          '<Mode>GOVERNANCE</Mode><Days>1</Days></DefaultRetention></Rule></ObjectLockConfiguration>',
      );

    const setting = await getObjectLockConfiguration(endpoint, 'b', signal());
    expect(setting).toEqual({
      status: 'Enabled',
      defaultRetention: 'Enabled',
      mode: 'Governance',
      period: { unit: 'days', count: 1 },
    });
    expect(setting !== NO_SUCH_BUCKET && setting.period !== undefined && formatRetentionPeriod(setting.period)).toBe(
      '1 day',
    );
  });

  it('gives a payer Requester as "Enabled" and BucketOwner as "Disabled"', async () => {
    engine.aws = () => xml('<RequestPaymentConfiguration><Payer>Requester</Payer></RequestPaymentConfiguration>');
    expect(await getBucketRequestPayment(endpoint, 'b', signal())).toEqual({ status: 'Enabled' });

    engine.aws = () => xml('<RequestPaymentConfiguration><Payer>BucketOwner</Payer></RequestPaymentConfiguration>');
    expect(await getBucketRequestPayment(endpoint, 'b', signal())).toEqual({ status: 'Disabled' });
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
  ['GetBucketAbac', (s) => getBucketAbac(endpoint, 'b', s)],
  ['GetBucketTagging', (s) => getBucketTagging(endpoint, 'b', s)],
  ['GetBucketEncryption', (s) => getBucketEncryption(endpoint, 'b', s)],
  ['ListBucketIntelligentTieringConfigurations', (s) => listBucketIntelligentTieringConfigurations(endpoint, 'b', s)],
  ['GetBucketLogging', (s) => getBucketLogging(endpoint, 'b', s)],
  ['GetBucketNotificationConfiguration', (s) => getBucketNotificationConfiguration(endpoint, 'b', s)],
  ['GetBucketAccelerateConfiguration', (s) => getBucketAccelerateConfiguration(endpoint, 'b', s)],
  ['GetObjectLockConfiguration', (s) => getObjectLockConfiguration(endpoint, 'b', s)],
  ['GetBucketRequestPayment', (s) => getBucketRequestPayment(endpoint, 'b', s)],
  ['GetBucketWebsite', (s) => getBucketWebsite(endpoint, 'b', s)],
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
      expect(engine.sent[0]?.signal.aborted).toBe(false);
      controller.abort(reason);

      expect(await settled).toEqual({ rejected: reason });
      expect(engine.sent[0]?.signal.aborted).toBe(true);
    },
  );
});
