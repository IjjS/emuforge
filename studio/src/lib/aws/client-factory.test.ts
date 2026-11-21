import { DeleteFunctionCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ListStateMachinesCommand, SFNClient, StartSyncExecutionCommand } from '@aws-sdk/client-sfn';
import { APIGatewayClient, GetRestApisCommand } from '@aws-sdk/client-api-gateway';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { ListTopicsCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPageAt } from '../../test/home-test-kit';
import {
  createAwsClient,
  createS3Client,
  createSfnClient,
  EndpointRefusedError,
  engineEndpoint,
  RequestRefusedError,
  SettingRefusedError,
} from './client-factory';
import { bindAwsMutationAuthorization, sendRequest } from './request';

// The request as it would leave the client, after every build, signing and finalize step.
interface BuiltRequest {
  method: string;
  protocol: string;
  hostname: string;
  port?: number;
  path: string;
  query: Record<string, string | string[] | null>;
  headers: Record<string, string>;
  body?: unknown;
}

class RequestCaptured extends Error {
  readonly request: BuiltRequest;

  constructor(request: BuiltRequest) {
    super('request captured before it was sent');
    this.name = 'RequestCaptured';
    this.request = request;
  }
}

// Builds the request a command would send and stops it at the last step, so nothing goes on the network.
async function buildRequest(client: S3Client | SFNClient, send: () => Promise<unknown>): Promise<BuiltRequest> {
  (client as SFNClient).middlewareStack.add(
    () => (args) => {
      throw new RequestCaptured(args.request as BuiltRequest);
    },
    { step: 'deserialize', priority: 'low', name: 'captureRequest', override: true },
  );
  try {
    await send();
  } catch (error) {
    if (error instanceof RequestCaptured) {
      return error.request;
    }
    throw error;
  }
  throw new Error('the command completed without building a request');
}

function urlOf(request: BuiltRequest): string {
  return `${request.protocol}//${request.hostname}:${String(request.port)}${request.path}`;
}

const ENGINE_PORT = 8314;
const endpoint = engineEndpoint(ENGINE_PORT);

const SESSION_TOKEN = '5f0e3c9a1b7d24e68c3a9f1d0b2e4c6a8d7f9e1c3b5a7d9f0e2c4b6a8d0f1e3c';

// The engine answering the session route: every request to it gets `200 {"token": token}`, so no network is used.
function answerSessionRoute(token: string) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return Promise.resolve(
      new Response(JSON.stringify({ token }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

// Each case of the new describes below talks to its own engine port, so it starts with no session held.
let nextPort = 8400;
function freshEndpoint(): string {
  nextPort += 1;
  return engineEndpoint(nextPort);
}

/** Every value of header `name`, matched without regard to case. */
function headerValues(request: BuiltRequest, name: string): string[] {
  return Object.entries(request.headers)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value);
}

function oneHeader(request: BuiltRequest, name: string): string {
  const values = headerValues(request, name);
  expect(values, `header ${name}`).toHaveLength(1);
  return values[0] ?? '';
}

const SIGV4_AUTHORIZATION =
  /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/;

interface Authorization {
  keyId: string;
  date: string;
  region: string;
  service: string;
  signedNames: string[];
  signature: string;
}

function authorizationOf(request: BuiltRequest): Authorization {
  const value = oneHeader(request, 'authorization');
  const match = SIGV4_AUTHORIZATION.exec(value);
  expect(match, value).not.toBeNull();
  const [, keyId = '', date = '', region = '', service = '', names = '', signature = ''] = match ?? [];
  return { keyId, date, region, service, signedNames: names.split(';'), signature };
}

function expectSigV4Form(request: BuiltRequest, service: string): Authorization {
  const authorization = authorizationOf(request);
  expect(authorization.keyId).toBe('emuforge-studio');
  expect(authorization.region).toBe('us-east-1');
  expect(authorization.service).toBe(service);
  expect(authorization.signedNames).toEqual(expect.arrayContaining(['host', 'x-amz-date']));
  expect(oneHeader(request, 'x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
  expect(oneHeader(request, 'x-amz-date').slice(0, 8)).toBe(authorization.date);
  oneHeader(request, 'x-amz-content-sha256');
  return authorization;
}

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data));
}

async function hmac(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data));
}

