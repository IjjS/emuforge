// API Gateway's APIs list, Create API and the list's delete (issue 69, tasks 1, 3 and 5), on the run's emulator.

import { expect, test } from './support';
import { ABOUT_CONTROL, crumbs } from './support/aws-area';
import { SEOUL } from './support/service-screens';
import {
  APIS,
  apisRead,
  at,
  button,
  cellOf,
  columnTexts,
  confirmDeleteApi,
  containerOf,
  CREATE_API,
  dateText,
  dialog,
  dialogContent,
  expectPairs,
  expectResult,
  expectRow,
  fixture,
  link,
  pageHeading,
  restApiPath,
  expectNamed,
  alertIn,
  rowsOf,
  selectRow,
  sel,
  tableOf,
  textbox,
  ui,
  v2ApiPath,
  warnings,
} from './services/apigateway/apigateway';

test.use({ timezoneId: SEOUL.timeZone });

/** The selection cell of a row: Cloudscape's own, whatever it holds. */

test('studio.apigateway-apis-made-outside-are-listed', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const rest = await f.rest.createRestApi({
    name: `${f.prefix}-rest`,
    description: `${f.prefix} a REST API made outside`,
    endpointConfiguration: { types: ['REGIONAL'] },
  });
  const http = await f.v2.createApi({ Name: `${f.prefix}-http`, ProtocolType: 'HTTP' });
  const ws = await f.v2.createApi({
    Name: `${f.prefix}-ws`,
    ProtocolType: 'WEBSOCKET',
    RouteSelectionExpression: '$request.body.action',
    Description: `${f.prefix} a WebSocket API made outside`,
  });

  await page.goto(APIS);
  const list = await apisRead(page);
  await expectRow(list, rest.name!, [
    rest.name!,
    rest.id!,
    'REST',
    rest.description!,
    dateText(rest.createdDate!),
    'Regional',
  ]);
  await expectRow(list, http.Name!, [http.Name!, http.ApiId!, 'HTTP', '-', dateText(http.CreatedDate!), '-']);
  await expectRow(list, ws.Name!, [
    ws.Name!,
    ws.ApiId!,
    'WebSocket',
    ws.Description!,
    dateText(ws.CreatedDate!),
    '-',
  ]);

  expect(await crumbs(page)).toEqual(['EmuForge', 'AWS', 'API Gateway', 'APIs']);
  const notice = page.getByRole('region', { name: 'Local emulator notice' });
  await expect(notice).toContainText('These APIs are in your local emulator');
  await button(notice, 'Close the local emulator notice').click();
  await expect(notice).toBeHidden();
  await button(page, ABOUT_CONTROL).click();
  await expect(notice).toContainText('These APIs are in your local emulator');

  await link(await cellOf(list, rest.name!, 1), rest.name!).click();
  await expect(page).toHaveURL(at(restApiPath(rest.id!)));
  await expect(pageHeading(page)).toHaveText(rest.name!);

  await page.goto(APIS);
  await link(await cellOf(await apisRead(page), http.Name!, 1), http.Name!).click();
  await expect(page).toHaveURL(at(v2ApiPath(http.ApiId!)));
  await expect(pageHeading(page)).toHaveText(http.Name!);
});

test('studio.apigateway-api-list-reads-further-pages', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const f = await fixture(ctx);
  const two = (n: number) => String(n).padStart(2, '0');
  const names: string[] = [];
  for (let n = 0; n < 26; n++) {
    names.push(`${f.prefix}-r${two(n)}`, `${f.prefix}-h${two(n)}`);
    await f.rest.createRestApi({ name: `${f.prefix}-r${two(n)}` });
    await f.v2.createApi({ Name: `${f.prefix}-h${two(n)}`, ProtocolType: 'HTTP' });
  }

  await page.goto(APIS);
  const list = await apisRead(page);
  const moreRest = button(list, 'Load more REST APIs');
  const moreV2 = button(list, 'Load more HTTP and WebSocket APIs');
  // The first pages are both read once each kind offers its further page.
  await expect(moreRest).toBeEnabled();
  await expect(moreV2).toBeEnabled();
  const shownNames = () => columnTexts(list, 1);
  const first = await shownNames();
  expect(names.filter((name) => !first.includes(name)).length).toBeGreaterThan(0);

  for (const more of [moreRest, moreV2]) {
    for (;;) {
      const before = await rowsOf(list).count();
      await more.click();
      // The page asked for is read: its rows are added, or it was the last and the control is gone.
      await expect(async () => {
        const gone = (await more.count()) === 0;
        const grown = (await rowsOf(list).count()) > before;
        expect(gone || grown).toBe(true);
        if (!gone) await expect(more).toBeEnabled({ timeout: 1 });
      }).toPass();
      if ((await more.count()) === 0) break;
    }
  }

  const all = await shownNames();
  expect(names.filter((name) => !all.includes(name))).toEqual([]);
  const ids = await columnTexts(list, 2);
  expect(ids.length).toBe(all.length);
  expect(new Set(ids).size).toBe(ids.length);
});

