// The browser context a Studio flow check gets from the check contract (test-criteria.md, issue 15, Flow):
//
// - `studio.check-browser-sends-preflights-to-the-server`: a CORS preflight the page causes reaches its loopback
//   server, and the page sees that server's answer (requirement R1, R3);
// - `studio.check-browser-sees-the-engine-preflight-refusal`: the same against the engine's own preflight answers
//   (R1);
// - `studio.check-browser-refuses-non-loopback-destinations`: the destination rule still refuses every
//   non-loopback destination, host names included, logs the refusal, and leaves loopback addresses alone (R2).
//
// The checks use only the `ctx`, `page` and `context` the contract gives them and install no route of their own.
// The loopback test servers they need are defined here and owned by the check through `ctx.own`.

import fs from 'node:fs';
import http from 'node:http';
import type net from 'node:net';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { EnvError, expect, registerSecret, startStack, test, type Ctx } from './support';

/** The non-safelisted header of the criteria. */
const CHECK_HEADER = { 'x-check': '1' };

/** A request a loopback test server received. */
interface Seen {
  method: string;
  path: string;
  /** `Access-Control-Request-Method`, or `null` when absent. */
  requestMethod: string | null;
  /** `Access-Control-Request-Headers`, or `null` when absent. */
  requestHeaders: string | null;
}

interface TestServer {
  /** The port it listens on (the same port on every host it listens on). */
  port: number;
  /** Every request it received, in arrival order. */
  seen: Seen[];
  /** The requests it received for `pathname`. */
  to(pathname: string): Seen[];
}

interface ServerOptions {
  /** Hosts to listen on, all on one port: `127.0.0.1`, `::1`. */
  hosts: string[];
  /** The page's origin: `Access-Control-Allow-Origin` of every answer that allows. Unset for the page's own server. */
  pageOrigin?: string;
  /** Paths whose preflight is allowed; every other preflight is refused. */
  allowPreflight?: string[];
}

/** The empty HTML page the page origin serves. */
const EMPTY_PAGE = '<!doctype html><title>check page</title>';