async function signingKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  return hmac(await hmac(await hmac(await hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// SigV4 of the request, computed here from the specification over the names the request says it signed: canonical
// request, string to sign, HMAC-SHA256 key derivation with Web Crypto. Independent of the SDK's signer.
async function expectedSignature(request: BuiltRequest, secret: string): Promise<string> {
  const { date, region, service, signedNames } = authorizationOf(request);
  const canonicalQuery = Object.keys(request.query)
    .map(rfc3986)
    .sort()
    .flatMap((key) => {
      const value = request.query[decodeURIComponent(key)];
      const values = value === null || value === undefined ? [''] : Array.isArray(value) ? [...value].sort() : [value];
      return values.map((v) => `${key}=${rfc3986(v)}`);
    })
    .join('&');
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${oneHeader(request, name).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const canonicalRequest = [
    request.method,
    request.path,
    canonicalQuery,
    canonicalHeaders,
    signedNames.join(';'),
    oneHeader(request, 'x-amz-content-sha256'),
  ].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    oneHeader(request, 'x-amz-date'),
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  return hex(await hmac(await signingKey(secret, date, region, service), stringToSign));
}

function bodyBytes(body: unknown): string | Uint8Array<ArrayBuffer> {
  if (body === undefined || body === null) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  // A typed array may come from another realm than the test's, where `instanceof Uint8Array` does not hold: copy it.
  if (ArrayBuffer.isView(body)) {
    return Uint8Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  throw new Error(`unexpected request body ${typeof body}`);
}

beforeEach(() => {
  // In Vitest the SDK runs its Node configuration, which falls back to the shared AWS files for settings the
  // factory leaves to their defaults. Point those lookups at files that do not exist.
  vi.stubEnv('AWS_CONFIG_FILE', '/nonexistent/emuforge-studio-test/config');
  vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', '/nonexistent/emuforge-studio-test/credentials');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('createS3Client', () => {
  it('addresses bucket b and key k by path on the engine', async () => {
    answerSessionRoute(SESSION_TOKEN);
    const client = createS3Client({ endpoint });

    const request = await buildRequest(client, () => client.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' })));

    expect(urlOf(request)).toBe(`http://127.0.0.1:${String(ENGINE_PORT)}/b/k`);
    expect(request.headers['host']).toBe(`127.0.0.1:${String(ENGINE_PORT)}`);
    // The SDK addresses an IP endpoint by path on its own; the factory also sets path style for any bucket name.
    expect(client.config.forcePathStyle).toBe(true);
  });
});

describe('createSfnClient', () => {
  it('sends an operation with a host prefix to the engine host without the prefix', async () => {
    answerSessionRoute(SESSION_TOKEN);
    // StartSyncExecution carries host prefix `sync-`: an SDK client left at its defaults puts it in the host.
    const plain = new SFNClient({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: 'fixture-key-id', secretAccessKey: 'fixture-secret' },
    });
    const prefixed = await buildRequest(plain, () =>
      plain.send(new StartSyncExecutionCommand({ stateMachineArn: 'arn:aws:states:us-east-1:000000000000:sm' })),
    );
    expect(prefixed.hostname).toBe('sync-127.0.0.1');

    const client = createSfnClient({ endpoint });

    const request = await buildRequest(client, () =>
      client.send(new StartSyncExecutionCommand({ stateMachineArn: 'arn:aws:states:us-east-1:000000000000:sm' })),
    );

    expect(request.hostname).toBe('127.0.0.1');
    expect(request.headers['host']).toBe(`127.0.0.1:${String(ENGINE_PORT)}`);
    expect(urlOf(request)).toBe(`http://127.0.0.1:${String(ENGINE_PORT)}/`);
  });
});

describe('endpoint refusal', () => {
  const refused = [
    `http://localhost:${String(ENGINE_PORT)}`,
    `http://127.0.0.2:${String(ENGINE_PORT)}`,
    `http://[::1]:${String(ENGINE_PORT)}`,
    `http://192.168.1.10:${String(ENGINE_PORT)}`,
    `https://127.0.0.1:${String(ENGINE_PORT)}`,
    `http://127.0.0.1:${String(ENGINE_PORT)}/path`,
    'https://s3.amazonaws.com',
  ];
  const factories = [
    ['createS3Client', createS3Client],
    ['createSfnClient', createSfnClient],
  ] as const;

  for (const [name, create] of factories) {
    it.each(refused)(`${name} refuses %s, naming it`, (refusedEndpoint) => {
      let client: unknown;
      let thrown: unknown;
      try {
        client = create({ endpoint: refusedEndpoint });
      } catch (error) {
        thrown = error;
      }

      expect(client).toBeUndefined();
      expect(thrown).toBeInstanceOf(EndpointRefusedError);
      expect((thrown as EndpointRefusedError).message).toContain(`"${refusedEndpoint}"`);
      expect((thrown as EndpointRefusedError).endpoint).toBe(refusedEndpoint);
    });
  }

  it.each([0, 65536, 8297.5, Number.NaN])('engineEndpoint refuses port %s', (port) => {
    expect(() => engineEndpoint(port)).toThrow(EndpointRefusedError);
  });
});

describe('credentials', () => {
  const keyId = 'AKIAEMUFORGESTUDIOTEST';
  const secret = 'emuforge-studio-test-secret-access-key';
  const sessionToken = 'emuforge-studio-test-session-token';

  it('puts no key from the environment or browser storage in any request', async () => {
    answerSessionRoute(SESSION_TOKEN);
    vi.stubEnv('AWS_ACCESS_KEY_ID', keyId);
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', secret);
    vi.stubEnv('AWS_SESSION_TOKEN', sessionToken);
    for (const storage of [localStorage, sessionStorage]) {
      storage.setItem('aws_access_key_id', keyId);
      storage.setItem('aws_secret_access_key', secret);
      storage.setItem('aws_session_token', sessionToken);
    }
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    const s3 = createS3Client({ endpoint });
    const sfn = createSfnClient({ endpoint });
    const requests = [
      await buildRequest(s3, () => s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }))),
      await buildRequest(sfn, () => sfn.send(new ListStateMachinesCommand({}))),
      await buildRequest(sfn, () =>
        sfn.send(new StartSyncExecutionCommand({ stateMachineArn: 'arn:aws:states:us-east-1:000000000000:sm' })),
      ),
    ];

    for (const request of requests) {
      const sent = JSON.stringify({ ...request, body: String(request.body ?? '') });
      expect(sent).not.toContain(keyId);
      expect(sent).not.toContain(secret);
      expect(sent).not.toContain(sessionToken);
    }
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe('signing', () => {
  const secret = 'emuforge-studio-not-a-secret';
  const helloSha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  async function s3Requests(): Promise<BuiltRequest[]> {
    const s3 = createS3Client({ endpoint: freshEndpoint() });
    return [
      await buildRequest(s3, () => s3.send(new ListBucketsCommand({}))),
      await buildRequest(s3, () => s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }))),
    ];
  }

  async function sfnRequests(): Promise<BuiltRequest[]> {
    const sfn = createSfnClient({ endpoint: freshEndpoint() });
    return [
      await buildRequest(sfn, () => sfn.send(new ListStateMachinesCommand({}))),
      await buildRequest(sfn, () =>
        sfn.send(new StartSyncExecutionCommand({ stateMachineArn: 'arn:aws:states:us-east-1:000000000000:sm' })),
      ),
    ];
  }

  async function putHello(): Promise<BuiltRequest> {
    const s3 = createS3Client({ endpoint: freshEndpoint() });
    return buildRequest(s3, () =>
      s3.send(new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: new TextEncoder().encode('hello') })),
    );
  }

  beforeEach(() => {
    answerSessionRoute(SESSION_TOKEN);
  });

  it('signs S3 ListBuckets and GetObject in SigV4 header form for emuforge-studio and scope s3', async () => {
    for (const request of await s3Requests()) {
      expectSigV4Form(request, 's3');
    }
  });

  it('signs Step Functions ListStateMachines and StartSyncExecution for scope states, x-amz-target signed', async () => {
    for (const request of await sfnRequests()) {
      const { signedNames } = expectSigV4Form(request, 'states');
      expect(signedNames).toContain('x-amz-target');
    }
  });

  it('hashes the bytes of a PutObject body into x-amz-content-sha256, never a streaming value', async () => {
    const request = await putHello();

    expect(oneHeader(request, 'x-amz-content-sha256')).toBe(helloSha256);
    expect(await sha256Hex(bodyBytes(request.body))).toBe(helloSha256);
    for (const value of headerValues(request, 'x-amz-content-sha256')) {
      expect(value.startsWith('STREAMING-')).toBe(false);
    }
  });

  it('gives each request the SigV4 signature of its own signed names under the placeholder secret', async () => {
    const requests = [...(await s3Requests()), ...(await sfnRequests()), await putHello()];

    for (const request of requests) {
      expect(authorizationOf(request).signature).toBe(await expectedSignature(request, secret));
      expect(oneHeader(request, 'x-amz-content-sha256')).toBe(await sha256Hex(bodyBytes(request.body)));
      expect(Object.keys(request.query).filter((name) => name.toLowerCase().startsWith('x-amz-'))).toEqual([]);
      expect(headerValues(request, 'x-amz-security-token')).toEqual([]);
    }
  });

  it('signs with emuforge-studio whatever keys the environment and browser storage hold', async () => {
    const keyId = 'AKIAEMUFORGESTUDIOENV';
    const envSecret = 'emuforge-studio-env-secret-access-key';
    const sessionToken = 'emuforge-studio-env-session-token';
    const profile = 'emuforge-studio-env-profile';
    vi.stubEnv('AWS_ACCESS_KEY_ID', keyId);
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', envSecret);
    vi.stubEnv('AWS_SESSION_TOKEN', sessionToken);
    vi.stubEnv('AWS_PROFILE', profile);
    for (const storage of [localStorage, sessionStorage]) {
      storage.setItem('aws_access_key_id', keyId);
      storage.setItem('aws_secret_access_key', envSecret);
      storage.setItem('aws_session_token', sessionToken);
    }
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    const s3 = createS3Client({ endpoint: freshEndpoint() });
    const sfn = createSfnClient({ endpoint: freshEndpoint() });
    const requests = [
      await buildRequest(s3, () => s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }))),
      await buildRequest(sfn, () => sfn.send(new ListStateMachinesCommand({}))),
    ];

    for (const request of requests) {
      expect(authorizationOf(request).keyId).toBe('emuforge-studio');
      const sent = JSON.stringify({ ...request, body: String(request.body ?? '') });
      for (const value of [keyId, envSecret, sessionToken, profile]) {
        expect(sent).not.toContain(value);
      }
      expect(headerValues(request, 'x-amz-security-token')).toEqual([]);
    }
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe('session header', () => {
  it('sends the token of the session answer in X-EmuForge-Session only, on every request of every client', async () => {
    const token = 'a3f1c2e4b5d6978812ab34cd56ef7890a1b2c3d4e5f60718293a4b5c6d7e8f90';
    answerSessionRoute(token);
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const consoleSpies = methods.map((method) => vi.spyOn(console, method));
    const port = freshEndpoint();
    const s3 = createS3Client({ endpoint: port });
    const sfn = createSfnClient({ endpoint: port });

    const requests = [
      await buildRequest(s3, () => s3.send(new ListBucketsCommand({}))),
      await buildRequest(s3, () => s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }))),
      await buildRequest(sfn, () => sfn.send(new ListStateMachinesCommand({}))),
      await buildRequest(sfn, () =>
        sfn.send(new StartSyncExecutionCommand({ stateMachineArn: 'arn:aws:states:us-east-1:000000000000:sm' })),
      ),
    ];

    for (const request of requests) {
      expect(headerValues(request, 'x-emuforge-session')).toEqual([token]);
      expect(urlOf(request)).not.toContain(token);
      expect(JSON.stringify(request.query)).not.toContain(token);
    }
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    for (const spy of consoleSpies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
    }
  });
});

