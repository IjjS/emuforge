// The filter of a table's "Items" (S2), in the built app in front of a real engine and emulator (test-criteria.md,
// issue 512: task 6, filter the explored items by attribute values).
//
// `studio.dynamodb-filter-a-scan-by-attribute-values`, `studio.dynamodb-filter-a-query-and-a-refused-filter`,
// `studio.dynamodb-filtered-pages-say-what-they-read`.
//
// Each check names its table with its own prefix `<p>` and removes it when it ends (`DynamoDbSeeded`). What the
// emulator holds is read directly. A refusal's message is the one the emulator gave the page's own request, as the
// engine relayed it. Every line starts from the table's page opened afresh, so a line that fails leaves the next
// one its own start. Words, direct calls and readers: `services/dynamodb/dynamodb.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  answered,
  DynamoDbSeeded,
  ENTER_ATTRIBUTE_NAME,
  expectRows,
  filteredHeading,
  filterScreen,
  itemsDirect,
  NO_CONDITIONS,
  NO_MATCHING_ITEMS,
  NO_MATCHING_ON_PAGE,
  NO_MORE_MATCHING,
  noItemMatchesFilter,
  noneOfRead,
  open,
  readAndMatched,
  refused,
  removeConditions,
  rowsOf,
  setCondition,
  tablePath,
  tableScreen,
  type Item,
} from './services/dynamodb/dynamodb';

/** "The ten orders" of test-criteria.md: probe-1's items, table `pk` S and `sk` N. */
const TEN_ORDERS: Item[] = [
  {
    pk: { S: 'c1' },
    sk: { N: '1' },
    status: { S: 'open' },
    total: { N: '10' },
    paid: { BOOL: false },
    name: { S: 'Ann' },
    bin: { B: 'AQI=' },
    tags: { SS: ['blue', 'red'] },
  },
  {
    pk: { S: 'c1' },
    sk: { N: '2' },
    status: { S: 'open' },
    total: { N: '25.5' },
    paid: { BOOL: true },
    name: { S: 'Bob' },
    bin: { B: 'AQM=' },
  },
  { pk: { S: 'c1' }, sk: { N: '3' }, status: { S: 'shipped' }, total: { N: '100' }, paid: { BOOL: true } },
  { pk: { S: 'c1' }, sk: { N: '4' }, status: { S: 'shipped' }, total: { N: '-3' }, paid: { BOOL: false } },
  { pk: { S: 'c1' }, sk: { N: '5' }, status: { S: 'closed' }, total: { N: '7' }, paid: { BOOL: true } },
  { pk: { S: 'c1' }, sk: { N: '6' }, status: { S: 'closed' }, total: { S: 'text-total' }, paid: { BOOL: false } },
  { pk: { S: 'c2' }, sk: { N: '1' }, status: { S: 'open' }, total: { N: '10' }, paid: { BOOL: true } },
  { pk: { S: 'c2' }, sk: { N: '2' }, status: { S: 'closed' }, total: { N: '11' } },
  { pk: { S: 'c3' }, sk: { N: '1' }, status: { S: 'open' }, total: { N: '10' }, paid: { S: 'yes' } },
  { pk: { S: 'c3' }, sk: { N: '2' }, status: { S: 'Open' } },
];

/** Items by their key `pk`, `sk` (a Number), whatever order their attributes came in. */
function byKey(items: Item[]): Item[] {
  const key = (item: Item) => [String(item.pk?.S), Number(item.sk?.N)] as const;
  return [...items].sort((a, b) => {
    const [pa, sa] = key(a);
    const [pb, sb] = key(b);
    return pa === pb ? sa - sb : pa < pb ? -1 : 1;
  });
}

/** The items the emulator holds, each String set in code point order (a set has no order of its own). */
function withSortedSets(items: Item[]): Item[] {
  return items.map((item) =>
    Object.fromEntries(
      Object.entries(item).map(([name, value]) => [
        name,
        Array.isArray(value.SS) ? { SS: [...(value.SS as string[])].sort() } : value,
      ]),
    ),
  );
}

/** A shown row as `pk/sk` ("c1/2"): each key cell is its type, a space and its value. */
const order = (row: Record<string, string>) =>
  `${(row.pk ?? '').replace(/^S /, '')}/${(row.sk ?? '').replace(/^N /, '')}`;

/** The items shown, as `pk/sk`, in code point order: a scan's order is the emulator's own. */
async function expectOrders(page: Page, want: string[], what: string): Promise<void> {
  const s = tableScreen(page);
  await expect
    .poll(async () => (await rowsOf(s.table)).map(order).sort(), { message: what, timeout: 20_000 })
    .toEqual([...want].sort());
}

