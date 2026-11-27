import { ConfirmDialog } from '../../../components/confirm-dialog';
import { NameText } from '../../../components/name-text';

// "Terminate instance?" (issue 553, requirement "EmuForge's own text", "Terminate"): the area's dialog confirmed by
// typing `terminate`, naming the instance by its name, or by its ID without one.

export interface TerminateDialogProps {
  visible: boolean;
  /** The instance's name, or its ID when it has none. */
  label: string;
  /** The request is in flight: neither button acts. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function TerminateDialog({ visible, label, pending, onConfirm, onDismiss }: TerminateDialogProps) {
  return (
    <ConfirmDialog
      visible={visible}
      header="Terminate instance?"
      body={
        <>
          <NameText name={label} />
          {' is terminated in the local emulator. This cannot be undone.'}
        </>
      }
      word="terminate"
      action="Terminate"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
