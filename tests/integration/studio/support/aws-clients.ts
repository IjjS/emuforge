// Studio's AWS SDK clients in a page at the built Studio's origin (issue 13), and the direct calls they are compared
// with.
//
// - `PageClients.load` bundles `studio/src/lib/aws/client-factory.ts` for the browser with `bun build
//   --target=browser` against Studio's installed SDK, into the run's own scratch space (never into `studio/`), loads
//   the bundle into the page as a script named `CLIENTS_SCRIPT_URL`, and creates one S3 client and one Step
//   Functions client there for the engine's endpoint. The bundle calls only `engineEndpoint`, `createS3Client` and
//   `createSfnClient` and the SDK's commands; the clients live in the page until it closes, so later calls go through
//   the same clients. A resolved command
//   carries its request id (`$metadata.requestId`, the emulator's id of the request it answered); the object
//   commands (issue 26) carry what their result reads: body, `ETag`, `CacheControl`, keys.
// - `EngineRequests` records the page's engine requests over a Chrome DevTools Protocol session (it only listens):
//   method, path, whether `Authorization` has the Studio credential's prefix, and whether `X-EmuForge-Session` equals
//   a session token the engine handed the clients. The AWS area's emulator line asks the engine on its own (issue
//   45); its session and health requests, told apart by the script that sent them, are left out. Tokens stay in
//   memory (a `Traffic` registers each for redaction as it sees it); only presence and equality reach a log.
// - `CacheRecord` is the browser's own record of where each engine answer came from: a Chrome DevTools Protocol
//   session on the page (`Network.requestWillBeSent`, `Network.requestServedFromCache`, `Network.responseReceived`).
//   It only listens; it changes no request and installs no route.
// - `directS3` and `directSfn` send an operation straight to the emulator, SigV4-signed with its key, TLS verified
//   against its `ca.pem`. A direct S3 call may carry a body and extra headers; every direct answer carries its
//   headers.

import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { type Ctx } from './check';
import { emulatorDir, readEmulatorFiles } from './emulator';
import { HEALTH_PATH, SESSION_PATH, Traffic } from './traffic';
import { waitFor } from './wait';

const REGION = 'us-east-1';

/** How long `bun build` of the factory may take. */
const BUILD_BOUND_MS = 60_000;

/** The start of every `Authorization` the factory must send (requirement R1, R2). */
export const STUDIO_AUTH_PREFIX = 'AWS4-HMAC-SHA256 Credential=emuforge-studio/';

/** The script URL the clients' bundle runs under in the page (`sourceURL`); `EngineRequests` reads it in stacks. */
const CLIENTS_SCRIPT_URL = 'emuforge-it-aws-clients.js';

/** The name the bundle gives its calls on `window`. */
const GLOBAL = '__emuforgeAwsClients';

/** How long the browser's record may take to report the answers of the requests it saw. */
const RECORD_BOUND_MS = 10_000;

/**
 * What a command sent through a page client gave: its result with its request id (`null` when the answer named
 * none), or the rejection's name, HTTP status and message.
 */
export type Outcome<T> =
  | { resolved: true; value: T; requestId: string | null }
  | { resolved: false; name: string; status: number | null; message: string };

/** What `GetObject` resolved with. */
export interface ObjectRead {
  body: string;
  etag: string | null;
  cacheControl: string | null;
}

/** What `HeadObject` resolved with. */
export interface ObjectHead {
  etag: string | null;
  cacheControl: string | null;
}

export interface StateMachineEntry {
  name: string;
  arn: string;
}

/**
 * The bundle's entry. Each call returns an `Outcome`, so a rejection crosses into the check as data and the check
 * asserts on it.
 */
