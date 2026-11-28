import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect } from '../../support/check';
import { ACTION } from '../../support/frame';
import { chooseOption, dialogOf } from './rds';

export async function openModify(page: Page) {
  const wrapper = createWrapper();
  const modify = page.locator(wrapper.findButton('#rds-modify-instance').toSelector());
  await modify.click(ACTION);
  const modal = createWrapper(wrapper.findModal().toSelector());
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  const input = (field: string) =>
    page.locator(createWrapper(`#rds-modify-field-${field}`).findInput().findNativeInput().toSelector());
  const instanceClass = page.locator('#rds-modify-field-class');
  return {
    dialog,
    identifier: input('identifier'),
    /** The field "DB instance class", a choice of the emulator's orderable classes (issue 651). */
    instanceClass,
    /** Chooses the class by its value. */
    chooseClass: (value: string) => chooseOption(instanceClass, value),
    storage: input('storage'),
    password: input('password'),
    // A toggle since issue 651; the standalone dialog has "Multi-AZ" beside it.
    protection: dialog.getByRole('checkbox', { name: 'Deletion protection', exact: true }),
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
