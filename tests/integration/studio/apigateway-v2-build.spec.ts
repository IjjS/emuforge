// Building an HTTP API (issue 69, task 3): a route to a Lambda function called from outside, a route to an HTTP
// address, a route on an existing integration, and the refusal of a route key that is taken.

import { expect, test } from './support';
import {
  alertIn,
  allowCheckbox,
  allowsApi,
  at,
  button,
  choose,
  chosenIn,
  CREATE_API,
  createRoutePath,
  expectResult,
  expectRow,
  fieldOf,
  fixture,
  link,
  loadingOf,
  pageHeading,
  policyStatements,
  refusalOf,
  rowsOf,
  tableOf,
  textbox,
  tileOf,
  v2ApiPath,
  v2ApisNamed,
  warnings,
  type Fixture,
} from './services/apigateway/apigateway';
import type { Page } from '@playwright/test';

/** A cell the scenario says nothing of: the selection control. */
const ANY = /[\s\S]*/;
const address = (name: string) => `http://127.0.0.1:1/${name}`;

/** The API's screen as Create route leaves it: its "Routes" part asked for. */
const afterCreate = (id: string) => at(`${v2ApiPath(id)}?show=routes`);

/** The routes of an API as the emulator reports them: key and target, in the keys' order. */
async function routesOf(f: Fixture, ApiId: string) {
  const routes = (await f.v2.getRoutes({ ApiId })).Items ?? [];
  return routes
    .map((route) => ({ key: route.RouteKey, target: route.Target }))
    .sort((a, b) => (a.key ?? '').localeCompare(b.key ?? ''));
}

/** The Create route form of the API, with the route `verb path` entered. */
async function openCreateRoute(page: Page, id: string, verb: string, path: string): Promise<void> {
  await page.goto(createRoutePath(id));
  await expect(pageHeading(page)).toHaveText('Create route');
  await choose(fieldOf(page, 'HTTP method'), verb);
  await textbox(page, 'Path').fill(path);
}

/** Chooses a new HTTP endpoint integration to `target`. */
async function newHttpIntegration(page: Page, target: string): Promise<void> {
  await choose(fieldOf(page, 'Integration'), 'new');
  await tileOf(page, 'http').check();
  await textbox(page, 'HTTP address').fill(target);
}

test('studio.apigateway-build-an-http-api-with-a-lambda-route', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const fn = await f.makeFunction('fn');
  const name = `${f.prefix}-hbuild`;
  expect(await policyStatements(f.lambda, fn.name)).toEqual([]);

  await page.goto(CREATE_API);
  await tileOf(page, 'HTTP').check();
  await textbox(page, 'Name').fill(name);
  await button(page, 'Create API').click();
  await expectResult(page, `API ${name} created.`);
  const made = await v2ApisNamed(f.v2, name);
  expect(made).toHaveLength(1);
  const ApiId = made[0]!.ApiId;
  await expect(page).toHaveURL(at(v2ApiPath(ApiId)));
  expect(((await f.v2.getStages({ ApiId })).Items ?? []).map((stage) => stage.StageName)).toEqual(['$default']);

  await link(tableOf(page, 'Routes'), 'Create route').click();
  await expect(pageHeading(page)).toHaveText('Create route');
  await choose(fieldOf(page, 'HTTP method'), 'GET');
  await textbox(page, 'Path').fill('/hello');
  await choose(fieldOf(page, 'Integration'), 'new');
  await tileOf(page, 'lambda').check();
  await choose(fieldOf(page, 'Lambda function'), fn.arn);
  await choose(fieldOf(page, 'Payload format'), '2.0');
  await expect(chosenIn(fieldOf(page, 'Payload format'))).toHaveText('2.0');
  await expect(allowCheckbox(page)).toBeChecked();
  await button(page, 'Create route').click();

  await expect(page).toHaveURL(afterCreate(ApiId));
  await expectResult(page, 'Route GET /hello created.');
  await expect(warnings(page)).toHaveCount(0);
  const integrations = (await f.v2.getIntegrations({ ApiId })).Items ?? [];
  expect(integrations).toHaveLength(1);
  expect(integrations[0]).toMatchObject({
    IntegrationType: 'AWS_PROXY',
    IntegrationUri: fn.arn,
    PayloadFormatVersion: '2.0',
  });
  const integrationId = integrations[0]!.IntegrationId!;
  expect(await routesOf(f, ApiId)).toEqual([{ key: 'GET /hello', target: `integrations/${integrationId}` }]);
  const authorization = (await f.v2.getRoutes({ ApiId })).Items![0]!.AuthorizationType ?? '-';

  const routes = tableOf(page, 'Routes');
  const shownIntegrations = tableOf(page, 'Integrations');
  for (const part of [routes, shownIntegrations]) await expect(loadingOf(part)).toHaveCount(0);
  await expect(rowsOf(routes)).toHaveCount(1);
  await expectRow(routes, 'GET /hello', [ANY, 'GET /hello', authorization, 'Lambda function', fn.arn]);
  await expect(rowsOf(shownIntegrations)).toHaveCount(1);
  await expectRow(shownIntegrations, integrationId, [integrationId, 'AWS_PROXY', fn.arn, '2.0', 'GET /hello']);

  expect(await f.callHttpApi(ApiId, '/hello')).toMatchObject({ status: 200, body: fn.answer });
  const statements = await policyStatements(f.lambda, fn.name);
  expect(statements.filter((statement) => allowsApi(statement, ApiId))).toHaveLength(1);
});