function entrySource(factory: string): string {
  return `import { createS3Client, createSfnClient, engineEndpoint } from ${JSON.stringify(factory)};
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { ListStateMachinesCommand } from '@aws-sdk/client-sfn';

let s3;
let sfn;

async function outcome(send, map) {
  try {
    const out = await send();
    const requestId = out && out.$metadata && typeof out.$metadata.requestId === 'string' ? out.$metadata.requestId : null;
    return { resolved: true, value: await map(out), requestId };
  } catch (e) {
    const status = e && e.$metadata && typeof e.$metadata.httpStatusCode === 'number' ? e.$metadata.httpStatusCode : null;
    return { resolved: false, name: String((e && e.name) || 'Error'), status, message: String((e && e.message) || e) };
  }
}

window[${JSON.stringify(GLOBAL)}] = {
  init(enginePort) {
    const endpoint = engineEndpoint(enginePort);
    s3 = createS3Client({ endpoint });
    sfn = createSfnClient({ endpoint });
    return endpoint;
  },
  listBuckets() {
    return outcome(() => s3.send(new ListBucketsCommand({})), (out) => (out.Buckets || []).map((b) => b.Name));
  },
  headBucket(bucket) {
    return outcome(() => s3.send(new HeadBucketCommand({ Bucket: bucket })), (out) => out.$metadata.httpStatusCode);
  },
  listStateMachines() {
    return outcome(
      () => sfn.send(new ListStateMachinesCommand({})),
      (out) => (out.stateMachines || []).map((m) => ({ name: m.name, arn: m.stateMachineArn })),
    );
  },
  getObject(bucket, key) {
    return outcome(
      () => s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
      async (out) => ({
        body: out.Body ? await out.Body.transformToString() : '',
        etag: out.ETag ?? null,
        cacheControl: out.CacheControl ?? null,
      }),
    );
  },
  headObject(bucket, key) {
    return outcome(
      () => s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
      (out) => ({ etag: out.ETag ?? null, cacheControl: out.CacheControl ?? null }),
    );
  },
  putObject(bucket, key, body, cacheControl) {
    const input = { Bucket: bucket, Key: key, Body: body };
    if (cacheControl !== null) input.CacheControl = cacheControl;
    return outcome(() => s3.send(new PutObjectCommand(input)), (out) => out.ETag ?? null);
  },
  deleteObject(bucket, key) {
    return outcome(
      () => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      (out) => out.$metadata.httpStatusCode,
    );
  },
  listObjectsV2(bucket) {
    return outcome(
      () => s3.send(new ListObjectsV2Command({ Bucket: bucket })),
      (out) => (out.Contents || []).map((o) => o.Key),
    );
  },
};
`;
}

function run(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env, encoding: 'utf8', timeout: BUILD_BOUND_MS }, (error, stdout, stderr) => {
      resolve(error ? `${error.message}\n${stdout}\n${stderr}`.trim() : null);
    });
  });
}

