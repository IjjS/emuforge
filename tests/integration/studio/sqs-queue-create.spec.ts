// SQS's "Create queue", S3, in the built app in front of a real engine and emulator (test-criteria.md, issue 489).
//
// `studio.sqs-create-standard-queue`, `studio.sqs-create-fifo-queue-with-a-dead-letter-queue`,
// `studio.sqs-create-queue-name-already-taken`, `studio.sqs-create-queue-dead-letter-queue-gone`.
//
// Each check names its queues with its own prefix `<p>` and deletes every queue under it when it ends (`SqsSeeded`),
// those the form created included. What the emulator holds afterwards is read directly. Words, direct calls and
// readers: `services/sqs/sqs.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  answered,
  attributesDirect,
  chooseDeadLetter,
  CREATE_QUEUE,
  CREATE_QUEUE_PATH,
  createdQueue,
  createScreen,
  DEAD_LETTER_TARGET_GONE,
  eventually,
  expectDeadLetterChoices,
  expectFlash,
  expectValue,
  flashItems,
  getQueueUrlRefusal,
  INVALID_PARAMETER_VALUE,
  LIST_H1,
  nameOf,
  nameTaken,
  open,
  openQueue,
  QUEUE_DOES_NOT_EXIST,
  queueNamesDirect,
  queuePath,
  QUEUES_PATH,
  queueUrlDirect,
  sqsOk,
  SqsSeeded,
  valueOf,
} from './services/sqs/sqs';

