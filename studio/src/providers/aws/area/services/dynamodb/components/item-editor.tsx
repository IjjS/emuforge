import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useRef, useState, type ReactNode } from 'react';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem, CodeAndMessage } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { CONDITION_FAILED, keyOfItem, NO_SUCH_ITEM, OPERATIONS, type Item, type Table } from '../api';
import { itemText, newItemText, parseItem } from '../item-json';
import { useOpenItem, usePutItem } from '../queries';
import { keysOf } from './items-explorer';

// The item editor of S2's "Items" tab (issue 496, design.md task 3): one dialog for "Create item" and for an item
// opened from the page, its text the item in DynamoDB's own JSON. An opened item is read again with `GetItem` from the
// table by the table's key; when that read finds none, no dialog opens and the Flashbar says so. Save checks the text
// (`item-json.ts`), then sends one conditional `PutItem`: on create that no item has the key, on edit that the item
// still exists. A refusal stays in the dialog with the text; a success closes it and goes to the Flashbar.

const EDITOR_DESCRIPTION = "The item in DynamoDB JSON: each attribute's type and value, as the AWS CLI writes it.";

/** The sentence a failed condition is reported with, before the code and message as they came. */
function conditionSentence(mode: Editing['mode'], table: string): string {
  return mode === 'create'
    ? `An item with this key is already in ${table}. Open it to change it.`
    : `This item is no longer in ${table}. It may have been deleted.`;
}

function noLongerThere(table: string): FlashItem {
  return { type: 'warning', content: `This item is no longer in ${table}. It may have been deleted.` };
}

function failureOf(error: unknown, operation: string): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/** What the dialog edits: a new item, or the item `GetItem` returned, whose key `key` is kept. */
type Editing = { mode: 'create'; text: string } | { mode: 'edit'; text: string; key: Item };

interface EditorDialogProps {
  table: Table;
  engineOrigin: string | undefined;
  editing: Editing;
  onClose: () => void;
}

/** The dialog, mounted at each opening, so its text and messages start from what it opened with. */
// eslint-disable-next-line react-refresh/only-export-components -- the editor's hook hands out the dialog it renders (breakdown s4)
function EditorDialog({ table, engineOrigin, editing, onClose }: EditorDialogProps) {
  const flash = usePageFlash();
  const put = usePutItem(engineOrigin);
  const keys = keysOf(table, '');
  const [text, setText] = useState(editing.text);
  const [error, setError] = useState<string>();
  const [failed, setFailed] = useState<FlashItem>();
  const [saving, setSaving] = useState(false);
  // Set at the press itself, so a second press before the next render sends nothing.
  const inFlight = useRef(false);
  const { mode } = editing;

  const handleSave = () => {
    if (inFlight.current) {
      return;
    }
    const parsed = parseItem(text, keys, mode === 'edit' ? editing.key : undefined);
    if (!parsed.ok) {
      setError(parsed.message);
      setFailed(undefined);
      return;
    }
    setError(undefined);
    setFailed(undefined);
    inFlight.current = true;
    setSaving(true);
    put.run({ table: table.name, item: parsed.item, mode, partitionKey: keys.partition.name }).then(
      () => {
        inFlight.current = false;
        onClose();
        flash.show([
          { type: 'success', content: `${mode === 'create' ? 'Item created in' : 'Item saved in'} ${table.name}.` },
        ]);
      },
      (reason: unknown) => {
        inFlight.current = false;
        setSaving(false);
        const failure = failureOf(reason, OPERATIONS.putItem);
        const item = actionFailureItem(
          failure,
          mode === 'create' ? 'Creating the item' : 'Saving the item',
          engineOrigin,
        );
        setFailed(
          failure.kind === 'other' && failure.code === CONDITION_FAILED
            ? {
                ...item,
                content: (
                  <>
                    {conditionSentence(mode, table.name)}{' '}
                    <CodeAndMessage code={failure.code} message={failure.message} />
                  </>
                ),
              }
            : item,
        );
      },
    );
  };

  const handleDismiss = () => {
    if (!inFlight.current) {
      onClose();
    }
  };

  return (
    <AreaModal
      visible
      size="large"
      header={mode === 'create' ? 'Create item' : 'Edit item'}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={saving} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Item" constraintText={EDITOR_DESCRIPTION} errorText={error} stretch>
          <Textarea
            value={text}
            rows={14}
            spellcheck={false}
            disableBrowserAutocorrect
            onChange={({ detail }) => {
              setText(detail.value);
            }}
          />
        </FormField>
        {failed !== undefined && (
          <Alert type={failed.type} header={failed.header}>
            {failed.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}

/** What the "Items" tab uses of the editor: its two ways in, and the dialog to render. */
export interface ItemEditor {
  /** "Create item": the table's key attributes with empty values of their types. */
  create: () => void;
  /** Opens the item whose key `row` holds (a row of the table or of an index), read again from the table. */
  open: (row: Item) => void;
  /** The `GetItem` of an item opened is in flight. */
  opening: boolean;
  /** The dialog, while it is open; `null` otherwise. */
  dialog: ReactNode;
}

/** The item editor of `table`, through the engine at `engineOrigin`. */
export function useItemEditor(table: Table, engineOrigin: string | undefined): ItemEditor {
  const flash = usePageFlash();
  const opening = useOpenItem(engineOrigin);
  const [editing, setEditing] = useState<Editing>();
  // Set at the press itself, so a second press before the next render reads nothing more.
  const reading = useRef(false);
  const keys = keysOf(table, '');

  const create = () => {
    setEditing({ mode: 'create', text: newItemText(keys) });
  };

  const open = (row: Item) => {
    if (reading.current) {
      return;
    }
    reading.current = true;
    opening.run({ table: table.name, keys, row }).then(
      (item) => {
        reading.current = false;
        if (item === NO_SUCH_ITEM) {
          flash.show([noLongerThere(table.name)]);
          return;
        }
        setEditing({ mode: 'edit', text: itemText(item, keys), key: keyOfItem(item, keys) });
      },
      (reason: unknown) => {
        reading.current = false;
        flash.show([actionFailureItem(failureOf(reason, OPERATIONS.getItem), 'Opening the item', engineOrigin)]);
      },
    );
  };

  const dialog =
    editing === undefined ? null : (
      <EditorDialog
        table={table}
        engineOrigin={engineOrigin}
        editing={editing}
        onClose={() => {
          setEditing(undefined);
        }}
      />
    );

  return { create, open, opening: opening.pending, dialog };
}
