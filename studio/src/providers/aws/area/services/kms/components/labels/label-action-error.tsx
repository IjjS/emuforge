import Alert from '@cloudscape-design/components/alert';

import type { FlashItem } from '../../../../components/page-flash';

export function LabelActionError({ failure }: { failure: FlashItem | undefined }) {
  if (failure === undefined) return null;
  return (
    <div role="alert">
      <Alert type="error" header={failure.header}>
        {failure.content}
      </Alert>
    </div>
  );
}
