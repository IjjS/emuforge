// A child process of a check: started with exactly the environment the check gives it, its stdout and stderr
// captured whole, stopped with its whole process group (so `bun run serve` takes its `bun scripts/serve.ts` with
// it), and its output written, redacted, to the check's log when it stops.

import { spawn, type ChildProcess } from 'node:child_process';

import type { Ctx } from './check';
import { probe } from './net';
import { waitFor } from './wait';

/** How long a process may take to exit after SIGTERM before it gets SIGKILL. */
const TERM_BOUND_MS = 10_000;

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class Proc {
  readonly pid: number;
  private readonly child: ChildProcess;
  private stdout = '';
  private stderr = '';
  private exit: Exit | null = null;
  private logged = false;
  private readonly exited: Promise<Exit>;

  private constructor(
    private readonly ctx: Ctx,
    readonly name: string,
    child: ChildProcess,
  ) {
    this.child = child;
    this.pid = child.pid ?? -1;
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (this.stdout += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (this.stderr += chunk));
    this.exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.exit = { code, signal };
        resolve(this.exit);
      });
      child.once('error', (e) => {
        this.stderr += `cannot spawn: ${e.message}\n`;
        this.exit = { code: null, signal: null };
        resolve(this.exit);
      });
    });
  }

  /** Spawns `command args` in `cwd` with `env` only (nothing of the test process's environment). */
  static spawn(ctx: Ctx, name: string, command: string, args: string[], cwd: string, env: Record<string, string>) {
    const shown = Object.entries(env)
      .filter(([k]) => k !== 'PATH')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    ctx.log(`spawn ${name}: ${command} ${args.join(' ')} in ${cwd} with ${shown}`);
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Proc(ctx, name, child);
  }

  /** The exit, once the process has exited; `null` while it runs. */
  exitStatus(): Exit | null {
    return this.exit;
  }

  output(): { stdout: string; stderr: string } {
    return { stdout: this.stdout, stderr: this.stderr };
  }

  /**
   * Waits until `127.0.0.1:<port>` accepts a connection, at most `boundMs`. Returns `listening`, or the exit when
   * the process exited first, or `timeout`.
   */
  async waitListening(port: number, boundMs: number): Promise<'listening' | 'timeout' | Exit> {
    const result = await waitFor(boundMs, async () => {
      if (this.exit) return this.exit;
      return (await probe(port)) === 'open' ? ('listening' as const) : undefined;
    });
    return result ?? 'timeout';
  }

  /** Waits until the process exits, at most `boundMs`; `null` when it still runs. */
  async waitExit(boundMs: number): Promise<Exit | null> {
    if (this.exit) return this.exit;
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), boundMs)));
    const result = await Promise.race([this.exited, bound]);
    clearTimeout(timer);
    return result;
  }

  /** Sends `signal` to the process group. */
  signal(signal: NodeJS.Signals): void {
    if (this.exit || this.pid < 0) return;
    try {
      process.kill(-this.pid, signal);
    } catch {
      // The group is already gone.
    }
  }

  /**
   * SIGTERM to the group, SIGKILL when it has not exited within the bound, then writes both streams, redacted, to
   * the check's log.
   */
  async stop(): Promise<{ stdout: string; stderr: string }> {
    if (!this.exit) {
      this.signal('SIGTERM');
      if (!(await this.waitExit(TERM_BOUND_MS))) {
        this.signal('SIGKILL');
        await this.waitExit(TERM_BOUND_MS);
      }
    }
    // A child of the group may outlive the leader; the group gets SIGKILL either way.
    try {
      process.kill(-this.pid, 'SIGKILL');
    } catch {
      // Nothing left.
    }
    if (!this.logged) {
      this.logged = true;
      this.ctx.log(
        `${this.name} pid ${this.pid} stopped (${JSON.stringify(this.exit)}); stdout:\n${this.stdout}\nstderr:\n${this.stderr}`,
      );
    }
    return this.output();
  }
}
