// SNS's topics: the list S1, a topic's page S3, creating a topic on S2 and deleting a subscription and a topic, in the
// built app in front of a real engine and emulator (test-criteria.md, issue 536: tasks 1, 4 and 5).
//
// `studio.sns-topics-made-elsewhere-are-shown`, `studio.sns-create-topic-reaches-the-emulator`,
// `studio.sns-delete-a-subscription-and-a-topic`, `studio.sns-screens-follow-an-emulator-restart`.
//
// Each check names its topics, queues and functions with its own prefix `<p>` and deletes them when it ends
// (`SnsSeeded`). The emulator's list holds other checks' topics, so a check finds its topic on S1 by going through
// the pages, or opens S3 by its address. Words, direct calls and readers: `services/sns/sns.ts`.

import { expect, startStack, test } from './support';
import { connectedAt, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ARN_COPIED,
  CANCEL,
  CONFIRMED,
  confirmWith,
  countActions,
  CREATE_TOPIC,
  CREATE_TOPIC_PATH,
  createTopicScreen,
  DEDUPLICATION,
  DELETE,
  deletedSubscription,
  deletedTopic,
  expectFlash,
  expectSubscriptions,
  expectValue,
  FIFO_NAME_ENDING,
  findTopicRow,
  LIST_H1,
  listHeading,
  listScreen,
  NAME_CHARACTERS,
  NO_TOPICS,
  open,
  openTopic,
  PENDING,
  queuePolicyDirect,
  rowsOf,
  SnsSeeded,
  subscriptionsDirect,
  TOPIC_NOT_FOUND,
  topicArnsDirect,
  topicAttributesDirect,
  topicPath,
  topicReady,
  TOPICS_PATH,
  topicScreen,
  valueOf,
  VIEW_TOPICS,
} from './services/sns/sns';

// ---------------------------------------------------------------------------------------------------------------

