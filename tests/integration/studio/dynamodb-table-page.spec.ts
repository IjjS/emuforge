// A table's page, S2: "Details", and the "Items" tab's scan and query with its pages, in the built app in front of a
// real engine and emulator (test-criteria.md, issue 496: tasks 1 and 2, and the table gone while its page is open).
//
// `studio.dynamodb-table-details-show-what-the-emulator-holds`, `studio.dynamodb-scan-shows-items-of-every-type`,
// `studio.dynamodb-scan-pages-follow-the-emulator`, `studio.dynamodb-query-by-key-and-condition`,
// `studio.dynamodb-table-gone-while-open`.
//
// Each check names its tables with its own prefix `<p>` and removes them when it ends (`DynamoDbSeeded`). What the
// emulator holds is read directly. A refusal's message is the one the emulator gave the page's own request, as the
// engine relayed it. Words, direct calls and readers: `services/dynamodb/dynamodb.ts`.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  choose,
  closeDialog,
  confirmWith,
  deleteTableDirect,
  DynamoDbSeeded,
  editorItem,
  EDIT_ITEM,
  expectFlash,
  expectRows,
  headersOf,
  itemDirect,
  itemsDeleted,
  itemsDirect,
  NO_MORE_ITEMS,
  NOT_FOUND,
  open,
  refused,
  rowsOf,
  rowWith,
  sorted,
  TAB_DETAILS,
  tablePath,
  tableScreen,
  valueOf,
  type Item,
} from './services/dynamodb/dynamodb';

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-table-details-show-what-the-emulator-holds', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-details');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  const made = await seeded.table(name, {
    partition: 'pk:S',
    sort: 'sk:S',
    globalIndexes: [{ name: 'by-g', partition: 'gpk:S', projection: 'KEYS_ONLY' }],
    localIndexes: [{ name: 'by-l', sort: 'lsk:S', projection: 'ALL' }],
    deletionProtection: true,
    stream: 'NEW_AND_OLD_IMAGES',
  });
  await seeded.timeToLive(name, 'expires');
  const s = tableScreen(page);

  await lines.line(
    'Open its page, "Details" → Status "Active", keys "pk (S)" and "sk (S)", "On-demand", Deletion protection "On", Time to live "On: expires" (or "Turning on: expires" while the emulator reports `ENABLING`), Stream "On: NEW_AND_OLD_IMAGES", the ARN the emulator reports; "Indexes" lists `by-g` Global "Keys only" and `by-l` Local "All" with their keys',
    async () => {
      await open(page, tablePath(name), name);
      await s.tab(TAB_DETAILS).click(ACTION);
      const value = (label: string) => valueOf(s.panel, label);
      await expect.poll(() => value('Status'), { message: 'Status', timeout: 15_000 }).toBe('Active');
      expect(await value('Partition key'), 'Partition key').toBe('pk (S)');
      expect(await value('Sort key'), 'Sort key').toBe('sk (S)');
      expect(await value('Capacity mode'), 'Capacity mode').toBe('On-demand');
      expect(await value('Deletion protection'), 'Deletion protection').toBe('On');
      expect(['On: expires', 'Turning on: expires'], 'Time to live').toContain(await value('Time to live'));
      expect(await value('Stream'), 'Stream').toBe('On: NEW_AND_OLD_IMAGES');
      expect(made.TableArn, 'the ARN the emulator reports').toContain(name);
      expect(await value('ARN'), 'ARN').toContain(made.TableArn);
      const pick = (r: Record<string, string>) => [r.Name, r.Type, r['Partition key'], r['Sort key'], r.Projection];
      const indexes = (await rowsOf(s.table)).map(pick).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
      expect(indexes, 'the indexes').toEqual([
        ['by-g', 'Global', 'gpk (S)', '-', 'Keys only'],
        ['by-l', 'Local', 'pk (S)', 'lsk (S)', 'All'],
      ]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

/** The every-type item of the criteria (probe-1 §2). */
const EVERY_TYPE: Item = {
  pk: { S: 'c1' },
  sk: { S: 'o#001' },
  s: { S: 'text' },
  n: { N: '12.50' },
  b: { B: 'aGVsbG8=' },
  t: { BOOL: true },
  nul: { NULL: true },
  m: { M: { a: { S: 'x' }, nested: { M: { z: { N: '1' } } } } },
  l: { L: [{ S: 'a' }, { N: '2' }] },
  ss: { SS: ['a', 'b'] },
  ns: { NS: ['1', '2'] },
  bs: { BS: ['aGk='] },
};

test('studio.dynamodb-scan-shows-items-of-every-type', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-types');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  await seeded.table(name, { partition: 'pk:S', sort: 'sk:S' }, [
    EVERY_TYPE,
    { pk: { S: 'c2' }, sk: { S: 'o#001' }, amt: { N: '5' } },
    { pk: { S: 'c3' }, sk: { S: 'o#001' } },
  ]);
  const before = sorted(await itemsDirect(ctx, port, name));
  expect(before.length, 'the items the emulator holds').toBe(3);
  const s = tableScreen(page);

  await lines.line(
    'Open its page → "Items" shows a scan of the table, 3 items; the columns are `pk`, `sk`, then `amt`, `b`, `bs`, `l`, `m`, `n`, `ns`, `nul`, `s`, `ss`, `t`; the every-type item\'s cells show each type before its value: `N` `12.5`, `B` `aGVsbG8=`, `BOOL` `true`, `NULL` `null`, `SS` with `a` and `b`; an attribute an item lacks is an empty cell',
    async () => {
      await open(page, tablePath(name), name);
      await expect(s.panel.getByRole('heading', { name: `Scan of ${name}` }), 'a scan of the table').toBeVisible({
        timeout: 15_000,
      });
      await expect.poll(async () => (await rowsOf(s.table)).length, { message: '3 items', timeout: 20_000 }).toBe(3);
      expect(await headersOf(s.table), 'the columns').toEqual([
        'pk',
        'sk',
        'amt',
        'b',
        'bs',
        'l',
        'm',
        'n',
        'ns',
        'nul',
        's',
        'ss',
        't',
      ]);
      const rows = await rowsOf(s.table);
      const row = (pk: string) => rows.find((r) => r.pk === `S ${pk}`);
      const every = row('c1');
      expect(every, 'the every-type item\'s row').toBeDefined();
      expect([every!.pk, every!.sk, every!.s], 'its strings').toEqual(['S c1', 'S o#001', 'S text']);
      expect(every!.n, '`n`').toBe('N 12.5');
      expect(every!.b, '`b`').toBe('B aGVsbG8=');
      expect(every!.t, '`t`').toBe('BOOL true');
      expect(every!.nul, '`nul`').toBe('NULL null');
      expect(every!.ss, '`ss`').toMatch(/^SS .*"a".*"b"/);
      for (const [attribute, type] of [['bs', 'BS'], ['l', 'L'], ['m', 'M'], ['ns', 'NS']] as const) {
        expect(every![attribute], `\`${attribute}\` starts with its type`).toMatch(new RegExp(`^${type} \\S`));
      }
      expect(every!.amt, 'an attribute the every-type item lacks').toBe('');
      expect(row('c2')?.amt, '`amt` of c2').toBe('N 5');
      const bare = row('c3');
      expect(
        Object.entries(bare ?? {}).filter(([header]) => header !== 'pk' && header !== 'sk').map(([, text]) => text),
        'every cell of c3 but its keys is empty',
      ).toEqual(new Array(11).fill(''));
    },
  );

  await lines.line('The emulator reports the 3 items unchanged', async () => {
    expect(sorted(await itemsDirect(ctx, port, name)), 'the items, directly').toEqual(before);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-scan-pages-follow-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-scan');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  const items: Item[] = [];
  for (let i = 1; i <= 50; i++) items.push({ pk: { S: `i${String(i).padStart(2, '0')}` } });
  await seeded.table(name, { partition: 'pk:S' }, items);
  const s = tableScreen(page);
  const keys = async () => (await rowsOf(s.table)).map((r) => r.pk!);

  await lines.line(
    'Items per page 25 (at start) → 25 items; "next page" → 25 other items; "next page" → "No more items", and next page disabled; going back to page 1 → 25 items again; the 50 seen are the 50 the emulator holds',
    async () => {
      await open(page, tablePath(name), name);
      await expect.poll(async () => (await keys()).length, { message: 'page 1: 25 items', timeout: 20_000 }).toBe(25);
      const first = await keys();
      await s.nextPage.click(ACTION);
      await expect
        .poll(async () => {
          const shown = await keys();
          return shown.length === 25 && !shown.some((key) => first.includes(key));
        }, { message: 'page 2: 25 other items', timeout: 20_000 })
        .toBe(true);
      const second = await keys();
      await s.nextPage.click(ACTION);
      await expect(s.table.getByText(NO_MORE_ITEMS, { exact: true }), `"${NO_MORE_ITEMS}"`).toBeVisible({
        timeout: 20_000,
      });
      await expect(s.nextPage, 'next page').toBeDisabled();
      await s.pageButton(1).click(ACTION);
      await expectRows(s.table, (r) => r.pk, first, 'page 1 again');
      const held = (await itemsDirect(ctx, port, name)).map((item) => `S ${String(item.pk!.S)}`).sort();
      expect(held.length, 'the items the emulator holds').toBe(50);
      expect([...first, ...second].sort(), 'the 50 seen').toEqual(held);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-query-by-key-and-condition', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-query');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  const binary = `${p}-b`;
  const BYTES = 'AAH+/w==';
  await seeded.tables([
    [
      name,
      {
        partition: 'pk:S',
        sort: 'sk:N',
        globalIndexes: [{ name: 'by-g', partition: 'g:S', projection: 'KEYS_ONLY' }],
      },
    ],
    [binary, { partition: 'id:B' }],
  ]);
  const whole: Item = { pk: { S: 'p1' }, sk: { N: '1' }, g: { S: 'x' }, v: { S: 'full' } };
  await seeded.items(name, [
    whole,
    { pk: { S: 'p1' }, sk: { N: '2' } },
    { pk: { S: 'p1' }, sk: { N: '3' } },
    { pk: { S: 'p1' }, sk: { N: '10' } },
    { pk: { S: 'p2' }, sk: { N: '1' }, g: { S: 'x' } },
  ]);
  await seeded.items(binary, [{ id: { B: BYTES }, v: { S: 'bin' } }]);
  expect(Buffer.from(BYTES, 'base64'), 'the bytes of the binary key').toEqual(Buffer.from([0, 1, 254, 255]));
  const s = tableScreen(page);
  const PK = 'pk (String)';
  const SK = 'sk (Number)';
  const UPPER = 'sk (Number), upper bound';
  const CONDITION = 'Sort key condition';
  const TARGET = 'Table or index';
  const sks = (r: Record<string, string>) => r.sk;

  /** Opens the table's page and sets a query of `pk` `p1` on the table. */
  const queryOfP1 = async () => {
    await closeDialog(page);
    await open(page, tablePath(name), name);
    await expect.poll(async () => (await rowsOf(s.table)).length, { message: 'the scan at start', timeout: 20_000 }).toBe(5);
    await s.choice('Query').click(ACTION);
    await s.field(PK).fill('p1', ACTION);
  };

  await lines.line('Query, `pk` `p1`, Run → 1, 2, 3, 10 in that order; "Descending", Run → 10, 3, 2, 1', async () => {
    await queryOfP1();
    await s.run.click(ACTION);
    await expectRows(s.table, sks, ['N 1', 'N 2', 'N 3', 'N 10'], 'ascending');
    await s.choice('Descending').click(ACTION);
    await s.run.click(ACTION);
    await expectRows(s.table, sks, ['N 10', 'N 3', 'N 2', 'N 1'], 'descending');
  });

  await lines.line('"Between" 2 and 3 → 2, 3; "Greater than" 3 → 10; "Begins with" is not offered for `sk`', async () => {
    await queryOfP1();
    await s.select(CONDITION).click(ACTION);
    await expect(s.option('Between'), 'the conditions are offered').toBeVisible();
    await expect(s.option('Begins with'), '"Begins with"').toHaveCount(0);
    await s.option('Between').click(ACTION);
    await s.field(SK).fill('2', ACTION);
    await s.field(UPPER).fill('3', ACTION);
    await s.run.click(ACTION);
    await expectRows(s.table, sks, ['N 2', 'N 3'], 'between 2 and 3');
    await choose(page, CONDITION, 'Greater than');
    await s.field(SK).fill('3', ACTION);
    await s.run.click(ACTION);
    await expectRows(s.table, sks, ['N 10'], 'greater than 3');
  });

  await lines.line(
    'Query the index `by-g`, `g` `x` → the two items with `g` `x`, and the result has no `v` column; open `p1`/1 → "Edit item" shows `v` `{"S": "full"}`, the whole item the emulator holds',
    async () => {
      await queryOfP1();
      await choose(page, TARGET, 'by-g (global index)');
      await s.field('g (String)').fill('x', ACTION);
      await s.run.click(ACTION);
      await expect
        .poll(async () => (await rowsOf(s.table)).map((r) => [r.pk, r.sk, r.g]).sort(), {
          message: 'the two items with `g` `x`',
          timeout: 20_000,
        })
        .toEqual([
          ['S p1', 'N 1', 'S x'],
          ['S p2', 'N 1', 'S x'],
        ]);
      expect(await headersOf(s.table), 'the columns').not.toContain('v');
      await rowWith(s.table, 'S p1').getByRole('link').click(ACTION);
      await expect(s.dialog.getByRole('heading', { name: EDIT_ITEM }), `"${EDIT_ITEM}"`).toBeVisible();
      const shown = await editorItem(page);
      expect(shown.v, '`v` in the editor').toEqual({ S: 'full' });
      expect(shown, 'the whole item, as the emulator holds it').toEqual(
        await itemDirect(ctx, port, name, { pk: { S: 'p1' }, sk: { N: '1' } }),
      );
      await closeDialog(page);
    },
  );

  await lines.line(
    '"Between" 10 and 2 → an error with `ValidationException` and the emulator\'s message, the query\'s fields kept',
    async () => {
      await queryOfP1();
      await choose(page, CONDITION, 'Between');
      await s.field(SK).fill('10', ACTION);
      await s.field(UPPER).fill('2', ACTION);
      const refusal = await refused(page, 'Query', () => s.run.click(ACTION));
      expect(refusal.code, 'the emulator\'s code').toBe('ValidationException');
      expect(refusal.message, 'the emulator gave a message').not.toBe('');
      await expect(s.panel, 'the code').toContainText('ValidationException', { timeout: 15_000 });
      await expect(s.panel, 'the emulator\'s message').toContainText(refusal.message);
      await expect(s.field(PK), 'the partition key kept').toHaveValue('p1');
      await expect(s.field(SK), 'the lower bound kept').toHaveValue('10');
      await expect(s.field(UPPER), 'the upper bound kept').toHaveValue('2');
      await expect(s.select(CONDITION), 'the condition kept').toContainText('Between');
    },
  );

  await lines.line(
    'Binary partition key: Query, `id` `AAH+/w==` → that item, its `id` cell `B` `AAH+/w==`; open it → "Edit item" shows `{"B": "AAH+/w=="}` for `id`; select it, "Delete", type "delete" → "1 item deleted from {table}."; the emulator reports no item with those bytes',
    async () => {
      await closeDialog(page);
      await open(page, tablePath(binary), binary);
      await expect.poll(async () => (await rowsOf(s.table)).length, { message: 'the scan at start', timeout: 20_000 }).toBe(1);
      await s.choice('Query').click(ACTION);
      await s.field('id (Binary)').fill(BYTES, ACTION);
      await s.run.click(ACTION);
      await expect(s.panel.getByRole('heading', { name: `Query of ${binary}` }), 'a query of the table').toBeVisible({
        timeout: 15_000,
      });
      await expectRows(s.table, (r) => [r.id, r.v], [[`B ${BYTES}`, 'S bin']], 'the item with those bytes');
      await rowWith(s.table, `B ${BYTES}`).getByRole('link').click(ACTION);
      await expect(s.dialog.getByRole('heading', { name: EDIT_ITEM }), `"${EDIT_ITEM}"`).toBeVisible();
      expect((await editorItem(page)).id, '`id` in the editor').toEqual({ B: BYTES });
      await closeDialog(page);
      await rowWith(s.table, `B ${BYTES}`).getByRole('checkbox').check(ACTION);
      await s.del.click(ACTION);
      await confirmWith(page, 'delete', 'Delete');
      await expectFlash(page, 'success', itemsDeleted(1, binary));
      expect(await itemDirect(ctx, port, binary, { id: { B: BYTES } }), 'the item, directly').toBeNull();
      expect(await itemsDirect(ctx, port, binary), 'the table\'s items, directly').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-table-gone-while-open', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-gone');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  await seeded.table(name, { partition: 'pk:S' }, [{ pk: { S: 'a' } }]);
  const s = tableScreen(page);

  await lines.line(
    '"Create item", Save → `ResourceNotFoundException` and the emulator\'s message; "Refresh" → "No table named {name}" with a link to the tables',
    async () => {
      await open(page, tablePath(name), name);
      await expectRows(s.table, (r) => r.pk, ['S a'], 'the item, before the table is deleted');
      await deleteTableDirect(ctx, port, name);
      await s.createItem.click(ACTION);
      await s.editor.fill('{"pk": {"S": "b"}}', ACTION);
      const refusal = await refused(page, 'PutItem', () => s.save.click(ACTION));
      expect(refusal.code, 'the emulator\'s code').toBe('ResourceNotFoundException');
      expect(refusal.message, 'the emulator gave a message').not.toBe('');
      await expect(s.dialog, 'the code').toContainText('ResourceNotFoundException');
      await expect(s.dialog, 'the emulator\'s message').toContainText(refusal.message);
      await closeDialog(page);
      await s.refresh.click(ACTION);
      await expect(s.main, `"${NOT_FOUND} ${name}"`).toContainText(`${NOT_FOUND} ${name}`, { timeout: 15_000 });
      await expect(s.main.getByRole('link', { name: 'Tables', exact: true }), 'a link to the tables').toBeVisible();
    },
  );

  await lines.line(
    'Open `/aws/dynamodb/tables/table/{a name the emulator does not hold}` and `/aws/dynamodb/tables/table/ab` → "No table named …" for each',
    async () => {
      for (const none of [`${p}-none`, 'ab']) {
        await open(page, tablePath(none), none);
        await expect(s.main, `"${NOT_FOUND} ${none}"`).toContainText(`${NOT_FOUND} ${none}`, { timeout: 15_000 });
      }
    },
  );

  lines.end();
});
