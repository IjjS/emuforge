// DynamoDB's table list, S1, and the routes to its screens, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 496: task 1 and the requirement's "Screens, routes, layer").
//
// `studio.dynamodb-tables-made-outside-are-listed`, `studio.dynamodb-routes-lead-to-the-table-screens`,
// `studio.dynamodb-table-search-and-pages`, `studio.dynamodb-emulator-restart-shows-the-empty-emulator`.
//
// Each check names its tables with its own prefix `<p>` and removes them when it ends (`DynamoDbSeeded`). The shared
// emulator holds other checks' tables, so a check reads the list under a search of its own prefix. Words, direct
// calls and readers: `services/dynamodb/dynamodb.ts`.

import { expect, startStack, test } from './support';
import { crumbs, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, SIDE_NAVIGATION, SIDE_NAVIGATION_ACTIVE } from './support/frame';
import { Lines } from './support/lines';
import { expectNoScreenPart } from './support/no-screen-part';
import { checkPrefix } from './support/service-screens';
import {
  CLEAR_SEARCH,
  CREATE_TABLE,
  CREATE_TABLE_PATH,
  DYNAMODB_PATH,
  DynamoDbSeeded,
  expectRows,
  h1,
  LIST_H1,
  listScreen,
  NAVIGATION_HEADER,
  NEXT_PAGE,
  NO_MATCHES,
  NO_TABLES,
  NO_TABLES_TEXT,
  noMatchText,
  NOT_FOUND,
  open,
  PREFERENCES,
  rowsOf,
  search,
  SEARCH,
  SERVICE_LABEL,
  tablePath,
  TABLES_PATH,
} from './services/dynamodb/dynamodb';