test('studio.apigateway-create-route-http-address-and-existing-integration', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const made = await f.v2.createApi({ Name: `${f.prefix}-hhttp`, ProtocolType: 'HTTP' });
  const ApiId = made.ApiId!;
  await f.v2.createStage({ ApiId, StageName: '$default', AutoDeploy: true });
  expect(await routesOf(f, ApiId)).toEqual([]);
  const target = address('out');
  expect(new URL(target).hostname).toBe('127.0.0.1');

  await openCreateRoute(page, ApiId, 'GET', '/out');
  await newHttpIntegration(page, target);
  await button(page, 'Create route').click();
  await expect(page).toHaveURL(afterCreate(ApiId));
  await expectResult(page, 'Route GET /out created.');

  const answer = await f.callHttpApi(ApiId, '/out');
  expect(answer.status).toBeGreaterThanOrEqual(300);
  expect(answer.status).toBeLessThan(400);
  expect(answer.location).toBe(target);
  const integrations = (await f.v2.getIntegrations({ ApiId })).Items ?? [];
  expect(integrations).toHaveLength(1);
  expect(integrations[0]).toMatchObject({
    IntegrationType: 'HTTP_PROXY',
    IntegrationUri: target,
    PayloadFormatVersion: '1.0',
  });
  const integrationId = integrations[0]!.IntegrationId!;
  expect(await routesOf(f, ApiId)).toEqual([{ key: 'GET /out', target: `integrations/${integrationId}` }]);

  await openCreateRoute(page, ApiId, 'POST', '/out');
  await choose(fieldOf(page, 'Integration'), 'existing');
  await choose(fieldOf(page, 'Existing integration'), integrationId);
  await button(page, 'Create route').click();
  await expect(page).toHaveURL(afterCreate(ApiId));
  await expectResult(page, 'Route POST /out created.');
  expect(await routesOf(f, ApiId)).toEqual([
    { key: 'GET /out', target: `integrations/${integrationId}` },
    { key: 'POST /out', target: `integrations/${integrationId}` },
  ]);
  expect(((await f.v2.getIntegrations({ ApiId })).Items ?? []).map((item) => item.IntegrationId)).toEqual([
    integrationId,
  ]);
});

test('studio.apigateway-create-route-existing-key-takes-back-its-integration', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const made = await f.v2.createApi({ Name: `${f.prefix}-hkey`, ProtocolType: 'HTTP' });
  const ApiId = made.ApiId!;
  const first = await f.v2.createIntegration({
    ApiId,
    IntegrationType: 'HTTP_PROXY',
    IntegrationMethod: 'GET',
    IntegrationUri: address('dup'),
    PayloadFormatVersion: '1.0',
  });
  const Target = `integrations/${first.IntegrationId!}`;
  await f.v2.createRoute({ ApiId, RouteKey: 'GET /dup', Target });
  const taken = await refusalOf(
    f.v2.createRoute({ ApiId, RouteKey: 'GET /dup', Target }),
    'the emulator made a route whose key is taken',
  );
  const before = { routes: await routesOf(f, ApiId), integrations: (await f.v2.getIntegrations({ ApiId })).Items };
  expect(before.routes).toEqual([{ key: 'GET /dup', target: Target }]);
  expect(before.integrations).toHaveLength(1);

  await openCreateRoute(page, ApiId, 'GET', '/dup');
  await newHttpIntegration(page, address('second'));
  await button(page, 'Create route').click();
  const refusal = alertIn(page.locator('form'));
  await expect(refusal).toContainText('CreateRoute');
  await expect(refusal).toContainText(taken);
  await expect(refusal).toContainText('No route was created.');
  await expect(pageHeading(page)).toHaveText('Create route');
  await expect(page).toHaveURL(at(createRoutePath(ApiId)));
  expect(await routesOf(f, ApiId)).toEqual(before.routes);
  expect((await f.v2.getIntegrations({ ApiId })).Items).toEqual(before.integrations);
});
