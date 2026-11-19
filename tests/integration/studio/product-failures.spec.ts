// The product checks of starts that must fail (issues 34, 437 and 484, test-criteria.md): ports that collide, on the host
// or in the form's namespace, and an image that does not build. One list of cases, the same on every platform. Each
// case starts its own form with the start line; after a failing one the stop line and the line that removes the
// volume too leave nothing of the form.
//
// `engine.product-does-not-come-up-on-a-port-collision` (on request: run it with `pm-check --checks`),
// `engine.product-start-fails-when-the-image-does-not-build`.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { expect, freePortExcept, OwnEmulator, test, type Ctx } from './support';
import { docker, runAt } from './support/product-inspect';
import {
  expectExit,
  Form,
  LINES,
  NEVER_STARTED,
  productTimeout,
  START_BOUND_MS,
  STOP_BOUND_MS,
  tail,
  UP_BOUND_MS,
  waitReachable,
  type CommandResult,
  type FormOptions,
} from './support/product';

/** The port as a whole number in a text (not part of a longer number). */
function namesPort(text: string, port: number): boolean {
  return new RegExp(`(^|\\D)${String(port)}(\\D|$)`).test(text);
}

/** A free loopback port none of the check's forms took and none of the run's or the defaults. */
async function freeOwnPort(ctx: Ctx, taken: number[]): Promise<number> {
  const port = await freePortExcept(ctx.home, [
    ctx.emulatorPort,
    ctx.enginePort,
    ctx.studioPort,
    9297,
    8296,
    8297,
    ...taken,
  ]);
  taken.push(port);
  return port;
}

/** A listener of the check on `127.0.0.1:<port>`, closed when the check ends. */
async function holdPort(ctx: Ctx, port: number): Promise<void> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  ctx.own({ dispose: () => new Promise<void>((resolve) => server.close(() => resolve())) });
  ctx.log(`the check listens on 127.0.0.1:${String(port)}`);
}

