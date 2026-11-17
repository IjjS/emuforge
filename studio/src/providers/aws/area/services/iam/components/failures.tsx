import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import type { ReactNode } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import type { FlashItem } from '../../../components/page-flash';
import type { IamFailure } from '../api';
import { Code } from './states';

// The states of the IAM screens' reads and the results of their actions (issue 82, requirement R10), in EmuForge's
// own words. Codes and messages from the engine or the emulator are untrusted text and are rendered as text.

/**
 * The emulator line's status for a connection, in the same words and with the same Cloudscape status type
 * (`studio/AGENTS.md`, "The emulator line"): what a failed read repeats while the connection is not connected
 * (R10.1). `undefined` while the line says "Checking" or connected.
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

/** The state of a read that failed (R10.1), as shown in the place of the data it failed to bring. */
export interface ReadFailureState {
  type: StatusIndicatorProps.Type;
  /** The first line, as shown and as announced. */
  first: ReactNode;
  firstText: string;
  /** What follows it: the sentence of the state, or the message as it came. */
  detail: ReactNode;
  /** The link "Connection status", in the "not connected" state. */
  recovery: boolean;
}

/** "`<code>`: <message>" as they came, or the code alone. */
function codeAndMessage(code: string, message: string | undefined): ReactNode {
  return message === undefined ? (
    <Code>{code}</Code>
  ) : (
    <>
      <Code>{code}</Code>: {message}
    </>
  );
}

/**
 * The state of a failed read of `thing` ("role list", "role", "policies", "policy list"), the rows of R10.1 tried top
 * to bottom: the answer's own meaning first, then the connection, then the kinds of failure while the line says
 * connected or "Checking".
 */
export function readFailureState(failure: IamFailure, connection: AreaConnection, thing: string): ReadFailureState {
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
        detail: failure.message,
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
    case 'other': {
      const first = `The ${thing} could not be read`;
      return {
        type: 'error',
        first,
        firstText: first,
        detail: codeAndMessage(failure.code, failure.message),
        recovery: false,
      };
    }
  }
}

/**
 * The Flashbar item of an action's request that failed (R10.3): `what` names the action for any other failure
 * ("Deleting {name}", "Creating the role", "Attaching {policy name} to {name}", "Updating {name}").
 */
export function actionFailureItem(failure: IamFailure, what: string, engineOrigin: string | undefined): FlashItem {
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
        content: (
          <>
            The EmuForge engine at <Code>{engineOrigin ?? ''}</Code> did not answer
          </>
        ),
      };
    case 'other':
      return { type: 'error', header: `${what} failed`, content: codeAndMessage(failure.code, failure.message) };
  }
}
