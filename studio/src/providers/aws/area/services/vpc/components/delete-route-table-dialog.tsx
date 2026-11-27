import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { NameText } from '../../../components/name-text';
import { ValueText } from '../../../components/value-text';
import { ROUTE_TABLE_CHANGE_OPERATIONS } from '../route-table-changes-api';
import { useDeleteRouteTable } from '../route-table-changes';

// "Delete route table?" (issue 574, requirement "Delete a VPC, a subnet, a route table"), from S7 and S9: the area's dialog confirmed by typing
// `delete`, which names the table and sends `DeleteRouteTable` itself. A refusal (a table with an association) is one a developer acts on and
// tries again, so it is shown in the dialog, below its sentence, and the dialog stays; a refused delete reads nothing
// again. The page renders the dialog beside its content, so a read that turns to "not found" keeps it.

/** The route table to delete: its ID, and how the dialog and the result name it (its name, else its ID). */
export interface RouteTableTarget {
  id: string;
  label: string;
}

export interface DeleteRouteTableDialogProps {
  /** The table; none while the dialog is closed. */
  table: RouteTableTarget | undefined;
  connection: AreaConnection;
  /** The emulator answered 200. */
  onDeleted: (table: RouteTableTarget) => void;
  onDismiss: () => void;
}

const SENTENCE =
  ' is deleted from the local emulator with its routes. This cannot be undone. The emulator refuses while a subnet is associated with it.';

/** The failure in the dialog: inline elements only, since the dialog's body is a paragraph. */
function Failure({ failure, table, engineOrigin }: { failure: RequestFailure; table: string; engineOrigin?: string }) {
  const item = actionFailureItem(failure, `Deleting route table ${table}`, engineOrigin);
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
  table,
  connection,
  onDeleted,
  onDismiss,
}: Omit<DeleteRouteTableDialogProps, 'table'> & { table: RouteTableTarget }) {
  const remove = useDeleteRouteTable(connection.engineOrigin);
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
    remove(table.id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        onDeleted(table);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setFailure(failureOf(error, ROUTE_TABLE_CHANGE_OPERATIONS.deleteRouteTable));
      },
    );
  };

  return (
    <ConfirmDialog
      visible
      header="Delete route table?"
      body={
        <>
          <NameText name={table.label} />
          <ValueText kind="text" value={SENTENCE} />
          {failure !== undefined && (
            <Failure
              failure={failure}
              table={table.label}
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

/** The dialog, mounted only while a table is given, so each opening starts with an empty field and no failure. */
export function DeleteRouteTableDialog({ table, ...props }: DeleteRouteTableDialogProps) {
  return table === undefined ? null : <Dialog key={table.id} table={table} {...props} />;
}
