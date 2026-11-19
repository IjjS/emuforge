import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ValueText } from '../../../components/value-text';

// "Delete topic?" (issue 536, design task 5 step 2), from S1 and S3: the area's `ConfirmDialog`, confirmed by typing
// `delete`. It names the topic and says its subscriptions are deleted with it.

export interface DeleteTopicDialogProps {
  visible: boolean;
  /** The topic's name. */
  name: string;
  /** `DeleteTopic` is in flight: neither button acts, and the dialog stays. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DeleteTopicDialog({ visible, name, pending, onConfirm, onDismiss }: DeleteTopicDialogProps) {
  return (
    <ConfirmDialog
      visible={visible}
      header="Delete topic?"
      body={
        <>
          <ValueText kind="name" value={name} />
          <ValueText
            kind="text"
            value=" and its subscriptions are deleted from the local emulator. This cannot be undone."
          />
        </>
      }
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
