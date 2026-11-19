// The product checks of issue 503 (test-criteria.md, Integration): a browser on an allowed host name reaches Studio
// and the engine through Studio's one port. Each check starts its own Compose form (`support/product.ts`), with
// `EMUFORGE_ALLOW_HOSTS` where it allows a name, and sends plain HTTP to `127.0.0.1:<port>` with the `Host` and
// `Origin` a browser under the name would send; no request leaves loopback. The channel is `/__engine` on the
// Studio port. Directly is the same request to the form's own emulator on the direct port, TLS verified.
//
// `engine.product-allowed-host-opens-studio-through-one-port`,
// `engine.product-without-allowed-host-serves-loopback-only`,
// `engine.product-channel-relay-s3-object-matches-direct`,
// `engine.product-allow-host-start-warns-and-keeps-secrets`,
// `engine.product-page-calls-the-engine-through-studios-port`.

import { expect, registerSecret, test, waitFor, type Ctx } from './support';
import { bucketNames } from './support/aws-clients';
import { connectionView } from './support/home';
import {
  directSigned,
  docker,
  errorCode,
  findSecrets,
  runPrefix,
  secretValues,
  signS3,
  transparencyDiff,
} from './support/product-inspect';
import {
  CHANGE_BOUND_MS,
  expectExit,
  Form,
  madeUpKey,
  productTimeout,
  request,
  UP_BOUND_MS,
  waitReachable,
  type FormEmulatorFiles,
  type HttpAnswer,
} from './support/product';
import { HEALTH_PATH, SESSION_PATH } from './support/traffic';

/** The channel's path on the Studio port. */
const CHANNEL = '/__engine';
const SESSION_HEADER = 'x-emuforge-session';

/** A host name unique to the run under `.test`, which resolves nowhere: it is only ever sent as a header. */
function allowedName(ctx: Ctx): string {
  const label = runPrefix(ctx)
    .slice(0, 63)
    .replace(/-+$/, '');
  return `${label}.test`;
}

/** The answer, or a failed assertion naming the error that kept it from arriving. */
function answered(answer: HttpAnswer | { error: string }, what: string): HttpAnswer {
  expect('error' in answer ? answer.error : '', `${what}: the request got no answer`).toBe('');
  return answer as HttpAnswer;
}

/** A form started with `EMUFORGE_ALLOW_HOSTS` (when `name` is given) and its emulator reachable. */
async function up(
  ctx: Ctx,
  name: string | null,
  direct: boolean,
): Promise<{ form: Form; files: FormEmulatorFiles | null }> {
  const form = await Form.create(ctx, {
    files: direct ? ['direct'] : [],
    env: name === null ? {} : { EMUFORGE_ALLOW_HOSTS: name },
  });
  expectExit(await form.start(), 'zero');
  expect(await waitReachable(form.enginePort, true), 'the Given: GET /__emuforge/health').toMatchObject({
    status: 200,
    body: { emulator: { reachable: true } },
  });
  if (!direct) return { form, files: null };
  const files = await form.emulatorFiles();
  expect('error' in files ? files.error : '', "the Given: the emulator's files read inside its container").toBe('');
  return { form, files: files as FormEmulatorFiles };
}

/** `method <path>` on the form's Studio port with `Host: <host>` and `headers`. */
function onStudio(
  form: Form,
  host: string,
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body: Buffer = Buffer.alloc(0),
): Promise<HttpAnswer | { error: string }> {
  return request(form.studioPort, method, pathname, { ...headers, host }, body, 30_000);
}

/**
 * An S3 request through the channel as Studio's page under `host` sends one: signed over the path it is sent to
 * with a made-up key (the engine signs upstream itself), with `extra` added after signing.
 */
function s3ViaChannel(
  form: Form,
  host: string,
  method: string,
  inner: string,
  extra: Record<string, string> = {},
  body: Buffer = Buffer.alloc(0),
): Promise<HttpAnswer | { error: string }> {
  const pathname = `${CHANNEL}${inner}`;
  const signed = signS3(host, method, pathname, body, madeUpKey());
  return onStudio(form, host, method, pathname, { ...signed, ...extra }, body);
}