/** Builds the browser bundle of the factory under the run's scratch space; returns its path. */
async function buildBundle(ctx: Ctx): Promise<string> {
  const dir = path.join(ctx.tmp, `aws-clients-${ctx.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // The entry sits outside `studio/`; this link lets it resolve the SDK packages Studio installed.
  fs.symlinkSync(path.join(ctx.studioDir, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const factory = path.join(ctx.studioDir, 'src', 'lib', 'aws', 'client-factory.ts');
  const entry = path.join(dir, 'entry.js');
  const bundle = path.join(dir, 'aws-clients.js');
  fs.writeFileSync(entry, entrySource(factory));
  const env = { HOME: ctx.home, PATH: process.env.PATH ?? '' };
  const failed = await run(
    'bun',
    ['build', entry, '--target=browser', '--format=iife', `--outfile=${bundle}`],
    dir,
    env,
  );
  if (failed !== null) throw new Error(`bun build --target=browser of ${factory} failed: ${failed}`);
  if (!fs.existsSync(bundle)) throw new Error(`bun build --target=browser of ${factory} wrote no ${bundle}`);
  ctx.log(`bundled ${path.relative(ctx.checkout, factory)} for the browser (${fs.statSync(bundle).size} bytes)`);
  return bundle;
}

/** The calls the bundle's entry puts on `window`. */
const CALLS = [
  'init',
  'listBuckets',
  'headBucket',
  'listStateMachines',
  'getObject',
  'headObject',
  'putObject',
  'deleteObject',
  'listObjectsV2',
];

/** The factory's clients in `page`, created once for the engine on `enginePort`. */
export class PageClients {
  private constructor(
    private readonly ctx: Ctx,
    private readonly page: Page,
    private readonly requests: EngineRequests,
  ) {}

  /**
   * Bundles the factory, adds it to the page and creates the two clients. Throws when the bundle does not build, or
   * the page does not expose the calls afterwards.
   */
  static async load(ctx: Ctx, page: Page, enginePort: number, requests: EngineRequests): Promise<PageClients> {
    const bundle = await buildBundle(ctx);
    const source = await fs.promises.readFile(bundle, 'utf8');
    await page.addScriptTag({ content: `${source}\n//# sourceURL=${CLIENTS_SCRIPT_URL}\n` });
    const exposed = await page.evaluate(
      ({ name, calls }) => {
        const all = (window as unknown as Record<string, Record<string, unknown> | undefined>)[name];
        return calls.filter((c) => typeof all?.[c] === 'function');
      },
      { name: GLOBAL, calls: CALLS },
    );
    if (exposed.length !== CALLS.length) {
      throw new Error(`the loaded bundle exposes ${JSON.stringify(exposed)} of ${CALLS.join(', ')}`);
    }
    const endpoint = await page.evaluate(
      ({ name, port }) => (window as unknown as Record<string, { init(port: number): string }>)[name].init(port),
      { name: GLOBAL, port: enginePort },
    );
    ctx.log(`page clients created for ${endpoint}`);
    return new PageClients(ctx, page, requests);
  }

  listBuckets(): Promise<Outcome<string[]>> {
    return this.call('ListBuckets', 'listBuckets', []);
  }

  headBucket(bucket: string): Promise<Outcome<number>> {
    return this.call(`HeadBucket ${bucket}`, 'headBucket', [bucket]);
  }

  listStateMachines(): Promise<Outcome<StateMachineEntry[]>> {
    return this.call('ListStateMachines', 'listStateMachines', []);
  }

  getObject(bucket: string, key: string): Promise<Outcome<ObjectRead>> {
    return this.call(`GetObject ${bucket}/${key}`, 'getObject', [bucket, key]);
  }

  headObject(bucket: string, key: string): Promise<Outcome<ObjectHead>> {
    return this.call(`HeadObject ${bucket}/${key}`, 'headObject', [bucket, key]);
  }

  /** `PutObject` with `body` and, unless `null`, `CacheControl`; resolves with the `ETag`. */
  putObject(bucket: string, key: string, body: string, cacheControl: string | null): Promise<Outcome<string | null>> {
    return this.call(
      `PutObject ${bucket}/${key}${cacheControl === null ? ' without CacheControl' : ` CacheControl ${cacheControl}`}`,
      'putObject',
      [bucket, key, body, cacheControl],
    );
  }

  /** `DeleteObject`; resolves with the HTTP status. */
  deleteObject(bucket: string, key: string): Promise<Outcome<number>> {
    return this.call(`DeleteObject ${bucket}/${key}`, 'deleteObject', [bucket, key]);
  }

  /** `ListObjectsV2`; resolves with the keys. */
  listObjectsV2(bucket: string): Promise<Outcome<string[]>> {
    return this.call(`ListObjectsV2 ${bucket}`, 'listObjectsV2', [bucket]);
  }

  private async call<T>(what: string, method: string, args: unknown[]): Promise<Outcome<T>> {
    const outcome = await this.page.evaluate(
      ({ name, method, args }) =>
        (window as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>)[name][method](
          ...args,
        ),
      { name: GLOBAL, method, args },
    );
    const result = outcome as Outcome<T>;
    // The engine's answers to this command are logged first.
    await this.requests.settle();
    this.ctx.log(
      `page ${what}: ${result.resolved ? `resolved, request id ${String(result.requestId)}` : `rejected ${result.name} status ${String(result.status)}: ${result.message}`}`,
    );
    return result;
  }
}

/** One engine request of the page, reduced to what the checks compare. */
export interface EngineRequest {
  method: string;
  path: string;
  /** `Authorization` starts with `STUDIO_AUTH_PREFIX`. */
  studioAuth: boolean;
  /** `X-Amz-Target`, `null` when absent (S3). */
  target: string | null;
  hasSession: boolean;
  /**
   * Index among the clients' session tokens (`EngineRequests`) of the token `X-EmuForge-Session` equals; -1 when none
   * or no match.
   */
  sessionToken: number;
}

