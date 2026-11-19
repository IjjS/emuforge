import type { RequestFailure } from '../../../../../lib/aws/request';
import type { InvokeAnswer } from './api';

// The outcome of an invoke (issue 516, design "Task 2", steps 4a to 4d): which of the four it is, in the words
// "Result" shows and announces, and what follows them. Codes, messages, the response and the log are the emulator's
// text as they came: untrusted, rendered as text by the tab.

/** What stands in the place of an empty response or an absent log. */
export const NONE = '-';

/** The words of each outcome, as shown and as announced. */
export const OUTCOME_WORDS = {
  succeeded: 'Succeeded',
  'function-error': 'The function returned an error',
  refused: 'The invocation was refused',
  'no-answer': 'The invocation got no answer',
} as const;

/** Why an invoke was refused or got no answer, as the area's failure states word it. */
export type OutcomeDetail =
  /** The code the answer wrote (or its status line) and its message when it had one. */
  | { kind: 'code'; code: string; message?: string }
  /** A sentence of EmuForge's own, followed by the answer's message when there is one. */
  | { kind: 'sentence'; sentence: string; message?: string };

export type InvokeOutcome =
  /** 200 without `FunctionError` (4a). */
  | { kind: 'succeeded'; words: string; response: string; log: string }
  /** 200 with `FunctionError` (4b): its value beside the words. */
  | { kind: 'function-error'; words: string; functionError: string; response: string; log: string }
  /** An answer of the emulator that refuses the invoke (4c): no response, no log. */
  | { kind: 'refused'; words: string; detail: OutcomeDetail }
  /** No answer of the emulator (4d): what did not answer; no response, no log. */
  | { kind: 'no-answer'; words: string; detail: OutcomeDetail };

/** `text`, or `-` when it is empty. */
export function shown(text: string): string {
  return text === '' ? NONE : text;
}

/** The outcome of an answer. */
export function answerOutcome(answer: InvokeAnswer): InvokeOutcome {
  const response = shown(answer.payload);
  const log = shown(answer.log);
  if (answer.functionError === undefined) {
    return { kind: 'succeeded', words: OUTCOME_WORDS.succeeded, response, log };
  }
  return {
    kind: 'function-error',
    words: OUTCOME_WORDS['function-error'],
    functionError: answer.functionError,
    response,
    log,
  };
}

/** A sentence of EmuForge's own, with the answer's message when it has one. */
function sentence(text: string, message?: string): OutcomeDetail {
  return message === undefined || message === ''
    ? { kind: 'sentence', sentence: text }
    : { kind: 'sentence', sentence: text, message };
}

/** The outcome of a failure: a refusal when the emulator answered, else no answer. */
export function failureOutcome(failure: RequestFailure): InvokeOutcome {
  switch (failure.kind) {
    case 'other':
      return {
        kind: 'refused',
        words: OUTCOME_WORDS.refused,
        detail:
          failure.message === undefined
            ? { kind: 'code', code: failure.code }
            : { kind: 'code', code: failure.code, message: failure.message },
      };
    case 'not-implemented':
      return {
        kind: 'refused',
        words: OUTCOME_WORDS.refused,
        detail: {
          kind: 'sentence',
          sentence: `Not implemented by the emulator: it answered 501 Not Implemented for ${failure.operation}.`,
        },
      };
    case 'access-denied':
      return {
        kind: 'refused',
        words: OUTCOME_WORDS.refused,
        detail: sentence(`Access denied: ${failure.operation} was refused.`, failure.message),
      };
    case 'emulator-did-not-answer':
      return {
        kind: 'no-answer',
        words: OUTCOME_WORDS['no-answer'],
        detail: sentence('The emulator did not answer.', failure.message),
      };
    case 'engine-did-not-answer':
      return {
        kind: 'no-answer',
        words: OUTCOME_WORDS['no-answer'],
        detail: sentence('The EmuForge engine did not answer.'),
      };
  }
}

/** The outcome of the last invoke, or `undefined` before the first answer. */
export function invokeOutcome(
  data: InvokeAnswer | undefined,
  error: RequestFailure | undefined,
): InvokeOutcome | undefined {
  if (error !== undefined) {
    return failureOutcome(error);
  }
  return data === undefined ? undefined : answerOutcome(data);
}
