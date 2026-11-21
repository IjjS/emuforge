// The emulator side of the Lambda function screens (test-criteria.md, issue 84, Flow checks; requirement R2, R12).
// Used by the `lambda-function-*.spec.ts` checks and by `lambda-seed-structure.ts`.
//
// - Direct calls: Lambda (REST with JSON bodies) and IAM (the query protocol) straight to the emulator, SigV4-signed
//   with the key it wrote for this run, TLS verified against its `ca.pem`, never through the engine. Each answer
//   carries the error code the emulator gave (`x-amzn-errortype`, a JSON `__type` or an XML `<Code>`) and its
//   message, so a check compares what Studio shows with them.
// - `storedZip`: a zip archive of one stored (uncompressed) file, the check's own; it shares no code with Studio's.
//   `CHECK_CODE` is the one-file function a check makes directly; it answers `CHECK_ANSWER`, never Studio's
//   greeting, so a direct `Invoke` that returns `GREETING` proves the code is the one Studio wrote.
// - `waitForState`: a function's `State` through `GetFunctionConfiguration`, waited for with a bound (the emulator
//   takes 1 to 2 s from `Pending` to `Active`, R2), never with a sleep.
// - `LambdaSeeded`: the functions and roles a check makes, all named under the check's prefix `<p>`. When the check
//   ends it deletes every function and every role of the emulator whose name starts with `<p>`, those Studio made
//   during the check included, each role's attached policies detached first.
//
// Every value a check compares with comes from the run: names from the check's own prefix, ARNs, dates and URLs from
// a direct answer, the endpoint from the emulator's port.

import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { EnvError, expect, type Ctx } from '../../support/check';
import { emulatorDir, readEmulatorFiles } from '../../support/emulator';
import { waitFor } from '../../support/wait';

const REGION = 'us-east-1';

/** The IAM query protocol's version. */
const IAM_VERSION = '2010-05-08';

/** How long a function may take to reach a state (R2: 1.3 to 1.6 s from `Pending` to `Active`). */
export const STATE_BOUND_MS = 15_000;

/** The managed policy Studio's "Create default role" attaches (R2, R6.3). */
export const BASIC_EXECUTION_POLICY = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

/** The trust policy of every role a check makes: Lambda may assume it. */
export const LAMBDA_TRUST_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Service: 'lambda.amazonaws.com' },
      Action: 'sts:AssumeRole',
    },
  ],
});

/** What a direct call needs of its caller: the run's `$HOME`, where the emulator's files are, and a log. */
export type Caller = Pick<Ctx, 'home' | 'log'>;

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/**
 * An answer of a direct call: its status and body, and the error code and message the emulator gave (`null` for a
 * success); or the error that kept it from arriving.
 */
export type Direct =
  | {
      status: number;
      body: string;
      errorType: string | null;
      message: string | null;
    }
  | { error: string };

