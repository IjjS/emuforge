import { EngineCommandSessionRefusal, EngineSessionError } from './engine-session';

// The one mapping of a failed request of the AWS area to a screen's states, and the wait on a request's signal
// (issue 445, requirement R4 to R6). A service's `api.ts` sends every command through `sendRequest` with the
// operation's name; no service folder maps a failure or awaits a signal itself. Codes and messages are the
// emulator's or the engine's text: untrusted, passed on as text and never interpreted beyond the kinds below.

/** Why a request failed, one kind per state the answer alone decides. Every kind names the operation. */
export type RequestFailure =
  /** HTTP 501: the emulator does not implement the operation. */
  | { kind: 'not-implemented'; operation: string }
  /** `AccessDenied` or `AccessDeniedException`, with the message returned. */
  | { kind: 'access-denied'; operation: string; message: string }
  /** The engine's `EmulatorUnavailable` or `EmulatorTimeout`, with the engine's message as it came. */
  | { kind: 'emulator-did-not-answer'; operation: string; message: string }
  /** No answer came from the engine: the request, or the session request before it, failed at the network level. */
  | { kind: 'engine-did-not-answer'; operation: string }
  /** Any other answer: its code, or its status line when it has none, and its message when it has one. */
  | { kind: 'other'; operation: string; code: string; message?: string; sessionRefused?: true };

const reportedCodes = new WeakMap<RequestFailure, string>();
const reportedNotImplementedMessages = new WeakMap<RequestFailure, string>();

/**
 * The code reported in a service response, when present. Keep the original failure from `requestFailure` or
 * `RequestError.failure` to read this metadata. It excludes synthesized status lines, decoder errors and session errors.
 */
export function reportedServiceCode(failure: RequestFailure): string | undefined {
  return reportedCodes.get(failure);
}

/** The service's optional 501 message, kept separately so the failure shape remains unchanged. */
export function reportedNotImplementedMessage(failure: RequestFailure): string | undefined {
  return reportedNotImplementedMessages.get(failure);
}

function withReportedCode(failure: RequestFailure, code: string | undefined): RequestFailure {
  if (code !== undefined) {
    reportedCodes.set(failure, code);
  }
  return failure;
}

/** A request that failed; `name` is 'RequestError', `message` is `<operation> failed: <kind>.` */
export class RequestError extends Error {
  readonly failure: RequestFailure;

  constructor(failure: RequestFailure) {
    super(`${failure.operation} failed: ${failure.kind}.`);
    this.name = 'RequestError';
    this.failure = failure;
  }
}

const ACCESS_DENIED: ReadonlySet<string> = new Set(['AccessDenied', 'AccessDeniedException']);

/** The engine's two answers for an emulator that cannot be reached or does not answer in time. */
const EMULATOR_SILENT: ReadonlySet<string> = new Set(['EmulatorUnavailable', 'EmulatorTimeout']);

/** The failure of a 2xx answer without a code that the SDK could not decode. */
export const UNREADABLE_ANSWER = "The emulator's answer could not be read";

/** The SDK's two messages for an answer that gave none. */
const NO_MESSAGE: ReadonlySet<string> = new Set(['UnknownError', 'Unknown']);

