// Everything the browser did for one page, recorded from the outside (Playwright's request, response, console and
// navigation events): each request with its final headers, each engine answer, every session token the engine
// handed out (registered for redaction at once), console messages and the page's addresses. Attached before the
// first `goto`, it observes and never changes a request.

import type { BrowserContext, Page, Request, Response } from '@playwright/test';

import type { Ctx } from './check';
import { register } from './secrets';

export const SESSION_PATH = '/__emuforge/session';
export const HEALTH_PATH = '/__emuforge/health';

export interface SeenRequest {
  url: string;
  method: string;
  /** The headers the browser sent, lower-case names; the provisional ones when the request failed before. */
  headers: Record<string, string>;
  postData: string | null;
  at: number;
}

export interface HealthAnswer {
  status: number;
  /** The parsed body, `null` when it is not JSON. */
  body: unknown;
  at: number;
}

export interface SeenBody {
  url: string;
  body: Buffer;
}

export class Traffic {
  readonly requests: SeenRequest[] = [];
  readonly health: HealthAnswer[] = [];
  /** Session tokens in the order the engine answered them. Registered for redaction. */
  readonly tokens: string[] = [];
  readonly bodies: SeenBody[] = [];
  readonly console: string[] = [];
  readonly pageUrls: string[] = [];
  private readonly pending: Promise<unknown>[] = [];

  private constructor(
    private readonly ctx: Ctx,
    private readonly keepBodies: boolean,
  ) {}

  /** Starts recording every request of `context` and the console and addresses of `page`. */
  static attach(ctx: Ctx, context: BrowserContext, page: Page, options: { bodies?: boolean } = {}): Traffic {
    const traffic = new Traffic(ctx, options.bodies ?? false);
    context.on('request', (request) => traffic.onRequest(request));
    context.on('response', (response) => traffic.onResponse(response));
    page.on('console', (message) => traffic.console.push(message.text()));
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) traffic.pageUrls.push(frame.url());
    });
    return traffic;
  }

  /** Waits until every header and body read so far has been recorded. */
  async settle(): Promise<void> {
    for (;;) {
      const now = this.pending.splice(0);
      if (now.length === 0) return;
      await Promise.allSettled(now);
    }
  }

  /** The requests whose URL is `origin` + `path`. */
  to(origin: string, path: string): SeenRequest[] {
    return this.requests.filter((r) => {
      const url = new URL(r.url);
      return url.origin === origin && url.pathname === path;
    });
  }

  private onRequest(request: Request): void {
    const seen: SeenRequest = {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData(),
      at: Date.now(),
    };
    this.requests.push(seen);
    this.pending.push(
      request
        .allHeaders()
        .then((headers) => (seen.headers = headers))
        .catch(() => undefined),
    );
  }

  private onResponse(response: Response): void {
    const url = new URL(response.url());
    const at = Date.now();
    if (url.pathname === SESSION_PATH && response.ok()) {
      this.pending.push(
        response
          .json()
          .then((body: { token?: unknown }) => {
            if (typeof body.token === 'string' && body.token !== '') {
              register([body.token]);
              this.tokens.push(body.token);
              this.ctx.log(`engine handed the page session token #${String(this.tokens.length)}`);
            }
          })
          .catch(() => undefined),
      );
    }
    if (url.pathname === HEALTH_PATH) {
      const answer: HealthAnswer = { status: response.status(), body: null, at };
      this.health.push(answer);
      this.pending.push(
        response
          .text()
          .then((text) => {
            try {
              answer.body = JSON.parse(text);
            } catch {
              answer.body = null;
            }
          })
          .catch(() => undefined),
      );
    }
    if (this.keepBodies) {
      this.pending.push(
        response
          .body()
          .then((body) => this.bodies.push({ url: response.url(), body }))
          .catch(() => undefined),
      );
    }
  }
}

/** `emulator.message` of the latest health answer that reports the emulator unreachable; `null` when none does. */
export function latestEmulatorMessage(traffic: Traffic): string | null {
  for (const answer of [...traffic.health].reverse()) {
    const emulator = (answer.body as { emulator?: { reachable?: unknown; message?: unknown } } | null)?.emulator;
    if (emulator?.reachable === false && typeof emulator.message === 'string') return emulator.message;
  }
  return null;
}
