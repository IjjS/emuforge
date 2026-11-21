import { S3Client } from '@aws-sdk/client-s3';
import { SFNClient } from '@aws-sdk/client-sfn';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { acceptedChannel, ENGINE_HOST } from '../engine/engine-base';
import { SESSION_HEADER } from '../engine/engine-client';
import { engineSession, type EngineSession } from './engine-session';
import { assertAwsRequestAuthorized } from './request';

export { EngineSessionError, type EngineSessionFailure } from './engine-session';

// The only place Studio creates AWS SDK clients. Every client talks to the engine, never to an AWS host: on loopback,
// or through Studio's own port at `<page origin><engine path>` when the page's configuration names that channel
// (issue 503). It holds no AWS key: the engine identifies the browser by its session and signs upstream itself. Each
// request carries the session token of its engine, obtained and renewed here, and is held against the engine's
// address at the last step before it is sent (issue 386, requirement R6.4).

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

// Where the engine may be reached, as the refusals name it.
const ENGINE_PLACES = `the engine at http://${ENGINE_HOST}:<port> or through Studio's own origin`;

export interface AwsClientOptions {
  /**
   * The engine's address: exactly `http://127.0.0.1:<port>` (build it with `engineEndpoint`), or exactly the page's
   * origin and the channel path its configuration named (`engineBase`).
   */
  endpoint: string;
}

/**
 * A request whose scheme, host or port is not the engine's, or whose path is not under the channel's path, was refused
 * before it was sent.
 */
export class RequestRefusedError extends Error {
  /** The refused request's host name. */
  readonly host: string;
  /** The refused request's origin: scheme, host and port. */
  readonly origin: string;

  constructor(origin: string, host: string, path = '') {
    super(`Refused an AWS request to "${origin}${path}": Studio sends AWS requests only to ${ENGINE_PLACES}.`);
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
    super(`Refused AWS endpoint "${endpoint}": Studio sends AWS requests only to ${ENGINE_PLACES}.`);
    this.name = 'EndpointRefusedError';
    this.endpoint = endpoint;
  }
}

/** Where an accepted endpoint sends: its scheme, host name, port and, for the channel, its path. */
interface EngineAddress {
  endpoint: string;
  /** `http:` or `https:`. */
  scheme: string;
  hostname: string;
  /** The port, the scheme's default when the endpoint names none. */
  port: number;
  /** The channel's path (`/__engine`); `''` for the engine on loopback. */
  path: string;
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = { 'http:': 80, 'https:': 443 };

/**
 * The address of `endpoint` when it is exactly the engine on loopback, `http://127.0.0.1:<port>`, or exactly the
 * channel the page's configuration named, `<page origin><engine path>`; refuses every other with
 * `EndpointRefusedError`.
 */
function checkedEndpoint(endpoint: string): EngineAddress {
  const port = ENGINE_ENDPOINT.exec(endpoint)?.[1];
  if (port !== undefined && Number(port) <= MAX_PORT) {
    return { endpoint, scheme: 'http:', hostname: ENGINE_HOST, port: Number(port), path: '' };
  }
  const channel = acceptedChannel();
  if (channel !== undefined && endpoint === channel) {
    const url = new URL(channel);
    const scheme = url.protocol;
    const defaultPort = DEFAULT_PORTS[scheme];
    if (defaultPort !== undefined) {
      const named = url.port === '' ? defaultPort : Number(url.port);
      return { endpoint, scheme, hostname: url.hostname, port: named, path: url.pathname };
    }
  }
  throw new EndpointRefusedError(endpoint);
}

/** The engine's address for an engine port; refuses a port that is not an integer from 1 to 65535. */
export function engineEndpoint(enginePort: number): string {
  return checkedEndpoint(`http://${ENGINE_HOST}:${String(enginePort)}`).endpoint;
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
// otherwise each SDK package's own behavior (issue 386, requirement R6.4). For the channel, the path the page's
// `fetch` will send, after the URL parser has resolved every dot segment, must also be under the channel's path, so
// no request leaves the channel for another path of Studio's origin (issue 503).
class EngineRequestHandler extends FetchHttpHandler {
  private readonly address: EngineAddress;
  private readonly attemptSignals: WeakMap<object, AbortSignal>;

  constructor(address: EngineAddress) {
    const attemptSignals = new WeakMap<object, AbortSignal>();
    super({
      requestInit: (request): RequestInit => {
        // Smithy calls this synchronously before constructing the browser request on each attempt.
        const signal = attemptSignals.get(request);
        if (signal !== undefined) {
          assertAwsRequestAuthorized(signal);
        }
        return UNCACHED_METHODS.has(request.method) ? { cache: 'no-store' } : {};
      },
    });
    this.address = address;
    this.attemptSignals = attemptSignals;
  }

  override handle(request: HttpRequest, options?: Parameters<FetchHttpHandler['handle']>[1]) {
    const { scheme: expected, hostname, port: engine, path } = this.address;
    const scheme = request.protocol.endsWith(':') ? request.protocol : `${request.protocol}:`;
    const named = request.port === undefined ? '' : `:${String(request.port)}`;
    const origin = `${scheme}//${request.hostname}${named}`;
    const port = request.port ?? DEFAULT_PORTS[scheme];
    if (scheme !== expected || request.hostname !== hostname || port !== engine) {
      return Promise.reject(new RequestRefusedError(origin, request.hostname));
    }
    if (path !== '' && !underPath(origin, request.path, path)) {
      return Promise.reject(new RequestRefusedError(origin, request.hostname, request.path));
    }
    const signal = options?.abortSignal;
    if (signal instanceof AbortSignal) {
      this.attemptSignals.set(request, signal);
    } else {
      this.attemptSignals.delete(request);
    }
    return super.handle(request, options);
  }
}

/** The request's path, as the URL parser resolves it at `origin`, is under `path/` and still at `origin`. */
function underPath(origin: string, requestPath: string, path: string): boolean {
  let url: URL;
  try {
    url = new URL(`${origin}${requestPath}`);
  } catch {
    return false;
  }
  return url.origin === new URL(origin).origin && url.pathname.startsWith(`${path}/`);
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
    endpoint: checked.endpoint,
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
