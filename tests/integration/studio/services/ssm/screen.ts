import createWrapper from "@cloudscape-design/components/test-utils/selectors";
import type { Locator, Page } from "@playwright/test";
import { expect } from "../../support/check";

export const ui = createWrapper();
export const list = "/aws/ssm";
export const detail = (name: string) =>
  list + "/parameters/detail?" + new URLSearchParams({ name });
export const button = (root: Locator | Page, name: string) =>
  root.getByRole("button", { name, exact: true });
export const field = (root: Locator | Page, name: string) =>
  root.getByRole("textbox", { name, exact: true });
export const modal = (page: Page) => page.locator(ui.findModal().toSelector());
export const success = (page: Page) =>
  page.locator(ui.findFlashbar().findItemsByType("success").toSelector());
export const rows = (page: Page) =>
  page.locator(ui.findTable().findRows().toSelector());
export const link = (page: Page, name: string) =>
  rows(page).getByRole("link", { name, exact: true });

export async function cell(page: Page, control: Locator, column: string) {
  const table = ui.findTable();
  const row = rows(page).filter({ has: control });
  await expect(row).toBeVisible();
  const rowIndex = await row.evaluate(
    (el) => (el as HTMLTableRowElement).sectionRowIndex + 1,
  );
  const grid = page.getByRole("table").filter({ has: control });
  const headers = page.locator(table.findColumnHeaders().toSelector()).and(grid.getByRole("columnheader"));
  const titles = (await headers.allTextContents()).map((label) => label.trim());
  const columnIndex = titles.indexOf(column) + 1;
  expect(columnIndex).toBeGreaterThan(0);
  await expect(headers.nth(columnIndex - 1)).toHaveText(column);
  return page
    .locator(table.findBodyCell(rowIndex, columnIndex).toSelector())
    .and(row.getByRole("cell").or(row.getByRole("rowheader")));
}

export async function missing(page: Page, name: string) {
  await expect(
    page.getByText("Parameter " + name + " was not found.", { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByRole("link", { name: "Back to Parameter Store" }),
  ).toHaveAttribute("href", list);
}

export async function expectPair(page: Page, index: number, label: string, value: string) {
  const pair = ui.findKeyValuePairs().findItems().get(index);
  await expect(page.locator(pair.findLabel().toSelector())).toHaveText(label);
  await expect(page.locator(pair.findValue().toSelector())).toHaveText(value);
}
