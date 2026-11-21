// These flows cross from S3 into the destination service in the same Studio.
import type { Page } from '@playwright/test';
import { expect, startStack, test } from './support';
import { LocalNotifications, topicSettings } from './support/bucket-notifications';
import { fillRule, openCreate, properties, submitCreate, success, wrappers } from './support/bucket-notification-form';

const payload = 'local notification delivery';

async function upload(page: Page, fixtures: LocalNotifications, key: string) {
  fixtures.trackObject(key);
  await page.goto('/aws/s3/buckets/' + fixtures.bucket);
  await page.getByRole('link', { name: 'Upload', exact: true }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: key, mimeType: 'text/plain', buffer: Buffer.from(payload) });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(success(page)).toContainText('Uploaded 1 of 1 files.');
  expect(await fixtures.body(key)).toBe(payload);
}

test('studio.s3-notification-queue-receives-upload', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const f = new LocalNotifications(ctx, stack.emulatorPort, 'nq');
  await f.createBucket();
  const QueueArn = await f.queue(true);
  const initial = topicSettings(await f.topic());
  await f.seed(initial);
  await openCreate(page, f.bucket);
  await fillRule(page, 'queue-puts', QueueArn, 'SQS queue', 's3:ObjectCreated:Put');
  await page.getByRole('textbox', { name: 'Prefix (optional)' }).fill('match-');
  await page.getByRole('textbox', { name: 'Suffix (optional)' }).fill('.txt');
  await submitCreate(page).click();
  await expect(success(page)).toContainText('Event notification saved');
  await expect(page.getByRole('link', { name: 'Edit queue-puts' })).toBeVisible();
  expect(await f.read()).toEqual({
    ...initial,
    QueueConfigurations: [
      {
        Id: 'queue-puts',
        QueueArn,
        Events: ['s3:ObjectCreated:Put'],
        Filter: {
          Key: {
            FilterRules: [
              { Name: 'Prefix', Value: 'match-' },
              { Name: 'Suffix', Value: '.txt' },
            ],
          },
        },
      },
    ],
  });
  const key = 'match-order.txt';
  await upload(page, f, key);
  await page.goto(properties(f.bucket));
  await page.getByRole('link', { name: 'Open queue' }).click();
  await page.getByRole('tab', { name: 'Messages', exact: true }).click();
  const read = page.getByRole('button', { name: 'Read messages' });
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const [response] = await Promise.all([
          page.waitForResponse((r) => r.request().headers()['x-amz-target']?.endsWith('.ReceiveMessage') === true, {
            timeout: 10000,
          }),
          read.click({ timeout: 10000 }),
        ]);
        expect(response.ok()).toBe(true);
        const result = (await response.json()) as { Messages?: { MessageId: string; Body: string }[] };
        messageId = result.Messages?.find((message) => {
          const body = JSON.parse(message.Body) as {
            Records?: {
              eventName: string;
              s3: { configurationId: string; bucket: { name: string }; object: { key: string } };
            }[];
          };
          return body.Records?.some(
            (r) =>
              r.eventName === 'ObjectCreated:Put' &&
              r.s3.configurationId === 'queue-puts' &&
              r.s3.bucket.name === f.bucket &&
              r.s3.object.key === key,
          );
        })?.MessageId;
        return messageId;
      },
      { timeout: 30000 },
    )
    .toBeTruthy();
  await page
    .getByRole('table', { name: 'Messages read' })
    .getByRole('button', { name: messageId!, exact: true })
    .click({ timeout: 10000 });
  const body = JSON.parse(await page.locator('.aws-sqs-message-body').innerText());
  expect(body.Records).toContainEqual(
    expect.objectContaining({
      eventName: 'ObjectCreated:Put',
      s3: expect.objectContaining({
        configurationId: 'queue-puts',
        bucket: expect.objectContaining({ name: f.bucket }),
        object: expect.objectContaining({ key }),
      }),
    }),
  );
});

test('studio.s3-notification-function-receives-upload', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const f = new LocalNotifications(ctx, stack.emulatorPort, 'nf');
  await f.createBucket();
  const fn = await f.functionDestination();
  await openCreate(page, f.bucket);
  await fillRule(page, 'function-uploads', fn.arn, 'Lambda function', 's3:ObjectCreated:*');
  await submitCreate(page).click();
  await expect(success(page)).toContainText('Event notification saved');
  const rule = page
    .locator(wrappers.findTable().findRows().toSelector())
    .filter({ has: page.getByRole('link', { name: 'Edit function-uploads' }) });
  await expect(rule).toContainText(fn.arn);
  await expect(rule).toContainText('s3:ObjectCreated:*');
  expect(await f.read()).toEqual({
    LambdaFunctionConfigurations: [
      { Id: 'function-uploads', LambdaFunctionArn: fn.arn, Events: ['s3:ObjectCreated:*'] },
    ],
  });
  const key = 'function-input.txt';
  await upload(page, f, key);
  await expect.poll(() => f.logged(fn.name, key), { timeout: 30000 }).toBeTruthy();
  await page.goto(properties(f.bucket));
  await page.getByRole('link', { name: 'Open function monitor' }).click();
  const table = page.getByRole('table', { name: 'Log events' });
  await expect(table).toBeVisible();
  await expect
    .poll(async () => {
      const rows = table.getByRole('row').and(page.locator(wrappers.findTable().findRows().toSelector()));
      const messages = await Promise.all(
        Array.from({ length: await rows.count() }, (_, index) =>
          table
            .getByRole('cell')
            .and(
              page.locator(
                wrappers
                  .findTable()
                  .findBodyCell(index + 1, 2)
                  .toSelector(),
              ),
            )
            .allTextContents(),
        ),
      );
      return messages
        .flat()
        .some((text) =>
          [f.bucket, key, 'ObjectCreated:Put', 'function-uploads'].every((value) => text.includes(value)),
        );
    })
    .toBe(true);
});
