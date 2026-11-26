// A REST API's screen (issue 69, tasks 2, 4 and 5): what it serves, testing a method, its changes and cleanup, and a
// deployment the emulator refuses.

import { expect, test } from './support';
import { SEOUL } from './support/service-screens';
import {
  alertIn,
  APIS,
  at,
  button,
  cellsOf,
  confirmDelete,
  containerOf,
  dateText,
  dialog,
  dialogContent,
  dialogFooter,
  dialogHeader,
  escapeText,
  expandControl,
  expectPairs,
  expectResult,
  expectUnavailable,
  exportedAddress,
  fixture,
  lambdaUri,
  link,
  loadingOf,
  methodOf,
  pageHeading,
  pairValue,
  putMockMethod,
  resourceOf,
  resourcesPart,
  restApiPath,
  rootId,
  rowNamed,
  rowsOf,
  sel,
  selectRow,
  tableOf,
  testPanel,
  textbox,
  ui,
} from './services/apigateway/apigateway';

test.use({ timezoneId: SEOUL.timeZone });

const LOOPBACK_ADDRESS = 'http://127.0.0.1:1/none';

test('studio.apigateway-rest-api-page-shows-what-it-serves', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const fn = await f.makeFunction('fn');
  const api = await f.rest.createRestApi({ name: `${f.prefix}-serves` });
  const id = api.id!;
  const root = await rootId(f.rest, id);
  const items = await f.rest.createResource({ restApiId: id, parentId: root, pathPart: 'items' });
  const item = await f.rest.createResource({ restApiId: id, parentId: items.id!, pathPart: '{id}' });
  const template = `{"from": "${f.prefix}"}`;
  await putMockMethod(f.rest, id, items.id!, 'GET', template);
  const post = { restApiId: id, resourceId: items.id!, httpMethod: 'POST' };
  await f.rest.putMethod({ ...post, authorizationType: 'AWS_IAM', apiKeyRequired: true });
  await f.rest.putIntegration({ ...post, type: 'AWS_PROXY', integrationHttpMethod: 'POST', uri: lambdaUri(fn.arn) });
  const any = { restApiId: id, resourceId: item.id!, httpMethod: 'ANY' };
  await f.rest.putMethod({ ...any, authorizationType: 'NONE' });
  await f.rest.putIntegration({ ...any, type: 'HTTP_PROXY', integrationHttpMethod: 'ANY', uri: LOOPBACK_ADDRESS });
  const deployment = await f.rest.createDeployment({ restApiId: id, stageName: 'dev' });
  await f.rest.putMethod({ restApiId: id, resourceId: item.id!, httpMethod: 'DELETE', authorizationType: 'NONE' });

  await page.goto(restApiPath(id));
  await expect(pageHeading(page)).toHaveText(api.name!);
  await expectPairs(containerOf(page, 'Details'), [
    ['Name', api.name!],
    ['ID', id],
    ['Endpoint type', /.+/],
    ['Description', '-'],
    ['Creation time', dateText(api.createdDate!)],
  ]);

  for (const resourcePath of ['/', '/items', '/items/{id}']) await expect(resourceOf(page, resourcePath)).toHaveCount(1);
  const shownMethod = async (resourcePath: string, verb: string, values: [string, string, string | RegExp]) => {
    await expectPairs(methodOf(resourceOf(page, resourcePath), verb), [
      ['Authorization', values[0]],
      ['API key required', values[1]],
      ['Integration', values[2]],
    ]);
  };
  await shownMethod('/items', 'GET', ['NONE', 'No', 'Mock']);
  await shownMethod('/items', 'POST', ['AWS_IAM', 'Yes', new RegExp(`^Lambda function\\s*${escapeText(fn.arn)}$`)]);
  await shownMethod('/items/{id}', 'ANY', [
    'NONE',
    'No',
    new RegExp(`^HTTP endpoint\\s*${escapeText(LOOPBACK_ADDRESS)}$`),
  ]);
  await shownMethod('/items/{id}', 'DELETE', ['NONE', 'No', 'No integration']);

  const stage = cellsOf(rowNamed(tableOf(page, 'Stages'), 'dev'));
  await expect(stage.nth(1)).toHaveText('dev');
  await expect(stage.nth(2)).toHaveText(deployment.id!);
  await expect(stage.nth(4)).toHaveText(await exportedAddress(f.rest, id, 'dev'));

  const get = methodOf(resourceOf(page, '/items'), 'GET');
  await expandControl(get).click();
  await expectPairs(get, [
    ['Authorization', 'NONE'],
    ['API key required', 'No'],
    ['Integration', 'Mock'],
    ['Status code', '200'],
    ['Status code', '200'],
  ]);
  await expect(get.locator('pre')).toHaveText(template);

  const missing = 'nope000000';
  await expect(f.rest.getRestApi({ restApiId: missing })).rejects.toMatchObject({ name: 'NotFoundException' });
  await page.goto(restApiPath(missing));
  await expect(pageHeading(page)).toHaveText('API not found');
  await link(page, 'View APIs').click();
  await expect(page).toHaveURL(at(APIS));
});

