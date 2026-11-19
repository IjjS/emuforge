// What the checks of issue 535 share of IAM's screens (test-criteria.md of issue 535, Integration): the addresses of a
// role's page, its tabs and the policy screens, the Flashbar, a table's rows by its columns' headings, the reason an
// unavailable button gives, the confirmation typed in a dialog, and the IAM actions the page sent to the engine.
// Used by the `iam-role-*.spec.ts` and `iam-policy-*.spec.ts` checks of that issue. Nothing here holds a value of the
// emulator: names come from the check's prefix, everything else from a direct answer.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect, type Ctx } from '../../support/check';
import { ACTION } from '../../support/frame';

export const ROLES_PATH = '/aws/iam/roles';
export const POLICIES_PATH = '/aws/iam/policies';
export const CREATE_POLICY_PATH = '/aws/iam/policies/create';

/** S2: a role's page, its name as one path segment. */
export function rolePath(name: string): string {
  return `${ROLES_PATH}/details/${encodeURIComponent(name)}`;
}

/** S5: a policy's page, its ARN in the query. */
export function policyPath(arn: string): string {
  return `${POLICIES_PATH}/details?arn=${encodeURIComponent(arn)}`;
}

/** The path and query of the page's address. */
export function addressOf(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

/** The check's own prefix `<p>`: `efit<run id><tag>`, lower-case letters and digits only, as IAM's checks name. */
export function iamPrefix(ctx: Ctx, tag: string): string {
  return `efit${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')}${tag}`;
}

export const TYPE_CUSTOMER = 'Customer managed';
export const TYPE_AWS = 'AWS managed';
export const TYPE_INLINE = 'Customer inline';
export const DOCUMENT_FIELD = 'Policy document';
export const AWS_MANAGED_REASON = 'An AWS managed policy cannot be changed.';

const wrapper = createWrapper();
const FLASH_ITEMS = wrapper.findFlashbar().findItems().toSelector();

const collapsed = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The page's `h1` named `name`. */
export function h1(page: Page, name: string): Locator {
  return page.getByRole('main').getByRole('heading', { level: 1, name, exact: true });
}

/** The Flashbar items' texts, white space collapsed. */
export async function flashTexts(page: Page): Promise<string[]> {
  return (await page.locator(FLASH_ITEMS).allInnerTexts()).map(collapsed);
}

/** Waits until one Flashbar item holds every one of `parts`. */
export async function expectFlash(page: Page, parts: string[], message: string): Promise<void> {
  await expect
    .poll(async () => (await flashTexts(page)).some((text) => parts.every((part) => text.includes(part))), {
      message,
      timeout: 30_000,
    })
    .toBe(true);
}

/** The table labelled `name` inside the page's `main`. */
export function table(page: Page, name: string): Locator {
  return page.getByRole('main').getByRole('table', { name, exact: true });
}

/**
 * The rows of `tableLocator`, each as the texts of its cells under `headings`, in that order, white space collapsed;
 * `[]` when the table is not there or holds only its empty or loading state.
 */
export async function rowsOf(tableLocator: Locator, headings: string[]): Promise<string[][]> {
  if ((await tableLocator.count()) === 0) return [];
  return tableLocator.first().evaluate((el, wanted) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const found = el instanceof HTMLTableElement ? el : el.querySelector('table');
    if (!found || found.tBodies.length === 0) return [];
    const head = found.tHead?.rows[0];
    if (!head) return [];
    const names = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
    const at = wanted.map((w) => names.indexOf(w));
    if (at.some((i) => i < 0)) return [];
    return [...found.tBodies[0].rows]
      .filter((row) => row.cells.length > 1)
      .map((row) => at.map((i) => norm((row.cells[i] as HTMLElement | undefined)?.innerText ?? '')));
  }, headings);
}

/** The row of `tableLocator` whose row header is `name`. */
export function rowOf(tableLocator: Locator, name: string): Locator {
  return tableLocator
    .locator('tbody tr')
    .filter({ has: tableLocator.page().getByRole('rowheader', { name, exact: true }) });
}

/**
 * The reason an unavailable button gives: the text its `aria-describedby` names; `null` when the button is available
 * or names none.
 */
export async function unavailableReason(button: Locator): Promise<string | null> {
  await expect(button, 'the button is on the page').toHaveCount(1);
  return button.evaluate((el) => {
    const off = el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled;
    if (!off) return null;
    const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id !== '');
    const text = ids
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text === '' ? null : text;
  });
}

/** Whether `button` can be pressed. */
export async function isAvailable(button: Locator): Promise<boolean> {
  await expect(button, 'the button is on the page').toHaveCount(1);
  return button.evaluate((el) => !(el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled));
}

/** The dialog titled `title`. */
export function dialog(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title, exact: true });
}

/** The button `name` of `root`. */
export function button(root: Locator | Page, name: string): Locator {
  return root.getByRole('button', { name, exact: true });
}

