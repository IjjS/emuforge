// Used by unit tests only; nothing in the app imports it. A fake engine behind `fetch` that answers Studio's
// `/config.json`, the engine's session and health routes the way a test tells it to and records every request,
// and Home rendered with the app's real routes and providers. Only the network is replaced.

import createWrapper, { type ElementWrapper } from '@cloudscape-design/components/test-utils/dom';
import selectors from '@cloudscape-design/components/test-utils/selectors';
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

/** A wrapper that finds any Cloudscape component inside its element. */
type Wrapper = ReturnType<typeof createWrapper>;

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
  return { ...result, router, wrapper: createWrapper(result.container) };
}

const ALERT = selectors().findAlert().toSelector();
const indicator = selectors().findStatusIndicator().toSelector();

export interface RowText {
  status: string;
  text: string;
}

function norm(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The "Connection" container. */
export function connectionContainer(): Wrapper {
  const heading = screen.getByRole('heading', { level: 2, name: 'Connection' });
  const container = createWrapper(document.body)
    .findAllContainers()
    .find((c) => c.getElement().contains(heading));
  if (container === undefined) {
    throw new Error('no "Connection" container');
  }
  return createWrapper(container.getElement());
}

/** The status and the whole text of the "Engine" or "Emulator" row. */
export function row(label: 'Engine' | 'Emulator'): RowText {
  const box = connectionContainer().getElement();
  const labelElement = within(box as HTMLElement)
    .getAllByText(label, { exact: true })
    .find((el) => el.closest(ALERT) === null);
  let scope = labelElement?.parentElement ?? null;
  while (scope !== null && scope.querySelector(indicator) === null) {
    scope = scope.parentElement;
  }
  if (scope === null) {
    throw new Error(`no "${label}" row`);
  }
  return { status: norm(scope.querySelector(indicator)?.textContent), text: norm(scope.textContent) };
}

/** The description under the "Connection" heading. */
export function connectionDescription(): string {
  return norm(connectionContainer().findHeader()?.findDescription()?.getElement().textContent);
}

/** The alerts inside the "Connection" container. */
export function connectionAlerts() {
  return connectionContainer().findAllAlerts();
}

/** The one alert inside the "Connection" container; fails when there is not exactly one. */
export function connectionAlert() {
  const alerts = connectionAlerts();
  if (alerts.length !== 1) {
    throw new Error(`expected one alert in "Connection", found ${String(alerts.length)}`);
  }
  return present(alerts[0], 'the alert');
}

/** The lines of a code view, as it draws them (one table row a line). */
function linesOf(view: ElementWrapper<Element>): string[] {
  return [...view.getElement().querySelectorAll('tr')].map((tr) => (tr.textContent ?? '').replace(/\n$/, ''));
}

/**
 * The lines of every command shown in `scope`, in order. A command inside a collapsed expandable section is in the
 * page but not shown, and left out.
 */
export function commandsIn(scope: { getElement(): Element }): string[][] {
  const within = createWrapper(scope.getElement());
  const collapsed = within
    .findAllExpandableSections()
    .filter((section) => section.findExpandedContent() === null)
    .map((section) => section.getElement());
  return within
    .findAll('[aria-label^="Command: "]')
    .filter((view) => !collapsed.some((section) => section.contains(view.getElement())))
    .map(linesOf);
}

/** The one alert of "Connection" as a plain wrapper, to find any component inside it. */
export function inAlert(): Wrapper {
  return createWrapper(connectionAlert().getElement());
}

/** The header "Refresh" of Home. */
export function headerRefresh(): HTMLElement {
  return screen.getByRole('button', { name: /^Refresh$/ });
}

/** The "Refresh" of the alert, by its accessible name. */
export function alertRefresh(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Refresh connection status' });
}

/** Every polite announcement element Cloudscape's live regions write to. */
export function announcements(): string[] {
  return [...document.querySelectorAll('[aria-live="polite"][aria-atomic="true"]')].map((el) => norm(el.textContent));
}
