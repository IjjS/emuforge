// Deleting an SQS queue, from the queue list (S1) and from the queue's page (S2), in the built app in front of a real
// engine and emulator (test-criteria.md, issue 490).
//
// `studio.sqs-delete-queue-from-the-list`, `studio.sqs-delete-dead-letter-queue-from-its-page`,
// `studio.sqs-delete-queue-already-gone`.
//
// Each check names its queues with its own prefix `<p>` and deletes every queue under it when it ends (`SqsSeeded`).
// What the emulator holds afterwards is read directly. Words, direct calls and readers: `services/sqs/sqs.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  answered,
  attributesDirect,
  confirmWith,
  countsDirect,
  deadLetterOf,
  DELETE,
  DELETE_QUEUE,
  deletedQueue,
  deleteQueueFailed,
  eventually,
  expectFlash,
  expectListed,
  expectValue,
  flashItems,
  LIST_H1,
  NON_EXISTENT_QUEUE,
  NOT_FOUND,
  open,
  queueNamesDirect,
  queuePath,
  queueRadio,
  QUEUES_PATH,
  queueUrlDirect,
  sqsOk,
  SqsSeeded,
} from './services/sqs/sqs';

test('studio.sqs-delete-queue-from-the-list', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'd-list');
  const seeded = new SqsSeeded(ctx, port, p);
  const orders = await seeded.queue(`${p}-orders`);
  await seeded.messages(orders, 1);
  const main = page.getByRole('main');

  await lines.line(
    'On the queue list, select `orders`, "Delete", type `delete`, "Delete" → "Deleted queue orders" and the list without `orders`, and the emulator\'s `ListQueues` no longer holds it',
    async () => {
      expect((await countsDirect(ctx, port, orders.url)).available, 'the queue holds one message, directly').toBe(1);
      await open(page, QUEUES_PATH, LIST_H1);
      await expectListed(page, p, [orders.name]);
      await queueRadio(page, orders.name).check(ACTION);
      await main.getByRole('button', { name: DELETE, exact: true }).click(ACTION);
      await answered(page, 'DeleteQueue', () => confirmWith(page, 'delete', DELETE));
      await expectFlash(page, 'success', deletedQueue(orders.name));
      await expectListed(page, p, []);
      expect(
        await eventually(5_000, () => queueNamesDirect(ctx, port, p), (names) => names.length === 0),
        'the queues of the prefix, directly',
      ).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-delete-dead-letter-queue-from-its-page', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'd-dlq');
  const seeded = new SqsSeeded(ctx, port, p);
  const { source, dlq } = await seeded.redrivePair(`${p}-source`, `${p}-dead`, 3);
  const policyBefore = (await attributesDirect(ctx, port, source.url)).RedrivePolicy;
  const main = page.getByRole('main');

  await lines.line(
    'Open `dead`\'s page, "Delete queue"; the dialog says it is the dead-letter queue of `source`; type `delete`, "Delete" → the queue list opens with "Deleted queue dead" and without `dead`, and the emulator no longer holds `dead` while `source` still holds its redrive policy',
    async () => {
      expect(policyBefore, 'the source\'s redrive policy before').toBeDefined();
      await open(page, queuePath(dlq.name), dlq.name);
      await expectValue(page, 'Dead-letter queue for', source.name);
      await main.getByRole('button', { name: DELETE_QUEUE, exact: true }).click(ACTION);
      await expect(page.getByRole('dialog'), 'the dialog names the source').toContainText(deadLetterOf([source.name]));
      await answered(page, 'DeleteQueue', () => confirmWith(page, 'delete', DELETE));
      await expect(page).toHaveURL(addressOf(QUEUES_PATH), { timeout: 15_000 });
      await expect(heading(page, LIST_H1)).toBeVisible();
      await expectFlash(page, 'success', deletedQueue(dlq.name));
      await expectListed(page, p, [source.name]);
      expect(
        await eventually(5_000, () => queueUrlDirect(ctx, port, dlq.name), (v) => v === null),
        'GetQueueUrl of the dead-letter queue, directly',
      ).toBeNull();
      expect(
        (await attributesDirect(ctx, port, source.url)).RedrivePolicy,
        'the source\'s redrive policy, directly',
      ).toBe(policyBefore);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-delete-queue-already-gone', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'd-gone');
  const seeded = new SqsSeeded(ctx, port, p);
  const orders = await seeded.queue(`${p}-orders`);
  const main = page.getByRole('main');

  await lines.line(
    'Delete `orders` with the AWS SDK; in Studio "Delete queue", type `delete`, "Delete" → "Delete queue orders failed" with the code `AWS.SimpleQueueService.NonExistentQueue` and its message, no flash says it was deleted, and the page shows the queue is not in the emulator',
    async () => {
      await open(page, queuePath(orders.name), orders.name);
      await expectValue(page, 'Available', '0');
      await sqsOk(ctx, port, 'DeleteQueue', { QueueUrl: orders.url });
      await main.getByRole('button', { name: DELETE_QUEUE, exact: true }).click(ACTION);
      await answered(page, 'DeleteQueue', () => confirmWith(page, 'delete', DELETE));
      await expectFlash(page, 'error', deleteQueueFailed(orders.name), NON_EXISTENT_QUEUE, 'does not exist');
      await expect(flashItems(page, 'success'), 'no flash says the queue was deleted').toHaveCount(0);
      await expect(main, 'the page shows the queue is not in the emulator').toContainText(
        `${NOT_FOUND} ${orders.name}`,
        { timeout: 15_000 },
      );
    },
  );

  lines.end();
});
