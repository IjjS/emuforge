// Facts about a check's state that Home's pieces share.
import type { CheckResult } from '../../lib/engine/engine-client';

/** Whether the state of `result` shows a notice; only Checking and Connected show none. */
export function hasNotice(result: CheckResult | undefined): boolean {
  return result !== undefined && result.kind !== 'connected';
}

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** The local time of a check, `16:05:12`. */
export function formatCheckTime(checkedAt: number): string {
  return TIME.format(new Date(checkedAt));
}
