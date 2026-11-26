// An HTTP or WebSocket API's screen (issue 69, tasks 2 and 5): its routes, integrations and stages, and its changes
// and cleanup.

import { expect, test } from './support';
import { SEOUL } from './support/service-screens';
import {
  alertIn,
  APIS,
  at,
  button,
  confirmDelete,
  containerOf,
  dateText,
  dialog,
  dialogContent,
  dialogFooter,
  dialogHeader,
  expectPairs,
  expectResult,
  expectRow,
  fixture,
  link,
  loadingOf,
  pageHeading,
  pairValue,
  radioOf,
  refusalOf,
  expectNamed,
  rowsOf,
  selectRow,
  tableOf,
  textbox,
  v2ApiPath,
  type Fixture,
} from './services/apigateway/apigateway';
import type { Page } from '@playwright/test';

test.use({ timezoneId: SEOUL.timeZone });

/** A cell the scenario says nothing of: a deployment's ID, a date. */
const ANY = null;
const address = (name: string) => `http://127.0.0.1:1/${name}`;

/** A WebSocket API named `name` made outside with a `$connect` route to a mock integration and the stage `prod`. */
async function makeWebSocketApi(f: Fixture, name: string) {
  const api = await f.v2.createApi({
    Name: name,
    ProtocolType: 'WEBSOCKET',
    RouteSelectionExpression: '$request.body.action',
  });
  const ApiId = api.ApiId!;
  const mock = await f.v2.createIntegration({ ApiId, IntegrationType: 'MOCK' });
  await f.v2.createRoute({ ApiId, RouteKey: '$connect', Target: `integrations/${mock.IntegrationId!}` });
  await f.v2.createStage({ ApiId, StageName: 'prod' });
  return api;
}

/** An HTTP endpoint integration to `uri`, made outside. */
async function makeHttpIntegration(f: Fixture, ApiId: string, uri: string): Promise<string> {
  const made = await f.v2.createIntegration({
    ApiId,
    IntegrationType: 'HTTP_PROXY',
    IntegrationMethod: 'ANY',
    IntegrationUri: uri,
    PayloadFormatVersion: '1.0',
  });
  return made.IntegrationId!;
}

/** The three tables of the screen, each read. */
async function partsRead(page: Page) {
  const parts = {
    routes: tableOf(page, 'Routes'),
    integrations: tableOf(page, 'Integrations'),
    stages: tableOf(page, 'Stages'),
  };
  for (const part of Object.values(parts)) await expect(loadingOf(part)).toHaveCount(0);
  return parts;
}

