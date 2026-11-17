import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactNode } from 'react';

import { useFollow } from '../../../components/use-follow';
import type { ReadFailureState } from './failures';

// The parts of the IAM screens' states (issue 82, requirement R10): a value shown as code, and a failed read's state
// with "Connection status" and "Retry". Their words are in `failures.tsx`.

/** A value the engine reported, shown as code. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <Box variant="code" display="inline">
      {children}
    </Box>
  );
}

/** A failure state with Cloudscape's empty-table pattern: the status, its detail, "Connection status", "Retry". */
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
