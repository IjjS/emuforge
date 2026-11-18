import Alert from '@cloudscape-design/components/alert';
import Link from '@cloudscape-design/components/link';

import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { queuePath, type RedrivePolicy } from '../format';

// The read warning of S2's "Messages" (issue 481, design task 2, step 1): shown directly above the read controls every
// time the tab is shown, never dismissible, in the requirement's words (probe-3 §1–§2).

/** The sentence said on every queue. */
export const READ_COUNTS = 'Reading counts as receiving: each message read here has its receive count raised by one.';

/** The sentence on a queue without a redrive policy. */
export const READ_STAYS = 'Messages read here stay in the queue.';

/** The warning before a read of a queue whose redrive policy is `policy` (none: `undefined`). */
export function ReadWarning({ policy }: { policy: RedrivePolicy | undefined }) {
  const handleFollow = useFollow();
  if (policy === undefined) {
    return (
      <Alert type="info">
        {READ_COUNTS} {READ_STAYS}
      </Alert>
    );
  }
  // A policy without a count of its own says nothing of when the move happens; the warning then names no number.
  const count = policy.maxReceiveCount === undefined ? 'the set number of' : String(policy.maxReceiveCount);
  return (
    <Alert type="warning">
      {READ_COUNTS} Once a message has been received {count} times in this queue, the next read moves it to{' '}
      <Link href={queuePath(policy.deadLetterQueue)} onFollow={handleFollow}>
        <ValueText kind="name" value={policy.deadLetterQueue} />
      </Link>{' '}
      instead of showing it. A message moved back keeps the receive count shown here, and is moved again after {count}{' '}
      more reads.
    </Alert>
  );
}
