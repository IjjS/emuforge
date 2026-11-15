// One check that holds several lines of its test criteria runs each line on its own: a line that fails is logged
// with its message and the next line still runs, so one run shows which lines hold and which do not. The check
// fails at its end when any line failed. An environment failure (`EnvError`) ends the check at once.

import { EnvError, type Ctx } from './check';

// Playwright colours its error messages for a terminal.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export class Lines {
  private readonly failed: string[] = [];
  private ran = 0;

  constructor(private readonly ctx: Ctx) {}

  /** Runs one criteria line, `name` being its words, and records whether it held. */
  async line(name: string, body: () => Promise<void>): Promise<void> {
    this.ran++;
    this.ctx.log(`line: ${name}`);
    try {
      await body();
      this.ctx.log(`line held: ${name}`);
    } catch (e) {
      if (e instanceof EnvError) throw e;
      const message = ((e as Error).message ?? String(e)).replace(ANSI, '');
      this.ctx.log(`line failed: ${name}\n${message}`);
      this.failed.push(`- ${name}\n${message}`);
    }
  }

  /** Fails the check when any line failed, naming each with its message. */
  end(): void {
    if (this.failed.length === 0) return;
    throw new Error(
      `${String(this.failed.length)} of ${String(this.ran)} criteria lines failed:\n${this.failed.join('\n')}`,
    );
  }
}
