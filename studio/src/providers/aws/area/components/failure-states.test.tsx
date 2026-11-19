import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { RequestFailure } from '../../../../lib/aws/request';
import type { CheckResult } from '../../../../lib/engine/engine-client';
import type { AreaConnection } from './emulator-line';
import { actionFailureItem, ReadFailure, readFailureState, useAnnouncer } from './failure-states';

// The area's shared failure states (issue 481, unit s1): each kind of failed request as a read's state and as an
// action's Flashbar item, read through what a user sees.

const ENGINE_ORIGIN = 'http://127.0.0.1:8297';
const EMULATOR = { port: 4566, endpoint: 'https://127.0.0.1:4566' };

const CONNECTED: AreaConnection = {
  result: { kind: 'connected', checkedAt: 1, emulator: EMULATOR },
  engineOrigin: ENGINE_ORIGIN,
};

const FAILURES: Record<string, RequestFailure> = {
  'not implemented': { kind: 'not-implemented', operation: 'ListQueues' },
  'access denied': { kind: 'access-denied', operation: 'ListQueues', message: 'User is not allowed' },
  'emulator not answering': { kind: 'emulator-did-not-answer', operation: 'ListQueues', message: 'timed out' },
  'engine not answering': { kind: 'engine-did-not-answer', operation: 'ListQueues' },
  'any other code': { kind: 'other', operation: 'ListQueues', code: 'InvalidAddress', message: 'bad <b>' },
};

function show(node: ReactNode): string {
  const router = createMemoryRouter([{ path: '*', element: node }]);
  const { container, unmount } = render(<RouterProvider router={router} />);
  const text = container.textContent ?? '';
  unmount();
  return text;
}

function shownState(failure: RequestFailure, connection: AreaConnection, thing: string): string {
  return show(<ReadFailure state={readFailureState(failure, connection, thing)} onRetry={() => undefined} />);
}

describe('a failed read, connected', () => {
  it.each(['queue list', 'queue'])('names the read’s thing, %s, and the operation for each kind', (thing) => {
    const notImplemented = shownState(FAILURES['not implemented'] as RequestFailure, CONNECTED, thing);
    expect(notImplemented).toContain('Not implemented by the emulator');
    expect(notImplemented).toContain(
      `The emulator answered 501 Not Implemented for ListQueues, so Studio cannot show the ${thing}.`,
    );

    const denied = shownState(FAILURES['access denied'] as RequestFailure, CONNECTED, thing);
    expect(denied).toContain('Access denied');
    expect(denied).toContain('ListQueues was refused: User is not allowed');

    const emulator = shownState(FAILURES['emulator not answering'] as RequestFailure, CONNECTED, thing);
    expect(emulator).toContain('The emulator did not answer');
    expect(emulator).toContain('timed out');

    const engine = shownState(FAILURES['engine not answering'] as RequestFailure, CONNECTED, thing);
    expect(engine).toContain(`The EmuForge engine at ${ENGINE_ORIGIN} did not answer`);

    const other = shownState(FAILURES['any other code'] as RequestFailure, CONNECTED, thing);
    expect(other).toContain(`The ${thing} could not be read`);
    expect(other).toContain('InvalidAddress: bad <b>');

    for (const text of [notImplemented, denied, emulator, engine, other]) {
      expect(text).not.toContain('Connection status');
      expect(text).toContain('Retry');
    }
  });

  it('gives the first line as text for its announcement', () => {
    const state = readFailureState(FAILURES['engine not answering'] as RequestFailure, CONNECTED, 'queue');
    expect(state.firstText).toBe(`The EmuForge engine at ${ENGINE_ORIGIN} did not answer`);
  });
});

