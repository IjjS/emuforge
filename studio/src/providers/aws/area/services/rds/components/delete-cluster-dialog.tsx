import { ConfirmDialog } from '../../../components/confirm-dialog';

// "Delete DB cluster?" (issue 573, requirement "EmuForge's own text"): the area's dialog confirmed by typing `delete`,
// naming the DB cluster. It writes nothing: the page that opened it holds the request.

export interface DeleteClusterDialogProps {
  visible: boolean;
  /** The DB cluster's identifier. */
  id: string;
  /** The request is in flight: neither button acts. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DeleteClusterDialog({ visible, id, pending, onConfirm, onDismiss }: DeleteClusterDialogProps) {
  return (
    <ConfirmDialog
      visible={visible}
      header="Delete DB cluster?"
      body={`${id} is deleted from the local emulator with no final snapshot. This cannot be undone.`}
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