/** `status` of a direct answer with its error code, or the error that kept it from arriving, for the log. */
export function shownDirect(answer: Direct): string {
  if ('error' in answer) return `error ${answer.error}`;
  return answer.errorType === null
    ? `status ${String(answer.status)}`
    : `status ${String(answer.status)} ${answer.errorType}`;
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 percent-encoding, as SigV4 wants it: everything but the unreserved characters. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `/a/b` with each segment percent-encoded. */
function encodedPath(segments: string[]): string {
  return segments.map((s) => `/${uriEncode(s)}`).join('');
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** An IAM list's `<member>`, which the emulator writes with an `xmlns` attribute; its content is group 1. */
const MEMBER = /<member(?:\s[^>]*)?>([\s\S]*?)<\/member>/g;

/** The text of the first element `name` of `xml`, attributes allowed on its tag; `null` when it holds none. */
function element(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml);
  return m ? xmlText(m[1]) : null;
}

/** The error code and message of an answer that is not a success, from its header or its JSON or XML body. */
function errorOf(status: number, header: string | undefined, body: string): { type: string; message: string } | null {
  if (status >= 200 && status < 300) return null;
  let type = header ? header.split(':')[0] : '';
  let message = '';
  try {
    const json = JSON.parse(body) as {
      __type?: string;
      message?: string;
      Message?: string;
    };
    if (!type && json.__type) type = json.__type.split('#').at(-1) ?? '';
    message = json.message ?? json.Message ?? '';
  } catch {
    if (!type) type = element(body, 'Code') ?? '';
    message = element(body, 'Message') ?? '';
  }
  return { type, message };
}

/**
 * `method pathname?query` with `body` straight to the emulator on `port` for `service`, header-signed with its key
 * over `host`, `x-amz-content-sha256`, `x-amz-date` and the `extra` headers, TLS verified against its `ca.pem`.
 * `pathname` is already encoded; the names a check uses hold only unreserved characters, so its canonical form is the
 * same once or twice encoded.
 */
async function signed(
  caller: Caller,
  port: number,
  service: string,
  method: string,
  pathname: string,
  query: Record<string, string>,
  body: string,
  extra: Record<string, string>,
): Promise<Direct> {
  const dir = emulatorDir(caller.home, port);
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
  sent['content-length'] = String(Buffer.byteLength(body));
  const target = canonicalQuery === '' ? pathname : `${pathname}?${canonicalQuery}`;
  return new Promise((resolve) => {
    const request = https.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: target,
        ca,
        agent: false,
        timeout: 10_000,
        headers: sent,
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          const header = response.headers['x-amzn-errortype'];
          const error = errorOf(status, Array.isArray(header) ? header[0] : header, text);
          resolve({
            status,
            body: text,
            errorType: error?.type ?? null,
            message: error?.message ?? null,
          });
        });
        response.on('error', (e) => resolve({ error: e.message }));
      },
    );
    request.on('timeout', () => request.destroy(new Error('no answer within 10 s')));
    request.on('error', (e) => resolve({ error: e.message }));
    request.end(body);
  });
}

/** A Lambda request (REST JSON): `method <segments>?query` with an optional JSON body, straight to the emulator. */
export function lambdaDirect(
  caller: Caller,
  port: number,
  method: string,
  segments: string[],
  query: Record<string, string> = {},
  input: object | null = null,
): Promise<Direct> {
  return signed(
    caller,
    port,
    'lambda',
    method,
    encodedPath(segments),
    query,
    input === null ? '' : JSON.stringify(input),
    input === null ? {} : { 'content-type': 'application/json' },
  );
}

/** The last-hour Sum datapoints for a function, read directly in the CloudWatch JSON protocol. */
export async function metricSums(caller: Caller, port: number, name: string, metric: string, end: Date): Promise<number[]> {
  const result = await signed(caller, port, 'monitoring', 'POST', '/', {}, JSON.stringify({
    Namespace: 'AWS/Lambda', Dimensions: [{ Name: 'FunctionName', Value: name }], MetricName: metric,
    StartTime: end.getTime() / 1000 - 3600, EndTime: end.getTime() / 1000, Period: 60, Statistics: ['Sum'],
  }), { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'GraniteServiceVersion20100801.GetMetricStatistics' });
  const body = answered(result, 200, `direct GetMetricStatistics ${name} ${metric}`);
  return (JSON.parse(body) as {Datapoints: {Sum: number}[]}).Datapoints.map(point => point.Sum);
}

/** An IAM action (the query protocol) with its parameters, straight to the emulator. */
export function iamDirect(
  caller: Caller,
  port: number,
  action: string,
  params: Record<string, string> = {},
): Promise<Direct> {
  const body = new URLSearchParams({
    Action: action,
    Version: IAM_VERSION,
    ...params,
  }).toString();
  return signed(caller, port, 'iam', 'POST', '/', {}, body, {
    'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
  });
}

/** Fails the check (an assertion, not the environment) unless `answer` has `status`; returns its body. */
function answered(answer: Direct, status: number, what: string): string {
  expect('error' in answer ? answer.error : answer.status, `${what}: ${shownDirect(answer)}`).toBe(status);
  return 'error' in answer ? '' : answer.body;
}

