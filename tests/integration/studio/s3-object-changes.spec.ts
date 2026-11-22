import { expect, test } from './support';
import { ACTION, addressOf } from './support/frame';
import {
  changeAlert,
  metadataInput,
  openChange,
  openSource,
  seedSource,
  sourceBody,
  sourceKey,
  successItems,
  verifyObject,
} from './services/s3/object-changes';
import { expectFlash } from './services/s3/s3-bucket-actions';
import {
  deleteObjectDirect,
  entryRows,
  getObjectDirect,
  headObjectDirect,
  objectAddress,
  OVERVIEW,
  sectionPairs,
  USER_METADATA,
} from './services/s3/s3-object-page';
import { listObjectsDirect } from './services/s3/s3-objects';

test('studio.s3-copy-object-to-another-bucket', async ({ ctx, page }) => {
  const { seeded, bucket, port } = await seedSource(ctx, 'copy499');
  const destination = bucket + '-to';
  const key = 'copied settings.txt';
  await seeded.bucket(destination);
  await seeded.object(destination, key, 'previous');
  await openSource(page, bucket);
  async function confirmCopy() {
    const modal = await openChange(page, 'copy');
    await modal.getByRole('textbox', { name: 'Destination bucket' }).fill(destination);
    await modal.getByRole('textbox', { name: 'Destination key' }).fill(key);
    await modal.getByRole('button', { name: 'Copy object' }).click();
    await expect(modal.getByRole('textbox', { name: 'Enter destination key to confirm' })).toBeVisible();
    return modal;
  }
  const cancelled = await confirmCopy();
  await cancelled.getByRole('button', { name: 'Cancel' }).click();
  await expect(cancelled).toBeHidden();
  expect(await getObjectDirect(ctx, port, bucket, sourceKey)).toEqual(Buffer.from(sourceBody));
  expect(await getObjectDirect(ctx, port, destination, key)).toEqual(Buffer.from('previous'));
  const modal = await confirmCopy();
  await modal.getByRole('textbox', { name: 'Enter destination key to confirm' }).fill(key);
  await modal.getByRole('button', { name: 'Replace object' }).click();
  await expect(page).toHaveURL(addressOf(objectAddress(destination, key)));
  await expectFlash(page, 'success', 'Object copied.');
  await expect.poll(() => sectionPairs(page, OVERVIEW), ACTION).toMatchObject({ Key: key });
  await verifyObject(ctx, port, bucket, sourceKey);
  await verifyObject(ctx, port, destination, key);
});

test('studio.s3-rename-object-to-another-key', async ({ ctx, page }) => {
  const { bucket, port } = await seedSource(ctx, 'rename499');
  const key = 'next.txt';
  await openSource(page, bucket);
  async function confirmRename() {
    const modal = await openChange(page, 'rename');
    await modal.getByRole('textbox', { name: 'New key' }).fill(key);
    await modal.getByRole('button', { name: 'Rename object' }).click();
    await expect(modal.getByRole('textbox', { name: 'Enter original key to confirm' })).toBeVisible();
    return modal;
  }
  const cancelled = await confirmRename();
  await cancelled.getByRole('button', { name: 'Cancel' }).click();
  await expect(cancelled).toBeHidden();
  const keys = async () => (await listObjectsDirect(ctx, port, bucket)).objects.map((item) => item.key);
  expect(await keys()).toEqual([sourceKey]);
  const modal = await confirmRename();
  await modal.getByRole('textbox', { name: 'Enter original key to confirm' }).fill(sourceKey);
  await modal.getByRole('button', { name: 'Rename object' }).click();
  await expect(page).toHaveURL(addressOf(objectAddress(bucket, key)));
  await expectFlash(page, 'success', 'Object renamed.');
  await expect.poll(() => sectionPairs(page, OVERVIEW), ACTION).toMatchObject({ Key: key });
  expect(await keys()).toEqual([key]);
  await verifyObject(ctx, port, bucket, key);
});

