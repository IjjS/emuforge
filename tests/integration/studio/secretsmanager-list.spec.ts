import { expect, test } from './support';
import { ABOUT_CONTROL, connectedAt, crumbLink, expectLine, notStartedOn } from './support/aws-area';
import { direct, fixture, waitForPurge } from './services/secretsmanager/fixture';
import {
  button,
  detail,
  detailPath,
  expectSettledList,
  listPath,
  secretLink,
  expectRevealedText,
  namedRowCell,
  ui,
  valueRequests,
} from './services/secretsmanager/screen';

test('studio.secretsmanager-external-metadata', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed({ Description: 'Metadata from outside Studio' });
  const record = await f.describe();
  const reads = valueRequests(page);
  await page.goto('/aws/secretsmanager');
  const link = secretLink(page, f.name);
  const cell = await namedRowCell(page, page.getByRole('link', { name: f.name, exact: true }), 2);
  await expect(cell).toBeVisible();
  await expect(cell).toHaveText(record.Description!);
  await link.click();
  await expect(page.getByText(record.ARN!, { exact: true })).toBeVisible();
  expect(reads).toEqual([]);
});

test('studio.secretsmanager-refresh', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed({ Description: 'Original description' });
  await page.goto(listPath);
  await expect(secretLink(page, f.name)).toBeVisible();
  await f.client.updateSecret({ SecretId: f.name, Description: 'Externally updated' });
  await button(page, 'Refresh').click();
  const cell = await namedRowCell(page, page.getByRole('link', { name: f.name, exact: true }), 2);
  await expect(cell).toBeVisible();
  await expect(cell).toHaveText((await f.describe()).Description!);
});

test('studio.secretsmanager-reentry', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await page.goto(listPath);
  await expectSettledList(page);
  const original = await page.evaluateHandle(() => document);
  await crumbLink(page, 'AWS').click();
  await expect(page).toHaveURL(/\/aws$/);
  await f.seed();
  await page.goBack();
  await expect(secretLink(page, (await f.describe()).Name!)).toBeVisible();
  expect(await page.evaluate((doc) => document === doc, original)).toBe(true);
  await original.dispose();
});

test('studio.secretsmanager-notice', async ({ ctx, page }) => {
  await fixture(ctx);
  await page.goto(listPath);
  const notice = page.getByRole('region', { name: 'Local emulator notice' });
  await button(notice, 'Close the local emulator notice').click();
  await expect(notice).toBeHidden();
  await button(page, ABOUT_CONTROL).click();
  await expect(notice).toContainText('These secrets are in your local emulator');
});

test('studio.secretsmanager-missing-secret', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  await f.seed();
  await f.client.deleteSecret({ SecretId: f.name, ForceDeleteWithoutRecovery: true });
  await waitForPurge(f);
  await page.goto(detailPath(f.name));
  await expect(page.getByText('Secret not found', { exact: true })).toBeVisible();
  await expect(page.getByText('Your local emulator could not find ' + f.name + '.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to secrets' })).toHaveAttribute('href', listPath);
});

test('studio.secretsmanager-restart-clears-secrets', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  await f.seed();
  await page.goto(listPath);
  await expect(secretLink(page, f.name)).toBeVisible();
  const documentBeforeStop = await page.evaluateHandle(() => document);
  const originalUrl = page.url();
  await f.emulator!.stop();
  await expectLine(page, notStartedOn(f.emulatorPort));
  await f.emulator!.startAgain();
  await expectLine(page, connectedAt(f.emulatorPort), 60000);
  const empty = page.locator(ui.findTable().findEmptySlot().toSelector());
  await expect(empty.getByText('No secrets', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(secretLink(page, f.name)).toHaveCount(0);
  await expect(empty.getByText('Secrets stored in this emulator will appear here.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(originalUrl);
  expect(await page.evaluate((doc) => doc === document, documentBeforeStop)).toBe(true);
  await documentBeforeStop.dispose();
  expect((await direct(ctx, f.emulatorPort).listSecrets({})).SecretList).toEqual([]);
});

test('studio.secretsmanager-restart-clears-detail', async ({ ctx, page }) => {
  const f = await fixture(ctx, true);
  const reads = valueRequests(page);
  const { ARN } = await f.seed({ Description: 'Previous instance metadata' });
  const oldArn = page.getByText(ARN!);
  await detail(page, f.name);
  await expect(oldArn).toBeVisible();
  await expect(page.getByText('Previous instance metadata', { exact: true })).toBeVisible();
  await button(page, 'Retrieve secret value').click();
  const shown = page.getByText('fixture text');
  await expectRevealedText(shown, 'fixture text');
  expect(reads).toEqual(['GetSecretValue']);
  const documentBeforeStop = await page.evaluateHandle(() => document);
  const originalUrl = page.url();
  const departures: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && frame.url() !== originalUrl) departures.push(frame.url());
  });
  await f.emulator!.stop();
  await expectLine(page, notStartedOn(f.emulatorPort));
  await expect(shown).toBeHidden();
  await f.emulator!.startAgain();
  await expectLine(page, connectedAt(f.emulatorPort), 60000);
  await expect(page.getByText('Secret not found', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('link', { name: 'Back to secrets' })).toBeVisible();
  await expect(page.getByText('Previous instance metadata')).toBeHidden();
  await expect(oldArn).toBeHidden();
  await expect(shown).toBeHidden();
  expect(reads).toEqual(['GetSecretValue']);
  await expect(page).toHaveURL(originalUrl);
  expect(departures).toEqual([]);
  expect(await page.evaluate((doc) => doc === document, documentBeforeStop)).toBe(true);
  await documentBeforeStop.dispose();
  await expect(direct(ctx, f.emulatorPort).describeSecret({ SecretId: f.name })).rejects.toMatchObject({
    name: 'ResourceNotFoundException',
  });
});
