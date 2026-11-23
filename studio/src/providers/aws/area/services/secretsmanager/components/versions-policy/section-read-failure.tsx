import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../../components/failure-states';

export function SectionReadFailure({
  failure,
  connection,
  resource,
  onRetry,
}: {
  failure: RequestFailure;
  connection: AreaConnection;
  resource: string;
  onRetry: () => void;
}) {
  const state = readFailureState(failure, connection, resource);
  if (failure.kind === 'not-implemented') {
    return (
      <Alert type="info" header={state.first} action={<Button disabled>Retry</Button>}>
        {state.detail}
      </Alert>
    );
  }
  return <ReadFailure state={state} onRetry={onRetry} />;
}