// The engine played at the page's `fetch` (issue 26): the session route answers `200 {"token": token}`, every other
// call is an AWS request, read as the request it makes and answered by `answer`. Nothing of the factory or the SDK
// is replaced.
interface PlayedEngine {
  awsRequests: Request[];
}

type AwsAnswer = (request: Request) => Response | Promise<Response>;

function playEngine(token: string, answer: AwsAnswer): PlayedEngine {
  const played: PlayedEngine = { awsRequests: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === '/__emuforge/session') {
        return Promise.resolve(
          new Response(JSON.stringify({ token }), { status: 200, headers: { 'content-type': 'application/json' } }),
        );
      }
      played.awsRequests.push(request);
      return Promise.resolve(answer(request));
    }),
  );
  return played;
}

const XML = { 'content-type': 'application/xml' };
const AMZ_JSON = { 'content-type': 'application/x-amz-json-1.0' };

// A plain success for each operation the cases send, the way the emulator shapes it.
function answerAsEmulator(request: Request): Response {
  const url = new URL(request.url);
  if (url.searchParams.get('list-type') === '2') {
    return new Response('<ListBucketResult><Name>b</Name><KeyCount>0</KeyCount></ListBucketResult>', {
      status: 200,
      headers: XML,
    });
  }
  if (request.method === 'GET' && url.pathname === '/') {
    return new Response('<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>', {
      status: 200,
      headers: XML,
    });
  }
  if (request.method === 'POST') {
    const target = request.headers.get('x-amz-target') ?? '';
    const body = target.endsWith('ListStateMachines')
      ? { stateMachines: [] }
      : {
          executionArn: 'arn:aws:states:us-east-1:000000000000:execution:sm:e',
          startDate: 0,
          stopDate: 0,
          status: 'SUCCEEDED',
        };
    return new Response(JSON.stringify(body), { status: 200, headers: AMZ_JSON });
  }
  if (request.method === 'DELETE') {
    return new Response(null, { status: 204 });
  }
  if (request.method === 'GET') {
    return new Response('hello', { status: 200, headers: { 'content-type': 'binary/octet-stream' } });
  }
  return new Response(null, { status: 200 });
}

const STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:000000000000:stateMachine:sm';

