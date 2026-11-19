import SpaceBetween from '@cloudscape-design/components/space-between';
import { Fragment } from 'react';

import { ValueText } from '../../../components/value-text';
import { ConfirmDialog } from '../../../components/confirm-dialog';

// "Delete" of a queue (issue 490, design task 8), from the queue list and from the queue's page: S2's `ConfirmDialog`,
// confirmed by typing `delete`, as every removal that cannot be undone asks (`aws-area.md`). On a dead-letter queue it
// names the queues whose redrive policies name it, which the emulator leaves as they are (requirement, probe-2 §5).

export interface DeleteQueueDialogProps {
  visible: boolean;
  name: string;
  /** The names of the queues it is the dead-letter queue of; `undefined` when they are not known. */
  sources: readonly string[] | undefined;
  /** `DeleteQueue` is in flight: neither button acts, and the dialog stays. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** The sentence that names a dead-letter queue's sources, each name a name value, joined ", ". */
function SourcesSentence({ sources }: { sources: readonly string[] }) {
  return (
    <span>
      <ValueText kind="text" value="It is the dead-letter queue of " />
      {sources.map((source, index) => (
        <Fragment key={source}>
          {index > 0 && ', '}
          <ValueText kind="name" value={source} />
        </Fragment>
      ))}
      <ValueText kind="text" value=". Their redrive policies keep naming it." />
    </span>
  );
}

export function DeleteQueueDialog({ visible, name, sources, pending, onConfirm, onDismiss }: DeleteQueueDialogProps) {
  return (
    <ConfirmDialog
      visible={visible}
      header={
        <>
          <ValueText kind="text" value="Delete " />
          <ValueText kind="name" value={name} />
          <ValueText kind="text" value="?" />
        </>
      }
      body={
        <SpaceBetween size="xs">
          <span>The queue and every message in it are deleted from the local emulator. This cannot be undone.</span>
          {sources !== undefined && sources.length > 0 && <SourcesSentence sources={sources} />}
        </SpaceBetween>
      }
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
