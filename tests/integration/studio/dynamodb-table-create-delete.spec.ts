// Creating a provisioned table with the form's refusals, and deleting tables from the list and from a table's page, in
// the built app in front of a real engine and emulator (test-criteria.md, issue 496: tasks 4 and 5).
//
// `studio.dynamodb-create-table-provisioned-and-refused`, `studio.dynamodb-delete-a-table`.
//
// Each check names its tables with its own prefix `<p>` and removes them when it ends (`DynamoDbSeeded`), those Studio
// made and a protected one included. What the emulator holds afterwards is read directly. A refusal's message is the
// one the emulator gave the page's own request. Words, direct calls and readers: `services/dynamodb/dynamodb.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  beingDeleted,
  confirmWith,
  countRequests,
  CREATE_TABLE,
  CREATE_TABLE_PATH,
  DYNAMODB_PATH,
  DynamoDbSeeded,
  expectFlash,
  expectRows,
  h1,
  LIST_H1,
  listScreen,
  NO_MATCHES,
  open,
  refused,
  rowsOf,
  search,
  seenUntil,
  tableDirect,
  tableNamesDirect,
  tablePath,
  TABLES_PATH,
  tableScreen,
  waitGone,
} from './services/dynamodb/dynamodb';

/** The parts of S3, "Create table", a check acts on. */
function createForm(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    name: main.getByRole('textbox', { name: 'Table name', exact: true }),
    partitionKey: main.getByRole('textbox', { name: 'Partition key', exact: true }),
    mode: (name: string) => main.getByRole('radio', { name, exact: true }),
    read: main.getByRole('textbox', { name: 'Read capacity units', exact: true }),
    write: main.getByRole('textbox', { name: 'Write capacity units', exact: true }),
    submit: main.getByRole('button', { name: CREATE_TABLE, exact: true }),
  };
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-create-table-provisioned-and-refused', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-prov');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const taken = `${p}-taken`;
  const fresh = `${p}-new`;
  await seeded.table(taken, { partition: 'pk:S' });
  const f = createForm(page);

  await lines.line(
    '"Create table" with a new name, Provisioned 5 and 7 → the emulator reports `PROVISIONED` with 5 and 7',
    async () => {
      await open(page, CREATE_TABLE_PATH, CREATE_TABLE);
      await f.name.fill(fresh, ACTION);
      await f.partitionKey.fill('id', ACTION);
      await f.mode('Provisioned').check(ACTION);
      await f.read.fill('5', ACTION);
      await f.write.fill('7', ACTION);
      await f.submit.click(ACTION);
      await expect(page).toHaveURL(addressOf(tablePath(fresh)), { timeout: 15_000 });
      await expect(h1(page, fresh), `the h1 "${fresh}"`).toBeVisible();
      const table = await tableDirect(ctx, port, fresh);
      expect(table, 'the table, directly').not.toBeNull();
      // DynamoDB names the mode of a table only once it has been on-demand: a provisioned one has no summary.
      expect(table!.BillingModeSummary?.BillingMode ?? 'PROVISIONED', 'the capacity mode, directly').toBe('PROVISIONED');
      expect(
        [table!.ProvisionedThroughput?.ReadCapacityUnits, table!.ProvisionedThroughput?.WriteCapacityUnits],
        'the read and write units, directly',
      ).toEqual([5, 7]);
    },
  );

  await lines.line(
    '"Create table" named T → `ResourceInUseException` "Table already exists: T", the form kept with its values',
    async () => {
      await open(page, CREATE_TABLE_PATH, CREATE_TABLE);
      await f.name.fill(taken, ACTION);
      await f.partitionKey.fill('other', ACTION);
      const refusal = await refused(page, 'CreateTable', () => f.submit.click(ACTION));
      expect(refusal.code, 'the emulator\'s code').toBe('ResourceInUseException');
      expect(refusal.message, 'the emulator\'s message').toBe(`Table already exists: ${taken}`);
      await expect(f.main, 'the code').toContainText('ResourceInUseException');
      await expect(f.main, 'the message').toContainText(`Table already exists: ${taken}`);
      await expect(page).toHaveURL(addressOf(CREATE_TABLE_PATH));
      await expect(f.name, 'the name kept').toHaveValue(taken);
      await expect(f.partitionKey, 'the partition key kept').toHaveValue('other');
      const table = await tableDirect(ctx, port, taken);
      expect(table?.KeySchema, 'T keeps its own key, directly').toEqual([{ AttributeName: 'pk', KeyType: 'HASH' }]);
    },
  );

  await lines.line(
    'A name of 2 characters → "The name must have 3 to 255 characters." under it, and no such table in the emulator',
    async () => {
      // Two characters no check names a table with: too short for a table, so it carries no prefix.
      const short = 'zq';
      await open(page, CREATE_TABLE_PATH, CREATE_TABLE);
      const creates = countRequests(page, 'CreateTable');
      await f.name.fill(short, ACTION);
      await f.partitionKey.fill('pk', ACTION);
      await f.submit.click(ACTION);
      await expect(f.main.getByText('The name must have 3 to 255 characters.', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(addressOf(CREATE_TABLE_PATH));
      expect(creates.count, 'CreateTable requests the page sent').toBe(0);
      expect(await tableNamesDirect(ctx, port), 'the tables the emulator holds').not.toContain(short);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.dynamodb-delete-a-table', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ddb-deltable');
  const seeded = new DynamoDbSeeded(ctx, port, p);
  const d1 = `${p}-d1`;
  const d2 = `${p}-d2`;
  const protectedName = `${p}-p`;
  await seeded.tables([
    [d1, { partition: 'pk:S' }],
    [d2, { partition: 'pk:S' }],
    [protectedName, { partition: 'pk:S', deletionProtection: true }],
  ]);
  const s = listScreen(page);

  /** The status the list shows for `name` under the search now; `null` when it lists no such table. */
  const statusOf = async (name: string) => (await rowsOf(s.table)).find((r) => r.Name === name)?.Status ?? null;

  await lines.line(
    'Select D1 in the list, "Delete", type its name → "Table D1 is being deleted.", the row "Deleting" then gone without "Refresh"; the emulator reports no D1',
    async () => {
      await open(page, DYNAMODB_PATH, LIST_H1);
      await search(page, p);
      await expectRows(s.table, (r) => r.Name, [d1, d2, protectedName], 'the three tables');
      await s.select(d1).check(ACTION);
      await s.del.click(ACTION);
      await confirmWith(page, d1, 'Delete');
      await expectFlash(page, 'success', beingDeleted(d1));
      // While the list reads again it shows no row: D1's status is read only from a list that shows D2's row.
      const { seen, reached } = await seenUntil(
        30_000,
        async () => ((await statusOf(d2)) === null ? 'not read yet' : await statusOf(d1)),
        (status) => status === null,
      );
      ctx.log(`D1's status in the list after the delete: ${JSON.stringify(seen)}`);
      expect(reached, 'D1\'s row is gone without "Refresh"').toBe(true);
      expect(seen, 'D1\'s row read "Deleting" before it was gone').toContain('Deleting');
      expect(await waitGone(ctx, port, d1), 'the emulator holds no D1').toBe(true);
    },
  );

  await lines.line(
    'D2\'s page, "Delete table", type its name → the table list, D2 "Deleting" then gone; the emulator reports no D2',
    async () => {
      await open(page, tablePath(d2), d2);
      const t = tableScreen(page);
      await expect(t.deleteTable, '"Delete table"').toBeEnabled({ timeout: 15_000 });
      await t.deleteTable.click(ACTION);
      await confirmWith(page, d2, 'Delete');
      await expect(page).toHaveURL(addressOf(TABLES_PATH), { timeout: 15_000 });
      await expect(h1(page, LIST_H1), 'the table list').toBeVisible();
      await expectFlash(page, 'success', beingDeleted(d2));
      // The shared emulator holds other checks' tables: D2's row is read under a search of its own name.
      await search(page, d2);
      // Until the list shows the search's answer (D2's row alone, or "No matches") the status is not read.
      const { seen, reached } = await seenUntil(
        30_000,
        async () => {
          if ((await s.table.getByText(NO_MATCHES, { exact: true }).count()) > 0) return null;
          const rows = await rowsOf(s.table);
          return rows.length === 1 && rows[0]!.Name === d2 ? (rows[0]!.Status ?? '') : 'not read yet';
        },
        (status) => status === null,
      );
      ctx.log(`D2's status in the list after the delete: ${JSON.stringify(seen)}`);
      expect(reached, 'D2\'s row is gone').toBe(true);
      expect(seen, 'D2\'s row read "Deleting" before it was gone').toContain('Deleting');
      expect(await waitGone(ctx, port, d2), 'the emulator holds no D2').toBe(true);
    },
  );

  await lines.line(
    'Select P, "Delete" → the dialog warns that deletion protection is on; confirm → `ValidationException` and the emulator\'s message; the emulator reports P',
    async () => {
      await open(page, DYNAMODB_PATH, LIST_H1);
      await search(page, protectedName);
      await expectRows(s.table, (r) => r.Name, [protectedName], 'P is listed');
      await s.select(protectedName).check(ACTION);
      await s.del.click(ACTION);
      await expect(s.dialog, 'the warning').toContainText(`Deletion protection is on for ${protectedName}.`);
      const refusal = await refused(page, 'DeleteTable', () => confirmWith(page, protectedName, 'Delete'));
      expect(refusal.code, 'the emulator\'s code').toBe('ValidationException');
      expect(refusal.message, 'the emulator gave a message').not.toBe('');
      await expectFlash(page, 'error', 'ValidationException', refusal.message);
      const table = await tableDirect(ctx, port, protectedName);
      expect(table?.TableStatus, 'P, directly').toBe('ACTIVE');
    },
  );

  lines.end();
});
