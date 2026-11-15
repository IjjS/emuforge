// Facts about a check's state that Home's pieces share.
import type { CheckResult } from '../../lib/engine/engine-client';

/** Whether the state of `result` shows a notice; only Checking and Connected show none. */
export function hasNotice(result: CheckResult | undefined): boolean {
  return result !== undefined && result.kind !== 'connected';
}