/** One engine request as `EngineRequests` saw it. */
interface SeenEngineRequest {
  method: string;
  path: string;
  /** The headers the browser sent, lower-case names. */
  headers: Record<string, string>;
  /** Where the request came from: the clients' bundle, another script of the page, or no stack reported. */
  initiator: 'clients' | 'other' | 'unknown';
  /** The script URL of the top frame of the initiator's stack, for the log. */
  initiatorUrl: string;
  /** The token of the session answer; `null` until it is read, or when the answer gave none. */
  token: string | null;
  /** The browser reported the request finished or failed, and a session answer's token has been read. */
  done: boolean;
}

/** The CDP initiator's stack, its async parents included. */
interface InitiatorStack {
  callFrames: { url: string }[];
  parent?: InitiatorStack;
}

/** Every script URL of `stack`, top frame first, then its async parents. */
function stackUrls(stack: InitiatorStack | undefined): string[] {
  const urls: string[] = [];
  for (let s = stack; s !== undefined; s = s.parent) urls.push(...s.callFrames.map((f) => f.url));
  return urls;
}

function lowerCased(headers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
}

/**
 * The page's requests to the engine at `engineOrigin`, preflights (`OPTIONS`) excepted, from a Chrome DevTools
 * Protocol session on the page (`Network` events; it only listens). A `Traffic` stays attached so that every session
 * token is registered for redaction the moment it is seen.
 *
 * The AWS area's emulator line (issue 45, R4.4) asks the engine for a session and for its health on its own. The
 * engine hands one token for its whole run, so the line's session request and the clients' get the same token; what
 * tells them apart is the script that sent them. The clients' bundle runs under `CLIENTS_SCRIPT_URL`, and each request
 * carries its initiator's stack. Left out of `all()`, `since()` and `tokenCount()` as the line's: every request to
 * `HEALTH_PATH`, and every session request whose stack does not hold the bundle's script. A session request with no
 * stack is kept, so a browser that reports none fails the counts rather than hides a request. Every AWS request (a
 * request to any other engine path) is kept. The clients' tokens are the tokens of the clients' session answers, in
 * the order of their requests.
 */
export class EngineRequests {
  private readonly seen: SeenEngineRequest[] = [];
  private readonly pending: Promise<unknown>[] = [];
  private readonly answers: Promise<unknown>[] = [];
  private leftOutLogged = -1;

  private constructor(
    private readonly ctx: Ctx,
    private readonly traffic: Traffic,
    private readonly engineOrigin: string,
  ) {}

