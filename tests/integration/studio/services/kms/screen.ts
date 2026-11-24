import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
import { expect } from '../../support/check';
import { creationDateText, SEOUL } from '../../support/service-screens';

export const ui = createWrapper();
export const list = '/aws/kms';
export const detail = (id: string) => list + '/keys/' + id;
export const dateText = (date: Date) => creationDateText(date.toISOString(), SEOUL);
export const button = (root: Page | Locator, name: string) => root.getByRole('button', { name, exact: true });
export const rows = (page: Page) => page.locator(ui.findTable().findRows().toSelector());
export const rowWith = (page: Page, name: string) => rows(page).filter({ has: page.getByText(name, { exact: true }) });
export const keyLink = (page: Page, id: string) => rows(page).getByRole('link', { name: id, exact: true });
export const empty = (page: Page) => page.locator(ui.findTable().findEmptySlot().toSelector());
export const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
export const modal = (page: Page) => page.locator(ui.findModal().toSelector());
export const content = (page: Page) => page.locator(ui.findModal().findContent().toSelector());
export const footer = (page: Page) => page.locator(ui.findModal().findFooter().toSelector());
export const field = (page: Page, name: string) => content(page).getByRole('textbox', { name, exact: true });
export async function openModal(page: Page, action: string, title = action) {
  await button(page, action).click();
  await expect(page.locator(ui.findModal().findHeader().toSelector())).toHaveText(title);
}
export async function flash(page: Page, message: string) {
  await expect(page.locator(ui.findFlashbar().findItemsByType('success').toSelector())).toContainText(message);
}
export async function submit(page: Page, action: string, message: string) {
  await button(footer(page), action).click();
  await expect(modal(page)).toBeHidden();
  await flash(page, message);
}
export async function openTab(page: Page, id: string, name: string) {
  await page.goto(detail(id));
  await tab(page, name).click();
}
