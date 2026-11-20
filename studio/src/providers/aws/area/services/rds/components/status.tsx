import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';

import { ValueText } from '../../../components/value-text';
import { NONE } from '../format';
import { statusKind, type StatusKind } from '../status';

// A DB instance's or DB cluster's status as the screens show it (issue 573, requirement "Status and its changes"):
// the word as the API names it, with Cloudscape's status of its kind. Any other status is shown as it came, as text,
// with no status claimed.

const STATUS: Readonly<Record<StatusKind, StatusIndicatorProps.Type>> = {
  success: 'success',
  stopped: 'stopped',
  'in-progress': 'in-progress',
};

export function StatusValue({ status }: { status: string }) {
  if (status === '') {
    return <>{NONE}</>;
  }
  const kind = statusKind(status);
  if (kind === undefined) {
    return <ValueText kind="fixed" value={status} />;
  }
  return (
    <StatusIndicator type={STATUS[kind]}>
      <ValueText kind="fixed" value={status} />
    </StatusIndicator>
  );
}
