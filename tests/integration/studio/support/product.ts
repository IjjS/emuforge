// The product form (issues 34 and 437): EmuForge built into an image and started by Docker Compose from the
// checkout's root, with an emulator of its own, the same on every platform and in every shell. This file is the one
// place the product checks take their command lines from (`LINES`): the start line, the stop line, the line that
// shows the emulator's log, the line that removes the volume too, the line that shows the containers' states (#484),
// and the start line that keeps the running containers. `engine.product-readme-gives-the-commands-the-checks-run` compares the README with them (#437 R16).
//
// A check's form (`Form`) runs on free loopback ports of its own, under the run's own image names
// (`EMUFORGE_IMAGE`, `EMUFORGE_EMULATOR_IMAGE`, set by `run`), with an environment of exactly: `HOME` (the run's,
// another folder, or none at all), a `PATH` on which `cargo`, `rustc`, `bun` and `node` are not found, the three
// ports and the two image names, and the variables a form of the checks' own needs (below). The Docker client's own
// settings (`DOCKER_CONFIG`, `DOCKER_HOST`, `DOCKER_CONTEXT`) are passed on when the run has them, so the command
// talks to the same daemon the support inspects; a form with another `HOME`, or none, keeps `DOCKER_CONFIG` at the
// run's own, where the Compose plugin and the Docker context live.
//
// The checks' own means (#437 design section 6), never part of the shipped form:
// - `product-direct.yml`, given beside the root file, publishes the form's emulator port on a loopback port of the
//   run (`EMUFORGE_IT_DIRECT_PORT`), so a check can send the same request directly. The emulator's key and `ca.pem`
//   are read inside its container (`Form.emulatorFiles`) into memory, registered for redaction, never written or
//   printed.
// - `product-deaf.yml`, given beside the root file, starts the emulator on another port (`EMUFORGE_IT_DEAF_PORT`)
//   than the one its healthcheck asks (`EMULATOR_PORT`).
//
// The form's containers, networks and volumes are those that carry its Compose project's label. The project is
// `emuforge-app-<studio port>`. `dispose` runs the line that removes the volume too, with the form's files, then
// removes by label whatever is still there.

import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { EnvError, expect, type Ctx } from './check';
import type { EmulatorFiles } from './emulator';
import { freePortExcept, probe } from './net';
import { Proc } from './process';
import { register } from './secrets';
import { HEALTH_PATH } from './traffic';
import { waitFor } from './wait';

/**
 * The command lines of the one form, as argument arrays, run at the checkout's root (#437 R9, R10, R5, T10; #484 R10:
 * the line that shows the emulator's container not running or not healthy).
 */
export const LINES = {
  start: ['docker', 'compose', 'up', '-d', '--build'],
  stop: ['docker', 'compose', 'down'],
  emulatorLogs: ['docker', 'compose', 'logs', 'aws-emulator'],
  removeVolume: ['docker', 'compose', 'down', '-v'],
  status: ['docker', 'compose', 'ps', '-a'],
};

/** The variable that keeps the running containers on a second start line (#437 requirement T10). */
export const KEEP_VARIABLE = 'BUILDX_NO_DEFAULT_ATTESTATIONS';

/** The start line that keeps the running containers, as the README writes it. */
export const KEEP_START_LINE = `${KEEP_VARIABLE}=1 ${LINES.start.join(' ')}`;

/** A command line as the README writes it: the arguments joined by one space. */
export function commandLine(args: string[]): string {
  return args.join(' ');
}

/** Every `docker compose` line of the README's "Start" as text, each one a line the product checks run. */
export function startLines(): string[] {
  return [...Object.values(LINES).map(commandLine), KEEP_START_LINE];
}

/** The services of the one form (#484 R8): EmuForge's one process and the form's emulator. */
export const SERVICES = ['emuforge', 'aws-emulator'];

/** The checks' own Compose files, beside this file, as the checkout's relative paths. */
export const CHECK_FILES = {
  direct: 'tests/integration/studio/support/product-direct.yml',
  deaf: 'tests/integration/studio/support/product-deaf.yml',
};

export type CheckFile = keyof typeof CHECK_FILES;

/** Where the form's emulator keeps its files inside its container (#437 R3). */
export const EMULATOR_FILES_DIR = '/home/emulator/.aws/emulator';

