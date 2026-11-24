import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import { useEffect, useRef } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import { actionFailureItem } from '../../../../components/failure-states';

export function ActionNotice({
  failure,
  endpoint,
  focusOnFailure = false,
}: {
  failure: RequestFailure;
  endpoint: string | undefined;
  focusOnFailure?: boolean;
}) {
  const alert = useRef<AlertProps.Ref>(null);
  useEffect(() => {
    if (focusOnFailure) alert.current?.focus();
  }, [failure, focusOnFailure]);

  const { type, header, content } = actionFailureItem(failure, failure.operation, endpoint);
  const notice = (
    <Alert ref={alert} type={type} header={header}>
      {content}
    </Alert>
  );
  return focusOnFailure && type === 'error' ? <div role="alert">{notice}</div> : notice;
}
