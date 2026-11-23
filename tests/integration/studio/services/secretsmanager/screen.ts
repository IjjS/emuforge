import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
import { expect } from '../../support/check';

export const listPath = '/aws/secretsmanager/secrets';
export const detailPath = (name: string) => listPath + '/detail?name=' + encodeURIComponent(name);
export const ui = createWrapper();

export function button(root: Page | Locator, name: string) {
  return root.getByRole('button', { name, exact: true });
}

export function textbox(root: Page | Locator, name: string) {
  return root.getByRole('textbox', { name, exact: true });
}

export function modal(page: Page) {
  return page.locator(ui.findModal().toSelector());
}

export function success(page: Page) {
  return page.locator(ui.findFlashbar().findItemsByType('success').toSelector());
}

export async function submit(page: Page, action: string) {
  await button(modal(page), action).click();
  await expect(modal(page)).toBeHidden();
  await expect(success(page)).toBeVisible();
}

export function secretLink(page: Page, name: string) {
  return page.locator(ui.findTable().findRows().toSelector()).getByRole('link', { name, exact: true });
}

export async function detail(page: Page, name: string) {
  await page.goto(detailPath(name));
  await expect(button(page, 'Retrieve secret value')).toBeEnabled();
}

export function valueRequests(page: Page) {
  const operations: string[] = [];
  page.on('request', (request) => {
    const target = request.headers()['x-amz-target']?.split('.').at(-1);
    if (target === 'GetSecretValue' || target === 'BatchGetSecretValue') operations.push(target);
  });
  return operations;
}

export const secretValue = (page: Page) =>
  page.locator(ui.findContainer().toSelector()).filter({ has: button(page, 'Hide secret value') });

export async function openSection(page: Page, name: string) {
  const toggle = button(page, name);
  await toggle.click();
  return page.locator(ui.findExpandableSection().toSelector()).filter({ has: toggle });
}

export const versionRadio = (page: Page, id: string) =>
  page
    .locator(ui.findTable().findRows().toSelector())
    .getByRole('radio', { name: 'Select version ' + id, exact: true });

export function versionRow(page: Page, id: string) {
  return page.locator(ui.findTable().findRows().toSelector()).filter({
    has: page.getByRole('radio', { name: 'Select version ' + id, exact: true }),
  });
}

export async function chooseStage(page: Page, kind: 'add' | 'move' | 'remove', version: string, label: string) {
  await versionRadio(page, version).check();
  await button(page, 'Manage staging labels').click();
  await page.locator(ui.findButtonDropdown().findItemById(kind).toSelector()).click();
  if (kind === 'add') await textbox(modal(page), 'Staging label').fill(label);
  else {
    await modal(page)
      .locator(
        ui
          .findSelect()
          .findTrigger()
          .toSelector()
          .replace(/^body /, ''),
      )
      .click();
    await page.locator(ui.findSelect().findDropdown().findOptionByValue(label).toSelector()).click();
  }
  const title = { add: 'Add staging label', move: 'Move staging label', remove: 'Remove staging label' }[kind];
  await submit(page, title);
}
