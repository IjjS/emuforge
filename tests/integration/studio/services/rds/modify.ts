import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect } from '../../support/check';
import { ACTION } from '../../support/frame';
import { dialogOf } from './rds';

export async function openModify(page: Page) {
  const wrapper = createWrapper();
  const modify = page.locator(wrapper.findButton('#rds-modify-instance').toSelector());
  await modify.click(ACTION);
  const modal = createWrapper(wrapper.findModal().toSelector());
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
    protection: page.locator(modal.findCheckbox().findNativeInput().toSelector()),
    save: page.locator(wrapper.findButton('#rds-modify-save').toSelector()),
    cancel: page.locator(wrapper.findButton('#rds-modify-cancel').toSelector()),
    failure: page.locator(modal.findAlert().findContent().toSelector()),
    clusterGuidance: dialog.locator('#rds-modify-cluster-guidance'),
  };
}

/** The acceptance message shown after a successful save, including a rename. */
export async function expectModifyResult(page: Page, id: string) {
  const items = createWrapper().findFlashbar().findItemsByType('success');
  const visible = page.locator(items.toSelector()).filter({ visible: true });
  await expect(visible).toBeVisible();
  await expect(visible).toContainText(`Modifying ${id}.`);
}
