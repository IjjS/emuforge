import { randomUUID } from 'node:crypto';
import type { KeyMetadata } from '@aws-sdk/client-kms';
import type { Page } from '@playwright/test';
import { expect, test } from './support';
import { ABOUT_CONTROL, connectedAt, crumbLink, crumbs, expectLine, notStartedOn } from './support/aws-area';
import { SEOUL } from './support/service-screens';
import { direct, fixture } from './services/kms/fixture';
import { button, content, dateText, detail, empty, field, flash, keyLink, list, openModal, rowWith, submit, ui } from './services/kms/screen';

test.use({ timezoneId: SEOUL.timeZone });

async function metadata(page: Page, key: KeyMetadata) {
  const box = page.locator(ui.findContainer().toSelector()).filter({ has: button(page, 'Edit description') });
  const pairs = ui.findKeyValuePairs().findItems();
  const items = box.locator(pairs.toSelector().replace(/^body /, ''));
  const valueSlot = pairs.get(1).findValue().toSelector().slice(pairs.get(1).toSelector().length).trim();
  const expected = [key.KeyId!, key.Arn!, key.KeyState!, key.KeySpec!, key.KeyUsage!, key.Origin!, dateText(key.CreationDate!)];
  if (key.DeletionDate) expected.push(dateText(key.DeletionDate));
  expected.push(key.Description!);
  await expect(items.locator(valueSlot)).toHaveText(expected);
}

test('studio.kms-find-external-keys', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await page.goto(list);
  await expect(empty(page)).toHaveText('No customer managed keys');
  expect(await crumbs(page)).toEqual(['EmuForge', 'AWS', 'KMS', 'Customer managed keys']);
  const notice = page.getByRole('region', { name: 'Local emulator notice' });
  await expect(notice).toContainText('These keys are in your local emulator');
  await button(notice, 'Close the local emulator notice').click();
  await expect(notice).toBeHidden();
  await button(page, ABOUT_CONTROL).click();
  await expect(notice).toContainText('These keys are in your local emulator');
  async function external(label: string) {
    const id = await f.seed(label);
    const name = 'alias/' + f.prefix + '-' + label;
    await f.kms.createAlias({ AliasName: name, TargetKeyId: id });
    return (await f.kms.listAliases({ KeyId: id })).Aliases!.find(alias => alias.AliasName === name)!;
  }
  const first = await external('first');
  await button(page, 'Refresh').click();
  await expect(rowWith(page, first.AliasName!)).toContainText(first.TargetKeyId!);
  await keyLink(page, first.TargetKeyId!).click();
  await metadata(page, (await f.kms.describeKey({ KeyId: first.TargetKeyId })).KeyMetadata!);
  const second = await external('second');
  await crumbLink(page, 'Customer managed keys').click();
  for (const alias of [first, second]) await expect(rowWith(page, alias.AliasName!)).toContainText(alias.TargetKeyId!);
});

test('studio.kms-page-through-keys', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  for (let index = 0; index < 21; index++) {
    const id = await f.seed(String(index));
    await f.kms.createAlias({ AliasName: 'alias/' + f.prefix + '-' + index, TargetKeyId: id });
  }
  const first = await f.kms.listKeys({ Limit: 20 });
  expect(first.NextMarker).toBeTruthy();
  const next = await f.kms.listKeys({ Limit: 20, Marker: first.NextMarker });
  const id = next.Keys![0]!.KeyId!;
  const alias = (await f.kms.listAliases({ KeyId: id })).Aliases!.find(entry => entry.TargetKeyId === id)!;
  await page.goto(list);
  await expect(keyLink(page, first.Keys![0]!.KeyId!)).toBeVisible();
  await page.locator(ui.findPagination().findNextPageButton().toSelector()).click();
  await expect(keyLink(page, id)).toBeVisible();
  await expect(rowWith(page, alias.AliasName!)).toContainText(alias.TargetKeyId!);
});

test('studio.kms-missing-key', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const id = randomUUID();
  await expect(f.kms.describeKey({ KeyId: id })).rejects.toMatchObject({ name: 'NotFoundException' });
  await page.goto(detail(id));
  await expect(page.getByText('Key not found', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View customer managed keys' }).click();
  await expect(page).toHaveURL(/\/aws\/kms$/);
  await expect(empty(page)).toHaveText('No customer managed keys');
});

test('studio.kms-key-lifecycle', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await page.goto(list);
  await page.getByRole('link', { name: 'Create key', exact: true }).click();
  await page.getByRole('textbox', { name: 'Description' }).fill(f.prefix);
  await button(page, 'Create key').click();
  await flash(page, 'Key created.');
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const read = async () => (await f.kms.describeKey({ KeyId: id })).KeyMetadata!;
  const created = await read();
  expect(created).toMatchObject({ Description: f.prefix, KeySpec: 'SYMMETRIC_DEFAULT', KeyUsage: 'ENCRYPT_DECRYPT', Origin: 'AWS_KMS', MultiRegion: false, KeyState: 'Enabled' });
  await metadata(page, created);
  await openModal(page, 'Edit description');
  await field(page, 'Description').fill(f.prefix + '-updated');
  await submit(page, 'Save', 'Key description updated.');
  const edited = await read();
  expect(edited.Description).toBe(f.prefix + '-updated');
  await metadata(page, edited);
  await openModal(page, 'Disable key');
  await submit(page, 'Disable key', 'Key disabled.');
  const disabled = await read();
  expect(disabled.KeyState).toBe('Disabled');
  await metadata(page, disabled);
  await button(page, 'Enable key').click();
  await flash(page, 'Key enabled.');
  const enabled = await read();
  expect(enabled.KeyState).toBe('Enabled');
  await metadata(page, enabled);
  await openModal(page, 'Schedule key deletion');
  await content(page).getByRole('spinbutton').fill('7');
  const before = Date.now();
  await submit(page, 'Schedule deletion', 'Key deletion scheduled.');
  const scheduled = await read();
  expect(scheduled.KeyState).toBe('PendingDeletion');
  const deletion = scheduled.DeletionDate!.getTime();
  expect(deletion).toBeGreaterThanOrEqual(before + 7 * 86400000 - 1000);
  expect(deletion).toBeLessThanOrEqual(Date.now() + 7 * 86400000 + 1000);
  await metadata(page, scheduled);
  await openModal(page, 'Cancel key deletion');
  await submit(page, 'Cancel deletion', 'Key deletion canceled.');
  const canceled = await read();
  expect(canceled.KeyState).not.toBe('PendingDeletion');
  expect(canceled.DeletionDate).toBeUndefined();
  await metadata(page, canceled);
  await expect(page.getByText('Deletion date', { exact: true })).toBeHidden();
});

test('studio.kms-reconnect-after-restart', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const id = await f.seed('before');
  await page.goto(list);
  await expect(keyLink(page, id)).toBeVisible();
  await f.emulator!.stop();
  await expectLine(page, notStartedOn(f.emulatorPort));
  await expect(empty(page)).toContainText('Not started');
  await f.emulator!.startAgain();
  await expectLine(page, connectedAt(f.emulatorPort), 60000);
  expect((await direct(ctx, f.emulatorPort).listKeys({})).Keys).toEqual([]);
  await expect(empty(page)).toHaveText('No customer managed keys');
  await expect(keyLink(page, id)).toHaveCount(0);
});
