import { SESSION_PATH } from '../engine/engine-client';

// The AWS clients' session with the engine (requirement R4, R5, R7 of issue 13). One token per engine endpoint,
// shared by every client the factory creates for it, obtained by one session request at a time. The token lives in
// this module's memory only: never in a URL, browser storage or a log.

// A token is sent as a header value; anything else in its place is not a session answer.
const TOKEN = /^[\x21-\x7e]+$/;

export type EngineSessionFailure =
  /** No answer: the network failed or the browser withheld the answer. */
  | { reason: 'unreachable' }
  /** An answer that is not a session. `code` is the body's `error.code`, `undefined` when it has none. */
  | { reason: 'refused'; status: number; code: string | undefined };

/** The engine gave no session, so the command was not sent. Carries no token. */
export class EngineSessionError extends Error {
  readonly reason: EngineSessionFailure['reason'];
  /** The HTTP status of a refused session answer; `undefined` when the engine was unreachable. */
  readonly status: number | undefined;
  /** The `error.code` of a refused session answer, when it has one. Untrusted text. */
  readonly code: string | undefined;

  constructor(endpoint: string, failure: EngineSessionFailure) {
    super(
      failure.reason === 'unreachable'
        ? `The engine at ${endpoint} could not be reached for a session.`
        : `The engine at ${endpoint} gave no session (HTTP ${String(failure.status)}${failure.code === undefined ? '' : `, ${failure.code}`}).`,
    );
    this.name = 'EngineSessionError';
    this.reason = failure.reason;
    this.status = failure.reason === 'refused' ? failure.status : undefined;
    this.code = failure.reason === 'refused' ? failure.code : undefined;
  }
}

export interface EngineSession {
  /**
   * The held token, or the token of the one session request in flight, starting it when there is none. Rejects with
   * `EngineSessionError` when the engine gives no session, or with `signal`'s reason when it aborts first; an abort
   * leaves the session request to the other commands waiting for it.
   */
  token(signal?: AbortSignal): Promise<string>;
  /**
   * After the engine refused `stale`: the token that already replaced it, or the token of one new session request
   * shared by every command that asks while it is in flight.
   */
  renew(stale: string, signal?: AbortSignal): Promise<string>;
  /** Drops `refused` if it is still the held token, so the next command asks for a session again. */
  forget(refused: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorCode(body: unknown): string | undefined {
  const error = isRecord(body) ? body.error : undefined;
  const code = isRecord(error) ? error.code : undefined;
  return typeof code === 'string' && code !== '' ? code : undefined;
}

/** One session request; resolves with its token or rejects with `EngineSessionError`. */
async function openSession(endpoint: string): Promise<string> {
  let status: number;
  let text: string;
  try {
    const response = await fetch(`${endpoint}${SESSION_PATH}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    status = response.status;
    text = await response.text();
  } catch {
    throw new EngineSessionError(endpoint, { reason: 'unreachable' });
  }
  const body = parseJson(text);
  const token = isRecord(body) ? body.token : undefined;
  if (status !== 200 || typeof token !== 'string' || !TOKEN.test(token)) {
    throw new EngineSessionError(endpoint, { reason: 'refused', status, code: errorCode(body) });
  }
  return token;
}

/** Waits for `pending` unless `signal` aborts first; the abort does not cancel `pending` itself. */
function waitFor(pending: Promise<string>, signal: AbortSignal | undefined): Promise<string> {
  if (signal === undefined) {
    return pending;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason as Error);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

function createEngineSession(endpoint: string): EngineSession {
  let held: string | undefined;
  let pending: Promise<string> | undefined;

  function request(): Promise<string> {
    const started = openSession(endpoint).then((token) => {
      held = token;
      return token;
    });
    pending = started;
    // Settled either way, the next command that finds no token asks again.
    started.then(
      () => {
        pending = undefined;
      },
      () => {
        pending = undefined;
      },
    );
    return started;
  }

  return {
    token(signal) {
      if (held !== undefined) {
        return Promise.resolve(held);
      }
      return waitFor(pending ?? request(), signal);
    },
    renew(stale, signal) {
      if (held !== undefined && held !== stale) {
        return Promise.resolve(held);
      }
      held = undefined;
      return waitFor(pending ?? request(), signal);
    },
    forget(refused) {
      if (held === refused) {
        held = undefined;
      }
    },
  };
}

const sessions = new Map<string, EngineSession>();

/** The one session of the engine at `endpoint`, an endpoint the factory has already accepted. */
export function engineSession(endpoint: string): EngineSession {
  let session = sessions.get(endpoint);
  if (session === undefined) {
    session = createEngineSession(endpoint);
    sessions.set(endpoint, session);
  }
  return session;
}
