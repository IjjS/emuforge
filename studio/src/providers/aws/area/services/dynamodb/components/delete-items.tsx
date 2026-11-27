import Box from '@cloudscape-design/components/box';
import { useRef, useState } from 'react';

import { RequestError } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import { actionFailureItem, Code } from '../../../components/failure-states';
import { nameIdentity } from '../../../components/name-identity';
import { usePageFlash, type FlashItem, type FlashResult } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import type { Item, Keys } from '../api';
import { compactText } from '../item-json';
import { useDeleteItems } from '../queries';

// "Delete" of S2's "Items" tab (issue 496, design.md task 3): the area's confirmation dialog, "delete" typed to confirm,
// then one `DeleteItem` per selected item, in the page's order, each after the previous answer and with no condition.
// The Flashbar reports how many were deleted and, one item each, every one that failed with its key and the code and
// message as they came. The page of items is read again either way.

/** An item's key as compact DynamoDB JSON, its key attributes in the table's order: `{"pk":{"S":"a"},"sk":{"N":"1"}}`. */
// eslint-disable-next-line react-refresh/only-export-components -- the key text is the selection's and the dialog's (breakdown s4)
export function keyText(item: Item, keys: Keys): string {
  const names = [keys.partition.name, ...(keys.sort === undefined ? [] : [keys.sort.name])];
  const parts = names.flatMap((name) => {
    const value = item[name];
    return value === undefined ? [] : [`${JSON.stringify(name)}:${compactText(value)}`];
  });
  return `{${parts.join(',')}}`;
}

function counted(count: number): string {
  return count === 1 ? '1 item' : `${String(count)} items`;
}

export interface DeleteItemsDialogProps {
  /** The table's name. */
  table: string;
  keys: Keys;
  /** The key of each item to delete, in the page's order; the dialog is shown while it is not `undefined`. */
  items: readonly Item[] | undefined;
  /** The engine's address the page is configured with. */
  engineOrigin: string | undefined;
  /** The deletes were answered, whatever each answer was: the selection is cleared. */
  onDeleted: () => void;
  /** The dialog is done: dismissed, or its requests answered. */
  onClose: () => void;
}

/** The dialog of deleting the selected items; while its requests are in flight neither of its buttons acts. */
export function DeleteItemsDialog({ table, keys, items, engineOrigin, onDeleted, onClose }: DeleteItemsDialogProps) {
  const flash = usePageFlash();
  const deletion = useDeleteItems(engineOrigin);
  // Set at the press itself, so a second press before the next render sends nothing.
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const count = items?.length ?? 0;

  const handleConfirm = () => {
    if (items === undefined || inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSending(true);
    const done = () => {
      inFlight.current = false;
      setSending(false);
      onClose();
      onDeleted();
    };
    deletion.run({ table, keys: items }).then(
      ({ deleted, failed }) => {
        done();
        const reported: FlashItem[] = [];
        if (deleted.length > 0) {
          reported.push({ type: 'success', content: `${counted(deleted.length)} deleted from ${table}.` });
        }
        for (const { key, failure } of failed) {
          const item = actionFailureItem(failure, 'Deleting the item', engineOrigin);
          reported.push({
            ...item,
            content: (
              <>
                <Box variant="span" display="block">
                  Item <Code>{keyText(key, keys)}</Code>
                </Box>
                {item.content}
              </>
            ),
          });
        }
        const [first, ...rest] = reported;
        if (first !== undefined) {
          flash.show([first, ...rest] satisfies FlashResult);
        }
      },
      (reason: unknown) => {
        done();
        if (reason instanceof RequestError) {
          flash.show([actionFailureItem(reason.failure, 'Deleting the items', engineOrigin)]);
        }
      },
    );
  };

  return (
    <ConfirmDialog
      visible={items !== undefined}
      header={count === 1 ? `Delete 1 item from ${table}?` : `Delete ${String(count)} items from ${table}?`}
      body={
        <>
          {count === 1
            ? 'It is deleted from your local emulator. This cannot be undone.'
            : 'They are deleted from your local emulator. This cannot be undone.'}
          <Box variant="span" display="block" margin={{ top: 'xs' }} nativeAttributes={{ role: 'list' }}>
            {items?.map((item) => {
              const key = keyText(item, keys);
              return (
                <Box variant="span" display="block" key={key} nativeAttributes={{ role: 'listitem' }}>
                  <ValueText kind="name" value={nameIdentity(key)} />
                </Box>
              );
            })}
          </Box>
        </>
      }
      word="delete"
      action="Delete"
      pending={sending || deletion.pending}
      onConfirm={handleConfirm}
      onDismiss={onClose}
    />
  );
}
