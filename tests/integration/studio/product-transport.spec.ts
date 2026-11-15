// The product checks that send requests through a form (issue 34, test-criteria.md): an 8 MiB object put and got
// through a situation 3 form's engine port, compared with the same `GetObject` sent straight to the emulator as
// `engine/references/relay-fidelity.md` defines transparency; and the engine's browser rules (`Origin`, `Host`, the
// session token) and Studio's server's `Host` rule as a caller of the form's two published ports sees them.
//
// `engine.product-relay-s3-get-object-8mib-is-transparent`, `engine.product-browser-rules-hold`.

import { createHash } from 'node:crypto';

import { EnvError, expect, registerSecret, requireRunEmulator, test, type Ctx } from './support';
import { bucketNames } from './support/aws-clients';
import {
  directS3,
  emulatorKey,
  errorCode,
  runPrefix,
  signedVia,
  statusOf,
  transparencyDiff,
} from './support/product-inspect';
import {
  Form,
  productTimeout,
  request,
  tail,
  waitHealth,
  type CommandResult,
  type HttpAnswer,
} from './support/product';
import { HEALTH_PATH, SESSION_PATH } from './support/traffic';

/** 8 MiB: the object of the transparency pair. */
const OBJECT_BYTES = 8_388_608;

function expectStarted(result: CommandResult) {
  expect(result.code, `${result.line}: exit code; output:\n${tail(result)}`).toBe(0);
}

/** The Given of both checks: a situation 3 form on the run's emulator, started, health `200`. */
async function upOnRunEmulator(ctx: Ctx): Promise<Form> {
  await requireRunEmulator(ctx);
  const form = await Form.create(ctx, {
    situation: 3,
    emulatorPort: ctx.emulatorPort,
  });
  expectStarted(await form.start());
  expect(await waitHealth(form.enginePort, 200), 'the Given: GET /__emuforge/health').toMatchObject({ status: 200 });
  return form;
}

/** `bytes` pseudo-random bytes from a fixed seed (xorshift32), so a run can be repeated byte for byte. */
function seeded(seed: number, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  let x = seed >>> 0;
  for (let i = 0; i < bytes; i += 4) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out.writeUInt32LE(x, i);
  }
  return out;
}

/** The answer, or a failed assertion naming the error that kept it from arriving. */
function answered(answer: HttpAnswer | { error: string }, what: string): HttpAnswer {
  expect('error' in answer ? answer.error : '', `${what}: the request got no answer`).toBe('');
  return answer as HttpAnswer;
}

/** Deletes `paths` straight on the emulator when the check ends; one that is not there is ignored. */
function deleteWhenDone(ctx: Ctx, paths: string[]) {
  ctx.own({
    async dispose() {
      for (const pathname of paths) {
        ctx.log(
          `cleanup DELETE ${pathname} directly: ${statusOf(await directS3(ctx, ctx.emulatorPort, 'DELETE', pathname))}`,
        );
      }
    },
  });
}

test('engine.product-relay-s3-get-object-8mib-is-transparent', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const form = await upOnRunEmulator(ctx);
  const key = emulatorKey(ctx, ctx.emulatorPort);
  const bucket = `${runPrefix(ctx)}-p8m`;
  const object = `/${bucket}/k`;

  // The Given: a bucket with the check's prefix, created straight on the emulator.
  deleteWhenDone(ctx, [object, `/${bucket}`]);
  const created = await directS3(ctx, ctx.emulatorPort, 'PUT', `/${bucket}`);
  if (statusOf(created) !== 200) throw new EnvError(`CreateBucket ${bucket} sent directly: ${statusOf(created)}`);

  // A signed s3:PutObject of 8,388,608 bytes to the form's engine port → 200; a s3:HeadObject straight to the
  // emulator reports that length and the ETag of those bytes.
  const bytes = seeded(0x5eed0034, OBJECT_BYTES);
  const put = answered(await signedVia(form.enginePort, key, 'PUT', object, {}, bytes), 'PutObject through the form');
  expect(put.status, `PutObject through the form: status, body ${put.body.toString('utf8')}`).toBe(200);
  const head = answered(await directS3(ctx, ctx.emulatorPort, 'HEAD', object), 'HeadObject sent directly');
  expect(head.status, 'HeadObject sent directly: status').toBe(200);
  expect(head.headers['content-length'], 'HeadObject sent directly: Content-Length').toBe(String(OBJECT_BYTES));
  expect(head.headers.etag, 'HeadObject sent directly: ETag').toBe(
    `"${createHash('md5').update(bytes).digest('hex')}"`,
  );

  // A signed s3:GetObject through the form and straight to the emulator → transparent, and the body through the form
  // is the bytes that were put.
  const through = answered(await signedVia(form.enginePort, key, 'GET', object), 'GetObject through the form');
  const direct = answered(await directS3(ctx, ctx.emulatorPort, 'GET', object), 'GetObject sent directly');
  ctx.log(
    `GetObject: direct ${String(direct.status)} (${String(direct.body.length)} bytes), through the form ${String(through.status)} (${String(through.body.length)} bytes)`,
  );
  expect(transparencyDiff(direct, through), 'GetObject: differences from the direct answer').toEqual([]);
  expect(through.body.length, 'GetObject through the form: body length').toBe(OBJECT_BYTES);
  expect(through.body.equals(bytes), 'GetObject through the form: the body is the bytes that were put').toBe(true);
});