describe('a failed read, not connected', () => {
  const lines: [string, CheckResult, string][] = [
    [
      'not started',
      { kind: 'emulator-unreachable', checkedAt: 1, emulator: EMULATOR, reason: 'not_started', message: '' },
      'Not started on port 4566',
    ],
    [
      'not answering',
      { kind: 'emulator-unreachable', checkedAt: 1, emulator: EMULATOR, reason: 'timeout', message: '' },
      `Not answering at ${EMULATOR.endpoint}`,
    ],
    [
      'engine unreachable',
      { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: undefined },
      `The EmuForge engine at ${ENGINE_ORIGIN} is not answering`,
    ],
    [
      'engine error with a code',
      { kind: 'engine-error', checkedAt: 1, status: 500, code: 'Broken', message: undefined },
      'The EmuForge engine answered with an error: Broken',
    ],
    [
      'engine error without a code',
      { kind: 'engine-error', checkedAt: 1, status: 502, code: undefined, message: undefined },
      'The EmuForge engine answered with HTTP status 502',
    ],
  ];

  it.each(lines)('%s → the emulator line’s words, the thing not read and "Connection status"', (_, result, words) => {
    const connection: AreaConnection = { result, engineOrigin: ENGINE_ORIGIN };
    for (const kind of ['emulator not answering', 'engine not answering', 'any other code']) {
      const failure = FAILURES[kind] as RequestFailure;
      const text = shownState(failure, connection, 'queue list');
      expect(text).toContain(words);
      expect(text).toContain('The queue list could not be read.');
      expect(text).toContain('Connection status');
      expect(readFailureState(failure, connection, 'queue list').firstText).toBe(words);
    }
  });

  it('keeps 501 and AccessDenied as their own states', () => {
    const connection: AreaConnection = {
      result: { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: undefined },
      engineOrigin: ENGINE_ORIGIN,
    };
    expect(shownState(FAILURES['not implemented'] as RequestFailure, connection, 'queue')).toContain(
      'Not implemented by the emulator',
    );
    const denied = shownState(FAILURES['access denied'] as RequestFailure, connection, 'queue');
    expect(denied).toContain('Access denied');
    expect(denied).not.toContain('Connection status');
  });
});

describe('a failed action', () => {
  function item(failure: RequestFailure): { type: string; header: string; content: string } {
    const flash = actionFailureItem(failure, 'Sending the message', ENGINE_ORIGIN);
    return { type: flash.type, header: show(<>{flash.header}</>), content: show(<>{flash.content}</>) };
  }

  it('gives each kind its item', () => {
    expect(item(FAILURES['not implemented'] as RequestFailure)).toEqual({
      type: 'info',
      header: 'Not implemented by the emulator',
      content: 'The emulator answered 501 Not Implemented for ListQueues.',
    });
    expect(item(FAILURES['access denied'] as RequestFailure)).toEqual({
      type: 'error',
      header: 'Access denied',
      content: 'ListQueues was refused: User is not allowed',
    });
    expect(item(FAILURES['emulator not answering'] as RequestFailure)).toEqual({
      type: 'error',
      header: 'The emulator did not answer',
      content: 'timed out',
    });
    expect(item(FAILURES['engine not answering'] as RequestFailure)).toEqual({
      type: 'error',
      header: `The EmuForge engine at ${ENGINE_ORIGIN} did not answer`,
      content: '',
    });
    expect(item(FAILURES['any other code'] as RequestFailure)).toEqual({
      type: 'error',
      header: 'Sending the message failed',
      content: 'InvalidAddress: bad <b>',
    });
  });

  it('gives the code alone when the answer had no message', () => {
    expect(item({ kind: 'other', operation: 'PurgeQueue', code: 'HTTP 500' }).content).toBe('HTTP 500');
  });
});

describe('the announcer', () => {
  it('announces the same text twice', () => {
    const { result } = renderHook(() => useAnnouncer());
    const view = render(<>{result.current[0]}</>);
    const spans: Element[] = [];

    act(() => {
      result.current[1]('Queue list loaded');
    });
    view.rerender(<>{result.current[0]}</>);
    spans.push(screen.getByText('Queue list loaded'));

    act(() => {
      result.current[1]('Queue list loaded');
    });
    view.rerender(<>{result.current[0]}</>);
    const again = screen.getByText('Queue list loaded');

    expect(again).not.toBe(spans[0]);
    expect(again.closest('[aria-live="polite"]')).not.toBeNull();
  });
});
