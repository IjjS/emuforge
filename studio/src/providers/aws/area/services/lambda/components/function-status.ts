import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';

import type { LambdaFunction } from '../api';

// The status of a function's page while the function is not ready (issue 84, requirement R5.2), in EmuForge's own
// words. The reason is the emulator's, shown as it came, as text (`FunctionStatusLine` of `function-sections.tsx`).

/** What the page shows under its description; none while the function is ready. */
export interface FunctionStatus {
  type: StatusIndicatorProps.Type;
  /** The status in EmuForge's words, as shown and as announced. */
  text: string;
  /** `StateReason` or `LastUpdateStatusReason`, as it came, for the statuses that show one. */
  reason?: string;
}

function withReason(status: Omit<FunctionStatus, 'reason'>, reason: string | undefined): FunctionStatus {
  return reason === undefined || reason === '' ? status : { ...status, reason };
}

/**
 * The status of `fn` (R5.2): `Pending` "Being created", `Inactive` "Inactive" and `Failed` "Failed" with the state's
 * reason; `Active` while its last update is `InProgress` "Being updated", `Failed` "Last update failed" with that
 * update's reason; otherwise none.
 */
export function functionStatus(fn: LambdaFunction): FunctionStatus | undefined {
  switch (fn.state) {
    case 'Pending':
      return { type: 'in-progress', text: 'Being created' };
    case 'Inactive':
      return withReason({ type: 'stopped', text: 'Inactive' }, fn.stateReason);
    case 'Failed':
      return withReason({ type: 'error', text: 'Failed' }, fn.stateReason);
    case 'Active':
      if (fn.lastUpdateStatus === 'InProgress') {
        return { type: 'in-progress', text: 'Being updated' };
      }
      if (fn.lastUpdateStatus === 'Failed') {
        return withReason({ type: 'error', text: 'Last update failed' }, fn.lastUpdateStatusReason);
      }
      return undefined;
    default:
      return undefined;
  }
}
