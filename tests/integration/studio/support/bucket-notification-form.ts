import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { expect } from './check';

export const wrappers = createWrapper();
export const properties = (bucket: string) => '/aws/s3/buckets/' + bucket + '/properties';
export const nameField = (page: Page) => page.getByRole('textbox', { name: 'Notification name' });
export const createLink = (page: Page) => page.getByRole('link', { name: 'Create event notification' });
export const submitCreate = (page: Page) => page.getByRole('button', { name: 'Create event notification' });
export const success = (page: Page) => page.locator(wrappers.findFlashbar().findItemsByType('success').toSelector());

export async function openCreate(page: Page, bucket: string) {
  await page.goto(properties(bucket));
  await createLink(page).click();
  await expect(nameField(page)).toBeVisible();
}

export async function fillRule(
  page: Page,
  id: string,
  arn: string,
  type: 'SQS queue' | 'Lambda function',
  event: string,
) {
  await nameField(page).fill(id);
  const radio = (value: string) => page.locator(wrappers.findRadioGroup().findInputByValue(value).toSelector());
  await radio(type).check();
  await page.getByRole('textbox', { name: 'Destination ARN' }).fill(arn);
  await radio(event).check();
}
