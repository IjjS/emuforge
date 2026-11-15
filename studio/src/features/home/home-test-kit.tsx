// Used by unit tests only; nothing in the app imports it. A fake engine behind `fetch` that answers Studio's
// `/config.json`, the engine's session and health routes the way a test tells it to and records every request,
// and Home rendered with the app's real routes and providers. Only the network is replaced.

import { notifyManager } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Providers } from '../../app/providers';
import { routes } from '../../app/routes';

// TanStack Query hands its notifications to React on a 0 ms timer. Under fake timers a 0 ms timer set while timers
// run waits for the clock to move, which would make every step of a test move time; the kit notifies in a microtask.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

export type FakeAnswer =
  /** `ignoreAbort`: delivered after `delayMs` even when the request was aborted, as a transport that does not stop. */
  | { status: number; json?: unknown; text?: string; delayMs?: number; ignoreAbort?: boolean }
  /** The request fails at the network level, as a refused connection or an answer the browser withholds. */
  | { network: true; delayMs?: number }
  /** No answer until the request is aborted. */
  | { hang: true };

export interface SeenRequest {
  url: string;
  origin: string;
  path: string;
  /** Header names lower-case. */
  headers: Record<string, string>;
  init: RequestInit;
  /** The request's signal was aborted, before or after its answer. */
  aborted: () => boolean;
}

export const TOKEN_1 = 'a'.repeat(64);
export const TOKEN_2 = 'b'.repeat(64);

export function connected(port = 9297): FakeAnswer {
  return { status: 200, json: { emulator: { port, endpoint: `https://127.0.0.1:${String(port)}`, reachable: true } } };
}

export function emulatorDown(reason: string | undefined, port = 9297, message = 'the engine says why'): FakeAnswer {
  return {
    status: 503,
    json: { emulator: { port, endpoint: `https://127.0.0.1:${String(port)}`, reachable: false, reason, message } },
  };
}

export function engineRefusal(status: number, code: string, message = `the engine refused: ${code}`): FakeAnswer {
  return { status, json: { error: { code, message } } };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** A fake engine on `127.0.0.1:<enginePort>`; install it with `vi.stubGlobal('fetch', engine.fetch)`. */
export class FakeEngine {
  /** What `/config.json` answers: an engine port, or `undefined` for a 404 (no Studio server). */
  configPort: number | undefined = 8297;
  readonly requests: SeenRequest[] = [];
  /** Answers to session requests, in order; the last one repeats. */
  sessionAnswers: FakeAnswer[] = [{ status: 200, json: { token: TOKEN_1 } }];
  /** Answers to health requests, in order; the last one repeats. */
  healthAnswers: FakeAnswer[] = [connected()];
  private sessionCount = 0;
  private healthCount = 0;

  /** Requests to the engine's `path`. */
  to(path: string): SeenRequest[] {
    return this.requests.filter((r) => r.origin.startsWith('http://127.0.0.1:') && r.path === path);
  }

  get sessions(): SeenRequest[] {
    return this.to('/__emuforge/session');
  }

  get healths(): SeenRequest[] {
    return this.to('/__emuforge/health');
  }

  /** Every later health request is answered `answer`. */
  answerHealth(...answers: FakeAnswer[]): void {
    this.healthAnswers = [...this.healthAnswers.slice(0, this.healthCount), ...answers];
  }

  /** Every later session request is answered `answer`. */
  answerSession(...answers: FakeAnswer[]): void {
    this.sessionAnswers = [...this.sessionAnswers.slice(0, this.sessionCount), ...answers];
  }

  readonly fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input), window.location.href);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => (headers[name] = value));
    const signal = init.signal ?? undefined;
    this.requests.push({
      url: String(input),
      origin: url.origin,
      path: url.pathname,
      headers,
      init,
      aborted: () => signal?.aborted === true,
    });
    if (url.origin === window.location.origin && url.pathname === '/config.json') {
      return Promise.resolve(
        this.configPort === undefined
          ? new Response('not found', { status: 404 })
          : Response.json({ enginePort: this.configPort }),
      );
    }
    let answer: FakeAnswer;
    if (url.pathname === '/__emuforge/session') {
      answer = this.sessionAnswers[Math.min(this.sessionCount++, this.sessionAnswers.length - 1)] ?? { hang: true };
    } else if (url.pathname === '/__emuforge/health') {
      answer = this.healthAnswers[Math.min(this.healthCount++, this.healthAnswers.length - 1)] ?? { hang: true };
    } else {
      answer = { network: true };
    }
    return this.deliver(answer, signal);
  };

  private deliver(answer: FakeAnswer, signal: AbortSignal | undefined): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted === true && !('ignoreAbort' in answer)) {
        reject(abortError(signal));
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (!('ignoreAbort' in answer && answer.ignoreAbort === true)) {
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(abortError(signal));
        });
      }
      if ('hang' in answer) {
        return;
      }
      const send = () => {
        if ('network' in answer) {
          reject(new TypeError('Failed to fetch'));
        } else {
          const body = answer.text ?? (answer.json === undefined ? null : JSON.stringify(answer.json));
          resolve(new Response(body, { status: answer.status }));
        }
      };
      if (answer.delayMs === undefined) {
        send();
      } else {
        timer = setTimeout(send, answer.delayMs);
      }
    });
  }
}

