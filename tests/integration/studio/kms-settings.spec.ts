import { expect, test } from './support';
import { SEOUL } from './support/service-screens';
import { fixture } from './services/kms/fixture';
import { button, content, dateText, field, flash, footer, openModal, openTab, rows, rowWith, submit, ui } from './services/kms/screen';

test.use({ timezoneId: SEOUL.timeZone });

test('studio.kms-manage-aliases', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const first = await f.seed('source');
  const second = await f.seed('target');
  const alias = 'alias/' + f.prefix;
  const directAlias = async () => (await f.kms.listAliases({})).Aliases!.find(entry => entry.AliasName === alias);
  await openTab(page, first, 'Labels');
  await openModal(page, 'Create alias');
  await field(page, 'Alias name').fill(alias);
  await submit(page, 'Create alias', 'Alias created.');
  expect(await directAlias()).toMatchObject({ AliasName: alias, TargetKeyId: first });
  await expect(rowWith(page, alias)).toBeVisible();
  await openModal(page, 'Reassign alias ' + alias, 'Reassign alias');
  const picker = ui.findModal().findContent().findSelect();
  await page.locator(picker.findTrigger().toSelector()).click();
  await page.locator(picker.findDropdown().findOptionByValue(second).toSelector()).click();
  await submit(page, 'Reassign alias', 'Alias reassigned.');
  expect(await directAlias()).toMatchObject({ AliasName: alias, TargetKeyId: second });
  await expect(rowWith(page, alias)).toHaveCount(0);
  await openTab(page, second, 'Labels');
  await expect(rowWith(page, alias)).toBeVisible();
  await openModal(page, 'Delete alias ' + alias, 'Delete alias');
  await content(page).getByRole('textbox').fill('delete');
  await submit(page, 'Delete alias', 'Alias deleted.');
  expect(await directAlias()).toBeUndefined();
  await expect(rowWith(page, alias)).toHaveCount(0);
});

test('studio.kms-alias-refused', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const original = await f.seed('original');
  const other = await f.seed('other');
  const alias = 'alias/' + f.prefix;
  await f.kms.createAlias({ AliasName: alias, TargetKeyId: original });
  await openTab(page, other, 'Labels');
  await openModal(page, 'Create alias');
  await field(page, 'Alias name').fill(alias);
  await button(footer(page), 'Create alias').click();
  await expect(content(page).getByRole('alert')).toContainText(/already exist/i);
  expect((await f.kms.listAliases({})).Aliases!.find(entry => entry.AliasName === alias)?.TargetKeyId).toBe(original);
});

test('studio.kms-manage-tags', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const id = await f.seed('tags');
  const name = f.prefix;
  const directTag = async () => (await f.kms.listResourceTags({ KeyId: id })).Tags!.find(t => t.TagKey === name);
  await openTab(page, id, 'Labels');
  await openModal(page, 'Add tag');
  await field(page, 'Tag name').fill(name);
  await field(page, 'Value').fill('original');
  await submit(page, 'Add tag', 'Tag added.');
  expect(await directTag()).toEqual({ TagKey: name, TagValue: 'original' });
  await expect(rowWith(page, name)).toContainText('original');
  await openModal(page, 'Edit tag ' + name, 'Edit tag');
  await field(page, 'Value').fill('updated');
  await submit(page, 'Save tag', 'Tag updated.');
  expect(await directTag()).toEqual({ TagKey: name, TagValue: 'updated' });
  await expect(rowWith(page, name)).toContainText('updated');
  await openModal(page, 'Remove tag ' + name, 'Remove tag');
  await content(page).getByRole('textbox').fill('remove');
  await submit(page, 'Remove tag', 'Tag removed.');
  expect(await directTag()).toBeUndefined();
  await expect(rowWith(page, name)).toHaveCount(0);
});

