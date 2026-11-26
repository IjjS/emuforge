// Building a REST API on its screen (issue 69, task 3): a resource, a method with each kind of integration, the
// permission a Lambda method needs, the refusals of Create method, and the deployment that makes it callable.

import { expect, test } from './support';
import {
  alertIn,
  allowCheckbox,
  allowsApi,
  at,
  button,
  cellsOf,
  choose,
  chosenIn,
  createMethodPath,
  dialog,
  dialogContent,
  dialogFooter,
  dialogHeader,
  escapeText,
  expectPairs,
  expectResult,
  exportedAddress,
  fieldOf,
  fixture,
  lambdaUri,
  link,
  loadingOf,
  methodOf,
  pageHeading,
  pairValue,
  policyStatements,
  putMockMethod,
  refusalOf,
  resourceOf,
  resourcesPart,
  restApiPath,
  rootId,
  rowNamed,
  sourceArn,
  studioStatementId,
  tableOf,
  testPanel,
  textbox,
  tileOf,
  warnings,
  type Fixture,
} from './services/apigateway/apigateway';
import type { Page } from '@playwright/test';

/** The API's screen as Create method leaves it: its "Resources" part asked for. */
const afterCreate = (id: string) => at(`${restApiPath(id)}?show=resources`);

/** The resources of a REST API with their methods' verbs, as the emulator reports them. */
async function resourcesOf(f: Fixture, id: string) {
  const answer = await f.rest.getResources({ restApiId: id, embed: ['methods'], limit: 500 });
  return (answer.items ?? []).map((resource) => ({
    path: resource.path,
    methods: Object.keys(resource.resourceMethods ?? {}).sort(),
  }));
}

/** Creates the resource `part` under the root on the API's screen. */
async function createResource(page: Page, part: string): Promise<void> {
  await button(resourcesPart(page), 'Create resource').click();
  await expect(dialogHeader(page)).toHaveText('Create resource');
  await expect(chosenIn(fieldOf(dialogContent(page), 'Parent resource'))).toHaveText('/');
  await textbox(dialogContent(page), 'Path part').fill(part);
  await button(dialogFooter(page), 'Create resource').click();
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, `Resource /${part} created.`);
}

/** Creates a `GET` method with a mock integration answering `body` on the resource at `resourcePath`. */
async function createMockGet(page: Page, id: string, resourcePath: string, body: string): Promise<void> {
  await link(resourceOf(page, resourcePath), 'Create method').click();
  await expect(pageHeading(page)).toHaveText('Create method');
  await expect(chosenIn(fieldOf(page, 'Resource'))).toHaveText(resourcePath);
  await expect(chosenIn(fieldOf(page, 'HTTP method'))).toHaveText('GET');
  await tileOf(page, 'mock').check();
  await textbox(page, 'Response body').fill(body);
  await button(page, 'Create method').click();
  await expect(page).toHaveURL(afterCreate(id));
  await expectResult(page, `Method GET ${resourcePath} created.`);
  await expect(warnings(page)).toHaveCount(0);
}