test('studio.apigateway-create-rest-and-http-apis', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const restName = `${f.prefix}-new-rest`;
  const httpName = `${f.prefix}-new-http`;
  const description = `${f.prefix} made in Studio`;
  const tile = (value: string) => page.locator(sel(ui.findTiles().findInputByValue(value)));
  const radio = (value: string) => page.locator(sel(ui.findRadioGroup().findInputByValue(value)));

  await page.goto(CREATE_API);
  await tile('REST').check();
  await textbox(page, 'Name').fill(restName);
  await textbox(page, 'Description').fill(description);
  await radio('REGIONAL').check();
  await button(page, 'Create API').click();
  await expectResult(page, `API ${restName} created.`);
  const madeRest = (await f.rest.getRestApis({ limit: 500 })).items!.filter((api) => api.name === restName);
  expect(madeRest).toHaveLength(1);
  expect(madeRest[0]).toMatchObject({ description, endpointConfiguration: { types: ['REGIONAL'] } });
  await expect(page).toHaveURL(at(restApiPath(madeRest[0]!.id!)));
  await expect(pageHeading(page)).toHaveText(restName);
  await expectPairs(containerOf(page, 'Details'), [
    ['Name', restName],
    ['ID', madeRest[0]!.id!],
    ['Endpoint type', 'Regional'],
    ['Description', description],
    ['Creation time', dateText(madeRest[0]!.createdDate!)],
  ]);

  await page.goto(CREATE_API);
  await tile('HTTP').check();
  await textbox(page, 'Name').fill(httpName);
  await expect(radio('create')).toBeChecked();
  await button(page, 'Create API').click();
  await expectResult(page, `API ${httpName} created.`);
  await expect(warnings(page)).toHaveCount(0);
  const madeHttp = (await f.v2.getApis({ MaxResults: '100' })).Items!.filter((api) => api.Name === httpName);
  expect(madeHttp).toHaveLength(1);
  expect(madeHttp[0]!.ProtocolType).toBe('HTTP');
  await expect(page).toHaveURL(at(v2ApiPath(madeHttp[0]!.ApiId!)));
  const stages = (await f.v2.getStages({ ApiId: madeHttp[0]!.ApiId! })).Items!;
  expect(stages.map((stage) => [stage.StageName, stage.AutoDeploy])).toEqual([['$default', true]]);
  await expect(await cellOf(tableOf(page, 'Stages'), '$default', 2)).toHaveText('On');
});

test('studio.apigateway-delete-apis-from-the-list', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const rest = await f.rest.createRestApi({ name: `${f.prefix}-del-rest` });
  const root = (await f.rest.getResources({ restApiId: rest.id! })).items![0]!.id!;
  await f.rest.putMethod({ restApiId: rest.id!, resourceId: root, httpMethod: 'GET', authorizationType: 'NONE' });
  await f.rest.putIntegration({ restApiId: rest.id!, resourceId: root, httpMethod: 'GET', type: 'MOCK' });
  await f.rest.createDeployment({ restApiId: rest.id!, stageName: 'dev' });
  const http = await f.v2.createApi({ Name: `${f.prefix}-del-http`, ProtocolType: 'HTTP' });
  const gone = await f.rest.createRestApi({ name: `${f.prefix}-gone` });

  await page.goto(APIS);
  const list = await apisRead(page);

  await selectRow(list, rest.name!);
  await confirmDeleteApi(page, rest.name!);
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, `API ${rest.name!} deleted.`);
  await expectNamed(list, rest.name!, 0);
  await expect(f.rest.getRestApi({ restApiId: rest.id! })).rejects.toMatchObject({ name: 'NotFoundException' });

  await expectNamed(list, http.Name!, 1);
  await selectRow(list, http.Name!);
  await confirmDeleteApi(page, http.Name!);
  await expect(dialog(page)).toBeHidden();
  await expectResult(page, `API ${http.Name!} deleted.`);
  await expectNamed(list, http.Name!, 0);
  await expect(f.v2.getApi({ ApiId: http.ApiId! })).rejects.toMatchObject({ name: 'NotFoundException' });

  await expectNamed(list, gone.name!, 1);
  await selectRow(list, gone.name!);
  await button(page, 'Delete').click();
  await expect(dialog(page)).toBeVisible();
  await f.rest.deleteRestApi({ restApiId: gone.id! });
  const reason = await f.rest.deleteRestApi({ restApiId: gone.id! }).then(
    () => {
      throw new Error('the emulator deleted the same REST API twice');
    },
    (e: Error) => e.message,
  );
  await dialogContent(page).getByRole('textbox').fill(gone.name!);
  await button(dialog(page), 'Delete').click();
  const refusal = alertIn(dialogContent(page));
  await expect(refusal).toContainText('DeleteRestApi');
  await expect(refusal).toContainText(reason);
  await expect(dialog(page)).toBeVisible();
});