/** The answer's body when it has `status`; an `EnvError` otherwise (a check's Given that does not hold). */
function given(caller: Caller, answer: Direct, status: number, what: string): string {
  caller.log(`${what}: ${shownDirect(answer)}`);
  if ('error' in answer || answer.status !== status) {
    const message = 'error' in answer || answer.message === null ? '' : `: ${answer.message}`;
    throw new EnvError(`${what} answered ${shownDirect(answer)}${message}`);
  }
  return answer.body;
}

// ---------------------------------------------------------------------------------------------------------------
// Lambda: what the emulator holds.
// ---------------------------------------------------------------------------------------------------------------

/** A function's configuration as the emulator wrote it (a `ListFunctions` item, or `GetFunction`'s `Configuration`). */
export interface FunctionConfiguration {
  FunctionName: string;
  FunctionArn: string;
  Runtime?: string;
  Role: string;
  Handler?: string;
  Description?: string;
  LastModified: string;
  PackageType?: string;
  Architectures?: string[];
  DurableConfig?: Record<string, unknown>;
  Environment?: { Variables?: Record<string, string> };
  /** `GetFunction` and `GetFunctionConfiguration` only; a `ListFunctions` item carries none (R2). */
  State?: string;
  LastUpdateStatus?: string;
  [field: string]: unknown;
}

/** One page of a direct `ListFunctions`. */
export interface FunctionsPage {
  functions: FunctionConfiguration[];
  nextMarker: string | null;
}

/** One direct `ListFunctions` with `MaxItems` and `Marker` when given. */
export async function listFunctionsPage(
  caller: Caller,
  port: number,
  options: { maxItems?: number; marker?: string } = {},
): Promise<FunctionsPage> {
  const query: Record<string, string> = {};
  if (options.maxItems !== undefined) query.MaxItems = String(options.maxItems);
  if (options.marker !== undefined) query.Marker = options.marker;
  const page = JSON.parse(
    answered(
      await lambdaDirect(caller, port, 'GET', ['2015-03-31', 'functions', ''], query),
      200,
      'direct ListFunctions',
    ),
  ) as { Functions?: FunctionConfiguration[]; NextMarker?: string };
  return {
    functions: page.Functions ?? [],
    nextMarker: page.NextMarker ?? null,
  };
}

/**
 * Every function a direct `ListFunctions` returns, in its order, page after page of 50; with `prefix`, only those
 * whose name starts with it (the operation has no filter, R2).
 */
export async function listFunctionsDirect(
  caller: Caller,
  port: number,
  prefix?: string,
): Promise<FunctionConfiguration[]> {
  const all: FunctionConfiguration[] = [];
  let marker: string | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    const page = await listFunctionsPage(caller, port, {
      maxItems: 50,
      marker,
    });
    all.push(...page.functions);
    if (page.nextMarker === null) {
      return prefix === undefined ? all : all.filter((f) => f.FunctionName.startsWith(prefix));
    }
    marker = page.nextMarker;
  }
  throw new Error('direct ListFunctions: more than 1000 pages');
}

/** The names of a direct `ListFunctions`, in its order, those starting with `prefix` when given. */
export async function functionNamesDirect(caller: Caller, port: number, prefix?: string): Promise<string[]> {
  return (await listFunctionsDirect(caller, port, prefix)).map((f) => f.FunctionName);
}

/** What a direct `GetFunction` says: the function, or the error code and message of its refusal. */
export type FunctionRead =
  | {
      found: true;
      configuration: FunctionConfiguration;
      /** `Code.Location`: the signed URL of the function's code on the emulator. */
      codeLocation: string | null;
      tags: Record<string, string>;
    }
  | { found: false; status: number; errorType: string; message: string };