describe('requests at the page fetch', () => {
  it('sends GetObject, HeadObject, ListObjectsV2 and ListBuckets as GET or HEAD with cache no-store', async () => {
    const played = playEngine(SESSION_TOKEN, answerAsEmulator);
    const s3 = createS3Client({ endpoint });
    const sends = [
      () => s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' })),
      () => s3.send(new HeadObjectCommand({ Bucket: 'b', Key: 'k' })),
      () => s3.send(new ListObjectsV2Command({ Bucket: 'b' })),
      () => s3.send(new ListBucketsCommand({})),
    ];

    for (const send of sends) {
      const before = played.awsRequests.length;
      await send();
      const sent = played.awsRequests.slice(before);

      expect(sent).toHaveLength(1);
      const [request] = sent;
      expect(['GET', 'HEAD']).toContain(request?.method);
      expect(request?.url.startsWith(`http://127.0.0.1:${String(ENGINE_PORT)}/`)).toBe(true);
      expect(request?.cache).toBe('no-store');
    }
  });

  it('sends PutObject, DeleteObject, CreateBucket, ListStateMachines and StartSyncExecution with cache default', async () => {
    const played = playEngine(SESSION_TOKEN, answerAsEmulator);
    const s3 = createS3Client({ endpoint });
    const sfn = createSfnClient({ endpoint });
    const sends: [string, () => Promise<unknown>][] = [
      ['PUT', () => s3.send(new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: encoder.encode('hello') }))],
      ['DELETE', () => s3.send(new DeleteObjectCommand({ Bucket: 'b', Key: 'k' }))],
      ['PUT', () => s3.send(new CreateBucketCommand({ Bucket: 'b' }))],
      ['POST', () => sfn.send(new ListStateMachinesCommand({}))],
      ['POST', () => sfn.send(new StartSyncExecutionCommand({ stateMachineArn: STATE_MACHINE_ARN }))],
    ];

    for (const [method, send] of sends) {
      const before = played.awsRequests.length;
      await send();
      const sent = played.awsRequests.slice(before);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.method).toBe(method);
      expect(sent[0]?.cache).toBe('default');
    }
  });

  it('adds no cache header to PutObject and sends the CacheControl the command gives as it is', async () => {
    const played = playEngine(SESSION_TOKEN, answerAsEmulator);
    const s3 = createS3Client({ endpoint });

    await s3.send(new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: encoder.encode('hello') }));
    await s3.send(
      new PutObjectCommand({ Bucket: 'b', Key: 'k', Body: encoder.encode('hello'), CacheControl: 'max-age=60' }),
    );

    const [without, withCacheControl] = played.awsRequests;
    expect(played.awsRequests).toHaveLength(2);
    expect(without?.headers.has('cache-control')).toBe(false);
    expect(without?.headers.has('pragma')).toBe(false);
    expect(withCacheControl?.headers.get('cache-control')).toBe('max-age=60');
  });

  it('carries the session token once and the SigV4 authorization of emuforge-studio on each AWS request', async () => {
    const token = 'c4d2e6f8a0b1c3d5e7f9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0';
    const played = playEngine(token, answerAsEmulator);
    const port = freshEndpoint();
    const s3 = createS3Client({ endpoint: port });
    const sfn = createSfnClient({ endpoint: port });

    await s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));
    await sfn.send(new ListStateMachinesCommand({}));

    expect(played.awsRequests).toHaveLength(2);
    for (const request of played.awsRequests) {
      // A header sent twice would read here as both values joined by a comma.
      expect(request.headers.get('x-emuforge-session')).toBe(token);
      expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=emuforge-studio\//);
    }
  });

  it('resolves GetObject with the body the engine answers', async () => {
    playEngine(SESSION_TOKEN, () => new Response(encoder.encode('hello'), { status: 200 }));
    const s3 = createS3Client({ endpoint });

    const result = await s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));

    expect(await result.Body?.transformToString()).toBe('hello');
  });

  it('rejects GetObject with NoSuchKey when the engine answers 404 NoSuchKey', async () => {
    playEngine(
      SESSION_TOKEN,
      () =>
        new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>k</Key></Error>',
          { status: 404, headers: XML },
        ),
    );
    const s3 = createS3Client({ endpoint });

    const sent = s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));

    await expect(sent).rejects.toMatchObject({ name: 'NoSuchKey' });
  });

  it('ends a GetObject the engine does not answer when its abortSignal aborts', async () => {
    const played = playEngine(SESSION_TOKEN, () => new Promise<Response>(() => undefined));
    const s3 = createS3Client({ endpoint });
    const controller = new AbortController();

    const sent = s3.send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }), { abortSignal: controller.signal });
    await vi.waitFor(() => {
      expect(played.awsRequests).toHaveLength(1);
    });
    controller.abort();

    await expect(sent).rejects.toMatchObject({ name: 'AbortError' });
    expect(played.awsRequests[0]?.signal.aborted).toBe(true);
  });
});

// The factory's general function (issue 386, requirement R6.1 to R6.4, R6.7): clients of classes handed to it, each
// sending at the page's `fetch` to an engine the test plays.

const SESSION_PATH = '/__emuforge/session';
const AMZ_JSON_1_0 = { 'content-type': 'application/x-amz-json-1.0' };
const AWS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/000000000000/q';
const QUEUE_ARN = 'arn:aws:sqs:us-east-1:000000000000:q';

/** The engine played at the page's `fetch`: the n-th session request gets the n-th of `tokens` (the last again). */
function playEngineTokens(tokens: string[], answer: AwsAnswer) {
  const played = { sessionRequests: 0, awsRequests: [] as Request[], fetch: vi.fn() };
  played.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === SESSION_PATH) {
      const token = tokens[Math.min(played.sessionRequests, tokens.length - 1)] ?? '';
      played.sessionRequests += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ token }), { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    }
    played.awsRequests.push(request);
    return Promise.resolve(answer(request));
  });
  vi.stubGlobal('fetch', played.fetch);
  return played;
}