test('studio.sqs-create-standard-queue', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'c-std');
  new SqsSeeded(ctx, port, p);
  const name = `${p}-orders`;
  const s = createScreen(page);

  await lines.line(
    'From the queue list, "Create queue", the name `orders`, type Standard, no dead-letter queue, "Create queue" → the queue\'s page of `orders` opens with "Created queue orders" and type Standard, and the emulator\'s `ListQueues` holds `orders`, whose attributes have no `FifoQueue`, no `ContentBasedDeduplication` and no `RedrivePolicy`',
    async () => {
      expect(await queueNamesDirect(ctx, port, p), 'no queue of the prefix before').toEqual([]);
      await open(page, QUEUES_PATH, LIST_H1);
      await page.getByRole('main').getByRole('link', { name: CREATE_QUEUE, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_QUEUE_PATH));
      await expect(heading(page, CREATE_QUEUE)).toBeVisible();
      await s.name.fill(name, ACTION);
      await expect(s.type('Standard'), 'type Standard chosen').toBeChecked();
      await expect(s.deadLetterOn, 'no dead-letter queue').not.toBeChecked();
      await answered(page, 'CreateQueue', () => s.submit.click(ACTION));
      await expect(page).toHaveURL(addressOf(queuePath(name)), { timeout: 15_000 });
      await expect(heading(page, name)).toBeVisible();
      await expectFlash(page, 'success', createdQueue(name));
      await expectValue(page, 'Type', 'Standard');
      expect(await queueNamesDirect(ctx, port, p), 'the queues of the prefix, directly').toEqual([name]);
      const url = await queueUrlDirect(ctx, port, name);
      expect(url, 'the queue\'s URL, directly').not.toBeNull();
      const attributes = await attributesDirect(ctx, port, url as string);
      expect(
        [attributes.FifoQueue, attributes.ContentBasedDeduplication, attributes.RedrivePolicy],
        'FifoQueue, ContentBasedDeduplication and RedrivePolicy, directly',
      ).toEqual([undefined, undefined, undefined]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-create-fifo-queue-with-a-dead-letter-queue', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'c-fifo');
  const seeded = new SqsSeeded(ctx, port, p);
  const dead = await seeded.queue(`${p}-dead.fifo`, { FifoQueue: 'true' });
  await seeded.queue(`${p}-plain`);
  const name = `${p}-orders.fifo`;
  const s = createScreen(page);

  await lines.line(
    'Create `orders.fifo`, type FIFO, content-based deduplication on, "Set a dead-letter queue" on; the dead-letter field offers `dead.fifo` and not `plain`; choose `dead.fifo`, maximum receives 3 → the queue\'s page of `orders.fifo` shows type FIFO and the dead-letter queue `dead.fifo`, and the emulator reports for `orders.fifo` `FifoQueue` `true`, `ContentBasedDeduplication` `true`, and a `RedrivePolicy` whose `deadLetterTargetArn` is `dead.fifo`\'s ARN and whose `maxReceiveCount` is 3; `ListDeadLetterSourceQueues` of `dead.fifo` lists it',
    async () => {
      await open(page, CREATE_QUEUE_PATH, CREATE_QUEUE);
      await s.name.fill(name, ACTION);
      await s.type('FIFO').check(ACTION);
      await s.deduplication.check(ACTION);
      await s.deadLetterOn.check(ACTION);
      // Under the check's prefix the emulator holds `dead.fifo` and `plain`: only the FIFO one is offered.
      await expectDeadLetterChoices(page, p, [dead.name]);
      await chooseDeadLetter(page, dead.name);
      await s.maxReceives.fill('3', ACTION);
      await answered(page, 'CreateQueue', () => s.submit.click(ACTION));
      await expect(page).toHaveURL(addressOf(queuePath(name)), { timeout: 15_000 });
      await expectValue(page, 'Type', 'FIFO');
      await expect
        .poll(() => valueOf(page.getByRole('main'), 'Dead-letter queue'), {
          message: `"Dead-letter queue" names ${dead.name}`,
          timeout: 15_000,
        })
        .toContain(dead.name);

      const url = await queueUrlDirect(ctx, port, name);
      expect(url, 'the queue\'s URL, directly').not.toBeNull();
      const attributes = await attributesDirect(ctx, port, url as string);
      expect(
        [attributes.FifoQueue, attributes.ContentBasedDeduplication],
        'FifoQueue and ContentBasedDeduplication, directly',
      ).toEqual(['true', 'true']);
      const policy = JSON.parse(attributes.RedrivePolicy ?? '{}') as Record<string, unknown>;
      expect(
        [policy.deadLetterTargetArn, Number(policy.maxReceiveCount)],
        'the redrive policy\'s dead-letter ARN and maximum receives, directly',
      ).toEqual([dead.arn, 3]);
      const sources = await sqsOk(ctx, port, 'ListDeadLetterSourceQueues', { QueueUrl: dead.url });
      expect(
        ((sources.json.queueUrls ?? sources.json.QueueUrls ?? []) as string[]).map(nameOf),
        'the sources of the dead-letter queue, directly',
      ).toEqual([name]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-create-queue-name-already-taken', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'c-taken');
  const seeded = new SqsSeeded(ctx, port, p);
  const held = await seeded.queue(`${p}-orders`);
  const createdAt = (await attributesDirect(ctx, port, held.url)).CreatedTimestamp;
  const s = createScreen(page);

  await lines.line(
    'Create `orders`, type Standard → the form says "A queue named orders already exists." with the link "Open orders", no flash says it was created, and the emulator holds one `orders`, its `CreatedTimestamp` unchanged',
    async () => {
      expect(createdAt, 'the queue\'s CreatedTimestamp before').toBeDefined();
      await open(page, CREATE_QUEUE_PATH, CREATE_QUEUE);
      await s.name.fill(held.name, ACTION);
      await expect(s.type('Standard'), 'type Standard chosen').toBeChecked();
      await answered(page, 'GetQueueUrl', () => s.submit.click(ACTION), s.submit);
      await expect(s.main, 'the form says the name is taken').toContainText(nameTaken(held.name), { timeout: 15_000 });
      const link = s.main.getByRole('link', { name: openQueue(held.name), exact: true });
      await expect(link, `the link "${openQueue(held.name)}"`).toBeVisible();
      expect(await link.getAttribute('href'), 'the link leads to the queue\'s page').toBe(queuePath(held.name));
      await expect(page, 'the form is still open').toHaveURL(addressOf(CREATE_QUEUE_PATH));
      await expect(flashItems(page, 'success'), 'no flash says a queue was created').toHaveCount(0);
      expect(await queueNamesDirect(ctx, port, p), 'the queues of the prefix, directly').toEqual([held.name]);
      expect(
        (await attributesDirect(ctx, port, held.url)).CreatedTimestamp,
        'the queue\'s CreatedTimestamp, directly',
      ).toBe(createdAt);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-create-queue-dead-letter-queue-gone', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'c-dlq-gone');
  const seeded = new SqsSeeded(ctx, port, p);
  const dead = await seeded.queue(`${p}-dead`);
  const name = `${p}-orders`;
  const s = createScreen(page);

  await lines.line(
    'Create `orders` with "Set a dead-letter queue" on and `dead` chosen; delete `dead` with the AWS SDK; press "Create queue" → the form shows "Create queue failed" with the emulator\'s code `InvalidParameterValue` and its message (it ends "Dead letter target does not exist."), the name `orders` is still in the field, and the emulator\'s `GetQueueUrl` of `orders` answers that the queue does not exist',
    async () => {
      await open(page, CREATE_QUEUE_PATH, CREATE_QUEUE);
      await s.name.fill(name, ACTION);
      await s.deadLetterOn.check(ACTION);
      await expectDeadLetterChoices(page, p, [dead.name]);
      await chooseDeadLetter(page, dead.name);
      await sqsOk(ctx, port, 'DeleteQueue', { QueueUrl: dead.url });
      expect(
        await eventually(5_000, () => queueUrlDirect(ctx, port, dead.name), (v) => v === null),
        'the dead-letter queue is gone, directly',
      ).toBeNull();
      await answered(page, 'CreateQueue', () => s.submit.click(ACTION), s.submit);
      await expect(s.failure, '"Create queue failed" on the form').toBeVisible({ timeout: 15_000 });
      await expect(s.failure, 'the emulator\'s code').toContainText(INVALID_PARAMETER_VALUE);
      await expect(s.failure, 'the emulator\'s message').toContainText(DEAD_LETTER_TARGET_GONE);
      await expect(s.name, 'the name is still in the field').toHaveValue(name);
      await expect(page, 'the form is still open').toHaveURL(addressOf(CREATE_QUEUE_PATH));
      expect(await getQueueUrlRefusal(ctx, port, name), 'GetQueueUrl of the name, directly').toBe(QUEUE_DOES_NOT_EXIST);
    },
  );

  lines.end();
});
