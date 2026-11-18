// The engine process under test, started the way a developer starts it for Studio:
// `emuforge serve --port <engine> --emulator-port <emulator> --studio-port <studio>` (the binary of the run, built
// without Studio embedded, so it serves the engine only), with an empty environment
// plus `HOME`, `PATH` and `EMUFORGE_SETTINGS_DIR` (a folder of the check's own, issue 485). A missing binary is a failed assertion ("engine binary missing at <path>"), never an
// environment error: the engine is the subject.

import fs from 'node:fs';
import path from 'node:path';

import { type Ctx } from './check';
import { ensurePortFree } from './net';
import { Proc } from './process';

/** The checks whose settings folder is already cleared: the first engine a check starts clears it. */
const settingsCleared = new WeakSet<Ctx>();

/**
 * The settings folder every engine a check starts is given (`EMUFORGE_SETTINGS_DIR`, issue 485):
 * `<run output>/tmp/settings/<id>`, as the engine checks' (`engine/support/check.rs`).
 */
function settingsDir(ctx: Ctx): string {
  return path.join(ctx.tmp, 'settings', ctx.id);
}

/** How long a started engine may take to accept a connection on its port. */
const LISTEN_BOUND_MS = 10_000;

export interface EngineOptions {
  /** Default: the run's engine port. */
  port?: number;
  /** Default: the run's emulator. */
  emulatorPort?: number;
  /** Default: the run's Studio port. */
  studioPort?: number;
}

export class Engine {
  readonly port: number;
  readonly emulatorPort: number;
  readonly studioPort: number;
  private proc: Proc | null = null;

  private constructor(
    private readonly ctx: Ctx,
    options: EngineOptions,
  ) {
    this.port = options.port ?? ctx.enginePort;
    this.emulatorPort = options.emulatorPort ?? ctx.emulatorPort;
    this.studioPort = options.studioPort ?? ctx.studioPort;
  }

  /** `http://127.0.0.1:<port>`, the engine address Studio shows and calls. */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Starts an engine and waits until it accepts a connection on its port. */
  static async start(ctx: Ctx, options: EngineOptions = {}): Promise<Engine> {
    // The check's settings folder is empty when its first engine starts and removed when the check ends (after its
    // engines), so a file an earlier run of the same check left is never read.
    if (!settingsCleared.has(ctx)) {
      settingsCleared.add(ctx);
      const dir = settingsDir(ctx);
      fs.rmSync(dir, { recursive: true, force: true });
      ctx.own({ dispose: async () => fs.rmSync(dir, { recursive: true, force: true }) });
    }
    const engine = new Engine(ctx, options);
    ctx.own(engine);
    await engine.startAgain();
    return engine;
  }

  /**
   * Starts the engine (again) with the same settings, on the same port. The port must be free before (`EnvError`
   * otherwise). Throws when the binary is missing, or the engine exits or does not listen within the bound.
   */
  async startAgain(): Promise<void> {
    if (this.proc && !this.proc.exitStatus()) throw new Error('the engine is already running');
    const bin = this.ctx.engineBin;
    if (this.ctx.engineMissing) throw new Error(`engine binary missing at ${bin} (${this.ctx.engineMissing})`);
    if (!fs.existsSync(bin)) throw new Error(`engine binary missing at ${bin}`);
    await ensurePortFree(this.port);
    const args = [
      'serve',
      '--port',
      String(this.port),
      '--emulator-port',
      String(this.emulatorPort),
      '--studio-port',
      String(this.studioPort),
    ];
    // Its own settings folder in the run's scratch space (issue 485): no check reads or writes $HOME/.config.
    const env = {
      HOME: this.ctx.home,
      PATH: process.env.PATH ?? '',
      EMUFORGE_SETTINGS_DIR: settingsDir(this.ctx),
    };
    this.proc = Proc.spawn(this.ctx, 'engine', bin, args, this.ctx.checkout, env);
    const ready = await this.proc.waitListening(this.port, LISTEN_BOUND_MS);
    if (ready === 'listening') {
      this.ctx.log(`engine pid ${this.proc.pid} listens on 127.0.0.1:${this.port}`);
      return;
    }
    const { stderr } = await this.proc.stop();
    if (ready === 'timeout') throw new Error(`engine did not listen on 127.0.0.1:${this.port} within 10s`);
    throw new Error(
      `engine exited (${JSON.stringify(ready)}) before listening on 127.0.0.1:${this.port}; stderr: ${stderr.trim()}`,
    );
  }

  /** Stops the engine (SIGTERM, then SIGKILL after a bound) and waits until it has exited. */
  async stop(): Promise<void> {
    if (this.proc) await this.proc.stop();
  }

  /** SIGKILL: the engine ends without a chance to clean up. */
  async kill(): Promise<void> {
    if (!this.proc) return;
    this.proc.signal('SIGKILL');
    await this.proc.stop();
  }

  /** stdout and stderr so far. */
  output(): { stdout: string; stderr: string } {
    return this.proc?.output() ?? { stdout: '', stderr: '' };
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}