/** Where `emuforge`'s container mounts the volume, read-only (#437 R3, #484 R8). */
export const ENGINE_FILES_DIR = '/home/emuforge/.aws/emulator';

/** Where `emuforge`'s container mounts the volume `settings`, read-write: the Compose form's settings folder (#485). */
export const ENGINE_SETTINGS_DIR = '/home/emuforge/.config/emuforge-compose';

/** The settings file the engine keeps its targets in (#485). */
export const SETTINGS_FILE = 'targets.json';

/** The files an emulator writes into `<files dir>/<port>/`. */
export const EMULATOR_FILES = ['ca.pem', 'config', 'emulator_credentials', 'truststore.p12'];

/** The tools the start line must not need on the host. */
const HOST_TOOLS = ['cargo', 'rustc', 'bun', 'node'];

/** How long a start line may take: the run built the images, so `--build` is a cache hit. */
export const START_BOUND_MS = 300_000;

/** How long a stop line may take: Compose's own stop timeout is 10 s per container. */
export const STOP_BOUND_MS = 60_000;

/** How long a started form may take to answer on its ports. */
export const UP_BOUND_MS = 30_000;

/** Studio's home checks every 5 seconds, so a change shows within two of them (as `home.spec.ts`). */
export const CHANGE_BOUND_MS = 10_000;

/** How long a stopped form's published port may take to refuse connections (Docker's forwarder lets go). */
const RELEASE_BOUND_MS = 10_000;

/**
 * A test timeout for a product check that runs `starts` start lines and `stops` stop lines (its cleanup included),
 * plus two minutes for its waits, browser and emulators. Playwright's 180 s default is too short for a form's start
 * and stop; each product spec file sets its own.
 */
export function productTimeout(starts: number, stops: number): number {
  return starts * START_BOUND_MS + stops * STOP_BOUND_MS + 120_000;
}

