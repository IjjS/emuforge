// Studio's client of the engine's targets API (issue 486, R9): list, one target's info, add, make the target, test
// and remove. Each call takes the caller's signal and its own time limit, sends the session token in a header as the
// engine client does (one new session and one retry when the engine refuses the token), and resolves with the parsed
// answer and when its request started, or rejects with `EngineNotAnswering` or `EngineRefusal`. The token lives in
// this client's memory only. Nothing of UI or `i18n/` is imported here.

import {
  CHECK_TIME_LIMIT_MS,
  isRecord,
  parseJson,
  readError,
  SESSION_HEADER,
  SESSION_PATH,
  SESSION_REFUSALS,
  TOKEN,
} from './engine-client';

export const TARGETS_PATH = '/__emuforge/targets';

/** A list, info, add, use or remove that has not answered this long after its start counts as the engine not answering. */
export const TARGETS_TIME_LIMIT_MS = CHECK_TIME_LIMIT_MS;

/** A test is given longer: the engine's five steps take at most about 10 seconds. */
export const TEST_TIME_LIMIT_MS = 15_000;

/** The form the engine runs in: the native one, which holds many connections, or the Compose one, which holds one. */
export type EngineForm = 'native' | 'compose';

/** One connection as the engine lists it. Its fields are untrusted text. */
export interface Target {
  name: string;
  endpoint: string;
  /** It is the target, the one the engine relays to. */
  active: boolean;
}

/** When a call's request started, in milliseconds since the epoch. */
interface Started {
  startedAt: number;
}

/** The engine's connections, in the order they were added. */
export interface TargetList extends Started {
  form: EngineForm;
  /** The target's name. */
  active: string;
  targets: Target[];
}

/** Whether a connection's emulator answers now, as the engine probed it. */
export type TargetHealth =
  | { reachable: true }
  /** `reason` and `message` are the engine's, `''` when it gave none; untrusted text. */
  | { reachable: false; reason: string; message: string };

export interface TargetInfo extends Started {
  target: Target;
  /** The folder the engine reads the emulator's keys from (`~/.aws/emulator/<port>/`): a path, never a key. */
  credentialsDir: string;
  health: TargetHealth;
}

export interface TargetAdded extends Started {
  target: Target;
}

export type TestCheckStatus = 'passed' | 'failed' | 'not_run';

/** One of a test's five checks, in the engine's order: files, connection, tls, health, credentials. */
export interface TestCheck {
  check: string;
  status: TestCheckStatus;
  /** The engine's `reason`, `''` when it gave none. */
  reason: string;
  /** The engine's `message`, `''` when it gave none. Untrusted text. */
  message: string;
}

export interface TargetTest extends Started {
  name: string;
  endpoint: string;
  passed: boolean;
  checks: TestCheck[];
}

export type TargetRemoved = Started;

/** The engine did not answer: a network failure, or no answer within the call's time limit. */
export class EngineNotAnswering extends Error {
  override readonly name = 'EngineNotAnswering';
  constructor() {
    super('The engine did not answer.');
  }
}

/** The engine answered with something other than the call's success: a refusal, or an answer not of its shape. */
export class EngineRefusal extends Error {
  override readonly name = 'EngineRefusal';
  constructor(
    readonly status: number,
    /** The `error.code` of the answer's body, when it has one. Untrusted text. */
    readonly code: string | undefined,
    /** The `error.message` of the answer's body, when it has one. Untrusted text. */
    readonly engineMessage: string | undefined,
  ) {
    super(`The engine answered ${String(status)}${code === undefined ? '' : ` ${code}`}.`);
  }
}

export interface NewTarget {
  name: string;
  endpoint: string;
}

