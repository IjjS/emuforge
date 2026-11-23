import { expect, startStack, test } from './support';
import { clipboardText, copyControl, grantClipboard } from './support/screen-rules';
import { errorFlash } from './services/lambda/lambda-event-sources';
import { success } from './services/lambda/lambda-releases';
import { FUNCTION_URL, functionPage } from './services/lambda/lambda-page';
import {
  confirmUrlDeletion, createUrl, deleteUrl, expectOverviewUrl, openUrlConfiguration, urlFixture,
} from './services/lambda/lambda-function-url';

test('studio.lambda-function-url-create', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const fn = await urlFixture(ctx, stack.emulatorPort, 'url-create');
  await grantClipboard(context, stack.studio.origin);
  await openUrlConfiguration(page, fn.name);
  await expectOverviewUrl(page, '-');
  await createUrl(page).click();
  await expect(success(page)).toContainText('Function URL created.');
  const config = await fn.readConfig();
  expect(config.AuthType).toBe('AWS_IAM');
  expect(config.FunctionUrl).toBeTruthy();
  await expectOverviewUrl(page, config.FunctionUrl);
  await page.getByRole('button', { name: copyControl(FUNCTION_URL) }).click();
  await expect.poll(() => clipboardText(page)).toBe(config.FunctionUrl);
});

test('studio.lambda-function-url-delete', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await urlFixture(ctx, emulatorPort, 'url-delete');
  await fn.createOutside();
  const config = await fn.readConfig();
  await openUrlConfiguration(page, fn.name);
  await expectOverviewUrl(page, config.FunctionUrl);
  await confirmUrlDeletion(page, fn.name);
  await expectOverviewUrl(page, '-');
  await expect(createUrl(page)).toBeEnabled();
  await expect(success(page)).toContainText('Function URL deleted.');
  await fn.expectOnlyFunction();
});

test('studio.lambda-function-url-create-conflict', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await urlFixture(ctx, emulatorPort, 'url-conflict');
  await openUrlConfiguration(page, fn.name);
  await expect(createUrl(page)).toBeEnabled();
  const url = await fn.createOutside();
  await createUrl(page).click();
  await expect(errorFlash(page)).toContainText('ResourceConflictException');
  await functionPage(page, fn.name).refresh.click();
  await expectOverviewUrl(page, url);
  expect((await fn.readConfig()).FunctionUrl).toBe(url);
});

test('studio.lambda-function-url-delete-missing', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await urlFixture(ctx, emulatorPort, 'url-missing');
  const url = await fn.createOutside();
  await openUrlConfiguration(page, fn.name);
  await expectOverviewUrl(page, url);
  await expect(deleteUrl(page)).toBeEnabled();
  await fn.deleteOutside();
  await confirmUrlDeletion(page, fn.name);
  await expectOverviewUrl(page, '-');
  await expect(createUrl(page)).toBeEnabled();
  await expect(errorFlash(page)).toContainText('ResourceNotFoundException');
  await fn.expectOnlyFunction();
});
