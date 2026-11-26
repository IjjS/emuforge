// API Gateway's entries (issue 69, with issue 650's rule as `amendment-650.md` reads it): the navigation of the two
// groups, the five entries that open through "choose an API", and the page of an entry without a screen.

import { expect, test } from './support';
import {
  expectOneCurrent,
  expectPairs as expectEntryPairs,
  navigationTree,
  NO_SCREEN_FOR_THIS,
  NO_SCREEN_STATUS,
  openEverySection,
  statement,
} from './support/aws-entries';
import { actions, action, goTo, nothingChanged } from './support/no-screen-part';
import {
  APIS,
  apisRead,
  at,
  button,
  choose,
  ENTRIES,
  ENTRY_GROUPS,
  entryOf,
  fixture,
  focusedPartHeading,
  openChoice,
  pageHeading,
  restApiPath,
  rootId,
  rowNamed,
  SUB_SERVICE,
  v2ApiPath,
} from './services/apigateway/apigateway';

test('studio.apigateway-entries-lead-to-a-screen-or-no-screen-yet', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const rest = await f.rest.createRestApi({ name: `${f.prefix}-entry-rest` });
  const root = await rootId(f.rest, rest.id!);
  await f.rest.putMethod({ restApiId: rest.id!, resourceId: root, httpMethod: 'GET', authorizationType: 'NONE' });
  await f.rest.putIntegration({ restApiId: rest.id!, resourceId: root, httpMethod: 'GET', type: 'MOCK' });
  await f.rest.createDeployment({ restApiId: rest.id!, stageName: 'dev' });
  const http = await f.v2.createApi({ Name: `${f.prefix}-entry-http`, ProtocolType: 'HTTP' });
  const integration = await f.v2.createIntegration({
    ApiId: http.ApiId!,
    IntegrationType: 'HTTP_PROXY',
    IntegrationMethod: 'GET',
    IntegrationUri: 'http://127.0.0.1:1/none',
    PayloadFormatVersion: '1.0',
  });
  await f.v2.createRoute({
    ApiId: http.ApiId!,
    RouteKey: 'GET /entry',
    Target: `integrations/${integration.IntegrationId!}`,
  });
  await f.v2.createStage({ ApiId: http.ApiId!, StageName: '$default', AutoDeploy: true });

  // 1. The navigation on APIs.
  await page.goto(APIS);
  const list = await apisRead(page);
  await expect(rowNamed(list, rest.name!)).toHaveCount(1);
  await openEverySection(page);
  const tree = await navigationTree(page);
  const sections = tree.sections.map((section) => section.title);
  for (const group of ENTRY_GROUPS) expect(sections, `the group "${group.name}"`).toContain(group.name);
  const shown = tree.links.map((link) => `${link.text} → ${link.href}`);
  const wanted = [SUB_SERVICE, ...ENTRIES.map((entry) => ({ name: entry.label, path: entry.path }))].map(
    (link) => `${link.name} → ${link.path}`,
  );
  expect(wanted.filter((link) => !shown.includes(link)), 'entries without a link').toEqual([]);
  expect(shown.filter((link) => !wanted.includes(link)), 'links that are no entry').toEqual([]);
  expect(new Set(shown).size, 'no link twice').toBe(shown.length);
  for (const entry of ENTRIES) {
    const beside = tree.links.find((link) => link.href === entry.path)?.beside;
    expect(beside, `beside "${entry.label}"`).toBe(entry.screen ? '' : NO_SCREEN_STATUS);
  }
  await expectOneCurrent(page, 'APIs');

  // 2. The five entries that open a part of a chosen API.
  const parts: { label: string; api: 'rest' | 'http'; show: string; heading: string }[] = [
    { label: 'Resources', api: 'rest', show: 'resources', heading: 'Resources' },
    { label: 'Stages', api: 'rest', show: 'stages', heading: 'Stages' },
    { label: 'Routes', api: 'http', show: 'routes', heading: 'Routes' },
    { label: 'Integrations', api: 'http', show: 'integrations', heading: 'Integrations' },
    { label: 'V2 stages', api: 'http', show: 'stages', heading: 'Stages' },
  ];
  for (const part of parts) {
    await page.goto(entryOf(part.label).path);
    await expect(pageHeading(page)).toHaveText(part.label);
    const id = part.api === 'rest' ? rest.id! : http.ApiId!;
    const option = await openChoice(page, id);
    if (part.api === 'http') await expect(option).toContainText(`${id} · HTTP`);
    await choose(page, id);
    await button(page, 'Open').click();
    const pathname = part.api === 'rest' ? restApiPath(id) : v2ApiPath(id);
    await expect(page).toHaveURL(at(`${pathname}?show=${part.show}`));
    await expect(pageHeading(page)).toHaveText(part.api === 'rest' ? rest.name! : http.Name!);
    await expect(focusedPartHeading(page)).toHaveText(part.heading);
  }

  // 3. An entry without a screen.
  for (const label of ['Deployments', 'V2 authorizers', 'Usage plan keys']) {
    const entry = entryOf(label);
    const parent = entryOf(entry.inside!);
    await page.goto(entry.path);
    await expect(page.locator('h1')).toHaveText(entry.label);
    await expect(statement(page, NO_SCREEN_FOR_THIS)).toBeVisible();
    await expectEntryPairs(page, { 'Listed by': entry.listedBy, 'Listed inside': parent.label });
    await expect(nothingChanged(page)).toBeVisible();
    expect((await actions(page))[0], `the primary action of "${label}"`).toEqual({
      name: goTo(parent.label),
      href: parent.path,
    });
    await action(page, goTo(parent.label)).click();
    await expect(page).toHaveURL(at(parent.path));
  }
});