describe('browser authorization for destructive AWS attempts', () => {
  function deleteWithAuthorization(client: LambdaClient) {
    const controller = new AbortController();
    const dispose = bindAwsMutationAuthorization(controller);
    const result = sendRequest(
      'DeleteFunction',
      (abortSignal) => client.send(new DeleteFunctionCommand({ FunctionName: 'orders' }), { abortSignal }),
      controller.signal,
    ).finally(dispose);
    return { result, signal: controller.signal };
  }

  function reconnect() {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  }

  function heldResponse() {
    let respond!: (answer: Response) => void;
    const answer = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    return { answer, respond };
  }

  it('blocks the repeat attempt after held session renewal until a new confirmation', async () => {
    const renewal = heldResponse();
    const sent: Request[] = [];
    const sessionAnswer = (token: string) => Response.json({ token });
    let sessionRequests = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === SESSION_PATH) {
        sessionRequests += 1;
        return sessionRequests === 1 ? Promise.resolve(sessionAnswer('old-session')) : renewal.answer;
      }
      sent.push(request);
      return Promise.resolve(
        sent.length === 1
          ? new Response(JSON.stringify({ message: 'Session refused' }), {
              status: 401,
              headers: { 'x-amzn-errortype': 'SessionInvalid', 'www-authenticate': 'EmuForge-Session' },
            })
          : new Response(null, { status: 204 }),
      );
    });
    const client = createAwsClient(LambdaClient, { endpoint: freshEndpoint() });
    const original = deleteWithAuthorization(client);
    const refused = expect(original.result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(sessionRequests).toBe(2));
    expect(sent.map((request) => request.method)).toEqual(['DELETE']);

    reconnect();
    renewal.respond(sessionAnswer('replacement-session'));
    await refused;
    expect(sent).toHaveLength(1);

    await deleteWithAuthorization(client).result;
    expect(sent.map((request) => request.headers.get('x-emuforge-session'))).toEqual([
      'old-session',
      'replacement-session',
    ]);
  });

  it('blocks the SDK retry of a 503 after browser reconnect', async () => {
    const refusal = heldResponse();
    let attempts = 0;
    const engine = playEngine(SESSION_TOKEN, () => {
      attempts += 1;
      return attempts === 1 ? refusal.answer : new Response(null, { status: 204 });
    });
    const client = createAwsClient(LambdaClient, { endpoint: freshEndpoint() });
    const original = deleteWithAuthorization(client);
    const refused = expect(original.result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(engine.awsRequests).toHaveLength(1));

    reconnect();
    refusal.respond(
      new Response(JSON.stringify({ message: 'Emulator unavailable' }), {
        status: 503,
        headers: { 'x-amzn-errortype': 'EmulatorUnavailable' },
      }),
    );
    await refused;
    expect(engine.awsRequests.map((request) => request.method)).toEqual(['DELETE']);

    await deleteWithAuthorization(client).result;
    expect(engine.awsRequests).toHaveLength(2);
  });

  it('keeps the result of an already relayed deletion across browser reconnect', async () => {
    const held = heldResponse();
    const engine = playEngine(SESSION_TOKEN, () => held.answer);
    const client = createAwsClient(LambdaClient, { endpoint: freshEndpoint() });
    const deletion = deleteWithAuthorization(client);
    await vi.waitFor(() => expect(engine.awsRequests).toHaveLength(1));

    reconnect();
    expect(deletion.signal.aborted).toBe(false);
    held.respond(new Response(null, { status: 204 }));
    await deletion.result;
    expect(engine.awsRequests).toHaveLength(1);
  });
});