/**
 * In the open dialog `title`: its `action` is unavailable until `delete` is typed; types it and presses `action`, then
 * waits for the dialog to close.
 */
export async function confirmByTyping(page: Page, title: string, action = 'Delete'): Promise<void> {
  const opened = dialog(page, title);
  await expect(opened, `the dialog "${title}"`).toBeVisible();
  expect(await isAvailable(button(opened, action)), `"${action}" before \`delete\` is typed`).toBe(false);
  await confirmField(opened).fill('delete', ACTION);
  await button(opened, action).click(ACTION);
  await expect(opened, `the dialog "${title}" closes once the emulator answered`).toHaveCount(0, { timeout: 30_000 });
}

/** The field a document is edited in, inside `root`, labelled `label`. */
export function documentField(root: Locator | Page, label = DOCUMENT_FIELD): Locator {
  return root.getByRole('textbox', { name: label, exact: true });
}

/** The IAM actions the page sent to the engine since `watchActions`, in order. */
export interface SeenActions {
  all: () => string[];
  /** How many requests of `action` left the page. */
  count: (action: string) => number;
}

/** Records the `Action` of every IAM request the page sends to the engine at `engineUrl` from now on. */
export function watchActions(page: Page, engineUrl: string): SeenActions {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().startsWith(engineUrl)) return;
    const action = new URLSearchParams(request.postData() ?? '').get('Action');
    if (action !== null) seen.push(action);
  });
  return { all: () => [...seen], count: (action) => seen.filter((a) => a === action).length };
}

/** Applies the filter `text` of the table on the page: typed, then Enter. */
export async function applyFilter(root: Locator | Page, text: string): Promise<void> {
  const filter = root.getByRole('searchbox', { name: 'Search items', exact: true });
  await filter.fill(text, ACTION);
  await filter.press('Enter', ACTION);
}

/** The text of the part of the page under the `h2` named `title`: the Cloudscape container around that heading. */
export function section(page: Page, title: string): Locator {
  const containers = wrapper.findContainer().toSelector();
  return page
    .locator(containers)
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
    .last();
}

/** The table titled `title` with its header's actions: the Cloudscape table around the `h2` named `title`. */
export function tablePart(page: Page, title: string): Locator {
  return page
    .locator(wrapper.findTable().toSelector())
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
    .last();
}

/** The button `name` among the actions beside the page's `h1`. */
export function headerButton(page: Page, name: string): Locator {
  return button(page.getByRole('main').locator('h1').locator('xpath=ancestor::*[.//button][1]'), name);
}

/** Opens S5 of `arn` and waits for the `h1` `name` and "Policy details". */
export async function openPolicy(page: Page, arn: string, name: string): Promise<void> {
  await page.goto(policyPath(arn));
  await expect(h1(page, name), `the policy's page with the h1 "${name}"`).toBeVisible();
  await expect(section(page, 'Policy details'), '"Policy details" once the policy is read').toBeVisible();
}

/** Waits until the part `root` shows the text `document` character for character. */
export async function expectDocument(root: Locator, document: string, message: string): Promise<void> {
  await expect.poll(async () => (await root.innerText()).includes(document), { message }).toBe(true);
}

/** The field of a confirmation dialog in which `delete` is typed: the dialog's one text field. */
export function confirmField(opened: Locator): Locator {
  return opened.getByRole('textbox');
}

export const TAB_PERMISSIONS = 'Permissions';
export const TAB_TRUST = 'Trust relationships';
export const PERMISSIONS_POLICIES = 'Permissions policies';
export const SERVICE_LINKED_REASON =
  "The emulator does not let a service-linked role's policies or trust policy be changed.";

/** The tab `name` of a role's page. */
export function tab(page: Page, name: string): Locator {
  return page.getByRole('main').getByRole('tab', { name, exact: true });
}

/** The name of the selected tab of a role's page; `null` when none is. */
export async function selectedTab(page: Page): Promise<string | null> {
  const selected = page.getByRole('main').getByRole('tab', { selected: true });
  return (await selected.count()) === 1 ? (await selected.innerText()).replace(/\s+/g, ' ').trim() : null;
}

/** Opens S2 of `role` (on its tab "Trust relationships" with `trust`) and waits until the role is read. */
export async function openRole(page: Page, role: string, trust = false): Promise<void> {
  await page.goto(`${rolePath(role)}${trust ? '?tab=trust' : ''}`);
  await expect(h1(page, role), `the role's page with the h1 "${role}"`).toBeVisible();
  await expect(tab(page, TAB_TRUST), 'the tabs once the role is read').toBeVisible();
}

/** The document a part of the page shows: the text of its one code element, as the page renders it. */
export async function shownDocument(root: Locator): Promise<string> {
  return root.locator('code').first().innerText();
}

/** Chooses the row `name` of the table `tableLocator` (its radio or check box). */
export async function chooseRow(tableLocator: Locator, name: string): Promise<void> {
  const row = rowOf(tableLocator, name);
  await row.locator('input[type="radio"], input[type="checkbox"]').first().check(ACTION);
}