/** The heading of the result, its counter aside. */
function heading(page: Page) {
  return tableScreen(page).panel.getByRole('heading', { level: 2 });
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-filter-a-scan-by-attribute-values', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-filter-scan');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  await seeded.table(name, { partition: 'pk:S', sort: 'sk:N' }, TEN_ORDERS);
  const s = tableScreen(page);
  const f = filterScreen(page);
  const ALL = TEN_ORDERS.map((item) => `${String(item.pk?.S)}/${String(item.sk?.N)}`);

  /** Opens the table's page: the scan of its ten items, no condition. */
  const fresh = async () => {
    await open(page, tablePath(name), name);
    await expectOrders(page, ALL, 'the scan at start');
  };
  const run = () => answered(page, 'Scan', () => s.run.click(ACTION));
  const STATUS_OPEN = { name: 'status', comparison: 'Equal to', type: 'String', value: 'open' } as const;

  await lines.line(
    'Open `T`\'s page, "Items" → the scan\'s 10 items, the filter with "No conditions. Every item read is shown.". Add the condition `status` "Equal to" String `open`, "Run" → the items c1/1, c1/2, c2/1 and c3/1 and no other, the heading "Scan of T, filtered by 1 condition", "10 items read, 4 match the filter."',
    async () => {
      await fresh();
      await expect(f.group, 'the filter with no condition').toContainText(NO_CONDITIONS);
      await setCondition(page, 1, STATUS_OPEN);
      await run();
      await expectOrders(page, ['c1/1', 'c1/2', 'c2/1', 'c3/1'], '`status` equal to `open`');
      await expect(heading(page), 'the heading').toContainText(filteredHeading('Scan', name, 1));
      await expect(s.panel.getByText(readAndMatched(10, 4), { exact: true }), 'the count line').toBeVisible();
    },
  );

  await lines.line(
    'Add the condition `total` "Greater than" Number `10`, "Run" → the item c1/2 alone, "… filtered by 2 conditions", "10 items read, 1 matches the filter."',
    async () => {
      await fresh();
      await setCondition(page, 1, STATUS_OPEN);
      await setCondition(page, 2, { name: 'total', comparison: 'Greater than', type: 'Number', value: '10' });
      await run();
      await expectOrders(page, ['c1/2'], '`status` `open` and `total` above 10');
      await expect(heading(page), 'the heading').toContainText(filteredHeading('Scan', name, 2));
      await expect(s.panel.getByText(readAndMatched(10, 1), { exact: true }), 'the count line').toBeVisible();
    },
  );

  await lines.line(
    'Change the second condition to "Equal to" String `10`, "Run" → "No matching items" and "No item of T matches the filter."; change its type to Number, "Run" → c1/1, c2/1 and c3/1',
    async () => {
      await fresh();
      await setCondition(page, 1, STATUS_OPEN);
      await setCondition(page, 2, { name: 'total', comparison: 'Greater than', type: 'Number', value: '10' });
      await run();
      await expectOrders(page, ['c1/2'], 'before the change');
      await setCondition(page, 2, { name: 'total', comparison: 'Equal to', type: 'String', value: '10' });
      await run();
      await expect(s.panel.getByText(NO_MATCHING_ITEMS, { exact: true }), `"${NO_MATCHING_ITEMS}"`).toBeVisible({
        timeout: 15_000,
      });
      await expect(s.panel, 'its sentence').toContainText(noItemMatchesFilter(name));
      expect(await rowsOf(s.table), 'no item is shown').toEqual([]);
      await setCondition(page, 2, { name: 'total', comparison: 'Equal to', type: 'Number', value: '10' });
      await run();
      await expectOrders(page, ['c1/1', 'c2/1', 'c3/1'], '`status` `open` and `total` the Number 10');
    },
  );

  await lines.line(
    'Remove the first condition and set the other to: `name` "Equal to" String `Ann` → c1/1 alone; `total` "Between" Number `7` and `25.5` → c1/1, c1/2, c1/5, c2/1, c2/2, c3/1; `tags` "Contains" String `red` → c1/1 alone; `bin` "Equal to" Binary `AQI=` → c1/1 alone; `paid` "Does not exist" → c2/2 and c3/2 (each after "Run")',
    async () => {
      await fresh();
      await setCondition(page, 1, STATUS_OPEN);
      await setCondition(page, 2, { name: 'total', comparison: 'Equal to', type: 'Number', value: '10' });
      await f.remove(1).click(ACTION);
      await expect(f.removes, 'one condition is left').toHaveCount(1);
      await expect(f.name(1), 'the condition left is the second one').toHaveValue('total');

      await setCondition(page, 1, { name: 'name', comparison: 'Equal to', type: 'String', value: 'Ann' });
      await run();
      await expectOrders(page, ['c1/1'], '`name` equal to `Ann`');
      await setCondition(page, 1, { name: 'total', comparison: 'Between', type: 'Number', value: '7', upper: '25.5' });
      await run();
      await expectOrders(page, ['c1/1', 'c1/2', 'c1/5', 'c2/1', 'c2/2', 'c3/1'], '`total` between 7 and 25.5');
      await setCondition(page, 1, { name: 'tags', comparison: 'Contains', type: 'String', value: 'red' });
      await run();
      await expectOrders(page, ['c1/1'], '`tags` contains `red`');
      await setCondition(page, 1, { name: 'bin', comparison: 'Equal to', type: 'Binary', value: 'AQI=' });
      await run();
      await expectOrders(page, ['c1/1'], '`bin` equal to the bytes of `AQI=`');
      await setCondition(page, 1, { name: 'paid', comparison: 'Does not exist' });
      await run();
      await expectOrders(page, ['c2/2', 'c3/2'], '`paid` does not exist');
    },
  );

  await lines.line(
    'Set the condition to `total` "Greater than" Number `abc`, "Run" → no items; in their place the failure with `ValidationException` and "The parameter cannot be converted to a numeric value: abc"; the condition as written',
    async () => {
      await fresh();
      await setCondition(page, 1, { name: 'total', comparison: 'Greater than', type: 'Number', value: 'abc' });
      const refusal = await refused(page, 'Scan', () => s.run.click(ACTION));
      expect(refusal.code, "the emulator's code").toBe('ValidationException');
      expect(refusal.message, "the emulator's message").toBe(
        'The parameter cannot be converted to a numeric value: abc',
      );
      await expect(s.panel, 'the code').toContainText('ValidationException', { timeout: 15_000 });
      await expect(s.panel, "the emulator's message").toContainText(refusal.message);
      expect(await rowsOf(s.table), 'no item is shown').toEqual([]);
      await expect(f.name(1), 'the name as written').toHaveValue('total');
      await expect(f.select('Comparison', 1), 'the comparison as written').toContainText('Greater than');
      await expect(f.select('Type', 1), 'the type as written').toContainText('Number');
      await expect(f.value(1), 'the value as written').toHaveValue('abc');
    },
  );

  await lines.line(
    'Remove every condition, "Run" → the 10 items, the heading "Scan of T", no line about a filter',
    async () => {
      await fresh();
      await setCondition(page, 1, STATUS_OPEN);
      await run();
      await expectOrders(page, ['c1/1', 'c1/2', 'c2/1', 'c3/1'], 'filtered first');
      await removeConditions(page);
      await run();
      await expectOrders(page, ALL, 'the 10 items');
      await expect(heading(page), 'the heading').toContainText(`Scan of ${name}`);
      await expect(heading(page), 'the heading names no filter').not.toContainText('filtered');
      await expect(s.panel.getByText(/match(es)? the filter/), 'no line about a filter').toHaveCount(0);
    },
  );

  await lines.line('The emulator reports the ten orders unchanged', async () => {
    expect(byKey(withSortedSets(await itemsDirect(ctx, port, name))), 'the items the emulator holds').toEqual(
      byKey(TEN_ORDERS),
    );
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-filter-a-query-and-a-refused-filter', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-filter-query');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  await seeded.table(name, { partition: 'pk:S', sort: 'sk:N' }, TEN_ORDERS);
  const s = tableScreen(page);
  const f = filterScreen(page);
  const PK = 'pk (String)';
  const REFUSAL = 'Filter Expression can only contain non-primary key attributes: Primary key attribute: sk';

  /** Opens the table's page and sets a query of `pk` `c1`. */
  const queryOfC1 = async () => {
    await open(page, tablePath(name), name);
    await expect.poll(async () => (await rowsOf(s.table)).length, { message: 'the scan at start', timeout: 20_000 }).toBe(10);
    await s.choice('Query').click(ACTION);
    await s.field(PK).fill('c1', ACTION);
  };
  const run = () => answered(page, 'Query', () => s.run.click(ACTION));
  const SK_ABOVE_2 = { name: 'sk', comparison: 'Greater than', type: 'Number', value: '2' } as const;

  await lines.line(
    '"Query", `pk` `c1`, the condition `paid` "Equal to" Boolean `true`, "Run" → c1/2, c1/3 and c1/5 in that order, the heading "Query of T, filtered by 1 condition", "6 items read, 3 match the filter."; "Order" descending, "Run" → c1/5, c1/3, c1/2',
    async () => {
      await queryOfC1();
      await setCondition(page, 1, { name: 'paid', comparison: 'Equal to', type: 'Boolean', value: 'true' });
      await run();
      await expectRows(s.table, order, ['c1/2', 'c1/3', 'c1/5'], '`paid` true, ascending');
      await expect(heading(page), 'the heading').toContainText(filteredHeading('Query', name, 1));
      await expect(s.panel.getByText(readAndMatched(6, 3), { exact: true }), 'the count line').toBeVisible();
      await s.choice('Descending').click(ACTION);
      await run();
      await expectRows(s.table, order, ['c1/5', 'c1/3', 'c1/2'], '`paid` true, descending');
    },
  );

  await lines.line(
    'Change the condition to `sk` "Greater than" Number `2`, "Run" → no items; in their place the failure with `ValidationException` and "Filter Expression can only contain non-primary key attributes: Primary key attribute: sk"; the condition still reads `sk`, "Greater than", Number, `2`',
    async () => {
      await queryOfC1();
      await setCondition(page, 1, { name: 'paid', comparison: 'Equal to', type: 'Boolean', value: 'true' });
      await run();
      await expectRows(s.table, order, ['c1/2', 'c1/3', 'c1/5'], 'before the change');
      await setCondition(page, 1, SK_ABOVE_2);
      const refusal = await refused(page, 'Query', () => s.run.click(ACTION));
      expect(refusal.code, "the emulator's code").toBe('ValidationException');
      expect(refusal.message, "the emulator's message").toBe(REFUSAL);
      await expect(s.panel, 'the code').toContainText('ValidationException', { timeout: 15_000 });
      await expect(s.panel, "the emulator's message").toContainText(REFUSAL);
      expect(await rowsOf(s.table), 'no item is shown').toEqual([]);
      await expect(f.name(1), 'the name still reads `sk`').toHaveValue('sk');
      await expect(f.select('Comparison', 1), 'the comparison').toContainText('Greater than');
      await expect(f.select('Type', 1), 'the type').toContainText('Number');
      await expect(f.value(1), 'the value').toHaveValue('2');
    },
  );

  await lines.line(
    'Change its name to `total`, "Run" → c1/5, c1/3, c1/2 and c1/1 in that order (the order still descending; the failure gone), "6 items read, 4 match the filter."',
    async () => {
      await queryOfC1();
      await s.choice('Descending').click(ACTION);
      await setCondition(page, 1, SK_ABOVE_2);
      await refused(page, 'Query', () => s.run.click(ACTION));
      await expect(s.panel, 'the failure first').toContainText(REFUSAL, { timeout: 15_000 });
      await f.name(1).fill('total', ACTION);
      await run();
      await expectRows(s.table, order, ['c1/5', 'c1/3', 'c1/2', 'c1/1'], '`total` above 2, descending');
      await expect(s.panel, 'the failure is gone').not.toContainText('ValidationException');
      await expect(s.panel.getByText(readAndMatched(6, 4), { exact: true }), 'the count line').toBeVisible();
    },
  );

  await lines.line(
    'Press "Run" with a condition whose attribute name is empty → "Enter an attribute name." under it, and the items shown before stay',
    async () => {
      await queryOfC1();
      await run();
      await expectRows(s.table, order, ['c1/1', 'c1/2', 'c1/3', 'c1/4', 'c1/5', 'c1/6'], 'the query before');
      await f.add.click(ACTION);
      await expect(f.name(1), 'the new condition has no name').toHaveValue('');
      await s.run.click(ACTION);
      await expect(f.group.getByText(ENTER_ATTRIBUTE_NAME, { exact: true }), `"${ENTER_ATTRIBUTE_NAME}"`).toBeVisible();
      await expectRows(s.table, order, ['c1/1', 'c1/2', 'c1/3', 'c1/4', 'c1/5', 'c1/6'], 'the items shown before stay');
      await expect(heading(page), 'the heading names no filter').not.toContainText('filtered');
    },
  );

  await lines.line('The emulator reports the ten orders unchanged', async () => {
    expect(byKey(withSortedSets(await itemsDirect(ctx, port, name))), 'the items the emulator holds').toEqual(
      byKey(TEN_ORDERS),
    );
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-filtered-pages-say-what-they-read', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-filter-pages');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-t`;
  const kindOf = (sk: number) => (sk <= 3 ? { kind: { S: 'early' } } : sk >= 51 && sk <= 55 ? { kind: { S: 'late' } } : {});
  const items: Item[] = Array.from({ length: 60 }, (_, i) => ({
    pk: { S: 'p' },
    sk: { N: String(i + 1) },
    ...kindOf(i + 1),
  }));
  await seeded.table(name, { partition: 'pk:S', sort: 'sk:N' }, items);
  const s = tableScreen(page);
  const sks = (row: Record<string, string>) => row.sk;
  const text = (words: string) => s.panel.getByText(words, { exact: true });

  /** Opens the table's page (25 items per page at start) and sets a query of `pk` `p` filtered by `kind`. */
  const queryOfKind = async (kind: string) => {
    await open(page, tablePath(name), name);
    await expect.poll(async () => (await rowsOf(s.table)).length, { message: 'the scan at start', timeout: 20_000 }).toBe(25);
    await s.choice('Query').click(ACTION);
    await s.field('pk (String)').fill('p', ACTION);
    await setCondition(page, 1, { name: 'kind', comparison: 'Equal to', type: 'String', value: kind });
    await answered(page, 'Query', () => s.run.click(ACTION));
  };
  const next = () => answered(page, 'Query', () => s.nextPage.click(ACTION));
  /** The page shown is page `n`, and it matched none of the 25 items it read while more remain. */
  const expectNoneOf25 = async (n: number) => {
    await expect(s.pageButton(n), `page ${String(n)} is the page shown`).toHaveAttribute('aria-current', 'true', {
      timeout: 15_000,
    });
    await expect(text(NO_MATCHING_ON_PAGE), `"${NO_MATCHING_ON_PAGE}" on page ${String(n)}`).toBeVisible({
      timeout: 15_000,
    });
    await expect(text(noneOfRead(25, true)), 'its sentence with the number read').toBeVisible();
    expect(await rowsOf(s.table), 'no item is shown').toEqual([]);
    await expect(s.nextPage, '"Next page" is available').toBeEnabled();
  };

  await lines.line(
    '"Query", `pk` `p`, the condition `kind` "Equal to" String `late`, items per page 25, "Run" → no items, "No matching items on this page" and "None of the 25 items this page read matches the filter. More items remain: go to the next page.", "Next page" available',
    async () => {
      await queryOfKind('late');
      await expectNoneOf25(1);
    },
  );

  await lines.line(
    '"Next page" → the same texts (page 2); "Next page" → the items `sk` 51 to 55, "10 items read, 5 match the filter.", "Next page" unavailable; back to page 1 → its texts again',
    async () => {
      await queryOfKind('late');
      await expectNoneOf25(1);
      await next();
      await expectNoneOf25(2);
      await next();
      await expectRows(s.table, sks, ['N 51', 'N 52', 'N 53', 'N 54', 'N 55'], 'page 3');
      await expect(text(readAndMatched(10, 5)), 'the count line').toBeVisible();
      await expect(s.nextPage, '"Next page" is unavailable').toBeDisabled();
      await answered(page, 'Query', () => s.pageButton(1).click(ACTION));
      await expectNoneOf25(1);
    },
  );

  await lines.line(
    'Change the value to `early`, "Run" → `sk` 1 to 3 and "25 items read, 3 match the filter."; "Next page" → "No matching items on this page"; "Next page" → "No more matching items" and "None of the 10 items this page read matches the filter.", "Next page" unavailable',
    async () => {
      await queryOfKind('late');
      await expectNoneOf25(1);
      await filterScreen(page).value(1).fill('early', ACTION);
      await answered(page, 'Query', () => s.run.click(ACTION));
      await expectRows(s.table, sks, ['N 1', 'N 2', 'N 3'], 'page 1');
      await expect(text(readAndMatched(25, 3)), 'the count line').toBeVisible();
      await next();
      await expectNoneOf25(2);
      await next();
      await expect(text(NO_MORE_MATCHING), `"${NO_MORE_MATCHING}"`).toBeVisible({ timeout: 15_000 });
      await expect(text(noneOfRead(10, false)), 'its sentence with the number read').toBeVisible();
      expect(await rowsOf(s.table), 'no item is shown').toEqual([]);
      await expect(s.nextPage, '"Next page" is unavailable').toBeDisabled();
    },
  );

  lines.end();
});
