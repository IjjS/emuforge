// A queue's page, S2: reading its messages, deleting and purging them, and a queue that is gone, in the built app
// in front of a real engine and emulator (test-criteria.md, issue 481: tasks 2 and 4).
//
// `studio.sqs-read-messages-leaves-them-in-the-queue`, `studio.sqs-read-on-a-redrive-queue-warns-and-moves`,
// `studio.sqs-read-on-a-redrive-queue-after-a-consumer-took-them`, `studio.sqs-read-fifo-queue-shows-groups`, `studio.sqs-delete-read-messages`, `studio.sqs-purge-queue`,
// `studio.sqs-queue-gone-while-open`.
//
// Each check names its queues with its own prefix `<p>` and deletes them when it ends (`SqsSeeded`). What the emulator
// holds afterwards is read directly (`countsDirect`, `receiveDirect` with a visibility of 0). Words, direct calls and
// readers: `services/sqs/sqs.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  answered,
  confirmWith,
  countsDirect,
  DELETE,
  deletedFrom,
  EMPTY_READ,
  eventually,
  expectFlash,
  expectRows,
  expectValue,
  FIFO_FEWER,
  firstOf,
  flashItems,
  FORMAT_JSON,
  movedByRead,
  NON_EXISTENT_QUEUE,
  NOT_FOUND,
  open,
  PURGE,
  PURGE_IN_PROGRESS,
  purged,
  queuePath,
  queueScreen,
  QUEUES_PATH,
  queueUrlDirect,
  readMessages,
  receiveDirect,
  REFRESH,
  rowsOf,
  SEND,
  sendDirect,
  sqsOk,
  SqsSeeded,
  TAB_SEND,
  TABLE,
  valueOf,
  WARNING_FIRST,
  WARNING_STAYS,
  warningMoves,
} from './services/sqs/sqs';

/** The read warning: the Cloudscape alert of `type` above the read controls, holding `text`. */
function warning(page: Page, type: 'info' | 'warning', text: string) {
  return page.locator(`[class*="awsui_type-${type}"]`).filter({ hasText: text });
}

