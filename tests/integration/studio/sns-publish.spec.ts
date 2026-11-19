// SNS's "Publish" tab on a FIFO topic, and what the form and the emulator refuse, in the built app in front of a real
// engine and emulator (test-criteria.md, issue 536: task 3).
//
// `studio.sns-publish-to-a-fifo-topic-and-refusals`.
//
// Words, direct calls and readers: `services/sns/sns.ts`.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  addAttribute,
  answered,
  countActions,
  ENTER_DEDUPLICATION_ID,
  ENTER_GROUP_ID,
  ENTER_MESSAGE,
  NOT_PUBLISHED,
  notificationIn,
  openPublish,
  openTopic,
  publishAndRead,
  publishScreen,
  SnsSeeded,
  topicAttributesDirect,
  valueOf,
} from './services/sns/sns';

test('studio.sns-publish-to-a-fifo-topic-and-refusals', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snspub');
  const seeded = new SnsSeeded(ctx, port, p);
  const fifo = await seeded.topic(`${p}-f.fifo`, { FifoTopic: 'true', ContentBasedDeduplication: 'false' });
  const queue = await seeded.queueFor(`${p}-q.fifo`, fifo, { FifoQueue: 'true' });
  await seeded.subscribe(fifo, 'sqs', queue.arn);
  const standard = await seeded.topic(`${p}-std`);

  await lines.line(
    'S3, "Publish" → the form has "Message group ID" and "Message deduplication ID"; the message `f <prefix>` with neither, "Publish" → "Enter a message group ID." and "Enter a message deduplication ID." at their fields; no request to publish left the page',
    async () => {
      await openTopic(page, fifo);
      await openPublish(page);
      const publishes = countActions(page, 'Publish');
      const s = publishScreen(page);
      await expect(s.groupId, '"Message group ID"').toBeVisible();
      await expect(s.deduplicationId, '"Message deduplication ID"').toBeVisible();
      await s.message.fill(`f ${p}`, ACTION);
      await s.publish.click(ACTION);
      await expect(s.panel.getByText(ENTER_GROUP_ID, { exact: true })).toBeVisible();
      await expect(s.panel.getByText(ENTER_DEDUPLICATION_ID, { exact: true })).toBeVisible();
      expect(publishes.count(), 'requests to publish').toBe(0);
    },
  );

  await lines.line(
    'With the group ID `g1` and the deduplication ID `d1` → "Published" with a message ID and a sequence number; the queue holds the message with the group ID `g1`',
    async () => {
      await openTopic(page, fifo);
      await openPublish(page);
      const s = publishScreen(page);
      await s.message.fill(`f ${p}`, ACTION);
      await s.groupId.fill('g1', ACTION);
      await s.deduplicationId.fill('d1', ACTION);
      const messageId = await publishAndRead(page);
      expect(messageId, 'the message ID shown').not.toBe('');
      const sequence = await valueOf(s.panel, 'Sequence number');
      expect(sequence, 'the sequence number shown').toMatch(/^\d+$/);
      const found = await notificationIn(ctx, port, queue.url, `f ${p}`);
      expect(found, 'the notification in the queue').not.toBeNull();
      expect(found!.notification.MessageId, 'its message ID').toBe(messageId);
      expect(found!.attributes.MessageGroupId, 'the queue message\'s group ID').toBe('g1');
    },
  );

  await lines.line('"Publish" with an empty message → "Enter a message."; no request to publish left the page', async () => {
    await openTopic(page, standard);
    await openPublish(page);
    const publishes = countActions(page, 'Publish');
    const s = publishScreen(page);
    await s.publish.click(ACTION);
    await expect(s.panel.getByText(ENTER_MESSAGE, { exact: true })).toBeVisible();
    expect(publishes.count(), 'requests to publish').toBe(0);
  });

  await lines.line(
    'The message `x` with the attribute `n` "Number" `abc` → "The message was not published" with `ParameterValueInvalid` and the emulator\'s sentence that names `n`; the form\'s text is as typed',
    async () => {
      await openTopic(page, standard);
      await openPublish(page);
      const s = publishScreen(page);
      await s.message.fill('x', ACTION);
      await addAttribute(page, 1, 'n', 'Number', 'abc');
      await answered(page, 'Publish', () => s.publish.click(ACTION));
      await expect(s.panel.getByText(NOT_PUBLISHED, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(s.panel, 'the emulator\'s code').toContainText('ParameterValueInvalid');
      await expect(s.panel, 'the emulator\'s sentence names the attribute').toContainText(/attribute[^.]*\bn\b/i);
      await expect(s.message).toHaveValue('x');
      await expect(s.attributeName(1)).toHaveValue('n');
      await expect(s.attributeValue(1)).toHaveValue('abc');
    },
  );

  await lines.line('The topic deleted directly, "Publish" the message `x` → "The message was not published" with `NotFound`', async () => {
    await openTopic(page, standard);
    await openPublish(page);
    const s = publishScreen(page);
    await s.message.fill('x', ACTION);
    await seeded.deleteTopic(standard);
    expect(await topicAttributesDirect(ctx, port, standard), 'the topic, directly').toBeNull();
    await answered(page, 'Publish', () => s.publish.click(ACTION));
    await expect(s.panel.getByText(NOT_PUBLISHED, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(s.panel, 'the emulator\'s code').toContainText('NotFound');
  });

  lines.end();
});