  /**
   * Starts recording `page`'s requests (a CDP session on `page`, and a `Traffic` of `context`). Each engine answer
   * that is not a success is logged with its status, the error code its body names and whether it has
   * `WWW-Authenticate`: an SDK that cannot read the answer hides that code.
   */
  static async attach(ctx: Ctx, context: BrowserContext, page: Page, engineOrigin: string): Promise<EngineRequests> {
    const requests = new EngineRequests(ctx, Traffic.attach(ctx, context, page), engineOrigin);
    const byId = new Map<string, SeenEngineRequest>();
    const extra = new Map<string, Record<string, string>>();
    const cdp: CDPSession = await context.newCDPSession(page);
    cdp.on('Network.requestWillBeSent', (e) => {
      const url = new URL(e.request.url);
      if (url.origin !== engineOrigin || e.request.method === 'OPTIONS' || byId.has(e.requestId)) return;
      const urls = stackUrls(e.initiator.stack as InitiatorStack | undefined);
      const seen: SeenEngineRequest = {
        method: e.request.method,
        path: url.pathname,
        headers: { ...lowerCased(e.request.headers), ...extra.get(e.requestId) },
        initiator: urls.length === 0 ? 'unknown' : urls.includes(CLIENTS_SCRIPT_URL) ? 'clients' : 'other',
        initiatorUrl: urls[0] ?? '(no stack)',
        token: null,
        done: false,
      };
      extra.delete(e.requestId);
      byId.set(e.requestId, seen);
      requests.seen.push(seen);
    });
    cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
      const headers = lowerCased(e.headers);
      const seen = byId.get(e.requestId);
      if (seen) Object.assign(seen.headers, headers);
      else extra.set(e.requestId, headers);
    });
    cdp.on('Network.loadingFinished', (e) => {
      const seen = byId.get(e.requestId);
      if (!seen) return;
      if (seen.path !== SESSION_PATH) {
        seen.done = true;
        return;
      }
      requests.pending.push(
        cdp
          .send('Network.getResponseBody', { requestId: e.requestId })
          .then((r) => {
            const body = JSON.parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString() : r.body) as {
              token?: unknown;
            };
            if (typeof body.token === 'string' && body.token !== '') seen.token = body.token;
          })
          .catch(() => undefined)
          .finally(() => (seen.done = true)),
      );
    });
    cdp.on('Network.loadingFailed', (e) => {
      const seen = byId.get(e.requestId);
      if (seen) seen.done = true;
    });
    await cdp.send('Network.enable');
    context.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin !== engineOrigin || response.status() < 400) return;
      const request = response.request();
      const www = response.headers()['www-authenticate'] !== undefined;
      const read = response
        .text()
        .catch(() => '')
        .then((body) => {
          const code =
            /<Code>([^<]*)<\/Code>/.exec(body)?.[1] ??
            /"(?:code|__type)"\s*:\s*"([^"]*)"/.exec(body)?.[1] ??
            (body === '' ? '(no body)' : '(no code in the body)');
          ctx.log(
            `engine answered ${request.method()} ${url.pathname}: ${String(response.status())} ${code}, WWW-Authenticate ${www ? 'present' : 'absent'}`,
          );
        })
        .catch(() => undefined);
      requests.answers.push(read);
    });
    return requests;
  }

  /**
   * Waits until every engine answer seen so far has been logged, and every request counted as the clients' has
   * finished or failed with its session token read, within a bound. Throws when one is still open after it.
   */
  async settle(): Promise<void> {
    const open = await waitFor(RECORD_BOUND_MS, () =>
      this.seen.some((r) => this.isClients(r) && !r.done) ? undefined : null,
    );
    for (;;) {
      const now = [...this.answers.splice(0), ...this.pending.splice(0)];
      await this.traffic.settle();
      if (now.length === 0) break;
      await Promise.allSettled(now);
    }
    if (open === undefined) {
      const left = this.seen.filter((r) => this.isClients(r) && !r.done).map((r) => `${r.method} ${r.path}`);
      throw new Error(`no end within ${String(RECORD_BOUND_MS)} ms for engine request(s): ${left.join('; ')}`);
    }
  }

  /**
   * Every recorded engine request of the clients so far, once settled: the emulator line's requests are left out
   * (see the class), and how many were, with the script each was sent from, is logged when that number changes.
   */
  async all(): Promise<EngineRequest[]> {
    await this.settle();
    const kept = this.seen.filter((r) => this.isClients(r));
    const leftOut = this.seen.filter((r) => !this.isClients(r));
    if (leftOut.length !== this.leftOutLogged) {
      this.leftOutLogged = leftOut.length;
      const from = [...new Set(leftOut.map((r) => r.initiatorUrl))].join(', ') || 'none';
      this.ctx.log(`engine requests of the emulator line left out: ${String(leftOut.length)} (sent from ${from})`);
    }
    const unknown = kept.filter((r) => r.path === SESSION_PATH && r.initiator === 'unknown').length;
    if (unknown > 0) this.ctx.log(`session requests kept with no initiator stack: ${String(unknown)}`);
    const tokens = this.clientTokens();
    return kept.map((r) => this.reduce(r, tokens));
  }

  /** The engine requests after the first `from` of `all()`. */
  async since(from: number): Promise<EngineRequest[]> {
    return (await this.all()).slice(from);
  }

  /** How many session tokens the engine has handed the clients so far. */
  async tokenCount(): Promise<number> {
    await this.settle();
    return this.clientTokens().length;
  }

  /** The tokens of the clients' session answers, in the order of their requests, each once. */
  private clientTokens(): string[] {
    const tokens: string[] = [];
    for (const r of this.seen) {
      if (r.path === SESSION_PATH && this.isClients(r) && r.token !== null && !tokens.includes(r.token)) {
        tokens.push(r.token);
      }
    }
    return tokens;
  }

  private isClients(r: SeenEngineRequest): boolean {
    if (r.path === HEALTH_PATH) return false;
    if (r.path === SESSION_PATH) return r.initiator !== 'other';
    return true;
  }

  private reduce(r: SeenEngineRequest, tokens: string[]): EngineRequest {
    const session = r.headers['x-emuforge-session'];
    return {
      method: r.method,
      path: r.path,
      studioAuth: (r.headers.authorization ?? '').startsWith(STUDIO_AUTH_PREFIX),
      target: r.headers['x-amz-target'] ?? null,
      hasSession: session !== undefined,
      sessionToken: session === undefined ? -1 : tokens.indexOf(session),
    };
  }
}

