import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';

import { ValueText } from '../../../../components/value-text';

function indicatorType(state: string): StatusIndicatorProps.Type {
  switch (state) {
    case 'Enabled':
      return 'success';
    case 'Disabled':
      return 'stopped';
    case 'PendingDeletion':
      return 'warning';
    default:
      return 'info';
  }
}

export function KeyState({ state }: { state: string | undefined }) {
  if (state === undefined || state === '') return <>–</>;
  return (
    <StatusIndicator type={indicatorType(state)}>
      <ValueText kind="fixed" value={state} />
    </StatusIndicator>
  );
}