test('studio.kms-edit-policy', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const id = await f.seed('policy');
  const read = async () => JSON.parse((await f.kms.getKeyPolicy({ KeyId: id, PolicyName: 'default' })).Policy!);
  const policy = await read();
  await openTab(page, id, 'Access');
  await openModal(page, 'Edit key policy');
  const editor = field(page, 'Policy document');
  expect(JSON.parse(await editor.inputValue())).toEqual(policy);
  policy.Statement[0].Sid = 'IntegrationPolicyReadback';
  await editor.fill(JSON.stringify(policy));
  await submit(page, 'Save policy', 'Key policy saved.');
  expect(await read()).toEqual(policy);
  const shown = page.getByRole('tabpanel').locator('code');
  await expect.poll(async () => JSON.parse(await shown.innerText())).toEqual(policy);
});

test('studio.kms-manage-grants', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const id = await f.seed('grant');
  const principal = 'arn:aws:iam::000000000000:role/' + f.prefix;
  const grants = async () => (await f.kms.listGrants({ KeyId: id })).Grants!;
  await openTab(page, id, 'Access');
  await openModal(page, 'Create grant');
  await field(page, 'Grantee principal ARN').fill(principal);
  const picker = ui.findModal().findContent().findMultiselect();
  await page.locator(picker.findTrigger().toSelector()).click();
  await page.locator(picker.findDropdown().findOptionByValue('Encrypt').toSelector()).click();
  await page.keyboard.press('Escape');
  await submit(page, 'Create grant', 'Grant created.');
  const grant = (await grants()).find(g => g.GranteePrincipal === principal)!;
  expect(grant.Operations).toEqual(['Encrypt']);
  const row = rowWith(page, grant.GrantId!);
  await expect(row).toContainText(grant.GranteePrincipal!);
  await expect(row).toContainText(grant.Operations![0]!);
  await openModal(page, 'Revoke grant ' + grant.GrantId!, 'Revoke grant');
  await content(page).getByRole('textbox').fill('revoke');
  await submit(page, 'Revoke grant', 'Grant revoked.');
  expect((await grants()).map(g => g.GrantId)).not.toContain(grant.GrantId);
  await expect(row).toHaveCount(0);
});

test('studio.kms-rotate-key', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const id = await f.seed('rotation');
  const settings = () => f.kms.getKeyRotationStatus({ KeyId: id });
  const history = () => f.kms.listKeyRotations({ KeyId: id });
  await openTab(page, id, 'Rotation');
  const panel = page.getByRole('tabpanel', { name: 'Rotation' });
  async function verify(enabled: boolean) {
    const status = await settings();
    expect(status.KeyRotationEnabled).toBe(enabled);
    await expect(panel.getByText(enabled ? 'Enabled' : 'Disabled', { exact: true })).toBeVisible();
    if (status.RotationPeriodInDays) await expect(panel.getByText(status.RotationPeriodInDays + ' days', { exact: true })).toBeVisible();
    if (status.NextRotationDate) await expect(panel.getByText(dateText(status.NextRotationDate), { exact: true })).toBeVisible();
    const records = (await history()).Rotations ?? [];
    const tableRows = rows(page).and(panel.getByRole('row'));
    await expect(tableRows).toHaveCount(records.length);
    if (records.length === 0) {
      await expect(panel.locator(ui.findTable().findEmptySlot().toSelector().replace(/^body /, ''))).toHaveText('No completed rotations');
    }
    for (const entry of records) {
      const row = rowWith(page, dateText(entry.RotationDate!));
      const type = entry.RotationType === 'ON_DEMAND' ? 'On-demand' : 'Automatic';
      await expect(row).toContainText(type);
    }
  }
  await verify(false);
  await button(page, 'Enable automatic rotation').click();
  await flash(page, 'Automatic rotation enabled.');
  await verify(true);
  const [rotation] = await Promise.all([
    page.waitForResponse(response => response.request().headers()['x-amz-target']?.endsWith('.RotateKeyOnDemand') === true),
    button(page, 'Rotate now').click(),
  ]);
  expect(rotation.ok()).toBe(true);
  expect(rotation.request().postDataJSON()).toMatchObject({ KeyId: id });
  await flash(page, 'On-demand rotation requested.');
  await verify(true);
  await button(page, 'Disable automatic rotation').click();
  await flash(page, 'Automatic rotation disabled.');
  await verify(false);
});
