// Issue 26 (test-criteria.md, Integration checks): a read that Studio's AWS SDK clients
// (`studio/src/lib/aws/client-factory.ts`) send from a page at the built Studio's origin shows the emulator's current
// state, not an answer the browser kept from an earlier read. The page opens `/aws/kinesis`, the "no screen yet" page;
// its only engine requests are the AWS area's emulator line's (issue 45), which `EngineRequests` leaves out, so every
// engine request counted is the factory's. The factory runs bundled for the browser against Studio's installed SDK
// (`support/aws-clients.ts`). Every object is first stored with `Cache-Control: max-age=3600`, the form of the defect
// that needs no wait.
//
// The regression lines use `expect.soft`, so one run of a check reports every line that does not hold, each with its
// own reason; the lines before and after them are hard assertions.

import type { BrowserContext, Page } from '@playwright/test';

import { expect, NO_SCREEN_SERVICE, startStack, test, type Ctx } from './support';
import {
  awsRequests,
  CacheRecord,
  describe,
  directS3,
  EngineRequests,
  PageClients,
  shown,
  type DirectAnswer,
  type Outcome,
} from './support/aws-clients';

const MAX_AGE = 'max-age=3600';
const MAX_AGE_60 = 'max-age=60';
const VERSION_1 = 'version-1';
const VERSION_2 = 'version-2';