// A plain success for each operation of the general clients, in the shape of its protocol.
function answerGeneral(request: Request): Response {
  const target = request.headers.get('x-amz-target') ?? '';
  if (target === 'DynamoDB_20120810.ListTables') {
    return new Response('{"TableNames":[]}', { status: 200, headers: AMZ_JSON_1_0 });
  }
  if (target === 'AmazonSQS.GetQueueAttributes') {
    return new Response(JSON.stringify({ Attributes: { QueueArn: QUEUE_ARN } }), {
      status: 200,
      headers: AMZ_JSON_1_0,
    });
  }
  if (target.startsWith('AWSStepFunctions.')) {
    return new Response('{"stateMachines":[]}', { status: 200, headers: AMZ_JSON_1_0 });
  }
  if (new URL(request.url).pathname === '/restapis') {
    return new Response('{"item":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (request.method === 'POST') {
    return new Response(
      '<ListTopicsResponse><ListTopicsResult><Topics></Topics></ListTopicsResult></ListTopicsResponse>',
      { status: 200, headers: XML },
    );
  }
  return answerAsEmulator(request);
}

/** The URL `fetch` was called with. */
function fetchedUrl(input: unknown): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

function originOf(request: Request): string {
  return new URL(request.url).origin;
}

/** The request as text: its URL, its headers and its body. */
async function sentText(request: Request): Promise<string> {
  return JSON.stringify({
    url: request.url,
    headers: [...request.headers.entries()],
    body: await request.clone().text(),
  });
}

describe('createAwsClient', () => {
  const keyId = 'AKIAEMUFORGEGENERALTEST';
  const envSecret = 'emuforge-general-test-secret-access-key';
  const envSessionToken = 'emuforge-general-test-session-token';

  it('sends SNS ListTopics, DynamoDB ListTables and API Gateway GetRestApis once each to the engine, with the session token, signed as emuforge-studio in us-east-1 and with no other key', async () => {
    const token = 'b7e1d3f5a9c0b2d4e6f8a0c2e4b6d8f0a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1';
    const played = playEngineTokens([token], answerGeneral);
    vi.stubEnv('AWS_ACCESS_KEY_ID', keyId);
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', envSecret);
    vi.stubEnv('AWS_SESSION_TOKEN', envSessionToken);
    for (const storage of [localStorage, sessionStorage]) {
      storage.setItem('aws_access_key_id', keyId);
      storage.setItem('aws_secret_access_key', envSecret);
      storage.setItem('aws_session_token', envSessionToken);
    }
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const port = freshEndpoint();
    const sns = createAwsClient(SNSClient, { endpoint: port });
    const dynamodb = createAwsClient(DynamoDBClient, { endpoint: port });
    const apigateway = createAwsClient(APIGatewayClient, { endpoint: port });
    const sends: [string, () => Promise<unknown>][] = [
      ['sns', () => sns.send(new ListTopicsCommand({}))],
      ['dynamodb', () => dynamodb.send(new ListTablesCommand({}))],
      ['apigateway', () => apigateway.send(new GetRestApisCommand({}))],
    ];

    for (const [service, send] of sends) {
      const before = played.awsRequests.length;
      await send();
      const sent = played.awsRequests.slice(before);

      expect(sent, service).toHaveLength(1);
      const [request] = sent;
      if (request === undefined) {
        continue;
      }
      expect(originOf(request)).toBe(port);
      expect(request.headers.get('x-emuforge-session')).toBe(token);
      expect(request.headers.get('authorization')).toMatch(
        new RegExp(`^AWS4-HMAC-SHA256 Credential=emuforge-studio/\\d{8}/us-east-1/${service}/aws4_request, `),
      );
      expect(request.headers.has('x-amz-security-token')).toBe(false);
      const text = await sentText(request);
      for (const value of [keyId, envSecret, envSessionToken]) {
        expect(text).not.toContain(value);
      }
    }
    expect(getItem).not.toHaveBeenCalled();
  });

  it('sends API Gateway GetRestApis as a GET with cache no-store, and SNS ListTopics as a POST with cache default', async () => {
    const played = playEngine(SESSION_TOKEN, answerGeneral);
    const apigateway = createAwsClient(APIGatewayClient, { endpoint });
    const sns = createAwsClient(SNSClient, { endpoint });

    await apigateway.send(new GetRestApisCommand({}));
    await sns.send(new ListTopicsCommand({}));

    const [get, post] = played.awsRequests;
    expect(played.awsRequests).toHaveLength(2);
    expect(get?.method).toBe('GET');
    expect(get?.cache).toBe('no-store');
    expect(post?.method).toBe('POST');
    expect(post?.cache).toBe('default');
  });

  it('sends a Step Functions operation with a host prefix to the engine host without the prefix', async () => {
    answerSessionRoute(SESSION_TOKEN);
    const client = createAwsClient(SFNClient, { endpoint });

    const request = await buildRequest(client, () =>
      client.send(new StartSyncExecutionCommand({ stateMachineArn: 'arn:aws:states:us-east-1:000000000000:sm' })),
    );

    expect(request.hostname).toBe('127.0.0.1');
    expect(request.headers['host']).toBe(`127.0.0.1:${String(ENGINE_PORT)}`);
    expect(urlOf(request)).toBe(`http://127.0.0.1:${String(ENGINE_PORT)}/`);
  });

  it('answers a session refusal with one new session and one resend with the new token, and resolves', async () => {
    const [first, second] = ['emuforge-general-token-1-5c2e', 'emuforge-general-token-2-9a4d'];
    const played = playEngineTokens([first, second], (request) =>
      request.headers.get('x-emuforge-session') === first
        ? new Response(JSON.stringify({ __type: 'SessionInvalid', message: 'refused' }), {
            status: 401,
            headers: { ...AMZ_JSON_1_0, 'x-amzn-errortype': 'SessionInvalid', 'www-authenticate': 'EmuForge-Session' },
          })
        : answerGeneral(request),
    );
    const dynamodb = createAwsClient(DynamoDBClient, { endpoint: freshEndpoint() });

    const output = await dynamodb.send(new ListTablesCommand({}));

    expect(output.TableNames).toEqual([]);
    expect(played.sessionRequests).toBe(2);
    expect(played.awsRequests.map((request) => request.headers.get('x-emuforge-session'))).toEqual([first, second]);
  });

  it.each([
    `http://localhost:${String(ENGINE_PORT)}`,
    `https://127.0.0.1:${String(ENGINE_PORT)}`,
    `http://127.0.0.1:${String(ENGINE_PORT)}/path`,
    'https://sns.us-east-1.amazonaws.com',
  ])('refuses the address %s, naming it, making no client and sending nothing', (refusedEndpoint) => {
    const played = playEngine(SESSION_TOKEN, answerGeneral);
    let client: unknown;
    let thrown: unknown;
    try {
      client = createAwsClient(SNSClient, { endpoint: refusedEndpoint });
    } catch (error) {
      thrown = error;
    }

    expect(client).toBeUndefined();
    expect(thrown).toBeInstanceOf(EndpointRefusedError);
    expect((thrown as EndpointRefusedError).message).toContain(`"${refusedEndpoint}"`);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(played.awsRequests).toEqual([]);
  });

  it('makes an SQS client given useQueueUrlAsEndpoint false, whose request goes to the engine', async () => {
    const played = playEngine(SESSION_TOKEN, answerGeneral);
    const sqs = createAwsClient(SQSClient, { endpoint }, { useQueueUrlAsEndpoint: false });

    const output = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: AWS_QUEUE_URL, AttributeNames: ['QueueArn'] }),
    );

    expect(output.Attributes?.QueueArn).toBe(QUEUE_ARN);
    expect(played.awsRequests.map(originOf)).toEqual([endpoint]);
  });

  it('sends an SQS GetQueueAttributes by a queue URL on an AWS host to the engine, with no setting of its own', async () => {
    const played = playEngine(SESSION_TOKEN, answerGeneral);
    const port = freshEndpoint();
    const sqs = createAwsClient(SQSClient, { endpoint: port });

    const output = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: AWS_QUEUE_URL, AttributeNames: ['QueueArn'] }),
    );

    expect(output.Attributes?.QueueArn).toBe(QUEUE_ARN);
    expect(played.awsRequests.map(originOf)).toEqual([port]);
    // The session request and the command: nothing else was fetched.
    expect(vi.mocked(fetch).mock.calls.map(([input]) => fetchedUrl(input).origin)).toEqual([port, port]);
  });

  const factorySettings: [string, unknown][] = [
    ['endpoint', `http://127.0.0.1:${String(ENGINE_PORT + 1)}`],
    ['endpointProvider', () => ({ url: new URL('https://sns.us-east-1.amazonaws.com') })],
    ['region', 'eu-west-1'],
    ['disableHostPrefix', false],
    ['useDualstackEndpoint', true],
    ['useFipsEndpoint', true],
    ['credentials', { accessKeyId: 'fixture-key-id', secretAccessKey: 'fixture-secret' }],
    ['requestHandler', new FetchHttpHandler()],
    [
      'extensions',
      [
        {
          configure(configuration: {
            setHttpHandler(handler: FetchHttpHandler): void;
            setRegion(region: string): void;
          }) {
            configuration.setHttpHandler(new FetchHttpHandler());
            configuration.setRegion('eu-west-1');
          },
        },
      ],
    ],
  ];

  it.each(factorySettings)('refuses the setting %s beside the class, naming it, and makes no client', (name, value) => {
    let client: unknown;
    let thrown: unknown;
    try {
      client = createAwsClient(SNSClient, { endpoint }, { [name]: value } as never);
    } catch (error) {
      thrown = error;
    }

    expect(client).toBeUndefined();
    expect(thrown).toBeInstanceOf(SettingRefusedError);
    expect((thrown as SettingRefusedError).setting).toBe(name);
    expect((thrown as SettingRefusedError).message).toContain(`"${name}"`);
  });

  it('takes no setting of the factory in its type', () => {
    // @ts-expect-error -- the region is the factory's.
    expect(() => createAwsClient(SNSClient, { endpoint }, { region: 'eu-west-1' })).toThrow(SettingRefusedError);
    // @ts-expect-error -- an extension can set the factory's request handler, region and credential.
    expect(() => createAwsClient(SNSClient, { endpoint }, { extensions: [] })).toThrow(SettingRefusedError);
  });
});