/** `GET` requests to the engine's session route among `requests`. */
export function sessionRequests(requests: EngineRequest[]): EngineRequest[] {
  return requests.filter((r) => r.method === 'GET' && r.path === SESSION_PATH);
}

/** Requests among `requests` to an engine path other than the session route. */
export function awsRequests(requests: EngineRequest[]): EngineRequest[] {
  return requests.filter((r) => r.path !== SESSION_PATH);
}

/** A presence and equality summary of `requests` for the log; never a value. */
export function describe(requests: EngineRequest[]): string {
  return (
    requests
      .map(
        (r) =>
          `${r.method} ${r.path}${r.target ? ` ${r.target}` : ''} auth=${r.studioAuth ? 'studio' : 'other'} session=${r.hasSession ? `token#${String(r.sessionToken + 1)}` : 'none'}`,
      )
      .join('; ') || 'none'
  );
}

/**
 * An answer of a direct call, with its headers (lower-case names, repeated ones joined with `, `), or the error that
 * kept it from arriving.
 */
export type DirectAnswer = { status: number; body: string; headers: Record<string, string> } | { error: string };

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * `method pathname` with `body` straight to the emulator on `port` for `service`, header-signed with its key over
 * `host`, `x-amz-content-sha256`, `x-amz-date` and the `extra` headers, TLS verified against its `ca.pem`.
 */
async function direct(
  ctx: Ctx,
  port: number,
  service: 's3' | 'states',
  method: string,
  pathname: string,
  body: string,
  extra: Record<string, string>,
): Promise<DirectAnswer> {
  const dir = emulatorDir(ctx.home, port);
  const key = readEmulatorFiles(dir);
  if (!key) return { error: `the emulator files under ${dir} are incomplete` };
  const ca = fs.readFileSync(path.join(dir, 'ca.pem'));
  const amzDate = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: `127.0.0.1:${String(port)}`,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  for (const [name, value] of Object.entries(extra)) headers[name.toLowerCase()] = value.trim();
  const names = Object.keys(headers).sort();
  const canonical = [
    method,
    pathname,
    '',
    ...names.map((n) => `${n}:${headers[n]}`),
    '',
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${REGION}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), REGION), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const sent: Record<string, string> = { ...headers };
  delete sent.host;
  sent.authorization =
    `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, ` +
    `Signature=${signature}`;
  if (body !== '') sent['content-length'] = String(Buffer.byteLength(body));
  return new Promise((resolve) => {
    const request = https.request(
      { host: '127.0.0.1', port, method, path: pathname, ca, agent: false, timeout: 5_000, headers: sent },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({ status: response.statusCode ?? 0, body: text, headers });
        });
        response.on('error', (e) => resolve({ error: e.message }));
      },
    );
    request.on('timeout', () => request.destroy(new Error('no answer within 5 s')));
    request.on('error', (e) => resolve({ error: e.message }));
    request.end(body === '' ? undefined : body);
  });
}

/** What a direct S3 call sends besides its method and path. */
export interface DirectS3Options {
  /** The request body; none when absent. */
  body?: string;
  /** More headers, signed with the rest (`cache-control`, …). */
  headers?: Record<string, string>;
}

/**
 * An S3 operation straight to the emulator (path style: `/`, `/<bucket>` or `/<bucket>/<key>`), without a body unless
 * `options` gives one.
 */
export function directS3(
  ctx: Ctx,
  port: number,
  method: string,
  pathname: string,
  options: DirectS3Options = {},
): Promise<DirectAnswer> {
  return direct(ctx, port, 's3', method, pathname, options.body ?? '', options.headers ?? {});
}

/** A Step Functions action (`ListStateMachines`, …) with its JSON input, straight to the emulator. */
export function directSfn(ctx: Ctx, port: number, action: string, input: object): Promise<DirectAnswer> {
  return direct(ctx, port, 'states', 'POST', '/', JSON.stringify(input), {
    'content-type': 'application/x-amz-json-1.0',
    'x-amz-target': `AWSStepFunctions.${action}`,
  });
}

