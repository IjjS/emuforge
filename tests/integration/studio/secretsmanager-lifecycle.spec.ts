import { test, expect } from './support';
import { creationDateText, SEOUL } from './support/service-screens';
import { fixture, localKey } from './services/secretsmanager/fixture';
import {
  button,
  detail,
  listPath,
  modal,
  secretLink,
  secretValue,
  submit,
  success,
  textbox,
  ui,
} from './services/secretsmanager/screen';

test.use({ timezoneId: SEOUL.timeZone });

test('studio.secretsmanager-store-generated', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  const key = await localKey(ctx, f.emulatorPort);
  await page.goto(listPath + '/create');
  await textbox(page, 'Secret name').fill(f.name);
  await button(page, 'Generate password').click();
  const input = textbox(page, 'Secret value');
  await expect(input).not.toHaveValue('');
  const generated = await input.inputValue();
  await textbox(page, 'Description').fill('Generated fixture');
  await textbox(page, 'KMS key ARN').fill(key);
  const tags = ui.findAttributeEditor();
  await page.locator(tags.findAddButton().toSelector()).click();
  for (const [i, value] of ['purpose', 'test'].entries()) {
    await page
      .locator(
        tags
          .findRow(1)
          .findField(i + 1)
          .findInput()
          .findNativeInput()
          .toSelector(),
      )
      .fill(value);
  }
  await button(page, 'Store a secret').click();
  await expect(page).toHaveURL(
    (url) => url.pathname === listPath + '/detail' && url.searchParams.get('name') === f.name,
  );
  await expect(page.getByText('Generated fixture', { exact: true })).toBeVisible();
  await expect(button(page, 'Retrieve secret value')).toBeEnabled();
  expect((await f.value()).SecretString === generated).toBe(true);
  expect(await f.describe()).toMatchObject({
    Name: f.name,
    Description: 'Generated fixture',
    KmsKeyId: key,
    Tags: [{ Key: 'purpose', Value: 'test' }],
  });
});

test('studio.secretsmanager-duplicate-name', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const before = await f.seed();
  await page.goto(listPath + '/create');
  await textbox(page, 'Secret name').fill(f.name);
  await textbox(page, 'Secret value').fill('Another value');
  await button(page, 'Store a secret').click();
  await expect(
    page.locator(ui.findAlert().toSelector()).filter({ hasText: /already exists|ResourceExistsException/i }),
  ).toBeVisible();
  await expect(textbox(page, 'Secret value')).toHaveValue('Another value');
  expect(await f.value()).toMatchObject({ VersionId: before.VersionId, SecretString: 'fixture text' });
});

test('studio.secretsmanager-binary-create', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const bytes = Buffer.from([0, 128, 255, 0, 1]);
  await page.goto(listPath + '/create');
  await textbox(page, 'Secret name').fill(f.name);
  await page.locator(ui.findRadioGroup().findInputByValue('binary').toSelector()).check();
  await page.locator(ui.findFileUpload().findNativeInput().toSelector()).setInputFiles({
    name: 'local.bin',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  await button(page, 'Store a secret').click();
  await expect(page).toHaveURL(
    (url) => url.pathname === listPath + '/detail' && url.searchParams.get('name') === f.name,
  );
  await expect(button(page, 'Retrieve secret value')).toBeEnabled();
  expect(Buffer.from((await f.value()).SecretBinary!)).toEqual(bytes);
});

test('studio.secretsmanager-binary-retrieve', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed({ SecretString: undefined, SecretBinary: Buffer.from([255, 11, 0, 192]) });
  const bytes = Buffer.from((await f.value()).SecretBinary!);
  await detail(page, f.name);
  await button(page, 'Retrieve secret value').click();
  await expect(secretValue(page)).toContainText('Base64');
  await expect(secretValue(page).getByText(bytes.toString('base64'), { exact: true })).toBeVisible();
});

test('studio.secretsmanager-description', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed({ Description: 'Old description' });
  await detail(page, f.name);
  await button(page, 'Edit description').click();
  await textbox(modal(page), 'Description').fill('Revised description');
  await submit(page, 'Save changes');
  const actual = (await f.describe()).Description;
  expect(actual).toBe('Revised description');
  await expect(page.getByText(actual!, { exact: true })).toBeVisible();
});

