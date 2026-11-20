import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { VPC_CHANGE_OPERATIONS } from '../vpc-changes-api';
import { useDeleteVpc } from '../vpc-changes';

// "Delete VPC?" (issue 574, requirement "Delete a VPC"), from S1 and S3: the area's dialog confirmed by typing
// `delete`, which names the VPC and sends `DeleteVpc` itself. A refusal (a VPC in use) is one a developer acts on and
// tries again, so it is shown in the dialog, below its sentence, and the dialog stays; a refused delete reads nothing
// again. The page renders the dialog beside its content, so a read that turns to "not found" keeps it.

/** The VPC to delete: its ID, and how the dialog and the result name it (its name, else its ID). */
export interface VpcTarget {
  id: string;
  label: string;
}

export interface DeleteVpcDialogProps {
  /** The VPC; none while the dialog is closed. */
  vpc: VpcTarget | undefined;
  connection: AreaConnection;
  /** The emulator answered 200. */
  onDeleted: (vpc: VpcTarget) => void;
  onDismiss: () => void;
}

const SENTENCE =
  ' is deleted from the local emulator with its route tables. This cannot be undone. The emulator refuses while the VPC holds a subnet, an attached internet gateway or a security group other than default.';

/** The failure in the dialog: inline elements only, since the dialog's body is a paragraph. */
function Failure({ failure, vpc, engineOrigin }: { failure: RequestFailure; vpc: string; engineOrigin?: string }) {
  const item = actionFailureItem(failure, `Deleting VPC ${vpc}`, engineOrigin);
  return (
    <Box variant="span" display="block" margin={{ top: 's' }}>
      <span role="alert">
        <StatusIndicator type={item.type === 'info' ? 'info' : 'error'}>{item.header}</StatusIndicator>
        {item.content !== undefined && <> {item.content}</>}
      </span>
    </Box>
  );
}

function Dialog({ vpc, connection, onDeleted, onDismiss }: Omit<DeleteVpcDialogProps, 'vpc'> & { vpc: VpcTarget }) {
  const remove = useDeleteVpc(connection.engineOrigin);
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
    remove(vpc.id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        onDeleted(vpc);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setFailure(failureOf(error, VPC_CHANGE_OPERATIONS.deleteVpc));
      },
    );
  };

  return (
    <ConfirmDialog
      visible
      header="Delete VPC?"
      body={
        <>
          <ValueText kind="name" value={vpc.label} />
          <ValueText kind="text" value={SENTENCE} />
          {failure !== undefined && (
            <Failure
              failure={failure}
              vpc={vpc.label}
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

/** The dialog, mounted only while a VPC is given, so each opening starts with an empty field and no failure. */
export function DeleteVpcDialog({ vpc, ...props }: DeleteVpcDialogProps) {
  return vpc === undefined ? null : <Dialog key={vpc.id} vpc={vpc} {...props} />;
}