/** `value`, or a failure naming `what` when it is missing. */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} is missing`);
  }
  return value;
}

/**
 * Lets every timer due within `ms` fire, then settles what they started: answers, TanStack Query's notifications and
 * React's renders, each render able to start the next request. Each round is its own `act`, so React renders between.
 */
export async function advance(ms = 0): Promise<void> {
  const { vi } = await import('vitest');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let round = 0; round < 10; round++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Renders the app's routes at `path` (Home by default) with its providers. */
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...result, router };
}

/** The status words a row shows (requirement R9.1). */
const STATUSES = ['Checking', 'Connected', 'Not started', 'Unreachable', 'Error', 'Unknown'];

export interface RowText {
  status: string;
  text: string;
}

export function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The "Connection" section: the region of that name. */
export function connectionSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Connection' });
}

/** The status and the whole text of the "Engine" or "Emulator" row: the term of that name and what it describes. */
export function row(label: 'Engine' | 'Emulator'): RowText {
  const term = within(connectionSection())
    .getAllByRole('term')
    .find((el) => norm(el.textContent) === label);
  const scope = present(term?.parentElement, `the "${label}" row`);
  const statuses = [...scope.querySelectorAll('dd *')]
    .map((el) => norm(el.textContent))
    .filter((text) => STATUSES.includes(text));
  return { status: [...new Set(statuses)].join(' | '), text: norm(scope.textContent) };
}

/** The line that describes the "Connection" section (next to its heading). */
export function connectionDescription(): string {
  const id = present(connectionSection().getAttribute('aria-describedby'), "the section's description");
  return norm(document.getElementById(id)?.textContent);
}

/** The notices inside the "Connection" section: what each heading under "Connection" heads. */
export function connectionNotices(): HTMLElement[] {
  return within(connectionSection())
    .queryAllByRole('heading', { level: 3 })
    .map((heading) => present(heading.closest<HTMLElement>('.st-notice'), 'the notice of a heading'));
}

/** The one notice inside the "Connection" section; fails when there is not exactly one. */
export function connectionNotice(): HTMLElement {
  const notices = connectionNotices();
  if (notices.length !== 1) {
    throw new Error(`expected one notice in "Connection", found ${String(notices.length)}`);
  }
  return present(notices[0], 'the notice');
}

/** The notice's heading. */
export function noticeHeading(notice: HTMLElement = connectionNotice()): HTMLElement {
  return within(notice).getByRole('heading', { level: 3 });
}

/** The text of the notice, whitespace collapsed. */
export function noticeText(notice: HTMLElement = connectionNotice()): string {
  return norm(notice.textContent);
}

/** The commands shown in `scope`, in order: each command group's `pre`, as lines. */
export function commandsIn(scope: HTMLElement): string[][] {
  return within(scope)
    .queryAllByRole('group', { name: /^Command: / })
    .map((group) => (group.querySelector('pre')?.textContent ?? '').split('\n'));
}

/** The copy buttons shown in `scope`, in order. */
export function copyButtonsIn(scope: HTMLElement): HTMLElement[] {
  return within(scope).queryAllByRole('button', { name: /^Copy command: / });
}

/** The build-once toggle of the notice, or `null`. */
export function buildOnceToggle(notice: HTMLElement = connectionNotice()): HTMLElement | null {
  return within(notice).queryByRole('button', { name: /^First run\? Build the image once/ });
}

/** The header "Refresh" of Home. */
export function headerRefresh(): HTMLElement {
  return screen.getByRole('button', { name: /^Refresh$/ });
}

/** The "Refresh" of the notice, by its accessible name. */
export function noticeRefresh(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Refresh connection status' });
}

/** The polite regions of the "Connection" section, the state's and the copy region, and what each says now. */
export function politeRegions(): HTMLElement[] {
  return [...connectionSection().querySelectorAll<HTMLElement>('[aria-live="polite"]')];
}

/** Every element of the document whose class names a Cloudscape class (`awsui…`). */
export function cloudscapeElements(scope: Element = document.documentElement): Element[] {
  return [scope, ...scope.querySelectorAll('*')].filter((el) =>
    [...el.classList].some((name) => name.startsWith('awsui')),
  );
}
