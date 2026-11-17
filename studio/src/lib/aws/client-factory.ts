import { S3Client } from '@aws-sdk/client-s3';
import { SFNClient } from '@aws-sdk/client-sfn';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { SESSION_HEADER } from '../engine/engine-client';
import { engineSession, type EngineSession } from './engine-session';

export { EngineSessionError, type EngineSessionFailure } from './engine-session';

// The only place Studio creates AWS SDK clients. Every client talks to the engine on loopback, never to an AWS
// host, and holds no AWS key: the engine identifies the browser by its session and signs upstream itself. Each
// request carries the session token of its engine, obtained and renewed here, and is held against the engine's
// address at the last step before it is sent (issue 386, requirement R6.4).

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

/** A request whose scheme, host or port is not the engine's was refused before it was sent. */
export class RequestRefusedError extends Error {
  /** The refused request's host name. */
  readonly host: string;
  /** The refused request's origin: scheme, host and port. */
  readonly origin: string;

  constructor(origin: string, host: string) {
    super(
      `Refused an AWS request to "${origin}": Studio sends AWS requests only to the engine at http://${ENGINE_HOST}:<port>.`,
    );
    this.name = 'RequestRefusedError';
    this.host = host;
    this.origin = origin;
  }
}

/** A client's own settings named a setting the factory sets; no client was made. */
export class SettingRefusedError extends Error {
  readonly setting: string;

  constructor(setting: string) {
    super(`Refused the client setting "${setting}": the factory sets it for every AWS client, and it cannot be given.`);
    this.name = 'SettingRefusedError';
    this.setting = setting;
  }
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

// Reads whose answers the browser must neither keep nor reuse (issue 26). An S3 object's body is emulator content,
// which can change between two reads through Studio or around it, and the engine's answers carry nothing that keeps
// the HTTP cache from storing them. Every other method is sent with no cache mode, as the browser never answers one
// from its cache: a `no-store` request also gets `Cache-Control: no-cache` from the browser, which the engine relays
// and which `PutObject` would store as the object's metadata.
const UNCACHED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

type HttpRequest = Parameters<FetchHttpHandler['handle']>[0];

// Every request goes through the page's `fetch`, in every environment: the SDK would otherwise pick its Node handler
// under Node, the unit tests included. The handler is the last step before the request is sent, after every
// middleware of the SDK and of the client, so it is where a request that is not for the engine is refused: the
// endpoint is fixed, and no path of the SDK is known to send elsewhere, but what keeps a request on the engine is
// otherwise each SDK package's own behavior (issue 386, requirement R6.4).
class EngineRequestHandler extends FetchHttpHandler {
  private readonly port: number;

  constructor(endpoint: string) {
    super({
      requestInit: (request): RequestInit => (UNCACHED_METHODS.has(request.method) ? { cache: 'no-store' } : {}),
    });
    this.port = Number(ENGINE_ENDPOINT.exec(endpoint)?.[1]);
  }

  override handle(request: HttpRequest, options?: Parameters<FetchHttpHandler['handle']>[1]) {
    const scheme = request.protocol.endsWith(':') ? request.protocol : `${request.protocol}:`;
    if (scheme !== 'http:' || request.hostname !== ENGINE_HOST || request.port !== this.port) {
      const port = request.port === undefined ? '' : `:${String(request.port)}`;
      return Promise.reject(new RequestRefusedError(`${scheme}//${request.hostname}${port}`, request.hostname));
    }
    return super.handle(request, options);
  }
}

// The settings the factory gives every client. A client's own settings may name none of them (requirement R6.3):
// each decides where a request goes or how it is authenticated. `endpointProvider` would decide the address in the
// endpoint's place, and `extensions` run after the constructor has read the settings and can set the request handler,
// the region and the credential (`setHttpHandler`, `setRegion`, `setCredentials`). A service that needs an extension
// is a decision of its own issue.
const FACTORY_SETTINGS = [
  'endpoint',
  'endpointProvider',
  'region',
  'disableHostPrefix',
  'useDualstackEndpoint',
  'useFipsEndpoint',
  'credentials',
  'requestHandler',
  'extensions',
] as const;

type FactorySetting = (typeof FACTORY_SETTINGS)[number];

// Options every client shares. Each one that the SDK would otherwise resolve from the environment or a shared
// config file, and that decides where a request goes or how it is authenticated, is set here.
function commonConfig({ endpoint }: AwsClientOptions) {
  const checked = checkedEndpoint(endpoint);
  return {
    endpoint: checked,
    region: REGION,
    disableHostPrefix: true,
    useDualstackEndpoint: false,
    useFipsEndpoint: false,
    credentials: PLACEHOLDER_CREDENTIAL,
    requestHandler: new EngineRequestHandler(checked),
  } satisfies Record<Exclude<FactorySetting, 'endpointProvider' | 'extensions'>, unknown>;
}

/** What the factory reaches of any SDK client: its middleware stack. */
interface SdkClient {
  middlewareStack: { add: unknown };
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
function carrySession<C extends SdkClient>(client: C, session: EngineSession): C {
  (client as unknown as SFNClient).middlewareStack.add(
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

/** The configuration an SDK client class takes, from its constructor's parameters. */
type ClientConfig<A extends unknown[]> = NonNullable<A[0]>;

/** A client's own settings (requirement R6.3): its configuration without the settings the factory gives. */
export type AwsClientSettings<A extends unknown[]> = Omit<ClientConfig<A>, FactorySetting>;

/**
 * A client of `ClientClass`, an SDK client class or aggregated class from an `@aws-sdk/client-*` package, for the
 * engine at `options.endpoint`, with every setting of the factory and the engine's session (issue 386, requirement
 * R6.1, R6.2). `settings` are the service's own (SQS: `useQueueUrlAsEndpoint: false`); one that names a setting of the
 * factory is refused with `SettingRefusedError` and no client is made. Refuses an endpoint that is not the engine's
 * with `EndpointRefusedError`.
 */
export function createAwsClient<C extends SdkClient, A extends unknown[]>(
  ClientClass: new (...configuration: A) => C,
  options: AwsClientOptions,
  settings?: AwsClientSettings<A>,
): C {
  const config = commonConfig(options);
  const own: Record<string, unknown> = { ...settings };
  const refused = FACTORY_SETTINGS.find((setting) => Object.hasOwn(own, setting));
  if (refused !== undefined) {
    throw new SettingRefusedError(refused);
  }
  const client = new ClientClass(...([{ ...own, ...config }] as unknown as A));
  return carrySession(client, engineSession(config.endpoint));
}
