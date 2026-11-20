// Clients of any service made by the factory's general function (`studio/src/lib/aws/client-factory.ts`, issue 386,
// requirement R6.1, R6.6, R6.7) in a page at the built Studio's origin, and the direct calls they are compared with.
//
// - `GeneralClients.load` bundles the factory for the browser with `bun build --target=browser` against Studio's
//   installed SDK, into the run's own scratch space (never into `studio/`), loads the bundle into the page and makes
//   there, for the engine's endpoint, one client each of SNS (AWS Query), DynamoDB (AWS JSON 1.0), API Gateway (REST
//   JSON) and SQS (AWS JSON 1.0): `createAwsClient(<Client class>, { endpoint })`, the class imported from its
//   `@aws-sdk/client-*` package and handed over, with no setting of the client's own. The bundle calls only
//   `engineEndpoint`, `createAwsClient` and the SDK's commands. It runs under the script URL `EngineRequests`
//   (`aws-clients.ts`) reads in stacks, so the clients' session requests are counted as theirs.
// - `PageHosts` records the origin of every request the page's browser context sends, whatever its destination
//   (Playwright's `request` event; it only listens). The context's refusing proxy (`refuse.ts`) still sees and
//   refuses anything that is not loopback, so a request to an AWS host is recorded and never leaves the machine.
// - `directSns`, `directDynamoDb`, `directApiGateway` and `directSqs` send an operation straight to the emulator,
//   SigV4-signed with its key, TLS verified against its `ca.pem`.

