// The product image and its one binary (issue 484, test-criteria.md): Studio's server as a browser reaches it in the
// running form, the binary refusing a Studio port another process of its namespace holds, and what the image holds.
//
// The two checks that run the image without a form start its containers with `docker run --pull never`, each with
// the run's label `emuforge-it-run=<run id>` (so `run` removes what a killed check left) and with no network but
// their own loopback (`--network none`, or the namespace of the first one). Nothing they start reaches an emulator.
//
// `engine.product-studio-answers-as-studios-server`,
// `engine.product-binary-refuses-a-taken-studio-port-and-serves-nothing`, `engine.product-image-holds-one-binary`.

import { EnvError, expect, test, type Ctx } from './support';
import { docker } from './support/product-inspect';
import { expectExit, Form, productTimeout, request, type HttpAnswer, waitReachable } from './support/product';
import { waitFor } from './support/wait';

/** How long a refused `serve` may take to exit, its container's start included. */
const EXIT_BOUND_MS = 30_000;

/** How long the first container may take to answer on both of its ports. */
const LISTEN_BOUND_MS = 30_000;

/** The run's product image; `EnvError` when the run did not build it. */
function productImage(ctx: Ctx): string {
  if (ctx.productMissing) throw new EnvError(`the run's product image did not build: ${ctx.productMissing}`);
  if (!ctx.productImage) {
    throw new EnvError('EMUFORGE_IT_PRODUCT_IMAGE is not set; run the suite with tests/integration/run');
  }
  return ctx.productImage;
}

/** A container name of this check and run; never `emuforge-it-<port>-…`, which `run` reads as an emulator's. */
function containerName(ctx: Ctx, role: string): string {
  return `emuforge-it-image-${role}-${ctx.runId}`;
}

/** Removes the container `name` when the check ends, whatever state it is in. */
function ownContainer(ctx: Ctx, name: string) {
  ctx.own({
    async dispose() {
      const removed = await docker(['rm', '-f', name]);
      ctx.log(`cleanup: docker rm -f ${name}: ${removed.ok ? 'ok' : removed.stderr}`);
    },
  });
}

/** The answer, failing the check on a transport error. */
function answered(what: string, answer: HttpAnswer | { error: string }): HttpAnswer {
  if ('error' in answer) throw new Error(`${what}: no answer: ${answer.error}`);
  return answer;
}

test('engine.product-studio-answers-as-studios-server', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 1));
  const form = await Form.create(ctx);
  expectExit(await form.start(), 'zero');
  await waitReachable(form.enginePort, true);
  const port = form.studioPort;

  // GET / → 200, the page's type and the headers of every page answer.
  const page = answered('GET /', await request(port, 'GET', '/'));
  expect(page.status, 'GET / status').toBe(200);
  expect(page.headers['content-type'], 'GET / Content-Type').toBe('text/html; charset=utf-8');
  expect(page.headers['cache-control'], 'GET / Cache-Control').toBe('no-cache');
  expect(page.headers['x-content-type-options'], 'GET / X-Content-Type-Options').toBe('nosniff');
  expect(page.headers['referrer-policy'], 'GET / Referrer-Policy').toBe('no-referrer');
  const html = page.body.toString('utf8');

  // A route of the app that is no file → 200 and the bytes of the page.
  const route = answered('GET /aws/does-not-exist', await request(port, 'GET', '/aws/does-not-exist'));
  expect(route.status, 'GET /aws/does-not-exist status').toBe(200);
  expect(route.body.equals(page.body), 'GET /aws/does-not-exist body is the bytes of GET /').toBe(true);

  // The first script under /assets/ the page names → 200, JavaScript, cached for good.
  const script = /<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(script, `a <script src="/assets/….js"> in GET /: ${html.slice(0, 400)}`).toBeTruthy();
  const asset = answered(`GET ${script ?? ''}`, await request(port, 'GET', script ?? '/'));
  expect(asset.status, `GET ${script ?? ''} status`).toBe(200);
  expect(asset.headers['content-type'], `GET ${script ?? ''} Content-Type`).toBe('text/javascript; charset=utf-8');
  expect(asset.headers['cache-control'], `GET ${script ?? ''} Cache-Control`).toBe(
    'public, max-age=31536000, immutable',
  );

  // A missing asset → 404, not the page.
  const missing = answered('GET /assets/does-not-exist.js', await request(port, 'GET', '/assets/does-not-exist.js'));
  expect(missing.status, 'GET /assets/does-not-exist.js status').toBe(404);

  // /config.json → the form's engine port, never cached.
  const config = answered('GET /config.json', await request(port, 'GET', '/config.json'));
  expect(config.status, 'GET /config.json status').toBe(200);
  expect(config.headers['cache-control'], 'GET /config.json Cache-Control').toBe('no-store');
  expect(JSON.parse(config.body.toString('utf8')), 'GET /config.json body').toEqual({ enginePort: form.enginePort });

  // POST / → 405 with the methods it takes.
  const post = answered('POST /', await request(port, 'POST', '/', {}, Buffer.from('x')));
  expect(post.status, 'POST / status').toBe(405);
  expect(post.headers.allow, 'POST / Allow').toBe('GET, HEAD');

  // HEAD / → 200 and no body.
  const head = answered('HEAD /', await request(port, 'HEAD', '/'));
  expect(head.status, 'HEAD / status').toBe(200);
  expect(head.body.length, 'HEAD / body length').toBe(0);
});

