import { createHash, createHmac } from 'node:crypto';
import { GetObjectCommand, ListBucketsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ListStateMachinesCommand, SFNClient, StartSyncExecutionCommand } from '@aws-sdk/client-sfn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createS3Client, createSfnClient, EndpointRefusedError, engineEndpoint } from './client-factory';

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

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// SigV4 of the request, computed here from the specification over the names the request says it signed: canonical
// request, string to sign, HMAC-SHA256 key derivation. Independent of the SDK's signer.
function expectedSignature(request: BuiltRequest, secret: string): string {
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
  const stringToSign = ['AWS4-HMAC-SHA256', oneHeader(request, 'x-amz-date'), scope, sha256Hex(canonicalRequest)].join(
    '\n',
  );
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
  return createHmac('sha256', key).update(stringToSign).digest('hex');
}

function bodyBytes(body: unknown): string | Uint8Array {
  if (body === undefined || body === null) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  // A typed array may come from the test environment's realm, where `instanceof Uint8Array` does not hold.
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
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
    expect(sha256Hex(bodyBytes(request.body))).toBe(helloSha256);
    for (const value of headerValues(request, 'x-amz-content-sha256')) {
      expect(value.startsWith('STREAMING-')).toBe(false);
    }
  });

  it('gives each request the SigV4 signature of its own signed names under the placeholder secret', async () => {
    const requests = [...(await s3Requests()), ...(await sfnRequests()), await putHello()];

    for (const request of requests) {
      expect(authorizationOf(request).signature).toBe(expectedSignature(request, secret));
      expect(oneHeader(request, 'x-amz-content-sha256')).toBe(sha256Hex(bodyBytes(request.body)));
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
