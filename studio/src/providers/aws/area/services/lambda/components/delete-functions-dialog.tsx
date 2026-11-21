import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash, type FlashItem, type FlashResult } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import type { DeleteResult } from '../api';
import { useDeleteFunctions } from '../queries';
import { actionFailureItem } from './failure-states';
import { Code } from './failures';

// "Delete functions" of the function list (issue 84, requirement R7, R10.3): the capture's title, field label and
// placeholder, and "Cancel" and "Delete"; the body and the results in EmuForge's own words.

/** The dialog's title (the capture's). */
export const DELETE_FUNCTIONS_TITLE = 'Delete functions';

/** The word the field must hold, exactly (the capture's). */
const CONFIRM_WORD = 'confirm';

const CONFIRM_LABEL = 'To confirm deletion, type "confirm" in the field.';
const DELETING = 'Deleting functions…';

function deletedText(count: number): string {
  return count === 1
    ? '1 function was deleted from the local emulator.'
    : `${String(count)} functions were deleted from the local emulator.`;
}

/** What the area's Flashbar shows once every request is answered (R7): an item per failure, then the success. */
function resultItems(result: DeleteResult, engineOrigin: string | undefined): FlashResult | undefined {
  const items: FlashItem[] = result.failed.map(({ name, failure }) =>
    actionFailureItem(failure, `Deleting ${name}`, engineOrigin),
  );
  if (result.deleted.length > 0) {
    items.push({ type: 'success', content: deletedText(result.deleted.length) });
  }
  const [first, ...rest] = items;
  return first === undefined ? undefined : [first, ...rest];
}

export interface DeleteFunctionsDialogProps {
  /** The functions to delete, in the order they are deleted; the dialog is shown while it holds any. */
  names: readonly string[];
  connection: AreaConnection;
  /** Called when the dialog closes: by "Cancel" or Esc, or once every request is answered. */
  onClose: () => void;
  /** Called before removing a confirmation that contains keyboard focus. */
  onFocusedDismissal?: () => void;
  /**
   * Called once, before `onClose`, when every function was deleted, with the result the Flashbar would show; the
   * dialog then shows nothing itself, so the caller can hand the result to the page it leads to (issue 516, task 6).
   * Without it, or when a delete failed, the dialog shows the result in the Flashbar.
   */
  onDeleted?: (result: FlashResult) => void;
}

/**
 * The dialog that deletes `names` from the emulator, one `DeleteFunction` after another, once the field holds
 * exactly "confirm". It stays mounted with the list, so leaving the screen is what aborts its requests.
 */
export function DeleteFunctionsDialog({
  names,
  connection,
  onClose,
  onDeleted,
  onFocusedDismissal,
}: DeleteFunctionsDialogProps) {
  const flash = usePageFlash();
  const { remove, pending } = useDeleteFunctions(connection.engineOrigin);
  const [typed, setTyped] = useState('');
  const visible = names.length > 0;
  const confirmed = typed === CONFIRM_WORD;

  const deleteButton = useRef<ButtonProps.Ref>(null);
  useEffect(() => {
    // Hiding Close changes the modal's autofocus target. Keep focus on the loading action.
    if (visible && pending) {
      deleteButton.current?.focus();
    }
  }, [visible, pending]);

  const submitting = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const focused = useRef<Element | null>(null);
  const trackDialogRemoval = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) {
        // The ref detaches before the modal portal restores focus to its opener.
        if (focused.current === document.activeElement) {
          onFocusedDismissal?.();
        }
        focused.current = null;
      }
    },
    [onFocusedDismissal],
  );

  // The field starts empty each time the dialog opens.
  const [shownFor, setShownFor] = useState(names);
  if (shownFor !== names) {
    setShownFor(names);
    setTyped('');
  }

  const handleDelete = useCallback(() => {
    if (!visible || !confirmed || pending || submitting.current) {
      return;
    }
    submitting.current = true;
    const engineOrigin = connection.engineOrigin;
    void remove(names).then(
      (result) => {
        submitting.current = false;
        if (!mounted.current) {
          return;
        }
        const items = resultItems(result, engineOrigin);
        if (items !== undefined && onDeleted !== undefined && result.failed.length === 0) {
          onDeleted(items);
        } else if (items !== undefined) {
          flash.show(items);
        }
        onClose();
      },
      // The screen was left first: nothing is shown.
      () => {
        submitting.current = false;
      },
    );
  }, [visible, confirmed, pending, connection.engineOrigin, remove, names, flash, onClose, onDeleted]);

  const handleDismiss = useCallback(() => {
    if (!pending && !submitting.current) {
      onClose();
    }
  }, [pending, onClose]);

  const result = connection.result;
  const sentence =
    result?.kind === 'connected' ? (
      <>
        They will be deleted from your local emulator at <Code>{result.emulator.endpoint}</Code>, with their code and
        settings. This cannot be undone.
      </>
    ) : (
      'They will be deleted from your local emulator, with their code and settings. This cannot be undone.'
    );

  if (!visible) {
    return null;
  }

  const modal = (
    <AreaModal
      visible={visible}
      header={DELETE_FUNCTIONS_TITLE}
      closeAriaLabel="Close modal"
      hideDismissButton={pending}
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              ref={deleteButton}
              variant="primary"
              disabled={!pending && !confirmed}
              loading={pending}
              loadingText={DELETING}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <ul>
          {names.map((name) => (
            <li key={name}>
              <ValueText kind="name" value={name} />
            </li>
          ))}
        </ul>
        <Box variant="p">{sentence}</Box>
        <FormField label={CONFIRM_LABEL}>
          <Input
            value={typed}
            placeholder={CONFIRM_WORD}
            readOnly={pending}
            onChange={({ detail }) => {
              setTyped(detail.value);
            }}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter') {
                handleDelete();
              }
            }}
          />
        </FormField>
        {pending && <Box variant="p">{DELETING}</Box>}
      </SpaceBetween>
    </AreaModal>
  );
  if (onFocusedDismissal === undefined) {
    return modal;
  }
  return (
    <div
      ref={trackDialogRemoval}
      onFocusCapture={(event) => {
        focused.current = event.target;
      }}
    >
      {modal}
    </div>
  );
}
