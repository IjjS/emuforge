// The product checks of starts that must fail (issue 34, test-criteria.md): ports that collide, in the namespace or
// on the host, and an image that does not build. Each case starts its own form and stops it with the stop command of
// its situation.
//
// "Does not come up" is three observables together: health is not answered within the bound, `docker compose ps`
// shows a service of the form that is not running, and `docker compose logs` holds an error line with the port's
// number.
//
// On Docker Engine on Linux (issue 54, requirement 3.4) the form has no gateway and publishes nothing, so Docker refuses
// no port: "does not come up" there is `docker compose ps -a` showing a service that is not running and
// `docker compose logs` holding an error line with the port's number, the start command's exit code is not asserted
// for a collision, and health is asserted only where the case names it. 18296 and 18297 are ordinary ports there.
// The Docker Desktop cases are those of issue 34, unchanged.
//
// `engine.product-does-not-come-up-on-a-port-collision`, `engine.product-start-fails-when-the-image-does-not-build`.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { emulatorDir, expect, freePortExcept, test, waitFor, type Ctx } from './support';
import { docker, runAt } from './support/product-inspect';
import {
  COMMANDS,
  Form,
  health,
  LINUX_FILE,
  platform,
  productTimeout,
  shownHealth,
  START_BOUND_MS,
  STOP_BOUND_MS,
  tail,
  UP_BOUND_MS,
  waitHealth,
  type CommandResult,
  type FormOptions,
  type HealthResult,
  type Platform,
} from './support/product';

/** The port as a whole number in a text (not part of a longer number). */
function namesPort(text: string, port: number): boolean {
  return new RegExp(`(^|\\D)${String(port)}(\\D|$)`).test(text);
}

/** A line that reports an error: one of the words engines, Studio's server, HAProxy and Docker use for one. */
const ERROR_WORDS = /error|alert|cannot|can't|in use|fail|refus|invalid|collide|conflict|same|must|allocated/i;

/** A free loopback port none of the forms of the check took, whose emulator directory, if one appears, is removed. */
async function ownFreePort(ctx: Ctx, taken: number[]): Promise<number> {
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
  const dir = emulatorDir(ctx.home, port);
  ctx.own({
    dispose: async () => fs.rmSync(dir, { recursive: true, force: true }),
  });
  return port;
}