/** `GET <path>` on `127.0.0.1:<port>` inside `container`'s namespace, with that address's `Host`: the status line. */
async function statusLineInside(container: string, port: number, pathname: string): Promise<string> {
  const script = [
    `exec 3<>/dev/tcp/127.0.0.1/${String(port)} || exit 1`,
    `printf 'GET ${pathname} HTTP/1.1\\r\\nHost: 127.0.0.1:${String(port)}\\r\\nConnection: close\\r\\n\\r\\n' >&3`,
    'timeout 5 head -n 1 <&3',
  ].join('\n');
  const answer = await docker(['exec', container, 'bash', '-c', script], 15_000);
  return answer.ok ? answer.stdout.trim() : `(no answer: ${answer.stderr})`;
}

test('engine.product-binary-refuses-a-taken-studio-port-and-serves-nothing', async ({ ctx }) => {
  test.setTimeout(120_000);
  const image = productImage(ctx);
  // Inside A's namespace no other process of the machine holds a port, so the numbers are the check's own.
  const engineA = 8297;
  const studio = 8296;
  const engineB = 8298;
  const otherEmulator = 9298;

  // A: `serve` on engineA and studio, loopback of its own namespace.
  const a = containerName(ctx, 'a');
  ownContainer(ctx, a);
  const started = await docker([
    'run',
    '--pull',
    'never',
    '-d',
    '--name',
    a,
    '--label',
    `emuforge-it-run=${ctx.runId}`,
    '--network',
    'none',
    image,
    'serve',
    '--port',
    String(engineA),
    '--studio-port',
    String(studio),
  ]);
  if (!started.ok) throw new EnvError(`docker run ${a}: ${started.stderr}`);
  let ready = { engine: '', studio: '' };
  const listening = await waitFor(LISTEN_BOUND_MS, async () => {
    ready = {
      engine: await statusLineInside(a, engineA, '/__emuforge/health'),
      studio: await statusLineInside(a, studio, '/'),
    };
    return /^HTTP\/1\.1 \d{3}/.test(ready.engine) && ready.studio.startsWith('HTTP/1.1 200') ? true : undefined;
  });
  if (!listening) {
    throw new EnvError(
      `container ${a} did not answer on ${engineA} and ${studio} within ${LISTEN_BOUND_MS / 1000}s: ${JSON.stringify(ready)}`,
    );
  }
  ctx.log(`A answers: ${JSON.stringify(ready)}`);

  // B in A's namespace, Studio on A's studio port → exit 1 within the bound, naming the port, flag and variable.
  const b = containerName(ctx, 'b');
  ownContainer(ctx, b);
  const began = Date.now();
  const refused = await docker(
    [
      'run',
      '--pull',
      'never',
      '--name',
      b,
      '--label',
      `emuforge-it-run=${ctx.runId}`,
      '--network',
      `container:${a}`,
      image,
      'serve',
      '--port',
      String(engineB),
      '--studio-port',
      String(studio),
      '--emulator-port',
      String(otherEmulator),
    ],
    EXIT_BOUND_MS,
  );
  const ms = Date.now() - began;
  const exit = await docker(['inspect', '-f', '{{.State.ExitCode}}', b]);
  ctx.log(`B exited ${exit.stdout} after ${ms} ms; stderr: ${refused.stderr}`);
  expect(exit.stdout, `the exit code of ${b}`).toBe('1');
  expect(ms, `how long ${b} ran (ms)`).toBeLessThan(EXIT_BOUND_MS);
  const logs = await docker(['logs', b]);
  const stderr = logs.stderr;
  for (const name of [String(studio), '--studio-port', 'EMUFORGE_STUDIO_PORT']) {
    expect(stderr, `the stderr of ${b} names ${name}`).toContain(name);
  }

  // A after → still answers on both of its ports.
  const engineAfter = await statusLineInside(a, engineA, '/__emuforge/health');
  expect(engineAfter, `A's engine on ${engineA} after B`).toMatch(/^HTTP\/1\.1 \d{3}/);
  const studioAfter = await statusLineInside(a, studio, '/');
  expect(studioAfter, `A's Studio on ${studio} after B`).toMatch(/^HTTP\/1\.1 200/);
});

