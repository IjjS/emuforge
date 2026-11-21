import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { NotificationConfiguration } from '@aws-sdk/client-s3';
import { expect, startStack, test } from './support';
import { LocalNotifications, topicSettings } from './support/bucket-notifications';
import {
  createLink,
  fillRule,
  nameField,
  openCreate,
  properties,
  submitCreate,
  success,
  wrappers,
} from './support/bucket-notification-form';
import { markPage, stillSamePage } from './support/home';
import { connectedAt, expectLine, notStartedOn, LINE_CHANGE_BOUND_MS } from './support/aws-area';

test('studio.s3-notification-edit-delete-preserve-settings', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const f = new LocalNotifications(ctx, stack.emulatorPort, 'ne');
  await f.createBucket();
  const QueueArn = await f.queue(true);
  const fn = await f.functionDestination();
  const topicArn = await f.topic();
  const peers: NotificationConfiguration = {
    ...topicSettings(topicArn),
    LambdaFunctionConfigurations: [
      {
        Id: 'function-peer',
        LambdaFunctionArn: fn.arn,
        Events: ['s3:ObjectCreated:Put'],
      },
    ],
  };
  const queue = { Id: 'multi', QueueArn, Events: ['s3:ObjectCreated:Copy', 's3:ObjectRemoved:Delete'] as const };
  const withPrefix = (prefix: string): NotificationConfiguration => ({
    ...peers,
    QueueConfigurations: [
      {
        ...queue,
        Events: [...queue.Events],
        Filter: {
          Key: {
            FilterRules: [
              { Name: 'Suffix', Value: '.csv' },
              { Name: 'Prefix', Value: prefix },
            ],
          },
        },
      },
    ],
  });
  await f.seed(withPrefix('old/'));
  await page.goto(properties(f.bucket));
  const edit = page.getByRole('link', { name: 'Edit multi', exact: true });
  await expect(edit).toBeVisible();
  await page.reload();
  await edit.click();
  await expect(nameField(page)).toHaveValue('multi');
  await page.getByRole('textbox', { name: 'Prefix (optional)' }).fill('edited/');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(success(page)).toContainText('Event notification saved');
  const row = page.locator(wrappers.findTable().findRows().toSelector()).filter({ has: edit });
  const expectEditedRow = async () => {
    for (const value of [...queue.Events, 'edited/', '.csv']) await expect(row).toContainText(value);
  };
  await expectEditedRow();
  await page.reload();
  await expectEditedRow();
  expect(await f.read()).toEqual(withPrefix('edited/'));
  const remove = page.getByRole('button', { name: 'Delete multi', exact: true });
  const dialog = page.locator(wrappers.findModal().toSelector());
  await remove.click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await f.read()).toEqual(withPrefix('edited/'));
  await remove.click();
  await expect(dialog).toContainText('multi');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(success(page)).toContainText('Event notification deleted');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Edit function-peer' })).toBeVisible();
  await expect(page.locator(wrappers.findTable().findRows().toSelector()).allTextContents()).resolves.toEqual(
    expect.arrayContaining([expect.stringContaining(topicArn)]),
  );
  await expect(edit).toHaveCount(0);
  expect(await f.read()).toEqual(peers);
});

test('studio.s3-notification-refused-destination-keeps-draft', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const f = new LocalNotifications(ctx, stack.emulatorPort, 'nr');
  await f.createBucket();
  const arn = await f.queue(false);
  const initial = topicSettings(await f.topic());
  await f.seed(initial);
  await openCreate(page, f.bucket);
  await fillRule(page, 'denied', arn, 'SQS queue', 's3:ObjectCreated:Put');
  await submitCreate(page).click();
  const alert = page.locator(
    createWrapper('main').findAlert(':has([class*="awsui_type-error"])').findContent().toSelector(),
  );
  await expect(alert).toContainText('InvalidArgument');
  await expect(alert).toContainText('Unable to validate the following destination configurations');
  await expect(alert).toContainText('Check that the queue policy allows S3 to send messages from this bucket');
  await expect(nameField(page)).toHaveValue('denied');
  await expect(page.getByRole('textbox', { name: 'Destination ARN' })).toHaveValue(arn);
  await expect(nameField(page)).toBeEditable();
  await expect(page.getByRole('textbox', { name: 'Destination ARN' })).toBeEditable();
  for (const value of ['SQS queue', 's3:ObjectCreated:Put']) {
    const selected = page.locator(wrappers.findRadioGroup().findInputByValue(value).toSelector());
    await expect(selected).toBeChecked();
    await expect(selected).toBeEnabled();
  }
  await expect(submitCreate(page)).toBeEnabled();
  expect(await f.read()).toEqual(initial);
});

test('studio.s3-notification-cancel-preserves-configuration', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const f = new LocalNotifications(ctx, stack.emulatorPort, 'nc');
  await f.createBucket();
  await f.seed(topicSettings(await f.topic()));
  const initial = await f.read();
  const writes: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (
      url.origin === stack.engine.url &&
      !url.pathname.startsWith('/__emuforge/') &&
      ['POST', 'PUT', 'DELETE', 'PATCH'].includes(r.method())
    )
      writes.push(r.method() + ' ' + url.pathname);
  });
  await page.goto(properties(f.bucket));
  await markPage(page);
  await createLink(page).click();
  await expect(nameField(page)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/aws/s3/bucket/' + f.bucket + '/property/event-notification/create');
  expect(await stillSamePage(page)).toBe(true);
  expect(await f.read()).toEqual(initial);
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.click();
  await expect(createLink(page)).toBeVisible();
  expect(await f.read()).toEqual(initial);
  await createLink(page).click();
  await nameField(page).fill('draft-only');
  await cancel.click();
  const dialog = page.locator(wrappers.findModal().toSelector());
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(nameField(page)).toHaveValue('draft-only');
  await cancel.click();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(createLink(page)).toBeVisible();
  expect(await f.read()).toEqual(initial);
  expect(writes).toEqual([]);
});

test('studio.s3-notification-editor-follows-emulator-restart', async ({ ctx, page }) => {
  test.setTimeout(300000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const f = new LocalNotifications(ctx, emulator.port, 'nx', true);
  await f.createBucket();
  const QueueArn = await f.queue(true);
  await f.seed({ QueueConfigurations: [{ Id: 'before-restart', QueueArn, Events: ['s3:ObjectCreated:Put'] }] });
  await page.goto(properties(f.bucket));
  await page.getByRole('link', { name: 'Edit before-restart' }).click();
  await expect(nameField(page)).toHaveValue('before-restart');
  const prefix = page.getByRole('textbox', { name: 'Prefix (optional)' });
  await prefix.fill('unsaved/');
  await expect(prefix).toHaveValue('unsaved/');
  await emulator.stop();
  await expectLine(page, notStartedOn(emulator.port));
  await emulator.startAgain();
  await expectLine(page, connectedAt(emulator.port), LINE_CHANGE_BOUND_MS * 2);
  await expect(page.getByRole('link', { name: 'Return to Properties' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText(f.bucket);
  await expect(page.getByRole('main')).toContainText('Bucket not found');
  await expect(nameField(page)).toHaveCount(0);
  await expect(prefix).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  const fresh = new LocalNotifications(ctx, emulator.port, 'nx', true);
  expect(await fresh.exists()).toBe(false);
});
