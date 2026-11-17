// The product form of issue 34: EmuForge built into an image and started by Docker Compose from the checkout's root
// (requirement section 1), on Docker Desktop and, by issue 54, on Docker Engine on Linux. This file is the one place
// the product checks take their command lines from: the plain commands of both platforms (`COMMANDS`), the two
// preparatory lines of Docker Engine on Linux (`PREPARATORY_LINES`) and the wrapper's lines (`WRAPPER`);
// `engine.product-readme-gives-the-commands-the-checks-run` compares the README with them (#34 R20, #54 R16).
//
// The platform (`platform()`) is decided once, by the wrapper's own rule: Docker Engine on Linux when this process
// runs on Linux and `docker info --format '{{.OperatingSystem}}'` does not print `Docker Desktop`; Docker Desktop
// otherwise. No check takes it from a variable.
//
// A check's form (`Form`) runs on free loopback ports of its own, under the run's own image names
// (`EMUFORGE_IMAGE`, `EMUFORGE_EMULATOR_IMAGE`, set by `run`), with an environment of exactly: `HOME`, a `PATH` on
// which `cargo`, `rustc`, `bun` and `node` are not found (R1), the three ports and the two image names, and on
// Docker Engine on Linux `EMUFORGE_UID` and `EMUFORGE_GID` as the preparatory lines set them. The Docker client's
// own settings (`DOCKER_CONFIG`, `DOCKER_HOST`, `DOCKER_CONTEXT`) are passed on when the run has them, so the
// command talks to the same daemon the support inspects; a form with a fresh `HOME` keeps `DOCKER_CONFIG` at the
// run's own, where the Compose plugin and the Docker context live (`probe/fresh-home.log`).
//
// On Docker Engine on Linux a form started with the plain commands has the preparatory lines done first, in its own
// `HOME`, as the user running the check: the support runs their text in `/bin/sh` and takes the two ids from what
// the shell set (#54 R16). On Docker Desktop they are not done.
//
// The form's containers and networks are those that carry its Compose project's label. The project is
// `emuforge-app-<studio port>` (design D6). `dispose` runs the situation 4 stop command, which removes the form
// whether it was started with the profile or not, then removes by label whatever is still there, and the emulator
// directory of a situation 4 form whose port the form chose itself.

import { execFile } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { EnvError, expect, type Ctx } from './check';
import { emulatorDir, type EmulatorFiles } from './emulator';
import { freePortExcept, probe } from './net';
import { Proc } from './process';
import { HEALTH_PATH } from './traffic';
import { waitFor } from './wait';

/** A situation of the README's "Start" part that the product form covers (requirement section 1). */
export type Situation = 3 | 4;

/** The platform of the run (shared terms of #54's test criteria). */
export type Platform = 'desktop' | 'linux';

/** The second Compose file, the host form of Docker Engine on Linux (#54 requirement section 1). */
export const LINUX_FILE = 'docker-compose.linux.yml';

const LINUX_ARGS = ['-f', LINUX_FILE];

/** The plain start and stop command lines of each platform and situation, as argument arrays, run at the root. */
export const COMMANDS: Record<Platform, Record<Situation, { start: string[]; stop: string[] }>> = {
  desktop: {
    3: {
      start: ['docker', 'compose', 'up', '-d', '--build'],
      stop: ['docker', 'compose', 'down'],
    },
    4: {
      start: ['docker', 'compose', '--profile', 'emulator', 'up', '-d', '--build'],
      stop: ['docker', 'compose', '--profile', 'emulator', 'down'],
    },
  },
  linux: {
    3: {
      start: ['docker', 'compose', ...LINUX_ARGS, 'up', '-d', '--build'],
      stop: ['docker', 'compose', ...LINUX_ARGS, 'down'],
    },
    4: {
      start: ['docker', 'compose', ...LINUX_ARGS, '--profile', 'emulator', 'up', '-d', '--build'],
      stop: ['docker', 'compose', ...LINUX_ARGS, '--profile', 'emulator', 'down'],
    },
  },
};