export interface TargetsClient {
  /** The base it calls: `http://127.0.0.1:<engine port>`, or `<page origin><engine path>` through Studio's port. */
  readonly origin: string;
  list(signal?: AbortSignal): Promise<TargetList>;
  info(name: string, signal?: AbortSignal): Promise<TargetInfo>;
  add(target: NewTarget, signal?: AbortSignal): Promise<TargetAdded>;
  use(name: string, signal?: AbortSignal): Promise<TargetList>;
  test(name: string, signal?: AbortSignal): Promise<TargetTest>;
  remove(name: string, signal?: AbortSignal): Promise<TargetRemoved>;
}

interface Answer {
  status: number;
  /** The parsed JSON body; `undefined` when the body is not JSON or was not read. */
  body: unknown;
}

interface Call {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  json?: unknown;
  /** The success status; its body is not read when `readBody` is false. */
  success: number;
  readBody: boolean;
  limitMs: number;
}

function refusal(answer: Answer): EngineRefusal {
  const error = readError(answer.body);
  return new EngineRefusal(answer.status, error?.code, error?.message);
}

/** An answer of the success status whose body is not the documented shape: a refusal with its status and no code. */
function malformed(answer: Answer): EngineRefusal {
  return new EngineRefusal(answer.status, undefined, undefined);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readTarget(value: unknown): Target | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name === '' || typeof value.endpoint !== 'string') {
    return undefined;
  }
  return { name: value.name, endpoint: value.endpoint, active: value.active === true };
}

function readList(body: unknown): Omit<TargetList, 'startedAt'> | undefined {
  if (!isRecord(body) || (body.form !== 'native' && body.form !== 'compose')) {
    return undefined;
  }
  if (typeof body.active !== 'string' || body.active === '' || !Array.isArray(body.targets)) {
    return undefined;
  }
  const targets = body.targets.map(readTarget);
  if (targets.some((target) => target === undefined)) {
    return undefined;
  }
  return { form: body.form, active: body.active, targets: targets as Target[] };
}

function readHealth(value: unknown): TargetHealth | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.reachable === true) {
    return { reachable: true };
  }
  if (value.reachable === false) {
    return { reachable: false, reason: text(value.reason), message: text(value.message) };
  }
  return undefined;
}

function readInfo(body: unknown): Omit<TargetInfo, 'startedAt'> | undefined {
  const target = readTarget(body);
  if (target === undefined || !isRecord(body) || typeof body.credentials_dir !== 'string') {
    return undefined;
  }
  const health = readHealth(body.health);
  return health === undefined ? undefined : { target, credentialsDir: body.credentials_dir, health };
}

const CHECK_STATUSES: ReadonlySet<unknown> = new Set(['passed', 'failed', 'not_run']);

function readCheck(value: unknown): TestCheck | undefined {
  if (!isRecord(value) || typeof value.check !== 'string' || !CHECK_STATUSES.has(value.status)) {
    return undefined;
  }
  return {
    check: value.check,
    status: value.status as TestCheckStatus,
    reason: text(value.reason),
    message: text(value.message),
  };
}

function readTest(body: unknown): Omit<TargetTest, 'startedAt'> | undefined {
  if (!isRecord(body) || typeof body.name !== 'string' || typeof body.endpoint !== 'string') {
    return undefined;
  }
  if (typeof body.passed !== 'boolean' || !Array.isArray(body.checks)) {
    return undefined;
  }
  const checks = body.checks.map(readCheck);
  if (checks.some((check) => check === undefined)) {
    return undefined;
  }
  return { name: body.name, endpoint: body.endpoint, passed: body.passed, checks: checks as TestCheck[] };
}

/** The path of one target: its name as one path segment. */
function targetPath(name: string, action = ''): string {
  return `${TARGETS_PATH}/${encodeURIComponent(name)}${action}`;
}

/**
 * A client of the targets API of the engine at `base` (`engineBase` of the page's configuration), holding its own
 * session token. Each request goes to `<base><route>`.
 */
