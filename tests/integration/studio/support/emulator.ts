// The emulator side: where its files are, what they hold (read only to redact them and to look for them where they
// must not be), a direct health call that bypasses the engine and verifies TLS against the emulator's own `ca.pem`,
// and own emulators for checks labelled `own-emulator`.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { EnvError, type Ctx } from './check';
import { freePortExcept, probe } from './net';
import { register } from './secrets';
import { waitFor } from './wait';

/** How long an emulator may take to answer its own health route after `docker run` or `docker start`. */
const EMULATOR_READY_BOUND_MS = 30_000;

/** How long a killed emulator's container may take to exit and release its published port. */
const KILLED_BOUND_MS = 10_000;

/** `$HOME/.aws/emulator/<port>`. */
export function emulatorDir(home: string, port: number): string {
  return path.join(home, '.aws', 'emulator', String(port));
}

/**
 * The secret values of an emulator's files. Reading them registers every value for redaction. Never logged or
 * printed: a check compares them with what it observed.
 */
export interface EmulatorFiles {
  accessKeyId: string;
  secretAccessKey: string;
  /** The base64 lines of every block in `ca.pem`, trimmed. */
  caLines: string[];
}

/**
 * Reads `ca.pem` and `emulator_credentials` of the emulator directory `dir`; `null` when either is missing or the
 * credentials file has no `[default]` with both keys.
 */
export function readEmulatorFiles(dir: string): EmulatorFiles | null {
  let ca: string;
  let credentials: string;
  try {
    ca = fs.readFileSync(path.join(dir, 'ca.pem'), 'utf8');
    credentials = fs.readFileSync(path.join(dir, 'emulator_credentials'), 'utf8');
  } catch {
    return null;
  }
  const caLines = ca
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('-----'));
  register(caLines);
  let section = '';
  let accessKeyId: string | undefined;
  let secretAccessKey: string | undefined;
  for (const raw of credentials.split('\n')) {
    const line = raw.trim();
    const header = /^\[(.*)\]$/.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    register([value]);
    if (section === 'default' && key === 'aws_access_key_id') accessKeyId = value;
    if (section === 'default' && key === 'aws_secret_access_key') secretAccessKey = value;
  }
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, caLines };
}

/**
 * `GET https://127.0.0.1:<port>/__admin/health` straight to the emulator, verified against its `ca.pem`. Returns the
 * status and body, or the error. Never goes through the engine.
 */
export async function directHealth(home: string, port: number): Promise<{ status: number; body: string } | string> {
  const caPath = path.join(emulatorDir(home, port), 'ca.pem');
  let ca: Buffer;
  try {
    ca = fs.readFileSync(caPath);
  } catch {
    return `${caPath} does not exist`;
  }
  return new Promise((resolve) => {
    const request = https.get(
      { host: '127.0.0.1', port, path: '/__admin/health', ca, agent: false, timeout: 5_000 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        response.on('error', (e) => resolve(e.message));
      },
    );
    request.on('timeout', () => request.destroy(new Error('no answer within 5 s')));
    request.on('error', (e) => resolve(e.message));
  });
}

/** True when the emulator on `port` answers `200 ok` on its own health route. */
export async function answersOk(home: string, port: number): Promise<boolean> {
  const health = await directHealth(home, port);
  return typeof health !== 'string' && health.status === 200 && health.body === 'ok';
}

/** The run's emulator, started by `run` before any check: `EnvError` unless it answers `200 ok` directly. */
export async function requireRunEmulator(ctx: Ctx): Promise<void> {
  if (!(await answersOk(ctx.home, ctx.emulatorPort))) {
    throw new EnvError(`the run's emulator on 127.0.0.1:${ctx.emulatorPort} does not answer 200 ok directly`);
  }
  readEmulatorFiles(emulatorDir(ctx.home, ctx.emulatorPort));
  ctx.log("run's emulator answers 200 ok directly");
}

export async function docker(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(`docker ${args[0]}: ${(stderr || error.message).trim()}`));
      else resolve(stdout.trim());
    });
  });
}

/**
 * An emulator container of one check, on a free loopback port whose emulator directory did not exist when the
 * check took it, labelled with the run id so `run` removes it if the check could not. `dispose`: `docker stop`,
 * `docker rm -f`, and removal of that directory if it is still there (a kill leaves it), so the guard never deletes
 * files of an emulator it did not start.
 */