/**
 * The two lines that go before the plain commands on Docker Engine on Linux (#54 R16), as text: the README holds
 * them exactly so, and the support runs exactly this text.
 */
export const PREPARATORY_LINES = ['mkdir -p ~/.aws/emulator', 'export EMUFORGE_UID="$(id -u)" EMUFORGE_GID="$(id -g)"'];

/** The wrapper's lines, as argument arrays, run at the checkout's root (#54 R9, R14). */
export const WRAPPER = {
  up: ['./compose', 'up'],
  down: ['./compose', 'down'],
  ps: ['./compose', 'ps', '-a'],
  logs: ['./compose', 'logs'],
};

/** A command line as the README writes it: the arguments joined by one space. */
export function commandLine(args: string[]): string {
  return args.join(' ');
}

/** Every command line of the one place: the plain commands of both platforms and the wrapper's lines. */
export function onePlaceLines(): string[] {
  const out: string[] = [];
  for (const byPlatform of Object.values(COMMANDS)) {
    for (const { start, stop } of Object.values(byPlatform)) out.push(commandLine(start), commandLine(stop));
  }
  out.push(...Object.values(WRAPPER).map(commandLine));
  return out;
}

/**
 * `docker compose` with the options the platform's situation start command puts before `up` (the platform's file,
 * and for situation 4 `--profile emulator`), then `rest`: the same file and profile for `ps`, `logs` or `config`.
 */
export function composeArgs(on: Platform, situation: Situation, ...rest: string[]): string[] {
  const start = COMMANDS[on][situation].start;
  return [...start.slice(0, start.indexOf('up')), ...rest];
}

let decided: Promise<Platform> | undefined;

/** The platform of the run, decided once by the wrapper's rule (this file's header). */
export function platform(): Promise<Platform> {
  decided ??= (async (): Promise<Platform> => {
    if (os.platform() !== 'linux') return 'desktop';
    const name = await dockerRead(['info', '--format', '{{.OperatingSystem}}']);
    return name === 'Docker Desktop' ? 'desktop' : 'linux';
  })();
  return decided;
}

/** The user's ids: what `id -u` and `id -g` print. */
export interface UserIds {
  uid: string;
  gid: string;
}

let users: Promise<UserIds> | undefined;

/** The ids of the user running the check, from `id -u` and `id -g`. */
export function userIds(): Promise<UserIds> {
  const id = (flag: string) =>
    new Promise<string>((resolve, reject) => {
      execFile('id', [flag], { encoding: 'utf8' }, (error, stdout) => {
        if (error) reject(new EnvError(`id ${flag}: ${error.message}`));
        else resolve(stdout.trim());
      });
    });
  users ??= (async () => ({ uid: await id('-u'), gid: await id('-g') }))();
  return users;
}

/**
 * Does the preparatory lines in `home`: their text in `/bin/sh` with that `HOME`, as the user running the check,
 * then the two variables as the shell set them. `EnvError` when the shell fails or sets anything but two numbers.
 */
export async function prepare(ctx: Ctx, home: string): Promise<UserIds> {
  const script = [...PREPARATORY_LINES, 'printf \'%s %s\\n\' "$EMUFORGE_UID" "$EMUFORGE_GID"'].join(' && ');
  const proc = Proc.spawn(ctx, 'the preparatory lines', '/bin/sh', ['-c', script], ctx.checkout, {
    HOME: home,
    PATH: '/usr/bin:/bin',
  });
  const exit = await proc.waitExit(10_000);
  const { stdout, stderr } = await proc.stop();
  const [uid, gid] = stdout.trim().split(' ');
  if (exit?.code !== 0 || !/^\d+$/.test(uid ?? '') || !/^\d+$/.test(gid ?? '')) {
    throw new EnvError(`the preparatory lines in ${home}: exit ${String(exit?.code)}, ${stdout.trim()} ${stderr.trim()}`);
  }
  ctx.log(`the preparatory lines in ${home}: EMUFORGE_UID=${uid} EMUFORGE_GID=${gid}`);
  return { uid, gid };
}