/** A row of the list as the criteria name it. */
const listed = (r: Record<string, string>) => [
  r.Name,
  r.Status,
  r['Partition key'],
  r['Sort key'],
  r.Indexes,
  r['Capacity mode'],
];

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-tables-made-outside-are-listed', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-listed');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const s = listScreen(page);
  const a = `${p}-a`;
  const b = `${p}-b`;
  const c = `${p}-c`;
  await seeded.tables([
    [
      a,
      {
        partition: 'pk:S',
        sort: 'sk:N',
        globalIndexes: [{ name: 'by-g', partition: 'g:S' }],
        localIndexes: [{ name: 'by-l', sort: 'l:S' }],
      },
    ],
    [b, { partition: 'id:B', provisioned: { read: 5, write: 7 } }],
  ]);
  const rowA = [a, 'Active', 'pk (S)', 'sk (N)', '2', 'On-demand'];
  const rowB = [b, 'Active', 'id (B)', '-', '0', 'Provisioned (5 read, 7 write)'];

  await lines.line(
    'Open `/aws/dynamodb` → A and B listed, each "Active", A with "pk (S)", "sk (N)", Indexes 2, "On-demand"; B with "id (B)", sort key "-", Indexes 0, "Provisioned (5 read, 7 write)"; each name leads to its table\'s page',
    async () => {
      for (const name of [a, b]) {
        await open(page, DYNAMODB_PATH, LIST_H1);
        await search(page, p);
        await expectRows(s.table, listed, [rowA, rowB], 'the rows under the prefix');
        await s.link(name).click(ACTION);
        await expect(page).toHaveURL(addressOf(tablePath(name)));
        await expect(h1(page, name), `the h1 "${name}"`).toBeVisible();
      }
    },
  );

  await lines.line('Table C made directly, then "Refresh" → C is listed too', async () => {
    await open(page, DYNAMODB_PATH, LIST_H1);
    await search(page, p);
    await expectRows(s.table, (r) => r.Name, [a, b], 'before C is made');
    await seeded.tables([[c, { partition: 'pk:S' }]]);
    await s.refresh.click(ACTION);
    await expectRows(
      s.table,
      listed,
      [rowA, rowB, [c, 'Active', 'pk (S)', '-', '0', 'On-demand']],
      'after "Refresh"',
    );
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-routes-lead-to-the-table-screens', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-routes');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const s = listScreen(page);
  const name = `${p}-t`;
  await seeded.table(name, { partition: 'pk:S' });

  await lines.line(
    'Open `/aws/dynamodb/tables` directly → the same list as at `/aws/dynamodb`, the address unchanged (neither redirects); the crumbs `EmuForge > AWS > DynamoDB > Tables`; the side navigation\'s header "DynamoDB" and its one entry "Tables", current',
    async () => {
      await open(page, DYNAMODB_PATH, LIST_H1);
      await expect(page).toHaveURL(addressOf(DYNAMODB_PATH));
      await search(page, p);
      await expectRows(s.table, (r) => r.Name, [name], 'the rows at /aws/dynamodb');
      const atService = await rowsOf(s.table);
      await expect(page).toHaveURL(addressOf(DYNAMODB_PATH));
      await open(page, TABLES_PATH, LIST_H1);
      await expect(page).toHaveURL(addressOf(TABLES_PATH));
      await search(page, p);
      await expectRows(s.table, (r) => r, atService, 'the rows at /aws/dynamodb/tables, as at /aws/dynamodb');
      await expect(page).toHaveURL(addressOf(TABLES_PATH));
      expect(await crumbs(page), 'the crumbs').toEqual(['EmuForge', 'AWS', 'DynamoDB', 'Tables']);
      const navigation = page.locator(SIDE_NAVIGATION);
      await expect(navigation.getByRole('link', { name: NAVIGATION_HEADER, exact: true })).toBeVisible();
      const links = (await navigation.getByRole('link').allInnerTexts()).map((t) => t.trim());
      expect(links, 'the side navigation: its header and one entry').toEqual([NAVIGATION_HEADER, 'Tables']);
      await expect(page.locator(SIDE_NAVIGATION_ACTIVE), 'the current entry').toHaveText('Tables');
    },
  );

  await lines.line(
    'The table\'s name → `/aws/dynamodb/tables/table/<name>`, the name as the `h1`, the crumbs `EmuForge > AWS > DynamoDB > Tables > <name>`; "Create table" → `/aws/dynamodb/tables/create`, `h1` "Create table"',
    async () => {
      await open(page, TABLES_PATH, LIST_H1);
      await search(page, p);
      await s.link(name).click(ACTION);
      await expect(page).toHaveURL(addressOf(tablePath(name)));
      await expect(h1(page, name), `the h1 "${name}"`).toBeVisible();
      expect(await crumbs(page), 'the crumbs').toEqual(['EmuForge', 'AWS', 'DynamoDB', 'Tables', name]);
      await open(page, TABLES_PATH, LIST_H1);
      await page.getByRole('link', { name: CREATE_TABLE, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_TABLE_PATH));
      await expect(h1(page, CREATE_TABLE), `the h1 "${CREATE_TABLE}"`).toBeVisible();
    },
  );

  await lines.line(
    '`/aws/dynamodb/other` and `/aws/dynamodb/tables/table/<name>/more` → the area\'s "No screen yet" page',
    async () => {
      await page.goto(`${DYNAMODB_PATH}/other`);
      await expectNoScreenPart(page, SERVICE_LABEL, `${DYNAMODB_PATH}/other`);
      const below = `${tablePath(name)}/more`;
      await page.goto(below);
      await expectNoScreenPart(page, SERVICE_LABEL, below);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-table-search-and-pages', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-pages');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const s = listScreen(page);
  const names: string[] = [];
  for (let i = 1; i <= 12; i++) names.push(`${p}-a${String(i).padStart(2, '0')}`);
  const other = `${p}-b01`;
  await seeded.tables([...names, other].map((name) => [name, { partition: 'pk:S' }]));
  const first = `${p}-a`;

  await lines.line(
    'Search the first prefix with page size 10 → 10 tables of it, "next page" shows the other 2, none of the other prefix',
    async () => {
      await open(page, DYNAMODB_PATH, LIST_H1);
      await search(page, first);
      await expectRows(s.table, (r) => r.Name, names, 'the 12 tables of the prefix, at the start\'s page size');
      await page.getByRole('button', { name: PREFERENCES, exact: true }).click(ACTION);
      const dialog = page.getByRole('dialog', { name: PREFERENCES });
      await dialog.getByRole('radio', { name: '10 tables', exact: true }).check(ACTION);
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click(ACTION);
      await expect(dialog, 'the preferences close').toHaveCount(0);
      await expectRows(s.table, (r) => r.Name, names.slice(0, 10), 'the first page of 10');
      await page.getByRole('button', { name: NEXT_PAGE, exact: true }).click(ACTION);
      await expectRows(s.table, (r) => r.Name, names.slice(10), 'the next page');
      expect((await rowsOf(s.table)).map((r) => r.Name), 'the other prefix').not.toContain(other);
    },
  );

  await lines.line(
    'Search the prefix with one letter\'s case changed → "No matches" and "No table name starts with “{text}”."; "Clear search" lists the tables again',
    async () => {
      // The case of the letter the check itself put in the names (`-a` → `-A`), whatever the run's prefix.
      const changed = `${p}-A`;
      await open(page, DYNAMODB_PATH, LIST_H1);
      await search(page, changed);
      await expect(s.table.getByText(NO_MATCHES, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(s.table.getByText(noMatchText(changed))).toBeVisible();
      // The search field has a button of the same name: the empty state's is the one inside the table itself.
      await page.getByRole('table').getByRole('button', { name: CLEAR_SEARCH, exact: true }).click(ACTION);
      await expect
        .poll(async () => (await rowsOf(s.table)).length, { message: 'rows after "Clear search"', timeout: 15_000 })
        .toBeGreaterThan(0);
      await expect(page.getByRole('searchbox', { name: SEARCH, exact: true })).toHaveValue('');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-emulator-restart-shows-the-empty-emulator', async ({ ctx, page, context }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-restart');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const name = `${p}-kept`;
  await seeded.table(name, { partition: 'pk:S' });
  const s = listScreen(page);

  await open(page, DYNAMODB_PATH, LIST_H1);
  await expectRows(s.table, (r) => r.Name, [name], 'the list before the restart');
  const second = await context.newPage();
  await open(second, tablePath(name), name);

  await lines.line(
    'The emulator restarted → `/aws/dynamodb` shows "No tables" and its text, and the table\'s page "No table named {name}", without a reload',
    async () => {
      await emulator.stop();
      // A read while the emulator is stopped fails; each page reads again by itself once it is connected again.
      await expectLine(page, notStartedOn(port));
      await s.refresh.click(ACTION);
      await listScreen(second).refresh.click(ACTION);
      await expectLine(second, notStartedOn(port));
      await emulator.startAgain();
      await expect(s.table.getByText(NO_TABLES, { exact: true }), `"${NO_TABLES}"`).toBeVisible({ timeout: 60_000 });
      await expect(s.table.getByText(NO_TABLES_TEXT)).toBeVisible();
      await second.bringToFront();
      await expect(second.getByRole('main')).toContainText(`${NOT_FOUND} ${name}`, { timeout: 60_000 });
    },
  );

  lines.end();
});