/**
 * The session token the channel gives a request under `host`; registered for redaction. `seen` gets the session
 * answer, for a check that searches it.
 */
async function channelToken(
  form: Form,
  host: string,
  seen?: (what: string, answer: ReturnType<typeof answered>) => void,
): Promise<string> {
  const what = `GET ${CHANNEL}${SESSION_PATH} with Host ${host}`;
  const answer = answered(await onStudio(form, host, 'GET', `${CHANNEL}${SESSION_PATH}`), what);
  expect(answer.status, `${what}: status`).toBe(200);
  seen?.(what, answer);
  const token = (JSON.parse(answer.body.toString('utf8')) as { token?: unknown }).token;
  expect(typeof token === 'string' && token.length > 0, `${what}: the body holds a token`).toBe(true);
  registerSecret([token as string]);
  return token as string;
}

/** The bucket names the form's emulator lists directly, signed with its own key. */
async function listedDirectly(form: Form, files: FormEmulatorFiles): Promise<string[]> {
  const listed = answered(
    await directSigned(form.directPort ?? 0, files, files, 'GET', '/'),
    'ListBuckets sent directly',
  );
  expect(listed.status, 'ListBuckets sent directly: status').toBe(200);
  return bucketNames(listed.body.toString('utf8'));
}

test('engine.product-allowed-host-opens-studio-through-one-port', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const name = allowedName(ctx);
  const { form, files } = await up(ctx, name, true);
  const host = `${name}:${String(form.studioPort)}`;
  const loopback = `127.0.0.1:${String(form.studioPort)}`;

  // GET / and GET /config.json with the allowed Host → 200, the bodies of the loopback Host; /config.json names the
  // channel's path and the form's engine port.
  for (const pathname of ['/', '/config.json']) {
    const what = `GET ${pathname} with Host ${host}`;
    const named = answered(await onStudio(form, host, 'GET', pathname), what);
    const local = answered(await onStudio(form, loopback, 'GET', pathname), `GET ${pathname} with Host ${loopback}`);
    expect(named.status, `${what}: status`).toBe(200);
    expect(local.status, `GET ${pathname} with Host ${loopback}: status`).toBe(200);
    expect(named.body.equals(local.body), `${what}: the body is the one ${loopback} gets`).toBe(true);
    if (pathname === '/config.json') {
      expect(JSON.parse(named.body.toString('utf8')), `${what}: body`).toEqual({
        enginePort: form.enginePort,
        enginePath: CHANNEL,
      });
    }
  }

  // The session through the channel with the allowed Host → 200 with a token; health with it → 200, reachable.
  const token = await channelToken(form, host);
  let what = `GET ${CHANNEL}${HEALTH_PATH} with Host ${host} and the token`;
  let answer = answered(await onStudio(form, host, 'GET', `${CHANNEL}${HEALTH_PATH}`, { [SESSION_HEADER]: token }), what);
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(200);
  expect(JSON.parse(answer.body.toString('utf8')), `${what}: body`).toMatchObject({ emulator: { reachable: true } });

  // PUT a bucket through the channel with the page's https Origin and the token → 200, and the emulator lists it.
  const prefix = runPrefix(ctx);
  const made = `${prefix}-pah-ok`;
  what = `PUT ${CHANNEL}/${made} with Host ${host}, Origin https://${host} and the token`;
  answer = answered(
    await s3ViaChannel(form, host, 'PUT', `/${made}`, { origin: `https://${host}`, [SESSION_HEADER]: token }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(200);
  expect(await listedDirectly(form, files as FormEmulatorFiles), `the buckets listed directly after: ${what}`).toContain(
    made,
  );

  // PUT another bucket without a token → 401 SessionRequired, and the emulator does not list it.
  const refused = `${prefix}-pah-nt`;
  what = `PUT ${CHANNEL}/${refused} with Host ${host} and no X-EmuForge-Session`;
  answer = answered(await s3ViaChannel(form, host, 'PUT', `/${refused}`), what);
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(401);
  expect(errorCode(answer), `${what}: error code`).toBe('SessionRequired');
  expect(
    await listedDirectly(form, files as FormEmulatorFiles),
    `the buckets listed directly after: ${what}`,
  ).not.toContain(refused);
});

test('engine.product-without-allowed-host-serves-loopback-only', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const name = allowedName(ctx);
  const { form } = await up(ctx, null, false);
  const host = `${name}:${String(form.studioPort)}`;
  const loopback = `127.0.0.1:${String(form.studioPort)}`;

  // The name as Host → 421 for the page and for the session through the channel, and no token.
  for (const pathname of ['/', `${CHANNEL}${SESSION_PATH}`]) {
    const what = `GET ${pathname} with Host ${host}`;
    const answer = answered(await onStudio(form, host, 'GET', pathname), what);
    expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(421);
    expect(answer.body.toString('utf8'), `${what}: the body holds no token`).not.toContain('"token"');
  }

  // The loopback Host → 200 for the page, a token from the channel, and health with it 200.
  let what = `GET / with Host ${loopback}`;
  let answer = answered(await onStudio(form, loopback, 'GET', '/'), what);
  expect(answer.status, `${what}: status`).toBe(200);
  const token = await channelToken(form, loopback);
  what = `GET ${CHANNEL}${HEALTH_PATH} with Host ${loopback} and the token`;
  answer = answered(
    await onStudio(form, loopback, 'GET', `${CHANNEL}${HEALTH_PATH}`, { [SESSION_HEADER]: token }),
    what,
  );
  expect(answer.status, `${what}: status, body ${answer.body.toString('utf8')}`).toBe(200);
});

