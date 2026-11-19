import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import type { ValueKind } from '../../../components/value-text';
import { NO_SUCH_BUCKET, type NoSuchBucket } from '../api';

// The states of a failed read of a bucket's screens (issue 256, requirement R11.1 to R11.3), as data: what a page
// (S1, S3, S4) shows in place of its content, and what a section of S1 shows in place of its values. Codes, messages,
// origins and ports are text as they came; the components of `bucket-read-state.tsx` render them.

/**
 * One line of a state: text, then a value shown as code (an origin, a port, a code), then text. The text around it is
 * free text; the value breaks as the kind it is (issue 467, requirement R6): an origin or an endpoint as an address,
 * a code as a name, a port or a status as a fixed word.
 */
export interface StateLine {
  before: string;
  code?: string;
  /** How `code` breaks; a name when not given. */
  codeKind?: ValueKind;
  after?: string;
}

/** The line as one text, as it is announced. */
export function lineText({ before, code, after }: StateLine): string {
  return `${before}${code ?? ''}${after ?? ''}`;
}

/** A failed read as shown: its status and first line, the line after it, and whether "Connection status" follows. */
export interface FailureView {
  type: StatusIndicatorProps.Type;
  first: StateLine;
  detail?: StateLine;
  /** The link "Connection status" to Home, in the state "Not connected". */
  recovery: boolean;
}

/** The emulator line's status: its line and its Cloudscape status type. */
export interface ConnectionStatus extends StateLine {
  type: StatusIndicatorProps.Type;
}

/**
 * The emulator line's status for a connection, in the same words and with the same Cloudscape status type
 * (`studio/AGENTS.md`, "The emulator line"); `undefined` while the line says "Checking" or connected.
 */
export function connectionStatus({ result, engineOrigin }: AreaConnection): ConnectionStatus | undefined {
  switch (result?.kind) {
    case undefined:
    case 'connected':
      return undefined;
    case 'emulator-unreachable':
      return result.reason === 'not_started'
        ? { type: 'stopped', before: 'Not started on port ', code: String(result.emulator.port), codeKind: 'fixed' }
        : { type: 'error', before: 'Not answering at ', code: result.emulator.endpoint, codeKind: 'address' };
    case 'engine-unreachable':
      return engineOrigin === undefined
        ? undefined
        : {
            type: 'error',
            before: 'The EmuForge engine at ',
            code: engineOrigin,
            codeKind: 'address',
            after: ' is not answering',
          };
    case 'engine-error':
      return result.code === undefined
        ? {
            type: 'error',
            before: 'The EmuForge engine answered with HTTP status ',
            code: String(result.status),
            codeKind: 'fixed',
          }
        : { type: 'error', before: 'The EmuForge engine answered with an error: ', code: result.code };
  }
}

/** "`code`: message", or the code alone when the answer has no message. */
function codeLine(code: string, message: string | undefined): StateLine {
  return message === undefined ? { before: '', code } : { before: '', code, after: `: ${message}` };
}

const COULD_NOT_READ = 'The bucket could not be read';

/**
 * The state of a failed read of a page (R11.1), the rows tried top to bottom (R11.2): the answer's own meaning
 * first, then the connection, then the kinds of failure while the line says connected or "Checking". `couldNotRead`
 * names what was not read ("The bucket could not be read").
 */
export function pageFailure(
  failure: RequestFailure,
  connection: AreaConnection,
  couldNotRead: string = COULD_NOT_READ,
): FailureView {
  if (failure.kind === 'not-implemented') {
    return {
      type: 'info',
      first: { before: 'Not implemented by the emulator' },
      detail: {
        before: `The emulator answered 501 Not Implemented for ${failure.operation}, so Studio cannot show the bucket.`,
      },
      recovery: false,
    };
  }
  if (failure.kind === 'access-denied') {
    return {
      type: 'error',
      first: { before: 'Access denied' },
      detail: { before: `${failure.operation} was refused: ${failure.message}` },
      recovery: false,
    };
  }
  const status = connectionStatus(connection);
  if (status !== undefined) {
    const { type, ...first } = status;
    return { type, first, detail: { before: `${couldNotRead}.` }, recovery: true };
  }
  switch (failure.kind) {
    case 'emulator-did-not-answer':
      return {
        type: 'error',
        first: { before: 'The emulator did not answer' },
        detail: { before: failure.message },
        recovery: false,
      };
    case 'engine-did-not-answer':
      return {
        type: 'error',
        first: {
          before: 'The EmuForge engine at ',
          code: connection.engineOrigin ?? '',
          codeKind: 'address',
          after: ' did not answer',
        },
        recovery: false,
      };
    case 'other':
      return {
        type: 'error',
        first: { before: couldNotRead },
        detail: codeLine(failure.code, failure.message),
        recovery: false,
      };
  }
}

/** What a page of a bucket shows of its read (R11.1): the read in flight, its failure, no such bucket, or the page. */
export type PageState<T> =
  { kind: 'loading' } | { kind: 'failure'; view: FailureView } | { kind: 'not-found' } | { kind: 'loaded'; value: T };

/** The state of a page's read, `value` being what the read found or `NO_SUCH_BUCKET` (R5.5). */
export function pageState<T>(
  read: { value: T | NoSuchBucket | undefined; failure: RequestFailure | undefined },
  connection: AreaConnection,
): PageState<T> {
  if (read.failure !== undefined) {
    return { kind: 'failure', view: pageFailure(read.failure, connection) };
  }
  if (read.value === undefined) {
    return { kind: 'loading' };
  }
  return read.value === NO_SUCH_BUCKET ? { kind: 'not-found' } : { kind: 'loaded', value: read.value };
}

/**
 * The state of a section of S1 whose own read failed (R11.3): the first line of the row of R11.1 that fits, for
 * "Not connected" "Not read" with the line's status type, the row's second line where it has one, and no link; a
 * 501 names the operation alone.
 */
export function sectionFailure(failure: RequestFailure, connection: AreaConnection): FailureView {
  if (failure.kind === 'not-implemented') {
    return {
      type: 'info',
      first: { before: 'Not implemented by the emulator' },
      detail: { before: failure.operation },
      recovery: false,
    };
  }
  const view = pageFailure(failure, connection);
  return view.recovery ? { type: view.type, first: { before: 'Not read' }, recovery: false } : view;
}
