// Deleting objects and folders (issue 480, task 4) from the Objects tab and an object's page, in the built app served
// by `bun run serve`, in front of a real engine and the run's emulator (test-criteria.md, Integration).
//
// `studio.s3-delete-objects-and-folders`, `studio.s3-delete-in-a-versioned-bucket-keeps-versions`,
// `studio.s3-delete-says-when-the-bucket-is-gone`.
//
// "The test's client" is the check's own signed requests to the emulator. Every bucket carries the check's prefix
// `<p>`. Words, readers and direct calls of the dialog and the page: `services/s3/s3-object-page.ts`; of the Objects
// tab: `services/s3/s3-objects.ts`; `Seeded`, `objectKeysDirect`, `objectVersionsDirect`: `services/s3/s3.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import { objectKeysDirect, objectVersionsDirect, Seeded } from './services/s3/s3';
import { flashTexts, openObjectsTab } from './services/s3/s3-bucket-page';
import {
  CONFIRM_WORD,
  deleteDialog,
  deleteObjectsRefusalDirect,
  deletedText,
  deleteObjectDirect,
  dialogText,
  objectAddress,
  objectPage,
  OVERVIEW,
  rowCheckbox,
  VERSIONED_SENTENCE,
} from './services/s3/s3-object-page';
import { expectKeys, objectsAddress, objectsTab } from './services/s3/s3-objects';

test('studio.s3-delete-objects-and-folders', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'delete-objects');
  const name = `${p}-del`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  for (const key of ['keep.txt', 'a.txt', 'tmp/1.txt', 'tmp/2.txt']) await seeded.object(name, key, `body of ${key}`);
  const dialog = deleteDialog(page);

  await lines.line(
    'Select `a.txt` and `tmp/`, "Delete" → the dialog reads "Delete 1 object and 1 folder?"; "Delete" is unavailable until `delete` is typed; then → "Deleted 3 objects." and only `keep.txt` is a row; the emulator holds only `keep.txt`',
    async () => {
      await openObjectsTab(page, name);
      await expectKeys(page, ['tmp/', 'a.txt', 'keep.txt'], 'the rows at the root');
      await rowCheckbox(page, 'a.txt').check(ACTION);
      await rowCheckbox(page, 'tmp/').check(ACTION);
      await objectsTab(page).table.getByRole('button', { name: 'Delete', exact: true }).click(ACTION);
      await expect(dialog.dialog.getByText('Delete 1 object and 1 folder?', { exact: true })).toBeVisible(ACTION);
      await expect(dialog.delete, '"Delete" before the word is typed').toBeDisabled();
      await dialog.confirm.fill('delet');
      await expect(dialog.delete, '"Delete" with "delet" typed').toBeDisabled();
      await dialog.confirm.fill(CONFIRM_WORD);
      await expect(dialog.delete, '"Delete" with "delete" typed').toBeEnabled();
      await dialog.delete.click(ACTION);
      await expect.poll(() => flashTexts(page), { message: 'the flash', ...ACTION }).toContain(deletedText(3));
      await expectKeys(page, ['keep.txt'], 'the rows after the deletion');
      expect(await objectKeysDirect(ctx, port, name), `a direct ListObjectsV2 of ${name}`).toEqual(['keep.txt']);
    },
  );

  await lines.line(
    'Open `keep.txt`\'s page, "Delete", type `delete` → back on the Objects tab at the root, empty; the emulator holds no key',
    async () => {
      await page.goto(objectAddress(name, 'keep.txt'));
      await expect(objectPage(page).section(OVERVIEW), `"${OVERVIEW}"`).toBeVisible(ACTION);
      await objectPage(page).delete.click(ACTION);
      await dialog.confirm.fill(CONFIRM_WORD);
      await dialog.delete.click(ACTION);
      await expect(page).toHaveURL(addressOf(objectsAddress(name)));
      await expect(objectsTab(page).table.getByText('No objects', { exact: true })).toBeVisible(ACTION);
      await expectKeys(page, [], 'no row');
      expect(await objectKeysDirect(ctx, port, name), `a direct ListObjectsV2 of ${name}`).toEqual([]);
    },
  );

  lines.end();
});

test('studio.s3-delete-in-a-versioned-bucket-keeps-versions', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'delete-versioned');
  const name = `${p}-ver`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await seeded.configure(name, { versioning: 'Enabled' });
  const version = await seeded.object(name, 'v.txt', 'kept as a version');
  const dialog = deleteDialog(page);

  await lines.line(
    "Delete `v.txt` from the Objects tab → the dialog says a delete marker is added and the versions are kept; afterwards the tab has no row and `ListObjectVersions` reports `v.txt`'s version and a delete marker",
    async () => {
      await openObjectsTab(page, name);
      await expectKeys(page, ['v.txt'], 'the rows');
      await rowCheckbox(page, 'v.txt').check(ACTION);
      await objectsTab(page).table.getByRole('button', { name: 'Delete', exact: true }).click(ACTION);
      await expect.poll(() => dialogText(page), { message: 'the dialog', ...ACTION }).toContain(VERSIONED_SENTENCE);
      await dialog.confirm.fill(CONFIRM_WORD);
      await dialog.delete.click(ACTION);
      await expect.poll(() => flashTexts(page), { message: 'the flash', ...ACTION }).toContain(deletedText(1));
      await expectKeys(page, [], 'no row after the deletion');
      const items = await objectVersionsDirect(ctx, port, name);
      ctx.log(`direct ListObjectVersions: ${JSON.stringify(items)}`);
      expect(
        (items ?? []).map((i) => [i.kind, i.key, i.kind === 'version' ? i.versionId : 'marker']).sort(),
        `a direct ListObjectVersions of ${name}`,
      ).toEqual(
        [
          ['delete-marker', 'v.txt', 'marker'],
          ['version', 'v.txt', version ?? 'null'],
        ].sort(),
      );
    },
  );

  lines.end();
});

test('studio.s3-delete-says-when-the-bucket-is-gone', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'delete-gone');
  const name = `${p}-dg`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await seeded.object(name, 'a.txt', 'gone before the delete');
  const dialog = deleteDialog(page);

  await lines.line(
    'Select `a.txt`, "Delete", type `delete`; with the test\'s client delete `a.txt` and then the bucket; then confirm → the dialog shows the emulator\'s message that the bucket does not exist and that 0 objects were deleted',
    async () => {
      await openObjectsTab(page, name);
      await expectKeys(page, ['a.txt'], 'the rows');
      await rowCheckbox(page, 'a.txt').check(ACTION);
      await objectsTab(page).table.getByRole('button', { name: 'Delete', exact: true }).click(ACTION);
      await dialog.confirm.fill(CONFIRM_WORD);
      await deleteObjectDirect(ctx, port, name, 'a.txt');
      await seeded.remove(name);
      const message = await deleteObjectsRefusalDirect(ctx, port, name, 'a.txt');
      ctx.log(`direct DeleteObjects refused: ${message}`);
      await dialog.delete.click(ACTION);
      await expect.poll(() => dialogText(page), { message: 'the dialog', ...ACTION }).toContain(message);
      expect(await dialogText(page), 'the count deleted').toContain('Deleted 0 objects before the failure.');
    },
  );

  lines.end();
});
