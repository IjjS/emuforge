import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import { useEffect, useId, useRef } from 'react';

import { OPERATIONS } from '../api';

export function NotificationLoadUnavailable({ focus = false }: { focus?: boolean }) {
  const region = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    if (focus) region.current?.focus();
  }, [focus]);
  return (
    <div ref={region} role="region" tabIndex={-1} aria-labelledby={titleId} aria-describedby={messageId}>
      <Alert
        type="info"
        header={<span id={titleId}>Not implemented by the emulator</span>}
        action={<Button disabled>Retry</Button>}
      >
        <span id={messageId}>
          The emulator answered 501 Not Implemented for {OPERATIONS.getBucketNotificationConfiguration}.
        </span>
      </Alert>
    </div>
  );
}
