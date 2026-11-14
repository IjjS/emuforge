// The engine process under test, started the way a developer starts it for Studio:
// `emuforge-server --port <engine> --emulator-port <emulator> --studio-port <studio>`, with an empty environment
// plus `HOME` and `PATH`. A missing binary is a failed assertion ("engine binary missing at <path>"), never an
// environment error: the engine is the subject.

import fs from 'node:fs';

import { type Ctx } from './check';
import { ensurePortFree } from './net';
import { Proc } from './process';

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
      '--port',
      String(this.port),
      '--emulator-port',
      String(this.emulatorPort),
      '--studio-port',
      String(this.studioPort),
    ];
    const env = { HOME: this.ctx.home, PATH: process.env.PATH ?? '' };
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
