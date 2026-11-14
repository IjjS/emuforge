import { HeadBucketCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { ListStateMachinesCommand, SFNClient } from '@aws-sdk/client-sfn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createS3Client, createSfnClient, engineEndpoint } from './client-factory';

// Every case sends its commands through clients of the factory. The test plays the engine: it answers the session
// route through the page's `fetch`, and each AWS request at the last step before it would be sent.

/** An answer of the engine, as it would arrive at the client. */
interface Answer {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

type SessionAnswer = Answer | 'network-error';

/** The AWS request as it would leave the client, after every build, signing and finalize step. */
interface SentRequest {
  method: string;
  path: string;
  query: Record<string, string | string[] | null>;
  headers: Record<string, string>;
  body?: unknown;
}

interface SessionRequest {
  url: string;
  init: RequestInit | undefined;
}

const T1 = 'emuforge-test-token-1-8f3a9c';
const T2 = 'emuforge-test-token-2-41d7e0';
const T3 = 'emuforge-test-token-3-c6b25f';
const TOKENS = [T1, T2, T3];
const SECRET = 'emuforge-studio-not-a-secret';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Lets every ready callback and timer of the clients run, until `ready` holds. */
async function until(ready: () => boolean): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    if (ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('the clients did not get there');
}

/** Lets every callback and timer the clients have ready run, a few rounds over. */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

class FakeEngine {
  readonly sessionRequests: SessionRequest[] = [];
  readonly awsRequests: SentRequest[] = [];
  /** `session` and `aws`, in the order the requests were made. */
  readonly events: string[] = [];
  /** The answer to the n-th session request (from 0); by default `200` with the n-th of `TOKENS`. */
  session: (request: SessionRequest, n: number) => SessionAnswer | Promise<SessionAnswer> = (_, n) =>
    tokenAnswer(TOKENS[n] ?? `emuforge-test-token-${String(n + 1)}`);
  /** The answer to an AWS request; by default the operation's success. */
  aws: (request: SentRequest) => Answer | Promise<Answer> = success;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = { url: String(input), init };
    const n = this.sessionRequests.length;
    this.sessionRequests.push(request);
    this.events.push('session');
    const answer = await this.session(request, n);
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.body ?? '', { status: answer.status, headers: answer.headers ?? {} });
  };

  attach<C extends S3Client | SFNClient>(client: C): C {
    (client as SFNClient).middlewareStack.add(
      () => async (args) => {
        const built = args.request as SentRequest;
        const request: SentRequest = { ...built, headers: { ...built.headers }, query: { ...built.query } };
        this.awsRequests.push(request);
        this.events.push('aws');
        const answer = await this.aws(request);
        return {
          response: {
            statusCode: answer.status,
            headers: answer.headers ?? {},
            // A Blob, which the SDK collects itself: a typed array made here belongs to another realm than the SDK's.
            body: new Blob([answer.body ?? '']),
          },
          output: undefined as never,
        };
      },
      { step: 'deserialize', priority: 'low', name: 'answerRequest', override: true },
    );
    return client;
  }
}

function tokenAnswer(token: string): Answer {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) };
}

function isSfn(request: SentRequest): boolean {
  return headerValues(request, 'x-amz-target').length > 0;
}

