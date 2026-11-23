import { test, expect } from './support';
import { fixture, POLICY } from './services/secretsmanager/fixture';
import {
  button,
  chooseStage,
  detail,
  modal,
  openSection,
  secretValue,
  submit,
  textbox,
  valueRequests,
  versionRadio,
  versionRow,
} from './services/secretsmanager/screen';

test('studio.secretsmanager-version-history', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const first = await f.seed();
  for (const text of ['second', 'third']) await f.client.putSecretValue({ SecretId: f.name, SecretString: text });
  const { Versions } = await f.versions();
  expect(Versions).toHaveLength(3);
  await detail(page, f.name);
  await openSection(page, 'Version history');
  for (const version of Versions!) {
    const row = versionRow(page, version.VersionId!);
    await expect(row).toContainText(version.VersionId!);
    await expect(row).toContainText(version.VersionStages?.join(', ') || 'No labels');
  }
  await expect(versionRow(page, first.VersionId!)).toContainText('No labels');
});

test('studio.secretsmanager-version-value', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const first = await f.seed();
  await f.client.putSecretValue({ SecretId: f.name, SecretString: 'newer value' });
  const reads = valueRequests(page);
  await detail(page, f.name);
  await openSection(page, 'Version history');
  await versionRadio(page, first.VersionId!).check();
  expect(reads).toEqual([]);
  await button(page, 'Retrieve secret value').click();
  await expect(secretValue(page)).toContainText((await f.value(first.VersionId)).SecretString!);
});

for (const mode of ['add', 'move', 'remove'] as const) {
  test('studio.secretsmanager-stage-' + mode, async ({ ctx, page }) => {
    const f = await fixture(ctx);
    const first = (await f.seed()).VersionId!;
    const second = (await f.client.putSecretValue({ SecretId: f.name, SecretString: 'second' })).VersionId!;
    await f.client.putSecretValue({ SecretId: f.name, SecretString: 'third' });
    const label = 'local-stage';
    if (mode !== 'add')
      await f.client.updateSecretVersionStage({ SecretId: f.name, VersionStage: label, MoveToVersionId: first });
    await detail(page, f.name);
    await openSection(page, 'Version history');
    await chooseStage(page, mode, mode === 'move' ? second : first, label);
    const { Versions } = await f.versions();
    const labelled = Versions!.filter((v) => v.VersionStages?.includes(label)).map((v) => v.VersionId);
    expect(labelled).toEqual(mode === 'remove' ? [] : [mode === 'add' ? first : second]);
    for (const version of Versions!) {
      await expect(versionRow(page, version.VersionId!)).toContainText(
        version.VersionStages?.join(', ') || 'No labels',
      );
    }
  });
}

test('studio.secretsmanager-policy-save', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await detail(page, f.name);
  const section = await openSection(page, 'Resource policy');
  await expect(section).toContainText('This secret has no resource policy.');
  await button(section, 'Edit resource policy').click();
  await textbox(modal(page), 'Policy document').fill(POLICY);
  await button(modal(page), 'Validate policy').click();
  await expect(modal(page)).toContainText('Policy validation passed.');
  await submit(page, 'Save policy');
  const { ResourcePolicy } = await f.client.getResourcePolicy({ SecretId: f.name });
  expect(JSON.parse(ResourcePolicy!)).toEqual(JSON.parse(POLICY));
  await expect(section).toContainText(ResourcePolicy!);
});

test('studio.secretsmanager-policy-remove', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await f.client.putResourcePolicy({ SecretId: f.name, ResourcePolicy: POLICY });
  await detail(page, f.name);
  const section = await openSection(page, 'Resource policy');
  const stored = (await f.client.getResourcePolicy({ SecretId: f.name })).ResourcePolicy!;
  expect(JSON.parse(stored)).toEqual(JSON.parse(POLICY));
  await expect(section).toContainText(stored);
  await button(section, 'Remove resource policy').click();
  await submit(page, 'Remove resource policy');
  await expect(section).toContainText('This secret has no resource policy.');
  expect((await f.client.getResourcePolicy({ SecretId: f.name })).ResourcePolicy).toBeUndefined();
});
