// A table's items from Studio: the first item of a table made here, editing one and deleting some, in the built app in
// front of a real engine and emulator (test-criteria.md, issue 496: tasks 3 and 4).
//
// `studio.dynamodb-create-a-table-and-its-first-item`, `studio.dynamodb-edit-an-item`, `studio.dynamodb-delete-items`.
//
// Each check names its tables with its own prefix `<p>` and removes them when it ends (`DynamoDbSeeded`), the one
// Studio made included. What the emulator holds afterwards is read directly. A refusal's message is the one the
// emulator gave the page's own request. Words, direct calls and readers: `services/dynamodb/dynamodb.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alreadyThere,
  beingCreated,
  closeDialog,
  CONDITION_FAILED,
  confirmWith,
  countRequests,
  CREATE_ITEM,
  CREATE_TABLE,
  CREATE_TABLE_PATH,
  deleteItemDirect,
  DynamoDbSeeded,
  EDIT_ITEM,
  editorItem,
  expectFlash,
  expectRows,
  h1,
  itemCreated,
  itemDirect,
  itemsDeleted,
  itemsDirect,
  itemSaved,
  KEY_CHANGED,
  NO_ITEMS,
  noLongerThere,
  open,
  refused,
  rowsOf,
  rowWith,
  TAB_DETAILS,
  TAB_ITEMS,
  tableDirect,
  tablePath,
  tableScreen,
  valueOf,
  type Item,
} from './services/dynamodb/dynamodb';

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-create-a-table-and-its-first-item', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-first');
  // Owns the cleanup of the table Studio makes under the prefix.
  new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  const s = tableScreen(page);
  const FIRST = '{"pk": {"S": "a"}, "n": {"N": "1"}, "m": {"M": {"x": {"B": "aGk="}}}}';
  const firstKey: Item = { pk: { S: 'a' }, n: { N: '1' } };

  /** The table's page with its items read, whatever the lines before left. */
  const openItems = async () => {
    await closeDialog(page);
    await open(page, tablePath(name), name);
    await expect(s.createItem, `"${CREATE_ITEM}"`).toBeVisible({ timeout: 20_000 });
  };

  await lines.line(
    '"Create table": name, partition `pk` String, sort `n` Number, On-demand → the table\'s page, "Creating" then "Active" without a reload, "Table {name} is being created." in the Flashbar; the emulator reports the keys and `PAY_PER_REQUEST`',
    async () => {
      expect(await tableDirect(ctx, port, name), 'the emulator holds no such table before').toBeNull();
      await open(page, CREATE_TABLE_PATH, CREATE_TABLE);
      const main = page.getByRole('main');
      await main.getByRole('textbox', { name: 'Table name', exact: true }).fill(name, ACTION);
      await main.getByRole('textbox', { name: 'Partition key', exact: true }).fill('pk', ACTION);
      await main.getByRole('textbox', { name: /^Sort key/ }).fill('n', ACTION);
      await main.getByRole('button', { name: /Sort key type/ }).click(ACTION);
      await page.getByRole('option', { name: 'Number', exact: true }).click(ACTION);
      await expect(main.getByRole('radio', { name: 'On-demand', exact: true }), 'On-demand at start').toBeChecked();
      await main.getByRole('button', { name: CREATE_TABLE, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(tablePath(name)), { timeout: 15_000 });
      await expect(h1(page, name), `the h1 "${name}"`).toBeVisible();
      await expectFlash(page, 'success', beingCreated(name));
      await s.tab(TAB_DETAILS).click(ACTION);
      const statuses: string[] = [];
      await expect
        .poll(
          async () => {
            const status = await valueOf(s.panel, 'Status');
            if (status !== null && statuses.at(-1) !== status) statuses.push(status);
            return status;
          },
          { message: 'Status reads "Active" without a reload', timeout: 20_000, intervals: [100] },
        )
        .toBe('Active');
      ctx.log(`the statuses shown: ${JSON.stringify(statuses)}`);
      // The page was not loaded again since "Create table": the emulator keeps a new table `CREATING` for about 3 s.
      expect(statuses, '"Creating" was shown before "Active"').toEqual(['Creating', 'Active']);
      const table = await tableDirect(ctx, port, name);
      expect(table?.KeySchema, 'the keys, directly').toEqual([
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'n', KeyType: 'RANGE' },
      ]);
      expect(
        [...(table?.AttributeDefinitions ?? [])].sort((a, b) => (a.AttributeName < b.AttributeName ? -1 : 1)),
        'the key types, directly',
      ).toEqual([
        { AttributeName: 'n', AttributeType: 'N' },
        { AttributeName: 'pk', AttributeType: 'S' },
      ]);
      expect(table?.BillingModeSummary?.BillingMode, 'the capacity mode, directly').toBe('PAY_PER_REQUEST');
    },
  );

  await lines.line(
    'Its "Items" → "No items" and "{name} holds no items. …"; "Create item", the text, Save → "Item created in {name}.", the item is listed; the emulator reports it with those values, `x` the bytes of `hi`',
    async () => {
      await openItems();
      await expect(s.tab(TAB_ITEMS), '"Items" is the tab shown').toHaveAttribute('aria-selected', 'true');
      await expect(s.table.getByText(NO_ITEMS, { exact: true }), `"${NO_ITEMS}"`).toBeVisible({ timeout: 20_000 });
      await expect(s.table, 'the sentence').toContainText(`${name} holds no items.`);
      await s.createItem.click(ACTION);
      await expect(s.dialog.getByRole('heading', { name: CREATE_ITEM }), `"${CREATE_ITEM}"`).toBeVisible();
      await s.editor.fill(FIRST, ACTION);
      await s.save.click(ACTION);
      await expectFlash(page, 'success', itemCreated(name));
      await expect(s.dialog, 'the dialog closes').toHaveCount(0);
      await expectRows(s.table, (r) => [r.pk, r.n], [['S a', 'N 1']], 'the item is listed');
      const held = await itemDirect(ctx, port, name, firstKey);
      expect(held, 'the item, directly').toEqual(JSON.parse(FIRST));
      const x = ((held!.m!.M as Item).x!.B as string) ?? '';
      expect(Buffer.from(x, 'base64').toString('utf8'), '`x` as bytes').toBe('hi');
    },
  );

  await lines.line(
    '"Create item" with the same key, Save → "An item with this key is already in {name}. Open it to change it." with `ConditionalCheckFailedException`; the emulator reports the first item unchanged',
    async () => {
      await openItems();
      const before = await itemDirect(ctx, port, name, firstKey);
      expect(before, 'the first item is there').not.toBeNull();
      await s.createItem.click(ACTION);
      await s.editor.fill('{"pk": {"S": "a"}, "n": {"N": "1"}, "other": {"S": "second"}}', ACTION);
      const refusal = await refused(page, 'PutItem', () => s.save.click(ACTION));
      expect(refusal.code, 'the emulator\'s code').toBe(CONDITION_FAILED);
      await expect(s.dialog, 'the sentence').toContainText(alreadyThere(name));
      await expect(s.dialog, 'the code').toContainText(CONDITION_FAILED);
      expect(await itemDirect(ctx, port, name, firstKey), 'the first item, directly').toEqual(before);
      await closeDialog(page);
    },
  );

  await lines.line(
    '"Create item" with a string set holding `a` twice, Save → `ValidationException` and the emulator\'s message, the dialog kept; the emulator holds no such item',
    async () => {
      await openItems();
      const text = '{"pk": {"S": "b"}, "n": {"N": "2"}, "ss": {"SS": ["a", "a"]}}';
      await s.createItem.click(ACTION);
      await s.editor.fill(text, ACTION);
      const refusal = await refused(page, 'PutItem', () => s.save.click(ACTION));
      expect(refusal.code, 'the emulator\'s code').toBe('ValidationException');
      expect(refusal.message, 'the emulator gave a message').not.toBe('');
      await expect(s.dialog, 'the code').toContainText('ValidationException');
      await expect(s.dialog, 'the emulator\'s message').toContainText(refusal.message);
      await expect(s.editor, 'the dialog kept, with its text').toHaveValue(text);
      expect(await itemDirect(ctx, port, name, { pk: { S: 'b' }, n: { N: '2' } }), 'the item, directly').toBeNull();
      await closeDialog(page);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-edit-an-item', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-edit');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  const key = (sk: string): Item => ({ pk: { S: 'k' }, sk: { S: sk } });
  const original: Item = { ...key('1'), a: { S: 'x' }, b: { N: '2' } };
  await seeded.table(name, { partition: 'pk:S', sort: 'sk:S' }, [original]);
  const s = tableScreen(page);

  /** Puts `item` directly, opens the table's page and the item of sort key `sk` from its row. */
  const openItem = async (item: Item, sk: string) => {
    await closeDialog(page);
    await seeded.items(name, [item]);
    await open(page, tablePath(name), name);
    await expect(rowWith(s.table, 'S k', `S ${sk}`), `the row of k/${sk}`).toHaveCount(1, { timeout: 20_000 });
    await rowWith(s.table, 'S k', `S ${sk}`).getByRole('button').click(ACTION);
    await expect(s.dialog.getByRole('heading', { name: EDIT_ITEM }), `"${EDIT_ITEM}"`).toBeVisible();
  };

  await lines.line(
    'Open the item → "Edit item" shows its text; change `a` to `y` and remove `b`, Save → "Item saved in {table}."; the emulator reports `a` `y` and no `b`',
    async () => {
      await openItem(original, '1');
      expect(await editorItem(page), 'the item in the editor').toEqual(original);
      const changed: Item = { ...key('1'), a: { S: 'y' } };
      await s.editor.fill(JSON.stringify(changed, null, 2), ACTION);
      await s.save.click(ACTION);
      await expectFlash(page, 'success', itemSaved(name));
      await expect(s.dialog, 'the dialog closes').toHaveCount(0);
      expect(await itemDirect(ctx, port, name, key('1')), 'the item, directly').toEqual(changed);
    },
  );

  await lines.line(
    'Open it again, change `sk` to `2`, Save → "The key cannot change. …", nothing sent; the emulator holds no `k`/`2`',
    async () => {
      const held: Item = { ...key('1'), a: { S: 'y' } };
      await openItem(held, '1');
      const puts = countRequests(page, 'PutItem');
      await s.editor.fill(JSON.stringify({ ...held, sk: { S: '2' } }, null, 2), ACTION);
      await s.save.click(ACTION);
      await expect(s.dialog, 'the message').toContainText(KEY_CHANGED);
      expect(puts.count, 'PutItem requests the page sent').toBe(0);
      expect(await itemDirect(ctx, port, name, key('2')), 'k/2, directly').toBeNull();
      expect(await itemDirect(ctx, port, name, key('1')), 'k/1, directly').toEqual(held);
      await closeDialog(page);
    },
  );

  await lines.line(
    'Open it, then delete it directly, then Save → "This item is no longer in {table}. …" with `ConditionalCheckFailedException`; the emulator still holds no `k`/`1`',
    async () => {
      const held: Item = { ...key('1'), a: { S: 'y' } };
      await openItem(held, '1');
      await deleteItemDirect(ctx, port, name, key('1'));
      const refusal = await refused(page, 'PutItem', () => s.save.click(ACTION));
      expect(refusal.code, 'the emulator\'s code').toBe(CONDITION_FAILED);
      await expect(s.dialog, 'the sentence').toContainText(noLongerThere(name));
      await expect(s.dialog, 'the code').toContainText(CONDITION_FAILED);
      expect(await itemDirect(ctx, port, name, key('1')), 'k/1, directly').toBeNull();
      await closeDialog(page);
    },
  );

  await lines.line(
    'Item `k`/`3` made directly and listed, then deleted directly, then opened → no dialog, "This item is no longer in {table}. It may have been deleted." and the page no longer lists it',
    async () => {
      await closeDialog(page);
      await seeded.items(name, [{ ...key('3'), a: { S: 'z' } }]);
      await open(page, tablePath(name), name);
      const row = rowWith(s.table, 'S k', 'S 3');
      await expect(row, 'k/3 is listed').toHaveCount(1, { timeout: 20_000 });
      await deleteItemDirect(ctx, port, name, key('3'));
      await row.getByRole('button').click(ACTION);
      await expectFlash(page, 'warning', `${noLongerThere(name)} It may have been deleted.`);
      await expect(s.dialog, 'no dialog').toHaveCount(0);
      await expect
        .poll(async () => (await rowsOf(s.table)).map((r) => r.sk), { message: 'the rows after it', timeout: 20_000 })
        .not.toContain('S 3');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-delete-items', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-delitems');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  await seeded.table(name, { partition: 'id:S' }, [{ id: { S: 'a' } }, { id: { S: 'b' } }, { id: { S: 'c' } }]);
  const s = tableScreen(page);

  await lines.line(
    'Select `a` and `b`, "Delete", type "delete", confirm → "2 items deleted from {table}."; the page lists `c` alone, and the emulator reports `c` alone',
    async () => {
      await open(page, tablePath(name), name);
      await expect
        .poll(async () => (await rowsOf(s.table)).map((r) => r.id).sort(), { message: 'the 3 items', timeout: 20_000 })
        .toEqual(['S a', 'S b', 'S c']);
      await rowWith(s.table, 'S a').getByRole('checkbox').check(ACTION);
      await rowWith(s.table, 'S b').getByRole('checkbox').check(ACTION);
      await s.del.click(ACTION);
      await expect(s.dialog, 'the dialog names how many').toContainText(`Delete 2 items from ${name}?`);
      await confirmWith(page, 'delete', 'Delete');
      await expectFlash(page, 'success', itemsDeleted(2, name));
      await expectRows(s.table, (r) => r.id, ['S c'], 'the page lists `c` alone');
      expect(await itemsDirect(ctx, port, name), 'the items, directly').toEqual([{ id: { S: 'c' } }]);
    },
  );

  lines.end();
});