function header(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Binds `server` to `host:port` (`0`: any free port) and returns the port. */
async function bind(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (e: NodeJS.ErrnoException) => reject(e);
    server.once('error', failed);
    server.listen(port, host, () => {
      server.off('error', failed);
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

async function close(server: http.Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * A loopback HTTP server owned by the check. Without `pageOrigin` it serves the empty page for every request. With
 * it, it records every request; it answers `OPTIONS` of a path in `allowPreflight` `204` with
 * `Access-Control-Allow-Origin: <pageOrigin>` and `Access-Control-Allow-Headers: x-check`, every other `OPTIONS`
 * `403` with no `Access-Control-*` header, and every other request `200` with the body `path <path>` and
 * `Access-Control-Allow-Origin: <pageOrigin>`.
 */
async function startServer(ctx: Ctx, name: string, options: ServerOptions): Promise<TestServer> {
  const seen: Seen[] = [];
  const handler: http.RequestListener = (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://check.invalid').pathname;
    if (options.pageOrigin === undefined) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(EMPTY_PAGE);
      return;
    }
    seen.push({
      method: request.method ?? '',
      path: pathname,
      requestMethod: header(request.headers['access-control-request-method']),
      requestHeaders: header(request.headers['access-control-request-headers']),
    });
    if (request.method === 'OPTIONS') {
      if (options.allowPreflight?.includes(pathname)) {
        response.writeHead(204, {
          'access-control-allow-origin': options.pageOrigin,
          'access-control-allow-headers': 'x-check',
        });
      } else {
        response.writeHead(403, { 'content-type': 'text/plain' });
        response.write('preflight refused');
      }
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': options.pageOrigin });
    response.end(`path ${pathname}`);
  };

  // All hosts on one port: the first takes a free port, the others the same one; a port another program holds on
  // a later host is given back and the whole set tried again.
  for (let attempt = 0; attempt < 10; attempt++) {
    const servers: http.Server[] = [];
    let port = 0;
    try {
      for (const host of options.hosts) {
        const server = http.createServer(handler);
        servers.push(server);
        port = await bind(server, host, port);
      }
    } catch (e) {
      await Promise.all(servers.map(close));
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE' && options.hosts.length > 1) continue;
      throw new EnvError(
        `the ${name} test server cannot listen on ${options.hosts.join(' and ')}: ${(e as Error).message}`,
      );
    }
    ctx.own({ dispose: () => Promise.all(servers.map(close)).then(() => undefined) });
    ctx.log(`${name} test server listens on port ${String(port)} of ${options.hosts.join(' and ')}`);
    return { port, seen, to: (pathname) => seen.filter((s) => s.path === pathname) };
  }
  throw new EnvError(`the ${name} test server found no port free on ${options.hosts.join(' and ')} after 10 tries`);
}

/** The origin of a test server on `host`. */
function originOf(host: string, port: number): string {
  return `http://${host.includes(':') ? `[${host}]` : host}:${String(port)}`;
}

/** What the page's `fetch` gave: the status and body, or the rejection. */
type Fetched = { resolved: true; status: number; text: string } | { resolved: false; error: string };

/** `fetch(url, init)` from the page, logged. */
async function fetchFrom(
  ctx: Ctx,
  page: Page,
  what: string,
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Fetched> {
  const fetched = await page.evaluate(
    async ({ url, init }) => {
      try {
        const response = await fetch(url, init);
        return { resolved: true as const, status: response.status, text: await response.text() };
      } catch (e) {
        return { resolved: false as const, error: String(e) };
      }
    },
    { url, init },
  );
  ctx.log(`${what}: ${fetched.resolved ? `resolved, status ${String(fetched.status)}` : `rejected: ${fetched.error}`}`);
  return fetched;
}

/** `rejected`, or what the fetch resolved with: the outcome an assertion that the fetch rejects compares. */
function outcome(fetched: Fetched): string {
  return fetched.resolved
    ? `resolved with status ${String(fetched.status)} and body ${JSON.stringify(fetched.text.slice(0, 200))}`
    : 'rejected';
}

/** The resolved fetch, or a failed assertion naming the rejection. */
function resolved(fetched: Fetched, what: string): Extract<Fetched, { resolved: true }> {
  expect(fetched.resolved ? '' : fetched.error, `${what}: the fetch promise rejected`).toBe('');
  return fetched as Extract<Fetched, { resolved: true }>;
}

test('studio.check-browser-sends-preflights-to-the-server', async ({ ctx, page }) => {
  const origin = await startServer(ctx, 'page origin', { hosts: ['127.0.0.1'] });
  const pageOrigin = originOf('127.0.0.1', origin.port);
  const target = await startServer(ctx, 'target', {
    hosts: ['127.0.0.1'],
    pageOrigin,
    allowPreflight: ['/allowed'],
  });
  const targetUrl = originOf('127.0.0.1', target.port);
  await page.goto(`${pageOrigin}/`);
  expect(new URL(page.url()).origin, 'the page origin').toBe(pageOrigin);

  // The server refuses the preflight → the fetch rejects; the server recorded exactly one preflight for the path
  // (asking for `GET` and `x-check`) and no other request to it. (regression)
  let what = 'GET /refused with x-check: 1, preflight refused';
  const refused = await fetchFrom(ctx, page, what, `${targetUrl}/refused`, { headers: CHECK_HEADER });
  expect(outcome(refused), `${what}: the fetch must reject (regression)`).toBe('rejected');
  expect(target.to('/refused'), `${what}: requests the server recorded for /refused`).toEqual([
    { method: 'OPTIONS', path: '/refused', requestMethod: 'GET', requestHeaders: 'x-check' },
  ]);

  // The server allows the preflight → the fetch resolves with the actual request's body; the server recorded the
  // preflight and then the actual request.
  what = 'GET /allowed with x-check: 1, preflight allowed';
  const allowed = resolved(await fetchFrom(ctx, page, what, `${targetUrl}/allowed`, { headers: CHECK_HEADER }), what);
  expect({ status: allowed.status, text: allowed.text }, `${what}: the answer`).toEqual({
    status: 200,
    text: 'path /allowed',
  });
  expect(target.to('/allowed'), `${what}: requests the server recorded for /allowed`).toEqual([
    { method: 'OPTIONS', path: '/allowed', requestMethod: 'GET', requestHeaders: 'x-check' },
    { method: 'GET', path: '/allowed', requestMethod: null, requestHeaders: null },
  ]);

  // No extra header → the fetch resolves with the server's body; the server recorded that request and no preflight.
  what = 'GET /plain with no extra header';
  const plain = resolved(await fetchFrom(ctx, page, what, `${targetUrl}/plain`), what);
  expect({ status: plain.status, text: plain.text }, `${what}: the answer`).toEqual({
    status: 200,
    text: 'path /plain',
  });
  expect(target.to('/plain'), `${what}: requests the server recorded for /plain`).toEqual([
    { method: 'GET', path: '/plain', requestMethod: null, requestHeaders: null },
  ]);
});

test('studio.check-browser-sees-the-engine-preflight-refusal', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const health = `${stack.engine.url}/__emuforge/health`;

  await page.goto('/');
  expect(new URL(page.url()).origin, 'the page origin').toBe(stack.studio.origin);

  // The token, as the page obtains it.
  const session = await page.evaluate(async (url) => {
    const response = await fetch(`${url}/__emuforge/session`);
    return { status: response.status, body: await response.text() };
  }, stack.engine.url);
  let token = '';
  try {
    token = String(JSON.parse(session.body).token ?? '');
  } catch {
    token = '';
  }
  registerSecret([token]);
  expect(session.status, 'GET /__emuforge/session from the page: status').toBe(200);
  expect(token, 'GET /__emuforge/session from the page: token').toMatch(/^[0-9a-f]{64}$/);
  const withToken = { 'x-emuforge-session': token };

  // The session header and a header the engine's preflight does not list → the fetch rejects. (regression)
  let what = 'GET /__emuforge/health with X-EmuForge-Session and x-check: 1';
  const unlisted = await fetchFrom(ctx, page, what, health, { headers: { ...withToken, ...CHECK_HEADER } });
  expect(outcome(unlisted), `${what}: the fetch must reject (regression)`).toBe('rejected');

  // `DELETE` with the session header → the fetch rejects: the engine's preflight lists only `GET` and `HEAD`.
  // (regression)
  what = 'DELETE /__emuforge/health with X-EmuForge-Session';
  const deleted = await fetchFrom(ctx, page, what, health, { method: 'DELETE', headers: withToken });
  expect(outcome(deleted), `${what}: the fetch must reject (regression)`).toBe('rejected');

  // The session header only → the fetch resolves and the page reads the health answer: the emulator is reachable.
  what = 'GET /__emuforge/health with X-EmuForge-Session';
  const read = resolved(await fetchFrom(ctx, page, what, health, { headers: withToken }), what);
  expect(read.status, `${what}: status, body ${read.text}`).toBe(200);
  let body: unknown = null;
  try {
    body = JSON.parse(read.text);
  } catch {
    body = read.text;
  }
  expect(body, `${what}: the body`).toMatchObject({ emulator: { reachable: true } });
});

test('studio.check-browser-refuses-non-loopback-destinations', async ({ ctx, page }) => {
  const logPath = path.join(ctx.logs, `${ctx.id}.log`);
  /** The lines of the check log, without their elapsed-time prefix. */
  const logLines = () =>
    fs
      .readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.replace(/^\[\s*[\d.]+s\] /, ''));
  const refusal = (origin: string) => `refused browser request to ${origin}: checks reach only loopback addresses`;
  /** The refusal lines the log gained since it had `mark` lines. */
  const refusalsSince = (mark: number) =>
    logLines()
      .slice(mark)
      .filter((line) => line.startsWith('refused browser request to '));

  const origin = await startServer(ctx, 'page origin', { hosts: ['127.0.0.1'] });
  const pageOrigin = originOf('127.0.0.1', origin.port);
  // `localhost` would reach this server whichever loopback address the name gives.
  const named = await startServer(ctx, 'localhost', { hosts: ['127.0.0.1', '::1'], pageOrigin });
  const v4 = await startServer(ctx, '127.0.0.1', { hosts: ['127.0.0.1'], pageOrigin });
  const v6 = await startServer(ctx, '[::1]', { hosts: ['::1'], pageOrigin });
  await page.goto(`${pageOrigin}/`);
  expect(new URL(page.url()).origin, 'the page origin').toBe(pageOrigin);

  /** A fetch that must be refused: it rejects, and the log gains the refusal line naming `expectedOrigin`. */
  async function refusedFetch(url: string, expectedOrigin: string, first?: () => void) {
    const what = `GET ${url}`;
    const mark = logLines().length;
    const fetched = await fetchFrom(ctx, page, what, url);
    first?.();
    expect(outcome(fetched), `${what}: the fetch must reject`).toBe('rejected');
    await expect
      .poll(() => refusalsSince(mark), { message: `${what}: refusal lines the check log gained` })
      .toContain(refusal(expectedOrigin));
  }

  // `http://192.0.2.1/x` (TEST-NET-1) → rejected, and the refusal line names `http://192.0.2.1`.
  await refusedFetch('http://192.0.2.1/x', 'http://192.0.2.1');

  // `https://192.0.2.1/x` → rejected, and the refusal line names `https://192.0.2.1`.
  await refusedFetch('https://192.0.2.1/x', 'https://192.0.2.1');

  // `http://localhost:<port>/x` → the test server listening on both loopback addresses recorded no request, the
  // fetch rejected, and the refusal line names `http://localhost:<port>`.
  const localhost = `http://localhost:${String(named.port)}`;
  await refusedFetch(`${localhost}/x`, localhost, () =>
    expect(named.seen, `GET ${localhost}/x: requests the localhost test server recorded`).toEqual([]),
  );

  // `http://emuforge-check.invalid/x` → rejected, and the refusal line names `http://emuforge-check.invalid`.
  await refusedFetch('http://emuforge-check.invalid/x', 'http://emuforge-check.invalid');

  // Navigating to `http://192.0.2.1/` → the navigation fails, and the refusal line names `http://192.0.2.1`.
  let mark = logLines().length;
  let navigation = 'loaded';
  try {
    await page.goto('http://192.0.2.1/', { timeout: 10_000 });
  } catch (e) {
    navigation = `failed: ${(e as Error).message.split('\n')[0]}`;
  }
  ctx.log(`navigation to http://192.0.2.1/: ${navigation}`);
  expect(navigation, 'navigation to http://192.0.2.1/').toMatch(/^failed: /);
  await expect
    .poll(() => refusalsSince(mark), { message: 'navigation to http://192.0.2.1/: refusal lines the check log gained' })
    .toContain(refusal('http://192.0.2.1'));

  // `http://127.0.0.1:<port>/x` and `http://[::1]:<port6>/x` → each resolves with its server's body, each server
  // recorded the request, and the log has no refusal line for either.
  await page.goto(`${pageOrigin}/`);
  expect(new URL(page.url()).origin, 'the page origin, again').toBe(pageOrigin);
  mark = logLines().length;
  for (const [server, host] of [
    [v4, '127.0.0.1'],
    [v6, '::1'],
  ] as const) {
    const base = originOf(host, server.port);
    const what = `GET ${base}/x`;
    const answer = resolved(await fetchFrom(ctx, page, what, `${base}/x`), what);
    expect({ status: answer.status, text: answer.text }, `${what}: the answer`).toEqual({
      status: 200,
      text: 'path /x',
    });
    expect(server.seen, `${what}: requests the server recorded`).toEqual([
      { method: 'GET', path: '/x', requestMethod: null, requestHeaders: null },
    ]);
  }
  const loopbackOrigins = [originOf('127.0.0.1', v4.port), originOf('::1', v6.port)];
  expect(
    refusalsSince(mark).filter((line) => loopbackOrigins.some((o) => line === refusal(o))),
    'refusal lines naming the loopback test servers',
  ).toEqual([]);
});