interface ErrorAnswer {
  Code?: unknown;
  code?: unknown;
  __type?: unknown;
  name?: unknown;
  message?: unknown;
  $fault?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $response?: { reason?: unknown; statusCode?: unknown; headers?: Record<string, unknown> };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function headerCode(headers: ErrorAnswer['$response']): string | undefined {
  const entry = Object.entries(headers?.headers ?? {}).find(([key]) => key.toLowerCase() === 'x-amzn-errortype');
  const code = text(entry?.[1])?.split(/[,:]/, 1)[0]?.split('#').at(-1);
  return text(code?.trim());
}

/** Keep the protocol's decoded exception name when it identifies a service code. */
function codeOf(answer: ErrorAnswer, status: number): string | undefined {
  const code = text(answer.Code);
  if (code !== undefined) {
    return code;
  }
  const name = text(answer.name);
  if (name === 'SyntaxError') {
    return headerCode(answer.$response);
  }
  if (typeof answer.$fault === 'string') {
    const syntheticNotFound = name === 'NotFound' && status === 404 && NO_MESSAGE.has(text(answer.message) ?? '');
    if (name !== undefined && name !== 'Unknown' && !syntheticNotFound) {
      return name;
    }
    return text(answer.code) ?? text(answer.__type) ?? headerCode(answer.$response);
  }
  return undefined;
}

/** The failure of `operation` that `error`, a rejection of the SDK or of the session, stands for (R5). */
export function requestFailure(operation: string, error: unknown): RequestFailure {
  if (error instanceof RequestError) {
    return error.failure;
  }
  if (error instanceof EngineCommandSessionRefusal) {
    const answer = error.cause as ErrorAnswer;
    const code = codeOf(answer, 401) ?? 'HTTP 401';
    const message = text(answer.message);
    return { kind: 'other', operation, code, sessionRefused: true, ...(message === undefined ? {} : { message }) };
  }
  if (error instanceof EngineSessionError) {
    return error.reason === 'unreachable'
      ? { kind: 'engine-did-not-answer', operation }
      : { kind: 'other', operation, code: error.code ?? `HTTP ${String(error.status)}` };
  }
  const answer = (typeof error === 'object' && error !== null ? error : {}) as ErrorAnswer;
  const status = answer.$metadata?.httpStatusCode ?? answer.$response?.statusCode;
  if (typeof status !== 'number') {
    return { kind: 'engine-did-not-answer', operation };
  }
  const code = codeOf(answer, status);
  if (status === 501) {
    const failure = withReportedCode({ kind: 'not-implemented', operation }, code);
    const message = text(answer.message);
    if (typeof answer.$fault === 'string' && message !== undefined && !NO_MESSAGE.has(message)) {
      reportedNotImplementedMessages.set(failure, message);
    }
    return failure;
  }
  if (code === undefined && status >= 200 && status < 300) {
    // A success the SDK could not decode: its status names no failure, the SDK's own message is what went wrong.
    const message = text(answer.message);
    return message === undefined
      ? { kind: 'other', operation, code: UNREADABLE_ANSWER }
      : { kind: 'other', operation, code: UNREADABLE_ANSWER, message };
  }
  if (code === undefined) {
    const reason = text(answer.$response?.reason);
    const message = text(answer.message);
    const serviceMessage =
      typeof answer.$fault === 'string' &&
      answer.name !== 'SyntaxError' &&
      message !== undefined &&
      !NO_MESSAGE.has(message)
        ? message
        : undefined;
    return {
      kind: 'other',
      operation,
      code: reason === undefined ? `HTTP ${String(status)}` : `HTTP ${String(status)} ${reason}`,
      ...(serviceMessage === undefined ? {} : { message: serviceMessage }),
    };
  }
  const rawMessage = text(answer.message);
  const message =
    answer.name === 'SyntaxError' || (code === 'NotFound' && status === 404 && NO_MESSAGE.has(rawMessage ?? ''))
      ? undefined
      : rawMessage;
  if (ACCESS_DENIED.has(code)) {
    return withReportedCode({ kind: 'access-denied', operation, message: message ?? '' }, code);
  }
  if (EMULATOR_SILENT.has(code)) {
    return withReportedCode({ kind: 'emulator-did-not-answer', operation, message: message ?? '' }, code);
  }
  return withReportedCode(
    message === undefined ? { kind: 'other', operation, code } : { kind: 'other', operation, code, message },
    code,
  );
}

/** `pending`, unless `signal` aborts first or has aborted: then its reason, at once (R6.1). */
export function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(signal.reason as Error);
    };
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
    // Settling after the abort reaches nobody: the promise has already rejected with the reason.
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (rejection: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(rejection as Error);
      },
    );
  });
}

const mutationAuthorizations = new WeakMap<AbortSignal, () => void>();

/** The connection ended before a mutation could finish sending its requests. */
export class AwsMutationInterrupted extends DOMException {
  constructor(readonly connection: 'browser' | 'emulator' = 'browser') {
    super(`The ${connection} connection changed.`, 'AbortError');
  }
}

/**
 * Bind a mutation to the browser connection before it can queue. Mutations normally keep already-relayed replies,
 * but a caller can also discard in-flight replies on native connectivity events. The caller owns session teardown.
 */
export function bindAwsMutationAuthorization(
  controller: AbortController,
  { cancelInFlight = false, isEmulatorCurrent }: { cancelInFlight?: boolean; isEmulatorCurrent?: () => boolean } = {},
): () => void {
  let interrupted = !navigator.onLine;
  const cancel = () => controller.abort(new AwsMutationInterrupted());
  const interrupt = () => {
    interrupted = true;
    if (cancelInFlight) cancel();
  };
  window.addEventListener('offline', interrupt, true);
  window.addEventListener('online', interrupt, true);
  mutationAuthorizations.set(controller.signal, () => {
    if (interrupted || !navigator.onLine) {
      cancel();
    } else if (isEmulatorCurrent?.() === false) {
      controller.abort(new AwsMutationInterrupted('emulator'));
    }
  });
  return () => {
    mutationAuthorizations.delete(controller.signal);
    window.removeEventListener('offline', interrupt, true);
    window.removeEventListener('online', interrupt, true);
  };
}

/** Check the signal at dispatch and report whether the request is bound to a mutation authorization. */
export function assertAwsRequestAuthorized(signal: AbortSignal): boolean {
  const authorize = mutationAuthorizations.get(signal);
  authorize?.();
  signal.throwIfAborted();
  return authorize !== undefined;
}

/**
 * One request of `operation`, sent by `send` with `signal` (R6.2). Rejects with a `RequestError` for a failed
 * request, and with `signal`'s reason, and nothing else, once it aborts.
 */
export async function sendRequest<T>(
  operation: string,
  send: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  assertAwsRequestAuthorized(signal);
  let sent: Promise<T>;
  try {
    sent = send(signal);
  } catch (error) {
    sent = Promise.reject(error as Error);
  }
  try {
    return await untilAborted(sent, signal);
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason;
    }
    throw new RequestError(requestFailure(operation, error));
  }
}
