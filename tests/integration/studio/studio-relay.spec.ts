// `engine.studio-browser-reads-relayed-s3-answer` (test-criteria.md, issue 10, Integration): a Chromium page at the
// built Studio's origin calls the engine with `fetch`, as Studio's SDK will once it signs (issue 13): S3 requests
// header-signed with a key the emulator does not know, with the session token the page obtained itself. The
// preflight passes and the relayed answers are readable by the page. The id is `engine.` because the engine owns the
// behavior; the check sits here because this is the suite's only browser.

import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { emulatorDir, expect, readEmulatorFiles, registerSecret, startStack, test, type Ctx } from './support';

const REGION = 'us-east-1';

/** A key the emulator does not know (the check key of the engine checks), with a made-up secret. */
const CHECK_KEY = {
  accessKeyId: 'AKIAEMUFORGECHECK001',
  secretAccessKey: 'emuforgeCheckSecretKey0000000000000000000',
};

const BODY = 'hello world';

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

/** `method path` straight to the emulator on `port`, signed with its key, TLS verified against its `ca.pem`. */
async function direct(ctx: Ctx, port: number, method: string, pathname: string): Promise<number | string> {
  const dir = emulatorDir(ctx.home, port);
  const files = readEmulatorFiles(dir);
  if (!files) return `the emulator files under ${dir} are incomplete`;
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
        response.on('end', () => resolve(response.statusCode ?? 0));
        response.on('error', (e) => resolve(e.message));
      },
    );
    request.on('timeout', () => request.destroy(new Error('no answer within 5 s')));
    request.on('error', (e) => resolve(e.message));
    request.end();
  });
}

/** What the page's `fetch` gave: the readable parts of the response, or the rejection. */
type Fetched =
  | {
      resolved: true;
      status: number;
      etag: string | null;
      requestId: string | null;
      text: string;
    }
  | { resolved: false; error: string };

test('engine.studio-browser-reads-relayed-s3-answer', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const engineUrl = stack.engine.url;
  const engineHost = `127.0.0.1:${stack.engine.port}`;
  const runPrefix = `efit-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const bucket = `${runPrefix}-sbr`;
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
        ctx.log(`cleanup DELETE ${pathname} directly: ${await direct(ctx, stack.emulatorPort, 'DELETE', pathname)}`);
      }
    },
  });

  /** `fetch` from the page: `method pathname`, signed with the check key, with the token unless `withToken` is false. */
  async function send(
    what: string,
    method: string,
    pathname: string,
    body: string,
    withToken = true,
  ): Promise<Fetched> {
    const extra: Record<string, string> = withToken ? { 'x-emuforge-session': token } : {};
    const headers = signS3(method, pathname, engineHost, body, CHECK_KEY, extra);
    const fetched = await page.evaluate(
      async ({ url, method, headers, body }) => {
        try {
          const response = await fetch(url, {
            method,
            headers,
            body: body === '' ? undefined : new TextEncoder().encode(body),
          });
          return {
            resolved: true as const,
            status: response.status,
            etag: response.headers.get('etag'),
            requestId: response.headers.get('x-amz-request-id'),
            text: await response.text(),
          };
        } catch (e) {
          return { resolved: false as const, error: String(e) };
        }
      },
      { url: `${engineUrl}${pathname}`, method, headers, body },
    );
    ctx.log(`${what}: ${fetched.resolved ? `status ${fetched.status}` : `rejected: ${fetched.error}`}`);
    return fetched;
  }

  function resolved(fetched: Fetched, what: string): Extract<Fetched, { resolved: true }> {
    expect(fetched.resolved ? '' : fetched.error, `${what}: the fetch promise rejected`).toBe('');
    return fetched as Extract<Fetched, { resolved: true }>;
  }

  // PUT /B (CreateBucket), then PUT /B/k with `hello world`.
  let what = `PUT /${bucket} (CreateBucket) with the token`;
  const created = resolved(await send(what, 'PUT', `/${bucket}`, ''), what);
  expect(created.status, `${what}: status, body ${created.text}`).toBe(200);

  what = `PUT ${key} with ${JSON.stringify(BODY)} and the token`;
  const put = resolved(await send(what, 'PUT', key, BODY), what);
  expect(put.status, `${what}: status, body ${put.text}`).toBe(200);
  const md5 = createHash('md5').update(BODY).digest('hex');
  expect(put.etag, `${what}: headers.get('etag')`).toBe(`"${md5}"`);
  expect(put.requestId ?? '', `${what}: headers.get('x-amz-request-id')`).not.toBe('');

  // GET /B/k with the token.
  what = `GET ${key} with the token`;
  const got = resolved(await send(what, 'GET', key, ''), what);
  expect(got.status, `${what}: status, body ${got.text}`).toBe(200);
  expect(got.text, `${what}: text()`).toBe(BODY);
  expect(got.etag, `${what}: headers.get('etag')`).toBe(put.etag);

  // GET /B/k without X-EmuForge-Session: a readable refusal.
  what = `GET ${key} without X-EmuForge-Session`;
  const refused = resolved(await send(what, 'GET', key, '', false), what);
  expect(refused.status, `${what}: status, body ${refused.text}`).toBe(401);
  expect(refused.text, `${what}: text()`).toContain('SessionRequired');

  // DELETE /B/k and DELETE /B with the token.
  for (const pathname of [key, `/${bucket}`]) {
    what = `DELETE ${pathname} with the token`;
    const deleted = resolved(await send(what, 'DELETE', pathname, ''), what);
    expect(deleted.status, `${what}: status, body ${deleted.text}`).toBe(204);
  }
});