/** A direct `GetFunction name`. Fails the check on anything but 200 or a refusal with an error code. */
export async function getFunctionDirect(caller: Caller, port: number, name: string): Promise<FunctionRead> {
  const answer = await lambdaDirect(caller, port, 'GET', ['2015-03-31', 'functions', name]);
  caller.log(`direct GetFunction ${name}: ${shownDirect(answer)}`);
  expect('error' in answer ? answer.error : 'answered', `direct GetFunction ${name}: ${shownDirect(answer)}`).toBe(
    'answered',
  );
  if ('error' in answer) throw new Error('unreachable');
  if (answer.status === 200) {
    const read = JSON.parse(answer.body) as {
      Configuration: FunctionConfiguration;
      Code?: { Location?: string };
      Tags?: Record<string, string>;
    };
    return {
      found: true,
      configuration: read.Configuration,
      codeLocation: read.Code?.Location ?? null,
      tags: read.Tags ?? {},
    };
  }
  expect(answer.errorType, `direct GetFunction ${name}: ${shownDirect(answer)} carries an error code`).toBeTruthy();
  return {
    found: false,
    status: answer.status,
    errorType: answer.errorType ?? '',
    message: answer.message ?? '',
  };
}

/** A direct `GetFunctionConfiguration name`; `null` when the emulator does not hold the function (404). */
export async function functionConfigurationDirect(
  caller: Caller,
  port: number,
  name: string,
): Promise<FunctionConfiguration | null> {
  const answer = await lambdaDirect(caller, port, 'GET', ['2015-03-31', 'functions', name, 'configuration']);
  if (!('error' in answer) && answer.status === 404) return null;
  return JSON.parse(answered(answer, 200, `direct GetFunctionConfiguration ${name}`)) as FunctionConfiguration;
}

/** The `FunctionUrl` of a direct `GetFunctionUrlConfig name`; `null` when the function has no URL (404). */
export async function functionUrlDirect(caller: Caller, port: number, name: string): Promise<string | null> {
  const answer = await lambdaDirect(caller, port, 'GET', ['2021-10-31', 'functions', name, 'url']);
  if (!('error' in answer) && answer.status === 404) return null;
  const read = JSON.parse(answered(answer, 200, `direct GetFunctionUrlConfig ${name}`)) as { FunctionUrl: string };
  return read.FunctionUrl;
}

/**
 * Waits up to `boundMs` for the function `name` to be in `state` (`GetFunctionConfiguration`'s `State`). Returns the
 * last state read (`null` once the emulator holds no such function); the caller asserts it.
 */
export async function waitForState(
  caller: Caller,
  port: number,
  name: string,
  state = 'Active',
  boundMs = STATE_BOUND_MS,
): Promise<string | null> {
  let last: string | null = null;
  await waitFor(boundMs, async () => {
    const configuration = await functionConfigurationDirect(caller, port, name);
    last = configuration === null ? null : (configuration.State ?? null);
    return last === state ? true : undefined;
  });
  caller.log(`direct GetFunctionConfiguration ${name}: State ${String(last)} (waited for ${state})`);
  return last;
}

/** What a direct `Invoke` returned: its status, the function's error when it raised one, and the payload. */
export interface Invoked {
  status: number;
  errorType: string | null;
  payload: string;
}

/** A direct `Invoke name` (`RequestResponse`) with `event`. */
export async function invokeDirect(caller: Caller, port: number, name: string, event: object = {}): Promise<Invoked> {
  const answer = await lambdaDirect(caller, port, 'POST', ['2015-03-31', 'functions', name, 'invocations'], {}, event);
  caller.log(`direct Invoke ${name}: ${shownDirect(answer)}`);
  expect('error' in answer ? answer.error : 'answered', `direct Invoke ${name}: ${shownDirect(answer)}`).toBe(
    'answered',
  );
  if ('error' in answer) throw new Error('unreachable');
  return {
    status: answer.status,
    errorType: answer.errorType,
    payload: answer.body,
  };
}

/** The sentence Studio's starter code answers with (R6.5). */
export const GREETING = 'Hello from EmuForge Studio!';

/** Whether an `Invoke` payload is the greeting: status code 200 and the body `GREETING` as a JSON string (R6.5). */
export function isGreeting(payload: string): boolean {
  try {
    const answer = JSON.parse(payload) as {
      statusCode?: unknown;
      body?: unknown;
    };
    return answer.statusCode === 200 && typeof answer.body === 'string' && JSON.parse(answer.body) === GREETING;
  } catch {
    return false;
  }
}

