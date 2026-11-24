import Alert from '@cloudscape-design/components/alert';
import { useEffect, useRef } from 'react';

import type { FlashItem } from '../../../../components/page-flash';

export function LabelActionError({ failure }: { failure: FlashItem | undefined }) {
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure !== undefined) alert.current?.focus();
  }, [failure]);

  if (failure === undefined) return null;
  return (
    <div ref={alert} role="alert" tabIndex={-1}>
      <Alert type="error" header={failure.header}>
        {failure.content}
      </Alert>
    </div>
  );
}
