// Issue 24 (test-criteria.md, Integration): a Chromium page at the built Studio's origin holds an answer the engine
// gave to a request with the session token, then sends a request to the same URL without the token, or with a token
// that is not the engine's. The browser must not answer it from its HTTP cache: it reaches the engine and resolves
// with the engine's refusal. The last check is a guard: with the token, the emulator's own caching headers reach the
// page unchanged. Every request is a `fetch` header-signed with the check key, as in
// `engine.studio-browser-reads-relayed-s3-answer`; the ids are `engine.` because the engine owns the behavior.

import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { emulatorDir, expect, readEmulatorFiles, registerSecret, startStack, test, type Ctx } from './support';

const REGION = 'us-east-1';

/** A key the emulator does not know (the check key of the engine checks), with a made-up secret. */
const CHECK_KEY = {
  accessKeyId: 'AKIAEMUFORGECHECK001',
  secretAccessKey: 'emuforgeCheckSecretKey0000000000000000000',
};

const BODY = 'hello world';
const MAX_AGE = 'max-age=3600';
/** A well-formed token that is not this engine's. */
const OTHER_TOKEN = '0'.repeat(64);

interface SigningKey {
  accessKeyId: string;
  secretAccessKey: string;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * SigV4 header signing for `s3` of `method path` (no query) to `host`, over `host`, `x-amz-content-sha256`,
 * `x-amz-date` and every header of `extra`. Returns the headers to send besides `Host`.
 */
function signS3(
  method: string,
  pathname: string,
  host: string,
  body: string,
  key: SigningKey,
  extra: Record<string, string> = {},
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
  const scope = `${day}/${REGION}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const sent = { ...headers };
  delete sent.host;
  sent.authorization =
    `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, ` +
    `Signature=${signature}`;
  return sent;
}

/** What a request straight to the emulator gave: status and headers, or why it failed. */
type Direct =
  { ok: true; status: number; headers: Record<string, string | string[] | undefined> } | { ok: false; error: string };

/** `method path` straight to the emulator on `port`, signed with its key, TLS verified against its `ca.pem`. */
async function direct(ctx: Ctx, port: number, method: string, pathname: string): Promise<Direct> {
  const dir = emulatorDir(ctx.home, port);
  const files = readEmulatorFiles(dir);
  if (!files) return { ok: false, error: `the emulator files under ${dir} are incomplete` };
  const ca = fs.readFileSync(path.join(dir, 'ca.pem'));
  const host = `127.0.0.1:${port}`;
  const headers = signS3(method, pathname, host, '', files);
  return new Promise((resolve) => {
    const request = https.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        ca,
        agent: false,
        timeout: 5_000,
        headers,
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve({ ok: true, status: response.statusCode ?? 0, headers: response.headers }));
        response.on('error', (e) => resolve({ ok: false, error: e.message }));
      },
    );
    request.on('timeout', () => request.destroy(new Error('no answer within 5 s')));
    request.on('error', (e) => resolve({ ok: false, error: e.message }));
    request.end();
  });
}

/** What the page's `fetch` gave: status, text and every header the page can read, or the rejection. */
type Fetched =
  | { resolved: true; status: number; text: string; headers: Record<string, string> }
  | { resolved: false; error: string };

type Resolved = Extract<Fetched, { resolved: true }>;

interface SendOptions {
  /** The `X-EmuForge-Session` to send: the page's token (default), another value, or none (`null`). */
  session?: string | null;
  /** More headers, signed with the rest. */
  headers?: Record<string, string>;
  /** The `fetch` cache mode; the browser's default when absent. */
  cache?: RequestCache;
}

interface Stored {
  ctx: Ctx;
  bucket: string;
  key: string;
  emulatorPort: number;
  send(what: string, method: string, pathname: string, body: string, options?: SendOptions): Promise<Resolved>;
}

/**
 * The Given of every check: the stack, the page at Studio's origin with the token it obtained, cleanup straight
 * through the emulator, then `PUT /<b>`, `PUT /<b>/k` with `hello world` (and `Cache-Control: <objectCacheControl>`
 * when given) and `GET /<b>/k` with the token, each answered `200`, after which the page holds a stored answer.
 */
async function storedAnswer(ctx: Ctx, page: Page, suffix: string, objectCacheControl: string | null): Promise<Stored> {
  const stack = await startStack(ctx);
  const engineUrl = stack.engine.url;
  const engineHost = `127.0.0.1:${stack.engine.port}`;
  const runPrefix = `efit-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const bucket = `${runPrefix}-${suffix}`;
  const key = `/${bucket}/k`;

  await page.goto('/');
  expect(new URL(page.url()).origin, 'the page origin').toBe(stack.studio.origin);

  // The token, as the page obtains it.
  const session = await page.evaluate(async (url) => {
    const response = await fetch(`${url}/__emuforge/session`);
    return { status: response.status, body: await response.text() };
  }, engineUrl);
  let token = '';
  try {
    token = String(JSON.parse(session.body).token ?? '');
  } catch {
    token = '';
  }
  registerSecret([token]);
  expect(session.status, 'GET /__emuforge/session from the page: status').toBe(200);
  expect(token, 'GET /__emuforge/session from the page: token').toMatch(/^[0-9a-f]{64}$/);

  // Whatever the check creates is deleted straight through the emulator when it ends, a missing one ignored.
  ctx.own({
    async dispose() {
      for (const pathname of [key, `/${bucket}`]) {
        const deleted = await direct(ctx, stack.emulatorPort, 'DELETE', pathname);
        ctx.log(`cleanup DELETE ${pathname} directly: ${deleted.ok ? deleted.status : deleted.error}`);
      }
    },
  });

  async function send(
    what: string,
    method: string,
    pathname: string,
    body: string,
    options: SendOptions = {},
  ): Promise<Resolved> {
    const sessionHeader = options.session === undefined ? token : options.session;
    const extra: Record<string, string> = { ...(options.headers ?? {}) };
    if (sessionHeader !== null) extra['x-emuforge-session'] = sessionHeader;
    const headers = signS3(method, pathname, engineHost, body, CHECK_KEY, extra);
    const fetched: Fetched = await page.evaluate(
      async ({ url, method, headers, body, cache }) => {
        try {
          const init: RequestInit = {
            method,
            headers,
            body: body === '' ? undefined : new TextEncoder().encode(body),
          };
          if (cache !== null) init.cache = cache;
          const response = await fetch(url, init);
          const readable: Record<string, string> = {};
          response.headers.forEach((value, name) => {
            readable[name] = value;
          });
          return { resolved: true as const, status: response.status, text: await response.text(), headers: readable };
        } catch (e) {
          return { resolved: false as const, error: String(e) };
        }
      },
      { url: `${engineUrl}${pathname}`, method, headers, body, cache: options.cache ?? null },
    );
    ctx.log(`${what}: ${fetched.resolved ? `status ${fetched.status}` : `rejected: ${fetched.error}`}`);
    expect(fetched.resolved ? '' : fetched.error, `${what}: the fetch promise rejected`).toBe('');
    return fetched as Resolved;
  }

  let what = `PUT /${bucket} (CreateBucket) with the token`;
  const created = await send(what, 'PUT', `/${bucket}`, '');
  expect(created.status, `${what}: status, body ${created.text}`).toBe(200);

  const objectHeaders: Record<string, string> = objectCacheControl ? { 'cache-control': objectCacheControl } : {};
  what = `PUT ${key} with ${JSON.stringify(BODY)}${objectCacheControl ? `, Cache-Control: ${objectCacheControl}` : ''} and the token`;
  const put = await send(what, 'PUT', key, BODY, { headers: objectHeaders });
  expect(put.status, `${what}: status, body ${put.text}`).toBe(200);

  what = `GET ${key} with the token`;
  const got = await send(what, 'GET', key, '');
  expect(got.status, `${what}: status, body ${got.text}`).toBe(200);
  expect(got.text, `${what}: text()`).toBe(BODY);
  if (objectCacheControl) {
    expect(got.headers['cache-control'] ?? null, `${what}: headers.get('cache-control')`).toBe(objectCacheControl);
  }

  return { ctx, bucket, key, emulatorPort: stack.emulatorPort, send };
}

test('engine.studio-browser-get-without-session-after-stored-answer-is-refused', async ({ ctx, page }) => {
  const stored = await storedAnswer(ctx, page, 'gns', MAX_AGE);
  const what = `GET ${stored.key} (default cache mode) without X-EmuForge-Session`;
  const refused = await stored.send(what, 'GET', stored.key, '', { session: null });
  expect(refused.status, `${what}: status, body ${JSON.stringify(refused.text)}`).toBe(401);
  expect(refused.text, `${what}: text()`).toContain('SessionRequired');
});

test('engine.studio-browser-force-cache-get-without-session-is-refused', async ({ ctx, page }) => {
  const stored = await storedAnswer(ctx, page, 'gfc', null);
  const what = `GET ${stored.key} with cache: 'force-cache' without X-EmuForge-Session`;
  const refused = await stored.send(what, 'GET', stored.key, '', { session: null, cache: 'force-cache' });
  expect(refused.status, `${what}: status, body ${JSON.stringify(refused.text)}`).toBe(401);
  expect(refused.text, `${what}: text()`).toContain('SessionRequired');
});

test('engine.studio-browser-head-without-session-after-stored-answer-is-refused', async ({ ctx, page }) => {
  const stored = await storedAnswer(ctx, page, 'hns', MAX_AGE);
  const what = `HEAD ${stored.key} (default cache mode) without X-EmuForge-Session`;
  const refused = await stored.send(what, 'HEAD', stored.key, '', { session: null });
  expect(refused.status, `${what}: status, headers ${JSON.stringify(refused.headers)}`).toBe(401);
  expect(refused.headers['www-authenticate'] ?? null, `${what}: headers.get('www-authenticate')`).toBe(
    'EmuForge-Session',
  );
});

test('engine.studio-browser-get-with-another-token-after-stored-answer-is-refused', async ({ ctx, page }) => {
  const stored = await storedAnswer(ctx, page, 'got', MAX_AGE);
  const what = `GET ${stored.key} (default cache mode) with X-EmuForge-Session of 64 zeros`;
  const refused = await stored.send(what, 'GET', stored.key, '', { session: OTHER_TOKEN });
  expect(refused.status, `${what}: status, body ${JSON.stringify(refused.text)}`).toBe(401);
  expect(refused.text, `${what}: text()`).toContain('SessionInvalid');
});

test('engine.studio-browser-get-with-session-keeps-emulator-cache-headers', async ({ ctx, page }) => {
  const stored = await storedAnswer(ctx, page, 'gch', MAX_AGE);

  // The same object straight from the emulator, signed with its key.
  const straight = await direct(ctx, stored.emulatorPort, 'GET', stored.key);
  expect(straight.ok ? '' : straight.error, `GET ${stored.key} directly: the request failed`).toBe('');
  const directAnswer = straight as Extract<Direct, { ok: true }>;
  expect(directAnswer.status, `GET ${stored.key} directly: status`).toBe(200);
  const one = (name: string): string | null => {
    const value = directAnswer.headers[name];
    return value === undefined ? null : Array.isArray(value) ? value.join(', ') : value;
  };

  const what = `GET ${stored.key} with the token, cache: 'no-store'`;
  const got = await stored.send(what, 'GET', stored.key, '', { cache: 'no-store' });
  expect(got.status, `${what}: status, body ${JSON.stringify(got.text)}`).toBe(200);
  expect(got.text, `${what}: text()`).toBe(BODY);
  for (const name of ['cache-control', 'last-modified', 'etag']) {
    expect(got.headers[name] ?? null, `${what}: headers.get('${name}') against the direct answer`).toBe(one(name));
  }
});
