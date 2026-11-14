import { S3Client } from '@aws-sdk/client-s3';
import { SFNClient } from '@aws-sdk/client-sfn';
import { SESSION_HEADER } from '../engine/engine-client';
import { engineSession, type EngineSession } from './engine-session';

export { EngineSessionError, type EngineSessionFailure } from './engine-session';

// The only place Studio creates AWS SDK clients. Every client talks to the engine on loopback, never to an AWS
// host, and holds no AWS key: the engine identifies the browser by its session and signs upstream itself. Each
// request carries the session token of its engine, obtained and renewed here.

const ENGINE_HOST = '127.0.0.1';
const ENGINE_ENDPOINT = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const MAX_PORT = 65535;

// The emulator's region (infra/aws-emulator/env.sh). Set here so the SDK never looks it up in the environment.
const REGION = 'us-east-1';

// Requests are signed SigV4 with this fixed placeholder credential (requirement R1, R2 of issue 13). It is not an AWS
// key and not a secret: it ships in the public bundle and the engine, which re-signs upstream with the emulator's key,
// never checks it. Being fixed, no credential provider is consulted, so no key from the environment, a file or
// browser storage can reach a request.
const PLACEHOLDER_CREDENTIAL = {
  accessKeyId: 'emuforge-studio',
  secretAccessKey: 'emuforge-studio-not-a-secret',
};

// The engine's refusals of a missing or stale session token; answered by one new session and one resend.
const SESSION_REFUSALS: ReadonlySet<string> = new Set(['SessionInvalid', 'SessionRequired']);
const SESSION_CHALLENGE = 'emuforge-session';

export interface AwsClientOptions {
  /** The engine's address, exactly `http://127.0.0.1:<port>`; build it with `engineEndpoint`. */
  endpoint: string;
}

export class EndpointRefusedError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string) {
    super(
      `Refused AWS endpoint "${endpoint}": Studio sends AWS requests only to the engine at http://${ENGINE_HOST}:<port>.`,
    );
    this.name = 'EndpointRefusedError';
    this.endpoint = endpoint;
  }
}

function checkedEndpoint(endpoint: string): string {
  const port = ENGINE_ENDPOINT.exec(endpoint)?.[1];
  if (port === undefined || Number(port) > MAX_PORT) {
    throw new EndpointRefusedError(endpoint);
  }
  return endpoint;
}

/** The engine's address for an engine port; refuses a port that is not an integer from 1 to 65535. */
export function engineEndpoint(enginePort: number): string {
  return checkedEndpoint(`http://${ENGINE_HOST}:${String(enginePort)}`);
}

// Options every client shares. Each one that the SDK would otherwise resolve from the environment or a shared
// config file, and that decides where a request goes or how it is authenticated, is set here.
function commonConfig({ endpoint }: AwsClientOptions) {
  return {
    endpoint: checkedEndpoint(endpoint),
    region: REGION,
    disableHostPrefix: true,
    useDualstackEndpoint: false,
    useFipsEndpoint: false,
    credentials: PLACEHOLDER_CREDENTIAL,
  };
}

interface RefusedAnswer {
  name?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $response?: { headers?: Record<string, unknown> };
}

// A `401` the engine marks as a session refusal: by its code, or by its challenge header for a `HEAD` answer, which
// has no body to carry the code.
function isSessionRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const answer = error as RefusedAnswer;
  if (answer.$metadata?.httpStatusCode !== 401) {
    return false;
  }
  if (typeof answer.name === 'string' && SESSION_REFUSALS.has(answer.name)) {
    return true;
  }
  return Object.entries(answer.$response?.headers ?? {}).some(
    ([name, value]) =>
      name.toLowerCase() === 'www-authenticate' &&
      typeof value === 'string' &&
      value.trim().split(/[\s,]/)[0]?.toLowerCase() === SESSION_CHALLENGE,
  );
}

function isHttpRequest(request: unknown): request is { headers: Record<string, string> } {
  return (
    typeof request === 'object' &&
    request !== null &&
    typeof (request as { headers?: unknown }).headers === 'object' &&
    (request as { headers?: unknown }).headers !== null
  );
}

// Puts the session token on each request before it is signed, and answers a session refusal with one new session
// and one resend, signed again with the new token (requirement R3-R7). The SDK's own retries run inside, unchanged.
function carrySession<C extends S3Client | SFNClient>(client: C, session: EngineSession): C {
  (client as SFNClient).middlewareStack.add(
    (next, context) => async (args) => {
      if (!isHttpRequest(args.request)) {
        return next(args);
      }
      const headers = args.request.headers;
      const given = context.__smithy_context?.abortSignal;
      const signal = given instanceof AbortSignal ? given : undefined;
      let token = await session.token(signal);
      headers[SESSION_HEADER] = token;
      try {
        return await next(args);
      } catch (error) {
        if (!isSessionRefusal(error)) {
          throw error;
        }
      }
      token = await session.renew(token, signal);
      headers[SESSION_HEADER] = token;
      try {
        return await next(args);
      } catch (error) {
        if (isSessionRefusal(error)) {
          session.forget(token);
        }
        throw error;
      }
    },
    { step: 'build', priority: 'low', name: 'emuforgeSession', override: true },
  );
  return client;
}

export function createS3Client(options: AwsClientOptions): S3Client {
  const config = commonConfig(options);
  const client = new S3Client({
    ...config,
    forcePathStyle: true,
    useArnRegion: false,
    disableS3ExpressSessionAuth: true,
  });
  return carrySession(client, engineSession(config.endpoint));
}

export function createSfnClient(options: AwsClientOptions): SFNClient {
  const config = commonConfig(options);
  return carrySession(new SFNClient(config), engineSession(config.endpoint));
}