/** `status` of a direct answer, or its error, for the log. */
export function shown(answer: DirectAnswer): string {
  return 'error' in answer ? `error ${answer.error}` : `status ${String(answer.status)}`;
}

/** The bucket names of a `ListBuckets` XML body. */
export function bucketNames(xml: string): string[] {
  return [...xml.matchAll(/<Bucket>[\s\S]*?<Name>([^<]*)<\/Name>[\s\S]*?<\/Bucket>/g)].map((m) => m[1]);
}

/** One answer the browser reported for a request of the page to the engine. */
export interface RecordedAnswer {
  method: string;
  path: string;
  status: number;
  /** Where the browser says the answer came from: `network`, or the cache flags it reported. */
  source: string;
  /** The browser reported it served from a cache of its own (disk, memory, prefetch, service worker). */
  fromCache: boolean;
}

interface Pending {
  method: string;
  url: string;
  servedFromCache: boolean;
  done: boolean;
}

/**
 * The browser's own record of where each answer to a request of the page to the engine at `engineOrigin` came from:
 * Chrome DevTools Protocol `Network` events of a session on the page. `Network.enable` only turns the events on; the
 * record sends no request and changes none.
 */
export class CacheRecord {
  private readonly seen = new Map<string, Pending>();
  readonly answers: RecordedAnswer[] = [];

  private constructor(
    private readonly ctx: Ctx,
    private readonly engineOrigin: string,
  ) {}

  /** Starts recording before the page's first request to the engine. */
  static async attach(ctx: Ctx, context: BrowserContext, page: Page, engineOrigin: string): Promise<CacheRecord> {
    const record = new CacheRecord(ctx, engineOrigin);
    const cdp: CDPSession = await context.newCDPSession(page);
    cdp.on('Network.requestWillBeSent', (e) => {
      if (new URL(e.request.url).origin !== engineOrigin) return;
      const known = record.seen.get(e.requestId);
      // A redirect reuses the id; the request is the latest one.
      record.seen.set(e.requestId, {
        method: e.request.method,
        url: e.request.url,
        servedFromCache: known?.servedFromCache ?? false,
        done: false,
      });
    });
    cdp.on('Network.requestServedFromCache', (e) => {
      const known = record.seen.get(e.requestId);
      if (known) known.servedFromCache = true;
    });
    cdp.on('Network.responseReceived', (e) => {
      const known = record.seen.get(e.requestId);
      if (!known) return;
      known.done = true;
      const r = e.response;
      const flags = [
        r.fromDiskCache === true ? 'disk cache' : null,
        known.servedFromCache ? 'served from cache' : null,
        r.fromPrefetchCache === true ? 'prefetch cache' : null,
        r.fromServiceWorker === true ? 'service worker' : null,
      ].filter((f): f is string => f !== null);
      const answer: RecordedAnswer = {
        method: known.method,
        path: new URL(r.url).pathname,
        status: r.status,
        source: flags.length === 0 ? 'network' : flags.join(', '),
        fromCache: flags.length > 0,
      };
      record.answers.push(answer);
      record.ctx.log(
        `browser record: ${answer.method} ${answer.path} answered ${String(answer.status)} from ${answer.source}`,
      );
    });
    cdp.on('Network.loadingFailed', (e) => {
      const known = record.seen.get(e.requestId);
      if (!known || known.done) return;
      known.done = true;
      record.ctx.log(`browser record: ${known.method} ${new URL(known.url).pathname} failed: ${e.errorText}`);
    });
    await cdp.send('Network.enable');
    return record;
  }

  /**
   * Every answer recorded so far, once each request to the engine the browser reported has its answer or its
   * failure, within a bound. Throws when one is still open after it.
   */
  async all(): Promise<RecordedAnswer[]> {
    const open = await waitFor(RECORD_BOUND_MS, () => {
      const left = [...this.seen.values()].filter((p) => !p.done);
      return left.length === 0 ? null : undefined;
    });
    if (open === undefined) {
      const left = [...this.seen.values()].filter((p) => !p.done).map((p) => `${p.method} ${new URL(p.url).pathname}`);
      throw new Error(
        `the browser reported no answer within ${String(RECORD_BOUND_MS)} ms for ${String(left.length)} request(s) to ${this.engineOrigin}: ${left.join('; ')}`,
      );
    }
    return [...this.answers];
  }
}