import type { BrowserContext, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import type { EngineRequests, Outcome } from './aws-clients';
import { type Ctx } from './check';
import { emulatorDir, readEmulatorFiles } from './emulator';

const REGION = 'us-east-1';

/** How long `bun build` of the factory may take. */
const BUILD_BOUND_MS = 60_000;

/**
 * The script URL the bundle runs under in the page (`sourceURL`). It is the one `EngineRequests` of `aws-clients.ts`
 * tells the clients' session requests apart by, so it must stay equal to that file's `CLIENTS_SCRIPT_URL`.
 */
const CLIENTS_SCRIPT_URL = 'emuforge-it-aws-clients.js';

/** The name the bundle gives its calls on `window`. */
const GLOBAL = '__emuforgeGeneralClients';

/**
 * How many REST APIs one `GetRestApis` asks for, through the page or directly, so a page of another run's APIs does not
 * hide this run's (the default is 25).
 */
export const PAGE_SIZE = 500;

/**
 * The bundle's entry. Each call returns an `Outcome`, so a rejection crosses into the check as data and the check
 * asserts on it.
 */
function entrySource(factory: string): string {
  return `import { createAwsClient, engineEndpoint } from ${JSON.stringify(factory)};
import { ListTopicsCommand, SNSClient } from '@aws-sdk/client-sns';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayClient, GetRestApisCommand } from '@aws-sdk/client-api-gateway';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';

let sns;
let dynamodb;
let apigateway;
let sqs;

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
    sns = createAwsClient(SNSClient, { endpoint });
    dynamodb = createAwsClient(DynamoDBClient, { endpoint });
    apigateway = createAwsClient(APIGatewayClient, { endpoint });
    sqs = createAwsClient(SQSClient, { endpoint });
    return endpoint;
  },
  listTopics() {
    return outcome(() => sns.send(new ListTopicsCommand({})), (out) => (out.Topics || []).map((t) => t.TopicArn));
  },
  listTables() {
    return outcome(
      () => dynamodb.send(new ListTablesCommand({ Limit: 100 })),
      (out) => out.TableNames || [],
    );
  },
  getRestApis() {
    return outcome(
      () => apigateway.send(new GetRestApisCommand({ limit: ${String(PAGE_SIZE)} })),
      (out) => (out.items || []).map((a) => ({ id: a.id, name: a.name })),
    );
  },
  queueArn(queueUrl) {
    return outcome(
      () => sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] })),
      (out) => (out.Attributes && out.Attributes.QueueArn) || null,
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

/** Builds the browser bundle of the factory's general function under the run's scratch space; returns its path. */
async function buildBundle(ctx: Ctx): Promise<string> {
  const dir = path.join(ctx.tmp, `aws-clients-general-${ctx.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // The entry sits outside `studio/`; this link lets it resolve the SDK packages Studio installed.
  fs.symlinkSync(path.join(ctx.studioDir, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const factory = path.join(ctx.studioDir, 'src', 'lib', 'aws', 'client-factory.ts');
  const entry = path.join(dir, 'entry.js');
  const bundle = path.join(dir, 'aws-clients-general.js');
  fs.writeFileSync(entry, entrySource(factory));
  const env = { HOME: ctx.home, PATH: process.env.PATH ?? '' };
  const failed = await run(
    'bun',
    ['build', entry, '--target=browser', '--format=iife', `--outfile=${bundle}`],
    dir,
    env,
  );
  if (failed !== null) {
    throw new Error(`bun build --target=browser of the general function of ${factory} failed: ${failed}`);
  }
  if (!fs.existsSync(bundle)) throw new Error(`bun build --target=browser of ${factory} wrote no ${bundle}`);
  ctx.log(`bundled ${path.relative(ctx.checkout, factory)} for the browser (${fs.statSync(bundle).size} bytes)`);
  return bundle;
}

/** The calls the bundle's entry puts on `window`. */
const CALLS = ['init', 'listTopics', 'listTables', 'getRestApis', 'queueArn'];

export interface RestApiEntry {
  id: string;
  name: string;
}

/** The general function's clients in `page`, made once for the engine on `enginePort`. */
export class GeneralClients {
  private constructor(
    private readonly ctx: Ctx,
    private readonly page: Page,
    private readonly requests: EngineRequests,
  ) {}

  /**
   * Bundles the factory, adds it to the page and makes the four clients. Throws when the bundle does not build, or
   * the page does not expose the calls afterwards.
   */
  static async load(ctx: Ctx, page: Page, enginePort: number, requests: EngineRequests): Promise<GeneralClients> {
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
    ctx.log(`general clients of SNS, DynamoDB, API Gateway and SQS made for ${endpoint}`);
    return new GeneralClients(ctx, page, requests);
  }

  /** SNS `ListTopics`; resolves with the topic ARNs. */
  listTopics(): Promise<Outcome<string[]>> {
    return this.call('SNS ListTopics', 'listTopics', []);
  }

  /** DynamoDB `ListTables`; resolves with the table names. */
  listTables(): Promise<Outcome<string[]>> {
    return this.call('DynamoDB ListTables', 'listTables', []);
  }

  /** API Gateway `GetRestApis`; resolves with each API's id and name. */
  getRestApis(): Promise<Outcome<RestApiEntry[]>> {
    return this.call('API Gateway GetRestApis', 'getRestApis', []);
  }

  /** SQS `GetQueueAttributes` of `QueueArn` by `queueUrl`; resolves with the ARN, `null` when the answer has none. */
  queueArn(queueUrl: string): Promise<Outcome<string | null>> {
    return this.call(`SQS GetQueueAttributes QueueArn of ${queueUrl}`, 'queueArn', [queueUrl]);
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

/**
 * The origin of every request the browser context sent, in order (Playwright's `request` event: it fires for a
 * request handed to the refusing proxy too). Only listens.
 */
export class PageHosts {
  private readonly origins: string[] = [];

  private constructor() {}

  static attach(context: BrowserContext): PageHosts {
    const hosts = new PageHosts();
    context.on('request', (request) => {
      let origin: string;
      try {
        origin = new URL(request.url()).origin;
      } catch {
        origin = request.url();
      }
      hosts.origins.push(origin);
    });
    return hosts;
  }

  /** Where the next request will be counted from. */
  mark(): number {
    return this.origins.length;
  }

  /** The origins of the requests sent since `from`, each once, in the order first seen. */
  since(from: number): string[] {
    return [...new Set(this.origins.slice(from))];
  }
}

/** An answer of a direct call, or the error that kept it from arriving. */
export type DirectAnswer = { status: number; body: string } | { error: string };

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** RFC 3986 encoding, as SigV4 wants it in a canonical query string. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `method pathname?query` with `body` straight to the emulator on `port` for `service`, header-signed with its key
 * over `host`, `x-amz-content-sha256`, `x-amz-date` and the `extra` headers, TLS verified against its `ca.pem`.
 */
async function direct(
  ctx: Ctx,
  port: number,
  service: string,
  method: string,
  pathname: string,
  query: Record<string, string>,
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
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join('&');
  const canonical = [
    method,
    pathname,
    canonicalQuery,
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
  const target = canonicalQuery === '' ? pathname : `${pathname}?${canonicalQuery}`;
  return new Promise((resolve) => {
    const request = https.request(
      { host: '127.0.0.1', port, method, path: target, ca, agent: false, timeout: 5_000, headers: sent },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
        response.on('error', (e) => resolve({ error: e.message }));
      },
    );
    request.on('timeout', () => request.destroy(new Error('no answer within 5 s')));
    request.on('error', (e) => resolve({ error: e.message }));
    request.end(body === '' ? undefined : body);
  });
}

/** An SNS action (AWS Query) with its parameters, straight to the emulator. */
export function directSns(
  ctx: Ctx,
  port: number,
  action: string,
  params: Record<string, string>,
): Promise<DirectAnswer> {
  const body = new URLSearchParams({ Action: action, Version: '2010-03-31', ...params }).toString();
  return direct(ctx, port, 'sns', 'POST', '/', {}, body, {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
  });
}

/** A DynamoDB action (AWS JSON 1.0) with its JSON input, straight to the emulator. */
export function directDynamoDb(ctx: Ctx, port: number, action: string, input: object): Promise<DirectAnswer> {
  return direct(ctx, port, 'dynamodb', 'POST', '/', {}, JSON.stringify(input), {
    'content-type': 'application/x-amz-json-1.0',
    'x-amz-target': `DynamoDB_20120810.${action}`,
  });
}

/** An API Gateway request (REST JSON): `method pathname?query` with an optional JSON body, straight to the emulator. */
export function directApiGateway(
  ctx: Ctx,
  port: number,
  method: string,
  pathname: string,
  query: Record<string, string> = {},
  input: object | null = null,
): Promise<DirectAnswer> {
  return direct(
    ctx,
    port,
    'apigateway',
    method,
    pathname,
    query,
    input === null ? '' : JSON.stringify(input),
    input === null
      ? { accept: 'application/json' }
      : { accept: 'application/json', 'content-type': 'application/json' },
  );
}

/** An SQS action (AWS JSON 1.0) with its JSON input, straight to the emulator. */
export function directSqs(ctx: Ctx, port: number, action: string, input: object): Promise<DirectAnswer> {
  return direct(ctx, port, 'sqs', 'POST', '/', {}, JSON.stringify(input), {
    'content-type': 'application/x-amz-json-1.0',
    'x-amz-target': `AmazonSQS.${action}`,
  });
}

/**
 * A Lambda request (REST JSON): `method pathname?query` with an optional JSON body, straight to the emulator. Each
 * segment of `pathname` is already encoded by the caller. For the checks of a service other than Lambda that need a
 * function beside their own resources (SNS's, issue 536); Lambda's own checks sign theirs in `services/lambda/`.
 */
export function directLambda(
  ctx: Ctx,
  port: number,
  method: string,
  pathname: string,
  query: Record<string, string> = {},
  input: object | null = null,
): Promise<DirectAnswer> {
  return direct(
    ctx,
    port,
    'lambda',
    method,
    pathname,
    query,
    input === null ? '' : JSON.stringify(input),
    input === null ? {} : { 'content-type': 'application/json' },
  );
}

/** An IAM action (AWS Query) with its parameters, straight to the emulator (issue 536: the role of a check's function). */
export function directIam(
  ctx: Ctx,
  port: number,
  action: string,
  params: Record<string, string>,
): Promise<DirectAnswer> {
  const body = new URLSearchParams({ Action: action, Version: '2010-05-08', ...params }).toString();
  return direct(ctx, port, 'iam', 'POST', '/', {}, body, {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
  });
}

/** An EC2 action (the EC2 query protocol) with its parameters, straight to the emulator (issue 553: EC2's checks). */
export function directEc2(
  ctx: Ctx,
  port: number,
  action: string,
  params: Record<string, string>,
): Promise<DirectAnswer> {
  const body = new URLSearchParams({ Action: action, Version: '2016-11-15', ...params }).toString();
  return direct(ctx, port, 'ec2', 'POST', '/', {}, body, {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
  });
}

/** An RDS action (AWS Query) with its parameters, straight to the emulator (issue 573: RDS's checks). */
export function directRds(
  ctx: Ctx,
  port: number,
  action: string,
  params: Record<string, string>,
): Promise<DirectAnswer> {
  const body = new URLSearchParams({ Action: action, Version: '2014-10-31', ...params }).toString();
  return direct(ctx, port, 'rds', 'POST', '/', {}, body, {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
  });
}

/** A CloudWatch Logs action (AWS JSON 1.1) with its JSON input, straight to the emulator (issue 536: a function's log). */
export function directLogs(ctx: Ctx, port: number, action: string, input: object): Promise<DirectAnswer> {
  return direct(ctx, port, 'logs', 'POST', '/', {}, JSON.stringify(input), {
    'content-type': 'application/x-amz-json-1.1',
    'x-amz-target': `Logs_20140328.${action}`,
  });
}

/** An ECS action (AWS JSON 1.1) with its JSON input, straight to the emulator (issue 575: ECS's checks). */
export function directEcs(ctx: Ctx, port: number, action: string, input: object): Promise<DirectAnswer> {
  return direct(ctx, port, 'ecs', 'POST', '/', {}, JSON.stringify(input), {
    'content-type': 'application/x-amz-json-1.1',
    'x-amz-target': `AmazonEC2ContainerServiceV20141113.${action}`,
  });
}

/** `status` of a direct answer, or its error, for the log. */
export function shown(answer: DirectAnswer): string {
  return 'error' in answer ? `error ${answer.error}` : `status ${String(answer.status)}`;
}

/** The topic ARNs of an SNS `ListTopics` XML body. */
export function topicArns(xml: string): string[] {
  return [...xml.matchAll(/<TopicArn>([^<]*)<\/TopicArn>/g)].map((m) => m[1]);
}

/** The `TopicArn` of an SNS `CreateTopic` XML body; `''` when it holds none. */
export function createdTopicArn(xml: string): string {
  return /<TopicArn>([^<]*)<\/TopicArn>/.exec(xml)?.[1] ?? '';
}
