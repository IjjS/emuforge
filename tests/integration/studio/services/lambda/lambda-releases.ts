import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { expect, type Ctx } from '../../support';
import { checkPrefix } from '../../support/service-screens';
import { functionConfigurationDirect, lambdaDirect, LambdaSeeded, shownDirect, storedZip } from './lambda';
import { functionPath } from './lambda-list';
import { invokeWith, LOG_TAIL, outputText, RESPONSE } from './lambda-tasks';

function handler(marker: string) {
  return storedZip(
    'index.mjs',
    `export const handler = async (event) => {
    console.log(${JSON.stringify(marker)});
    return { marker: ${JSON.stringify(marker)}, event };
  };`,
  );
}

export async function releaseFunction(ctx: Ctx, port: number, tag: string) {
  const prefix = checkPrefix(ctx, tag);
  const name = prefix + '-function';
  const seed = new LambdaSeeded(ctx, port, prefix);
  await seed.function(name, {
    runtime: 'nodejs22.x',
    code: { handler: 'index.handler', zip: handler('first-release') },
  });
  const path = ['2015-03-31', 'functions', name];

  async function request(
    method: string,
    suffix: string[],
    body: object | null = null,
    query: Record<string, string> = {},
  ) {
    const response = await lambdaDirect(ctx, port, method, [...path, ...suffix], query, body);
    if ('error' in response || response.status < 200 || response.status >= 300)
      throw Error(`Direct ${method} ${suffix.join('/')}: ${shownDirect(response)}`);
    return response.body;
  }
  const publish = async (): Promise<string> => JSON.parse(await request('POST', ['versions'], {})).Version;
  const versions = async (): Promise<string[]> =>
    JSON.parse(await request('GET', ['versions'])).Versions.map((entry: { Version: string }) => entry.Version);
  const aliases = async (): Promise<{ Name: string; FunctionVersion: string }[]> =>
    JSON.parse(await request('GET', ['aliases'])).Aliases.map(
      ({ Name, FunctionVersion }: { Name: string; FunctionVersion: string }) => ({ Name, FunctionVersion }),
    );
  async function publishTwo() {
    const first = await publish();
    await request('PUT', ['code'], { ZipFile: handler('second-release').toString('base64') });
    await expect
      .poll(async () => (await functionConfigurationDirect(ctx, port, name))?.LastUpdateStatus)
      .toBe('Successful');
    const second = await publish();
    expect(second).not.toBe(first);
    return { first, second };
  }
  return {
    name,
    publish,
    versions,
    aliases,
    publishTwo,
    createAlias: (version: string) => request('POST', ['aliases'], { Name: 'live', FunctionVersion: version }),
    moveAlias: (version: string) => request('PUT', ['aliases', 'live'], { FunctionVersion: version }),
    deleteAlias: () => request('DELETE', ['aliases', 'live']),
    invoke: async (target: string, event: object) =>
      JSON.parse(await request('POST', ['invocations'], event, { Qualifier: target })),
  };
}

const panel = createWrapper('[role="tabpanel"]');
const table = panel.findTable();
const modal = createWrapper().findModal();
const dialog = createWrapper(modal.toSelector());
export const dialogLocator = (page: Page) => page.locator(modal.toSelector());
const select = panel.findSelect();
const modalSelect = dialog.findSelect();
export const result = (page: Page) =>
  page.locator(panel.findContainer().toSelector()).filter({
    has: page.getByRole('heading', { name: 'Result', exact: true }),
  });

export async function openReleases(page: Page, name: string) {
  await page.goto(functionPath(name) + '?tab=versions');
  await expect(page.getByRole('table', { name: 'Versions', exact: true })).toBeVisible();
}

/** A table wrapper can match either release collection. Scope its selected element to the named table's container. */
export function inCollection(page: Page, name: 'Versions' | 'Aliases', element: { toSelector(): string }) {
  const collection = page.locator(table.toSelector()).filter({ has: page.getByRole('table', { name, exact: true }) });
  return page.locator(element.toSelector()).and(collection.locator('*'));
}
export const tableParts = table;
export const headerAction = table.findHeaderSlot().findHeader().findActions().findButton();
export async function mapping(page: Page, version: string) {
  await expect(inCollection(page, 'Aliases', table.findBodyCell(1, 2))).toHaveText('live');
  await expect(inCollection(page, 'Aliases', table.findBodyCell(1, 3))).toHaveText(version);
}
export async function openAliasAction(page: Page, action: 'UpdateAlias' | 'DeleteAlias') {
  const menu = table.findBodyCell(1, 1).findButtonDropdown();
  await page.locator(menu.findTriggerButton().toSelector()).click();
  await page.locator(menu.findItemById(action).toSelector()).click();
}
export async function chooseTarget(page: Page, target: string, inDialog = false) {
  const choice = inDialog ? modalSelect : select;
  await page.locator(choice.findTrigger().toSelector()).click();
  await page.locator(choice.findDropdown().findOptionByValue(target).toSelector()).click();
}
export async function createAlias(page: Page, version: string) {
  await inCollection(page, 'Aliases', headerAction).click();
  await page.locator(dialog.findInput().findNativeInput().toSelector()).fill('live');
  await chooseTarget(page, version, true);
  await dialogLocator(page).getByRole('button', { name: 'Create alias', exact: true }).click();
}
export const refusal = (page: Page) => page.locator(dialog.findAlert().toSelector());
export const success = (page: Page) =>
  page.locator(createWrapper().findFlashbar().findItemsByType('success').toSelector()).last();

export async function compareInvocation(
  page: Page,
  fn: Awaited<ReturnType<typeof releaseFunction>>,
  target: string,
  marker: string,
  tag: string,
) {
  const event = { tag };
  const direct = await fn.invoke(target, event);
  expect(direct).toEqual({ marker, event });
  await chooseTarget(page, target);
  await invokeWith(page, fn.name, JSON.stringify(event));
  await expect(result(page)).toContainText('Submitted target ' + target);
  await expect
    .poll(async () => {
      const payload = await outputText(page, RESPONSE);
      return payload ? JSON.parse(payload) : null;
    })
    .toEqual(direct);
  await expect.poll(() => outputText(page, LOG_TAIL)).toContain(marker);
}
