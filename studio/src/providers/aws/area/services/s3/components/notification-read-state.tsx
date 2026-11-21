import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';

import { OPERATIONS } from '../api';

export function NotificationLoadUnavailable() {
  return (
    <Alert type="info" header="Not implemented by the emulator" action={<Button disabled>Retry</Button>}>
      The emulator answered 501 Not Implemented for {OPERATIONS.getBucketNotificationConfiguration}.
    </Alert>
  );
}
