import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import { expect, startStack, test } from './support';
import { deleteFunctionDirect, getFunctionDirect } from './services/lambda/lambda';
import { errorFlash } from './services/lambda/lambda-event-sources';
import { openUrlConfiguration } from './services/lambda/lambda-function-url';
import { functionPage } from './services/lambda/lambda-page';
import { submitDialog, success } from './services/lambda/lambda-releases';
import { invokeWith, outputText, RESPONSE, toConfiguration, toTest } from './services/lambda/lambda-tasks';
import {
  attachedTable,
  inlinePublicationError,
  layerFixture,
  publishForm,
  selectAttachment,
  selectLayer,
  expectVersions,
} from './services/lambda/lambda-layers';

test('studio.lambda-layer-publish', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const layers = layerFixture(ctx, emulatorPort, 'publish');
  const external = layers.own(layers.prefix + '-external');
  const fresh = layers.own(layers.prefix + '-new');
  const first = await layers.publish(external, 'external');
  await page.goto('/aws/lambda/layers');
  await selectLayer(page, external, 1);
  await expectVersions(page, [first.LayerVersionArn]);
  await publishForm(page, fresh, layers.archive('new'));
  await expect(success(page)).toContainText('Published ' + fresh + ' version 1.');
  await selectLayer(page, fresh, 1);
  const [newVersion] = await layers.versions(fresh);
  await expectVersions(page, [newVersion.LayerVersionArn]);
  await publishForm(page, external, layers.archive('second'));
  await expect(success(page)).toContainText('Published ' + external + ' version 2.');
  await page.reload();
  await selectLayer(page, external, 2);
  const published = await layers.versions(external);
  expect(published.map((v) => v.Version)).toEqual([2, 1]);
  await expectVersions(
    page,
    published.map((v) => v.LayerVersionArn),
  );
  expect(published[1].LayerVersionArn).toBe(first.LayerVersionArn);
  const freshVersions = await layers.versions(fresh);
  expect(freshVersions.map(({ Version, LayerVersionArn }) => ({ Version, LayerVersionArn }))).toEqual([
    { Version: 1, LayerVersionArn: newVersion.LayerVersionArn },
  ]);
});

test('studio.lambda-layer-publish-refused', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const layers = layerFixture(ctx, emulatorPort, 'refused');
  const invalid = layers.prefix + '.bad';
  expect(await layers.catalogue()).not.toContain(invalid);
  layers.own(invalid);
  await page.goto('/aws/lambda/layers');
  await publishForm(page, invalid, layers.archive('refused'));
  await expect(inlinePublicationError(page)).toContainText('InvalidParameterValueException');
  await expect(errorFlash(page)).toContainText('InvalidParameterValueException');
  expect(await layers.catalogue()).not.toContain(invalid);
});

test('studio.lambda-layer-function-lifecycle', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const layers = layerFixture(ctx, emulatorPort, 'attached');
  const name = layers.own(layers.prefix + '-lib');
  const historical = await layers.publish(name, 'historical');
  const latest = await layers.publish(name, 'latest');
  await layers.createFunction();
  await openUrlConfiguration(page, layers.prefix);
  const table = attachedTable(page);
  const inner = createWrapper().findTable();
  const empty = page.locator(inner.findEmptySlot().toSelector()).and(table.locator('*'));
  await expect(empty).toHaveText('No layers attached');
  await selectAttachment(page, name, historical.LayerVersionArn);
  await submitDialog(page, 'Add layer version');
  await expect(success(page)).toContainText('Layer version added.');
  await expect(page.locator(inner.findBodyCell(1, 1).toSelector()).and(table.locator('*'))).toHaveText(
    historical.LayerVersionArn,
  );
  await layers.settledAttachments([historical.LayerVersionArn]);
  await toTest(page, layers.prefix);
  await invokeWith(page, layers.prefix, '{}');
  await expect.poll(() => outputText(page, RESPONSE)).toBe('"historical"');
  await toConfiguration(page, layers.prefix);
  await table.getByRole('button', { name: 'Remove layer version ' + historical.LayerVersionArn }).click();
  await submitDialog(page, 'Remove layer version');
  await expect(success(page)).toContainText('Layer version removed.');
  await expect(empty).toHaveText('No layers attached');
  await layers.settledAttachments([]);
  await toTest(page, layers.prefix);
  await invokeWith(page, layers.prefix, '{}');
  await expect.poll(() => outputText(page, RESPONSE)).toBe('"absent"');
  await layers.settledAttachments([]);
  expect((await layers.versions(name)).map((v) => v.LayerVersionArn)).toEqual([
    latest.LayerVersionArn,
    historical.LayerVersionArn,
  ]);
});

test('studio.lambda-layer-function-refused', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const layers = layerFixture(ctx, emulatorPort, 'gone');
  const name = layers.own(layers.prefix + '-lib');
  const version = await layers.publish(name, 'retained');
  await layers.createFunction();
  await openUrlConfiguration(page, layers.prefix);
  await selectAttachment(page, name, version.LayerVersionArn);
  expect(await deleteFunctionDirect(ctx, emulatorPort, layers.prefix)).toMatchObject({ status: 204 });
  await submitDialog(page, 'Add layer version');
  await expect(functionPage(page, layers.prefix).notFoundSentence).toBeVisible();
  const errors = errorFlash(page);
  await expect
    .poll(
      async () => (await errors.allInnerTexts()).some(
        (item) => item.includes('Could not add layer version.') && item.includes('ResourceNotFoundException'),
      ),
      { timeout: 10_000, message: 'One error flash identifies the refused add-layer action and its service code' },
    )
    .toBe(true);
  expect(await getFunctionDirect(ctx, emulatorPort, layers.prefix)).toMatchObject({
    found: false,
    status: 404,
    errorType: 'ResourceNotFoundException',
  });
  expect((await layers.versions(name)).map((v) => v.LayerVersionArn)).toEqual([version.LayerVersionArn]);
});