test('studio.s3-edit-object-properties-in-place', async ({ ctx, page }) => {
  const headers = {
    'cache-control': 'no-cache',
    'content-encoding': 'identity',
    'content-disposition': 'inline',
    'content-language': 'en',
    expires: 'Tue, 01 Jan 2030 00:00:00 GMT',
    'x-amz-website-redirect-location': '/home',
  };
  const { bucket, port } = await seedSource(ctx, 'edit499', { ...headers, 'x-amz-meta-drop': 'old' });
  const before = await headObjectDirect(ctx, port, bucket, sourceKey);
  expect(before).toMatchObject(headers);
  await openSource(page, bucket);
  let modal = await openChange(page, 'edit');
  await modal.getByRole('button', { name: 'Remove metadata drop' }).click();
  await metadataInput(page, 1, 2).fill('qa');
  await modal.getByRole('button', { name: 'Add metadata' }).click();
  await metadataInput(page, 2, 1).fill('purpose');
  await metadataInput(page, 2, 2).fill('test');
  async function save(type: string) {
    await modal.getByRole('button', { name: 'Save changes' }).click();
    await expect(modal).toBeHidden();
    await expectFlash(page, 'success', 'Object properties updated.');
    await expect
      .poll(() => sectionPairs(page, OVERVIEW), ACTION)
      .toMatchObject({ Key: sourceKey, 'Content type': type });
    await expect
      .poll(() => entryRows(page, USER_METADATA), ACTION)
      .toEqual([
        ['owner', 'qa'],
        ['purpose', 'test'],
      ]);
    const head = await verifyObject(ctx, port, bucket, sourceKey, type, { owner: 'qa', purpose: 'test' });
    expect(head).toMatchObject(headers);
  }
  await save('text/plain');
  await page.locator(successItems.get(1).findDismissButton().toSelector()).click();
  await expect(page.locator(successItems.toSelector())).toHaveCount(0);
  modal = await openChange(page, 'edit');
  await modal.getByRole('textbox', { name: 'Content type' }).fill('text/markdown');
  await save('text/markdown');
});

test('studio.s3-copy-object-bucket-limit', async ({ ctx, page }) => {
  const { bucket, port, seeded } = await seedSource(ctx, 'quota499');
  const destination = bucket + '-full';
  const key = 'extra';
  await seeded.bucket(destination);
  await seeded.objects(
    destination,
    Array.from({ length: 1000 }, (_, n) => 'item-' + n),
    '',
  );
  await openSource(page, bucket);
  const modal = await openChange(page, 'copy');
  await modal.getByRole('textbox', { name: 'Destination bucket' }).fill(destination);
  await modal.getByRole('textbox', { name: 'Destination key' }).fill(key);
  await modal.getByRole('button', { name: 'Copy object' }).click();
  await expect(changeAlert(page)).toContainText('ValidationException');
  await expect(changeAlert(page)).toContainText(
    `the bucket "${destination}" already holds the maximum of 1000 objects this emulator keeps per bucket; delete an object before copying "${key}" into it`,
  );
  expect(await getObjectDirect(ctx, port, bucket, sourceKey)).toEqual(Buffer.from(sourceBody));
  expect((await listObjectsDirect(ctx, port, destination, key)).objects).toEqual([]);
});

test('studio.s3-edit-object-after-source-removed', async ({ ctx, page }) => {
  const { bucket, port } = await seedSource(ctx, 'gone499');
  await openSource(page, bucket);
  const modal = await openChange(page, 'edit');
  await modal.getByRole('textbox', { name: 'Content type' }).fill('application/json');
  await deleteObjectDirect(ctx, port, bucket, sourceKey);
  await modal.getByRole('button', { name: 'Save changes' }).click();
  await expect(changeAlert(page)).toContainText('NoSuchKey');
  await expect(changeAlert(page)).toContainText('The specified key does not exist.');
  await expect(page.locator(successItems.toSelector())).toHaveCount(0);
  expect((await listObjectsDirect(ctx, port, bucket)).objects).toEqual([]);
});