/** The files an emulator writes into `~/.aws/emulator/<port>/` (requirement section 2). */
export const EMULATOR_FILES = ['ca.pem', 'config', 'emulator_credentials', 'truststore.p12'];

/** The tools the start command must not need on the host (R1). */
const HOST_TOOLS = ['cargo', 'rustc', 'bun', 'node'];

/** How long a start command may take: the run built the image, so `--build` is a cache hit. */
export const START_BOUND_MS = 300_000;

/** How long a stop command may take: Compose's own stop timeout is 10 s per container. */
export const STOP_BOUND_MS = 60_000;

/** How long a started form may take to answer on its ports. */
export const UP_BOUND_MS = 30_000;

/** Studio's home checks every 5 seconds, so a change shows within two of them (as `home.spec.ts`). */
export const CHANGE_BOUND_MS = 10_000;

/** How long a stopped form's published port may take to refuse connections (Docker's forwarder lets go). */
const RELEASE_BOUND_MS = 10_000;

/**
 * A test timeout for a product check that runs `starts` start commands and `stops` stop commands (its cleanup
 * included), plus two minutes for its waits, browser and emulators. Playwright's 180 s default is too short for a
 * form's start and stop; each product spec file sets its own.
 */
export function productTimeout(starts: number, stops: number): number {
  return starts * START_BOUND_MS + stops * STOP_BOUND_MS + 120_000;
}

/** What a command gave: its exit code (`null` when killed by a signal) and its output, both streams together. */
export interface CommandResult {
  line: string;
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The output of a command for an assertion message, its last 4000 characters. */
export function tail(result: CommandResult): string {
  const all = `${result.stdout}\n${result.stderr}`.trim();
  return all.length > 4000 ? `…${all.slice(-4000)}` : all;
}

let restrictedPath: string | undefined;

/**
 * A `PATH` for the start command: a directory of the run's scratch space holding links to `docker` and the
 * `docker-credential-*` helpers found on the run's `PATH`, then `/usr/bin:/bin:/usr/sbin:/sbin`. `EnvError` when
 * `docker` is not found, or when `cargo`, `rustc`, `bun` or `node` would still be found on it.
 */
export function productPath(ctx: Ctx): string {
  if (restrictedPath) return restrictedPath;
  const bin = path.join(ctx.tmp, 'product-path');
  fs.rmSync(bin, { recursive: true, force: true });
  fs.mkdirSync(bin, { recursive: true });
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '' || !fs.existsSync(dir)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name !== 'docker' && !name.startsWith('docker-credential-')) continue;
      const link = path.join(bin, name);
      if (!fs.existsSync(link)) fs.symlinkSync(path.join(dir, name), link);
    }
  }
  if (!fs.existsSync(path.join(bin, 'docker'))) throw new EnvError('docker is not on the run PATH');
  const value = [bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  for (const dir of value.split(':')) {
    for (const tool of HOST_TOOLS) {
      if (fs.existsSync(path.join(dir, tool))) {
        throw new EnvError(`${tool} is found in ${dir}, so a PATH without it cannot be made`);
      }
    }
  }
  ctx.log(`the start command's PATH: ${value}`);
  restrictedPath = value;
  return value;
}

/** `docker <args>`: the output, or the error with Docker's message. */
function dockerOut(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout.trim(), stderr: (stderr || error?.message || '').trim() });
    });
  });
}

/** `docker <args>` the check needs to observe: `EnvError` when Docker does not answer. */
export async function dockerRead(args: string[]): Promise<string> {
  const out = await dockerOut(args);
  if (!out.ok) throw new EnvError(`docker ${args.join(' ')}: ${out.stderr}`);
  return out.stdout;
}

/** One container as a check compares it: who it is, when it started, and whether it runs. */
export interface ContainerState {
  id: string;
  name: string;
  /** Its Compose service, `''` for a container that has none. */
  service: string;
  startedAt: string;
  running: boolean;
}

