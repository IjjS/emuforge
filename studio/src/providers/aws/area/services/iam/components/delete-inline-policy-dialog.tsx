import { ConfirmDialog } from '../../../components/confirm-dialog';
import { usePageFlash } from '../../../components/page-flash';
import { failureOf, useDeleteRolePolicy } from '../queries';
import { actionFailureItem } from './failures';

// "Delete" of an inline policy on a role's tab "Permissions" (issue 535, task 3): the area's dialog of a removal,
// confirmed by typing `delete`, since the document goes with it. `DeleteRolePolicy`; once the emulator has answered
// the dialog closes and the Flashbar reports the result or the refusal as it came. The role is read again either way
// (by the hook).

const CONFIRM_WORD = 'delete';

export interface DeleteInlinePolicyDialogProps {
  role: string;
  name: string;
  engineOrigin: string | undefined;
  /** Called when the dialog closes: "Cancel", Esc, or the emulator's answer. */
  onClose: () => void;
}

/** The dialog "Delete {name}?". */
export function DeleteInlinePolicyDialog({ role, name, engineOrigin, onClose }: DeleteInlinePolicyDialogProps) {
  const flash = usePageFlash();
  const remove = useDeleteRolePolicy(engineOrigin);

  const handleConfirm = () => {
    remove.mutate(
      { role, name },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: `Inline policy ${name} deleted from ${role}.` }]);
          onClose();
        },
        onError: (error) => {
          flash.show([actionFailureItem(failureOf(error), `Deleting ${name} from ${role}`, engineOrigin)]);
          onClose();
        },
      },
    );
  };

  return (
    <ConfirmDialog
      visible
      header={`Delete ${name}?`}
      body={`The inline policy and its document are removed from ${role} in the local emulator. This cannot be undone.`}
      word={CONFIRM_WORD}
      action="Delete"
      pending={remove.isPending}
      onConfirm={handleConfirm}
      onDismiss={onClose}
    />
  );
}
