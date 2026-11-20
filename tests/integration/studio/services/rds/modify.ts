import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect } from '../../support/check';
import { ACTION } from '../../support/frame';
import { dialogOf, instancePath } from './rds';

export async function openModify(page: Page, id: string) {
  await page.goto(instancePath(id));
  const wrapper = createWrapper();
  const modify = page.locator(wrapper.findButton('#rds-modify-instance').toSelector());
  await modify.click(ACTION);
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  const input = (field: string) =>
    page.locator(createWrapper(`#rds-modify-field-${field}`).findInput().findNativeInput().toSelector());
  return {
    dialog,
    identifier: input('identifier'),
    instanceClass: input('class'),
    storage: input('storage'),
    password: input('password'),
    protection: page.locator(wrapper.findModal().findCheckbox().findNativeInput().toSelector()),
    save: page.locator(wrapper.findButton('#rds-modify-save').toSelector()),
    cancel: page.locator(wrapper.findButton('#rds-modify-cancel').toSelector()),
    failure: page.locator(wrapper.findModal().findAlert().findContent().toSelector()),
    clusterGuidance: dialog.locator('#rds-modify-cluster-guidance'),
  };
}