/** A listener of the check on `127.0.0.1:<port>`, closed when the check ends. */
async function holdPort(ctx: Ctx, port: number): Promise<void> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  ctx.own({
    dispose: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
  ctx.log(`the check listens on 127.0.0.1:${String(port)}`);
}

interface Case {
  what: string;
  situation: 3 | 4;
  /** The form's ports, from free ports the case takes. */
  options(take: () => Promise<number>): Promise<{ options: FormOptions; port: number }>;
  /**
   * `down`: the form does not come up; `refused`: the start command exits non-zero and names the port; `ordinary`
   * (Docker Engine on Linux): it exits 0, health answers `503` `not_started`, every container runs.
   */
  expect: 'down' | 'refused' | 'ordinary';
  /** A listener of the check holds the Studio port on `127.0.0.1` before the start. */
  holdStudioPort?: boolean;
  /** A listener of the check holds the engine port on `127.0.0.1` before the start. */
  holdEnginePort?: boolean;
  /** Docker Engine on Linux, `down`: whether health is part of the case (not answered within the bound). */
  health?: boolean;
  /** Docker Engine on Linux, `down`: the one service that is not running, when the case names it. */
  service?: string;
}

const CASES: Case[] = [
  {
    what: 'EMULATOR_PORT and EMUFORGE_ENGINE_PORT one free port',
    situation: 3,
    expect: 'down',
    async options(take) {
      const port = await take();
      return {
        options: { situation: 3, emulatorPort: port, enginePort: port },
        port,
      };
    },
  },
  {
    what: 'EMULATOR_PORT and EMUFORGE_STUDIO_PORT one free port',
    situation: 3,
    expect: 'down',
    async options(take) {
      const port = await take();
      return {
        options: { situation: 3, emulatorPort: port, studioPort: port },
        port,
      };
    },
  },
  ...[18296, 18297].map((reserved): Case => ({
    what: `EMULATOR_PORT the reserved port ${String(reserved)}`,
    situation: 3,
    expect: 'down',
    async options() {
      return {
        options: { situation: 3, emulatorPort: reserved },
        port: reserved,
      };
    },
  })),
  {
    what: 'situation 4, EMULATOR_PORT equal to EMUFORGE_ENGINE_PORT',
    situation: 4,
    expect: 'refused',
    async options(take) {
      const port = await take();
      return {
        options: { situation: 4, emulatorPort: port, enginePort: port },
        port,
      };
    },
  },
  {
    what: 'EMUFORGE_STUDIO_PORT equal to EMUFORGE_ENGINE_PORT',
    situation: 3,
    expect: 'refused',
    async options(take) {
      const port = await take();
      return {
        options: { situation: 3, enginePort: port, studioPort: port },
        port,
      };
    },
  },
  {
    what: 'a listener of the check on the Studio port',
    situation: 3,
    expect: 'refused',
    holdStudioPort: true,
    async options(take) {
      const port = await take();
      return { options: { situation: 3, studioPort: port }, port };
    },
  },
];

/**
 * The cases on Docker Engine on Linux (issue 54 test criteria), each in place of the issue 34 case for the same
 * ports; the last one has no Docker Desktop counterpart.
 */
const LINUX_CASES: Case[] = [
  {
    what: 'EMULATOR_PORT and EMUFORGE_ENGINE_PORT one free port',
    situation: 3,
    expect: 'down',
    health: true,
    async options(take) {
      const port = await take();
      return { options: { situation: 3, emulatorPort: port, enginePort: port }, port };
    },
  },
  {
    what: 'EMULATOR_PORT and EMUFORGE_STUDIO_PORT one free port',
    situation: 3,
    expect: 'down',
    health: true,
    async options(take) {
      const port = await take();
      return { options: { situation: 3, emulatorPort: port, studioPort: port }, port };
    },
  },
  ...[18296, 18297].map((reserved): Case => ({
    what: `EMULATOR_PORT ${String(reserved)}, nothing on it`,
    situation: 3,
    expect: 'ordinary',
    async options() {
      return { options: { situation: 3, emulatorPort: reserved }, port: reserved };
    },
  })),
  {
    what: 'situation 4, EMULATOR_PORT equal to EMUFORGE_ENGINE_PORT',
    situation: 4,
    expect: 'down',
    health: true,
    async options(take) {
      const port = await take();
      return { options: { situation: 4, emulatorPort: port, enginePort: port }, port };
    },
  },
  {
    what: 'EMUFORGE_STUDIO_PORT equal to EMUFORGE_ENGINE_PORT',
    situation: 3,
    expect: 'down',
    health: true,
    async options(take) {
      const port = await take();
      return { options: { situation: 3, enginePort: port, studioPort: port }, port };
    },
  },
  {
    what: 'a listener of the check on the Studio port',
    situation: 3,
    expect: 'down',
    holdStudioPort: true,
    service: 'studio',
    async options(take) {
      const port = await take();
      return { options: { situation: 3, studioPort: port }, port };
    },
  },
  {
    what: 'a listener of the check on the engine port',
    situation: 3,
    expect: 'down',
    holdEnginePort: true,
    service: 'engine',
    async options(take) {
      const port = await take();
      return { options: { situation: 3, enginePort: port }, port };
    },
  },
];

const CASES_OF: Record<Platform, Case[]> = { desktop: CASES, linux: LINUX_CASES };

/** Health on the engine port answered at any time within the bound: the first answer, or `null`. */
async function healthWithinBound(enginePort: number): Promise<HealthResult | null> {
  const first = await waitFor(UP_BOUND_MS, async () => {
    const result = await health(enginePort);
    return 'status' in result ? result : undefined;
  });
  return first ?? null;
}

/** The services `docker compose ps -a --format json` shows for the form, with their state. */
async function composeServices(form: Form): Promise<{
  services: { service: string; state: string }[];
  result: CommandResult;
}> {
  const result = await form.run(form.compose('ps', '-a', '--format', 'json'), STOP_BOUND_MS);
  const text = result.stdout.trim();
  let rows: { Service?: string; State?: string }[] = [];
  try {
    rows = text.startsWith('[')
      ? (JSON.parse(text) as typeof rows)
      : text
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => JSON.parse(line) as { Service?: string; State?: string });
  } catch {
    rows = [];
  }
  return {
    services: rows.map((r) => ({
      service: r.Service ?? '',
      state: r.State ?? '',
    })),
    result,
  };
}

