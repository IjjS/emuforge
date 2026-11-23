import Alert from '@cloudscape-design/components/alert';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import type { LifecycleAction } from './use-lifecycle-action';

export function LifecycleFeedback({
  action,
  connection,
  what,
}: {
  action: LifecycleAction;
  connection: AreaConnection;
  what: string;
}) {
  if (action.failure === undefined) return null;
  const { header, content } = actionFailureItem(action.failure, what, connection.engineOrigin);
  return (
    <Alert type={action.failure.kind === 'not-implemented' ? 'info' : 'error'} header={header}>
      {content}
    </Alert>
  );
}
