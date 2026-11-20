import { ConfirmDialog } from '../../../components/confirm-dialog';

// "Delete DB instance?" (issue 573, requirement "EmuForge's own text"): the area's dialog confirmed by typing
// `delete`, naming the DB instance. It writes nothing: the page that opened it holds the request.

export interface DeleteInstanceDialogProps {
  visible: boolean;
  /** The DB instance's identifier. */
  id: string;
  /** The request is in flight: neither button acts. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DeleteInstanceDialog({ visible, id, pending, onConfirm, onDismiss }: DeleteInstanceDialogProps) {
  return (
    <ConfirmDialog
      visible={visible}
      header="Delete DB instance?"
      body={`${id} is deleted from the local emulator with no final snapshot. This cannot be undone.`}
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