// A step added between the SDK and the send that moves the request elsewhere, as a client's own middleware could.
type Move = (request: { protocol: string; hostname: string; port?: number }) => void;

function moveRequest(client: { middlewareStack: unknown }, move: Move): void {
  (client as SFNClient).middlewareStack.add(
    (next) => (args) => {
      move(args.request as { protocol: string; hostname: string; port?: number });
      return next(args);
    },
    { step: 'deserialize', priority: 'low', name: 'moveRequest', override: true },
  );
}

describe('requests that are not for the engine', () => {
  const clients: [string, string, () => { client: { middlewareStack: unknown }; send: () => Promise<unknown> }][] = [
    [
      'a general client (SNS)',
      'sns.us-east-1.amazonaws.com',
      () => {
        const client = createAwsClient(SNSClient, { endpoint });
        return { client, send: () => client.send(new ListTopicsCommand({})) };
      },
    ],
    [
      'the S3 client',
      's3.us-east-1.amazonaws.com',
      () => {
        const client = createS3Client({ endpoint });
        return { client, send: () => client.send(new ListBucketsCommand({})) };
      },
    ],
    [
      'the Step Functions client',
      'states.us-east-1.amazonaws.com',
      () => {
        const client = createSfnClient({ endpoint });
        return { client, send: () => client.send(new ListStateMachinesCommand({})) };
      },
    ],
  ];

  it.each(clients)('%s moved to %s rejects, naming the host, and sends nothing', async (_, host, make) => {
    const played = playEngine(SESSION_TOKEN, answerGeneral);
    const { client, send } = make();
    moveRequest(client, (request) => {
      request.protocol = 'https:';
      request.hostname = host;
      request.port = 443;
    });

    const error: unknown = await send().then(
      () => undefined,
      (rejected: unknown) => rejected,
    );

    expect(error).toBeInstanceOf(RequestRefusedError);
    expect((error as RequestRefusedError).host).toBe(host);
    expect((error as RequestRefusedError).message).toContain(host);
    expect(played.awsRequests).toEqual([]);
    for (const [input] of vi.mocked(fetch).mock.calls) {
      expect(fetchedUrl(input).pathname).toBe(SESSION_PATH);
    }
  });

  const moves: [string, string, Move][] = [
    [
      'only the scheme',
      `https://127.0.0.1:${String(ENGINE_PORT)}`,
      (request) => {
        request.protocol = 'https:';
      },
    ],
    [
      'only the port',
      `http://127.0.0.1:${String(ENGINE_PORT + 1)}`,
      (request) => {
        request.port = ENGINE_PORT + 1;
      },
    ],
  ];

  for (const [what, origin, move] of moves) {
    it.each(clients)(`%s with ${what} changed rejects, naming ${origin}, and sends nothing`, async (_, __, make) => {
      const played = playEngine(SESSION_TOKEN, answerGeneral);
      const { client, send } = make();
      moveRequest(client, move);

      const error: unknown = await send().then(
        () => undefined,
        (rejected: unknown) => rejected,
      );

      expect(error).toBeInstanceOf(RequestRefusedError);
      expect((error as RequestRefusedError).origin).toBe(origin);
      expect((error as RequestRefusedError).message).toContain(origin);
      expect(played.awsRequests).toEqual([]);
      for (const [input] of vi.mocked(fetch).mock.calls) {
        expect(fetchedUrl(input).pathname).toBe(SESSION_PATH);
      }
    });
  }
});

// Issue 503: the page opened under an allowed host name, whose configuration names the channel `/__engine` on
// Studio's port. Each case loads the factory afresh, so it holds no session of an earlier case and has the channel
// path recorded as the page's configuration records it.

const PAGE = 'https://name.test:8296';
const CHANNEL = `${PAGE}/__engine`;
const CHANNEL_SESSION = '/__engine/__emuforge/session';

async function channelFactory() {
  vi.resetModules();
  const base = await import('../engine/engine-base');
  const factory = await import('./client-factory');
  base.acceptEnginePath('/__engine');
  return factory;
}

/** The engine played behind the channel: the session at `<channel>/__emuforge/session`, AWS answers as `answer`. */
function playChannel(answer: AwsAnswer = answerGeneral) {
  const played = { sessionUrls: [] as string[], awsRequests: [] as Request[] };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === CHANNEL_SESSION) {
        played.sessionUrls.push(request.url);
        return Promise.resolve(
          new Response(JSON.stringify({ token: SESSION_TOKEN }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      played.awsRequests.push(request);
      return Promise.resolve(answer(request));
    }),
  );
  return played;
}