/** The message's detail container's body text, exactly as shown. */
async function shownBody(page: Page): Promise<string> {
  return page.locator('.aws-sqs-message-body').first().innerText();
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-read-messages-leaves-them-in-the-queue', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'read');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-orders`);
  const body = '{"orderId":1}';
  const id = await sendDirect(ctx, port, queue.url, body, {
    MessageAttributes: {
      kind: { DataType: 'String', StringValue: 'order' },
      n: { DataType: 'Number', StringValue: '7' },
      b: { DataType: 'Binary', BinaryValue: 'aGk=' },
    },
  });
  const s = queueScreen(page);

  await lines.line(
    'Open the queue\'s page → the info warning "Reading counts as receiving …" "Messages read here stay in the queue." is shown, and a direct read with a visibility of 0 afterwards finds the message, received once (Studio read nothing on open)',
    async () => {
      await open(page, queuePath(queue.name), queue.name);
      await expect(warning(page, 'info', WARNING_FIRST)).toBeVisible();
      await expect(warning(page, 'info', WARNING_STAYS)).toBeVisible();
      await expectValue(page, 'Available', '1');
      const direct = await receiveDirect(ctx, port, queue.url, 0);
      expect(direct.map((m) => [m.id, m.attributes.ApproximateReceiveCount]), 'a direct read').toEqual([[id, '1']]);
    },
  );

  await lines.line(
    '"Read messages" → the message with its body and receive count 2; its detail shows the body exactly, "Format JSON" indents it, and the attributes `kind` String `order`, `n` Number `7`, `b` Binary `aGk=`',
    async () => {
      await readMessages(page);
      await expectRows(s.table, (r) => [r['Message ID'], r.Body, r['Receive count']], [[id, body, '2']], 'the read');
      await s.messageLink(id).click(ACTION);
      await expect(heading(page, `Message ${id}`).or(page.getByRole('heading', { name: `Message ${id}` }))).toBeVisible();
      expect(await shownBody(page), 'the body as shown').toBe(body);
      await page.getByText(FORMAT_JSON, { exact: true }).click(ACTION);
      const formatted = await shownBody(page);
      expect(formatted, 'the formatted body spans lines').toContain('\n');
      expect(JSON.parse(formatted), 'the formatted body is the same JSON').toEqual(JSON.parse(body));
      const attributes = s.panel.locator(TABLE).nth(1);
      // The emulator's order of attributes is its own; they are compared as a set.
      await expect
        .poll(async () => (await rowsOf(attributes)).map((r) => [r.Name, r.Type, r.Value]).sort(), {
          message: 'the message attributes',
          timeout: 15_000,
        })
        .toEqual([
          ['b', 'Binary', 'aGk='],
          ['kind', 'String', 'order'],
          ['n', 'Number', '7'],
        ]);
    },
  );

  await lines.line('The emulator reports the message still available', async () => {
    expect(await countsDirect(ctx, port, queue.url), 'the counts, directly').toEqual({
      available: 1,
      inFlight: 0,
      delayed: 0,
    });
  });

  await lines.line(
    'Given 12 messages made directly: "Read messages" → 10 are listed and "Showing the first 10 of 12 available messages. …" is shown',
    async () => {
      const many = await seeded.queue(`${p}-many`);
      await seeded.messages(many, 12);
      await open(page, queuePath(many.name), many.name);
      await expectValue(page, 'Available', '12');
      await readMessages(page);
      await expect.poll(async () => (await rowsOf(s.table)).length, { message: 'rows of the read' }).toBe(10);
      await expect(page.getByText(firstOf(10, 12))).toBeVisible();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-read-on-a-redrive-queue-warns-and-moves', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'moves');
  const seeded = new SqsSeeded(ctx, port, p);
  const { source, dlq } = await seeded.redrivePair(`${p}-src`, `${p}-dlq`, 2);
  await sendDirect(ctx, port, source.url, 'poison');
  const s = queueScreen(page);

  await lines.line('Open the source\'s page → the warning names the dead-letter queue and the count 2, before any read', async () => {
    await open(page, queuePath(source.name), source.name);
    await expect(warning(page, 'warning', WARNING_FIRST)).toBeVisible();
    await expect(warning(page, 'warning', warningMoves(2, dlq.name))).toBeVisible();
    await expect(warning(page, 'warning', warningMoves(2, dlq.name)).getByRole('link', { name: dlq.name })).toBeVisible();
  });

  await lines.line('"Read messages" twice → the message is shown with receive count 1, then 2', async () => {
    await readMessages(page);
    await expectRows(s.table, (r) => [r.Body, r['Receive count']], [['poison', '1']], 'the first read');
    await readMessages(page);
    await expectRows(s.table, (r) => [r.Body, r['Receive count']], [['poison', '2']], 'the second read');
  });

  await lines.line(
    '"Read messages" a third time → "1 message received 2 times in this queue was moved to {dlq} by this read instead of being shown." with {dlq} a link, and not the empty-read sentence; the emulator reports the source empty and the message in the dead-letter queue, and the page\'s Available is 0',
    async () => {
      await readMessages(page);
      const moved = s.panel.getByText(movedByRead(1, 2, dlq.name), { exact: true });
      await expect(moved, 'the moved-by-read sentence').toBeVisible();
      await expect(moved.getByRole('link', { name: dlq.name, exact: true }), 'the dead-letter queue as a link').toBeVisible();
      await expect(page.getByText(EMPTY_READ), 'no empty-read sentence').toHaveCount(0);
      expect(await countsDirect(ctx, port, source.url), 'the source, directly').toEqual({
        available: 0,
        inFlight: 0,
        delayed: 0,
      });
      expect((await countsDirect(ctx, port, dlq.url)).available, 'the dead-letter queue, directly').toBe(1);
      await expectValue(page, 'Available', '0');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-read-on-a-redrive-queue-after-a-consumer-took-them', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'taken');
  const seeded = new SqsSeeded(ctx, port, p);
  const { source, dlq } = await seeded.redrivePair(`${p}-src`, `${p}-dlq`, 5);
  await seeded.messages(source, 3);
  const s = queueScreen(page);

  await lines.line(
    'All 3 received directly with a visibility of 600 s, then "Read messages" → the empty-read sentence, and neither "This read returned …" nor a sentence that messages were moved; the emulator reports 0 available and 3 in flight in the source and none in the dead-letter queue',
    async () => {
      await open(page, queuePath(source.name), source.name);
      await expectValue(page, 'Available', '3');
      const taken = await receiveDirect(ctx, port, source.url, 600);
      expect(taken.length, 'received directly by another consumer').toBe(3);
      await readMessages(page);
      await expect(s.panel.getByText(EMPTY_READ), 'the empty-read sentence').toBeVisible();
      await expect(s.panel.getByText(/^This read returned /), 'no "This read returned …"').toHaveCount(0);
      await expect(s.panel.getByText(/ by this read instead of being shown\.$/), 'no moved-by-read sentence').toHaveCount(0);
      expect(await countsDirect(ctx, port, source.url), 'the source, directly').toEqual({
        available: 0,
        inFlight: 3,
        delayed: 0,
      });
      expect((await countsDirect(ctx, port, dlq.url)).available, 'the dead-letter queue, directly').toBe(0);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-read-fifo-queue-shows-groups', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'fifo-read');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-q.fifo`, { FifoQueue: 'true', ContentBasedDeduplication: 'true' });
  for (const [body, group] of [
    ['a1', 'ga'],
    ['a2', 'ga'],
    ['b1', 'gb'],
  ]) {
    await sendDirect(ctx, port, queue.url, body!, { MessageGroupId: group });
  }
  const s = queueScreen(page);

  await lines.line(
    '"Read messages" → all three, each with its group, and their detail shows group and deduplication id; the emulator reports 3 available',
    async () => {
      await open(page, queuePath(queue.name), queue.name);
      await readMessages(page);
      await expectRows(
        s.table,
        (r) => [r.Body, r.Group],
        [
          ['a1', 'ga'],
          ['a2', 'ga'],
          ['b1', 'gb'],
        ],
        'the read',
      );
      const first = (await rowsOf(s.table))[0]!['Message ID']!;
      await s.messageLink(first).click(ACTION);
      const main = page.getByRole('main');
      await expect.poll(async () => (await main.innerText()).includes('Group ID')).toBe(true);
      await expectValue(page, 'Group ID', 'ga');
      await expect
        .poll(async () => (await valueOf(main, 'Deduplication ID'))?.length ?? 0, {
          message: 'a deduplication id is shown',
        })
        .toBeGreaterThan(0);
      expect((await countsDirect(ctx, port, queue.url)).available, 'available, directly').toBe(3);
    },
  );

  await lines.line(
    'One message of `ga` received directly with a visibility of 60 s, then "Read messages" → only `b1`, and the FIFO sentence',
    async () => {
      const held = await receiveDirect(ctx, port, queue.url, 60, 1);
      expect(held.map((m) => m.body), 'received directly').toEqual(['a1']);
      await readMessages(page);
      await expectRows(s.table, (r) => r.Body, ['b1'], 'the read with ga in flight');
      await expect(page.getByText(FIFO_FEWER)).toBeVisible();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-delete-read-messages', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'delete');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-q`);
  await seeded.messages(queue, 3);
  const s = queueScreen(page);

  await lines.line(
    '"Read messages", select 2, "Delete", type "delete" → "Deleted 2 messages from {name}", the 2 rows leave the result, and the emulator holds only the third message',
    async () => {
      await open(page, queuePath(queue.name), queue.name);
      await readMessages(page);
      await expectRows(s.table, (r) => r.Body, ['m-01', 'm-02', 'm-03'], 'the read');
      const ids = (await rowsOf(s.table)).map((r) => r['Message ID']!);
      await s.select(ids[0]!).check(ACTION);
      await s.select(ids[1]!).check(ACTION);
      await s.del.click(ACTION);
      await expect(s.dialog.getByText(`Delete 2 messages from ${queue.name}?`)).toBeVisible();
      await answered(page, 'DeleteMessageBatch', () => confirmWith(page, 'delete', DELETE));
      await expectFlash(page, 'success', deletedFrom(2, queue.name));
      await expectRows(s.table, (r) => r.Body, ['m-03'], 'the result after the delete');
      const left = await receiveDirect(ctx, port, queue.url, 0);
      expect(left.map((m) => m.body), 'what the emulator holds, directly').toEqual(['m-03']);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-purge-queue', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'purge');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-q`);
  await seeded.messages(queue, 3);
  const s = queueScreen(page);

  await lines.line('"Purge", type "purge" → "Purged {name}", and the emulator reports 0 available and 0 in flight', async () => {
    await open(page, queuePath(queue.name), queue.name);
    await expectValue(page, 'Available', '3');
    await s.purge.click(ACTION);
    await answered(page, 'PurgeQueue', () => confirmWith(page, 'purge', PURGE));
    await expectFlash(page, 'success', purged(queue.name));
    const counts = await countsDirect(ctx, port, queue.url);
    expect([counts.available, counts.inFlight], 'available and in flight, directly').toEqual([0, 0]);
  });

  await lines.line(
    'Send one message from the page, then "Purge" again at once → an error with the code `AWS.SimpleQueueService.PurgeQueueInProgress` and the emulator\'s message, and the emulator still holds that message',
    async () => {
      await s.tab(TAB_SEND).click(ACTION);
      await page.getByRole('textbox', { name: 'Body' }).fill('after the purge', ACTION);
      await answered(page, 'SendMessage', () => page.getByRole('button', { name: SEND, exact: true }).click(ACTION));
      await s.purge.click(ACTION);
      await answered(page, 'PurgeQueue', () => confirmWith(page, 'purge', PURGE));
      await expectFlash(page, 'error', PURGE_IN_PROGRESS, 'Only one PurgeQueue operation');
      const held = await receiveDirect(ctx, port, queue.url, 0);
      expect(held.map((m) => m.body), 'what the emulator holds, directly').toEqual(['after the purge']);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-queue-gone-while-open', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'gone');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-q`);
  const s = queueScreen(page);

  await lines.line(
    '"Send" → an error with the code `AWS.SimpleQueueService.NonExistentQueue` and the emulator\'s message; "Read messages" → the same; "Refresh" → "No queue named {name}" with a link to the queues',
    async () => {
      await open(page, queuePath(queue.name), queue.name);
      await expectValue(page, 'Available', '0');
      await sqsOk(ctx, port, 'DeleteQueue', { QueueUrl: queue.url });
      await s.tab(TAB_SEND).click(ACTION);
      await page.getByRole('textbox', { name: 'Body' }).fill('to nowhere', ACTION);
      await answered(page, 'SendMessage', () => page.getByRole('button', { name: SEND, exact: true }).click(ACTION));
      await expectFlash(page, 'error', NON_EXISTENT_QUEUE, 'does not exist');
      await s.tab('Messages').click(ACTION);
      await answered(page, 'ReceiveMessage', () => s.read.click(ACTION));
      await expect
        .poll(async () => flashCount(page, NON_EXISTENT_QUEUE), { message: 'a second error item for the read' })
        .toBeGreaterThanOrEqual(2);
      await page.getByRole('button', { name: REFRESH, exact: true }).first().click(ACTION);
      await expect(page.getByRole('main')).toContainText(`${NOT_FOUND} ${queue.name}`, { timeout: 15_000 });
      // The state's own link, not the side navigation's or the crumbs' "Queues".
      const back = page.getByRole('main').locator('a:not(nav a)').filter({ hasText: /^Queues$/ });
      await expect(back).toBeVisible();
      await back.click(ACTION);
      await expect(page).toHaveURL(addressOf(QUEUES_PATH));
    },
  );

  await lines.line('Open `/aws/sqs/queues/queue/{a name the emulator does not hold}` → "No queue named {name}"', async () => {
    const missing = `${p}-never`;
    await page.goto(queuePath(missing));
    await expect(page.getByRole('main')).toContainText(`${NOT_FOUND} ${missing}`, { timeout: 15_000 });
    expect(
      await eventually(5_000, () => queueUrlDirect(ctx, port, missing), (v) => v === null),
      'the emulator holds no such queue',
    ).toBeNull();
  });

  lines.end();
});

/** How many error flash items hold `text`. */
async function flashCount(page: Page, text: string): Promise<number> {
  return flashItems(page, 'error').filter({ hasText: text }).count();
}
