import '../styles/emulator-line.css';

import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import { useCallback, useState, type ReactNode } from 'react';

import type { RequestFailure } from '../../../../lib/aws/request';
import type { AreaConnection } from './emulator-line';
import type { FlashItem } from './page-flash';
import { useFollow } from './use-follow';

// The failures of the area's screens in EmuForge's own words (issue 481, lifted from Lambda's of issue 84 when SQS
// became the fourth service to need them): the state a failed read shows in the place of its data, the Flashbar
// item of an action that failed, and a page's polite announcements, over the shared `RequestFailure` of
// `lib/aws/request.ts`. Codes and messages are the answer's, rendered as text.

/** Inline code, as the emulator line writes an endpoint or an origin. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <Box variant="code" display="inline">
      {children}
    </Box>
  );
}

/** "`{code}`: {message}", or the code alone when the answer had no message. */
export function CodeAndMessage({ code, message }: { code: string; message: string | undefined }) {
  return message === undefined ? (
    <Code>{code}</Code>
  ) : (
    <>
      <Code>{code}</Code>: {message}
    </>
  );
}

/** The emulator line's status for a connection that is not connected, in the line's words and status type. */
interface ConnectionStatus {
  type: StatusIndicatorProps.Type;
  before: string;
  value: string;
  after?: string;
}

/**
 * The emulator line's status for `connection` (`aws-area.md`, "The emulator line"): what a failed read repeats while
 * the connection is not connected. `undefined` while the line says "Checking" or connected.
 */
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

/** The state of a failed read, as shown and as announced. */
export interface ReadFailureState {
  type: StatusIndicatorProps.Type;
  /** The first line, as shown. */
  first: ReactNode;
  /** The first line as text: what is announced once. */
  firstText: string;
  /** What follows it: the sentence of the state, or the message as it came. */
  detail: ReactNode;
  /** The link "Connection status", in the "not connected" state. */
  recovery: boolean;
}

/**
 * The state of a failed read of `thing` ("queue list", "queue", "function list"), the rows tried top to bottom: the
 * answer's own meaning first (501, `AccessDenied`), then the connection while it is not connected, then the kind
 * of failure.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the states and the components that write them are one module (breakdown s1)
export function readFailureState(failure: RequestFailure, connection: AreaConnection, thing: string): ReadFailureState {
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

/** A failed read in the place of its data, with Cloudscape's status and a "Retry". */
export function ReadFailure({ state, onRetry }: { state: ReadFailureState; onRetry: () => void }) {
  const handleFollow = useFollow();
  return (
    <Box textAlign="center" color="inherit">
      <SpaceBetween size="xxs">
        <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
        {state.detail !== undefined && (
          <Box variant="p" color="inherit">
            {state.detail}
          </Box>
        )}
        {state.recovery && (
          <Link href="/" onFollow={handleFollow}>
            Connection status
          </Link>
        )}
      </SpaceBetween>
      <Box margin={{ top: 's' }}>
        <Button onClick={onRetry}>Retry</Button>
      </Box>
    </Box>
  );
}

/**
 * The Flashbar item of an action that failed: `what` names the step in the item of any other failure ("Sending the
 * message", "Purging orders"); `engineOrigin` is the engine's address the page is configured with.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the states and the components that write them are one module (breakdown s1)
export function actionFailureItem(failure: RequestFailure, what: string, engineOrigin: string | undefined): FlashItem {
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

/** A page's polite announcements: each one a new element, so the same text is said again. */
// eslint-disable-next-line react-refresh/only-export-components -- the states and the components that write them are one module (breakdown s1)
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
