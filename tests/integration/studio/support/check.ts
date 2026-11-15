// The check contract for Studio flow checks.
//
// `test('<check id>', async ({ ctx, page }) => { ... })`, one `test()` per check, titled with its id. The `ctx`
// fixture (automatic for every check) opens the check's log `<out>/logs/<id>.log`, owns everything the check starts
// (engines, emulators, Studio servers), stops it all in reverse order when the check ends, and writes
// `<verdicts>/<id>.json`:
//
// - `passed` when every assertion held;
// - `error` when an `EnvError` was thrown: the environment failed (an emulator would not start, a port could not be
//   taken), so the run says nothing about Studio;
// - `failed` when an assertion did not hold, a bounded wait ran out, or the check timed out.
//
// The browser context a check gets (`context`, and `page` in it) keeps the destination rule: checks reach only
// Studio, the engine and the emulator. The rule is the context's proxy (`refuse.ts`), a loopback listener the check
// owns, with a bypass list of exactly `127.0.0.0/8` and `[::1]`: a request to a loopback address goes direct and
// unchanged; a request to anything else, host names such as `localhost` included, reaches the listener, which logs
// `refused browser request to <origin>: checks reach only loopback addresses` and closes the connection, so the page
// sees the request fail and nothing leaves the machine.
//
// The contract installs no request interception on that context or page: no `route`, no `routeFromHAR`. While any
// route is installed, Playwright answers every CORS preflight itself with a canned allow and never sends it, so the
// page would not see the server's own answer (issue 15). A check does not add a route to them, and does not set
// `proxy` with `test.use`, which would replace the destination rule.

import { test as base, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { runEnv, type RunEnv } from './env';
import { LOOPBACK_BYPASS, startRefusingProxy } from './refuse';
import { redact } from './secrets';

const envErrors: string[] = [];

/** The environment failed; the check could not run. Becomes verdict `error`. */
export class EnvError extends Error {
  constructor(message: string) {
    super(`environment: ${message}`);
    this.name = 'EnvError';
    envErrors.push(this.message);
  }
}

interface Owned {
  dispose(): Promise<void>;
}

/** What a check gets to work with. Support takes `Ctx` so it can log and own what it starts. */
export interface Ctx extends RunEnv {
  id: string;
  /** Appends a line to the check's log, with secrets redacted. */
  log(line: string): void;
  /** Registers something the check started, to be disposed of when the check ends, last started first. */
  own(thing: Owned): void;
}

function verdictOf(info: TestInfo): { verdict: 'passed' | 'failed' | 'error'; message: string } {
  const messages = info.errors.map((e) => e.message ?? e.value ?? 'unknown error');
  if (info.status === 'passed' && messages.length === 0) return { verdict: 'passed', message: '' };
  if (messages.some((m) => envErrors.some((env) => m.includes(env)))) {
    return { verdict: 'error', message: messages.join('\n') };
  }
  if (info.status === 'timedOut') {
    return { verdict: 'failed', message: [`timed out after ${info.timeout / 1000}s`, ...messages].join('\n') };
  }
  if (info.status === 'failed' || messages.length > 0) return { verdict: 'failed', message: messages.join('\n') };
  return { verdict: 'error', message: `the check did not run to an end (${info.status})` };
}

// Playwright colours its error messages for a terminal; the verdict file and the log hold plain text.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export const test = base.extend<{ ctx: Ctx }>({
  ctx: [
    async ({}, use, info) => {
      const env = runEnv();
      const id = info.title;
      fs.mkdirSync(env.verdicts, { recursive: true });
      fs.mkdirSync(env.logs, { recursive: true });
      const logPath = path.join(env.logs, `${id}.log`);
      fs.writeFileSync(logPath, '');
      const started = Date.now();
      const owned: Owned[] = [];
      const ctx: Ctx = {
        ...env,
        id,
        log(line) {
          const elapsed = ((Date.now() - started) / 1000).toFixed(3).padStart(8);
          fs.appendFileSync(logPath, `[${elapsed}s] ${redact(line.replace(ANSI, ''))}\n`);
        },
        own(thing) {
          owned.push(thing);
        },
      };
      ctx.log(
        `check ${id}: emulator port ${env.emulatorPort}, engine port ${env.enginePort}, studio port ${env.studioPort}, engine ${env.engineBin}`,
      );

      await use(ctx);

      for (const thing of owned.reverse()) {
        try {
          await thing.dispose();
        } catch (e) {
          ctx.log(`cleanup: ${(e as Error).message}`);
        }
      }
      const { verdict, message } = verdictOf(info);
      const shown = redact(message.replace(ANSI, ''));
      ctx.log(`verdict ${verdict} ${shown}`);
      const record = {
        check_id: id,
        verdict,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        log: logPath,
        message: shown,
      };
      fs.writeFileSync(path.join(env.verdicts, `${id}.json`), JSON.stringify(record));
    },
    { auto: true },
  ],

  // The context's proxy, set up after `ctx` and stopped by it once the context is closed.
  proxy: async ({ ctx }, use) => {
    const proxy = await startRefusingProxy((line) => ctx.log(line));
    ctx.own(proxy);
    await use({ server: proxy.server, bypass: LOOPBACK_BYPASS });
  },
});

export { expect } from '@playwright/test';