/** Tests the method `verb` of the resource at `resourcePath` from the screen and waits for its answer. */
async function testFromScreen(page: Page, resourcePath: string, verb: string, body: string): Promise<void> {
  await button(methodOf(resourceOf(page, resourcePath), verb), 'Test').click();
  const panel = testPanel(page);
  await expect.poll(() => pairValue(panel, 'Method')).toBe(verb);
  await button(panel, 'Test').click();
  await expect.poll(() => pairValue(panel, 'Status code')).toBe('200');
  await expect(panel.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  await expect(panel.locator('pre').nth(0)).toHaveText(body);
  await expect(panel.locator('pre').nth(1)).toHaveText(/\S/);
}

test('studio.apigateway-build-a-rest-api-with-a-mock-and-call-it', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const api = await f.rest.createRestApi({ name: `${f.prefix}-build` });
  const id = api.id!;
  const body = `{"from": "${f.prefix}"}`;
  const laterBody = `{"later": "${f.prefix}"}`;
  expect(await resourcesOf(f, id)).toEqual([{ path: '/', methods: [] }]);

  await page.goto(restApiPath(id));
  await expect(resourceOf(page, '/')).toHaveCount(1);
  await createResource(page, 'hello');
  await createMockGet(page, id, '/hello', body);

  const deploy = async (choice: () => Promise<void>) => {
    const stages = tableOf(page, 'Stages');
    await expect(loadingOf(stages)).toHaveCount(0);
    await button(stages, 'Deploy API').click();
    await expect(dialogHeader(page)).toHaveText('Deploy API');
    await choice();
    await button(dialogFooter(page), 'Deploy').click();
    await expect(dialog(page)).toBeHidden();
    await expectResult(page, 'API deployed to stage dev.');
  };
  await deploy(() => textbox(dialogContent(page), 'Stage name').fill('dev'));
  const stage = cellsOf(rowNamed(tableOf(page, 'Stages'), 'dev'));
  await expect(stage.nth(1)).toHaveText('dev');
  await expect(stage.nth(4)).toHaveText(await exportedAddress(f.rest, id, 'dev'));

  const hello = await f.callOutside(f.restStagePath(id, 'dev', '/hello'));
  expect(hello).toMatchObject({ status: 200, body });
  const resources = await f.rest.getResources({ restApiId: id, limit: 500 });
  const helloId = resources.items!.find((resource) => resource.path === '/hello')!.id!;
  expect(await resourcesOf(f, id)).toContainEqual({ path: '/hello', methods: ['GET'] });
  const made = { restApiId: id, resourceId: helloId, httpMethod: 'GET' };
  expect(await f.rest.getIntegration(made)).toMatchObject({ type: 'MOCK' });
  expect(await f.rest.getIntegrationResponse({ ...made, statusCode: '200' })).toMatchObject({
    responseTemplates: { 'application/json': body },
  });

  await createResource(page, 'later');
  await createMockGet(page, id, '/later', laterBody);
  const undeployed = await f.callOutside(f.restStagePath(id, 'dev', '/later'));
  expect(undeployed.status).toBeGreaterThanOrEqual(400);
  expect(undeployed.body).not.toBe(laterBody);

  await deploy(() => choose(fieldOf(dialogContent(page), 'Existing stage'), 'dev'));
  expect(await f.callOutside(f.restStagePath(id, 'dev', '/later'))).toMatchObject({ status: 200, body: laterBody });
});

test('studio.apigateway-create-method-with-a-lambda-gives-the-permission', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const fn = await f.makeFunction('fn');
  const api = await f.rest.createRestApi({ name: `${f.prefix}-lambda` });
  const id = api.id!;
  const root = await rootId(f.rest, id);
  expect(await policyStatements(f.lambda, fn.name)).toEqual([]);

  await page.goto(createMethodPath(id));
  await expect(pageHeading(page)).toHaveText('Create method');
  await choose(fieldOf(page, 'Resource'), root);
  await choose(fieldOf(page, 'HTTP method'), 'ANY');
  await tileOf(page, 'lambda').check();
  await choose(fieldOf(page, 'Lambda function'), fn.arn);
  await expect(allowCheckbox(page)).toBeChecked();
  await button(page, 'Create method').click();

  await expect(page).toHaveURL(afterCreate(id));
  await expectResult(page, 'Method ANY / created.');
  await expect(warnings(page)).toHaveCount(0);
  await expectPairs(methodOf(resourceOf(page, '/'), 'ANY'), [
    ['Authorization', 'NONE'],
    ['API key required', 'No'],
    ['Integration', new RegExp(`^Lambda function\\s*${escapeText(fn.arn)}$`)],
  ]);
  expect(await f.rest.getIntegration({ restApiId: id, resourceId: root, httpMethod: 'ANY' })).toMatchObject({
    type: 'AWS_PROXY',
    uri: lambdaUri(fn.arn),
  });
  const statements = await policyStatements(f.lambda, fn.name);
  expect(statements.filter((statement) => allowsApi(statement, id))).toHaveLength(1);

  await testFromScreen(page, '/', 'ANY', fn.answer);
});