test('studio.apigateway-v2-api-page-shows-routes-integrations-stages', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const fn = await f.makeFunction('fn');
  const made = await f.v2.createApi({ Name: `${f.prefix}-hserves`, ProtocolType: 'HTTP' });
  const ApiId = made.ApiId!;
  const lambda = await f.v2.createIntegration({
    ApiId,
    IntegrationType: 'AWS_PROXY',
    IntegrationUri: fn.arn,
    PayloadFormatVersion: '2.0',
  });
  const http = await makeHttpIntegration(f, ApiId, address('default'));
  const unused = await makeHttpIntegration(f, ApiId, address('unused'));
  await f.v2.createRoute({ ApiId, RouteKey: 'GET /one', Target: `integrations/${lambda.IntegrationId!}` });
  await f.v2.createRoute({ ApiId, RouteKey: '$default', Target: `integrations/${http}` });
  await f.v2.createStage({ ApiId, StageName: '$default', AutoDeploy: true });
  await f.v2.createStage({ ApiId, StageName: 'dev', AutoDeploy: false });
  const ws = await makeWebSocketApi(f, `${f.prefix}-ws`);

  const api = await f.v2.getApi({ ApiId });
  const endpoint = api.ApiEndpoint!;
  expect(endpoint).toMatch(/\S/);
  const routes = (await f.v2.getRoutes({ ApiId })).Items!;
  const integrations = (await f.v2.getIntegrations({ ApiId })).Items!;
  const reported = (id: string) => integrations.find((integration) => integration.IntegrationId === id)!;
  const authorization = (key: string) => routes.find((route) => route.RouteKey === key)!.AuthorizationType ?? '-';

  await page.goto(v2ApiPath(ApiId));
  await expect(pageHeading(page)).toHaveText(api.Name!);
  await expectPairs(containerOf(page, 'Details'), [
    ['Name', api.Name!],
    ['ID', ApiId],
    ['Protocol', 'HTTP'],
    ['Description', '-'],
    ['API endpoint', endpoint],
    ['Creation time', dateText(api.CreatedDate!)],
  ]);
  const parts = await partsRead(page);

  await expect(rowsOf(parts.routes)).toHaveCount(2);
  await expectRow(parts.routes, 'GET /one', ['GET /one', authorization('GET /one'), 'Lambda function', fn.arn]);
  await expectRow(parts.routes, '$default', [
    '$default',
    authorization('$default'),
    'HTTP endpoint',
    address('default'),
  ]);

  await expect(rowsOf(parts.integrations)).toHaveCount(3);
  const shownIntegration = async (id: string, target: string, format: string, usedBy: string) => {
    expect(reported(id)).toMatchObject({ IntegrationUri: target, PayloadFormatVersion: format });
    await expectRow(parts.integrations, id, [id, reported(id).IntegrationType!, target, format, usedBy]);
  };
  await shownIntegration(lambda.IntegrationId!, fn.arn, '2.0', 'GET /one');
  await shownIntegration(http, address('default'), '1.0', '$default');
  await shownIntegration(unused, address('unused'), '1.0', '-');
  expect(reported(lambda.IntegrationId!).IntegrationType).toBe('AWS_PROXY');
  expect(reported(http).IntegrationType).toBe('HTTP_PROXY');

  await expect(rowsOf(parts.stages)).toHaveCount(2);
  await expectRow(parts.stages, '$default', ['$default', 'On', ANY, ANY, endpoint]);
  await expectRow(parts.stages, 'dev', ['dev', 'Off', ANY, ANY, `${endpoint}/dev`]);
  await expect(link(parts.routes, 'Create route')).toBeVisible();
  await expect(button(parts.stages, 'Create stage')).toBeVisible();

  await page.goto(v2ApiPath(ws.ApiId!));
  await expect(pageHeading(page)).toHaveText(ws.Name!);
  await expect.poll(() => pairValue(containerOf(page, 'Details'), 'Protocol')).toBe('WebSocket');
  const wsParts = await partsRead(page);
  await expectNamed(wsParts.routes, '$connect', 1);
  await expectNamed(wsParts.stages, 'prod', 1);
  await expect(link(page, 'Create route')).toHaveCount(0);
  await expect(button(page, 'Create route')).toHaveCount(0);
  await expect(button(page, 'Create stage')).toHaveCount(0);
  await expect(button(page, 'Deploy')).toHaveCount(0);

  const missing = 'nope000000';
  await expect(f.v2.getApi({ ApiId: missing })).rejects.toMatchObject({ name: 'NotFoundException' });
  await page.goto(v2ApiPath(missing));
  await expect(pageHeading(page)).toHaveText('API not found');
  await link(page, 'View APIs').click();
  await expect(page).toHaveURL(at(APIS));
});

