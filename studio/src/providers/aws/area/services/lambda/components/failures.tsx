import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactNode } from 'react';

import { useFollow } from '../../../components/use-follow';
import type { ReadFailureState } from './failure-states';

// The components of the Lambda screens' failures (issue 84, requirement R10): inline code, a code with its message,
// and a failed read in the place of its data. The states themselves are `failure-states.tsx`.

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

/** A failed read in the place of its data, with Cloudscape's status and a "Retry" (R10.1). */
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