/** A direct `UpdateFunctionConfiguration name` with `Description` `description`. */
export async function updateDescriptionDirect(
  caller: Caller,
  port: number,
  name: string,
  description: string,
): Promise<void> {
  answered(
    await lambdaDirect(
      caller,
      port,
      'PUT',
      ['2015-03-31', 'functions', name, 'configuration'],
      {},
      {
        Description: description,
      },
    ),
    200,
    `direct UpdateFunctionConfiguration ${name}`,
  );
}

/**
 * A direct `UpdateFunctionConfiguration name` with `Environment.Variables` `variables`, the whole map, written in
 * the order of `variables`' own keys (issue 570).
 */
export async function updateVariablesDirect(
  caller: Caller,
  port: number,
  name: string,
  variables: Record<string, string>,
): Promise<void> {
  answered(
    await lambdaDirect(
      caller,
      port,
      'PUT',
      ['2015-03-31', 'functions', name, 'configuration'],
      {},
      {
        Environment: { Variables: variables },
      },
    ),
    200,
    `direct UpdateFunctionConfiguration ${name}`,
  );
}

/** A direct `DeleteFunction name`; the caller asserts the answer. */
export async function deleteFunctionDirect(caller: Caller, port: number, name: string): Promise<Direct> {
  const answer = await lambdaDirect(caller, port, 'DELETE', ['2015-03-31', 'functions', name]);
  caller.log(`direct DeleteFunction ${name}: ${shownDirect(answer)}`);
  return answer;
}

// ---------------------------------------------------------------------------------------------------------------
// Lambda: making functions.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Builds a zip archive of one stored (uncompressed) file `name` holding `text` (PKWARE APPNOTE 6.3: one local file
 * header, the data, one central directory header, the end of central directory record).
 */
