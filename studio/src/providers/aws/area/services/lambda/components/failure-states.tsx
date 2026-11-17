import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import { useCallback, useState, type ReactNode } from 'react';

import '../../../styles/emulator-line.css';
import type { AreaConnection } from '../../../components/emulator-line';
import type { FlashItem } from '../../../components/page-flash';
import type { LambdaFailure } from '../api';
import { Code, CodeAndMessage } from './failures';

// The failures of the Lambda screens in EmuForge's own words (issue 84, requirement R10): the state a failed read
// shows in the place of its data (R10.1), the Flashbar item of an action that failed (R10.3), and the page's polite
// announcements. Codes and messages are the answer's, rendered as text.

/**
 * The emulator line's status for a connection, in the same words and with the same Cloudscape status type
 * (`studio/AGENTS.md`, "The emulator line"): what a failed read repeats while the connection is not connected.
 * `undefined` while the line says "Checking" or connected.
 */
interface ConnectionStatus {
  type: StatusIndicatorProps.Type;
  before: string;
  value: string;
  after?: string;
}

function connectionStatus({ result, engineOrigin }: AreaConnection): ConnectionStatus | undefined {
  switch (result?.kind) {
    case undefined:
    case 'connected':
      return undefined;
    case 'emulator-unreachable':
      return result.reason === 'not_started'
        ? { type: 'stopped', before: 'Not started on port ', value: String(result.emulator.port) }
        : { type: 'error', before: 'Not answering at ', value: result.emulator.endpoint };
    case 'engine-unreachable':
      return engineOrigin === undefined
        ? undefined
        : { type: 'error', before: 'The EmuForge engine at ', value: engineOrigin, after: ' is not answering' };
    case 'engine-error':
      return result.code === undefined
        ? { type: 'error', before: 'The EmuForge engine answered with HTTP status ', value: String(result.status) }
        : { type: 'error', before: 'The EmuForge engine answered with an error: ', value: result.code };
  }
}

/** The state of a failed read (R10.1), as shown and as announced. */
export interface ReadFailureState {
  type: StatusIndicatorProps.Type;
  /** The first line, as shown. */
  first: ReactNode;
  /** The first line as text: what is announced once (R10.2). */
  firstText: string;
  /** What follows it: the sentence of the state, or the message as it came. */
  detail: ReactNode;
  /** The link "Connection status", in the "not connected" state. */
  recovery: boolean;
}

/** What a read failed to bring, as the states' sentences name it: "function list" or "function". */
export type ReadThing = 'function list' | 'function';

/**
 * The state of a failed read of `thing` (R10.1), the rows tried top to bottom: the answer's own meaning first (501,
 * `AccessDenied`), then the connection while it is not connected, then the kind of failure.
 */
export function readFailureState(
  failure: LambdaFailure,
  connection: AreaConnection,
  thing: ReadThing,
): ReadFailureState {
  if (failure.kind === 'not-implemented') {
    return {
      type: 'info',
      first: 'Not implemented by the emulator',
      firstText: 'Not implemented by the emulator',
      detail: `The emulator answered 501 Not Implemented for ${failure.operation}, so Studio cannot show the ${thing}.`,
      recovery: false,
    };
  }
  if (failure.kind === 'access-denied') {
    return {
      type: 'error',
      first: 'Access denied',
      firstText: 'Access denied',
      detail: `${failure.operation} was refused: ${failure.message}`,
      recovery: false,
    };
  }
  const status = connectionStatus(connection);
  if (status !== undefined) {
    return {
      type: status.type,
      first: (
        <>
          {status.before}
          <Code>{status.value}</Code>
          {status.after}
        </>
      ),
      firstText: `${status.before}${status.value}${status.after ?? ''}`,
      detail: `The ${thing} could not be read.`,
      recovery: true,
    };
  }
  switch (failure.kind) {
    case 'emulator-did-not-answer':
      return {
        type: 'error',
        first: 'The emulator did not answer',
        firstText: 'The emulator did not answer',
        detail: failure.message === '' ? undefined : failure.message,
        recovery: false,
      };
    case 'engine-did-not-answer': {
      const origin = connection.engineOrigin ?? '';
      return {
        type: 'error',
        first: (
          <>
            The EmuForge engine at <Code>{origin}</Code> did not answer
          </>
        ),
        firstText: `The EmuForge engine at ${origin} did not answer`,
        detail: undefined,
        recovery: false,
      };
    }
    case 'other':
      return {
        type: 'error',
        first: `The ${thing} could not be read`,
        firstText: `The ${thing} could not be read`,
        detail: <CodeAndMessage code={failure.code} message={failure.message} />,
        recovery: false,
      };
  }
}

/**
 * The Flashbar item of an action that failed (R10.3): `what` names the step in the item of any other failure
 * ("Deleting orders", "Creating the function"); `engineOrigin` is the engine's address the page is configured with.
 */
export function actionFailureItem(failure: LambdaFailure, what: string, engineOrigin: string | undefined): FlashItem {
  switch (failure.kind) {
    case 'not-implemented':
      return {
        type: 'info',
        header: 'Not implemented by the emulator',
        content: `The emulator answered 501 Not Implemented for ${failure.operation}.`,
      };
    case 'access-denied':
      return {
        type: 'error',
        header: 'Access denied',
        content: `${failure.operation} was refused: ${failure.message}`,
      };
    case 'emulator-did-not-answer':
      return { type: 'error', header: 'The emulator did not answer', content: failure.message };
    case 'engine-did-not-answer':
      return {
        type: 'error',
        header: (
          <>
            The EmuForge engine at <Code>{engineOrigin ?? ''}</Code> did not answer
          </>
        ),
        content: undefined,
      };
    case 'other':
      return {
        type: 'error',
        header: `${what} failed`,
        content: <CodeAndMessage code={failure.code} message={failure.message} />,
      };
  }
}

/** The polite announcements of a page (R8, R10.2): each one a new element, so the same text is said again. */
export function useAnnouncer(): [ReactNode, (text: string) => void] {
  const [said, setSaid] = useState({ text: '', id: 0 });
  const announce = useCallback((text: string) => {
    setSaid((current) => ({ text, id: current.id + 1 }));
  }, []);
  const region = (
    // The area's visually hidden live region, as the emulator line's.
    <div className="aws-area-announcer" aria-live="polite" aria-atomic="true">
      {said.text !== '' && <span key={said.id}>{said.text}</span>}
    </div>
  );
  return [region, announce];
}
