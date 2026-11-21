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
  await page.getByRole('button', { name: 'Read messages' }).click();
  const row = page.locator(wrappers.findTable().findRows().toSelector()).filter({ hasText: key });
  await row.getByRole('link').click();
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
  await expect(page.getByRole('link', { name: 'Edit function-uploads' })).toBeVisible();
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
  const log = page.locator(wrappers.findTable().findRows().toSelector()).filter({ hasText: key });
  await expect(log).toContainText(f.bucket);
  await expect(log).toContainText('ObjectCreated:Put');
  await expect(log).toContainText('function-uploads');
});
