import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState } from '../../../components/failure-states';
import type { Delivery } from '../api';
import { NONE } from '../format';
import type { SnsRead } from '../queries';

// The "Delivery" of one subscription (issue 536, design task 1 step 4): whether the policy of the subscribed queue or
// function lets the topic deliver, as a `StatusIndicator`. A row of another protocol than `sqs` or `lambda` has none.

/** What a row's "Delivery" shows. */
export type DeliveryView =
  /** A row of another protocol: no delivery is read. */
  | { kind: 'other-protocol' }
  /** The delivery is being read. */
  | { kind: 'checking' }
  /** The delivery as read. */
  | { kind: 'read'; delivery: Delivery }
  /** The read failed. */
  | { kind: 'failed'; failure: RequestFailure };

/** The view of a delivery read. */
// eslint-disable-next-line react-refresh/only-export-components -- the view and the component that shows it are one module (breakdown s2)
export function deliveryView(read: SnsRead<Delivery>): DeliveryView {
  if (read.loading) {
    return { kind: 'checking' };
  }
  if (read.failure !== undefined) {
    return { kind: 'failed', failure: read.failure };
  }
  return read.value === undefined ? { kind: 'checking' } : { kind: 'read', delivery: read.value };
}

const WORDS: Record<Delivery['kind'], { type: StatusIndicatorProps.Type; words: string }> = {
  allowed: { type: 'success', words: 'Allowed' },
  none: { type: 'warning', words: 'No permission' },
  unknown: { type: 'info', words: 'Cannot tell' },
  'queue-not-found': { type: 'error', words: 'Queue not found' },
  'function-not-found': { type: 'error', words: 'Function not found' },
};

/** The words and status type a view shows; `undefined` for a row of another protocol. */
// eslint-disable-next-line react-refresh/only-export-components -- the view and the component that shows it are one module (breakdown s2)
export function deliveryWords(
  view: DeliveryView,
  connection: AreaConnection,
): { type: StatusIndicatorProps.Type; words: string } | undefined {
  switch (view.kind) {
    case 'other-protocol':
      return undefined;
    case 'checking':
      return { type: 'loading', words: 'Checking' };
    case 'read':
      return WORDS[view.delivery.kind];
    case 'failed':
      return { type: 'error', words: readFailureState(view.failure, connection, 'delivery').firstText };
  }
}

export interface DeliveryStatusProps {
  view: DeliveryView;
  connection: AreaConnection;
}

export function DeliveryStatus({ view, connection }: DeliveryStatusProps) {
  const shown = deliveryWords(view, connection);
  if (shown === undefined) {
    return <>{NONE}</>;
  }
  return <StatusIndicator type={shown.type}>{shown.words}</StatusIndicator>;
}
