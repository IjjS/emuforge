import Box from '@cloudscape-design/components/box';
import type { ReactNode } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { FlashType } from '../../../components/page-flash';
import { ValueText, type ValueKind } from '../../../components/value-text';

// A failed action of a bucket's screens (issue 256, requirement R11.4): S2's requests, S3's emptying and S4's
// `DeleteBucket` report a failure where R6.6, R7.4 and R8.6 say, never as a state of the page. EmuForge's own words;
// codes, messages and the engine's origin are text as they came, each breaking as the kind of value it is (issue 467,
// requirement R6): a message as free text, a code as a name, the engine's origin as an address.

/** A failed action as shown: its type, its first line, and the line after it where the row has one. */
export interface ActionFailure {
  type: Extract<FlashType, 'error' | 'info'>;
  /** The first line, as it is announced. */
  headline: string;
  /** The first line as shown: the engine's origin as code. */
  header: ReactNode;
  detail?: ReactNode;
}

/** A code (a name) or an origin (an address), as code. */
function asCode(text: string, kind: ValueKind): ReactNode {
  return (
    <Box variant="code" display="inline">
      <ValueText kind={kind} value={text} />
    </Box>
  );
}

/** A sentence or a message as it came, as free text. */
function asText(text: string): ReactNode {
  return <ValueText kind="text" value={text} />;
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
        detail: asText(`The emulator answered 501 Not Implemented for ${failure.operation}.`),
      };
    case 'access-denied':
      return {
        type: 'error',
        headline: 'Access denied',
        header: 'Access denied',
        detail: asText(`${failure.operation} was refused: ${failure.message}`),
      };
    case 'emulator-did-not-answer':
      return {
        type: 'error',
        headline: 'The emulator did not answer',
        header: 'The emulator did not answer',
        detail: asText(failure.message),
      };
    case 'engine-did-not-answer': {
      const origin = engineOrigin ?? '';
      return {
        type: 'error',
        headline: `The EmuForge engine at ${origin} did not answer`,
        header: <>The EmuForge engine at {asCode(origin, 'address')} did not answer</>,
      };
    }
    case 'other':
      return {
        type: 'error',
        headline: `${what} failed`,
        header: `${what} failed`,
        detail: (
          <>
            {asCode(failure.code, 'name')}
            {failure.message === undefined ? null : asText(`: ${failure.message}`)}
          </>
        ),
      };
  }
}