/** Every resource name of this run starts with this. */
function runPrefix(ctx: Ctx): string {
  return `efit-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

function resolved<T>(outcome: Outcome<T>, what: string): Extract<Outcome<T>, { resolved: true }> {
  expect(
    outcome.resolved ? '' : `${outcome.name} status ${String(outcome.status)}: ${outcome.message}`,
    `${what}: the command rejected`,
  ).toBe('');
  return outcome as Extract<Outcome<T>, { resolved: true }>;
}

function answered(answer: DirectAnswer, status: number, what: string): Extract<DirectAnswer, { status: number }> {
  expect('error' in answer ? answer.error : '', `${what}: the request failed`).toBe('');
  const got = answer as Extract<DirectAnswer, { status: number }>;
  expect(got.status, `${what}: status, body ${got.body}`).toBe(status);
  return got;
}

/** A header of a direct answer, `null` when absent. */
function header(answer: Extract<DirectAnswer, { status: number }>, name: string): string | null {
  return answer.headers[name] ?? null;
}

/** What a command gave, for the log and the assertion messages: never a token or a key. */
function outcomeText<T>(outcome: Outcome<T>): string {
  return outcome.resolved
    ? `resolved ${JSON.stringify(outcome.value)}, request id ${String(outcome.requestId)}`
    : `rejected ${outcome.name} status ${String(outcome.status)}: ${outcome.message}`;
}

/**
 * Registers, before anything is created, the deletion straight through the emulator of `keys` in `bucket` and of
 * `bucket`, each one missing ignored.
 */
function ownBucket(ctx: Ctx, bucket: string, keys: string[]): void {
  const port = ctx.emulatorPort;
  ctx.own({
    async dispose() {
      for (const key of keys) {
        const pathname = `/${bucket}/${key}`;
        ctx.log(`cleanup DELETE ${pathname} directly: ${shown(await directS3(ctx, port, 'DELETE', pathname))}`);
      }
      ctx.log(`cleanup DELETE /${bucket} directly: ${shown(await directS3(ctx, port, 'DELETE', `/${bucket}`))}`);
    },
  });
}

/** `PUT /<bucket>` directly, answered `200`. */
async function createBucket(ctx: Ctx, bucket: string): Promise<void> {
  answered(await directS3(ctx, ctx.emulatorPort, 'PUT', `/${bucket}`), 200, `direct CreateBucket ${bucket}`);
}

/** `PUT /<bucket>/<key>` directly with `body` and, unless `null`, `Cache-Control`, answered `200`. */
async function putDirect(ctx: Ctx, bucket: string, key: string, body: string, cacheControl: string | null) {
  const what = `direct PutObject ${bucket}/${key} with ${JSON.stringify(body)}${cacheControl === null ? '' : `, Cache-Control: ${cacheControl}`}`;
  const headers: Record<string, string> = cacheControl === null ? {} : { 'cache-control': cacheControl };
  answered(await directS3(ctx, ctx.emulatorPort, 'PUT', `/${bucket}/${key}`, { body, headers }), 200, what);
  ctx.log(`${what}: 200`);
}

/** `HEAD /<bucket>/<key>` directly; logs its status, `ETag` and `Cache-Control`. */
async function headDirect(ctx: Ctx, bucket: string, key: string): Promise<DirectAnswer> {
  const answer = await directS3(ctx, ctx.emulatorPort, 'HEAD', `/${bucket}/${key}`);
  ctx.log(
    `direct HeadObject ${bucket}/${key}: ${shown(answer)}${'error' in answer ? '' : `, ETag ${String(answer.headers.etag ?? null)}, Cache-Control ${String(answer.headers['cache-control'] ?? null)}`}`,
  );
  return answer;
}

/** `GET /<bucket>/<key>` directly, answered `200`; returns its body. */
async function getDirect(ctx: Ctx, bucket: string, key: string): Promise<string> {
  const what = `direct GetObject ${bucket}/${key}`;
  const { body } = answered(await directS3(ctx, ctx.emulatorPort, 'GET', `/${bucket}/${key}`), 200, what);
  ctx.log(`${what}: 200, body ${JSON.stringify(body)}`);
  return body;
}

/**
 * Opens `/aws/kinesis` with the page's requests recorded, loads the factory's clients and asserts the precondition: the
 * page has made no engine request other than the emulator line's (changed, issue 45 PM decision: the area's line asks
 * for the session and the health on its own, R4.4; `EngineRequests` leaves those out).
 */
async function openWithClients(
  ctx: Ctx,
  context: BrowserContext,
  page: Page,
  studioOrigin: string,
  engineOrigin: string,
  enginePort: number,
): Promise<{ clients: PageClients; requests: EngineRequests }> {
  const requests = await EngineRequests.attach(ctx, context, page, engineOrigin);
  await page.goto(NO_SCREEN_SERVICE.path);
  expect(new URL(page.url()).origin, 'the page origin').toBe(studioOrigin);
  expect(new URL(page.url()).pathname, 'the page path').toBe(NO_SCREEN_SERVICE.path);
  const clients = await PageClients.load(ctx, page, enginePort, requests);
  const before = await requests.all();
  ctx.log(`engine requests before the first command: ${describe(before)}`);
  expect(before.length, `engine requests of the page before the first command: ${describe(before)}`).toBe(0);
  return { clients, requests };
}

test('studio.aws-clients-get-object-shows-change-made-outside', async ({ ctx, context, page }) => {
  const bucket = `${runPrefix(ctx)}-cgo`;
  const key = 'k';
  ownBucket(ctx, bucket, [key]);

  const stack = await startStack(ctx);
  await createBucket(ctx, bucket);
  await putDirect(ctx, bucket, key, VERSION_1, MAX_AGE);
  const { clients } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );

  // Line 1: the first read.
  let what = `page GetObject ${bucket}/${key}, first`;
  const first = resolved(await clients.getObject(bucket, key), what).value;
  expect(first.body, `${what}: body`).toBe(VERSION_1);
  expect(first.cacheControl, `${what}: CacheControl`).toBe(MAX_AGE);

  // Line 2 (regression): overwritten directly, then read through the client.
  await putDirect(ctx, bucket, key, VERSION_2, MAX_AGE);
  what = `page GetObject ${bucket}/${key} after the direct overwrite with ${VERSION_2}`;
  const after = await clients.getObject(bucket, key);
  const reference = answered(await headDirect(ctx, bucket, key), 200, `direct HeadObject ${bucket}/${key}`);
  expect.soft(after.resolved, `${what}: resolves (${outcomeText(after)})`).toBe(true);
  if (after.resolved) {
    expect.soft(after.value.body, `${what}: body`).toBe(VERSION_2);
    expect
      .soft(after.value.etag, `${what}: ETag against the direct HeadObject right after`)
      .toBe(header(reference, 'etag'));
    expect
      .soft(after.value.cacheControl, `${what}: CacheControl against the direct HeadObject right after`)
      .toBe(header(reference, 'cache-control'));
  }

  // Line 3 (regression): deleted directly, then read through the client.
  answered(await directS3(ctx, ctx.emulatorPort, 'DELETE', `/${bucket}/${key}`), 204, `direct DeleteObject ${key}`);
  what = `page GetObject ${bucket}/${key} after the direct delete`;
  const gone = await clients.getObject(bucket, key);
  expect
    .soft(gone.resolved ? `resolved (${outcomeText(gone)})` : gone.name, `${what}: rejects with NoSuchKey`)
    .toBe('NoSuchKey');
});

test('studio.aws-clients-get-object-shows-studio-own-change', async ({ ctx, context, page }) => {
  const bucket = `${runPrefix(ctx)}-cso`;
  const key = 'k';
  ownBucket(ctx, bucket, [key]);

  const stack = await startStack(ctx);
  await createBucket(ctx, bucket);
  const { clients } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );

  // Line 1: Studio writes and reads the object.
  resolved(await clients.putObject(bucket, key, VERSION_1, MAX_AGE), `page PutObject ${bucket}/${key} ${VERSION_1}`);
  let what = `page GetObject ${bucket}/${key} after the page's PutObject of ${VERSION_1}`;
  expect(resolved(await clients.getObject(bucket, key), what).value.body, `${what}: body`).toBe(VERSION_1);
  expect(await getDirect(ctx, bucket, key), `direct GetObject ${bucket}/${key} after ${VERSION_1}`).toBe(VERSION_1);

  // Line 2 (regression): Studio overwrites the object through the same client and reads it again.
  resolved(await clients.putObject(bucket, key, VERSION_2, MAX_AGE), `page PutObject ${bucket}/${key} ${VERSION_2}`);
  what = `page GetObject ${bucket}/${key} after the page's PutObject of ${VERSION_2}`;
  const after = await clients.getObject(bucket, key);
  expect.soft(after.resolved, `${what}: resolves (${outcomeText(after)})`).toBe(true);
  if (after.resolved) expect.soft(after.value.body, `${what}: body`).toBe(VERSION_2);
  expect(await getDirect(ctx, bucket, key), `direct GetObject ${bucket}/${key} after ${VERSION_2}`).toBe(VERSION_2);

  // Line 3 (regression): Studio deletes the object through the same client and reads it again.
  what = `page DeleteObject ${bucket}/${key}`;
  resolved(await clients.deleteObject(bucket, key), what);
  what = `page GetObject ${bucket}/${key} after the page's DeleteObject`;
  const gone = await clients.getObject(bucket, key);
  expect
    .soft(gone.resolved ? `resolved (${outcomeText(gone)})` : gone.name, `${what}: rejects with NoSuchKey`)
    .toBe('NoSuchKey');
  const head = await headDirect(ctx, bucket, key);
  expect('error' in head ? head.error : '', `direct HeadObject ${bucket}/${key} afterwards: the request failed`).toBe(
    '',
  );
  expect(
    'error' in head ? null : head.status,
    `direct HeadObject ${bucket}/${key} afterwards: the object does not exist`,
  ).toBe(404);
});