test('studio.apigateway-test-a-method-shows-answer-and-log', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const api = await f.rest.createRestApi({ name: `${f.prefix}-test` });
  const id = api.id!;
  const root = await rootId(f.rest, id);
  const known = `{"echo": "${f.prefix}"}`;
  const echo = await f.rest.createResource({ restApiId: id, parentId: root, pathPart: 'echo' });
  await putMockMethod(f.rest, id, echo.id!, 'GET', known);
  await f.rest.putMethod({ restApiId: id, resourceId: echo.id!, httpMethod: 'POST', authorizationType: 'NONE' });
  const anyResource = await f.rest.createResource({ restApiId: id, parentId: root, pathPart: 'any' });
  await putMockMethod(f.rest, id, anyResource.id!, 'ANY', known);
  const privateResource = await f.rest.createResource({ restApiId: id, parentId: root, pathPart: 'private' });
  const privateGet = { restApiId: id, resourceId: privateResource.id!, httpMethod: 'GET' };
  await f.rest.putMethod({ ...privateGet, authorizationType: 'NONE' });
  await f.rest.putIntegration({
    ...privateGet,
    type: 'HTTP_PROXY',
    integrationHttpMethod: 'GET',
    uri: LOOPBACK_ADDRESS,
    connectionType: 'VPC_LINK',
    connectionId: 'link01',
  });
  const refusal = await f.rest
    .testInvokeMethod({ restApiId: id, resourceId: echo.id!, httpMethod: 'POST', pathWithQueryString: '/echo' })
    .then(
      () => {
        throw new Error('the emulator tested a method that has no integration');
      },
      (e: Error) => e.message,
    );

  await page.goto(restApiPath(id));
  const panel = testPanel(page);
  const answered = async (status: string) => {
    await expect.poll(() => pairValue(panel, 'Status code')).toBe(status);
  };

  await button(methodOf(resourceOf(page, '/echo'), 'GET'), 'Test').click();
  await textbox(panel, 'Path with query').fill('/echo?from=studio');
  await textbox(panel, 'Headers').fill('X-Check: yes');
  await textbox(panel, 'Body').fill('{"sent": true}');
  await button(panel, 'Test').click();
  await answered('200');
  await expect(panel.getByRole('heading', { name: 'Response', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Log', exact: true })).toBeVisible();
  await expect(panel.locator('pre').nth(0)).toHaveText(known);
  await expect(panel.locator('pre').nth(1)).toHaveText(/\S+\s+\S+/);

  await button(methodOf(resourceOf(page, '/any'), 'ANY'), 'Test').click();
  await expect.poll(() => pairValue(panel, 'Method')).toBe('ANY');
  await expect(panel.locator(sel(ui.findSelect()))).toHaveCount(0);
  await expect(panel.getByRole('radio')).toHaveCount(0);
  await button(panel, 'Test').click();
  await answered('200');

  await button(methodOf(resourceOf(page, '/echo'), 'POST'), 'Test').click();
  await expect.poll(() => pairValue(panel, 'Method')).toBe('POST');
  await button(panel, 'Test').click();
  const refused = panel.getByRole('alert');
  await expect(refused).toContainText('TestInvokeMethod');
  await expect(refused).toContainText(refusal);

  await expectUnavailable(
    button(methodOf(resourceOf(page, '/private'), 'GET'), 'Test'),
    'Test is not offered for an integration through a VPC link: where the emulator sends it has not been verified.',
  );
  expect((await f.rest.getStages({ restApiId: id })).item ?? []).toEqual([]);
});

test('studio.apigateway-rest-api-changes-and-cleanup', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const api = await f.rest.createRestApi({ name: `${f.prefix}-clean` });
  const id = api.id!;
  const root = await rootId(f.rest, id);
  const a = await f.rest.createResource({ restApiId: id, parentId: root, pathPart: 'a' });
  await f.rest.createResource({ restApiId: id, parentId: a.id!, pathPart: 'b' });
  await putMockMethod(f.rest, id, a.id!, 'GET', '{}');
  await f.rest.createDeployment({ restApiId: id, stageName: 'dev' });
  await f.rest.createDeployment({ restApiId: id, stageName: 'old' });
  const resources = async () =>
    ((await f.rest.getResources({ restApiId: id, embed: ['methods'], limit: 500 })).items ?? []).map((resource) => ({
      path: resource.path,
      methods: Object.keys(resource.resourceMethods ?? {}),
    }));

  await page.goto(restApiPath(id));
  await expect(resourceOf(page, '/a/b')).toHaveCount(1);

  const newName = `${f.prefix}-clean2`;
  const description = `${f.prefix} edited in Studio`;
  const details = containerOf(page, 'Details');
  await button(details, 'Edit').click();
  await expect(dialogHeader(page)).toHaveText('Edit API');
  await textbox(dialogContent(page), 'Name').fill(newName);
  await textbox(dialogContent(page), 'Description').fill(description);
  await button(dialogFooter(page), 'Save').click();
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, `API ${newName} updated.`);
  await expect.poll(() => pairValue(details, 'Name')).toBe(newName);
  await expect.poll(() => pairValue(details, 'Description')).toBe(description);
  expect(await f.rest.getRestApi({ restApiId: id })).toMatchObject({ name: newName, description });

  await button(methodOf(resourceOf(page, '/a'), 'GET'), 'Delete').click();
  await confirmDelete(page, 'Delete method GET /a?', 'delete');
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, 'Method GET /a deleted.');
  expect(await resources()).toContainEqual({ path: '/a', methods: [] });

  await expect(resourceOf(page, '/a').getByRole('heading', { level: 4 })).toHaveCount(0);
  await button(resourceOf(page, '/a'), 'Delete').click();
  await confirmDelete(page, 'Delete resource /a?', '/a');
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, 'Resource /a deleted.');
  await expect(resourceOf(page, '/a')).toHaveCount(0);
  await expect(resourceOf(page, '/a/b')).toHaveCount(0);
  await expect(resourceOf(page, '/')).toHaveCount(1);
  expect(await resources()).toEqual([{ path: '/', methods: [] }]);

  const stages = tableOf(page, 'Stages');
  await expect(loadingOf(stages)).toHaveCount(0);
  await expect(rowsOf(stages)).toHaveCount(2);
  await selectRow(stages, 'old');
  await button(stages, 'Delete').click();
  await confirmDelete(page, 'Delete stage old?', 'old');
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, 'Stage old deleted.');
  await expect(rowNamed(stages, 'old')).toHaveCount(0);
  expect(((await f.rest.getStages({ restApiId: id })).item ?? []).map((stage) => stage.stageName)).toEqual(['dev']);

  await expectUnavailable(button(resourceOf(page, '/'), 'Delete'), 'The root resource cannot be deleted.');
  await expect(resourcesPart(page)).toBeVisible();
});

test('studio.apigateway-deploy-without-methods-is-refused', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const api = await f.rest.createRestApi({ name: `${f.prefix}-empty` });
  const id = api.id!;
  const reason = await f.rest.createDeployment({ restApiId: id, stageName: 'dev' }).then(
    () => {
      throw new Error('the emulator deployed a REST API that has no method');
    },
    (e: Error) => e.message,
  );

  await page.goto(restApiPath(id));
  const stages = tableOf(page, 'Stages');
  await expect(loadingOf(stages)).toHaveCount(0);
  await button(stages, 'Deploy API').click();
  await expect(dialogHeader(page)).toHaveText('Deploy API');
  await textbox(dialogContent(page), 'Stage name').fill('dev');
  await button(dialogFooter(page), 'Deploy').click();
  const refusal = alertIn(dialogContent(page));
  await expect(refusal).toContainText('CreateDeployment');
  await expect(refusal).toContainText(reason);
  await expect(dialog(page)).toBeVisible();
  expect((await f.rest.getStages({ restApiId: id })).item ?? []).toEqual([]);
});