/**
 * Inspects containers by id or name; a container that is gone by then is left out (Docker inspects the others and
 * names the missing one on stderr).
 */
export async function inspectContainers(refs: string[]): Promise<ContainerState[]> {
  if (refs.length === 0) return [];
  const format =
    '{{.Id}}\t{{.Name}}\t{{index .Config.Labels "com.docker.compose.service"}}\t{{.State.StartedAt}}\t{{.State.Running}}';
  const out = await dockerOut(['inspect', '-f', format, ...refs]);
  return out.stdout
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [id, name, service, startedAt, running] = line.split('\t');
      return { id, name: name.replace(/^\//, ''), service, startedAt, running: running === 'true' };
    });
}

/** The id and start time of each container, sorted by id: what "nothing was restarted" compares. */
export function identities(containers: ContainerState[]): { id: string; startedAt: string }[] {
  return containers.map((c) => ({ id: c.id, startedAt: c.startedAt })).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every running container on the machine that publishes host port `port` (`NetworkSettings.Ports`). A container
 * that only declares the port and was never started (Compose creates one before Docker refuses its publish)
 * publishes nothing and is not counted. Read-only.
 */
export async function containersPublishing(port: number): Promise<ContainerState[]> {
  const running = (await dockerRead(['ps', '-q', '--no-trunc'])).split('\n').filter((id) => id !== '');
  if (running.length === 0) return [];
  const format = '{{.Id}}\t{{json .NetworkSettings.Ports}}';
  const out = await dockerOut(['inspect', '-f', format, ...running]);
  const ids: string[] = [];
  for (const line of out.stdout.split('\n')) {
    const [id, published] = line.split('\t');
    if (!id || published === undefined) continue;
    if (bindings(published).some((b) => b.hostPort === String(port))) ids.push(id);
  }
  return (await inspectContainers(ids)).filter((c) => c.running);
}

/** A host binding of a published port. */
export interface Binding {
  containerPort: string;
  hostIp: string;
  hostPort: string;
}

/** The bindings of a `PortBindings` or `NetworkSettings.Ports` JSON value. */
export function bindings(json: string): Binding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const out: Binding[] = [];
  for (const [containerPort, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    for (const b of list as { HostIp?: string; HostPort?: string }[]) {
      out.push({ containerPort, hostIp: b.HostIp ?? '', hostPort: b.HostPort ?? '' });
    }
  }
  return out;
}

/** The id and start time of a container the check started itself (a user's emulator), for R6. */
export async function containerIdentity(name: string): Promise<{ id: string; startedAt: string; running: boolean }> {
  const [found] = await inspectContainers([name]);
  if (!found) throw new EnvError(`container ${name} does not exist`);
  return { id: found.id, startedAt: found.startedAt, running: found.running };
}

/** An HTTP answer as a check reads it. */
export interface HttpAnswer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** `method http://127.0.0.1:<port><path>` with `headers`, no proxy, no keep-alive; the answer or the error. */
export function request(
  port: number,
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body: Buffer = Buffer.alloc(0),
  timeoutMs = 10_000,
): Promise<HttpAnswer | { error: string }> {
  return new Promise((resolve) => {
    const sent: Record<string, string> = { host: `127.0.0.1:${String(port)}`, ...headers };
    if (body.length > 0) sent['content-length'] = String(body.length);
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers: sent, agent: false, timeout: timeoutMs },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }),
        );
        response.on('error', (e) => resolve({ error: e.message }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`no answer from 127.0.0.1:${String(port)} within ${timeoutMs} ms`)));
    req.on('error', (e) => resolve({ error: e.message }));
    req.end(body.length > 0 ? body : undefined);
  });
}

/** The engine's health answer: status and parsed body (`null` when it is not JSON), or the error. */
export type HealthResult = { status: number; body: { emulator?: Record<string, unknown> } | null } | { error: string };

