import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ListStateMachinesCommand, SFNClient, StartSyncExecutionCommand } from '@aws-sdk/client-sfn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createS3Client, createSfnClient, EndpointRefusedError, engineEndpoint } from './client-factory';

// The request as it would leave the client, after every build, signing and finalize step.
interface BuiltRequest {
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

beforeEach(() => {
  // In Vitest the SDK runs its Node configuration, which falls back to the shared AWS files for settings the
  // factory leaves to their defaults. Point those lookups at files that do not exist.
  vi.stubEnv('AWS_CONFIG_FILE', '/nonexistent/emuforge-studio-test/config');
  vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', '/nonexistent/emuforge-studio-test/credentials');
});

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  sessionStorage.clear();
});

describe('createS3Client', () => {
  it('addresses bucket b and key k by path on the engine', async () => {
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
