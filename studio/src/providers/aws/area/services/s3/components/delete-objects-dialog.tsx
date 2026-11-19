import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { NO_SUCH_BUCKET } from '../api';
import { useDeleteVersioning, useDeletionOperations } from '../queries';
import { actionFailure } from './action-failure';
import {
  deletedBeforeText,
  deletedText,
  deletionHeader,
  refusedText,
  runDeletion,
  type DeletionResult,
  type DeletionSelection,
} from './object-deletion';
import { Quoted } from './quoted';

// The delete dialog of the tab "Objects" and of the object page (issue 480, task 4): it names what is selected, says
// what is removed, asks to type "delete", then deletes (`object-deletion.ts`). The result goes to the area's flash; a
// failed call stays in the dialog with how many were deleted before it. While it deletes, nothing closes it.

/** The word typed to confirm. */
export const CONFIRM_WORD = 'delete';

interface DeleteObjectsDialogProps {
  visible: boolean;
  /** The engine's address. */
  endpoint: string | undefined;
  bucket: string;
  selection: DeletionSelection;
  /** The one key of the object page: the header names it ("Delete `{key}`?"). */
  single?: string;
  /** Where to lead once a key was deleted (the object page's Objects tab); without it the result is shown in place. */
  after?: string;
  /** The dialog closed: `changed` when a deletion ran, so what is listed may have changed. */
  onClose: (changed: boolean) => void;
}

/** The result as the area's flash shows it: the count deleted, then each key refused with the emulator's message. */
function resultFlash({ deleted, refused }: DeletionResult): [FlashItem, ...FlashItem[]] {
  const done: FlashItem = { type: 'success', content: deletedText(deleted) };
  if (refused.length === 0) {
    return [done];
  }
  const failed: FlashItem = {
    type: 'error',
    header: refusedText(refused.length),
    content: (
      <ul>
        {refused.map(({ key, code, message }) => (
          <li key={key}>
            <ValueText kind="name" value={key} />
            <ValueText kind="text" value={`: ${message === '' ? code : message}`} />
          </li>
        ))}
      </ul>
    ),
  };
  return deleted === 0 ? [failed] : [done, failed];
}

/** Every key and folder selected, as selected. */
function SelectionList({ selection }: { selection: DeletionSelection }) {
  const names = [...selection.keys, ...selection.folders];
  return (
    <ul aria-label="Selected objects and folders">
      {names.map((name) => (
        <li key={name}>
          <ValueText kind="name" value={name} />
        </li>
      ))}
    </ul>
  );
}

export function DeleteObjectsDialog({
  visible,
  endpoint,
  bucket,
  selection,
  single,
  after,
  onClose,
}: DeleteObjectsDialogProps) {
  const flash = usePageFlash();
  const operations = useDeletionOperations(endpoint, bucket);
  const versioning = useDeleteVersioning(endpoint, bucket, visible);
  const versioned =
    versioning.value !== undefined && versioning.value !== NO_SUCH_BUCKET && versioning.value.status === 'Enabled';

  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [failed, setFailed] = useState<{ deleted: number; header: ReactNode; detail?: ReactNode }>();
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  // Each opening starts afresh.
  const [seenVisible, setSeenVisible] = useState(visible);
  if (visible !== seenVisible) {
    setSeenVisible(visible);
    if (visible) {
      setTyped('');
      setRan(false);
      setFailed(undefined);
    }
  }

  const confirmed = typed === CONFIRM_WORD;

  const handleClose = () => {
    if (!running) {
      onClose(ran);
    }
  };

  const handleDelete = () => {
    if (!confirmed || running || operations === undefined) {
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setFailed(undefined);
    setRan(true);
    runDeletion(selection, operations, abort.signal).then(
      (result) => {
        setRunning(false);
        if (result.failure !== undefined) {
          const view = actionFailure(result.failure, 'Deleting', endpoint);
          setFailed({ deleted: result.deleted, header: view.header, detail: view.detail });
          return;
        }
        if (after !== undefined && result.deleted > 0) {
          flash.handOver(after, resultFlash(result));
        } else {
          flash.show(resultFlash(result));
        }
        onClose(true);
      },
      () => {
        // Aborted: the dialog is gone.
      },
    );
  };

  const header =
    single === undefined ? (
      deletionHeader(selection.keys.length, selection.folders.length)
    ) : (
      <Quoted before="Delete " name={single} after="?" />
    );

  return (
    <AreaModal
      visible={visible}
      header={header}
      closeAriaLabel="Close"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={running} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={running}
              disabled={!confirmed || operations === undefined}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {single === undefined && <SelectionList selection={selection} />}
        <Box variant="p">
          <Quoted
            before="These are removed from "
            name={bucket}
            after=" in your local emulator, with every object under each folder. This can't be undone."
          />
          {versioned && ' A delete marker is added to each; the versions are kept.'}
        </Box>
        {failed !== undefined && (
          <Alert type="error" header={failed.header}>
            <SpaceBetween size="xxs">
              {failed.detail !== undefined && <div>{failed.detail}</div>}
              <div>{deletedBeforeText(failed.deleted)}</div>
            </SpaceBetween>
          </Alert>
        )}
        <FormField label='To confirm, type "delete"'>
          <Input
            value={typed}
            placeholder={CONFIRM_WORD}
            disabled={running}
            autoComplete={false}
            spellcheck={false}
            onChange={({ detail }) => {
              setTyped(detail.value);
            }}
            onKeyDown={({ detail }) => {
              if (detail.key === 'Enter' && !detail.isComposing) {
                handleDelete();
              }
            }}
          />
        </FormField>
      </SpaceBetween>
    </AreaModal>
  );
}