/** `GET /__emuforge/health` on the engine port with the address's own `Host`. */
export async function health(enginePort: number): Promise<HealthResult> {
  const answer = await request(enginePort, 'GET', HEALTH_PATH);
  if ('error' in answer) return answer;
  let body: { emulator?: Record<string, unknown> } | null = null;
  try {
    body = JSON.parse(answer.body.toString('utf8')) as { emulator?: Record<string, unknown> };
  } catch {
    body = null;
  }
  return { status: answer.status, body };
}

/** A health result for a log line or an assertion message. */
export function shownHealth(result: HealthResult | undefined): string {
  if (!result) return 'no answer';
  if ('error' in result) return `error ${result.error}`;
  return `${String(result.status)} ${JSON.stringify(result.body)}`;
}

/** Waits, at most `boundMs`, until health answers `status`; returns the last answer either way. */
export async function waitHealth(enginePort: number, status: number, boundMs = UP_BOUND_MS): Promise<HealthResult> {
  let last = { error: 'not asked' } as HealthResult;
  await waitFor(boundMs, async () => {
    last = await health(enginePort);
    return 'status' in last && last.status === status ? true : undefined;
  });
  return last;
}

/** Waits, at most `boundMs`, until `GET <path>` on `port` gets any HTTP answer; the last answer or error. */
export async function waitAnswer(
  port: number,
  pathname: string,
  boundMs = UP_BOUND_MS,
): Promise<HttpAnswer | { error: string }> {
  let last = { error: 'not asked' } as HttpAnswer | { error: string };
  await waitFor(boundMs, async () => {
    last = await request(port, 'GET', pathname);
    return 'status' in last ? true : undefined;
  });
  return last;
}

