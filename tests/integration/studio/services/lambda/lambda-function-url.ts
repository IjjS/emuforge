import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, type Ctx } from '../../support';
import { checkPrefix } from '../../support/service-screens';
import { getFunctionDirect, lambdaDirect, LambdaSeeded } from './lambda';
import { functionPath } from './lambda-list';
import { FUNCTION_URL, OVERVIEW } from './lambda-page';
import { submitDialog } from './lambda-releases';

export async function urlFixture(ctx: Ctx, port: number, tag: string) {
  const name = checkPrefix(ctx, tag);
  const seeded = new LambdaSeeded(ctx, port, name);
  const fn = await seeded.function(name);
  const path = ['2021-10-31', 'functions', name, 'url'];
  return {
    name,
    createOutside: () => seeded.url(name),
    deleteOutside: async () => {
      const answer = await lambdaDirect(ctx, port, 'DELETE', path);
      expect(answer).toMatchObject({ status: 204 });
    },
    readConfig: async () => {
      const answer = await lambdaDirect(ctx, port, 'GET', path);
      if ('error' in answer) throw new Error(answer.error);
      expect(answer.status).toBe(200);
      return JSON.parse(answer.body) as { FunctionUrl: string; AuthType: string };
    },
    expectOnlyFunction: async () => {
      expect(await getFunctionDirect(ctx, port, name)).toMatchObject({
        found: true, configuration: { FunctionArn: fn.FunctionArn },
      });
      expect(await lambdaDirect(ctx, port, 'GET', path)).toMatchObject({
        status: 404, errorType: 'ResourceNotFoundException',
      });
    },
  };
}

export async function openUrlConfiguration(page: Page, name: string) {
  await page.goto(functionPath(name) + '?tab=configuration');
}

const configuration = (page: Page) => page.getByRole('tabpanel', { name: 'Configuration', exact: true });
export const createUrl = (page: Page) => configuration(page).getByRole('button', { name: 'Create function URL' });
export const deleteUrl = (page: Page) => configuration(page).getByRole('button', { name: 'Delete function URL' });

export async function expectOverviewUrl(page: Page, url: string) {
  const wrapper = createWrapper(':scope');
  const content = page.locator(createWrapper().findContentLayout().findContent().toSelector());
  const overview = content.locator(wrapper.findContainer().toSelector()).first();
  await expect(overview.locator(wrapper.findHeader().findHeadingText().toSelector()).first()).toHaveText(OVERVIEW);
  const field = wrapper.findKeyValuePairs().findItems().get(4);
  await expect(overview.locator(field.findLabel().toSelector())).toHaveText(FUNCTION_URL);
  await expect(overview.locator(field.findValue().toSelector())).toHaveText(url, { useInnerText: true });
}

export async function confirmUrlDeletion(page: Page, name: string) {
  await deleteUrl(page).click();
  const modal = createWrapper().findModal();
  await expect(page.locator(modal.findContent().toSelector())).toContainText(name);
  const fn = encodeURIComponent(name);
  const urlPath = '/2021-10-31/functions/' + fn + '/url';
  const observeRead = async (path: string, status: number) => {
    const request = await page.waitForRequest(
      (request) => request.method() === 'GET' && new URL(request.url()).pathname === path,
    );
    const response = await request.response();
    if (!response) throw Error('Missing detail response for ' + path);
    expect(response.status()).toBe(status);
    expect(await response.finished()).toBeNull();
  };
  const rereads = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname === urlPath,
  ).then(() => Promise.all([observeRead('/2015-03-31/functions/' + fn, 200), observeRead(urlPath, 404)]));
  await Promise.all([rereads, submitDialog(page, 'Delete')]);
  await expect(page.locator(modal.toSelector())).toBeHidden();
}