export function createTargetsClient(base: string): TargetsClient {
  const origin = base;
  let token: string | undefined;

  async function send(
    method: string,
    path: string,
    signal: AbortSignal,
    headers: Record<string, string>,
    json: unknown,
    readBody: (status: number) => boolean,
  ): Promise<Answer> {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: json === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: json === undefined ? null : JSON.stringify(json),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
    const body = readBody(response.status) ? parseJson(await response.text()) : undefined;
    // An answer that arrives after the time limit or a cancel is not used, whatever the transport did with it.
    signal.throwIfAborted();
    return { status: response.status, body };
  }

  async function openSession(signal: AbortSignal): Promise<string> {
    const answer = await send('GET', SESSION_PATH, signal, {}, undefined, () => true);
    const sent = isRecord(answer.body) ? answer.body.token : undefined;
    if (answer.status !== 200 || typeof sent !== 'string' || !TOKEN.test(sent)) {
      throw refusal(answer);
    }
    return sent;
  }

  async function run(call: Call, signal: AbortSignal): Promise<Answer> {
    const readBody = (status: number) => call.readBody || status !== call.success;
    const ask = (held: string) => send(call.method, call.path, signal, { [SESSION_HEADER]: held }, call.json, readBody);
    token ??= await openSession(signal);
    let answer = await ask(token);
    const code = answer.status === 401 ? readError(answer.body)?.code : undefined;
    if (code !== undefined && SESSION_REFUSALS.has(code)) {
      // The engine started again, or forgot this page: one new session, one retry, no more.
      token = undefined;
      token = await openSession(signal);
      answer = await ask(token);
      if (answer.status === 401) {
        token = undefined;
      }
    }
    if (answer.status !== call.success) {
      throw refusal(answer);
    }
    return answer;
  }

  /** Runs `call` within its time limit; resolves with its success answer and when it started. */
  async function perform(call: Call, signal: AbortSignal | undefined): Promise<Answer & Started> {
    const startedAt = Date.now();
    const limit = new AbortController();
    const cancel = () => limit.abort(signal?.reason);
    signal?.addEventListener('abort', cancel);
    const timer = setTimeout(
      () => limit.abort(new DOMException('The request took too long.', 'TimeoutError')),
      call.limitMs,
    );
    try {
      signal?.throwIfAborted();
      return { ...(await run(call, limit.signal)), startedAt };
    } catch (error) {
      if (signal?.aborted === true) {
        throw signal.reason;
      }
      if (error instanceof EngineRefusal) {
        throw error;
      }
      // A request failed at the network level, the browser withheld the answer, or the time limit passed.
      throw new EngineNotAnswering();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  function parsed<T>(answer: Answer & Started, read: (body: unknown) => T | undefined): T & Started {
    const value = read(answer.body);
    if (value === undefined) {
      throw malformed(answer);
    }
    return { ...value, startedAt: answer.startedAt };
  }

  const json = (method: Call['method'], path: string, success: number, limitMs = TARGETS_TIME_LIMIT_MS): Call => ({
    method,
    path,
    success,
    readBody: true,
    limitMs,
  });

  return {
    origin,
    async list(signal) {
      return parsed(await perform(json('GET', TARGETS_PATH, 200), signal), readList);
    },
    async info(name, signal) {
      return parsed(await perform(json('GET', targetPath(name), 200), signal), readInfo);
    },
    async add(target, signal) {
      const call = { ...json('POST', TARGETS_PATH, 201), json: { name: target.name, endpoint: target.endpoint } };
      return parsed(await perform(call, signal), (body) => {
        const added = readTarget(body);
        return added === undefined ? undefined : { target: added };
      });
    },
    async use(name, signal) {
      return parsed(await perform(json('POST', targetPath(name, '/use'), 200), signal), readList);
    },
    async test(name, signal) {
      return parsed(await perform(json('POST', targetPath(name, '/test'), 200, TEST_TIME_LIMIT_MS), signal), readTest);
    },
    async remove(name, signal) {
      const answer = await perform({ ...json('DELETE', targetPath(name), 204), readBody: false }, signal);
      return { startedAt: answer.startedAt };
    },
  };
}
