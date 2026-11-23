import Alert from '@cloudscape-design/components/alert';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import { actionFailureItem } from '../../../../components/failure-states';

export function ActionNotice({ failure, endpoint }: { failure: RequestFailure; endpoint: string | undefined }) {
  const { type, header, content } = actionFailureItem(failure, failure.operation, endpoint);
  return (
    <Alert type={type} header={header}>
      {content}
    </Alert>
  );
}
