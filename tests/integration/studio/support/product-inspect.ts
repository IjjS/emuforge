// What the product checks of unit t2 (issue 34) need besides `product.ts`: a command run in any directory with an
// environment the check gives, Compose's arguments of a situation for a command other than start and stop (held in
// `product.ts` with the command lines since issue 54, and passed on here), S3
// requests signed with the emulator's key (straight to the emulator over TLS verified against its `ca.pem`, or to a
// form's engine port with headers the signature does not cover), the transparency comparison of
// `engine/references/relay-fidelity.md`, the host's non-loopback IPv4 addresses and a TCP probe at one of them, and
// a search of an image's saved content and of any text for the emulator's secret values.
//
// The emulator's secret values (test-criteria.md, shared terms) are its access key id, its secret access key and
// each base64 body line of its `ca.pem`. They are registered for redaction when they are read
// (`readEmulatorFiles`), and a finding names which value and where, never the value.

import { execFile } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { EnvError, type Ctx } from './check';
import { emulatorDir, readEmulatorFiles, type EmulatorFiles } from './emulator';
import { Proc } from './process';
import { commandLine, request, type CommandResult, type HttpAnswer } from './product';

export { composeArgs } from './product';

const REGION = 'us-east-1';

/** Runs `args` in `cwd` with exactly `env` and waits for its exit within `boundMs` (as `Form.run`, any directory). */
export async function runAt(
  ctx: Ctx,
  cwd: string,
  args: string[],
  env: Record<string, string>,
  boundMs: number,
): Promise<CommandResult> {
  const line = commandLine(args);
  const proc = Proc.spawn(ctx, line, args[0], args.slice(1), cwd, env);
  const exit = await proc.waitExit(boundMs);
  const { stdout, stderr } = await proc.stop();
  if (!exit) throw new Error(`${line} did not exit within ${boundMs / 1000}s`);
  ctx.log(`${line}: exit ${String(exit.code)}${exit.signal ? ` signal ${exit.signal}` : ''}`);
  return { line, code: exit.code, stdout, stderr };
}

/** `docker <args>` with the test process's environment: whether it exited 0, and both streams. */
export function docker(args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'docker',
      args,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout.trim(),
          stderr: (stderr || error?.message || '').trim(),
        });
      },
    );
  });
}

/** The current files of the emulator on `port` under the run's `HOME`; `EnvError` when they are incomplete. */
export function emulatorKey(ctx: Ctx, port: number): EmulatorFiles {
  const dir = emulatorDir(ctx.home, port);
  const files = readEmulatorFiles(dir);
  if (!files) throw new EnvError(`the emulator files under ${dir} are incomplete`);
  return files;
}

/** The emulator's secret values with the name a finding gives each. */
export function secretValues(files: EmulatorFiles): [string, string][] {
  return [
    ['the access key id', files.accessKeyId],
    ['the secret access key', files.secretAccessKey],
    ...files.caLines.map((line, i): [string, string] => [`ca.pem base64 line ${String(i + 1)}`, line]),
  ];
}

/** `<name> in <where>` for each of `secrets` found in `data`. */
export function findSecrets(where: string, data: Buffer | string, secrets: [string, string][]): string[] {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return secrets.filter(([, value]) => bytes.includes(value)).map(([name]) => `${name} in ${where}`);
}