test('studio.apigateway-v2-api-changes-and-cleanup', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const made = await f.v2.createApi({ Name: `${f.prefix}-hclean`, ProtocolType: 'HTTP' });
  const ApiId = made.ApiId!;
  const ofA = await makeHttpIntegration(f, ApiId, address('a'));
  const ofB = await makeHttpIntegration(f, ApiId, address('b'));
  await f.v2.createRoute({ ApiId, RouteKey: 'GET /a', Target: `integrations/${ofA}` });
  await f.v2.createRoute({ ApiId, RouteKey: 'GET /b', Target: `integrations/${ofB}` });
  await f.v2.createStage({ ApiId, StageName: '$default', AutoDeploy: true });
  const ws = await makeWebSocketApi(f, `${f.prefix}-wsclean`);
  const routeKeys = async (id: string) => ((await f.v2.getRoutes({ ApiId: id })).Items ?? []).map((r) => r.RouteKey);
  const integrationIds = async (id: string) =>
    ((await f.v2.getIntegrations({ ApiId: id })).Items ?? []).map((integration) => integration.IntegrationId);
  const stageNames = async (id: string) => ((await f.v2.getStages({ ApiId: id })).Items ?? []).map((s) => s.StageName);

  const editApi = async (label: 'Name' | 'Description', value: string, name: string) => {
    await button(containerOf(page, 'Details'), 'Edit').click();
    await expect(dialogHeader(page)).toHaveText('Edit API');
    await textbox(dialogContent(page), label).fill(value);
    await button(dialogFooter(page), 'Save').click();
    await expect(dialog(page)).toBeHidden();
    await expectResult(page, `API ${name} updated.`);
  };
  const openCreateStage = async (stages: ReturnType<typeof tableOf>) => {
    await button(stages, 'Create stage').click();
    await expect(dialogHeader(page)).toHaveText('Create stage');
    await textbox(dialogContent(page), 'Stage name').fill('dev');
    await radioOf(dialogContent(page), 'off').check();
    await button(dialogFooter(page), 'Create stage').click();
  };
  const deleteRoute = async (routes: ReturnType<typeof tableOf>, key: string, integrationId: string) => {
    await selectRow(routes, key);
    await button(routes, 'Delete').click();
    await expect(dialogContent(page)).toContainText(integrationId);
    await expect(dialogContent(page)).toContainText('is used by no other route and is deleted with it.');
    await confirmDelete(page, `Delete route ${key}?`, 'delete');
    await expect(dialog(page)).toBeHidden();
    await expectResult(page, `Route ${key} deleted.`);
  };
  const deleteStage = async (stages: ReturnType<typeof tableOf>, name: string) => {
    await selectRow(stages, name);
    await button(stages, 'Delete').click();
    await confirmDelete(page, `Delete stage ${name}?`, name);
    await expect(dialog(page)).toBeHidden();
    await expectResult(page, `Stage ${name} deleted.`);
  };

  await page.goto(v2ApiPath(ApiId));
  const parts = await partsRead(page);
  const newName = `${f.prefix}-hclean2`;
  await editApi('Name', newName, newName);
  await expect.poll(() => pairValue(containerOf(page, 'Details'), 'Name')).toBe(newName);
  expect((await f.v2.getApi({ ApiId })).Name).toBe(newName);

  await openCreateStage(parts.stages);
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, 'Stage dev created.');
  await expectRow(parts.stages, 'dev', ['dev', 'Off', ANY, ANY, ANY]);
  const undeployed = await f.callHttpApi(ApiId, '/dev/a');
  expect(undeployed.status).toBeGreaterThanOrEqual(400);
  expect(undeployed.location).toBeUndefined();

  await selectRow(parts.stages, 'dev');
  await button(parts.stages, 'Deploy').click();
  await expectResult(page, 'API deployed to stage dev.');
  const deployed = await f.callHttpApi(ApiId, '/dev/a');
  expect(deployed.status).toBeGreaterThanOrEqual(300);
  expect(deployed.status).toBeLessThan(400);
  expect(deployed.location).toBe(address('a'));
  expect((await f.v2.getStage({ ApiId, StageName: 'dev' })).DeploymentId).toMatch(/\S/);

  const exists = await refusalOf(
    f.v2.createStage({ ApiId, StageName: 'dev' }),
    'the emulator made a stage whose name is taken',
  );
  await openCreateStage(parts.stages);
  const refusal = alertIn(dialogContent(page));
  await expect(refusal).toContainText('CreateStage');
  await expect(refusal).toContainText(exists);
  await expect(dialogHeader(page)).toHaveText('Create stage');
  await button(dialogFooter(page), 'Cancel').click();
  await expect(dialog(page)).toBeHidden();

  await deleteRoute(parts.routes, 'GET /a', ofA);
  await expectNamed(parts.routes, 'GET /a', 0);
  expect(await routeKeys(ApiId)).toEqual(['GET /b']);
  expect(await integrationIds(ApiId)).toEqual([ofB]);

  await deleteStage(parts.stages, 'dev');
  await expectNamed(parts.stages, 'dev', 0);
  expect(await stageNames(ApiId)).toEqual(['$default']);

  await page.goto(v2ApiPath(ws.ApiId!));
  const wsParts = await partsRead(page);
  const description = `${f.prefix} edited in Studio`;
  const wsIntegrations = await integrationIds(ws.ApiId!);
  expect(wsIntegrations).toHaveLength(1);
  await editApi('Description', description, ws.Name!);
  await deleteRoute(wsParts.routes, '$connect', wsIntegrations[0]!);
  await deleteStage(wsParts.stages, 'prod');
  expect((await f.v2.getApi({ ApiId: ws.ApiId! })).Description).toBe(description);
  expect(await routeKeys(ws.ApiId!)).toEqual([]);
  expect(await integrationIds(ws.ApiId!)).toEqual([]);
  expect(await stageNames(ws.ApiId!)).toEqual([]);
});