test('engine.product-image-holds-one-binary', async ({ ctx }) => {
  test.setTimeout(120_000);
  const image = productImage(ctx);

  // Its configuration → entrypoint ["emuforge"], user 1000:1000, HOME=/home/emuforge.
  const config = await docker(['image', 'inspect', '-f', '{{json .Config}}', image]);
  if (!config.ok) throw new EnvError(`docker image inspect ${image}: ${config.stderr}`);
  const parsed = JSON.parse(config.stdout) as { Entrypoint: string[] | null; User: string; Env: string[] | null };
  expect(parsed.Entrypoint, `the entrypoint of ${image}`).toEqual(['emuforge']);
  expect(parsed.User, `the user of ${image}`).toBe('1000:1000');
  expect(parsed.Env ?? [], `the environment of ${image}`).toContain('HOME=/home/emuforge');

  // `emuforge --version` → `emuforge 0.1.0`, exit 0.
  const version = await docker(['run', '--rm', '--pull', 'never', '--network', 'none', image, '--version']);
  expect(version.ok ? '' : version.stderr, `docker run ${image} --version`).toBe('');
  expect(version.stdout, `emuforge --version in ${image}`).toBe('emuforge 0.1.0');

  // bun, node, haproxy on PATH or under /usr and /opt → none; /opt/emuforge → absent.
  const script = [
    'for tool in bun node haproxy; do command -v "$tool" && echo "on PATH: $tool"; done',
    "find /usr /opt -name bun -o -name node -o -name haproxy 2>/dev/null | sed 's/^/found: /'",
    'test -e /opt/emuforge && echo "present: /opt/emuforge"',
    'echo done',
  ].join('\n');
  const looked = await docker([
    'run',
    '--rm',
    '--pull',
    'never',
    '--network',
    'none',
    '--entrypoint',
    'bash',
    image,
    '-c',
    script,
  ]);
  expect(looked.ok ? '' : looked.stderr, `the search in ${image}`).toBe('');
  const lines = looked.stdout.split('\n').filter((line) => line !== '');
  expect(lines.at(-1), `the search in ${image} ran to its end`).toBe('done');
  expect(lines.slice(0, -1), `bun, node, haproxy and /opt/emuforge in ${image}`).toEqual([]);
});