/** Waits, at most the bound, until `127.0.0.1:<port>` refuses connections; the last probe result. */
export async function waitRefused(port: number): Promise<string> {
  let last = '';
  await waitFor(RELEASE_BOUND_MS, async () => {
    last = await probe(port);
    return last === 'refused' ? true : undefined;
  });
  return last;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * An S3 request over plain HTTP to `127.0.0.1:<port>` (the form's engine port), header-signed with the emulator's
 * key `key` over `host`, `x-amz-content-sha256`, `x-amz-date` and the `extra` headers, as the suite's transparency
 * checks sign (path style: `/`, `/<bucket>`, `/<bucket>/<key>`).
 */
export function signedS3(
  port: number,
  key: EmulatorFiles,
  method: string,
  pathname: string,
  body: Buffer = Buffer.alloc(0),
  extra: Record<string, string> = {},
): Promise<HttpAnswer | { error: string }> {
  const region = 'us-east-1';
  const amzDate = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = {
    host: `127.0.0.1:${String(port)}`,
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
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${key.secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const sent: Record<string, string> = { ...headers };
  sent.authorization =
    `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, ` +
    `Signature=${signature}`;
  return request(port, method, pathname, sent, body, 30_000);
}

/** The text content of every `<name>` element of an XML body. */
export function xmlElements(body: Buffer, name: string): string[] {
  return [...body.toString('utf8').matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, 'g'))].map((m) => m[1]);
}

export interface FormOptions {
  situation: Situation;
  /** Default: a free port, never the run's; a situation 4 form then owns that port's emulator directory. */
  emulatorPort?: number;
  enginePort?: number;
  studioPort?: number;
  /** `HOME` of the command; default the run's. */
  home?: string;
  /** Whose plain commands start and stop the form; default the run's platform. */
  commands?: Platform;
  /**
   * Whether the preparatory lines are done when the run is on Docker Engine on Linux and the form takes the Linux
   * commands; default true. On Docker Desktop they are never done.
   */
  prepared?: boolean;
}

/** Ports the forms of this process chose, so two forms of one check never get the same one. */
const picked: number[] = [];

/**
 * The refusal lines the check's refusing proxy (`refuse.ts`) wrote to its log so far: browser requests to anything
 * but a loopback address.
 */
export function refusedBrowserRequests(ctx: Ctx): string[] {
  const logPath = path.join(ctx.logs, `${ctx.id}.log`);
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .map((line) => line.replace(/^\[\s*[\d.]+s\] /, ''))
    .filter((line) => line.startsWith('refused browser request to '));
}

/** One product form a check started on free ports of its own. */
export class Form {
  readonly situation: Situation;
  readonly emulatorPort: number;
  readonly enginePort: number;
  readonly studioPort: number;
  readonly home: string;
  /** Whose plain commands the form takes. */
  readonly commands: Platform;
  /** The ids the preparatory lines set, `null` when they were not done. */
  readonly ids: UserIds | null;
  private readonly ownsEmulatorDir: boolean;

  private constructor(
    private readonly ctx: Ctx,
    options: Required<Omit<FormOptions, 'prepared'>>,
    ids: UserIds | null,
    ownsEmulatorDir: boolean,
  ) {
    this.situation = options.situation;
    this.commands = options.commands;
    this.ids = ids;
    this.emulatorPort = options.emulatorPort;
    this.enginePort = options.enginePort;
    this.studioPort = options.studioPort;
    this.home = options.home;
    this.ownsEmulatorDir = ownsEmulatorDir;
  }

  /**
   * A form on free ports (those not given), owned by the check: it is stopped and removed when the check ends.
   * Nothing is started yet. `EnvError` when the run did not name its images.
   */
  static async create(ctx: Ctx, options: FormOptions): Promise<Form> {
    if (!ctx.productImage || !ctx.emulatorImage) {
      throw new EnvError(
        'EMUFORGE_IT_PRODUCT_IMAGE and EMUFORGE_IT_EMULATOR_IMAGE are not set; run the suite with tests/integration/run',
      );
    }
    // The run's ports, the defaults (the owner's form and emulator), and every port a form of this process took.
    const taken = [ctx.emulatorPort, ctx.enginePort, ctx.studioPort, 9297, 8296, 8297, ...picked];
    if (options.emulatorPort !== undefined) taken.push(options.emulatorPort);
    if (options.enginePort !== undefined) taken.push(options.enginePort);
    if (options.studioPort !== undefined) taken.push(options.studioPort);
    const pick = async () => {
      const port = await freePortExcept(ctx.home, taken);
      taken.push(port);
      picked.push(port);
      return port;
    };
    const emulatorPort = options.emulatorPort ?? (await pick());
    const enginePort = options.enginePort ?? (await pick());
    const studioPort = options.studioPort ?? (await pick());
    const home = options.home ?? ctx.home;
    const on = await platform();
    const commands = options.commands ?? on;
    const ids = on === 'linux' && commands === 'linux' && options.prepared !== false ? await prepare(ctx, home) : null;
    const form = new Form(
      ctx,
      { situation: options.situation, emulatorPort, enginePort, studioPort, home, commands },
      ids,
      options.emulatorPort === undefined && options.situation === 4,
    );
    ctx.own(form);
    // `run` removes, at its end, what a killed check left of the projects listed here.
    fs.mkdirSync(ctx.tmp, { recursive: true });
    fs.appendFileSync(path.join(ctx.tmp, 'product-projects'), `${form.project}\n`);
    ctx.log(
      `form ${form.project}: ${commands} commands, situation ${options.situation}, emulator port ${emulatorPort}, engine port ${enginePort}, studio port ${studioPort}, HOME ${form.home}`,
    );
    return form;
  }

  /** The form's Compose project (design D6). */
  get project(): string {
    return `emuforge-app-${String(this.studioPort)}`;
  }

  get studioUrl(): string {
    return `http://127.0.0.1:${String(this.studioPort)}/`;
  }

  /** The environment of the form's commands: exactly the variables the header of this file names. */
  env(): Record<string, string> {
    const env: Record<string, string> = {
      HOME: this.home,
      PATH: productPath(this.ctx),
      EMULATOR_PORT: String(this.emulatorPort),
      EMUFORGE_ENGINE_PORT: String(this.enginePort),
      EMUFORGE_STUDIO_PORT: String(this.studioPort),
      EMUFORGE_IMAGE: this.ctx.productImage,
      EMUFORGE_EMULATOR_IMAGE: this.ctx.emulatorImage,
    };
    if (this.ids) {
      env.EMUFORGE_UID = this.ids.uid;
      env.EMUFORGE_GID = this.ids.gid;
    }
    for (const name of ['DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT']) {
      const value = process.env[name];
      if (value) env[name] = value;
    }
    if (this.home !== this.ctx.home && !env.DOCKER_CONFIG) env.DOCKER_CONFIG = path.join(this.ctx.home, '.docker');
    return env;
  }

  /**
   * Runs `args` at the checkout's root with `env` (default the form's environment) and waits for its exit within
   * `boundMs`.
   */
  async run(args: string[], boundMs: number, env: Record<string, string> = this.env()): Promise<CommandResult> {
    const line = commandLine(args);
    const proc = Proc.spawn(this.ctx, line, args[0], args.slice(1), this.ctx.checkout, env);
    const exit = await proc.waitExit(boundMs);
    const { stdout, stderr } = await proc.stop();
    if (!exit) throw new Error(`${line} did not exit within ${boundMs / 1000}s`);
    this.ctx.log(`${line}: exit ${String(exit.code)}${exit.signal ? ` signal ${exit.signal}` : ''}`);
    return { line, code: exit.code, stdout, stderr };
  }

  /** The start command of the form's situation. */
  start(): Promise<CommandResult> {
    return this.run(COMMANDS[this.commands][this.situation].start, START_BOUND_MS);
  }

  /** The stop command of `situation` (default the form's). */
  stop(situation: Situation = this.situation): Promise<CommandResult> {
    return this.run(COMMANDS[this.commands][situation].stop, STOP_BOUND_MS);
  }

  /** `docker compose` with the file and profile of the form's start command, then `rest` (`ps`, `logs`). */
  compose(...rest: string[]): string[] {
    return composeArgs(this.commands, this.situation, ...rest);
  }

  /** The form's containers: those that carry its project's label, running or not. */
  async containers(): Promise<ContainerState[]> {
    const ids = (
      await dockerRead(['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${this.project}`])
    )
      .split('\n')
      .filter((id) => id !== '');
    return inspectContainers(ids);
  }

  /** The names of the form's networks: those that carry its project's label. */
  async networks(): Promise<string[]> {
    return (
      await dockerRead([
        'network',
        'ls',
        '--format',
        '{{.Name}}',
        '--filter',
        `label=com.docker.compose.project=${this.project}`,
      ])
    )
      .split('\n')
      .filter((name) => name !== '');
  }

  /** The form's container of `service`; fails the check when there is none. */
  async container(service: string): Promise<ContainerState> {
    const found = (await this.containers()).filter((c) => c.service === service);
    expect(
      found.map((c) => c.name),
      `the containers of service ${service} of ${this.project}`,
    ).toHaveLength(1);
    return found[0];
  }

  /** Waits, at most the bound, until the form has no container and no network; what is left either way. */
  async waitGone(): Promise<{ containers: string[]; networks: string[] }> {
    let left = { containers: [] as string[], networks: [] as string[] };
    await waitFor(RELEASE_BOUND_MS, async () => {
      left = { containers: (await this.containers()).map((c) => c.name), networks: await this.networks() };
      return left.containers.length === 0 && left.networks.length === 0 ? true : undefined;
    });
    return left;
  }

  async dispose(): Promise<void> {
    if ((await this.containers()).length > 0 || (await this.networks()).length > 0) {
      try {
        await this.stop(4);
      } catch (e) {
        this.ctx.log(`cleanup: ${(e as Error).message}`);
      }
    }
    const ids = (await this.containers()).map((c) => c.id);
    if (ids.length > 0) await dockerOut(['rm', '-f', ...ids]);
    const networks = await this.networks();
    if (networks.length > 0) await dockerOut(['network', 'rm', ...networks]);
    if (this.ownsEmulatorDir) {
      const dir = emulatorDir(this.home, this.emulatorPort);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