test('studio.apigateway-lambda-permission-conflict-is-verified', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const fn = await f.makeFunction('fn');
  const a = await f.rest.createRestApi({ name: `${f.prefix}-a` });
  const b = await f.rest.createRestApi({ name: `${f.prefix}-b` });
  const permission = { FunctionName: fn.name, Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com' };
  await f.lambda.addPermission({
    ...permission,
    StatementId: studioStatementId(a.id!),
    SourceArn: sourceArn('another000'),
  });
  await f.lambda.addPermission({ ...permission, StatementId: studioStatementId(b.id!), SourceArn: sourceArn(b.id!) });
  const before = await policyStatements(f.lambda, fn.name);
  expect(before.map((statement) => statement.Sid).sort()).toEqual([a.id!, b.id!].map(studioStatementId).sort());
  expect(before.some((statement) => allowsApi(statement, a.id!))).toBe(false);
  expect(before.some((statement) => allowsApi(statement, b.id!))).toBe(true);

  const createLambdaGet = async (id: string) => {
    const root = await rootId(f.rest, id);
    await page.goto(createMethodPath(id));
    await expect(pageHeading(page)).toHaveText('Create method');
    await choose(fieldOf(page, 'Resource'), root);
    await expect(chosenIn(fieldOf(page, 'HTTP method'))).toHaveText('GET');
    await tileOf(page, 'lambda').check();
    await choose(fieldOf(page, 'Lambda function'), fn.arn);
    await expect(allowCheckbox(page)).toBeChecked();
    await button(page, 'Create method').click();
    await expect(page).toHaveURL(afterCreate(id));
    await expectResult(page, 'Method GET / created.');
    expect(await f.rest.getMethod({ restApiId: id, resourceId: root, httpMethod: 'GET' })).toMatchObject({
      httpMethod: 'GET',
      methodIntegration: { type: 'AWS_PROXY', uri: lambdaUri(fn.arn) },
    });
  };

  await createLambdaGet(a.id!);
  await expect(warnings(page)).toHaveCount(1);
  await expect(warnings(page)).toContainText(`created, but the permission was not added to ${fn.name}:`);
  await expect(warnings(page)).toContainText(
    new RegExp(`not added to ${escapeText(fn.name)}:\\s*\\S.*${escapeText(studioStatementId(a.id!))}`),
  );
  expect(await policyStatements(f.lambda, fn.name)).toEqual(before);

  await createLambdaGet(b.id!);
  await expect(warnings(page)).toHaveCount(0);
  expect(await policyStatements(f.lambda, fn.name)).toEqual(before);
});

test('studio.apigateway-create-method-refusals-leave-nothing-half-made', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const known = `{"target": "${f.prefix}"}`;
  const refuse = await f.rest.createRestApi({ name: `${f.prefix}-refuse` });
  const id = refuse.id!;
  const root = await rootId(f.rest, id);
  await putMockMethod(f.rest, id, root, 'GET', '{}');
  const target = await f.rest.createRestApi({ name: `${f.prefix}-target` });
  await putMockMethod(f.rest, target.id!, await rootId(f.rest, target.id!), 'GET', known);
  await f.rest.createDeployment({ restApiId: target.id!, stageName: 'dev' });
  const address = await exportedAddress(f.rest, target.id!, 'dev');
  for (const used of [address, `https://127.0.0.1:${String(f.port)}`]) expect(new URL(used).hostname).toBe('127.0.0.1');

  const get = { restApiId: id, resourceId: root, httpMethod: 'GET' };
  const exists = await refusalOf(
    f.rest.putMethod({ ...get, authorizationType: 'NONE' }),
    'the emulator made a method that exists',
  );
  const badAddress = await refusalOf(
    f.rest.putIntegration({ ...get, type: 'HTTP_PROXY', integrationHttpMethod: 'GET', uri: 'not-a-url' }),
    'the emulator took not-a-url as an integration address',
  );
  const refusal = alertIn(page.locator('form'));

  await page.goto(createMethodPath(id));
  await expect(pageHeading(page)).toHaveText('Create method');
  await choose(fieldOf(page, 'Resource'), root);
  await expect(chosenIn(fieldOf(page, 'HTTP method'))).toHaveText('GET');
  await tileOf(page, 'http').check();
  await textbox(page, 'HTTP address').fill(address);
  await button(page, 'Create method').click();
  await expect(refusal).toContainText('PutMethod');
  await expect(refusal).toContainText(exists);
  await expect(pageHeading(page)).toHaveText('Create method');
  await expect(page).toHaveURL(at(createMethodPath(id)));
  expect(await f.rest.getIntegration(get)).toMatchObject({ type: 'MOCK' });
  expect(await resourcesOf(f, id)).toEqual([{ path: '/', methods: ['GET'] }]);

  await choose(fieldOf(page, 'HTTP method'), 'POST');
  await textbox(page, 'HTTP address').fill('not-a-url');
  await button(page, 'Create method').click();
  await expect(refusal).toContainText('PutIntegration');
  await expect(refusal).toContainText(badAddress);
  await expect(refusal).toContainText('No method was created.');
  await expect(pageHeading(page)).toHaveText('Create method');
  expect(await resourcesOf(f, id)).toEqual([{ path: '/', methods: ['GET'] }]);

  await textbox(page, 'HTTP address').fill(address);
  await choose(fieldOf(page, 'Integration HTTP method'), 'GET');
  await button(page, 'Create method').click();
  await expect(page).toHaveURL(afterCreate(id));
  await expectResult(page, 'Method POST / created.');
  expect(await f.rest.getIntegration({ ...get, httpMethod: 'POST' })).toMatchObject({
    type: 'HTTP_PROXY',
    uri: address,
    httpMethod: 'GET',
  });

  await testFromScreen(page, '/', 'POST', known);
});