export function storedZip(name: string, text: string): Buffer {
  const fileName = Buffer.from(name, 'utf8');
  const data = Buffer.from(text, 'utf8');
  const crc = crc32(data);
  // 1980-01-01 00:00:00 in MS-DOS time: a fixed date, so the same input gives the same archive.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed to extract: 2.0
  local.writeUInt16LE(0x0800, 6); // flags: the name is UTF-8
  local.writeUInt16LE(0, 8); // method: stored
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt16LE(0, 30); // extra field length
  central.writeUInt16LE(0, 32); // comment length
  central.writeUInt16LE(0, 34); // disk number
  central.writeUInt16LE(0, 36); // internal attributes
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: a regular file, rw-r--r--
  central.writeUInt32LE(0, 42); // offset of the local header
  const centralOffset = local.length + fileName.length + data.length;
  const centralSize = central.length + fileName.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (ISO 3309, the polynomial 0xEDB88320 reflected), as a zip archive records it. */
function crc32(data: Buffer): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The sentence the check's own function answers with: never Studio's `GREETING`. */
export const CHECK_ANSWER = 'Hello from the EmuForge integration checks';

/**
 * The one-file function a check makes directly, by runtime family: its file, handler and text. It returns
 * `{ statusCode: 200, body: JSON.stringify(CHECK_ANSWER) }`.
 */
export function checkCode(runtime: string): {
  file: string;
  handler: string;
  text: string;
} {
  if (runtime.startsWith('python')) {
    return {
      file: 'check_function.py',
      handler: 'check_function.handler',
      text: `import json\n\n\ndef handler(event, context):\n    return {"statusCode": 200, "body": json.dumps(${JSON.stringify(CHECK_ANSWER)})}\n`,
    };
  }
  if (runtime.startsWith('nodejs')) {
    return {
      file: 'check.mjs',
      handler: 'check.handler',
      text: `export const handler = async () => ({ statusCode: 200, body: JSON.stringify(${JSON.stringify(CHECK_ANSWER)}) });\n`,
    };
  }
  throw new Error(`services/lambda/lambda.ts has no check code for the runtime ${runtime}`);
}

/** What a function a check makes directly has; everything but `role` has a default. */
export interface FunctionOptions {
  /** The role's ARN. */
  role: string;
  /** Default `nodejs22.x`. */
  runtime?: string;
  /** Default the emulator's (`x86_64`). */
  architecture?: 'x86_64' | 'arm64';
  description?: string;
  /** A durable function (`DurableConfig`, R2). */
  durable?: boolean;
  environment?: Record<string, string>;
  /** The function's own archive and the handler in it (issue 516); without it the check's one-file code. */
  code?: { zip: Buffer; handler: string };
  /** `Timeout` in seconds; default the emulator's. */
  timeout?: number;
  /** `MemorySize` in MB; default the emulator's. */
  memorySize?: number;
}

/** A direct `CreateFunction name` with the check's own code; the caller asserts the answer. */
export async function createFunctionDirect(
  caller: Caller,
  port: number,
  name: string,
  options: FunctionOptions,
): Promise<Direct> {
  const runtime = options.runtime ?? 'nodejs22.x';
  let code = options.code;
  if (code === undefined) {
    const own = checkCode(runtime);
    code = { zip: storedZip(own.file, own.text), handler: own.handler };
  }
  const input: Record<string, unknown> = {
    FunctionName: name,
    Runtime: runtime,
    Role: options.role,
    Handler: code.handler,
    Code: { ZipFile: code.zip.toString('base64') },
  };
  if (options.timeout !== undefined) input.Timeout = options.timeout;
  if (options.memorySize !== undefined) input.MemorySize = options.memorySize;
  if (options.architecture !== undefined) input.Architectures = [options.architecture];
  if (options.description !== undefined) input.Description = options.description;
  if (options.durable) input.DurableConfig = { ExecutionTimeout: 60, RetentionPeriodInDays: 1 };
  if (options.environment !== undefined) input.Environment = { Variables: options.environment };
  const answer = await lambdaDirect(caller, port, 'POST', ['2015-03-31', 'functions'], {}, input);
  caller.log(`direct CreateFunction ${name} (${runtime}): ${shownDirect(answer)}`);
  return answer;
}

/** A direct `CreateFunctionUrlConfig name` with `AuthType` `NONE`; the caller asserts the answer. */
export async function createFunctionUrlDirect(caller: Caller, port: number, name: string): Promise<Direct> {
  const answer = await lambdaDirect(
    caller,
    port,
    'POST',
    ['2021-10-31', 'functions', name, 'url'],
    {},
    {
      AuthType: 'NONE',
    },
  );
  caller.log(`direct CreateFunctionUrlConfig ${name}: ${shownDirect(answer)}`);
  return answer;
}

// ---------------------------------------------------------------------------------------------------------------
// IAM: roles and their policies.
// ---------------------------------------------------------------------------------------------------------------

/** A role as a direct IAM answer gives it. */
export interface DirectRole {
  name: string;
  arn: string;
  path: string;
}

function rolesOf(xml: string): DirectRole[] {
  return [...xml.matchAll(MEMBER)]
    .map((m) => m[1])
    .filter((member) => member.includes('<RoleName>'))
    .map((member) => ({
      name: element(member, 'RoleName') ?? '',
      arn: element(member, 'Arn') ?? '',
      path: element(member, 'Path') ?? '',
    }));
}

/** One page of a direct `ListRoles`. */
export interface RolesPage {
  roles: DirectRole[];
  isTruncated: boolean;
  marker: string | null;
}

/** One direct `ListRoles` with `MaxItems` and `Marker` when given. */
export async function listRolesPage(
  caller: Caller,
  port: number,
  options: { maxItems?: number; marker?: string } = {},
): Promise<RolesPage> {
  const params: Record<string, string> = {};
  if (options.maxItems !== undefined) params.MaxItems = String(options.maxItems);
  if (options.marker !== undefined) params.Marker = options.marker;
  const body = answered(await iamDirect(caller, port, 'ListRoles', params), 200, 'direct ListRoles');
  return {
    roles: rolesOf(body),
    isTruncated: element(body, 'IsTruncated') === 'true',
    marker: element(body, 'Marker'),
  };
}

/** Every role a direct `ListRoles` returns, in its order, page after page of 100; those starting with `prefix`. */
export async function listRolesDirect(caller: Caller, port: number, prefix?: string): Promise<DirectRole[]> {
  const all: DirectRole[] = [];
  let marker: string | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    const page = await listRolesPage(caller, port, { maxItems: 100, marker });
    all.push(...page.roles);
    if (!page.isTruncated || page.marker === null) {
      return prefix === undefined ? all : all.filter((r) => r.name.startsWith(prefix));
    }
    marker = page.marker;
  }
  throw new Error('direct ListRoles: more than 1000 pages');
}