/** A prefix unique to the check run for resource names (as the Studio relay checks name theirs). */
export function runPrefix(ctx: Ctx): string {
  return `efit-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * SigV4 header signing for `s3` of `method pathname` (path style, no query) to `host`, over `host`,
 * `x-amz-content-sha256` and `x-amz-date`, as the suite's transparency checks sign. The headers to send, `host`
 * included.
 */
export function signS3(
  host: string,
  method: string,
  pathname: string,
  body: Buffer,
  key: EmulatorFiles,
): Record<string, string> {
  const amzDate = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
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
  const scope = `${day}/${REGION}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(Buffer.from(canonical, 'utf8'))].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, ` +
      `Signature=${signature}`,
  };
}

/**
 * A signed S3 request over plain HTTP to `127.0.0.1:<port>` (a form's engine port), with `unsigned` headers added
 * after signing (`Origin`, `X-EmuForge-Session`: what a browser adds and the engine removes before it relays).
 */
export function signedVia(
  port: number,
  key: EmulatorFiles,
  method: string,
  pathname: string,
  unsigned: Record<string, string> = {},
  body: Buffer = Buffer.alloc(0),
): Promise<HttpAnswer | { error: string }> {
  const signed = signS3(`127.0.0.1:${String(port)}`, method, pathname, body, key);
  return request(port, method, pathname, { ...signed, ...unsigned }, body, 30_000);
}

/** A signed S3 request straight to the emulator on `port`, TLS verified against its `ca.pem`; never via the engine. */
export function directS3(
  ctx: Ctx,
  port: number,
  method: string,
  pathname: string,
  body: Buffer = Buffer.alloc(0),
): Promise<HttpAnswer | { error: string }> {
  const dir = emulatorDir(ctx.home, port);
  const key = readEmulatorFiles(dir);
  if (!key)
    return Promise.resolve({
      error: `the emulator files under ${dir} are incomplete`,
    });
  const ca = fs.readFileSync(path.join(dir, 'ca.pem'));
  const headers = signS3(`127.0.0.1:${String(port)}`, method, pathname, body, key);
  if (body.length > 0) headers['content-length'] = String(body.length);
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        ca,
        agent: false,
        timeout: 30_000,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', (e) => resolve({ error: e.message }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('no answer within 30 s')));
    req.on('error', (e) => resolve({ error: e.message }));
    req.end(body.length > 0 ? body : undefined);
  });
}

/** The status of an answer, or its error, for an assertion. */
export function statusOf(answer: HttpAnswer | { error: string }): number | string {
  return 'error' in answer ? answer.error : answer.status;
}

/** The error code of an answer: `error.code` of the engine's JSON refusal, or the `<Code>` of an XML error. */
export function errorCode(answer: HttpAnswer): string | null {
  const text = answer.body.toString('utf8');
  try {
    const code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
    if (typeof code === 'string') return code;
  } catch {
    // Not JSON.
  }
  return /<Code>([^<]*)<\/Code>/.exec(text)?.[1] ?? null;
}

/** Response headers that differ per request and are not compared (`relay-fidelity.md`). */
const REQUEST_ID_HEADERS = ['x-amz-request-id', 'x-amz-id-2', 'x-amzn-requestid'];

function comparedHeaders(answer: HttpAnswer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(answer.headers)) {
    const compared =
      name === 'content-type' ||
      ((name.startsWith('x-amz-') || name.startsWith('x-amzn-')) && !REQUEST_ID_HEADERS.includes(name));
    if (compared && value !== undefined) out[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/**
 * The differences between a direct answer and the same request's answer through a form, as
 * `engine/references/relay-fidelity.md` defines transparency: status, the body byte for byte, `Content-Type` and
 * every `x-amz-*` (and `x-amzn-*`) header except the request ids; for an error, its code. The bodies compared here
 * are objects, which hold no value the emulator generates per request, so nothing is replaced. Empty when the pair
 * is transparent.
 */
export function transparencyDiff(direct: HttpAnswer, through: HttpAnswer): string[] {
  const out: string[] = [];
  if (direct.status !== through.status) {
    out.push(`status: direct ${String(direct.status)}, through the form ${String(through.status)}`);
  }
  const [dh, th] = [comparedHeaders(direct), comparedHeaders(through)];
  for (const name of [...new Set([...Object.keys(dh), ...Object.keys(th)])].sort()) {
    if (dh[name] !== th[name]) {
      out.push(`header ${name}: direct ${JSON.stringify(dh[name])}, through the form ${JSON.stringify(th[name])}`);
    }
  }
  if (!direct.body.equals(through.body)) {
    const length = Math.min(direct.body.length, through.body.length);
    let at = 0;
    while (at < length && direct.body[at] === through.body[at]) at++;
    out.push(
      `body: direct ${String(direct.body.length)} bytes, through the form ${String(through.body.length)} bytes, first difference at byte ${String(at)}`,
    );
  }
  if (direct.status >= 300 || through.status >= 300) {
    const [dc, tc] = [errorCode(direct), errorCode(through)];
    if (dc !== tc) out.push(`error code: direct ${String(dc)}, through the form ${String(tc)}`);
  }
  return out;
}

/** The host's IPv4 addresses that are not loopback, from its interfaces. */
export function hostIPv4(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const address of list ?? []) {
      if (address.family === 'IPv4' && !address.internal && !address.address.startsWith('127.')) {
        out.push(address.address);
      }
    }
  }
  return [...new Set(out)];
}

/** How a TCP connection to `host:port` ends: `open` (accepted), `refused`, `timeout`, or another error code. */
export function probeAt(host: string, port: number, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result: string) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done('timeout'));
    socket.once('connect', () => done('open'));
    socket.once('error', (e: NodeJS.ErrnoException) =>
      done(e.code === 'ECONNREFUSED' ? 'refused' : (e.code ?? 'error')),
    );
  });
}

/** The entries of a tar archive: each regular file's name and content. */
function tarEntries(archive: Buffer): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  let at = 0;
  let longName: string | null = null;
  while (at + 512 <= archive.length) {
    const header = archive.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from: number, length: number) =>
      header
        .subarray(from, from + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const sizeField = header.subarray(124, 136);
    const size =
      (sizeField[0] & 0x80) !== 0
        ? Number(sizeField.subarray(1).reduce((n, b) => n * 256n + BigInt(b), 0n))
        : parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = field(345, 155);
    const data = archive.subarray(at + 512, at + 512 + size);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    if (type === 'L') longName = data.toString('utf8').replace(/\0.*$/s, '');
    else if (type === 'x') {
      const pathRecord = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (pathRecord) longName = pathRecord[1];
    } else if (type === '0' || type === '\0' || type === '7') out.push({ name, data });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** A blob as stored, or decompressed when it is gzip or zstd (an image layer). */
function decompressed(data: Buffer): Buffer {
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) return zlib.gunzipSync(data);
  if (data.length >= 4 && data.readUInt32LE(0) === 0xfd2fb528) {
    const zstd = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync;
    if (!zstd) throw new EnvError('an image layer is zstd-compressed and this Node.js cannot decompress zstd');
    return zstd(data);
  }
  return data;
}

/** How long `docker save` of the product image may take. */
export const SAVE_BOUND_MS = 180_000;

/**
 * Saves `image` (`docker save`) into the run's scratch space and searches every file of the archive, each image
 * layer decompressed, for `secrets`. The findings; the archive is removed either way. `EnvError` when the image
 * cannot be saved.
 */
export async function searchImage(
  ctx: Ctx,
  image: string,
  env: Record<string, string>,
  secrets: [string, string][],
): Promise<{ files: number; findings: string[] }> {
  fs.mkdirSync(ctx.tmp, { recursive: true });
  const file = path.join(ctx.tmp, `image-${ctx.id}-${String(Date.now())}.tar`);
  try {
    const saved = await runAt(ctx, ctx.checkout, ['docker', 'save', '-o', file, image], env, SAVE_BOUND_MS);
    if (saved.code !== 0 || !fs.existsSync(file)) {
      throw new EnvError(`docker save ${image} exited ${String(saved.code)}: ${saved.stderr.trim()}`);
    }
    const entries = tarEntries(fs.readFileSync(file));
    const findings: string[] = [];
    for (const entry of entries) {
      findings.push(...findSecrets(`${image}: ${entry.name}`, decompressed(entry.data), secrets));
    }
    ctx.log(`searched ${String(entries.length)} files of the saved ${image}: ${String(findings.length)} finding(s)`);
    return { files: entries.length, findings };
  } finally {
    fs.rmSync(file, { force: true });
  }
}
