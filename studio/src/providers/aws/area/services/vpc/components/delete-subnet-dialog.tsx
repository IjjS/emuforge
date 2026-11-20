import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { SUBNET_CHANGE_OPERATIONS } from '../subnet-changes-api';
import { useDeleteSubnet } from '../subnet-changes';

// "Delete subnet?" (issue 574, requirement "Delete a subnet"), from S4 and S6: the area's dialog confirmed by typing
// `delete`, which names the subnet and sends `DeleteSubnet` itself. A refusal (a subnet in use) is one a developer acts on and
// tries again, so it is shown in the dialog, below its sentence, and the dialog stays; a refused delete reads nothing
// again. The page renders the dialog beside its content, so a read that turns to "not found" keeps it.

/** The subnet to delete: its ID, and how the dialog and the result name it (its name, else its ID). */
export interface SubnetTarget {
  id: string;
  label: string;
}

export interface DeleteSubnetDialogProps {
  /** The subnet; none while the dialog is closed. */
  subnet: SubnetTarget | undefined;
  connection: AreaConnection;
  /** The emulator answered 200. */
  onDeleted: (subnet: SubnetTarget) => void;
  onDismiss: () => void;
}

const SENTENCE =
  ' is deleted from the local emulator. This cannot be undone. The emulator refuses while something is in the subnet, such as an instance or a NAT gateway.';

/** The failure in the dialog: inline elements only, since the dialog's body is a paragraph. */
function Failure({
  failure,
  subnet,
  engineOrigin,
}: {
  failure: RequestFailure;
  subnet: string;
  engineOrigin?: string;
}) {
  const item = actionFailureItem(failure, `Deleting subnet ${subnet}`, engineOrigin);
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
  subnet,
  connection,
  onDeleted,
  onDismiss,
}: Omit<DeleteSubnetDialogProps, 'subnet'> & { subnet: SubnetTarget }) {
  const remove = useDeleteSubnet(connection.engineOrigin);
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
    remove(subnet.id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        onDeleted(subnet);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setFailure(failureOf(error, SUBNET_CHANGE_OPERATIONS.deleteSubnet));
      },
    );
  };

  return (
    <ConfirmDialog
      visible
      header="Delete subnet?"
      body={
        <>
          <ValueText kind="name" value={subnet.label} />
          <ValueText kind="text" value={SENTENCE} />
          {failure !== undefined && (
            <Failure
              failure={failure}
              subnet={subnet.label}
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

/** The dialog, mounted only while a subnet is given, so each opening starts with an empty field and no failure. */
export function DeleteSubnetDialog({ subnet, ...props }: DeleteSubnetDialogProps) {
  return subnet === undefined ? null : <Dialog key={subnet.id} subnet={subnet} {...props} />;
}
