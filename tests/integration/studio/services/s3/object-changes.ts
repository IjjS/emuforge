import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, startStack, type Ctx } from '../../support';
import { ACTION } from '../../support/frame';
import { checkPrefix } from '../../support/service-screens';
import { objectPath, s3Direct, Seeded } from './s3';
import { getObjectDirect, headObjectDirect, objectAddress, OVERVIEW, USER_METADATA } from './s3-object-page';

const wrapper = createWrapper();
export const sourceKey = 'settings.txt';
export const sourceBody = 'local fixture\n';

export async function seedSource(ctx: Ctx, tag: string, headers: Record<string, string> = {}) {
  const { emulatorPort: port } = await startStack(ctx);
  const seeded = new Seeded(ctx, port);
  const bucket = checkPrefix(ctx, tag);
  await seeded.bucket(bucket);
  const result = await s3Direct(ctx, port, {
    method: 'PUT',
    pathname: objectPath(bucket, sourceKey),
    body: sourceBody,
    headers: { 'content-type': 'text/plain', 'x-amz-meta-owner': 'dev', 'x-amz-tagging': 'stage=local', ...headers },
  });
  expect('error' in result ? result.error : result.status).toBe(200);
  return { seeded, bucket, port };
}

export async function verifyObject(
  ctx: Ctx,
  port: number,
  bucket: string,
  key: string,
  type = 'text/plain',
  metadata: Record<string, string> = { owner: 'dev' },
) {
  const head = await headObjectDirect(ctx, port, bucket, key);
  expect(head['content-type']).toBe(type);
  const entries = Object.entries(head).filter(([name]) => name.startsWith('x-amz-meta-'));
  expect(Object.fromEntries(entries.map(([name, value]) => [name.slice(11), value]))).toEqual(metadata);
  expect(await getObjectDirect(ctx, port, bucket, key)).toEqual(Buffer.from(sourceBody));
  const tags = await s3Direct(ctx, port, {
    method: 'GET',
    pathname: objectPath(bucket, key),
    query: [['tagging', '']],
  });
  expect('error' in tags ? tags.error : tags.status).toBe(200);
  if ('error' in tags) throw new Error(tags.error);
  expect(tags.body.match(/<Tag>/g)).toHaveLength(1);
  expect(tags.body).toMatch(/<Key>stage<\/Key>\s*<Value>local<\/Value>/);
  return head;
}

function relative(selector: { toSelector(): string }) {
  return selector.toSelector().replace(/^body /, '');
}

function heading(page: Page, title: string) {
  return page.locator(relative(wrapper.findHeader().findHeadingText())).filter({ hasText: title });
}

function actionsTrigger(page: Page) {
  return page
    .locator(wrapper.findHeader().findActions().toSelector())
    .locator(relative(wrapper.findButtonDropdown().findTriggerButton()));
}

export async function overviewValues(page: Page) {
  const container = page.locator(wrapper.findContainer().toSelector()).filter({ has: heading(page, OVERVIEW) });
  const items = wrapper.findKeyValuePairs().findItems();
  const count = await container.locator(relative(items)).count();
  const values: Record<string, string> = {};
  for (let index = 1; index <= count; index++) {
    const item = items.get(index);
    const label = await container.locator(relative(item.findLabel())).innerText(ACTION);
    values[label.trim()] = (await container.locator(relative(item.findValue())).innerText(ACTION)).trim();
  }
  return values;
}

export async function metadataRows(page: Page) {
  const table = wrapper.findTable();
  const section = page.locator(table.toSelector()).filter({ has: heading(page, USER_METADATA) });
  // The table locator already selects the wrapper's root.
  const withinTable = (selector: { toSelector(): string }) =>
    section.locator(':scope' + selector.toSelector().slice(table.toSelector().length));
  const count = await withinTable(table.findRows()).count();
  const rows: string[][] = [];
  for (let index = 1; index <= count; index++) {
    const key = await withinTable(table.findBodyCell(index, 1)).innerText(ACTION);
    const value = await withinTable(table.findBodyCell(index, 2)).innerText(ACTION);
    rows.push([key.trim(), value.trim()]);
  }
  return rows;
}

export async function openSource(page: Page, bucket: string) {
  await page.goto(objectAddress(bucket, sourceKey));
  await expect(actionsTrigger(page)).toBeVisible(ACTION);
}

export async function openChange(page: Page, action: 'copy' | 'rename' | 'edit') {
  await actionsTrigger(page).click();
  await page.locator(wrapper.findButtonDropdown().findItemById(action).toSelector()).click();
  const modal = page.locator(wrapper.findModal().toSelector());
  await expect(modal).toBeVisible(ACTION);
  return modal;
}

export const metadataEditor = wrapper.findAttributeEditor();

export function metadataInput(page: Page, row: number, column: number) {
  const field = metadataEditor.findRow(row).findField(column);
  return page.locator(field.findControl().findInput().findNativeInput().toSelector());
}

export function changeAlert(page: Page) {
  const modal = page.locator(wrapper.findModal().toSelector());
  return modal.locator(
    wrapper
      .findAlert()
      .toSelector()
      .replace(/^body /, ''),
  );
}

export const successItems = wrapper.findFlashbar().findItemsByType('success');