/** A direct IAM `GetRole name`; `null` when the emulator holds no such role (`NoSuchEntity`). */
export async function getRoleDirect(caller: Caller, port: number, name: string): Promise<DirectRole | null> {
  const answer = await iamDirect(caller, port, 'GetRole', { RoleName: name });
  caller.log(`direct GetRole ${name}: ${shownDirect(answer)}`);
  if (!('error' in answer) && answer.status === 404) return null;
  const body = answered(answer, 200, `direct GetRole ${name}`);
  return {
    name: element(body, 'RoleName') ?? '',
    arn: element(body, 'Arn') ?? '',
    path: element(body, 'Path') ?? '',
  };
}

/** The managed policies a direct `ListAttachedRolePolicies roleName` lists: their names and ARNs. */
export async function attachedPoliciesDirect(
  caller: Caller,
  port: number,
  roleName: string,
): Promise<{ name: string; arn: string }[]> {
  const body = answered(
    await iamDirect(caller, port, 'ListAttachedRolePolicies', {
      RoleName: roleName,
    }),
    200,
    `direct ListAttachedRolePolicies ${roleName}`,
  );
  return [...body.matchAll(MEMBER)].map((m) => ({
    name: element(m[1], 'PolicyName') ?? '',
    arn: element(m[1], 'PolicyArn') ?? '',
  }));
}

/** A direct IAM `CreateRole name` under `rolePath` with Lambda's trust policy; the caller asserts the answer. */
export async function createRoleDirect(caller: Caller, port: number, name: string, rolePath = '/'): Promise<Direct> {
  const answer = await iamDirect(caller, port, 'CreateRole', {
    RoleName: name,
    Path: rolePath,
    AssumeRolePolicyDocument: LAMBDA_TRUST_POLICY,
  });
  caller.log(`direct CreateRole ${name} under ${rolePath}: ${shownDirect(answer)}`);
  return answer;
}

/** The `Arn` of a `CreateRole` or `GetRole` XML body; `''` when it holds none. */
export function roleArnOf(xml: string): string {
  return element(xml, 'Arn') ?? '';
}

/** A direct IAM `AttachRolePolicy roleName policyArn`; the caller asserts the answer. */
export async function attachRolePolicyDirect(
  caller: Caller,
  port: number,
  roleName: string,
  policyArn: string,
): Promise<Direct> {
  const answer = await iamDirect(caller, port, 'AttachRolePolicy', {
    RoleName: roleName,
    PolicyArn: policyArn,
  });
  caller.log(`direct AttachRolePolicy ${roleName} ${policyArn}: ${shownDirect(answer)}`);
  return answer;
}

