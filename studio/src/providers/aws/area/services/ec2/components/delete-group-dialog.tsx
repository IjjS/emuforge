import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { GROUP_OPERATIONS } from '../group-api';
import { useDeleteGroup } from '../group-queries';

// "Delete security group?" (issue 553, design task 4), from S4 and S6: the area's dialog confirmed by typing `delete`,
// which names the group and sends `DeleteSecurityGroup` itself. A refusal (a group in use) is one a developer acts on
// and tries again, so it is shown in the dialog, below its sentence, and the dialog stays (Plan decisions).

/** The group to delete: its ID and name. */
export interface GroupTarget {
  id: string;
  name: string;
}

export interface DeleteGroupDialogProps {
  /** The group; none while the dialog is closed. */
  group: GroupTarget | undefined;
  connection: AreaConnection;
  /** The emulator answered 200. */
  onDeleted: (group: GroupTarget) => void;
  onDismiss: () => void;
}

const SENTENCE =
  " is deleted from the local emulator. This cannot be undone. The emulator refuses while an instance or another group's rule uses it.";

/** The failure in the dialog: inline elements only, since the dialog's body is a paragraph. */
function Failure({ failure, group, engineOrigin }: { failure: RequestFailure; group: string; engineOrigin?: string }) {
  const item = actionFailureItem(failure, `Deleting security group ${group}`, engineOrigin);
  return (
    <Box variant="span" display="block" margin={{ top: 's' }}>
      <span role="alert">
        <StatusIndicator type={item.type === 'info' ? 'info' : 'error'}>{item.header}</StatusIndicator>
        {item.content !== undefined && <> {item.content}</>}
      </span>
    </Box>
  );
}

function Dialog({
  group,
  connection,
  onDeleted,
  onDismiss,
}: Omit<DeleteGroupDialogProps, 'group'> & { group: GroupTarget }) {
  const remove = useDeleteGroup(connection.engineOrigin);
  const pageSignal = usePageSignal();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();

  const handleConfirm = () => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    setFailure(undefined);
    remove(group.id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        onDeleted(group);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setFailure(failureOf(error, GROUP_OPERATIONS.deleteSecurityGroup));
      },
    );
  };

  return (
    <ConfirmDialog
      visible
      header="Delete security group?"
      body={
        <>
          <ValueText kind="name" value={group.name} />
          <ValueText kind="text" value={SENTENCE} />
          {failure !== undefined && (
            <Failure
              failure={failure}
              group={group.name}
              {...(connection.engineOrigin === undefined ? {} : { engineOrigin: connection.engineOrigin })}
            />
          )}
        </>
      }
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={handleConfirm}
      onDismiss={onDismiss}
    />
  );
}

/** The dialog, mounted only while a group is given, so each opening starts with an empty field and no failure. */
export function DeleteGroupDialog({ group, ...props }: DeleteGroupDialogProps) {
  return group === undefined ? null : <Dialog key={group.id} group={group} {...props} />;
}
