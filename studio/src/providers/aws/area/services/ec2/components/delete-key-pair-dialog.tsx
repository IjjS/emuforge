import { ConfirmDialog } from '../../../components/confirm-dialog';
import { NameText } from '../../../components/name-text';
import { ValueText } from '../../../components/value-text';

// "Delete key pair?" (issue 553, requirement "Delete a key pair"), from S8: the area's dialog confirmed by typing
// `delete`. It names the key pair and says an instance that names it keeps the name, as the emulator does.

export interface DeleteKeyPairDialogProps {
  visible: boolean;
  /** The key pair's name. */
  name: string;
  /** `DeleteKeyPair` is in flight: neither button acts, and the dialog stays. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DeleteKeyPairDialog({ visible, name, pending, onConfirm, onDismiss }: DeleteKeyPairDialogProps) {
  return (
    <ConfirmDialog
      visible={visible}
      header="Delete key pair?"
      body={
        <>
          <NameText name={name} />
          <ValueText
            kind="text"
            value=" is deleted from the local emulator. This cannot be undone. An instance that names it keeps the name."
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
