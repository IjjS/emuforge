import type { Page } from '@playwright/test';
import { expect, startStack, test, type Ctx } from './support';
import { connectedAt, expectLine, LINE_CHANGE_BOUND_MS, notStartedOn } from './support/aws-area';
import { markPage, stillSamePage } from './support/home';
import { getFunctionDirect } from './services/lambda/lambda';
import { functionPage } from './services/lambda/lambda-page';
import { invokeWith, openOnTest } from './services/lambda/lambda-tasks';
import {
  chooseTarget,
  compareInvocation,
  createAlias,
  dialogLocator,
  headerAction,
  inCollection,
  mapping,
  openAliasAction,
  openReleases,
  refusal,
  releaseFunction,
  result,
  success,
  tableParts,
} from './services/lambda/lambda-releases';

test('studio.lambda-publishes-function-version', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await releaseFunction(ctx, emulatorPort, 'rel-publish');
  await openReleases(page, fn.name);
  await expect(inCollection(page, 'Versions', tableParts.findBodyCell(1, 1))).toHaveText('$LATEST');
  await expect(inCollection(page, 'Versions', tableParts.findBodyCell(1, 2))).toHaveText('Editable');
  await expect(inCollection(page, 'Aliases', tableParts.findHeaderSlot())).toContainText(
    'Publish a version before creating an alias.',
  );
  await inCollection(page, 'Versions', headerAction).click();
  await expect(success(page)).toBeVisible();
  const versions = await fn.versions();
  const published = versions.filter((v) => v !== '$LATEST');
  expect(published).toHaveLength(1);
  const number = published[0];
  await expect(success(page)).toContainText(`Published version ${number}.`);
  const row = versions.indexOf(number) + 1;
  await expect(inCollection(page, 'Versions', tableParts.findBodyCell(row, 1))).toHaveText(number);
  await expect(inCollection(page, 'Versions', tableParts.findBodyCell(row, 2))).toHaveText('Published');
  expect(await fn.invoke(number, {})).toEqual({ marker: 'first-release', event: {} });
});

test('studio.lambda-manages-function-alias', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await releaseFunction(ctx, emulatorPort, 'rel-manage');
  const { first, second } = await fn.publishTwo();
  await openReleases(page, fn.name);
  await createAlias(page, first);
  await expect(success(page)).toContainText(`Created alias live to version ${first}.`);
  await mapping(page, first);
  expect(await fn.aliases()).toEqual([{ Name: 'live', FunctionVersion: first }]);
  await openAliasAction(page, 'UpdateAlias');
  await chooseTarget(page, second, true);
  await dialogLocator(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(success(page)).toContainText(`Updated alias live to version ${second}.`);
  await mapping(page, second);
  expect(await fn.aliases()).toEqual([{ Name: 'live', FunctionVersion: second }]);
  await openAliasAction(page, 'DeleteAlias');
  await dialogLocator(page).getByRole('button', { name: 'Delete alias', exact: true }).click();
  await expect(success(page)).toContainText('Deleted alias live.');
  await expect(inCollection(page, 'Aliases', tableParts.findEmptySlot())).toContainText('No aliases');
  expect(await fn.aliases()).toEqual([]);
  expect(await fn.versions()).toEqual(expect.arrayContaining([first, second]));
});

test('studio.lambda-reports-duplicate-alias', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await releaseFunction(ctx, emulatorPort, 'rel-duplicate');
  const { first, second } = await fn.publishTwo();
  await fn.createAlias(first);
  await openReleases(page, fn.name);
  await mapping(page, first);
  await createAlias(page, second);
  await expect(refusal(page)).toContainText('CreateAlias');
  await expect(refusal(page)).toContainText('ResourceConflictException');
  expect(await fn.aliases()).toEqual([{ Name: 'live', FunctionVersion: first }]);
});

test('studio.lambda-invokes-selected-release', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await releaseFunction(ctx, emulatorPort, 'rel-invoke');
  const { first, second } = await fn.publishTwo();
  await fn.createAlias(first);
  await openOnTest(page, fn.name);
  await compareInvocation(page, fn, second, 'second-release', 'numbered');
  await compareInvocation(page, fn, 'live', 'first-release', 'before-move');
  await fn.moveAlias(second);
  await functionPage(page, fn.name).refresh.click();
  await compareInvocation(page, fn, 'live', 'second-release', 'after-move');
});

test('studio.lambda-reports-deleted-invoke-target', async ({ ctx, page }) => {
  const { emulatorPort } = await startStack(ctx);
  const fn = await releaseFunction(ctx, emulatorPort, 'rel-deleted');
  await fn.createAlias(await fn.publish());
  await openOnTest(page, fn.name);
  await chooseTarget(page, 'live');
  await fn.deleteAlias();
  await invokeWith(page, fn.name);
  await expect(result(page)).toContainText('Submitted target live');
  await expect(result(page)).toContainText('Invoke failed');
  await expect(result(page)).toContainText('ResourceNotFoundException');
  expect(await fn.aliases()).toEqual([]);
});

async function reconnect(ctx: Ctx, page: Page, view: 'versions' | 'test') {
  test.setTimeout(240_000);
  const { emulator } = await startStack(ctx, { ownEmulator: true });
  if (!emulator) throw Error('Missing private emulator');
  const fn = await releaseFunction(ctx, emulator.port, view === 'versions' ? 'rel-view-restart' : 'rel-test-restart');
  const version = await fn.publish();
  await fn.createAlias(version);
  if (view === 'versions') {
    await openReleases(page, fn.name);
    await mapping(page, version);
    const versions = await fn.versions();
    await expect(inCollection(page, 'Versions', tableParts.findBodyCell(versions.indexOf(version) + 1, 1))).toHaveText(
      version,
    );
  } else {
    await openOnTest(page, fn.name);
    await compareInvocation(page, fn, 'live', 'first-release', 'before-restart');
  }
  await markPage(page);
  await emulator.stop();
  await expectLine(page, notStartedOn(emulator.port));
  await emulator.startAgain();
  await expectLine(page, connectedAt(emulator.port));
  await expect(functionPage(page, fn.name).notFound).toBeVisible({ timeout: 2 * LINE_CHANGE_BOUND_MS });
  await expect(page.getByRole('table', { name: 'Versions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Aliases', exact: true })).toHaveCount(0);
  await expect(page.getByText('Submitted target live', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/before-restart/)).toHaveCount(0);
  expect((await getFunctionDirect(ctx, emulator.port, fn.name)).found).toBe(false);
  expect(await stillSamePage(page)).toBe(true);
}

test('studio.lambda-release-view-reconnects', async ({ ctx, page }) => reconnect(ctx, page, 'versions'));
test('studio.lambda-release-test-reconnects', async ({ ctx, page }) => reconnect(ctx, page, 'test'));