test('studio.aws-clients-every-read-reaches-the-engine', async ({ ctx, context, page }) => {
  const bucket = `${runPrefix(ctx)}-cer`;
  const key = 'k';
  ownBucket(ctx, bucket, [key]);

  const stack = await startStack(ctx);
  await createBucket(ctx, bucket);
  await putDirect(ctx, bucket, key, VERSION_1, MAX_AGE);
  // The browser's record is on before the page's first request.
  const record = await CacheRecord.attach(ctx, context, page, stack.engine.url);
  const { clients, requests } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );
  let commands = 0;

  // Line 1 (regression): the same object three times, nothing changed in between.
  const ids: (string | null)[] = [];
  for (const n of [1, 2, 3]) {
    const what = `page GetObject ${bucket}/${key}, read ${String(n)}`;
    const read = resolved(await clients.getObject(bucket, key), what);
    commands += 1;
    expect(read.value.body, `${what}: body`).toBe(VERSION_1);
    expect(read.requestId, `${what}: has a request id`).not.toBeNull();
    ids.push(read.requestId);
  }
  expect
    .soft(new Set(ids).size, `page GetObject ${bucket}/${key}: three different request ids, ${ids.join(', ')}`)
    .toBe(3);

  // Line 2 (guard): every other read twice, each pair with two request ids.
  const pairs: [string, () => Promise<Outcome<unknown>>][] = [
    [`HeadObject ${bucket}/${key}`, () => clients.headObject(bucket, key)],
    [`ListObjectsV2 ${bucket}`, () => clients.listObjectsV2(bucket)],
    ['ListBuckets', () => clients.listBuckets()],
    ['ListStateMachines', () => clients.listStateMachines()],
  ];
  for (const [name, send] of pairs) {
    const pair: (string | null)[] = [];
    for (const n of [1, 2]) {
      const what = `page ${name}, read ${String(n)}`;
      const read = resolved(await send(), what);
      commands += 1;
      expect(read.requestId, `${what}: has a request id`).not.toBeNull();
      pair.push(read.requestId);
    }
    expect(pair[0], `page ${name}: the two request ids differ, ${pair.join(', ')}`).not.toBe(pair[1]);
  }

  // Line 3: throughout, no answer of the engine from the browser's cache (regression), and every AWS request carried
  // the session and Studio's signature (guard).
  const answers = await record.all();
  const fromCache = answers.filter((a) => a.fromCache);
  ctx.log(`browser record: ${String(answers.length)} engine answers, ${String(fromCache.length)} from a cache`);
  expect(
    answers.filter((a) => a.method !== 'OPTIONS').length,
    `browser record: at least one engine answer per command (${String(commands)})`,
  ).toBeGreaterThanOrEqual(commands);
  expect
    .soft(
      fromCache.map((a) => `${a.method} ${a.path} ${String(a.status)} from ${a.source}`),
      'browser record: engine answers served from the browser cache',
    )
    .toEqual([]);

  const sent = awsRequests(await requests.all());
  ctx.log(`AWS requests of the page: ${describe(sent)}`);
  expect(sent.length, `AWS requests of the page: ${describe(sent)}`).toBeGreaterThan(0);
  for (const [i, r] of sent.entries()) {
    const what = `AWS request ${String(i + 1)} (${r.method} ${r.path})`;
    expect(r.hasSession, `${what}: carries X-EmuForge-Session`).toBe(true);
    expect(r.studioAuth, `${what}: Authorization starts AWS4-HMAC-SHA256 Credential=emuforge-studio/`).toBe(true);
  }
});

