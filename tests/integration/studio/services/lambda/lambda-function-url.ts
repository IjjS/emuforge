import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, type Ctx } from '../../support';
import { checkPrefix } from '../../support/service-screens';
import { getFunctionDirect, lambdaDirect, LambdaSeeded } from './lambda';
import { functionPath } from './lambda-list';
import { FUNCTION_URL, OVERVIEW, pairValue } from './lambda-page';
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

export const createUrl = (page: Page) => page.getByRole('button', { name: 'Create function URL' });
export const deleteUrl = (page: Page) => page.getByRole('button', { name: 'Delete function URL' });

export async function expectOverviewUrl(page: Page, url: string) {
  await expect.poll(() => pairValue(page, OVERVIEW, FUNCTION_URL)).toBe(url);
}

export async function confirmUrlDeletion(page: Page, name: string) {
  await deleteUrl(page).click();
  const modal = createWrapper().findModal();
  await expect(page.locator(modal.findContent().toSelector())).toContainText(name);
  await submitDialog(page, 'Delete');
  await expect(page.locator(modal.toSelector())).toBeHidden();
}