/** The output of a command, both streams. */
function outputOf(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

interface Case {
  what: string;
  /** The form's options, from free ports the case takes; `port` is the number the case is about. */
  options(take: () => Promise<number>): Promise<{ options: FormOptions; port: number }>;
  /** Before the start: a listener of the check on the form's Studio or engine port, or an emulator of its own. */
  before?: 'hold-studio' | 'hold-engine';
  /** What the case observes after the start line. */
  then: (ctx: Ctx, form: Form, started: CommandResult, port: number, what: string) => Promise<void>;
}

/** The start line exits non-zero and its output names the port. */
async function refusedNamingPort(_ctx: Ctx, _form: Form, started: CommandResult, port: number, what: string) {
  expectExit(started, 'non-zero');
  expect(
    namesPort(outputOf(started), port),
    `${what}: the output of ${started.line} names ${String(port)}; output:\n${tail(started)}`,
  ).toBe(true);
}

/**
 * The start line exits non-zero, `docker compose logs emuforge` holds a line with both variables and the number, and
 * the form's emulator was never started: it waits for `emuforge` to be healthy (#484 R8).
 */
function refusedByEmuforge(other: string) {
  return async (_ctx: Ctx, form: Form, started: CommandResult, port: number, what: string) => {
    expectExit(started, 'non-zero');
    const logs = await form.run(form.compose('logs', '--no-color', 'emuforge'), STOP_BOUND_MS);
    expect(
      outputOf(logs)
        .split('\n')
        .filter((line) => line.includes('EMULATOR_PORT') && line.includes(other) && namesPort(line, port)),
      `${what}: lines of ${logs.line} with EMULATOR_PORT, ${other} and ${String(port)}; output:\n${tail(logs)}`,
    ).not.toEqual([]);
    const emulators = (await form.containers()).filter((c) => c.service === 'aws-emulator');
    expect(
      emulators.filter((c) => c.running || c.startedAt !== NEVER_STARTED).map((c) => `${c.name} ${c.startedAt}`),
      `${what}: containers of aws-emulator that were started`,
    ).toEqual([]);
  };
}

const CASES: Case[] = [
  {
    what: "Studio's port taken on the host",
    before: 'hold-studio',
    async options(take) {
      const port = await take();
      return { options: { studioPort: port }, port };
    },
    then: refusedNamingPort,
  },
  {
    what: "the engine's port taken on the host",
    before: 'hold-engine',
    async options(take) {
      const port = await take();
      return { options: { enginePort: port }, port };
    },
    then: refusedNamingPort,
  },
  {
    what: "Studio's and the engine's ports equal",
    async options(take) {
      const port = await take();
      return { options: { enginePort: port, studioPort: port }, port };
    },
    then: refusedNamingPort,
  },
  {
    what: "EMULATOR_PORT equal to the engine's port",
    async options(take) {
      const port = await take();
      return { options: { emulatorPort: port, enginePort: port }, port };
    },
    then: refusedByEmuforge('EMUFORGE_ENGINE_PORT'),
  },
  {
    what: "EMULATOR_PORT equal to Studio's port",
    async options(take) {
      const port = await take();
      return { options: { emulatorPort: port, studioPort: port }, port };
    },
    then: refusedByEmuforge('EMUFORGE_STUDIO_PORT'),
  },
];

test('engine.product-does-not-come-up-on-a-port-collision', async ({ ctx }) => {
  // Each failing case: its start, its stop line, the line that removes the volume and the cleanup's; the last case: a
  // start, the cleanup's stop and an emulator of the check's own.
  const starts = CASES.length + 1;
  test.setTimeout(productTimeout(starts, 3 * starts) + UP_BOUND_MS);
  const taken: number[] = [];

  for (const c of CASES) {
    const { options, port } = await c.options(() => freeOwnPort(ctx, taken));
    const form = await Form.create(ctx, options);
    taken.push(form.emulatorPort, form.enginePort, form.studioPort);
    const what = `${c.what} (${form.project}, port ${String(port)})`;
    if (c.before === 'hold-studio') await holdPort(ctx, form.studioPort);
    if (c.before === 'hold-engine') await holdPort(ctx, form.enginePort);
    ctx.log(`case: ${what}`);

    const started = await form.start();
    await c.then(ctx, form, started, port, what);

    // After each failing case → the stop line exits 0, and after the line that removes the volume too no container,
    // network or volume of the form is left.
    const stopped = await form.stop();
    expect(stopped.code, `${what}: ${stopped.line}: exit code; output:\n${tail(stopped)}`).toBe(0);
    const removed = await form.removeVolume();
    expect(removed.code, `${what}: ${removed.line}: exit code; output:\n${tail(removed)}`).toBe(0);
    expect(
      { ...(await form.waitGone()), volumes: await form.volumes() },
      `${what}: what is left of ${form.project}`,
    ).toEqual({ containers: [], networks: [], volumes: [] });
  }

  // An emulator of the check's own published on the host's 127.0.0.1:<EMULATOR_PORT> → exit 0 and health
  // `reachable: true` (not a collision any more).
  const own = await OwnEmulator.start(ctx);
  const form = await Form.create(ctx, { emulatorPort: own.port });
  const what = `an emulator of the check's own on 127.0.0.1:${String(own.port)} (${form.project})`;
  const started = await form.start();
  expect(started.code, `${what}: ${started.line}: exit code; output:\n${tail(started)}`).toBe(0);
  expect(await waitReachable(form.enginePort, true), `${what}: GET /__emuforge/health`).toMatchObject({
    status: 200,
    body: { emulator: { reachable: true } },
  });
});

/** How long copying the checkout's sources into the scratch directory may take. */
const COPY_BOUND_MS = 60_000;

test('engine.product-start-fails-when-the-image-does-not-build', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2) + COPY_BOUND_MS);
  // The Given: a directory under the run's scratch space with a copy of docker-compose.yml and infra/, Studio's
  // sources, and an engine/ without Cargo.toml, so the product's Dockerfile cannot build.
  const dir = path.join(ctx.tmp, `no-build-${ctx.id}-${String(Date.now())}`);
  fs.mkdirSync(dir, { recursive: true });
  ctx.own({ dispose: async () => fs.rmSync(dir, { recursive: true, force: true }) });
  const from = (rel: string) => path.join(ctx.checkout, rel);
  if (fs.existsSync(from('docker-compose.yml')))
    fs.copyFileSync(from('docker-compose.yml'), path.join(dir, 'docker-compose.yml'));
  fs.cpSync(from('infra'), path.join(dir, 'infra'), { recursive: true });
  const built = new Set(['node_modules', 'dist', 'output', 'target', '.impeccable']);
  fs.cpSync(from('studio'), path.join(dir, 'studio'), {
    recursive: true,
    filter: (src) => !built.has(path.basename(src)),
  });
  fs.cpSync(from('engine'), path.join(dir, 'engine'), {
    recursive: true,
    filter: (src) => !built.has(path.basename(src)) && src !== from('engine/Cargo.toml'),
  });

  // Image names of the check's own, so the run's images are not built again under their names from the copy; the
  // form's ports are free ports, as every form's.
  const image = `${ctx.productImage}-no-build`;
  const emulatorImage = `${ctx.emulatorImage}-no-build`;
  const form = await Form.create(ctx);
  const env = { ...form.env(), EMUFORGE_IMAGE: image, EMUFORGE_EMULATOR_IMAGE: emulatorImage };
  ctx.own({
    async dispose() {
      const down = await runAt(ctx, dir, LINES.removeVolume, env, STOP_BOUND_MS).catch((e: Error) => e.message);
      ctx.log(`cleanup: ${typeof down === 'string' ? down : `${down.line}: exit ${String(down.code)}`}`);
      await docker(['image', 'rm', image, emulatorImage]);
    },
  });

  // The start line in that directory → exit non-zero with the build's error (it names the missing Cargo.toml).
  const started = await runAt(ctx, dir, LINES.start, env, START_BOUND_MS);
  expect(started.code, `${started.line} in ${dir}: exit code; output:\n${tail(started)}`).not.toBe(0);
  expect(
    outputOf(started)
      .split('\n')
      .filter((line) => line.includes('Cargo.toml') && /error|fail|not found|could not/i.test(line)),
    `${started.line}: lines of the failed build step naming Cargo.toml; output:\n${tail(started)}`,
  ).not.toEqual([]);

  // No container, network or volume of the project, and no image of the product's name.
  expect(
    {
      containers: (await form.containers()).map((c) => c.name),
      networks: await form.networks(),
      volumes: await form.volumes(),
      images: (await docker(['images', '-q', image])).stdout,
    },
    `what is left of ${form.project} and images named ${image}`,
  ).toEqual({ containers: [], networks: [], volumes: [], images: '' });
});
