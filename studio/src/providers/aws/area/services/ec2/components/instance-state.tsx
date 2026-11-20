import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';

import { ValueText } from '../../../components/value-text';
import { NONE } from '../format';
import { stateKind, type StateKind } from '../instance-state';

// An instance's state as S1 and S3 show it (issue 553, requirement "State and its changes"): the word as the API
// names it, with Cloudscape's status of its kind. A state the list does not know is shown as it came, as text, with
// no status claimed.

const STATUS: Readonly<Record<StateKind, StatusIndicatorProps.Type>> = {
  success: 'success',
  stopped: 'stopped',
  'in-progress': 'in-progress',
};

export function InstanceStateValue({ state }: { state: string }) {
  if (state === '') {
    return <>{NONE}</>;
  }
  const kind = stateKind(state);
  if (kind === undefined) {
    return <ValueText kind="fixed" value={state} />;
  }
  return (
    <StatusIndicator type={STATUS[kind]}>
      <ValueText kind="fixed" value={state} />
    </StatusIndicator>
  );
}
