import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
import { expect } from '../../support/check';
import { creationDateText, SEOUL } from '../../support/service-screens';

export const ui = createWrapper();
export const list = '/aws/kms';
export const detail = (id: string) => list + '/keys/' + id;
export const dateText = (date: Date) => creationDateText(date.toISOString(), SEOUL);
export const button = (root: Page | Locator, name: string) => root.getByRole('button', { name, exact: true });
const table = ui.findTable();

function tableRoot(page: Page, title: string) {
  return page.locator(table.toSelector()).filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

function tableSlot(page: Page, title: string, selector: string) {
  return tableRoot(page, title).locator(selector.slice(table.toSelector().length).trim());
}

export const keyLink = (page: Page, id: string) =>
  tableSlot(page, 'Customer managed keys', table.findRows().toSelector()).getByRole('link', { name: id, exact: true });
export const empty = (page: Page) => tableSlot(page, 'Customer managed keys', table.findEmptySlot().toSelector());

export async function expectTableRows(page: Page, title: string, columns: number[], expected: string[][]) {
  const rows = tableSlot(page, title, table.findRows().toSelector());
  await expect(rows).toHaveCount(expected.length);
  for (let i = 0; i < expected.length; i++) {
    for (const [j, column] of columns.entries()) {
      const cell = tableSlot(page, title, table.findBodyCell(i + 1, column).toSelector());
      await expect(cell).toHaveText(expected[i]![j]!);
    }
  }
}

export async function expectEmptyTable(page: Page, title: string, message: string) {
  await expect(tableSlot(page, title, table.findEmptySlot().toSelector())).toHaveText(message);
  await expect(tableSlot(page, title, table.findRows().toSelector())).toHaveCount(0);
}

export async function expectListedAlias(page: Page, id: string, alias: string) {
  const row = tableSlot(page, 'Customer managed keys', table.findRows().toSelector())
    .filter({ has: page.getByRole('link', { name: id, exact: true }) });
  await expect(row).toBeVisible();
  const index = await row.evaluate(node => (node as HTMLTableRowElement).sectionRowIndex + 1);
  await expect(tableSlot(page, 'Customer managed keys', table.findBodyCell(index, 2).toSelector())).toHaveText(id);
  await expect(tableSlot(page, 'Customer managed keys', table.findBodyCell(index, 3).toSelector())).toHaveText(alias);
}
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
  await expect(page.locator(ui.findFlashbar().findItemsByType('success').toSelector())).toHaveText([message]);
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