/** The form does not come up, with `port`'s number: the three observables of the header. */
async function expectDoesNotComeUp(ctx: Ctx, form: Form, port: number, what: string) {
  const answered = await healthWithinBound(form.enginePort);
  expect(
    answered ? shownHealth(answered) : null,
    `${what}: an answer to GET /__emuforge/health within ${String(UP_BOUND_MS / 1000)}s`,
  ).toBeNull();

  const ps = await composeServices(form);
  ctx.log(`${what}: docker compose ps: ${JSON.stringify(ps.services)}`);
  expect(
    ps.services.filter((s) => s.state !== 'running').map((s) => s.service),
    `${what}: services of ${form.project} not running, by docker compose ps (${JSON.stringify(ps.services)}; output:\n${tail(ps.result)})`,
  ).not.toEqual([]);

  const logs = await form.run(form.compose('logs', '--no-color'), STOP_BOUND_MS);
  const lines = `${logs.stdout}\n${logs.stderr}`.split('\n');
  expect(
    lines.filter((line) => namesPort(line, port) && ERROR_WORDS.test(line)),
    `${what}: error lines with ${String(port)} in docker compose logs (output:\n${tail(logs)})`,
  ).not.toEqual([]);
}

/**
 * Docker Engine on Linux: the form does not come up, with `port`'s number (the shared term of issue 54's test
 * criteria). `up -d` returns before a process that cannot bind has exited, so `ps -a` and `logs` are read again
 * until both show it, within the bound; then asserted. Health, when the case names it, is not answered within the
 * bound; the one service not running, when the case names it, is that service.
 */
async function expectDoesNotComeUpOnLinux(ctx: Ctx, form: Form, port: number, what: string, c: Case) {
  if (c.health) {
    const answered = await healthWithinBound(form.enginePort);
    expect(
      answered ? shownHealth(answered) : null,
      `${what}: an answer to GET /__emuforge/health within ${String(UP_BOUND_MS / 1000)}s`,
    ).toBeNull();
  }
  let seen = { notRunning: [] as string[], errorLines: [] as string[], ps: '', logs: '' };
  await waitFor(UP_BOUND_MS, async () => {
    const ps = await composeServices(form);
    const logs = await form.run(form.compose('logs', '--no-color'), STOP_BOUND_MS);
    seen = {
      notRunning: ps.services.filter((s) => s.state !== 'running').map((s) => s.service),
      errorLines: `${logs.stdout}\n${logs.stderr}`
        .split('\n')
        .filter((line) => namesPort(line, port) && ERROR_WORDS.test(line)),
      ps: `${JSON.stringify(ps.services)}; output:\n${tail(ps.result)}`,
      logs: tail(logs),
    };
    return seen.notRunning.length > 0 && seen.errorLines.length > 0 ? true : undefined;
  });
  ctx.log(`${what}: not running ${JSON.stringify(seen.notRunning)}`);
  const notRunning = `${what}: services of ${form.project} not running, by docker compose ps -a (${seen.ps})`;
  if (c.service) expect(seen.notRunning, notRunning).toEqual([c.service]);
  else expect(seen.notRunning, notRunning).not.toEqual([]);
  expect(
    seen.errorLines,
    `${what}: error lines with ${String(port)} in docker compose logs (output:\n${seen.logs})`,
  ).not.toEqual([]);
}

