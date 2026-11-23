import Box from '@cloudscape-design/components/box';

import {
  reportedNotImplementedMessage,
  reportedServiceCode,
  type RequestFailure,
} from '../../../../../../lib/aws/request';
import { ValueText } from '../../../components/value-text';
import { actionFailure } from './action-failure';

export function versionFailure(failure: RequestFailure, label: string, endpoint: string | undefined) {
  const view = actionFailure(failure, label, endpoint);
  const code = failure.kind === 'other' ? undefined : reportedServiceCode(failure);
  const message = reportedNotImplementedMessage(failure);
  return {
    ...view,
    detail: (
      <>
        {code !== undefined && (
          <>
            <Box variant="code" display="inline">
              <ValueText kind="name" value={code} />
            </Box>{' '}
          </>
        )}
        {view.detail}
        {message !== undefined && (
          <>
            {' '}
            <ValueText kind="text" value={message} />
          </>
        )}
      </>
    ),
  };
}