function bucketList(names: string[]): Answer {
  const buckets = names
    .map((name) => `<Bucket><Name>${name}</Name><CreationDate>2026-11-15T00:00:00.000Z</CreationDate></Bucket>`)
    .join('');
  return {
    status: 200,
    headers: { 'content-type': 'application/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>owner</ID></Owner><Buckets>${buckets}</Buckets></ListAllMyBucketsResult>`,
  };
}

function success(request: SentRequest): Answer {
  if (isSfn(request)) {
    return { status: 200, headers: { 'content-type': 'application/x-amz-json-1.0' }, body: '{"stateMachines":[]}' };
  }
  if (request.method === 'HEAD') {
    return { status: 200 };
  }
  return bucketList(['b1']);
}

/** An engine or emulator refusal in S3's protocol. */
function xmlError(status: number, code: string, headers: Record<string, string> = {}): Answer {
  return {
    status,
    headers: { 'content-type': 'application/xml', ...headers },
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>refused</Message></Error>`,
  };
}

/** An engine or emulator refusal in Step Functions' protocol. */
function jsonError(status: number, code: string, headers: Record<string, string> = {}): Answer {
  return {
    status,
    headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amzn-errortype': code, ...headers },
    body: JSON.stringify({ __type: code, message: 'refused' }),
  };
}

const CHALLENGE = { 'www-authenticate': 'EmuForge-Session' };

/** A session refusal in the request's own protocol, as the engine shapes it. */
function sessionRefusal(request: SentRequest, code = 'SessionInvalid'): Answer {
  if (request.method === 'HEAD') {
    return { status: 401, headers: CHALLENGE };
  }
  return isSfn(request) ? jsonError(401, code, CHALLENGE) : xmlError(401, code, CHALLENGE);
}

function headerValues(request: SentRequest, name: string): string[] {
  return Object.entries(request.headers)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);
}

function tokensOf(requests: SentRequest[]): string[][] {
  return requests.map((request) => headerValues(request, 'x-emuforge-session'));
}

function oneHeader(request: SentRequest, name: string): string {
  const values = headerValues(request, name);
  expect(values, `header ${name}`).toHaveLength(1);
  return values[0] ?? '';
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

async function hmac(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data));
}

async function signingKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  return hmac(await hmac(await hmac(await hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

// SigV4 of the request, computed here from the specification over the names the request says it signed.
async function expectValidSignature(request: SentRequest): Promise<void> {
  const match =
    /^AWS4-HMAC-SHA256 Credential=emuforge-studio\/(\d{8})\/(us-east-1)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
      oneHeader(request, 'authorization'),
    );
  expect(match).not.toBeNull();
  const [, date = '', region = '', service = '', names = '', signature = ''] = match ?? [];
  const canonicalQuery = Object.keys(request.query)
    .sort()
    .flatMap((key) => {
      const value = request.query[key];
      const values = value === null || value === undefined ? [''] : Array.isArray(value) ? [...value].sort() : [value];
      return values.map((v) => `${rfc3986(key)}=${rfc3986(v)}`);
    })
    .join('&');
  const canonicalHeaders = names
    .split(';')
    .map((name) => `${name}:${oneHeader(request, name).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const canonicalRequest = [
    request.method,
    request.path,
    canonicalQuery,
    canonicalHeaders,
    names,
    oneHeader(request, 'x-amz-content-sha256'),
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    oneHeader(request, 'x-amz-date'),
    `${date}/${region}/${service}/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  expect(signature).toBe(hex(await hmac(await signingKey(SECRET, date, region, service), stringToSign)));
  expect(names.split(';')).toContain('x-emuforge-session');
}

async function rejection(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('the command resolved');
}

function statusOf(error: Record<string, unknown>): unknown {
  return (error.$metadata as { httpStatusCode?: unknown } | undefined)?.httpStatusCode;
}

// Sessions are held per engine endpoint for the life of the page, so each case talks to an engine port of its own.
let nextPort = 8500;
function freshEndpoint(): string {
  nextPort += 1;
  return engineEndpoint(nextPort);
}

let engine: FakeEngine;
let endpoint: string;

function s3(at = endpoint): S3Client {
  return engine.attach(createS3Client({ endpoint: at }));
}

function sfn(at = endpoint): SFNClient {
  return engine.attach(createSfnClient({ endpoint: at }));
}

// The shared AWS files are redirected for every unit test by src/test/setup.ts.
beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  endpoint = freshEndpoint();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('obtaining the session', () => {
  it("asks the session route once, without a token or the page's credentials, before the first AWS request", async () => {
    await s3().send(new ListBucketsCommand({}));

    expect(engine.events).toEqual(['session', 'aws']);
    const [session] = engine.sessionRequests;
    expect(session?.url).toBe(`${endpoint}/__emuforge/session`);
    expect(session?.init?.method).toBe('GET');
    expect(new Headers(session?.init?.headers).has('x-emuforge-session')).toBe(false);
    expect(session?.init?.credentials).toBe('omit');
    expect(session?.init?.cache).toBe('no-store');
    expect(session?.init?.redirect).toBe('error');
    expect(tokensOf(engine.awsRequests)).toEqual([[T1]]);
  });

  it('reuses the token for a second command and for another client of the same endpoint', async () => {
    const client = s3();
    await client.send(new ListBucketsCommand({}));

    await client.send(new ListBucketsCommand({}));
    await sfn().send(new ListStateMachinesCommand({}));

    expect(engine.sessionRequests).toHaveLength(1);
    expect(tokensOf(engine.awsRequests)).toEqual([[T1], [T1], [T1]]);
  });

  it('shares one session request between commands of two new clients started together', async () => {
    const answer = deferred<SessionAnswer>();
    engine.session = () => answer.promise;

    const both = Promise.all([s3().send(new ListBucketsCommand({})), sfn().send(new ListStateMachinesCommand({}))]);
    await until(() => engine.sessionRequests.length > 0);
    await settle();
    expect(engine.awsRequests).toHaveLength(0);
    answer.resolve(tokenAnswer(T1));
    await both;

    expect(engine.sessionRequests).toHaveLength(1);
    expect(tokensOf(engine.awsRequests)).toEqual([[T1], [T1]]);
  });

  it('holds one session per engine port', async () => {
    const tokens: Record<string, string> = {
      [`${engineEndpoint(8314)}/__emuforge/session`]: 'emuforge-test-token-of-8314',
      [`${engineEndpoint(8315)}/__emuforge/session`]: 'emuforge-test-token-of-8315',
    };
    engine.session = (request) => tokenAnswer(tokens[request.url] ?? 'unexpected');

    await s3(engineEndpoint(8314)).send(new ListBucketsCommand({}));
    await s3(engineEndpoint(8315)).send(new ListBucketsCommand({}));

    expect(engine.sessionRequests.map((r) => r.url)).toEqual([
      'http://127.0.0.1:8314/__emuforge/session',
      'http://127.0.0.1:8315/__emuforge/session',
    ]);
    expect(engine.awsRequests.map((r) => headerValues(r, 'host'))).toEqual([['127.0.0.1:8314'], ['127.0.0.1:8315']]);
    expect(tokensOf(engine.awsRequests)).toEqual([['emuforge-test-token-of-8314'], ['emuforge-test-token-of-8315']]);
  });
});

describe('session not obtained', () => {
  it('rejects with EngineSessionError unreachable when the session request fails, sending nothing', async () => {
    engine.session = () => 'network-error';

    const error = await rejection(s3().send(new ListBucketsCommand({})));

    expect(error.name).toBe('EngineSessionError');
    expect(error.reason).toBe('unreachable');
    expect(engine.awsRequests).toHaveLength(0);
  });

  it('asks for a session again on the next command after a failed one', async () => {
    engine.session = (_, n) => (n === 0 ? 'network-error' : tokenAnswer(T2));
    const client = s3();
    await rejection(client.send(new ListBucketsCommand({})));

    await client.send(new ListBucketsCommand({}));

    expect(engine.sessionRequests).toHaveLength(2);
    expect(tokensOf(engine.awsRequests)).toEqual([[T2]]);
  });

  it('rejects with EngineSessionError refused, its status and code, when the session route is refused', async () => {
    engine.session = () => ({
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: '{"error":{"code":"OriginNotAllowed","message":"This origin may not open a session."}}',
    });

    const error = await rejection(s3().send(new ListBucketsCommand({})));

    expect(error.name).toBe('EngineSessionError');
    expect(error.reason).toBe('refused');
    expect(error.status).toBe(403);
    expect(error.code).toBe('OriginNotAllowed');
    expect(engine.awsRequests).toHaveLength(0);
  });

  it.each([
    ['a body that is not JSON', 'not json'],
    ['{}', '{}'],
    ['an empty token', '{"token": ""}'],
    ['a token with a space', '{"token": "a b"}'],
  ])('rejects a 200 session answer with %s as refused, status 200, no code', async (_, body) => {
    engine.session = () => ({ status: 200, headers: { 'content-type': 'application/json' }, body });

    const error = await rejection(s3().send(new ListBucketsCommand({})));

    expect(error.name).toBe('EngineSessionError');
    expect(error.reason).toBe('refused');
    expect(error.status).toBe(200);
    expect(error.code).toBeUndefined();
    expect(engine.awsRequests).toHaveLength(0);
  });
});

describe('renewal', () => {
  it('answers an S3 session refusal with one new session and one resend, signed again with the new token', async () => {
    engine.aws = (request) =>
      headerValues(request, 'x-emuforge-session')[0] === T1 ? sessionRefusal(request) : bucketList(['b1', 'b2']);

    const output = await s3().send(new ListBucketsCommand({}));

    expect(output.Buckets?.map((b) => b.Name)).toEqual(['b1', 'b2']);
    expect(engine.sessionRequests).toHaveLength(2);
    expect(tokensOf(engine.awsRequests)).toEqual([[T1], [T2]]);
    const resent = engine.awsRequests[1];
    expect(resent).toBeDefined();
    if (resent !== undefined) {
      await expectValidSignature(resent);
    }
  });

  it('recognises a 401 SessionInvalid by its code without the challenge header', async () => {
    engine.aws = (request) =>
      headerValues(request, 'x-emuforge-session')[0] === T1 ? xmlError(401, 'SessionInvalid') : bucketList(['b1']);

    const output = await s3().send(new ListBucketsCommand({}));

    expect(output.Buckets?.map((b) => b.Name)).toEqual(['b1']);
    expect(engine.sessionRequests).toHaveLength(2);
    expect(tokensOf(engine.awsRequests)).toEqual([[T1], [T2]]);
  });

  it('answers a Step Functions SessionRequired in JSON the same way', async () => {
    engine.aws = (request) =>
      headerValues(request, 'x-emuforge-session')[0] === T1
        ? sessionRefusal(request, 'SessionRequired')
        : success(request);

    const output = await sfn().send(new ListStateMachinesCommand({}));

    expect(output.stateMachines).toEqual([]);
    expect(engine.sessionRequests).toHaveLength(2);
    expect(tokensOf(engine.awsRequests)).toEqual([[T1], [T2]]);
  });

  it('recognises a HEAD refusal by its challenge header, with no body', async () => {
    engine.aws = (request) =>
      headerValues(request, 'x-emuforge-session')[0] === T1 ? sessionRefusal(request) : { status: 200 };

    await s3().send(new HeadBucketCommand({ Bucket: 'b' }));

    expect(engine.awsRequests.map((r) => r.method)).toEqual(['HEAD', 'HEAD']);
    expect(engine.sessionRequests).toHaveLength(2);
    expect(tokensOf(engine.awsRequests)).toEqual([[T1], [T2]]);
  });

  it('makes no third attempt when the resent request is refused too', async () => {
    engine.aws = (request) => sessionRefusal(request);

    const error = await rejection(s3().send(new ListBucketsCommand({})));

    expect(error.name).toBe('SessionInvalid');
    expect(statusOf(error)).toBe(401);
    expect(engine.awsRequests).toHaveLength(2);
    expect(engine.sessionRequests).toHaveLength(2);
  });

  it.each([
    ['S3 401 InvalidAccessKeyId', 'InvalidAccessKeyId', 401],
    ['S3 403 AccessDenied', 'AccessDenied', 403],
    ['Step Functions 501 NotImplemented', 'NotImplemented', 501],
  ])('passes %s through unchanged, with no session request', async (_, code, status) => {
    engine.aws = (request) => (isSfn(request) ? jsonError(status, code) : xmlError(status, code));
    const command =
      code === 'NotImplemented' ? sfn().send(new ListStateMachinesCommand({})) : s3().send(new ListBucketsCommand({}));

    const error = await rejection(command);

    expect(error.name).toBe(code);
    expect(statusOf(error)).toBe(status);
    expect(engine.awsRequests).toHaveLength(1);
    expect(engine.sessionRequests).toHaveLength(1);
  });

  it("leaves a 503 EmulatorUnavailable to the SDK's own retries, each with the held token", async () => {
    engine.aws = () => xmlError(503, 'EmulatorUnavailable');

    const error = await rejection(s3().send(new ListBucketsCommand({})));

    expect(error.name).toBe('EmulatorUnavailable');
    expect(engine.sessionRequests).toHaveLength(1);
    const first = engine.awsRequests[0];
    const max = /max=(\d+)/.exec(first === undefined ? '' : oneHeader(first, 'amz-sdk-request'))?.[1];
    expect(max).toBeDefined();
    expect(engine.awsRequests).toHaveLength(Number(max));
    expect(tokensOf(engine.awsRequests)).toEqual(engine.awsRequests.map(() => [T1]));
  });
});

describe('renewal shared between commands', () => {
  it('renews once for two commands refused at the same time, and resends each once with the new token', async () => {
    const refuse = deferred<undefined>();
    engine.aws = async (request) => {
      if (headerValues(request, 'x-emuforge-session')[0] !== T1) {
        return success(request);
      }
      await refuse.promise;
      return sessionRefusal(request);
    };
    const s3Client = s3();
    const sfnClient = sfn();

    const both = Promise.all([
      s3Client.send(new ListBucketsCommand({})),
      sfnClient.send(new ListStateMachinesCommand({})),
    ]);
    await until(() => engine.awsRequests.length === 2);
    refuse.resolve(undefined);
    await both;

    expect(engine.sessionRequests).toHaveLength(2);
    expect(tokensOf(engine.awsRequests.filter((r) => !isSfn(r)))).toEqual([[T1], [T2]]);
    expect(tokensOf(engine.awsRequests.filter(isSfn))).toEqual([[T1], [T2]]);
  });

  it('resends with a token another command already renewed, without a further session request', async () => {
    const refuseSfn = deferred<undefined>();
    engine.aws = async (request) => {
      if (headerValues(request, 'x-emuforge-session')[0] !== T1) {
        return success(request);
      }
      if (isSfn(request)) {
        await refuseSfn.promise;
      }
      return sessionRefusal(request);
    };
    const s3Client = s3();
    const sfnClient = sfn();

    const s3Command = s3Client.send(new ListBucketsCommand({}));
    const sfnCommand = sfnClient.send(new ListStateMachinesCommand({}));
    await s3Command;
    expect(engine.sessionRequests).toHaveLength(2);
    refuseSfn.resolve(undefined);
    await sfnCommand;

    expect(engine.sessionRequests).toHaveLength(2);
    expect(tokensOf(engine.awsRequests.filter(isSfn))).toEqual([[T1], [T2]]);
  });
});

describe('abort', () => {
  it('rejects an aborted waiter with the abort, sending nothing, and leaves the other waiter its session', async () => {
    const answer = deferred<SessionAnswer>();
    engine.session = () => answer.promise;
    const controller = new AbortController();

    const aborted = rejection(s3().send(new ListBucketsCommand({}), { abortSignal: controller.signal }));
    const waiting = sfn().send(new ListStateMachinesCommand({}));
    await until(() => engine.sessionRequests.length > 0);
    controller.abort();
    const error = await aborted;
    answer.resolve(tokenAnswer(T1));
    await waiting;

    expect(error.name).toBe('AbortError');
    expect(engine.sessionRequests).toHaveLength(1);
    expect(engine.awsRequests.filter((r) => !isSfn(r))).toEqual([]);
    expect(tokensOf(engine.awsRequests)).toEqual([[T1]]);
  });
});