export class OwnEmulator {
  private constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly dir: string,
    readonly name: string,
  ) {}

  /** `https://127.0.0.1:<port>`, as the engine reports it. */
  get endpoint(): string {
    return `https://127.0.0.1:${this.port}`;
  }

  /**
   * Starts an emulator with telemetry off and waits until it answers `200 ok` on its own health route. With
   * `minPort`, its port is at least `minPort` (`EnvError` when no such port is free).
   */
  static async start(ctx: Ctx, options: { minPort?: number | undefined } = {}): Promise<OwnEmulator> {
    const port = await freePortExcept(ctx.home, [ctx.emulatorPort, ctx.enginePort, ctx.studioPort], {
      min: options.minPort,
    });
    const name = `emuforge-it-${port}-${ctx.runId}`;
    const emulator = new OwnEmulator(ctx, port, emulatorDir(ctx.home, port), name);
    ctx.own(emulator);
    ctx.log(`starting own emulator ${name} on 127.0.0.1:${port}`);
    const volume = `${ctx.home}/.aws/emulator:${ctx.home}/.aws/emulator`;
    try {
      await docker([
        'run',
        '-d',
        '--name',
        name,
        '--label',
        `emuforge-it-run=${ctx.runId}`,
        '--memory',
        '2g',
        '-p',
        `127.0.0.1:${port}:${port}`,
        '-e',
        `HOME=${ctx.home}`,
        '-v',
        volume,
        'aws-emulator',
        '-p',
        String(port),
        '-t',
        'off',
      ]);
    } catch (e) {
      throw new EnvError((e as Error).message);
    }
    await emulator.waitReady();
    return emulator;
  }

  /** Waits until the emulator answers `200 ok` on its own health route; registers its files for redaction. */
  async waitReady(): Promise<void> {
    const ready = await waitFor(EMULATOR_READY_BOUND_MS, async () =>
      (await answersOk(this.ctx.home, this.port)) ? true : undefined,
    );
    if (!ready) {
      throw new EnvError(
        `emulator ${this.name} did not answer 200 ok on /__admin/health within ${EMULATOR_READY_BOUND_MS / 1000}s`,
      );
    }
    if (!readEmulatorFiles(this.dir)) throw new EnvError(`emulator ${this.name} is up but its files are incomplete`);
    this.ctx.log(`own emulator ${this.name} answers 200 ok`);
  }

  /** The emulator's current files (keys and certificate lines), registered for redaction. */
  files(): EmulatorFiles | null {
    return readEmulatorFiles(this.dir);
  }

  /** `docker stop`: SIGTERM; the emulator deletes its files, then exits. */
  async stop(): Promise<void> {
    this.ctx.log(`docker stop ${this.name}`);
    await this.envStep(['stop', '-t', '10', this.name]);
  }

  /**
   * `docker kill`: SIGKILL; the files stay behind with the dead run's keys and certificate. Then waits, with a bound,
   * until the container no longer runs and `127.0.0.1:<port>` refuses connections (Docker's port forwarder may still
   * accept for a moment). `EnvError` when that state is not reached: the check's Given would not hold.
   */
  async kill(): Promise<void> {
    this.ctx.log(`docker kill ${this.name}`);
    await this.envStep(['kill', this.name]);
    const gone = await waitFor(KILLED_BOUND_MS, async () => {
      const running = await docker(['inspect', '-f', '{{.State.Running}}', this.name]).catch(() => 'unknown');
      return running === 'false' && (await probe(this.port)) === 'refused' ? true : undefined;
    });
    if (!gone) {
      throw new EnvError(
        `after docker kill, ${this.name} still runs or 127.0.0.1:${this.port} does not refuse connections within ${KILLED_BOUND_MS / 1000}s`,
      );
    }
    this.ctx.log(`${this.name} no longer runs and 127.0.0.1:${this.port} refuses connections`);
  }

  /**
   * `docker start` of the stopped or killed container, on the same port: the emulator writes a new `ca.pem` and new
   * keys; waits until it answers `200 ok` with them.
   */
  async startAgain(): Promise<void> {
    this.ctx.log(`docker start ${this.name}`);
    await this.envStep(['start', this.name]);
    await this.waitReady();
  }

  async dispose(): Promise<void> {
    await docker(['stop', '-t', '10', this.name]).catch(() => undefined);
    await docker(['rm', '-f', this.name]).catch(() => undefined);
    if (fs.existsSync(this.dir)) fs.rmSync(this.dir, { recursive: true, force: true });
  }

  private async envStep(args: string[]): Promise<void> {
    try {
      await docker(args);
    } catch (e) {
      throw new EnvError((e as Error).message);
    }
  }
}
