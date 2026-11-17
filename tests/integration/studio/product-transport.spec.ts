// The product checks that send requests through the one form and directly to the form's own emulator (issue 437,
// test-criteria.md). Each form is started with the direct side (`support/product-direct.yml` beside the root file),
// which publishes the emulator's port on a loopback port of the run; the emulator's key and `ca.pem` are read inside
// its container into memory (`Form.emulatorFiles`). Through the form is a request to the form's published engine
// port; directly is the same request to the direct port, TLS verified against that `ca.pem`.
//
// An 8 MiB object got and headed both ways, compared as `engine/references/relay-fidelity.md` defines
// transparency; the engine's browser rules (`Origin`, `Host`, the session token) and Studio's server's `Host` rule as
// a caller of the form's two published ports sees them; and a ListBuckets signed with a made-up key, unsigned, and
// with an `Authorization` that is not SigV4, through the form against directly.
//
// `engine.product-relay-s3-get-object-8mib-is-transparent`, `engine.product-browser-rules-hold`,
// `engine.product-relay-signs-a-made-up-key-with-the-emulators-key`.

import { createHash } from 'node:crypto';

import { expect, registerSecret, test, type Ctx } from './support';
import { bucketNames } from './support/aws-clients';
import {
  directRequest,
  directSigned,
  errorCode,
  placeheld,
  runPrefix,
  signedVia,
  transparencyDiff,
} from './support/product-inspect';
import {
  expectExit,
  Form,
  madeUpKey,
  productTimeout,
  request,
  waitReachable,
  type FormEmulatorFiles,
  type HttpAnswer,
} from './support/product';
import { HEALTH_PATH, SESSION_PATH } from './support/traffic';

/** 8 MiB: the object of the transparency pair. */
const OBJECT_BYTES = 8_388_608;

/** The Given of the three checks: a form started with the direct side, reachable, and its emulator's files. */
async function upWithDirectSide(ctx: Ctx): Promise<{ form: Form; files: FormEmulatorFiles; direct: number }> {
  const form = await Form.create(ctx, { files: ['direct'] });
  expectExit(await form.start(), 'zero');
  expect(await waitReachable(form.enginePort, true), 'the Given: GET /__emuforge/health').toMatchObject({
    status: 200,
    body: { emulator: { reachable: true } },
  });
  const files = await form.emulatorFiles();
  expect('error' in files ? files.error : '', "the Given: the emulator's files read inside its container").toBe('');
  return { form, files: files as FormEmulatorFiles, direct: form.directPort ?? 0 };
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

/** The bucket names the form's emulator lists directly, signed with its own key. */
async function listedDirectly(direct: number, files: FormEmulatorFiles): Promise<string[]> {
  const listed = answered(await directSigned(direct, files, files, 'GET', '/'), 'ListBuckets sent directly');
  expect(listed.status, 'ListBuckets sent directly: status').toBe(200);
  return bucketNames(listed.body.toString('utf8'));
}

test('engine.product-relay-s3-get-object-8mib-is-transparent', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const { form, files, direct } = await upWithDirectSide(ctx);
  const bucket = `${runPrefix(ctx)}-p8m`;
  const object = `/${bucket}/k`;

  // The Given: a bucket created directly, and an 8 MiB object put through the form, which the emulator then reports
  // with that length and the ETag of those bytes.
  const created = answered(await directSigned(direct, files, files, 'PUT', `/${bucket}`), 'CreateBucket directly');
  expect(created.status, `the Given: CreateBucket ${bucket} sent directly`).toBe(200);
  const bytes = seeded(0x5eed0437, OBJECT_BYTES);
  const put = answered(await signedVia(form.enginePort, files, 'PUT', object, {}, bytes), 'PutObject through the form');
  expect(put.status, `the Given: PutObject through the form, body ${put.body.toString('utf8')}`).toBe(200);
  const etag = `"${createHash('md5').update(bytes).digest('hex')}"`;

  // GET through the form and directly → the same status, body bytes and headers under the rules; the body through
  // the form is the bytes that were put.
  const through = answered(await signedVia(form.enginePort, files, 'GET', object), 'GetObject through the form');
  const got = answered(await directSigned(direct, files, files, 'GET', object), 'GetObject sent directly');
  ctx.log(
    `GetObject: direct ${String(got.status)} (${String(got.body.length)} bytes), through the form ${String(through.status)} (${String(through.body.length)} bytes)`,
  );
  expect(transparencyDiff(got, through), 'GetObject: differences from the direct answer').toEqual([]);
  expect(through.body.length, 'GetObject through the form: body length').toBe(OBJECT_BYTES);
  expect(through.body.equals(bytes), 'GetObject through the form: the body is the bytes that were put').toBe(true);

  // HEAD through the form and directly → the same status and headers under the same rules.
  const headThrough = answered(await signedVia(form.enginePort, files, 'HEAD', object), 'HeadObject through the form');
  const head = answered(await directSigned(direct, files, files, 'HEAD', object), 'HeadObject sent directly');
  expect(transparencyDiff(head, headThrough), 'HeadObject: differences from the direct answer').toEqual([]);
  expect(head.headers['content-length'], 'HeadObject sent directly: Content-Length').toBe(String(OBJECT_BYTES));
  expect(head.headers.etag, 'HeadObject sent directly: ETag').toBe(etag);
});