test('engine.product-browser-rules-hold', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const form = await upOnRunEmulator(ctx);
  const key = emulatorKey(ctx, ctx.emulatorPort);
  const studioOrigin = `http://127.0.0.1:${String(form.studioPort)}`;
  // A browser origin that is not the form's Studio: the default Studio port, which a check's form never takes.
  const foreignOrigin = 'http://127.0.0.1:8296';
  const bucket = `${runPrefix(ctx)}-pbr`;

  // Health with a foreign Origin → 403 OriginNotAllowed, no Access-Control-Allow-Origin.
  let what = `GET ${HEALTH_PATH} with Origin ${foreignOrigin}`;
  let answer = answered(
    await request(form.enginePort, 'GET', HEALTH_PATH, {
      origin: foreignOrigin,
    }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(403);
  expect(errorCode(answer), `${what}: error code`).toBe('OriginNotAllowed');
  expect(answer.headers['access-control-allow-origin'], `${what}: Access-Control-Allow-Origin`).toBeUndefined();

  // Health with `Host: localhost:<engine port>` → 421 MisdirectedRequest.
  what = `GET ${HEALTH_PATH} with Host localhost:${String(form.enginePort)}`;
  answer = answered(
    await request(form.enginePort, 'GET', HEALTH_PATH, {
      host: `localhost:${String(form.enginePort)}`,
    }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(421);
  expect(errorCode(answer), `${what}: error code`).toBe('MisdirectedRequest');

  // The bucket's deletion is registered before any PUT of it is sent, the refused one included.
  deleteWhenDone(ctx, [`/${bucket}`]);

  // A PUT /<bucket> with the Studio origin and no X-EmuForge-Session → 401 SessionRequired, and the emulator does
  // not list the bucket.
  what = `PUT /${bucket} with Origin ${studioOrigin} and no X-EmuForge-Session`;
  answer = answered(
    await signedVia(form.enginePort, key, 'PUT', `/${bucket}`, {
      origin: studioOrigin,
    }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(401);
  expect(errorCode(answer), `${what}: error code`).toBe('SessionRequired');
  const listedBefore = answered(await directS3(ctx, ctx.emulatorPort, 'GET', '/'), 'ListBuckets sent directly');
  expect(listedBefore.status, 'ListBuckets sent directly: status').toBe(200);
  expect(bucketNames(listedBefore.body.toString('utf8')), 'ListBuckets sent directly after the refusal').not.toContain(
    bucket,
  );

  // GET /__emuforge/session with the Studio origin → 200 with a token; the same PUT with it gets the emulator's
  // answer.
  what = `GET ${SESSION_PATH} with Origin ${studioOrigin}`;
  answer = answered(
    await request(form.enginePort, 'GET', SESSION_PATH, {
      origin: studioOrigin,
    }),
    what,
  );
  let token = '';
  try {
    token = String((JSON.parse(answer.body.toString('utf8')) as { token?: unknown }).token ?? '');
  } catch {
    token = '';
  }
  registerSecret([token]);
  expect(answer.status, `${what}: status`).toBe(200);
  expect(token, `${what}: token`).not.toBe('');
  what = `PUT /${bucket} with Origin ${studioOrigin} and the token`;
  answer = answered(
    await signedVia(form.enginePort, key, 'PUT', `/${bucket}`, {
      origin: studioOrigin,
      'x-emuforge-session': token,
    }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(200);
  const listedAfter = answered(await directS3(ctx, ctx.emulatorPort, 'GET', '/'), 'ListBuckets sent directly');
  expect(
    bucketNames(listedAfter.body.toString('utf8')),
    'ListBuckets sent directly after the PUT with the token',
  ).toContain(bucket);

  // GET / on the Studio port with `Host: localhost:<studio port>` → 421.
  what = `GET / on the Studio port with Host localhost:${String(form.studioPort)}`;
  answer = answered(
    await request(form.studioPort, 'GET', '/', {
      host: `localhost:${String(form.studioPort)}`,
    }),
    what,
  );
  expect(answer.status, `${what}: status`).toBe(421);
});
