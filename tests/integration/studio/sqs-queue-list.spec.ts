// SQS's queue list, S1, and the routes to its screens, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 481: task 1 and the requirement's "Screens, routes, layer").
//
// `studio.sqs-routes-lead-to-the-queue-screens`, `studio.sqs-queues-made-outside-are-listed-with-counts`,
// `studio.sqs-queue-search-and-pages`, `studio.sqs-emulator-restart-shows-the-empty-emulator`.
//
// Each check names its queues with its own prefix `<p>` and deletes them when it ends (`SqsSeeded`). Counts compared
// with the screen are read directly from the emulator. Words, direct calls and readers: `services/sqs/sqs.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { crumbs, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, heading, SIDE_NAVIGATION, SIDE_NAVIGATION_ACTIVE } from './support/frame';
import { Lines } from './support/lines';
import { expectNoScreenPart } from './support/no-screen-part';
import { checkPrefix } from './support/service-screens';
import {
  CLEAR_FILTER,
  countsDirect,
  expectRows,
  isOperation,
  LIST_H1,
  NAVIGATION_HEADER,
  NEXT_PAGE,
  NO_MATCHES,
  NO_QUEUES,
  NO_QUEUES_TEXT,
  noMatchText,
  NOT_FOUND,
  open,
  QUEUES_PATH,
  queuePath,
  receiveDirect,
  REFRESH,
  rowsOf,
  SEARCH,
  sendDirect,
  SqsSeeded,
  SQS_PATH,
  TABLE,
} from './services/sqs/sqs';

const SERVICE_LABEL = 'Amazon Simple Queue Service';