test('engine.product-channel-relay-s3-object-matches-direct', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const name = allowedName(ctx);
  const { form, files } = await up(ctx, name, true);
  const emulator = files as FormEmulatorFiles;
  const host = `${name}:${String(form.studioPort)}`;
  const direct = form.directPort ?? 0;
  const bucket = `${runPrefix(ctx)}-pcr`;
  // A key with a slash and an encoded space (decisions.md, PM, 2026-11-19: the emulator refuses a key with `%2F`).
  const object = `/${bucket}/a/b%20c`;
  const bytes = Buffer.from(`issue 503 ${ctx.runId} through the channel\n`, 'utf8');

  // The Given: a bucket created directly.
  const created = answered(await directSigned(direct, emulator, emulator, 'PUT', `/${bucket}`), 'CreateBucket directly');
  expect(created.status, `the Given: CreateBucket ${bucket} sent directly`).toBe(200);

  // PUT then GET the object through the channel, with the token and what a forwarder adds.
  const token = await channelToken(form, host);
  const sent = {
    [SESSION_HEADER]: token,
    'x-forwarded-host': host,
    'x-forwarded-proto': 'https',
    'tailscale-user-login': 'someone@example.test',
  };
  let what = `PUT ${CHANNEL}${object} with Host ${host}`;
  const put = answered(await s3ViaChannel(form, host, 'PUT', object, { ...sent, origin: `https://${host}` }, bytes), what);
  expect(put.status, `${what}: status, body ${put.body.toString('utf8')}`).toBe(200);
  what = `GET ${CHANNEL}${object} with Host ${host}`;
  const through = answered(await s3ViaChannel(form, host, 'GET', object, sent), what);

  // The same GET directly → the same status, body and headers under relay-fidelity.md; the body is the bytes put.
  const got = answered(await directSigned(direct, emulator, emulator, 'GET', object), `GET ${object} sent directly`);
  ctx.log(`GetObject: direct ${String(got.status)}, through the channel ${String(through.status)}`);
  expect(got.status, `GET ${object} sent directly: status`).toBe(200);
  expect(transparencyDiff(got, through), 'GetObject: differences from the direct answer').toEqual([]);
  expect(through.body.equals(bytes), 'GetObject through the channel: the body is the bytes that were put').toBe(true);
});

