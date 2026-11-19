// SNS's subscriptions: subscribing a queue and a function on S4, what "Delivery" says of each subscription on S3 and
// "Allow delivery", in the built app in front of a real engine and emulator (test-criteria.md, issue 536: tasks 1, 2,
// 3 and 6).
//
// `studio.sns-subscribe-a-queue-and-a-published-message-arrives`, `studio.sns-delivery-says-what-the-policy-allows`,
// `studio.sns-subscribe-a-function-and-it-runs`.
//
// The emulator delivers a notification only where the policy of the subscribed queue or function lets the topic, and
// answers `Publish` with 200 either way; so each check reads the queue or the function's log directly. "The queue
// holds nothing" is read after the same publish has arrived in a second queue of the topic that lets it send, so the
// emulator has delivered that publish. Words, direct calls and readers: `services/sns/sns.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  addAttribute,
  ALLOWED,
  CANNOT_TELL,
  chooseFunction,
  chooseQueue,
  CONFIRMED,
  CREATE_SUBSCRIPTION,
  DENY_REASON,
  expectFlash,
  expectSubscriptions,
  FUNCTION_NOT_FOUND,
  functionPagePath,
  functionPolicyDirect,
  logged,
  logLinesDirect,
  mayNowReceive,
  messagesIn,
  namesTopic,
  NO_PERMISSION,
  NO_SUBSCRIPTIONS,
  notificationIn,
  openPublish,
  openSubscribe,
  openTopic,
  PENDING,
  POLICY_NOT_CHANGED,
  printerLine,
  PROTOCOL_LAMBDA,
  PROTOCOL_SQS,
  publishAndRead,
  publishMessage,
  publishScreen,
  PUBLISHED,
  QUEUE_NOT_FOUND,
  queuePagePath,
  queuePolicyDirect,
  SEE_SUBSCRIPTIONS,
  SnsSeeded,
  subscribed,
  subscribePath,
  subscribeScreen,
  subscriptionsDirect,
  TAB_PUBLISH,
  TAB_SUBSCRIPTIONS,
  topicPath,
  topicScreen,
  valueOf,
} from './services/sns/sns';

// ---------------------------------------------------------------------------------------------------------------

