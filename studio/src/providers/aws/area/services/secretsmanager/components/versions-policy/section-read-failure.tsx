import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import { useId, type Ref } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../../components/failure-states';

export function SectionReadFailure({
  failure,
  connection,
  resource,
  onRetry,
  noticeRef,
}: {
  failure: RequestFailure;
  connection: AreaConnection;
  resource: string;
  onRetry: () => void;
  noticeRef?: Ref<HTMLDivElement>;
}) {
  const titleId = useId();
  const messageId = useId();
  const state = readFailureState(failure, connection, resource);
  if (failure.kind === 'not-implemented') {
    const alert = (
      <Alert type="info" header={<span id={titleId}>{state.first}</span>} action={<Button disabled>Retry</Button>}>
        <span id={messageId}>{state.detail}</span>
      </Alert>
    );
    return noticeRef === undefined ? (
      alert
    ) : (
      <div ref={noticeRef} role="region" tabIndex={-1} aria-labelledby={titleId} aria-describedby={messageId}>
        {alert}
      </div>
    );
  }
  return <ReadFailure state={state} onRetry={onRetry} />;
}