test('engine.product-allow-host-start-warns-and-keeps-secrets', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2));
  const name = allowedName(ctx);
  const { form, files } = await up(ctx, name, true);
  const emulator = files as FormEmulatorFiles;
  const host = `${name}:${String(form.studioPort)}`;
  const secrets = secretValues(emulator);
  const found: string[] = [];

  // The Given: a session, and one bucket created and deleted through the channel; each answer searched for the key.
  const token = await channelToken(form, host, (what, answer) => {
    found.push(...findSecrets(`the body of ${what}`, answer.body, secrets));
    found.push(...findSecrets(`the headers of ${what}`, JSON.stringify(answer.headers), secrets));
  });
  const bucket = `${runPrefix(ctx)}-pws`;
  for (const method of ['PUT', 'DELETE']) {
    const what = `${method} ${CHANNEL}/${bucket} with Host ${host} and the token`;
    const answer = answered(await s3ViaChannel(form, host, method, `/${bucket}`, { [SESSION_HEADER]: token }), what);
    expect([200, 204], `${what}: status, body ${answer.body.toString('utf8')}`).toContain(answer.status);
    found.push(...findSecrets(`the body of ${what}`, answer.body, secrets));
    found.push(...findSecrets(`the headers of ${what}`, JSON.stringify(answer.headers), secrets));
  }
  expect(found, "the emulator's key in the answers of the Given").toEqual([]);

  // The emuforge container's log → one warning naming the name and the Studio port; no token, no key.
  const container = await form.container('emuforge');
  const logs = await docker(['logs', container.id]);
  expect(logs.ok, `docker logs ${container.name}: ${logs.stderr.slice(0, 200)}`).toBe(true);
  const log = `${logs.stdout}\n${logs.stderr}`;
  const warnings = log.split('\n').filter((line) => line.includes('--allow-host'));
  expect(warnings.length, `the log lines of ${container.name} that name --allow-host`).toBe(1);
  expect(warnings[0], 'the warning names the allowed name').toContain(name);
  expect(warnings[0], 'the warning names the Studio port').toContain(String(form.studioPort));
  expect(log.includes(token), `the session token in the log of ${container.name}`).toBe(false);
  expect(findSecrets(`the log of ${container.name}`, log, secrets), "the emulator's key in the log").toEqual([]);
});

test('engine.product-page-calls-the-engine-through-studios-port', async ({ ctx, page }) => {
  test.setTimeout(productTimeout(1, 2));
  const { form, files } = await up(ctx, null, true);
  const studio = `http://127.0.0.1:${String(form.studioPort)}`;
  const engine = `http://127.0.0.1:${String(form.enginePort)}`;
  const origins: string[] = [];
  page.context().on('request', (sent) => {
    const url = new URL(sent.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') origins.push(url.origin);
  });

  // The page on loopback, Home checked → the engine and the emulator connected.
  await page.goto(form.studioUrl);
  await expect
    .poll(
      async () => {
        const view = await connectionView(page);
        return { engine: view.engine?.status ?? null, emulator: view.emulator?.status ?? null };
      },
      { timeout: CHANGE_BOUND_MS, message: 'both rows "Connected"' },
    )
    .toEqual({ engine: 'Connected', emulator: 'Connected' });

  // A bucket created in the S3 screens → the emulator lists it directly.
  const bucket = `${runPrefix(ctx)}-ppc`;
  await page.goto(`${studio}/aws/s3/bucket/create`);
  await page.getByRole('textbox', { name: 'Bucket name', exact: true }).fill(bucket);
  await page.getByRole('button', { name: 'Create bucket', exact: true }).click();
  let listed: string[] = [];
  await waitFor(UP_BOUND_MS, async () => {
    listed = await listedDirectly(form, files as FormEmulatorFiles);
    return listed.includes(bucket) ? true : undefined;
  });
  expect(listed, 'the buckets listed directly after "Create bucket" in the page').toContain(bucket);

  // Every request of the page went to the Studio port, none to the engine port.
  const seen = [...new Set(origins)].sort();
  expect(seen, "the origins of the page's requests").toEqual([studio]);
  expect(seen, "the origins of the page's requests").not.toContain(engine);
});