describe('the channel through Studio’s port (issue 503)', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = openPageAt(`${PAGE}/aws`);
  });

  afterEach(() => {
    restore();
  });

  it('S3 ListBuckets, PutObject of key a/b c and GetObject go under <channel>/ by path, with the token', async () => {
    playChannel();
    const { createS3Client: create } = await channelFactory();
    const client = create({ endpoint: CHANNEL });

    const list = await buildRequest(client, () => client.send(new ListBucketsCommand({})));
    const put = await buildRequest(client, () =>
      client.send(new PutObjectCommand({ Bucket: 'b', Key: 'a/b c', Body: 'x' })),
    );
    const get = await buildRequest(client, () => client.send(new GetObjectCommand({ Bucket: 'b', Key: 'a/b c' })));

    expect([list, put, get].map((request) => `${request.method} ${urlOf(request)}`)).toEqual([
      `GET ${PAGE}/__engine/`,
      `PUT ${PAGE}/__engine/b/a/b%20c`,
      `GET ${PAGE}/__engine/b/a/b%20c`,
    ]);
    for (const request of [list, put, get]) {
      expect(oneHeader(request, 'host')).toBe('name.test:8296');
      expect(oneHeader(request, 'x-emuforge-session')).toBe(SESSION_TOKEN);
    }
  });

  it('S3 ListBuckets is sent at the page fetch to <channel>/ and resolves', async () => {
    const played = playChannel(
      () =>
        new Response('<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>', {
          status: 200,
          headers: XML,
        }),
    );
    const { createS3Client: create } = await channelFactory();
    const client = create({ endpoint: CHANNEL });

    const sent = client.send(new ListBucketsCommand({}));

    await expect(sent).resolves.toMatchObject({ $metadata: { httpStatusCode: 200 } });
    expect(played.awsRequests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${PAGE}/__engine/?x-id=ListBuckets`,
    ]);
    expect(played.awsRequests[0]?.headers.get('x-emuforge-session')).toBe(SESSION_TOKEN);
  });

  it('Step Functions, a JSON-protocol (DynamoDB) and a Query-protocol (SNS) client each POST <channel>/', async () => {
    const played = playChannel();
    const { createSfnClient: createSfn, createAwsClient: create } = await channelFactory();

    await createSfn({ endpoint: CHANNEL }).send(new ListStateMachinesCommand({}));
    await create(DynamoDBClient, { endpoint: CHANNEL }).send(new ListTablesCommand({}));
    await create(SNSClient, { endpoint: CHANNEL }).send(new ListTopicsCommand({}));

    expect(played.awsRequests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST ${PAGE}/__engine/`,
      `POST ${PAGE}/__engine/`,
      `POST ${PAGE}/__engine/`,
    ]);
    for (const request of played.awsRequests) {
      expect(request.headers.get('x-emuforge-session')).toBe(SESSION_TOKEN);
    }
  });

  it('asks the session at <channel>/__emuforge/session, once for every client of the channel', async () => {
    const played = playChannel();
    const { createSfnClient: createSfn, createAwsClient: create, createS3Client: createS3 } = await channelFactory();

    await createSfn({ endpoint: CHANNEL }).send(new ListStateMachinesCommand({}));
    await create(DynamoDBClient, { endpoint: CHANNEL }).send(new ListTablesCommand({}));
    await create(SNSClient, { endpoint: CHANNEL }).send(new ListTopicsCommand({}));
    const s3 = createS3({ endpoint: CHANNEL });
    await buildRequest(s3, () => s3.send(new ListBucketsCommand({})));

    expect(played.sessionUrls).toEqual([`${CHANNEL}/__emuforge/session`]);
  });

  it('sends a command with a host prefix (StartSyncExecution) to name.test:8296, without the prefix', async () => {
    playChannel();
    const { createSfnClient: createSfn } = await channelFactory();
    const client = createSfn({ endpoint: CHANNEL });

    const request = await buildRequest(client, () =>
      client.send(new StartSyncExecutionCommand({ stateMachineArn: 'arn:aws:states:us-east-1:000000000000:sm' })),
    );

    expect(request.hostname).toBe('name.test');
    expect(oneHeader(request, 'host')).toBe('name.test:8296');
    expect(urlOf(request)).toBe(`${PAGE}/__engine/`);
  });

  type PathMove = (request: { protocol: string; hostname: string; port?: number; path: string }) => void;
  const moves: [string, PathMove][] = [
    [
      'another host',
      (request) => {
        request.hostname = 'other.test';
      },
    ],
    [
      'another scheme',
      (request) => {
        request.protocol = 'http:';
      },
    ],
    [
      'another port',
      (request) => {
        request.port = 8297;
      },
    ],
    [
      'a path beside the channel',
      (request) => {
        request.path = '/config.json';
      },
    ],
    [
      'a path that starts with the channel’s name only',
      (request) => {
        request.path = '/__enginex/';
      },
    ],
    [
      'a path that leaves the channel by a dot segment',
      (request) => {
        request.path = '/__engine/../config.json';
      },
    ],
    [
      'a path that leaves the channel by an encoded dot segment',
      (request) => {
        request.path = '/__engine/%2e%2e/config.json';
      },
    ],
    [
      'a network path',
      (request) => {
        request.path = '//other.test/__engine/';
      },
    ],
  ];

  it.each(moves)('a request moved to %s is refused with RequestRefusedError, nothing sent', async (_what, move) => {
    const played = playChannel();
    const factory = await channelFactory();
    const clients = [
      factory.createS3Client({ endpoint: CHANNEL }),
      factory.createSfnClient({ endpoint: CHANNEL }),
      factory.createAwsClient(SNSClient, { endpoint: CHANNEL }),
    ];
    const commands = [new ListBucketsCommand({}), new ListStateMachinesCommand({}), new ListTopicsCommand({})];

    for (const [at, client] of clients.entries()) {
      (client as unknown as SFNClient).middlewareStack.add(
        (next) => (args) => {
          move(args.request as { protocol: string; hostname: string; port?: number; path: string });
          return next(args);
        },
        { step: 'deserialize', priority: 'low', name: 'moveRequest', override: true },
      );
      const error: unknown = await (client as unknown as SFNClient)
        .send(commands[at] as unknown as ListStateMachinesCommand)
        .then(
          () => undefined,
          (rejected: unknown) => rejected,
        );
      expect(error).toBeInstanceOf(factory.RequestRefusedError);
    }
    expect(played.awsRequests).toEqual([]);
  });

  it.each([
    'https://other.test/__engine',
    PAGE,
    `${PAGE}/other`,
    `${PAGE}/__engine/x`,
    'http://127.0.0.1:8400/__engine',
    'https://amazonaws.com',
  ])('createAwsClient refuses the endpoint %s with EndpointRefusedError, and makes no client', async (refused) => {
    const factory = await channelFactory();
    let client: unknown;
    let thrown: unknown;
    try {
      client = factory.createAwsClient(SNSClient, { endpoint: refused });
    } catch (error) {
      thrown = error;
    }

    expect(client).toBeUndefined();
    expect(thrown).toBeInstanceOf(factory.EndpointRefusedError);
    expect((thrown as EndpointRefusedError).endpoint).toBe(refused);
  });

  it('createAwsClient takes http://127.0.0.1:8400, and its requests go there, as today', async () => {
    const played = playEngine(SESSION_TOKEN, answerGeneral);
    const factory = await channelFactory();

    await factory.createAwsClient(SNSClient, { endpoint: 'http://127.0.0.1:8400' }).send(new ListTopicsCommand({}));

    expect(played.awsRequests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'POST http://127.0.0.1:8400/',
    ]);
  });

  it('refuses the channel while the page’s configuration has named none', async () => {
    vi.resetModules();
    const factory = await import('./client-factory');

    expect(() => factory.createAwsClient(SNSClient, { endpoint: CHANNEL })).toThrow(factory.EndpointRefusedError);
  });
});
