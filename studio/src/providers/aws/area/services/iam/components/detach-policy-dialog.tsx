import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { AreaModal } from '../../../components/area-modal';
import { usePageFlash } from '../../../components/page-flash';
import { failureOf, useDetachRolePolicy } from '../queries';
import { actionFailureItem } from './failures';

// "Detach" of a managed policy on a role's tab "Permissions" (issue 535, task 3): a confirmation, not a removal, so
// no word is typed. `DetachRolePolicy`; once the emulator has answered the dialog closes and the Flashbar reports the
// result or the refusal as it came. The role is read again either way (by the hook).

export interface DetachPolicyDialogProps {
  role: string;
  policy: { name: string; arn: string };
  engineOrigin: string | undefined;
  /** Called when the dialog closes: "Cancel", Esc, or the emulator's answer. */
  onClose: () => void;
}

/** The dialog "Detach {policy}?". */
export function DetachPolicyDialog({ role, policy, engineOrigin, onClose }: DetachPolicyDialogProps) {
  const flash = usePageFlash();
  const detach = useDetachRolePolicy(engineOrigin);
  const pending = detach.isPending;

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleDetach = () => {
    if (pending) {
      return;
    }
    detach.mutate(
      { role, arn: policy.arn },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: `Detached ${policy.name} from ${role}.` }]);
          onClose();
        },
        onError: (error) => {
          flash.show([actionFailureItem(failureOf(error), `Detaching ${policy.name} from ${role}`, engineOrigin)]);
          onClose();
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      header={`Detach ${policy.name}?`}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} loadingText="Detaching" onClick={handleDetach}>
              Detach
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Box variant="p">{`${role} loses what this policy allows. The policy stays in the local emulator.`}</Box>
    </AreaModal>
  );
}