test('studio.secretsmanager-change-key', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  const first = await localKey(ctx, f.emulatorPort);
  const second = await localKey(ctx, f.emulatorPort);
  await f.seed({ KmsKeyId: first });
  await detail(page, f.name);
  await button(page, 'Change encryption key').click();
  await textbox(modal(page), 'KMS key ARN').fill(second);
  await submit(page, 'Save changes');
  expect((await f.describe()).KmsKeyId).toBe(second);
  await expect(page.getByText(second, { exact: true })).toBeVisible();
});

for (const mode of ['add', 'edit', 'remove'] as const) {
  test('studio.secretsmanager-tag-' + mode, async ({ ctx, page }) => {
    const f = await fixture(ctx);
    await f.seed({ Tags: mode === 'add' ? [] : [{ Key: 'purpose', Value: 'original' }] });
    await detail(page, f.name);
    const open = { add: 'Add tag', edit: 'Edit tag purpose', remove: 'Remove tag purpose' }[mode];
    await button(page, open).click();
    if (mode === 'add') await textbox(modal(page), 'Tag key').fill('purpose');
    if (mode !== 'remove') await textbox(modal(page), 'Tag value').fill('revised');
    await submit(page, { add: 'Add tag', edit: 'Save tag', remove: 'Remove tag' }[mode]);
    const tags = (await f.describe()).Tags ?? [];
    const tag = tags.find((item) => item.Key === 'purpose');
    if (mode === 'remove') {
      expect(tag).toBeUndefined();
      await expect(button(page, 'Edit tag purpose')).toHaveCount(0);
    } else {
      expect(tag?.Value).toBe('revised');
      const rows = page.locator(ui.findTable().findRows().toSelector());
      await expect(rows.filter({ has: button(page, 'Edit tag purpose') })).toContainText(tag!.Value!);
    }
  });
}

test('studio.secretsmanager-put-value', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const first = await f.seed();
  await detail(page, f.name);
  await button(page, 'Store new version').click();
  await textbox(modal(page), 'Secret value').fill('New fixture value');
  await submit(page, 'Store new version');
  const updated = await f.value();
  expect(updated.VersionId).not.toBe(first.VersionId);
  expect(updated.SecretString).toBe('New fixture value');
  await expect(page.getByText(updated.VersionId!, { exact: true })).toBeVisible();
  await button(page, 'Retrieve secret value').click();
  await expect(secretValue(page)).toContainText(updated.SecretString!);
});

test('studio.secretsmanager-schedule-delete', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await detail(page, f.name);
  await button(page, 'Schedule deletion').click();
  await modal(page).getByRole('spinbutton').fill('7');
  const before = Date.now();
  await submit(page, 'Schedule deletion');
  const deleted = (await f.describe()).DeletedDate!;
  expect(Math.abs(deleted.getTime() - before - 7 * 86400000)).toBeLessThan(60000);
  await expect(page).toHaveURL((url) => url.pathname === listPath);
  await expect(secretLink(page, f.name)).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Include secrets scheduled for deletion' }).check();
  const row = page
    .locator(ui.findTable().findRows().toSelector())
    .filter({ has: page.getByRole('link', { name: f.name }) });
  await expect(row).toContainText(creationDateText(deleted.toISOString(), SEOUL));
});

test('studio.secretsmanager-restore', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await f.client.deleteSecret({ SecretId: f.name, RecoveryWindowInDays: 7 });
  await page.goto(listPath);
  await page.getByRole('checkbox', { name: 'Include secrets scheduled for deletion' }).check();
  await secretLink(page, f.name).click();
  await button(page, 'Restore secret').click();
  await submit(page, 'Restore secret');
  expect((await f.describe()).DeletedDate).toBeUndefined();
  await expect(button(page, 'Schedule deletion')).toBeEnabled();
  await page.goto(listPath);
  await expect(secretLink(page, f.name)).toBeVisible();
});

test('studio.secretsmanager-permanent-delete', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await detail(page, f.name);
  await button(page, 'Permanently delete').click();
  await textbox(modal(page), 'Type ' + f.name + ' to confirm.').fill(f.name);
  await submit(page, 'Permanently delete');
  await expect(page).toHaveURL((url) => url.pathname === listPath);
  await expect(success(page)).toContainText(f.name);
  await expect(f.describe()).rejects.toMatchObject({ name: 'ResourceNotFoundException' });
});
