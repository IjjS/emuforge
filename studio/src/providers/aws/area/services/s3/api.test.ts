import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { listBuckets, S3ReadError, type ReadFailure } from './api';

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
    return new Response(answer.body ?? '', {
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

async function failure(promise: Promise<unknown>): Promise<ReadFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(S3ReadError);
    return (error as S3ReadError).failure;
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
  it('is "not implemented", naming ListBuckets, when the engine answers 501', async () => {
    engine.aws = () =>
      errorAnswer(501, 'NotImplemented', 'operation ListBuckets is scaffolded but not implemented in this emulator');

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'not-implemented', operation: 'ListBuckets' });
  });

  it('is "access denied" with the message returned for AccessDenied', async () => {
    engine.aws = () => errorAnswer(403, 'AccessDenied', 'User is not allowed to list buckets');

    expect(await failure(list({ pageSize: 25 }))).toEqual({
      kind: 'access-denied',
      message: 'User is not allowed to list buckets',
    });
  });

  it.each([
    [503, 'EmulatorUnavailable', 'The emulator at https://127.0.0.1:9411 could not be reached: connection refused'],
    [504, 'EmulatorTimeout', 'The emulator at https://127.0.0.1:9411 did not answer within 30 seconds'],
  ])('is "emulator did not answer" with the engine’s message for %i %s', async (status, code, message) => {
    engine.aws = () => errorAnswer(status, code, message);

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'emulator-did-not-answer', message });
  });

  it('is "engine did not answer" when the request fails at the network level', async () => {
    engine.aws = () => 'network-error';

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'engine-did-not-answer' });
  });

  it('is "engine did not answer" when the session request fails at the network level', async () => {
    engine.session = () => 'network-error';

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'engine-did-not-answer' });
    expect(engine.awsRequests).toHaveLength(0);
  });

  it('gives any other error answer’s code and message', async () => {
    engine.aws = () => errorAnswer(400, 'InvalidArgument', 'The continuation token provided is incorrect');

    expect(await failure(list({ pageSize: 25, token: 'not-issued' }))).toEqual({
      kind: 'other',
      code: 'InvalidArgument',
      message: 'The continuation token provided is incorrect',
    });
  });

  it('gives the answer’s status line in the code’s place for an error answer without a code', async () => {
    engine.aws = () => ({ status: 418, statusText: "I'm a teapot", body: '' });

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'other', code: "HTTP 418 I'm a teapot" });
  });

  it('gives the status alone in the code’s place when the answer has neither a code nor a reason', async () => {
    engine.aws = () => ({ status: 409, body: 'not xml' });

    expect(await failure(list({ pageSize: 25 }))).toEqual({ kind: 'other', code: 'HTTP 409' });
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
