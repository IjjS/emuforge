// The one place Studio calls the engine (requirement 3.1). A check asks the engine's health route with the page's
// session token, opening a session first when it holds none and once more when the engine refuses the token, and
// maps whatever comes back, or does not, to one of the states of requirement 3.2. The token lives in this client's
// memory only: never in a URL, browser storage or a log.

export const ENGINE_HOST = '127.0.0.1';
export const SESSION_PATH = '/__emuforge/session';
export const HEALTH_PATH = '/__emuforge/health';
export const SESSION_HEADER = 'X-EmuForge-Session';

/** A check that has not completed this long after its start counts as "Engine unreachable" (requirement 3.4). */
export const CHECK_TIME_LIMIT_MS = 5_000;

// The engine's refusals of a missing or stale token; answered by opening a new session and retrying once.
const SESSION_REFUSALS: ReadonlySet<string> = new Set(['SessionInvalid', 'SessionRequired']);

const MAX_PORT = 65535;

// A token is sent as a header value; anything else in its place is not a session answer.
const TOKEN = /^[\x21-\x7e]+$/;

/** The engine's address on loopback for an engine port. */
export function engineOrigin(enginePort: number): string {
  return `http://${ENGINE_HOST}:${String(enginePort)}`;
}

/** The emulator as the engine reports it. */
export interface EmulatorReport {
  port: number;
  endpoint: string;
}

/** What one check found. `checkedAt` is when it completed, in milliseconds since the epoch. */
export type CheckResult =
  | { kind: 'connected'; checkedAt: number; emulator: EmulatorReport }
  | {
      kind: 'emulator-unreachable';
      checkedAt: number;
      emulator: EmulatorReport;
      /** The engine's `reason`, `''` when it gave none. */
      reason: string;
      /** The engine's `message`, `''` when it gave none. Untrusted text. */
      message: string;
    }
  | {
      kind: 'engine-unreachable';
      checkedAt: number;
      /** The emulator port the engine reported in an earlier answer to this client, if any did. */
      lastEmulatorPort: number | undefined;
    }
  | {
      kind: 'engine-error';
      checkedAt: number;
      /** The HTTP status of the answer that was not a health or session answer. */
      status: number;
      /** The `error.code` of the answer's body, when it has one. Untrusted text. */
      code: string | undefined;
      /** The `error.message` of the answer's body, when it has one. Untrusted text. */
      message: string | undefined;
    };

export interface EngineClient {
  /** `http://127.0.0.1:<engine port>`. */
  readonly origin: string;
  /**
   * Runs one check: every request it needs, within `CHECK_TIME_LIMIT_MS`. Resolves with what it found, whatever the
   * engine did; rejects only when `signal` aborts it, and then nothing it found is kept.
   */
  check(signal?: AbortSignal): Promise<CheckResult>;
}

interface Answer {
  status: number;
  /** The parsed JSON body; `undefined` when the body is not JSON. */
  body: unknown;
}

/** An answer that ends the check before the health answer: a refused or malformed session answer. */
class CheckEnded {
  constructor(readonly result: CheckResult) {}
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

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PORT;
}

/** The `{"error": {"code", "message"}}` of an engine refusal; `undefined` when the body is not one. */
function readError(body: unknown): { code: string | undefined; message: string | undefined } | undefined {
  if (!isRecord(body) || !isRecord(body.error)) {
    return undefined;
  }
  const { code, message } = body.error;
  return {
    code: typeof code === 'string' && code !== '' ? code : undefined,
    message: typeof message === 'string' && message !== '' ? message : undefined,
  };
}

function engineError(answer: Answer): CheckResult {
  const error = readError(answer.body);
  return {
    kind: 'engine-error',
    checkedAt: Date.now(),
    status: answer.status,
    code: error?.code,
    message: error?.message,
  };
}

/** A client for the engine on `127.0.0.1:<enginePort>`, holding its own session token. */
export function createEngineClient(enginePort: number): EngineClient {
  const origin = engineOrigin(enginePort);
  let token: string | undefined;
  let lastEmulatorPort: number | undefined;

  async function get(path: string, signal: AbortSignal, headers: Record<string, string>): Promise<Answer> {
    const response = await fetch(`${origin}${path}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    const text = await response.text();
    // An answer that arrives after the time limit or a cancel is not used, whatever the transport did with it.
    signal.throwIfAborted();
    return { status: response.status, body: parseJson(text) };
  }

  async function openSession(signal: AbortSignal): Promise<string> {
    const answer = await get(SESSION_PATH, signal, {});
    const sent = isRecord(answer.body) ? answer.body.token : undefined;
    if (answer.status !== 200 || typeof sent !== 'string' || !TOKEN.test(sent)) {
      throw new CheckEnded(engineError(answer));
    }
    return sent;
  }

  function askHealth(signal: AbortSignal, held: string): Promise<Answer> {
    return get(HEALTH_PATH, signal, { [SESSION_HEADER]: held });
  }

  function fromHealth(answer: Answer): CheckResult {
    if (readError(answer.body) !== undefined) {
      return engineError(answer);
    }
    const emulator = isRecord(answer.body) ? answer.body.emulator : undefined;
    if (!isRecord(emulator) || !isPort(emulator.port) || typeof emulator.endpoint !== 'string') {
      return engineError(answer);
    }
    const report: EmulatorReport = { port: emulator.port, endpoint: emulator.endpoint };
    if (answer.status === 200 && emulator.reachable === true) {
      lastEmulatorPort = report.port;
      return { kind: 'connected', checkedAt: Date.now(), emulator: report };
    }
    if (answer.status === 503 && emulator.reachable === false) {
      lastEmulatorPort = report.port;
      return {
        kind: 'emulator-unreachable',
        checkedAt: Date.now(),
        emulator: report,
        reason: typeof emulator.reason === 'string' ? emulator.reason : '',
        message: typeof emulator.message === 'string' ? emulator.message : '',
      };
    }
    return engineError(answer);
  }

  async function run(signal: AbortSignal): Promise<CheckResult> {
    token ??= await openSession(signal);
    let answer = await askHealth(signal, token);
    const refusal = answer.status === 401 ? readError(answer.body)?.code : undefined;
    if (refusal !== undefined && SESSION_REFUSALS.has(refusal)) {
      // The engine started again, or forgot this page: one new session, one retry, no more.
      token = undefined;
      token = await openSession(signal);
      answer = await askHealth(signal, token);
      if (answer.status === 401) {
        token = undefined;
      }
    }
    return fromHealth(answer);
  }

  return {
    origin,
    async check(signal?: AbortSignal): Promise<CheckResult> {
      const limit = new AbortController();
      const cancel = () => limit.abort(signal?.reason);
      signal?.addEventListener('abort', cancel);
      const timer = setTimeout(
        () => limit.abort(new DOMException('The check took too long.', 'TimeoutError')),
        CHECK_TIME_LIMIT_MS,
      );
      try {
        signal?.throwIfAborted();
        return await run(limit.signal);
      } catch (error) {
        if (signal?.aborted === true) {
          throw signal.reason;
        }
        if (error instanceof CheckEnded) {
          return error.result;
        }
        // A request failed at the network level, the browser withheld the answer, or the time limit passed.
        return { kind: 'engine-unreachable', checkedAt: Date.now(), lastEmulatorPort };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
