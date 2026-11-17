import Box from '@cloudscape-design/components/box';
import type { ReactNode } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { FlashType } from '../../../components/page-flash';
import { BreakAnywhere } from './break-anywhere';

// A failed action of a bucket's screens (issue 256, requirement R11.4): S2's requests, S3's emptying and S4's
// `DeleteBucket` report a failure where R6.6, R7.4 and R8.6 say, never as a state of the page. EmuForge's own words;
// codes, messages and the engine's origin are text as they came, and a long one breaks inside its box.

/** A failed action as shown: its type, its first line, and the line after it where the row has one. */
export interface ActionFailure {
  type: Extract<FlashType, 'error' | 'info'>;
  /** The first line, as it is announced. */
  headline: string;
  /** The first line as shown: the engine's origin as code. */
  header: ReactNode;
  detail?: ReactNode;
}

/** A code or an origin, as code, breaking inside its box. */
function asCode(text: string): ReactNode {
  return (
    <Box variant="code" display="inline">
      <BreakAnywhere>{text}</BreakAnywhere>
    </Box>
  );
}

/**
 * The failure of the action `what` ("Creating the bucket", "Deleting the bucket", …) as R11.4 shows it: 501 as
 * information naming the operation; `AccessDenied` with the message returned; the engine's `EmulatorUnavailable` or
 * `EmulatorTimeout` with the engine's message; no answer from the engine with its origin; any other answer as
 * "{what} failed" and "`code`: message".
 */
export function actionFailure(failure: RequestFailure, what: string, engineOrigin: string | undefined): ActionFailure {
  switch (failure.kind) {
    case 'not-implemented':
      return {
        type: 'info',
        headline: 'Not implemented by the emulator',
        header: 'Not implemented by the emulator',
        detail: <BreakAnywhere>{`The emulator answered 501 Not Implemented for ${failure.operation}.`}</BreakAnywhere>,
      };
    case 'access-denied':
      return {
        type: 'error',
        headline: 'Access denied',
        header: 'Access denied',
        detail: <BreakAnywhere>{`${failure.operation} was refused: ${failure.message}`}</BreakAnywhere>,
      };
    case 'emulator-did-not-answer':
      return {
        type: 'error',
        headline: 'The emulator did not answer',
        header: 'The emulator did not answer',
        detail: <BreakAnywhere>{failure.message}</BreakAnywhere>,
      };
    case 'engine-did-not-answer': {
      const origin = engineOrigin ?? '';
      return {
        type: 'error',
        headline: `The EmuForge engine at ${origin} did not answer`,
        header: <>The EmuForge engine at {asCode(origin)} did not answer</>,
      };
    }
    case 'other':
      return {
        type: 'error',
        headline: `${what} failed`,
        header: `${what} failed`,
        detail: (
          <>
            {asCode(failure.code)}
            {failure.message === undefined ? null : <BreakAnywhere>{`: ${failure.message}`}</BreakAnywhere>}
          </>
        ),
      };
  }
}