test('engine.product-browser-rules-hold', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const { form, files, direct } = await upWithDirectSide(ctx);
  const studioOrigin = `http://127.0.0.1:${String(form.studioPort)}`;
  // A browser origin that is not the form's Studio: the default Studio port, which a check's form never takes.
  const foreignOrigin = 'http://127.0.0.1:8296';
  const prefix = runPrefix(ctx);

  // A foreign origin → 403 OriginNotAllowed, no Access-Control-Allow-Origin.
  let what = `GET ${HEALTH_PATH} with Origin ${foreignOrigin}`;
  let answer = answered(await request(form.enginePort, 'GET', HEALTH_PATH, { origin: foreignOrigin }), what);
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(403);
  expect(errorCode(answer), `${what}: error code`).toBe('OriginNotAllowed');
  expect(answer.headers['access-control-allow-origin'], `${what}: Access-Control-Allow-Origin`).toBeUndefined();

  // A foreign host → 421 MisdirectedRequest.
  what = `GET ${HEALTH_PATH} with Host localhost:${String(form.enginePort)}`;
  answer = answered(
    await request(form.enginePort, 'GET', HEALTH_PATH, { host: `localhost:${String(form.enginePort)}` }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(421);
  expect(errorCode(answer), `${what}: error code`).toBe('MisdirectedRequest');

  // A state-changing request with the Studio origin and no token → 401 SessionRequired, and its bucket does not
  // exist directly on the form's emulator.
  const noToken = `${prefix}-pbr-nt`;
  what = `PUT /${noToken} with Origin ${studioOrigin} and no X-EmuForge-Session`;
  answer = answered(await signedVia(form.enginePort, files, 'PUT', `/${noToken}`, { origin: studioOrigin }), what);
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(401);
  expect(errorCode(answer), `${what}: error code`).toBe('SessionRequired');
  expect(await listedDirectly(direct, files), `the buckets listed directly after: ${what}`).not.toContain(noToken);

  // The token, from GET /__emuforge/session with the Studio origin.
  what = `GET ${SESSION_PATH} with Origin ${studioOrigin}`;
  answer = answered(await request(form.enginePort, 'GET', SESSION_PATH, { origin: studioOrigin }), what);
  let token = '';
  try {
    token = String((JSON.parse(answer.body.toString('utf8')) as { token?: unknown }).token ?? '');
  } catch {
    token = '';
  }
  registerSecret([token]);
  expect(answer.status, `${what}: status`).toBe(200);
  expect(token, `${what}: token`).not.toBe('');

  // The token in a query string instead of its header → 401 SessionRequired, and its bucket does not exist directly.
  const inQuery = `${prefix}-pbr-qs`;
  what = `PUT /${inQuery}?X-EmuForge-Session=<token> with Origin ${studioOrigin}`;
  answer = answered(
    await signedVia(form.enginePort, files, 'PUT', `/${inQuery}?X-EmuForge-Session=${encodeURIComponent(token)}`, {
      origin: studioOrigin,
    }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(401);
  expect(errorCode(answer), `${what}: error code`).toBe('SessionRequired');
  expect(await listedDirectly(direct, files), `the buckets listed directly after: ${what}`).not.toContain(inQuery);

  // The same request with Studio's origin and the token → served, and the bucket exists directly.
  const served = `${prefix}-pbr-ok`;
  what = `PUT /${served} with Origin ${studioOrigin} and the token`;
  answer = answered(
    await signedVia(form.enginePort, files, 'PUT', `/${served}`, {
      origin: studioOrigin,
      'x-emuforge-session': token,
    }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(200);
  expect(await listedDirectly(direct, files), `the buckets listed directly after: ${what}`).toContain(served);

  // Studio's server with a foreign host → 421.
  what = `GET / on the Studio port with Host localhost:${String(form.studioPort)}`;
  answer = answered(await request(form.studioPort, 'GET', '/', { host: `localhost:${String(form.studioPort)}` }), what);
  expect(answer.status, `${what}: status`).toBe(421);
});

test('engine.product-relay-signs-a-made-up-key-with-the-emulators-key', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const { form, files, direct } = await upWithDirectSide(ctx);
  const madeUp = madeUpKey();
  const directHost = { host: `127.0.0.1:${String(direct)}` };
  const throughHost = { host: `127.0.0.1:${String(form.enginePort)}` };
  const pair = (what: string, a: HttpAnswer) => ({ status: a.status, body: placeheld(a.body), what });

  // ListBuckets signed with a made-up key through the form → 200 with the body the emulator gives directly to the
  // same request signed with its own key.
  const own = answered(await directSigned(direct, files, files, 'GET', '/'), 'ListBuckets directly, its own key');
  const viaMadeUp = answered(await signedVia(form.enginePort, madeUp, 'GET', '/'), 'ListBuckets through, made-up key');
  expect(viaMadeUp.status, 'ListBuckets through the form with a made-up key: status').toBe(200);
  expect(placeheld(viaMadeUp.body), 'ListBuckets through the form with a made-up key: body').toBe(placeheld(own.body));
  expect(own.status, "ListBuckets directly with the emulator's own key: status").toBe(200);

  // The made-up key directly → 403.
  const refused = answered(await directSigned(direct, files, madeUp, 'GET', '/'), 'ListBuckets directly, made-up key');
  expect(
    refused.status,
    `ListBuckets directly with the made-up key: status, body ${refused.body.toString('utf8')}`,
  ).toBe(403);

  // No Authorization through the form → the status and body the emulator gives directly to the same unsigned
  // request, and not a ListAllMyBucketsResult.
  const unsignedDirect = answered(await directRequest(direct, files.ca, 'GET', '/', directHost), 'unsigned directly');
  const unsignedThrough = answered(await request(form.enginePort, 'GET', '/', throughHost), 'unsigned through');
  expect(pair('unsigned GET / through the form', unsignedThrough)).toEqual(
    pair('unsigned GET / through the form', unsignedDirect),
  );
  expect(unsignedThrough.body.toString('utf8'), 'unsigned GET / through the form: body').not.toContain(
    'ListAllMyBucketsResult',
  );

  // An Authorization that is not SigV4 through the form → the status and body the emulator gives directly to the
  // same request, and not a ListAllMyBucketsResult.
  const notSigV4 = {
    authorization: `Basic ${Buffer.from(`${madeUp.accessKeyId}:${madeUp.secretAccessKey}`).toString('base64')}`,
  };
  const basicDirect = answered(
    await directRequest(direct, files.ca, 'GET', '/', { ...directHost, ...notSigV4 }),
    'Basic directly',
  );
  const basicThrough = answered(
    await request(form.enginePort, 'GET', '/', { ...throughHost, ...notSigV4 }),
    'Basic through',
  );
  expect(pair('GET / with a Basic Authorization through the form', basicThrough)).toEqual(
    pair('GET / with a Basic Authorization through the form', basicDirect),
  );
  expect(basicThrough.body.toString('utf8'), 'GET / with a Basic Authorization through the form: body').not.toContain(
    'ListAllMyBucketsResult',
  );
});