/** Waits for the page's answer to a `ListQueues` whose input `holds`, sent while `act` runs or after it. */
async function listed(page: Page, holds: (input: Record<string, unknown>) => boolean, act: () => Promise<void>) {
  const answer = page.waitForResponse(
    (r) => {
      if (!isOperation(r.request().headers(), 'ListQueues')) return false;
      try {
        return holds(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
  await act();
  await answer;
}

/** Types `text` into the list's search and waits for the page's `ListQueues` of that prefix to be answered. */
async function search(page: Page, text: string): Promise<void> {
  await listed(
    page,
    (input) => (input.QueueNamePrefix ?? '') === text,
    () => page.getByRole('searchbox', { name: SEARCH, exact: true }).fill(text, ACTION),
  );
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-routes-lead-to-the-queue-screens', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'routes');
  const seeded = new SqsSeeded(ctx, port, p);
  const standard = await seeded.queue(`${p}-std`);
  const fifo = await seeded.queue(`${p}-f.fifo`, { FifoQueue: 'true' });
  const table = page.locator(TABLE).first();

  await lines.line(
    'Open `/aws/sqs/queues` directly → the same list as at `/aws/sqs`, the address unchanged; the crumbs `EmuForge > AWS > SQS > Queues`; the side navigation "SQS" with its one entry "Queues", current',
    async () => {
      await open(page, SQS_PATH, LIST_H1);
      await search(page, p);
      await expectRows(table, (r) => r.Name, [fifo.name, standard.name].sort(), 'the rows at /aws/sqs');
      const atService = await rowsOf(table);
      await open(page, QUEUES_PATH, LIST_H1);
      await expect(page).toHaveURL(addressOf(QUEUES_PATH));
      await search(page, p);
      await expectRows(table, (r) => r, atService, 'the rows at /aws/sqs/queues, as at /aws/sqs');
      expect(await crumbs(page), 'the crumbs').toEqual(['EmuForge', 'AWS', 'SQS', 'Queues']);
      const navigation = page.locator(SIDE_NAVIGATION);
      await expect(navigation.getByRole('link', { name: NAVIGATION_HEADER, exact: true })).toBeVisible();
      const links = (await navigation.getByRole('link').allInnerTexts()).map((t) => t.trim());
      expect(links, 'the side navigation: its header and one entry').toEqual([NAVIGATION_HEADER, 'Queues']);
      await expect(page.locator(SIDE_NAVIGATION_ACTIVE), 'the current entry').toHaveText('Queues');
    },
  );

  await lines.line(
    'The FIFO queue\'s name → `/aws/sqs/queues/queue/<name>.fifo`, the name as the `h1`, the crumbs `EmuForge > AWS > SQS > Queues > <name>.fifo`',
    async () => {
      await table.getByRole('link', { name: fifo.name, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(queuePath(fifo.name)));
      await expect(heading(page, fifo.name)).toBeVisible();
      expect(await crumbs(page), 'the crumbs').toEqual(['EmuForge', 'AWS', 'SQS', 'Queues', fifo.name]);
    },
  );

  await lines.line(
    '`/aws/sqs/other` and `/aws/sqs/queues/queue/<name>/more` → the area\'s "No screen yet" page',
    async () => {
      await page.goto(`${SQS_PATH}/other`);
      await expectNoScreenPart(page, SERVICE_LABEL, `${SQS_PATH}/other`);
      const below = `${queuePath(standard.name)}/more`;
      await page.goto(below);
      await expectNoScreenPart(page, SERVICE_LABEL, below);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-queues-made-outside-are-listed-with-counts', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'counts');
  const seeded = new SqsSeeded(ctx, port, p);
  const table = page.locator(TABLE).first();

  const orders = await seeded.queue(`${p}-orders`);
  await seeded.messages(orders, 4);
  expect((await receiveDirect(ctx, port, orders.url, 60, 1)).length, 'one message received directly').toBe(1);
  await sendDirect(ctx, port, orders.url, 'later', { DelaySeconds: 60 });
  const fifo = await seeded.queue(`${p}-events.fifo`, { FifoQueue: 'true' });
  const { source, dlq } = await seeded.redrivePair(`${p}-src`, `${p}-dlq`, 3);
  const direct = await countsDirect(ctx, port, orders.url);
  expect(direct, 'the first queue, directly').toEqual({ available: 3, inFlight: 1, delayed: 1 });

  await lines.line(
    'Open `/aws/sqs` → each queue with its type, and Available, In flight and Delayed as the emulator reports them (3, 1, 1); the source\'s "Dead-letter queue" names the dead-letter queue, whose "Dead-letter queue for" names the source; each name leads to its queue\'s page',
    async () => {
      await open(page, SQS_PATH, LIST_H1);
      await search(page, p);
      const pick = (r: Record<string, string>) => [
        r.Name,
        r.Type,
        r.Available,
        r['In flight'],
        r.Delayed,
        r['Dead-letter queue'],
        r['Dead-letter queue for'],
      ];
      await expectRows(
        table,
        pick,
        [
          [dlq.name, 'Standard', '0', '0', '0', '-', source.name],
          [fifo.name, 'FIFO', '0', '0', '0', '-', '-'],
          [orders.name, 'Standard', '3', '1', '1', '-', '-'],
          [source.name, 'Standard', '0', '0', '0', dlq.name, '-'],
        ],
        'the rows under the prefix',
      );
      for (const name of [orders.name, dlq.name]) {
        await table.getByRole('link', { name, exact: true }).first().click(ACTION);
        await expect(page).toHaveURL(addressOf(queuePath(name)));
        await expect(heading(page, name)).toBeVisible();
        await page.goBack();
        await expect(heading(page, LIST_H1)).toBeVisible();
      }
    },
  );

  await lines.line('Send one message directly, then "Refresh" → the first queue\'s Available is 4, as the emulator reports', async () => {
    await open(page, SQS_PATH, LIST_H1);
    await search(page, orders.name);
    await expectRows(table, (r) => [r.Name, r.Available], [[orders.name, '3']], 'before the send');
    await sendDirect(ctx, port, orders.url, 'one more');
    expect((await countsDirect(ctx, port, orders.url)).available, 'available, directly').toBe(4);
    await page.getByRole('button', { name: REFRESH, exact: true }).first().click(ACTION);
    await expectRows(table, (r) => [r.Name, r.Available], [[orders.name, '4']], 'after "Refresh"');
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-queue-search-and-pages', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'pages');
  const seeded = new SqsSeeded(ctx, port, p);
  const table = page.locator(TABLE).first();
  const names: string[] = [];
  for (let i = 1; i <= 12; i++) names.push((await seeded.queue(`${p}-a${String(i).padStart(2, '0')}`)).name);
  const other = (await seeded.queue(`${p}-b01`)).name;
  const first = `${p}-a`;

  await lines.line(
    'Search the first prefix with page size 10 → 10 queues, "next page" shows the other 2, none of the other prefix',
    async () => {
      await open(page, SQS_PATH, LIST_H1);
      await search(page, first);
      await expectRows(table, (r) => r.Name, names.slice(0, 10), 'the first page');
      await listed(
        page,
        (input) => input.QueueNamePrefix === first && typeof input.NextToken === 'string',
        () => page.getByRole('button', { name: NEXT_PAGE, exact: true }).click(ACTION),
      );
      await expectRows(table, (r) => r.Name, names.slice(10), 'the next page');
      expect((await rowsOf(table)).map((r) => r.Name), 'the other prefix').not.toContain(other);
    },
  );

  await lines.line(
    'Search the prefix with one letter\'s case changed → "No matches" and its sentence; "Clear filter" lists the queues again',
    async () => {
      // The case of the letter the check itself put in the names (`-a` → `-A`), whatever the run's prefix.
      const changed = `${p}-A`;
      await open(page, SQS_PATH, LIST_H1);
      await search(page, changed);
      await expect(table.getByText(NO_MATCHES, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(table.getByText(noMatchText(changed))).toBeVisible();
      await table.getByRole('button', { name: CLEAR_FILTER, exact: true }).click(ACTION);
      await expect.poll(async () => (await rowsOf(table)).length, { message: 'rows after "Clear filter"' }).toBeGreaterThan(0);
      await expect(page.getByRole('searchbox', { name: SEARCH, exact: true })).toHaveValue('');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-emulator-restart-shows-the-empty-emulator', async ({ ctx, page, context }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'restart');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-kept`);
  const table = page.locator(TABLE).first();

  await open(page, SQS_PATH, LIST_H1);
  await expectRows(table, (r) => r.Name, [queue.name], 'the list before the restart');
  const second = await context.newPage();
  await open(second, queuePath(queue.name), queue.name);

  await lines.line(
    'The emulator restarted → `/aws/sqs` shows "No queues" and its text, and the queue\'s page "No queue named {name}", without a reload',
    async () => {
      await emulator.stop();
      // A read while the emulator is stopped fails; each page reads again by itself once it is connected again.
      await expectLine(page, notStartedOn(port));
      await page.getByRole('button', { name: REFRESH, exact: true }).first().click(ACTION);
      await second.getByRole('button', { name: REFRESH, exact: true }).first().click(ACTION);
      await expectLine(second, notStartedOn(port));
      await emulator.startAgain();
      await expect(table.getByText(NO_QUEUES, { exact: true }), `"${NO_QUEUES}"`).toBeVisible({ timeout: 60_000 });
      await expect(table.getByText(NO_QUEUES_TEXT)).toBeVisible();
      await second.bringToFront();
      await expect(second.getByText(NOT_FOUND), `"${NOT_FOUND} …" on the queue's page`).toBeVisible({
        timeout: 60_000,
      });
      await expect(second.getByRole('main')).toContainText(`${NOT_FOUND} ${queue.name}`);
    },
  );

  lines.end();
});