test('studio.sns-topics-made-elsewhere-are-shown', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snsshown');
  const seeded = new SnsSeeded(ctx, port, p);
  const displayName = `Orders ${p}`;
  const standard = await seeded.topic(`${p}-std`, { DisplayName: displayName });
  const fifo = await seeded.topic(`${p}-f.fifo`, { FifoTopic: 'true', ContentBasedDeduplication: 'true' });
  const queue = await seeded.queue(`${p}-q`);
  await seeded.subscribe(standard, 'sqs', queue.arn);
  const reported = await topicArnsDirect(ctx, port);
  expect(reported, 'the emulator reports both topics').toEqual(expect.arrayContaining([standard, fifo]));

  await lines.line(
    'Open S1 → each topic has a row with its name, its type ("Standard", "FIFO") and its ARN as the emulator reports them',
    async () => {
      await open(page, TOPICS_PATH, LIST_H1);
      expect(await findTopicRow(page, `${p}-std`), 'the standard topic\'s row').toEqual({
        Name: `${p}-std`,
        Type: 'Standard',
        ARN: standard,
      });
      await open(page, TOPICS_PATH, LIST_H1);
      expect(await findTopicRow(page, `${p}-f.fifo`), 'the FIFO topic\'s row').toEqual({
        Name: `${p}-f.fifo`,
        Type: 'FIFO',
        ARN: fifo,
      });
    },
  );

  await lines.line(
    'Choose the standard topic\'s name → S3 opens at the address that holds its ARN; "Topic details" shows the ARN, "Standard", the display name and "1 confirmed, 0 pending"; "Subscriptions" has one row with `sqs`, the queue\'s ARN and "Confirmed"',
    async () => {
      await open(page, TOPICS_PATH, LIST_H1);
      expect(await findTopicRow(page, `${p}-std`), 'the row on S1').not.toBeNull();
      await listScreen(page).link(`${p}-std`).click(ACTION);
      await expect(page).toHaveURL(addressOf(topicPath(standard)));
      await expect(heading(page, `${p}-std`)).toBeVisible();
      await expectValue(page, 'ARN', standard);
      await expectValue(page, 'Type', 'Standard');
      await expectValue(page, 'Display name', displayName);
      await expectValue(page, 'Subscriptions', '1 confirmed, 0 pending');
      expect(await valueOf(page.getByRole('main'), DEDUPLICATION), 'no deduplication line for a standard topic').toBeNull();
      const rows = await (async () => {
        await expect
          .poll(async () => (await rowsOf(topicScreen(page).table)).length, { message: 'one subscription row', timeout: 20_000 })
          .toBe(1);
        return rowsOf(topicScreen(page).table);
      })();
      expect([rows[0]?.Protocol, rows[0]?.Endpoint, rows[0]?.Status], 'the row').toEqual(['sqs', queue.arn, CONFIRMED]);
    },
  );

  await lines.line('S3 of the FIFO topic → "FIFO" and "Content-based deduplication" "On"', async () => {
    await openTopic(page, fifo);
    await expectValue(page, 'Type', 'FIFO');
    await expectValue(page, DEDUPLICATION, 'On');
  });

  await lines.line('S1, select the standard topic, "Copy ARN" → "ARN copied" and the clipboard holds the ARN', async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: stack.studio.origin });
    await open(page, TOPICS_PATH, LIST_H1);
    expect(await findTopicRow(page, `${p}-std`), 'the row on S1').not.toBeNull();
    // Something else on the clipboard first, so the check sees the copy and not what was there.
    await page.evaluate(() => navigator.clipboard.writeText('before'));
    const s = listScreen(page);
    await s.radio(`${p}-std`).click(ACTION);
    await s.copyArn.click(ACTION);
    await expect(s.main.getByText(ARN_COPIED, { exact: true }).first(), `"${ARN_COPIED}"`).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { message: "the clipboard's text" })
      .toBe(standard);
  });

  await lines.line(
    'Open S3 at the ARN of a topic the emulator does not hold → "Topic not found" with "View topics", which leads to S1',
    async () => {
      const missing = standard.replace(`${p}-std`, `${p}-never`);
      expect(await topicAttributesDirect(ctx, port, missing), 'the emulator holds no such topic').toBeNull();
      await open(page, topicPath(missing), `${p}-never`);
      const main = page.getByRole('main');
      await expect(main.getByText(TOPIC_NOT_FOUND, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('tab')).toHaveCount(0);
      await main.getByRole('link', { name: VIEW_TOPICS, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(TOPICS_PATH));
      await expect(listHeading(page), `S1's h1 "${LIST_H1}"`).toBeVisible();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sns-create-topic-reaches-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snscreate');
  new SnsSeeded(ctx, port, p);
  const shown = `Shown ${p}`;
  const arnOf = async (name: string) => (await topicArnsDirect(ctx, port)).find((arn) => arn.endsWith(`:${name}`));
  expect(await arnOf(`${p}-std`), 'no topic of the check yet').toBeUndefined();

  await lines.line(
    'S1, "Create topic", the name `<prefix>-std`, the display name "Shown <prefix>", "Create topic" → S3 of the topic with "Topic <prefix>-std is ready"; the emulator reports the topic with that display name and no `FifoTopic`',
    async () => {
      await open(page, TOPICS_PATH, LIST_H1);
      await listScreen(page).create.click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_TOPIC_PATH));
      const s = createTopicScreen(page);
      await s.name.fill(`${p}-std`, ACTION);
      await s.displayName.fill(shown, ACTION);
      await s.submit.click(ACTION);
      await expectFlash(page, 'success', topicReady(`${p}-std`));
      const arn = await arnOf(`${p}-std`);
      expect(arn, 'the emulator reports the topic').toBeDefined();
      await expect(page).toHaveURL(addressOf(topicPath(arn!)));
      await expect(heading(page, `${p}-std`)).toBeVisible();
      const attributes = await topicAttributesDirect(ctx, port, arn!);
      expect(attributes?.DisplayName, 'DisplayName, directly').toBe(shown);
      expect(attributes?.FifoTopic ?? 'false', 'FifoTopic, directly').not.toBe('true');
    },
  );

  await lines.line(
    '"FIFO", the name `<prefix>-f.fifo`, "Content-based deduplication" on → S3 shows "FIFO"; the emulator reports `FifoTopic` `true` and `ContentBasedDeduplication` `true`',
    async () => {
      await open(page, CREATE_TOPIC_PATH, CREATE_TOPIC);
      const s = createTopicScreen(page);
      await s.type('FIFO').click(ACTION);
      await s.name.fill(`${p}-f.fifo`, ACTION);
      await s.deduplication.check(ACTION);
      await s.submit.click(ACTION);
      await expect(heading(page, `${p}-f.fifo`)).toBeVisible({ timeout: 20_000 });
      await expectValue(page, 'Type', 'FIFO');
      const arn = await arnOf(`${p}-f.fifo`);
      expect(arn, 'the emulator reports the topic').toBeDefined();
      const attributes = await topicAttributesDirect(ctx, port, arn!);
      expect([attributes?.FifoTopic, attributes?.ContentBasedDeduplication], 'directly').toEqual(['true', 'true']);
    },
  );

  await lines.line(
    'The name `<prefix> with space` → "A name can hold letters, digits, hyphens and underscores only." at the field, no request to create left the page and the emulator holds no such topic',
    async () => {
      await open(page, CREATE_TOPIC_PATH, CREATE_TOPIC);
      const creates = countActions(page, 'CreateTopic');
      const s = createTopicScreen(page);
      await s.name.fill(`${p} with space`, ACTION);
      await s.submit.click(ACTION);
      await expect(s.main.getByText(NAME_CHARACTERS, { exact: true })).toBeVisible();
      await expect(page).toHaveURL(addressOf(CREATE_TOPIC_PATH));
      expect(creates.count(), 'requests to create').toBe(0);
      expect(await arnOf(`${p} with space`), 'no such topic, directly').toBeUndefined();
    },
  );

  await lines.line(
    '"FIFO" with the name `<prefix>-plain` → "A FIFO topic\'s name ends with .fifo."; no request left the page',
    async () => {
      await open(page, CREATE_TOPIC_PATH, CREATE_TOPIC);
      const creates = countActions(page, 'CreateTopic');
      const s = createTopicScreen(page);
      await s.type('FIFO').click(ACTION);
      await s.name.fill(`${p}-plain`, ACTION);
      await s.submit.click(ACTION);
      await expect(s.main.getByText(FIFO_NAME_ENDING, { exact: true })).toBeVisible();
      expect(creates.count(), 'requests to create').toBe(0);
      expect(await arnOf(`${p}-plain`), 'no such topic, directly').toBeUndefined();
    },
  );

  await lines.line(
    'The name `<prefix>-std` again with the display name "Other" → the form stays, with the emulator\'s `InvalidParameter` and its message that the topic already exists with different attributes; the emulator still reports the display name "Shown <prefix>"',
    async () => {
      const arn = await arnOf(`${p}-std`);
      expect(arn, 'the topic of the first line').toBeDefined();
      await open(page, CREATE_TOPIC_PATH, CREATE_TOPIC);
      const s = createTopicScreen(page);
      await s.name.fill(`${p}-std`, ACTION);
      await s.displayName.fill('Other', ACTION);
      await s.submit.click(ACTION);
      await expect(s.alert.filter({ hasText: 'InvalidParameter' }), 'the refusal in the form').toBeVisible({
        timeout: 15_000,
      });
      await expect(s.alert.filter({ hasText: 'Topic already exists with different attributes' })).toBeVisible();
      await expect(page).toHaveURL(addressOf(CREATE_TOPIC_PATH));
      await expect(s.name, 'the name as typed').toHaveValue(`${p}-std`);
      expect((await topicAttributesDirect(ctx, port, arn!))?.DisplayName, 'DisplayName, directly').toBe(shown);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sns-delete-a-subscription-and-a-topic', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snsdelete');
  const seeded = new SnsSeeded(ctx, port, p);
  const topic = await seeded.topic(`${p}-t`);
  const queue = await seeded.queueFor(`${p}-q`, topic);
  await seeded.subscribe(topic, 'sqs', queue.arn);
  const mail = `${p}@example.com`;
  await seeded.subscribe(topic, 'email', mail);
  const second = await seeded.topic(`${p}-second`);
  const third = await seeded.topic(`${p}-third`);
  const policyBefore = await queuePolicyDirect(ctx, port, queue.url);

  await lines.line(
    'S3, select the email row → "Delete" is unavailable; select the queue\'s row, "Delete", type `delete`, "Delete" → "Deleted the subscription of {queue}" and the row is gone',
    async () => {
      await openTopic(page, topic);
      const s = topicScreen(page);
      await expectSubscriptions(
        page,
        [
          ['sqs', queue.arn, CONFIRMED, 'Allowed'],
          ['email', mail, PENDING, '-'],
        ],
        'both subscriptions',
      );
      await s.radio('email', mail).click(ACTION);
      await expect(s.deleteSubscription, '"Delete" for a pending subscription').toBeDisabled();
      await s.radio('sqs', queue.arn).click(ACTION);
      await s.deleteSubscription.click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', deletedSubscription(queue.name));
      await expectSubscriptions(page, [['email', mail, PENDING, '-']], 'the queue\'s row is gone');
    },
  );

  await lines.line(
    'The emulator reports: the topic has no subscription to the queue, and the queue\'s policy is as it was',
    async () => {
      const left = await subscriptionsDirect(ctx, port, topic);
      expect(left.map((each) => each.endpoint), 'the endpoints subscribed, directly').not.toContain(queue.arn);
      expect(await queuePolicyDirect(ctx, port, queue.url), 'the queue\'s policy, directly').toEqual(policyBefore);
    },
  );

  await lines.line(
    '"Delete" in S3\'s header, type `delete`, "Delete" → S1 with "Deleted topic {name}", and no row of that name on any page; the emulator reports no such topic',
    async () => {
      await openTopic(page, topic);
      await topicScreen(page).deleteTopic.click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(TOPICS_PATH), { timeout: 20_000 });
      await expectFlash(page, 'success', deletedTopic(`${p}-t`));
      expect(await findTopicRow(page, `${p}-t`), 'a row of that name on any page').toBeNull();
      expect(await topicAttributesDirect(ctx, port, topic), 'the topic, directly').toBeNull();
    },
  );

  await lines.line(
    'S1, select the second topic, "Delete", "Cancel" → the emulator still holds it; "Delete" again, type `delete`, "Delete" → "Deleted topic {name}" and the emulator reports no such topic',
    async () => {
      await open(page, TOPICS_PATH, LIST_H1);
      expect(await findTopicRow(page, `${p}-second`), 'the second topic\'s row').not.toBeNull();
      const s = listScreen(page);
      await s.radio(`${p}-second`).click(ACTION);
      await s.del.click(ACTION);
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: CANCEL, exact: true }).click(ACTION);
      await expect(dialog).toBeHidden();
      expect(await topicAttributesDirect(ctx, port, second), 'the topic after "Cancel", directly').not.toBeNull();
      await s.del.click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', deletedTopic(`${p}-second`));
      expect(await topicAttributesDirect(ctx, port, second), 'the topic, directly').toBeNull();
    },
  );

  await lines.line(
    'S3 of a third topic (made directly) open, the topic deleted directly, "Refresh" → "Topic not found"',
    async () => {
      await openTopic(page, third);
      await seeded.deleteTopic(third);
      expect(await topicAttributesDirect(ctx, port, third), 'the topic, directly').toBeNull();
      await topicScreen(page).refresh.click(ACTION);
      await expect(page.getByRole('main').getByText(TOPIC_NOT_FOUND, { exact: true })).toBeVisible({ timeout: 15_000 });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sns-screens-follow-an-emulator-restart', async ({ ctx, page, context }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snsrestart');
  const seeded = new SnsSeeded(ctx, port, p);
  const topic = await seeded.topic(`${p}-kept`);
  const queue = await seeded.queue(`${p}-q`);
  await seeded.subscribe(topic, 'sqs', queue.arn);

  await open(page, TOPICS_PATH, LIST_H1);
  expect(await findTopicRow(page, `${p}-kept`), 'the topic on S1 before the restart').not.toBeNull();
  const second = await context.newPage();
  await openTopic(second, topic);
  await expectSubscriptions(second, [['sqs', queue.arn, CONFIRMED, 'No permission']], 'S3 before the restart');

  await lines.line(
    'S1 and, in a second page, S3 of the topic open; the emulator is restarted → once the emulator line reads "Connected" again, S1 shows "No topics" and S3 "Topic not found", neither with a row or a value of before',
    async () => {
      await emulator.stop();
      // A read while the emulator is stopped fails; each page reads again by itself once it is connected again.
      await page.bringToFront();
      await expectLine(page, notStartedOn(port));
      await listScreen(page).refresh.click(ACTION);
      await second.bringToFront();
      await topicScreen(second).refresh.click(ACTION);
      await expectLine(second, notStartedOn(port));
      await emulator.startAgain();
      await page.bringToFront();
      await expectLine(page, connectedAt(port), 60_000);
      const s = listScreen(page);
      await expect(s.table.getByText(NO_TOPICS, { exact: true }), `"${NO_TOPICS}"`).toBeVisible({ timeout: 60_000 });
      expect(await rowsOf(s.table), 'rows on S1').toEqual([]);
      await expect(s.main, 'the topic of before on S1').not.toContainText(topic);
      await second.bringToFront();
      const main = second.getByRole('main');
      await expect(main.getByText(TOPIC_NOT_FOUND, { exact: true }), `"${TOPIC_NOT_FOUND}" on S3`).toBeVisible({
        timeout: 60_000,
      });
      await expect(main, 'a value of before on S3').not.toContainText(queue.arn);
      await expect(second.getByRole('tab')).toHaveCount(0);
    },
  );

  lines.end();
});