test('studio.aws-clients-put-object-stores-only-what-the-command-gives', async ({ ctx, context, page }) => {
  const bucket = `${runPrefix(ctx)}-cpo`;
  ownBucket(ctx, bucket, ['d', 'p', 'q']);

  const stack = await startStack(ctx);
  await createBucket(ctx, bucket);
  await putDirect(ctx, bucket, 'd', 'direct body', null);
  const { clients } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );

  // Line 1: a PutObject without CacheControl stores none, as the same PutObject sent directly.
  resolved(await clients.putObject(bucket, 'p', 'page body', null), `page PutObject ${bucket}/p without CacheControl`);
  const p = answered(await headDirect(ctx, bucket, 'p'), 200, `direct HeadObject ${bucket}/p`);
  const d = answered(await headDirect(ctx, bucket, 'd'), 200, `direct HeadObject ${bucket}/d`);
  expect(header(d, 'cache-control'), `direct HeadObject ${bucket}/d: Cache-Control`).toBeNull();
  expect(
    header(p, 'cache-control'),
    `direct HeadObject ${bucket}/p: Cache-Control, against direct HeadObject ${bucket}/d`,
  ).toBe(header(d, 'cache-control'));

  // Line 2: with CacheControl, exactly that is stored and read back through the client.
  resolved(
    await clients.putObject(bucket, 'q', 'page body', MAX_AGE_60),
    `page PutObject ${bucket}/q CacheControl ${MAX_AGE_60}`,
  );
  const q = answered(await headDirect(ctx, bucket, 'q'), 200, `direct HeadObject ${bucket}/q`);
  expect(header(q, 'cache-control'), `direct HeadObject ${bucket}/q: Cache-Control`).toBe(MAX_AGE_60);
  let what = `page GetObject ${bucket}/q`;
  expect(resolved(await clients.getObject(bucket, 'q'), what).value.cacheControl, `${what}: CacheControl`).toBe(
    MAX_AGE_60,
  );
  what = `page HeadObject ${bucket}/q`;
  expect(resolved(await clients.headObject(bucket, 'q'), what).value.cacheControl, `${what}: CacheControl`).toBe(
    MAX_AGE_60,
  );
});
