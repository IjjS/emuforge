import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Modal from '@cloudscape-design/components/modal';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import type { FlashItem, FlashResult } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import type { DeleteResult, Role } from '../api';
import { lastActivityText } from '../format';
import { failureOf, useDeleteRoles } from '../queries';
import { actionFailureItem } from './failures';
import { useAreaModalRoot } from './page-parts';
import { Code } from './states';

// "Delete" of the role list (issue 82, requirement R7, R10.3): the console's dialog "Delete … roles?" without "Learn
// more", its sentence in EmuForge's own words. The roles are deleted one after another in the order given; the
// result is shown in the area's Flashbar once every role is finished, never before.

/** The word the field must hold exactly. */
const CONFIRM_WORD = 'delete';

/** "Delete 1 role?", "Delete <n> roles?" (R7; question 5). */
function deleteDialogTitle(count: number): string {
  return count === 1 ? 'Delete 1 role?' : `Delete ${String(count)} roles?`;
}

/** The success item's text for `count` deleted roles (R7). */
function deletedText(count: number): string {
  return count === 1
    ? '1 role was deleted from the local emulator.'
    : `${String(count)} roles were deleted from the local emulator.`;
}

/** The Flashbar's result of a finished delete: one error item per failed role, then a success item for the rest. */
function deleteResult({ deleted, failed }: DeleteResult, engineOrigin: string | undefined): FlashResult | undefined {
  const items: FlashItem[] = failed.map(({ name, failure }) =>
    actionFailureItem(failure, `Deleting ${name}`, engineOrigin),
  );
  if (deleted.length > 0) {
    items.push({ type: 'success', content: deletedText(deleted.length) });
  }
  const [first, ...rest] = items;
  return first === undefined ? undefined : [first, ...rest];
}

const COLUMNS: TableProps.ColumnDefinition<Role>[] = [
  { id: 'name', header: 'Role name', isRowHeader: true, cell: (role) => role.name },
  { id: 'lastActivity', header: 'Last activity', cell: (role) => lastActivityText(role.lastUsed) },
];

export interface DeleteRolesDialogProps {
  /** The selected roles, in the order of their rows. */
  roles: readonly Role[];
  connection: AreaConnection;
  /** Called when the dialog closes: "Cancel", Esc, or every role finished. */
  onClose: () => void;
}

/**
 * The dialog "Delete … roles?" (R7). "Delete" is enabled only while the field holds exactly `delete`; while the
 * requests are in flight it is disabled and shows progress, and the dialog stays open until every role is finished.
 * "Cancel" and Esc close it without a request.
 */
export function DeleteRolesDialog({ roles, connection, onClose }: DeleteRolesDialogProps) {
  const [typed, setTyped] = useState('');
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const remove = useDeleteRoles(engineOrigin);
  const pending = remove.isPending;
  // In the area's root, with a root that stays the same while the dialog is open (`useAreaModalRoot`).
  const modalRoot = useAreaModalRoot();

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleDelete = () => {
    if (pending || typed !== CONFIRM_WORD) {
      return;
    }
    remove.mutate(
      roles.map((role) => (role.path === undefined ? { name: role.name } : { name: role.name, path: role.path })),
      {
        onSuccess: (result) => {
          const shown = deleteResult(result, engineOrigin);
          if (shown !== undefined) {
            flash.show(shown);
          }
          onClose();
        },
        onError: (error) => {
          flash.show([actionFailureItem(failureOf(error), 'Deleting the roles', engineOrigin)]);
          onClose();
        },
      },
    );
  };

  const result = connection.result;
  const sentence =
    "A role's managed policies are detached, its inline policies are deleted and it is removed from its instance " +
    'profiles first; a service-linked role is deleted by the emulator as a whole. This cannot be undone.';

  return (
    <Modal
      {...modalRoot}
      visible
      header={deleteDialogTitle(roles.length)}
      closeAriaLabel="Close modal"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={typed !== CONFIRM_WORD}
              loading={pending}
              loadingText="Deleting roles"
              onClick={handleDelete}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Table<Role>
          variant="embedded"
          items={[...roles]}
          trackBy="name"
          columnDefinitions={COLUMNS}
          ariaLabels={{ tableLabel: 'Roles to delete' }}
          wrapLines
        />
        <Box variant="p">
          {result?.kind === 'connected' ? (
            <>
              They will be deleted from your local emulator at <Code>{result.emulator.endpoint}</Code>. {sentence}
            </>
          ) : (
            `They will be deleted from your local emulator. ${sentence}`
          )}
        </Box>
        <FormField label="To confirm, type delete">
          <Input
            value={typed}
            placeholder={CONFIRM_WORD}
            onChange={({ detail }) => {
              setTyped(detail.value);
            }}
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
