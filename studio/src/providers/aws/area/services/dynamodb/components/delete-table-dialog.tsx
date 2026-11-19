import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import { useState } from 'react';

import { ConfirmDialog } from '../../../components/confirm-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashResult } from '../../../components/page-flash';
import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { OPERATIONS } from '../api';
import { useDeleteTable } from '../queries';

// "Delete" of the table list and "Delete table" of a table's page (issue 496, design.md task 5): the area's
// confirmation dialog, the table's name typed to confirm, then one `DeleteTable`. A refusal (a protected table, a
// table already gone) goes to the area's flash with its code and message as they came; what a success shows, and
// where, is the page's.

/** The table the dialog asks about: its name, and whether `DescribeTable` said it is protected against deletion. */
export interface TableToDelete {
  name: string;
  deletionProtection?: boolean;
}

export interface DeleteTableDialogProps {
  /** The table asked about; the dialog is shown while there is one. */
  table: TableToDelete | undefined;
  /** The engine's address the page is configured with. */
  engineOrigin: string | undefined;
  /** The emulator accepted the delete: `result` is the success to show, on this page or the one the page leads to. */
  onDeleted: (result: FlashResult) => void;
  /** The dialog is done: dismissed, or its request answered either way. */
  onClose: () => void;
}

function failureOf(error: unknown): RequestFailure {
  return error instanceof RequestError
    ? error.failure
    : { kind: 'other', operation: OPERATIONS.deleteTable, code: String(error) };
}

/** The dialog of deleting one table; while its request is in flight neither of its buttons acts. */
export function DeleteTableDialog({ table, engineOrigin, onDeleted, onClose }: DeleteTableDialogProps) {
  const flash = usePageFlash();
  const deletion = useDeleteTable(engineOrigin);
  // Set at the press itself, so a second press before the next render sends nothing.
  const [sent, setSent] = useState<string>();

  const handleConfirm = () => {
    if (table === undefined || sent !== undefined) {
      return;
    }
    const { name } = table;
    setSent(name);
    deletion.run(name).then(
      () => {
        setSent(undefined);
        onClose();
        onDeleted([{ type: 'success', content: `Table ${name} is being deleted.` }]);
      },
      (error: unknown) => {
        setSent(undefined);
        onClose();
        flash.show([actionFailureItem(failureOf(error), `Deleting ${name}`, engineOrigin)]);
      },
    );
  };

  const name = table?.name ?? '';
  return (
    <ConfirmDialog
      visible={table !== undefined}
      header={`Delete ${name}?`}
      body={
        <>
          {table?.deletionProtection === true && (
            <Box margin={{ bottom: 's' }}>
              <Alert type="warning">
                Deletion protection is on for {name}. The emulator refuses to delete it while it is on.
              </Alert>
            </Box>
          )}
          {name} and every item in it are deleted from your local emulator. This cannot be undone.
        </>
      }
      word={name}
      action="Delete"
      pending={sent !== undefined || deletion.pending}
      onConfirm={handleConfirm}
      onDismiss={onClose}
    />
  );
}