/** What a command gave: its exit code (`null` when killed by a signal), its output, and how long it took. */
export interface CommandResult {
  line: string;
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** The output of a command for an assertion message, its last 4000 characters. */
export function tail(result: CommandResult): string {
  const all = `${result.stdout}\n${result.stderr}`.trim();
  return all.length > 4000 ? `…${all.slice(-4000)}` : all;
}

/** A command's exit code asserted, with its output in the message. */
export function expectExit(result: CommandResult, code: 'zero' | 'non-zero') {
  const message = `${result.line}: exit code; output:\n${tail(result)}`;
  if (code === 'zero') expect(result.code, message).toBe(0);
  else expect(result.code, message).not.toBe(0);
}

let restrictedPath: string | undefined;

/**
 * A `PATH` for the start line: a directory of the run's scratch space holding links to `docker` and the
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
  ctx.log(`the start line's PATH: ${value}`);
  restrictedPath = value;
  return value;
}

/** `docker <args>` with the test process's environment: the output, or the error with Docker's message. */
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

/** `docker inspect -f '{{json <field>}}' <id>`, parsed. */
export async function inspectJson<T>(id: string, field: string): Promise<T> {
  return JSON.parse(await dockerRead(['inspect', '-f', `{{json ${field}}}`, id])) as T;
}

/** One container as a check compares it: who it is, when it started, and whether it runs. */
export interface ContainerState {
  id: string;
  name: string;
  /** Its Compose service, `''` for a container that has none. */
  service: string;
  /** The image it was created from, as named (`.Config.Image`). */
  image: string;
  /** `0001-01-01T00:00:00Z` for a container that was never started. */
  startedAt: string;
  running: boolean;
}

/** Docker's start time of a container that was never started. */
export const NEVER_STARTED = '0001-01-01T00:00:00Z';

/**
 * Inspects containers by id or name; a container that is gone by then is left out (Docker inspects the others and
 * names the missing one on stderr).
 */
export async function inspectContainers(refs: string[]): Promise<ContainerState[]> {
  if (refs.length === 0) return [];
  const format =
    '{{.Id}}\t{{.Name}}\t{{index .Config.Labels "com.docker.compose.service"}}\t{{.Config.Image}}\t{{.State.StartedAt}}\t{{.State.Running}}';
  const out = await dockerOut(['inspect', '-f', format, ...refs]);
  return out.stdout
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [id, name, service, image, startedAt, running] = line.split('\t');
      return { id, name: name.replace(/^\//, ''), service, image, startedAt, running: running === 'true' };
    });
}

/** The id and start time of each container, sorted by id: what "nothing was restarted" compares. */
export function identities(containers: ContainerState[]): { id: string; startedAt: string }[] {
  return containers.map((c) => ({ id: c.id, startedAt: c.startedAt })).sort((a, b) => a.id.localeCompare(b.id));
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

/** What a container publishes: its running bindings and the bindings its configuration asks for. */
export async function publishedBy(id: string): Promise<{ running: Binding[]; configured: Binding[] }> {
  const running = bindings(await dockerRead(['inspect', '-f', '{{json .NetworkSettings.Ports}}', id]));
  const configured = bindings(await dockerRead(['inspect', '-f', '{{json .HostConfig.PortBindings}}', id]));
  return { running, configured };
}

/**
 * Every running container on the machine that publishes host port `port` (`NetworkSettings.Ports`). Read-only.
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

/** The id and start time of a container the check started itself (a user's emulator). */
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

/** Waits, at most `boundMs`, until health says `reachable: <reachable>`; the last answer either way. */
export async function waitReachable(
  enginePort: number,
  reachable: boolean,
  boundMs = UP_BOUND_MS,
): Promise<HealthResult> {
  let last = { error: 'not asked' } as HealthResult;
  await waitFor(boundMs, async () => {
    last = await health(enginePort);
    return 'status' in last && last.body?.emulator?.reachable === reachable ? true : undefined;
  });
  return last;
}

/**
 * The first answer health gives within `boundMs`: the request is repeated only while the connection is refused,
 * reset or closed before an answer (the published port's forwarder is up before the engine listens).
 */
export async function firstHealth(enginePort: number, boundMs = UP_BOUND_MS): Promise<HealthResult> {
  let last = { error: 'not asked' } as HealthResult;
  await waitFor(boundMs, async () => {
    last = await health(enginePort);
    if (!('error' in last)) return true;
    return /ECONNREFUSED|ECONNRESET|socket hang up|EPIPE/.test(last.error) ? undefined : true;
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
 * An S3 request over plain HTTP to `127.0.0.1:<port>` (the form's engine port), header-signed with `key` over
 * `host`, `x-amz-content-sha256`, `x-amz-date` and the `extra` headers, as the suite's transparency checks sign
 * (path style: `/`, `/<bucket>`, `/<bucket>/<key>`).
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

/**
 * A made-up key: an access key id and secret that no emulator issued, new for each call. Its values are not the
 * emulator's and are not redacted; `caLines` is empty.
 */
export function madeUpKey(): EmulatorFiles {
  const id = randomBytes(8).toString('hex').toUpperCase();
  return {
    accessKeyId: `AKIAMADEUP${id.slice(0, 10)}`,
    secretAccessKey: `made-up-${randomBytes(16).toString('hex')}`,
    caLines: [],
  };
}

/** The emulator's files as read inside its container: the key and `ca.pem`, held in memory only. */
export interface FormEmulatorFiles extends EmulatorFiles {
  /** `ca.pem` as read, to verify TLS of a direct request. */
  ca: Buffer;
}

/**
 * The `[default]` access key id and secret of an emulator's credentials file, or `null` when either is missing.
 * Every value is registered for redaction.
 */
export function parseCredentials(text: string): { accessKeyId: string; secretAccessKey: string } | null {
  let section = '';
  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = /^\[(.*)\]$/.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    register([value]);
    if (section === 'default' && name === 'aws_access_key_id') accessKeyId = value;
    if (section === 'default' && name === 'aws_secret_access_key') secretAccessKey = value;
  }
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

/** The base64 lines of every block of a PEM text, trimmed. */
function pemLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('-----'));
}

/** `cat <file>` in container `id`, with the test process's environment; never logged. */
function catIn(id: string, file: string): Promise<{ ok: boolean; data: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['exec', id, 'cat', file],
      { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
      (error, stdout, stderr) => {
        resolve({ ok: !error, data: stdout, stderr: (stderr.toString('utf8') || error?.message || '').trim() });
      },
    );
  });
}

/** A new, empty directory under the run's scratch space, removed when the check ends (after the forms it holds). */
export function freshHome(ctx: Ctx): string {
  const home = path.join(ctx.tmp, `home-${ctx.id}-${String(Date.now())}`);
  fs.mkdirSync(home, { recursive: true });
  ctx.own({ dispose: async () => fs.rmSync(home, { recursive: true, force: true }) });
  return home;
}

/** Every path under `root`, relative and sorted. */
export function entries(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      out.push(path.relative(root, full));
      if (fs.lstatSync(full).isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

export interface FormOptions {
  /** `EMULATOR_PORT`, the emulator's port inside the form; default a free port of the host, never the run's. */
  emulatorPort?: number;
  enginePort?: number;
  studioPort?: number;
  /** `HOME` of the form's commands: default the run's; `null` for an environment without `HOME`. */
  home?: string | null;
  /** More variables of the form's commands (`USERPROFILE`, `BUILDX_NO_DEFAULT_ATTESTATIONS`). */
  env?: Record<string, string>;
  /** The checks' own Compose files given beside the root file. */
  files?: CheckFile[];
  /** Exercise the shipped database publications instead of the ordinary check overlay. */
  developerPorts?: boolean;
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
  readonly emulatorPort: number;
  readonly enginePort: number;
  readonly studioPort: number;
  /** `HOME` of the form's commands, `null` when they run without one. */
  readonly home: string | null;
  /** The loopback port `product-direct.yml` publishes the emulator on, `null` without that file. */
  readonly directPort: number | null;
  /** The port `product-deaf.yml` starts the emulator on, `null` without that file. */
  readonly deafPort: number | null;
  readonly files: CheckFile[];
  private readonly extraEnv: Record<string, string>;

  private constructor(
    private readonly ctx: Ctx,
    ports: {
      emulatorPort: number;
      enginePort: number;
      studioPort: number;
      directPort: number | null;
      deafPort: number | null;
    },
    home: string | null,
    files: CheckFile[],
    extraEnv: Record<string, string>,
    private readonly developerPorts: boolean,
  ) {
    this.emulatorPort = ports.emulatorPort;
    this.enginePort = ports.enginePort;
    this.studioPort = ports.studioPort;
    this.directPort = ports.directPort;
    this.deafPort = ports.deafPort;
    this.home = home;
    this.files = files;
    this.extraEnv = extraEnv;
  }

  /**
   * A form on free ports (those not given), owned by the check: it is stopped and removed, its volume too, when
   * the check ends. Nothing is started yet. `EnvError` when the run did not name its images.
   */
  static async create(ctx: Ctx, options: FormOptions = {}): Promise<Form> {
    if (!ctx.productImage || !ctx.emulatorImage) {
      throw new EnvError(
        'EMUFORGE_IT_PRODUCT_IMAGE and EMUFORGE_IT_EMULATOR_IMAGE are not set; run the suite with tests/integration/run',
      );
    }
    // The run's ports, the defaults (the owner's form and emulator), and every port a form of this process took.
    const taken = [ctx.emulatorPort, ctx.enginePort, ctx.studioPort, 9297, 8296, 8297, ...picked];
    for (const given of [options.emulatorPort, options.enginePort, options.studioPort]) {
      if (given !== undefined) taken.push(given);
    }
    const pick = async () => {
      const port = await freePortExcept(ctx.home, taken);
      taken.push(port);
      picked.push(port);
      return port;
    };
    const files = options.files ?? [];
    const ports = {
      emulatorPort: options.emulatorPort ?? (await pick()),
      enginePort: options.enginePort ?? (await pick()),
      studioPort: options.studioPort ?? (await pick()),
      directPort: files.includes('direct') ? await pick() : null,
      deafPort: files.includes('deaf') ? await pick() : null,
    };
    const home = options.home === undefined ? ctx.home : options.home;
    const form = new Form(ctx, ports, home, files, options.env ?? {}, options.developerPorts ?? false);
    ctx.own(form);
    // `run` removes, at its end, what a killed check left of the projects listed here.
    fs.mkdirSync(ctx.tmp, { recursive: true });
    fs.appendFileSync(path.join(ctx.tmp, 'product-projects'), `${form.project}\n`);
    ctx.log(
      `form ${form.project}: emulator port ${ports.emulatorPort}, engine port ${ports.enginePort}, studio port ${ports.studioPort}, HOME ${home ?? '(none)'}, files ${files.join(' ') || '(root only)'}${ports.directPort ? `, direct port ${ports.directPort}` : ''}${ports.deafPort ? `, deaf port ${ports.deafPort}` : ''}`,
    );
    return form;
  }

  /** The form's Compose project. */
  get project(): string {
    return `emuforge-app-${String(this.studioPort)}`;
  }

  get studioUrl(): string {
    return `http://127.0.0.1:${String(this.studioPort)}/`;
  }

  /** The name Compose gives the emulator's container: no name is set by the file (#437 R13). */
  get emulatorContainerName(): string {
    return `${this.project}-aws-emulator-1`;
  }

  /** The environment of the form's commands: exactly the variables the header of this file names. */
  env(): Record<string, string> {
    const env: Record<string, string> = {
      PATH: productPath(this.ctx),
      COMPOSE_FILE: this.composeFiles().join(path.delimiter),
      EMULATOR_PORT: String(this.emulatorPort),
      EMUFORGE_ENGINE_PORT: String(this.enginePort),
      EMUFORGE_STUDIO_PORT: String(this.studioPort),
      EMUFORGE_IMAGE: this.ctx.productImage,
      EMUFORGE_EMULATOR_IMAGE: this.ctx.emulatorImage,
    };
    if (this.home !== null) env.HOME = this.home;
    if (this.directPort !== null) env.EMUFORGE_IT_DIRECT_PORT = String(this.directPort);
    if (this.deafPort !== null) env.EMUFORGE_IT_DEAF_PORT = String(this.deafPort);
    for (const name of ['DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT']) {
      const value = process.env[name];
      if (value) env[name] = value;
    }
    if (this.home !== this.ctx.home && !env.DOCKER_CONFIG) env.DOCKER_CONFIG = path.join(this.ctx.home, '.docker');
    return { ...env, ...this.extraEnv };
  }

  private composeFiles(): string[] {
    const controls = path.join(this.ctx.checkout, 'tests/integration/studio/support/product-controls.yml');
    return ['docker-compose.yml', ...(this.developerPorts ? [] : [controls]), ...this.files.map((f) => CHECK_FILES[f])];
  }

  /** `line` with the form's own Compose files: `-f docker-compose.yml -f <file>…` after `docker compose`. */
  withFiles(line: string[]): string[] {
    if (this.files.length === 0) return [...line];
    const files = this.composeFiles().flatMap((f) => ['-f', f]);
    return [line[0], line[1], ...files, ...line.slice(2)];
  }

  /** `docker compose` with the form's files, then `rest`. */
  compose(...rest: string[]): string[] {
    return this.withFiles(['docker', 'compose', ...rest]);
  }

  /**
   * Runs `args` at the checkout's root with `env` (default the form's environment) and waits for its exit within
   * `boundMs`.
   */
  async run(args: string[], boundMs: number, env: Record<string, string> = this.env()): Promise<CommandResult> {
    const line = commandLine(args);
    const began = Date.now();
    const proc = Proc.spawn(this.ctx, line, args[0], args.slice(1), this.ctx.checkout, env);
    const exit = await proc.waitExit(boundMs);
    const { stdout, stderr } = await proc.stop();
    const ms = Date.now() - began;
    if (!exit) throw new Error(`${line} did not exit within ${boundMs / 1000}s`);
    this.ctx.log(`${line}: exit ${String(exit.code)}${exit.signal ? ` signal ${exit.signal}` : ''} after ${ms} ms`);
    return { line, code: exit.code, stdout, stderr, ms };
  }

  /** The start line. */
  start(): Promise<CommandResult> {
    return this.run(this.withFiles(LINES.start), START_BOUND_MS);
  }

  /** The stop line. */
  stop(): Promise<CommandResult> {
    return this.run(this.withFiles(LINES.stop), STOP_BOUND_MS);
  }

  /** The line that removes the volume too. */
  removeVolume(): Promise<CommandResult> {
    return this.run(this.withFiles(LINES.removeVolume), STOP_BOUND_MS);
  }

  /** The line that shows the emulator's log. */
  emulatorLogs(): Promise<CommandResult> {
    return this.run(this.withFiles(LINES.emulatorLogs), STOP_BOUND_MS);
  }

  private label(): string {
    return `label=com.docker.compose.project=${this.project}`;
  }

  /** The form's containers: those that carry its project's label, running or not. */
  async containers(): Promise<ContainerState[]> {
    const ids = (await dockerRead(['ps', '-aq', '--no-trunc', '--filter', this.label()]))
      .split('\n')
      .filter((id) => id !== '');
    return inspectContainers(ids);
  }

  /** The names of the form's networks: those that carry its project's label. */
  async networks(): Promise<string[]> {
    return (await dockerRead(['network', 'ls', '--format', '{{.Name}}', '--filter', this.label()]))
      .split('\n')
      .filter((name) => name !== '');
  }

  /** The names of the form's volumes: those that carry its project's label. */
  async volumes(): Promise<string[]> {
    return (await dockerRead(['volume', 'ls', '--format', '{{.Name}}', '--filter', this.label()]))
      .split('\n')
      .filter((name) => name !== '');
  }

  /** The name of the form's volume `key` (`emulator`, `settings`): the one that carries both labels; `''` when none. */
  async volume(key: string): Promise<string> {
    const names = (
      await dockerRead([
        'volume',
        'ls',
        '--format',
        '{{.Name}}',
        '--filter',
        this.label(),
        '--filter',
        `label=com.docker.compose.volume=${key}`,
      ])
    )
      .split('\n')
      .filter((name) => name !== '');
    expect(names.length, `the volumes ${key} of ${this.project}: ${names.join(' ')}`).toBeLessThanOrEqual(1);
    return names[0] ?? '';
  }

  /** The form's container of `service`; fails the check when there is none, or more than one. */
  async container(service: string): Promise<ContainerState> {
    const found = (await this.containers()).filter((c) => c.service === service);
    expect(
      found.map((c) => c.name),
      `the containers of service ${service} of ${this.project}`,
    ).toHaveLength(1);
    return found[0];
  }

  /** One container of the form per service of `services`, failing the check when one is missing or doubled. */
  async byService(services: string[] = SERVICES): Promise<Record<string, ContainerState>> {
    const out: Record<string, ContainerState> = {};
    for (const service of services) out[service] = await this.container(service);
    return out;
  }

  /**
   * The emulator's key and `ca.pem`, read inside its container from `<files dir>/<EMULATOR_PORT>/`, held in memory
   * and registered for redaction; `{ error }` naming what could not be read. Waits, at most the bound, for the files
   * of an emulator that has just started.
   */
  async emulatorFiles(boundMs = UP_BOUND_MS): Promise<FormEmulatorFiles | { error: string }> {
    const dir = `${EMULATOR_FILES_DIR}/${String(this.emulatorPort)}`;
    let last: FormEmulatorFiles | { error: string } = { error: 'not read' };
    await waitFor(boundMs, async () => {
      const emulator = (await this.containers()).filter((c) => c.service === 'aws-emulator' && c.running);
      if (emulator.length !== 1) {
        last = { error: `${String(emulator.length)} running containers of service aws-emulator in ${this.project}` };
        return undefined;
      }
      const [credentials, ca] = await Promise.all([
        catIn(emulator[0].id, `${dir}/emulator_credentials`),
        catIn(emulator[0].id, `${dir}/ca.pem`),
      ]);
      if (!credentials.ok || !ca.ok) {
        last = { error: `cat in ${emulator[0].name}: ${credentials.stderr} ${ca.stderr}`.trim() };
        return undefined;
      }
      const caLines = pemLines(ca.data.toString('utf8'));
      register(caLines);
      const key = parseCredentials(credentials.data.toString('utf8'));
      if (!key || caLines.length === 0) {
        last = { error: `the files under ${dir} in ${emulator[0].name} are incomplete` };
        return undefined;
      }
      last = { ...key, caLines, ca: ca.data };
      return true;
    });
    return last;
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
    const left = async () =>
      (await this.containers()).length + (await this.networks()).length + (await this.volumes()).length;
    if ((await left()) > 0) {
      try {
        await this.removeVolume();
      } catch (e) {
        this.ctx.log(`cleanup: ${(e as Error).message}`);
      }
    }
    const ids = (await this.containers()).map((c) => c.id);
    if (ids.length > 0) await dockerOut(['rm', '-f', ...ids]);
    const networks = await this.networks();
    if (networks.length > 0) await dockerOut(['network', 'rm', ...networks]);
    const volumes = await this.volumes();
    if (volumes.length > 0) await dockerOut(['volume', 'rm', '-f', ...volumes]);
  }
}
