// Items whose keys differ only by a repeated space, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 664).
//
// `studio.dynamodb-item-keys-that-differ-by-spaces-are-told-apart`.
//
// The check makes one table under its prefix `<p>`, of the keys `pk` and `sk` (strings), with two items of the
// partition key `<p>` whose sort keys are `a b` and `a  b` (two spaces), each with an attribute `which` that says
// which it is; the table is removed when the check ends (`DynamoDbSeeded`). An item is named by its key as JSON, in
// which a space next to another is written as a backslash and `u0020` (`SPACE_ESCAPE`). What the emulator holds is
// read directly. Words, direct calls and readers: `services/dynamodb/dynamodb.ts`.

import type { Locator } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix, rowReading, SPACE_ESCAPE } from './support/service-screens';
import {
  closeDialog,
  confirmWith,
  DynamoDbSeeded,
  editorItem,
  expectFlash,
  itemsDeleted,
  itemsDirect,
  open,
  rowsOf,
  tablePath,
  tableScreen,
  type Item,
} from './services/dynamodb/dynamodb';

test('studio.dynamodb-item-keys-that-differ-by-spaces-are-told-apart', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-names');
  const name = `${p}-t`;
  const itemOne: Item = { pk: { S: p }, sk: { S: 'a b' }, which: { S: 'the one-space item' } };
  const itemTwo: Item = { pk: { S: p }, sk: { S: 'a  b' }, which: { S: 'the two-space item' } };
  const seeded = new DynamoDbSeeded(ctx, port, p);
  await seeded.table(name, { partition: 'pk:S', sort: 'sk:S' }, [itemOne, itemTwo]);
  const sortIdentity = `a${SPACE_ESCAPE}${SPACE_ESCAPE}b`;
  /** An item's name on the screen: its key as JSON, the sort key's value written as `sort`. */
  const keyName = (sort: string) => `{"pk":{"S":"${p}"},"sk":{"S":"${sort}"}}`;
  const s = tableScreen(page);
  const opener = (row: Locator, sort: string) => row.getByRole('button', { name: keyName(sort), exact: true });
  const control = (row: Locator, sort: string) =>
    row.getByRole('checkbox', { name: `Select ${keyName(sort)}`, exact: true });
  // Column 1 is the selection control's, column 2 `pk`, column 3 `sk`; a cell starts with the value's type, `S`. A
  // row is found by the sort key it reads; its button and its selection control are that row's.
  const rowOfOne = async () => (await rowReading(s.table, 3, 'S a b')).row;
  const rowOfTwo = async () => (await rowReading(s.table, 3, `S a  b (${sortIdentity})`)).row;
  /** Opens the table's items and waits for its two rows. */
  const listed = async () => {
    await open(page, tablePath(name), name);
    await expect.poll(async () => (await rowsOf(s.table)).length, { message: 'the 2 items', timeout: 20_000 }).toBe(2);
  };

  await lines.line(
    "Open the table's items → a button and a selection control named by each item's key, the two-space one by its identity; the sort key's cell of the two-space row reads the value with its two spaces, followed by the identity in brackets",
    async () => {
      await listed();
      const rowTwo = await rowOfTwo();
      await expect(opener(rowTwo, sortIdentity), `the two-space row's button, named ${keyName(sortIdentity)}`).toHaveCount(1);
      await expect(control(rowTwo, sortIdentity), `the two-space row's control "Select ${keyName(sortIdentity)}"`).toHaveCount(1);
      const rowOne = await rowOfOne();
      await expect(opener(rowOne, 'a b'), `the one-space row's button, named ${keyName('a b')}`).toHaveCount(1);
      await expect(control(rowOne, 'a b'), `the one-space row's control "Select ${keyName('a b')}"`).toHaveCount(1);
    },
  );

  await lines.line("Press the button of the two-space key → the item opened holds the two-space item's attribute", async () => {
    await listed();
    await opener(await rowOfTwo(), sortIdentity).click(ACTION);
    await expect(s.editor, "the item's editor").toBeVisible(ACTION);
    expect(await editorItem(page), 'the item opened').toEqual(itemTwo);
    await closeDialog(page);
  });

  await lines.line(
    "Select the two-space item and delete it → the emulator's table holds the one-space item and not the two-space one",
    async () => {
      await listed();
      await control(await rowOfTwo(), sortIdentity).check(ACTION);
      await s.del.click(ACTION);
      await confirmWith(page, 'delete', 'Delete');
      await expectFlash(page, 'success', itemsDeleted(1, name));
      expect(await itemsDirect(ctx, port, name), 'the items, directly').toEqual([itemOne]);
    },
  );

  lines.end();
});