test('studio.sns-subscribe-a-queue-and-a-published-message-arrives', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snssubq');
  const seeded = new SnsSeeded(ctx, port, p);
  const topic = await seeded.topic(`${p}-t`);
  const queue = await seeded.queue(`${p}-q`);
  expect(await queuePolicyDirect(ctx, port, queue.url), 'the queue has no policy').toBeNull();
  const message = `hello ${p}`;
  const subject = `Subject ${p}`;
  let messageId = '';

  await lines.line(
    'S3 → "No subscriptions"; "Create subscription" → S4; "Amazon SQS" is chosen; type the queue\'s name in "Queue" and choose it; "Allow this topic to deliver to it" is checked; "Create subscription" → S3 with "Subscribed {queue} to {topic}."; the row shows `sqs`, the queue\'s ARN, "Confirmed" and "Allowed"',
    async () => {
      await openTopic(page, topic);
      const t = topicScreen(page);
      await expect(t.panel.getByText(NO_SUBSCRIPTIONS, { exact: true })).toBeVisible({ timeout: 15_000 });
      await t.createSubscription.click(ACTION);
      await expect(page).toHaveURL(addressOf(subscribePath(topic)));
      await expect(heading(page, CREATE_SUBSCRIPTION)).toBeVisible();
      const s = subscribeScreen(page);
      await expect(s.protocol(PROTOCOL_SQS), '"Amazon SQS" at start').toBeChecked();
      await chooseQueue(page, queue.name);
      await expect(s.allow, 'the checkbox at start').toBeChecked();
      await s.submit.click(ACTION);
      await expect(page).toHaveURL(addressOf(topicPath(topic)), { timeout: 30_000 });
      await expectFlash(page, 'success', subscribed(queue.name, `${p}-t`));
      await expectSubscriptions(page, [['sqs', queue.arn, CONFIRMED, ALLOWED]], 'the new row');
    },
  );

  await lines.line(
    'The emulator reports: the topic has one subscription of protocol `sqs` to the queue\'s ARN, and the queue\'s policy has a statement that names `sns.amazonaws.com`, `sqs:SendMessage` and the topic\'s ARN',
    async () => {
      const subscriptions = await subscriptionsDirect(ctx, port, topic);
      expect(
        subscriptions.map((each) => [each.protocol, each.endpoint]),
        'the subscriptions, directly',
      ).toEqual([['sqs', queue.arn]]);
      const policy = await queuePolicyDirect(ctx, port, queue.url);
      expect(
        (policy?.statements ?? []).filter((each) => namesTopic(each, 'sqs:SendMessage', topic)),
        'the statements that name the topic, directly',
      ).toHaveLength(1);
    },
  );

  await lines.line(
    '"Publish": the message `hello <prefix>`, the subject `Subject <prefix>`, the attributes `color` "String" `red` and `price` "Number" `12.5`, "Publish" → "Published" with a message ID',
    async () => {
      await openTopic(page, topic);
      await openPublish(page);
      const s = publishScreen(page);
      await s.message.fill(message, ACTION);
      await s.subject.fill(subject, ACTION);
      await addAttribute(page, 1, 'color', 'String', 'red');
      await addAttribute(page, 2, 'price', 'Number', '12.5');
      messageId = await publishAndRead(page);
      expect(messageId, 'the message ID shown').not.toBe('');
    },
  );

  await lines.line(
    'The queue holds one message whose body is a notification with that message ID, the subject, the message, and the two attributes with their types and values',
    async () => {
      const found = await notificationIn(ctx, port, queue.url, message);
      expect(found, 'the notification in the queue').not.toBeNull();
      const n = found!.notification;
      expect([n.MessageId, n.Subject, n.Message], 'its message ID, subject and message').toEqual([
        messageId,
        subject,
        message,
      ]);
      expect(n.MessageAttributes, 'its attributes').toEqual({
        color: { Type: 'String', Value: 'red' },
        price: { Type: 'Number', Value: '12.5' },
      });
      expect(await messagesIn(ctx, port, queue.url), 'the messages the queue holds').toEqual([message]);
    },
  );

  await lines.line(
    '"See this topic\'s subscriptions" → the "Subscriptions" tab; back on "Publish" the message, the subject, the attributes and the result are still there',
    async () => {
      const t = topicScreen(page);
      await t.panel.getByRole('link', { name: SEE_SUBSCRIPTIONS, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(topicPath(topic)));
      await expect(t.tab(TAB_SUBSCRIPTIONS)).toHaveAttribute('aria-selected', 'true');
      await expectSubscriptions(page, [['sqs', queue.arn, CONFIRMED, ALLOWED]], 'the "Subscriptions" tab');
      await t.tab(TAB_PUBLISH).click(ACTION);
      const s = publishScreen(page);
      await expect(s.message).toHaveValue(message);
      await expect(s.subject).toHaveValue(subject);
      await expect(s.attributeName(1)).toHaveValue('color');
      await expect(s.attributeValue(1)).toHaveValue('red');
      await expect(s.attributeName(2)).toHaveValue('price');
      await expect(s.attributeValue(2)).toHaveValue('12.5');
      await expect(s.panel.getByText(PUBLISHED, { exact: true })).toBeVisible();
      expect(await valueOf(s.panel, 'Message ID'), 'the result\'s message ID').toBe(messageId);
    },
  );

  await lines.line(
    'Choose the endpoint of the row → SQS\'s page of that queue opens (`/aws/sqs/queues/queue/{queue}`)',
    async () => {
      await openTopic(page, topic);
      await topicScreen(page).endpointLink(queue.arn).click(ACTION);
      await expect(page).toHaveURL(addressOf(queuePagePath(queue.name)));
      await expect(heading(page, queue.name)).toBeVisible({ timeout: 15_000 });
    },
  );

  const fifoQueue = await seeded.queue(`${p}-ff.fifo`, { FifoQueue: 'true' });

  await lines.line(
    'S4 of the topic, type the FIFO queue\'s name in "Queue" and choose it, the checkbox checked, "Create subscription" → the form stays on S4 with the emulator\'s `InvalidParameter` and its message that FIFO SQS queues can not be subscribed to standard SNS topics; the choice is still the FIFO queue',
    async () => {
      await openSubscribe(page, topic);
      const s = subscribeScreen(page);
      await chooseQueue(page, fifoQueue.name);
      await expect(s.allow).toBeChecked();
      await s.submit.click(ACTION);
      await expect(s.alert.filter({ hasText: 'InvalidParameter' }), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(
        s.alert.filter({ hasText: 'FIFO SQS Queues can not be subscribed to standard SNS topics' }),
        'the emulator\'s message',
      ).toBeVisible();
      await expect(page).toHaveURL(addressOf(subscribePath(topic)));
      await expect(s.endpoint, 'the choice').toContainText(fifoQueue.name);
    },
  );

  await lines.line(
    'The emulator reports: the topic has no subscription to the FIFO queue\'s ARN, and the FIFO queue has no policy',
    async () => {
      const endpoints = (await subscriptionsDirect(ctx, port, topic)).map((each) => each.endpoint);
      expect(endpoints, 'the endpoints subscribed, directly').not.toContain(fifoQueue.arn);
      expect(await queuePolicyDirect(ctx, port, fifoQueue.url), 'the FIFO queue\'s policy, directly').toBeNull();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sns-delivery-says-what-the-policy-allows', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snsdeliv');
  const seeded = new SnsSeeded(ctx, port, p);
  const topic = await seeded.topic(`${p}-t`);
  const account = topic.split(':')[4] ?? '';
  const own = (queueArn: string) => ({
    Sid: 'own',
    Effect: 'Allow',
    Principal: { AWS: `arn:aws:iam::${account}:root` },
    Action: 'sqs:ReceiveMessage',
    Resource: queueArn,
  });
  const a = await seeded.queue(`${p}-a`);
  await seeded.policy(a, [own(a.arn)]);
  const b = await seeded.queueFor(`${p}-b`, topic);
  const c = await seeded.queue(`${p}-c`);
  await seeded.policy(c, [
    { Sid: 'deny', Effect: 'Deny', Principal: '*', Action: 'sqs:DeleteQueue', Resource: c.arn },
  ]);
  const d = await seeded.queue(`${p}-d`);
  expect(await queuePolicyDirect(ctx, port, d.url), 'queue D has no policy').toBeNull();
  for (const queue of [a, b, c, d]) await seeded.subscribe(topic, 'sqs', queue.arn);
  const missingQueue = a.arn.replace(a.name, `${p}-never`);
  await seeded.subscribe(topic, 'sqs', missingQueue);
  const region = topic.split(':')[3] ?? '';
  const missingFunction = `arn:aws:lambda:${region}:${account}:function:${p}-never`;
  await seeded.subscribe(topic, 'lambda', missingFunction);
  const mail = `${p}@example.com`;
  await seeded.subscribe(topic, 'email', mail);
  const aPolicyBefore = await queuePolicyDirect(ctx, port, a.url);
  const cPolicyBefore = await queuePolicyDirect(ctx, port, c.url);

  const rows = (aDelivery: string) =>
    [
      ['sqs', a.arn, CONFIRMED, aDelivery],
      ['sqs', b.arn, CONFIRMED, ALLOWED],
      ['sqs', c.arn, CONFIRMED, CANNOT_TELL],
      ['sqs', d.arn, CONFIRMED, NO_PERMISSION],
      ['sqs', missingQueue, CONFIRMED, QUEUE_NOT_FOUND],
      ['lambda', missingFunction, CONFIRMED, FUNCTION_NOT_FOUND],
      ['email', mail, PENDING, '-'],
    ] as [string, string, string, string][];

  await lines.line(
    'S3 → the rows read: A "No permission", B "Allowed", C "Cannot tell", D "No permission", the missing queue "Queue not found", the missing function "Function not found", the email one "Pending confirmation" and "-"',
    async () => {
      await openTopic(page, topic);
      await expectSubscriptions(page, rows(NO_PERMISSION), 'the rows with their delivery');
    },
  );

  await lines.line(
    '"Publish" the message `first <prefix>` → "Published"; B holds the message, and D (no policy) and A hold nothing',
    async () => {
      await openTopic(page, topic);
      await openPublish(page);
      await publishMessage(page, `first ${p}`);
      expect(await notificationIn(ctx, port, b.url, `first ${p}`), 'the notification in B').not.toBeNull();
      expect(await messagesIn(ctx, port, d.url), 'what D holds').toEqual([]);
      expect(await messagesIn(ctx, port, a.url), 'what A holds').toEqual([]);
    },
  );

  await lines.line(
    'Select C → "Allow delivery" is unavailable; select A, "Allow delivery" → "{A} may now receive from {topic}." and the row reads "Allowed"',
    async () => {
      await openTopic(page, topic);
      await expectSubscriptions(page, rows(NO_PERMISSION), 'the rows before');
      const t = topicScreen(page);
      await t.radio('sqs', c.arn).click(ACTION);
      await expect(t.allow, '"Allow delivery" for C').toBeDisabled();
      await t.radio('sqs', a.arn).click(ACTION);
      await expect(t.allow, '"Allow delivery" for A').toBeEnabled();
      await t.allow.click(ACTION);
      await expectFlash(page, 'success', mayNowReceive(a.name, `${p}-t`));
      await expectSubscriptions(page, rows(ALLOWED), 'the rows after "Allow delivery"');
    },
  );

  await lines.line(
    'The emulator reports: A\'s policy holds its own statement as it was and one more that names the topic\'s ARN',
    async () => {
      const policy = await queuePolicyDirect(ctx, port, a.url);
      const statements = policy?.statements ?? [];
      expect(statements, 'two statements').toHaveLength(2);
      expect(statements[0], 'its own statement').toEqual(aPolicyBefore?.statements[0]);
      expect(namesTopic(statements[1] ?? {}, 'sqs:SendMessage', topic), 'the new statement names the topic').toBe(true);
    },
  );

  await lines.line('"Publish" the message `second <prefix>` → A holds it', async () => {
    await openTopic(page, topic);
    await openPublish(page);
    await publishMessage(page, `second ${p}`);
    expect(await notificationIn(ctx, port, a.url, `second ${p}`), 'the notification in A').not.toBeNull();
  });

  const other = await seeded.topic(`${p}-other`);

  await lines.line(
    'Subscribe C on S4 with "Allow this topic to deliver to it" checked (a second topic, made directly) → S3 of that topic with "Subscribed {C} to {topic}. Its policy was not changed:" and the reason; the emulator reports C\'s policy as it was',
    async () => {
      await openSubscribe(page, other);
      const s = subscribeScreen(page);
      await chooseQueue(page, c.name);
      await expect(s.allow).toBeChecked();
      await s.submit.click(ACTION);
      await expect(page).toHaveURL(addressOf(topicPath(other)), { timeout: 30_000 });
      await expectFlash(page, 'warning', subscribed(c.name, `${p}-other`), POLICY_NOT_CHANGED, DENY_REASON);
      expect(
        (await subscriptionsDirect(ctx, port, other)).map((each) => each.endpoint),
        'the subscription was made, directly',
      ).toEqual([c.arn]);
      expect(await queuePolicyDirect(ctx, port, c.url), 'C\'s policy, directly').toEqual(cPolicyBefore);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sns-subscribe-a-function-and-it-runs', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'snssubf');
  const seeded = new SnsSeeded(ctx, port, p);
  const topic = await seeded.topic(`${p}-t`);
  const printer = await seeded.printer(`${p}-printer`);
  expect(await functionPolicyDirect(ctx, port, printer.name), 'printer has no policy').toBeNull();

  await lines.line(
    'S4 of the topic, "AWS Lambda", choose printer in "Function", "Create subscription" → S3 with "Subscribed {function} to {topic}."; the row shows `lambda`, the function\'s ARN, "Confirmed" and "Allowed"',
    async () => {
      await openSubscribe(page, topic);
      const s = subscribeScreen(page);
      await s.protocol(PROTOCOL_LAMBDA).click(ACTION);
      await chooseFunction(page, printer.name);
      await expect(s.allow).toBeChecked();
      await s.submit.click(ACTION);
      await expect(page).toHaveURL(addressOf(topicPath(topic)), { timeout: 30_000 });
      await expectFlash(page, 'success', subscribed(printer.name, `${p}-t`));
      await expectSubscriptions(page, [['lambda', printer.arn, CONFIRMED, ALLOWED]], 'the new row');
    },
  );

  await lines.line(
    'The emulator reports: the function\'s policy has a statement that names `sns.amazonaws.com`, `lambda:InvokeFunction` and the topic\'s ARN',
    async () => {
      const policy = await functionPolicyDirect(ctx, port, printer.name);
      expect(
        (policy?.statements ?? []).filter((each) => namesTopic(each, 'lambda:InvokeFunction', topic)),
        'the statements that name the topic, directly',
      ).toHaveLength(1);
    },
  );

  await lines.line(
    '"Publish" the message `run <prefix>` → "Published"; the function\'s log group holds the line `sns-line run <prefix>` (read directly, waited for with a bound)',
    async () => {
      await openTopic(page, topic);
      await openPublish(page);
      await publishMessage(page, `run ${p}`);
      expect(await logged(ctx, port, printer.name, printerLine(`run ${p}`)), 'the line in the log group').toBe(true);
    },
  );

  await lines.line(
    'Choose the endpoint of the row → Lambda\'s page of that function opens (`/aws/lambda/functions/function/{function}`)',
    async () => {
      await openTopic(page, topic);
      await topicScreen(page).endpointLink(printer.arn).click(ACTION);
      await expect(page).toHaveURL(addressOf(functionPagePath(printer.name)));
      await expect(heading(page, printer.name)).toBeVisible({ timeout: 15_000 });
    },
  );

  const second = await seeded.topic(`${p}-second`);
  await seeded.subscribe(second, 'lambda', printer.arn);

  await lines.line(
    'S3 of that topic → the row reads "No permission"; "Publish" the message `before <prefix>` → "Published"',
    async () => {
      await openTopic(page, second);
      await expectSubscriptions(page, [['lambda', printer.arn, CONFIRMED, NO_PERMISSION]], 'the row before');
      await openPublish(page);
      await publishMessage(page, `before ${p}`);
    },
  );

  await lines.line(
    '"Allow delivery" → "{function} may now receive from {topic}." and the row reads "Allowed"; "Publish" the message `again <prefix>` → the log group holds `sns-line again <prefix>`, and then (read after that line is there) no line `sns-line before <prefix>`: without the permission the emulator delivered nothing',
    async () => {
      await openTopic(page, second);
      await expectSubscriptions(page, [['lambda', printer.arn, CONFIRMED, NO_PERMISSION]], 'the row before');
      const t = topicScreen(page);
      await t.radio('lambda', printer.arn).click(ACTION);
      await t.allow.click(ACTION);
      await expectFlash(page, 'success', mayNowReceive(printer.name, `${p}-second`));
      await expectSubscriptions(page, [['lambda', printer.arn, CONFIRMED, ALLOWED]], 'the row after');
      await openPublish(page);
      await publishMessage(page, `again ${p}`);
      expect(await logged(ctx, port, printer.name, printerLine(`again ${p}`)), 'the line of "again"').toBe(true);
      const after = await logLinesDirect(ctx, port, printer.name);
      expect(
        after.filter((line) => line.includes(printerLine(`before ${p}`))),
        'lines of "before", read after "again" was logged',
      ).toEqual([]);
    },
  );

  lines.end();
});
