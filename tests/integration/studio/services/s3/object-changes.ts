import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, startStack, type Ctx } from '../../support';
import { ACTION } from '../../support/frame';
import { checkPrefix } from '../../support/service-screens';
import { objectPath, s3Direct, Seeded } from './s3';
import { getObjectDirect, headObjectDirect, objectAddress } from './s3-object-page';

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

export async function openSource(page: Page, bucket: string) {
  await page.goto(objectAddress(bucket, sourceKey));
  await expect(page.getByRole('button', { name: 'Actions', exact: true })).toBeVisible(ACTION);
}

export async function openChange(page: Page, action: 'copy' | 'rename' | 'edit') {
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.locator(wrapper.findButtonDropdown().findItemById(action).toSelector()).click();
  const modal = page.locator(wrapper.findModal().toSelector());
  await expect(modal).toBeVisible(ACTION);
  return modal;
}

export function metadataInput(page: Page, row: number, column: number) {
  const field = wrapper.findAttributeEditor().findRow(row).findField(column);
  return page.locator(field.findControl().findInput().findNativeInput().toSelector());
}

export function changeAlert(page: Page) {
  const modal = page.locator(wrapper.findModal().toSelector());
  return modal.locator(wrapper.findAlert().toSelector().replace(/^body /, ''));
}

export const successItems = wrapper.findFlashbar().findItemsByType('success');
