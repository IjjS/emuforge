import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { GATEWAY_CHANGE_OPERATIONS } from '../gateway-changes-api';
import { useDeleteGateway } from '../gateway-changes';

// "Delete internet gateway?" (issue 574, requirement "Detach; delete a gateway"), from S12: the area's dialog
// confirmed by typing `delete`, which names the gateway and sends `DeleteInternetGateway` itself. A refusal is one a
// developer acts on and tries again, so it is shown in the dialog, below its sentence, and the dialog stays; a refused
// delete reads nothing again.

/** The gateway to delete: its ID, and how the dialog and the result name it (its name, else its ID). */
export interface GatewayTarget {
  id: string;
  label: string;
}

export interface DeleteGatewayDialogProps {
  /** The gateway; none while the dialog is closed. */
  gateway: GatewayTarget | undefined;
  connection: AreaConnection;
  /** The emulator answered 200. */
  onDeleted: (gateway: GatewayTarget) => void;
  onDismiss: () => void;
}

const SENTENCE = ' is deleted from the local emulator. This cannot be undone.';

/** The failure in the dialog: inline elements only, since the dialog's body is a paragraph. */
function Failure({
  failure,
  gateway,
  engineOrigin,
}: {
  failure: RequestFailure;
  gateway: string;
  engineOrigin?: string;
}) {
  const item = actionFailureItem(failure, `Deleting internet gateway ${gateway}`, engineOrigin);
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
  gateway,
  connection,
  onDeleted,
  onDismiss,
}: Omit<DeleteGatewayDialogProps, 'gateway'> & { gateway: GatewayTarget }) {
  const remove = useDeleteGateway(connection.engineOrigin);
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
    remove(gateway.id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        onDeleted(gateway);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setFailure(failureOf(error, GATEWAY_CHANGE_OPERATIONS.deleteInternetGateway));
      },
    );
  };

  return (
    <ConfirmDialog
      visible
      header="Delete internet gateway?"
      body={
        <>
          <ValueText kind="name" value={gateway.label} />
          <ValueText kind="text" value={SENTENCE} />
          {failure !== undefined && (
            <Failure
              failure={failure}
              gateway={gateway.label}
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

/** The dialog, mounted only while a gateway is given, so each opening starts with an empty field and no failure. */
export function DeleteGatewayDialog({ gateway, ...props }: DeleteGatewayDialogProps) {
  return gateway === undefined ? null : <Dialog key={gateway.id} gateway={gateway} {...props} />;
}