test('engine.product-does-not-come-up-on-a-port-collision', async ({ ctx }) => {
  const on = await platform();
  const cases = CASES_OF[on];
  const waits = cases.filter((c) => c.expect !== 'refused').length;
  // Each case: one start, its stop and the cleanup's stop; each "down" case also waits out the health bound (on
  // Docker Engine on Linux, a "down" case may wait out a second bound for ps and logs).
  test.setTimeout(productTimeout(cases.length, 2 * cases.length) + 2 * waits * UP_BOUND_MS);
  const taken: number[] = [];

  for (const c of cases) {
    const what = `situation ${String(c.situation)}, ${c.what}`;
    const { options, port } = await c.options(() => ownFreePort(ctx, taken));
    const form = await Form.create(ctx, options);
    taken.push(form.emulatorPort, form.enginePort, form.studioPort);
    if (c.holdStudioPort) await holdPort(ctx, form.studioPort);
    if (c.holdEnginePort) await holdPort(ctx, form.enginePort);
    ctx.log(`case: ${what}, port ${String(port)}`);

    const started = await form.start();
    if (c.expect === 'down' && on === 'linux') {
      await expectDoesNotComeUpOnLinux(ctx, form, port, what, c);
    } else if (c.expect === 'down') {
      await expectDoesNotComeUp(ctx, form, port, what);
    } else if (c.expect === 'ordinary') {
      expect(started.code, `${what}: ${started.line}: exit code; output:\n${tail(started)}`).toBe(0);
      expect(await waitHealth(form.enginePort, 503), `${what}: GET /__emuforge/health`).toMatchObject({
        status: 503,
        body: { emulator: { reason: 'not_started' } },
      });
      const containers = await form.containers();
      expect(containers.length, `${what}: containers of ${form.project}`).toBeGreaterThan(0);
      expect(
        containers.filter((container) => !container.running).map((container) => container.name),
        `${what}: containers of ${form.project} not running`,
      ).toEqual([]);
    } else {
      expect(started.code, `${what}: ${started.line}: exit code; output:\n${tail(started)}`).not.toBe(0);
      expect(
        namesPort(`${started.stdout}\n${started.stderr}`, port),
        `${what}: the output of ${started.line} names ${String(port)}; output:\n${tail(started)}`,
      ).toBe(true);
    }

    // The stop command of the situation → exits 0; no container and no network of that form is left.
    const stopped = await form.stop();
    expect(stopped.code, `${what}: ${stopped.line}: exit code; output:\n${tail(stopped)}`).toBe(0);
    expect(await form.waitGone(), `${what}: what is left of ${form.project}`).toEqual({ containers: [], networks: [] });
  }
});

/** How long copying the checkout's sources into the scratch directory may take. */
const COPY_BOUND_MS = 60_000;

test('engine.product-start-fails-when-the-image-does-not-build', async ({ ctx }) => {
  test.setTimeout(productTimeout(1, 2) + COPY_BOUND_MS);
  // The Given: a directory under the run's scratch space with a copy of docker-compose.yml and infra/, Studio's
  // sources, and an engine/ without Cargo.toml.
  const dir = path.join(ctx.tmp, `no-build-${ctx.id}-${String(Date.now())}`);
  fs.mkdirSync(dir, { recursive: true });
  ctx.own({
    dispose: async () => fs.rmSync(dir, { recursive: true, force: true }),
  });
  const from = (rel: string) => path.join(ctx.checkout, rel);
  if (fs.existsSync(from('docker-compose.yml')))
    fs.copyFileSync(from('docker-compose.yml'), path.join(dir, 'docker-compose.yml'));
  // The Linux file too, when the checkout has one (issue 54): the start command below is the platform's.
  if (fs.existsSync(from(LINUX_FILE))) fs.copyFileSync(from(LINUX_FILE), path.join(dir, LINUX_FILE));
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

  // An image name of the check's own; the form's ports are free ports, as every form's.
  const image = `${ctx.productImage}-no-build`;
  const form = await Form.create(ctx, { situation: 3 });
  const env = { ...form.env(), EMUFORGE_IMAGE: image };
  const commands = COMMANDS[form.commands][3];
  ctx.own({
    async dispose() {
      const stop = await runAt(ctx, dir, commands.stop, env, STOP_BOUND_MS).catch((e: Error) => e.message);
      ctx.log(`cleanup: ${typeof stop === 'string' ? stop : `${stop.line}: exit ${String(stop.code)}`}`);
      await docker(['image', 'rm', image]);
    },
  });

  // The situation 3 start command in that directory → exits non-zero, its output holds the failed build step's
  // output (which names the missing Cargo.toml).
  const started = await runAt(ctx, dir, commands.start, env, START_BOUND_MS);
  const output = `${started.stdout}\n${started.stderr}`;
  expect(started.code, `${started.line} in ${dir}: exit code; output:\n${tail(started)}`).not.toBe(0);
  expect(
    output.split('\n').filter((line) => line.includes('Cargo.toml') && /error|fail|not found|could not/i.test(line)),
    `${started.line}: lines of the failed build step naming Cargo.toml; output:\n${tail(started)}`,
  ).not.toEqual([]);

  // No container, no network of that form, and no image of that name.
  expect(
    (await form.containers()).map((c) => c.name),
    `containers of ${form.project}`,
  ).toEqual([]);
  expect(await form.networks(), `networks of ${form.project}`).toEqual([]);
  const images = await docker(['images', '-q', image]);
  expect(images.stdout, `images named ${image}`).toBe('');
});