/** Detaches every managed policy of the role `name`, then deletes it, straight through the emulator; logs each. */
export async function removeRoleDirect(caller: Caller, port: number, name: string): Promise<void> {
  const listed = await iamDirect(caller, port, 'ListAttachedRolePolicies', {
    RoleName: name,
  });
  caller.log(`cleanup ListAttachedRolePolicies ${name} directly: ${shownDirect(listed)}`);
  const arns =
    'error' in listed || listed.status !== 200
      ? []
      : [...listed.body.matchAll(/<PolicyArn>([^<]*)<\/PolicyArn>/g)].map((m) => xmlText(m[1]));
  for (const arn of arns) {
    const detached = await iamDirect(caller, port, 'DetachRolePolicy', {
      RoleName: name,
      PolicyArn: arn,
    });
    caller.log(`cleanup DetachRolePolicy ${name} ${arn} directly: ${shownDirect(detached)}`);
  }
  const deleted = await iamDirect(caller, port, 'DeleteRole', {
    RoleName: name,
  });
  caller.log(`cleanup DeleteRole ${name} directly: ${shownDirect(deleted)}`);
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The functions and roles a check makes directly on the emulator on `port`, each named under the check's prefix.
 * When the check ends, every function and every role of the emulator whose name starts with the prefix is deleted,
 * those Studio made during the check included, a role's attached policies detached first; a removal that fails is
 * logged. Making one that the emulator refuses is an environment failure: the check's Given would not hold.
 */
export class LambdaSeeded {
  private defaultRole: string | null = null;

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  private named(name: string, what: string): void {
    if (!name.startsWith(this.prefix))
      throw new Error(`${what} ${name} is not under the check's prefix ${this.prefix}`);
  }

  /** `CreateRole name` under `rolePath`; returns the role's ARN from the answer. */
  async role(name: string, rolePath = '/'): Promise<string> {
    this.named(name, 'role');
    const body = given(
      this.ctx,
      await createRoleDirect(this.ctx, this.port, name, rolePath),
      200,
      `direct CreateRole ${name}`,
    );
    return roleArnOf(body);
  }

  /** `AttachRolePolicy roleName policyArn`. */
  async attach(roleName: string, policyArn: string): Promise<void> {
    given(
      this.ctx,
      await attachRolePolicyDirect(this.ctx, this.port, roleName, policyArn),
      200,
      `direct AttachRolePolicy ${roleName}`,
    );
  }

  /** The ARN of the role the check's functions run as when it names none: `<p>-checks-role`, made once. */
  async functionRole(): Promise<string> {
    if (this.defaultRole === null) this.defaultRole = await this.role(`${this.prefix}-checks-role`);
    return this.defaultRole;
  }

  /**
   * `CreateFunction name` with the check's own code, then waits until it is `Active` (an `EnvError` when it is not
   * within the bound). Returns its configuration as `GetFunctionConfiguration` gives it once `Active`.
   */
  async function(
    name: string,
    options: Partial<FunctionOptions> & { url?: boolean } = {},
  ): Promise<FunctionConfiguration> {
    this.named(name, 'function');
    const role = options.role ?? (await this.functionRole());
    given(
      this.ctx,
      await createFunctionDirect(this.ctx, this.port, name, {
        ...options,
        role,
      }),
      201,
      `direct CreateFunction ${name}`,
    );
    const state = await waitForState(this.ctx, this.port, name);
    if (state !== 'Active')
      throw new EnvError(`function ${name} was ${String(state)}, not Active, within ${STATE_BOUND_MS} ms`);
    if (options.url) await this.url(name);
    const configuration = await functionConfigurationDirect(this.ctx, this.port, name);
    if (configuration === null) throw new EnvError(`function ${name} is gone right after it was made`);
    return configuration;
  }

  /** `CreateFunctionUrlConfig name`; returns the URL from the answer. */
  async url(name: string): Promise<string> {
    const body = given(
      this.ctx,
      await createFunctionUrlDirect(this.ctx, this.port, name),
      201,
      `direct CreateFunctionUrlConfig ${name}`,
    );
    return (JSON.parse(body) as { FunctionUrl: string }).FunctionUrl;
  }

  async dispose(): Promise<void> {
    const where = `on the emulator at port ${String(this.port)}`;
    try {
      for (const name of await functionNamesDirect(this.ctx, this.port, this.prefix)) {
        await deleteFunctionDirect(this.ctx, this.port, name);
      }
    } catch (e) {
      this.ctx.log(`cleanup of the functions ${this.prefix}* ${where} failed: ${(e as Error).message}`);
    }
    try {
      for (const role of await listRolesDirect(this.ctx, this.port, this.prefix)) {
        await removeRoleDirect(this.ctx, this.port, role.name);
      }
    } catch (e) {
      this.ctx.log(`cleanup of the roles ${this.prefix}* ${where} failed: ${(e as Error).message}`);
    }
  }
}

/** The emulator's endpoint as Studio names it in the notice and the delete dialog: `https://127.0.0.1:<port>`. */
export function endpointOf(port: number): string {
  return `https://127.0.0.1:${String(port)}`;
}
