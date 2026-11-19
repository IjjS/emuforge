import { describe, expect, it } from 'vitest';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { invokeOutcome } from './invoke-result';

// The outcome of an invoke (issue 516, test criteria "Unit s2 — invoke-result.test.ts").

const INVOKE = 'Invoke';

describe('the outcome of an invoke', () => {
  it('is "Succeeded" for an answer without FunctionError, and names the error value with it', () => {
    expect(invokeOutcome({ payload: '{"ok":1}', log: 'START\nREPORT' }, undefined)).toEqual({
      kind: 'succeeded',
      words: 'Succeeded',
      response: '{"ok":1}',
      log: 'START\nREPORT',
    });
    expect(
      invokeOutcome({ payload: '{"errorMessage":"boom"}', log: 'Traceback', functionError: 'Unhandled' }, undefined),
    ).toEqual({
      kind: 'function-error',
      words: 'The function returned an error',
      functionError: 'Unhandled',
      response: '{"errorMessage":"boom"}',
      log: 'Traceback',
    });
  });

  it('is "The invocation was refused" for a code and message, a bare status and not implemented', () => {
    const refusals: [RequestFailure, unknown][] = [
      [
        { kind: 'other', operation: INVOKE, code: 'ResourceNotFoundException', message: 'Function not found: x' },
        { kind: 'code', code: 'ResourceNotFoundException', message: 'Function not found: x' },
      ],
      [
        { kind: 'other', operation: INVOKE, code: 'HTTP 413' },
        { kind: 'code', code: 'HTTP 413' },
      ],
      [
        { kind: 'not-implemented', operation: INVOKE },
        { kind: 'sentence', sentence: 'Not implemented by the emulator: it answered 501 Not Implemented for Invoke.' },
      ],
      [
        { kind: 'access-denied', operation: INVOKE, message: 'no' },
        { kind: 'sentence', sentence: 'Access denied: Invoke was refused.', message: 'no' },
      ],
    ];
    for (const [failure, detail] of refusals) {
      expect(invokeOutcome(undefined, failure)).toEqual({
        kind: 'refused',
        words: 'The invocation was refused',
        detail,
      });
    }
  });

  it('is "The invocation got no answer" when the engine or the emulator did not answer, or none is connected', () => {
    const silences: [RequestFailure, unknown][] = [
      [
        { kind: 'engine-did-not-answer', operation: INVOKE },
        { kind: 'sentence', sentence: 'The EmuForge engine did not answer.' },
      ],
      [
        { kind: 'emulator-did-not-answer', operation: INVOKE, message: 'The emulator did not answer in 30 s.' },
        { kind: 'sentence', sentence: 'The emulator did not answer.', message: 'The emulator did not answer in 30 s.' },
      ],
      [
        { kind: 'emulator-did-not-answer', operation: INVOKE, message: 'No emulator is connected.' },
        { kind: 'sentence', sentence: 'The emulator did not answer.', message: 'No emulator is connected.' },
      ],
      [
        { kind: 'emulator-did-not-answer', operation: INVOKE, message: '' },
        { kind: 'sentence', sentence: 'The emulator did not answer.' },
      ],
    ];
    for (const [failure, detail] of silences) {
      expect(invokeOutcome(undefined, failure)).toEqual({
        kind: 'no-answer',
        words: 'The invocation got no answer',
        detail,
      });
    }
  });

  it('shows "-" for an empty payload and for no log', () => {
    expect(invokeOutcome({ payload: '', log: '' }, undefined)).toMatchObject({ response: '-', log: '-' });
    expect(invokeOutcome({ payload: '', log: '', functionError: 'Handled' }, undefined)).toMatchObject({
      response: '-',
      log: '-',
    });
  });

  it('is none before the first answer', () => {
    expect(invokeOutcome(undefined, undefined)).toBeUndefined();
  });
});
