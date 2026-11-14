// Studio's own server, the way a developer opens Studio: `bun run serve` in `studio/` (after `run` built
// `studio/dist/`), with an empty environment plus `HOME`, `PATH`, `EMUFORGE_STUDIO_PORT` and `EMUFORGE_ENGINE_PORT`.
// A missing package, a failed build, or a server that exits or does not listen is a failed assertion: Studio is
// the subject.

import { type Ctx } from './check';
import { ensurePortFree } from './net';
import { Proc, type Exit } from './process';

/** How long `bun run serve` may take to accept a connection on its port. */
const LISTEN_BOUND_MS = 15_000;

export interface StudioOptions {
  /** Default: the run's Studio port. */
  port?: number;
  /** The engine port given to the page. Default: the run's engine port. */
  enginePort?: number;
}

export class StudioServer {
  readonly port: number;
  readonly enginePort: number;
  private readonly proc: Proc;

  private constructor(ctx: Ctx, options: StudioOptions) {
    this.port = options.port ?? ctx.studioPort;
    this.enginePort = options.enginePort ?? ctx.enginePort;
    if (ctx.studioMissing) throw new Error(`no built Studio to serve (${ctx.studioMissing})`);
    const env = {
      HOME: ctx.home,
      PATH: process.env.PATH ?? '',
      EMUFORGE_STUDIO_PORT: String(this.port),
      EMUFORGE_ENGINE_PORT: String(this.enginePort),
    };
    this.proc = Proc.spawn(ctx, 'bun run serve', 'bun', ['run', 'serve'], ctx.studioDir, env);
    ctx.own(this);
  }

  /** `http://127.0.0.1:<port>`, the Studio origin. */
  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  url(path = '/'): string {
    return `${this.origin}${path}`;
  }

  /**
   * Runs `bun run serve` and returns at once, whatever it does: for a check that expects the server to refuse to
   * start. Throws only when there is no built Studio.
   */
  static spawn(ctx: Ctx, options: StudioOptions = {}): StudioServer {
    return new StudioServer(ctx, options);
  }

  /**
   * Runs `bun run serve` on a port nothing listens on (`EnvError` otherwise) and waits until it accepts a connection.
   * Throws when the server exits or does not listen within the bound.
   */
  static async start(ctx: Ctx, options: StudioOptions = {}): Promise<StudioServer> {
    await ensurePortFree(options.port ?? ctx.studioPort);
    const studio = new StudioServer(ctx, options);
    const ready = await studio.proc.waitListening(studio.port, LISTEN_BOUND_MS);
    if (ready === 'listening') {
      ctx.log(`bun run serve pid ${studio.proc.pid} listens on 127.0.0.1:${studio.port}`);
      return studio;
    }
    const { stdout, stderr } = await studio.proc.stop();
    if (ready === 'timeout') {
      throw new Error(`bun run serve did not listen on 127.0.0.1:${studio.port} within ${LISTEN_BOUND_MS / 1000}s`);
    }
    throw new Error(
      `bun run serve exited (${JSON.stringify(ready)}) before listening on 127.0.0.1:${studio.port}; output: ${`${stdout}\n${stderr}`.trim()}`,
    );
  }

  /** Waits until the server exits, at most `boundMs`; `null` when it still runs. */
  waitExit(boundMs: number): Promise<Exit | null> {
    return this.proc.waitExit(boundMs);
  }

  output(): { stdout: string; stderr: string } {
    return this.proc.output();
  }

  async stop(): Promise<void> {
    await this.proc.stop();
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}
