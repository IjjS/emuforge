import type { Page } from '@playwright/test';
import { expect, test } from './support';
import { creationDateText, SEOUL } from './support/service-screens';
import { direct, fixture, localKey, rotationFunction, WEST } from './services/secretsmanager/fixture';
import { button, detail, modal, submit, success, textbox, ui } from './services/secretsmanager/screen';

test.use({ timezoneId: SEOUL.timeZone });

async function configure(page: Page, arn: string) {
  await button(page, 'Configure rotation').click();
  await textbox(modal(page), 'Rotation Lambda function ARN').fill(arn);
  await modal(page).getByRole('spinbutton').fill('30');
  await button(modal(page), 'Save schedule').click();
}

async function expectSchedule(page: Page, f: Awaited<ReturnType<typeof fixture>>, arn: string) {
  const d = await f.describe();
  expect(d).toMatchObject({
    RotationEnabled: true,
    RotationLambdaARN: arn,
    RotationRules: { AutomaticallyAfterDays: 30 },
  });
  const group = ui.findKeyValuePairs().findItems();
  // The rotation container has status/date in its first group and function/interval in the second.
  const container = page.locator(ui.findContainer().toSelector()).filter({ has: button(page, 'Configure rotation') });
  const pair = (g: number, n: number) =>
    container.locator(
      group
        .get(g)
        .findGroupPairs()
        .get(n)
        .findValue()
        .toSelector()
        .replace(/^body /, ''),
    );
  await expect(pair(1, 1)).toHaveText('Enabled');
  await expect(pair(1, 2)).toHaveText(creationDateText(d.NextRotationDate!.toISOString(), SEOUL));
  await expect(pair(2, 1)).toContainText(arn);
  await expect(pair(2, 2)).toHaveText('30 days');
}

test('studio.secretsmanager-rotation-schedule', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed();
  const arn = await rotationFunction(ctx, f.emulatorPort, true);
  await detail(page, f.name);
  await configure(page, arn);
  await expect(success(page)).toContainText('Rotation schedule saved.');
  await expectSchedule(page, f, arn);
});

test('studio.secretsmanager-rotation-refused', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed();
  const arn = await rotationFunction(ctx, f.emulatorPort, false);
  await detail(page, f.name);
  await configure(page, arn);
  await expect(modal(page)).toContainText(/cannot invoke the specified Lambda function/i);
  await expect(success(page)).toHaveCount(0);
  expect((await f.describe()).RotationEnabled).not.toBe(true);
});

for (const mode of ['rotate-now', 'rotation-cancel'] as const) {
  test('studio.secretsmanager-' + mode, async ({ ctx, page }) => {
    const f = await fixture(ctx, true);
    await f.seed();
    const arn = await rotationFunction(ctx, f.emulatorPort, true);
    await f.client.rotateSecret({
      SecretId: f.name,
      RotationLambdaARN: arn,
      RotationRules: { AutomaticallyAfterDays: 30 },
      RotateImmediately: false,
    });
    await detail(page, f.name);
    if (mode === 'rotate-now') {
      await button(page, 'Rotate now').click();
      await submit(page, 'Request rotation');
      await expect(success(page)).toContainText('Rotation request accepted.');
      await expectSchedule(page, f, arn);
    } else {
      await button(page, 'Cancel rotation').click();
      await submit(page, 'Cancel rotation');
      const state = await f.describe();
      expect(state.RotationEnabled).toBe(false);
      expect(state.NextRotationDate).toBeUndefined();
      await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
      await expect(page.getByText('No next rotation date', { exact: true })).toBeVisible();
    }
  });
}

test('studio.secretsmanager-replica-add', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed();
  const key = await localKey(ctx, f.emulatorPort, WEST);
  await detail(page, f.name);
  await expect(page.getByText('This secret has no replicas.')).toBeVisible();
  await button(page, 'Add').click();
  await textbox(modal(page), 'Target Region').fill(WEST);
  await textbox(modal(page), 'KMS key ARN (optional)').fill(key);
  await submit(page, 'Add replica');
  const replica = (await f.describe()).ReplicationStatus?.find((r) => r.Region === WEST);
  expect(replica?.KmsKeyId).toBe(key);
  const row = page
    .locator(ui.findTable().findRows().toSelector())
    .filter({ has: button(page, 'Remove replica in ' + WEST) });
  await expect(row).toContainText(WEST);
  await expect(row).toContainText(replica!.KmsKeyId!);
  await expect(row).toContainText('Promotion requires a connection to the replica Region.');
});

test('studio.secretsmanager-replica-remove', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed();
  const west = direct(ctx, f.emulatorPort, WEST);
  await f.client.replicateSecretToRegions({ SecretId: f.name, AddReplicaRegions: [{ Region: WEST }] });
  expect((await west.describeSecret({ SecretId: f.name })).PrimaryRegion).toBe('us-east-1');
  await detail(page, f.name);
  await button(page, 'Remove replica in ' + WEST).click();
  await expect(modal(page)).toContainText('Remove the replica of ' + f.name + ' from ' + WEST);
  await textbox(modal(page), 'Type ' + f.name + ' to confirm.').fill(f.name);
  await submit(page, 'Remove replica');
  await expect(page.getByText('This secret has no replicas.')).toBeVisible();
  expect((await f.describe()).ReplicationStatus?.some((r) => r.Region === WEST) ?? false).toBe(false);
  await expect(west.describeSecret({ SecretId: f.name })).rejects.toMatchObject({ name: 'ResourceNotFoundException' });
});
