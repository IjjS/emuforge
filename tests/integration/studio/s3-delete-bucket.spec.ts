// "Delete bucket" in the built app served by `bun run serve`, in front of a real engine started for that Studio and
// the run's emulator (test-criteria.md, issue 256, Flow checks; requirement R7, R9.5): an empty bucket is deleted once
// its name is typed, "Cancel" deletes nothing, and a bucket that holds anything is not deleted.
//
// `studio.s3-delete-bucket-removes-the-bucket`, `studio.s3-delete-bucket-refuses-a-bucket-that-is-not-empty`.
//
// Each check names its buckets with its own prefix `<p>` and reads them back directly by name; every bucket is made
// by `Seeded`, so whatever the page did, it is emptied and removed when the check ends. Words and readers:
// `support/s3-bucket-actions.ts`; direct calls and `Seeded`: `support/s3.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, emulatorLine, endpointPattern, expectLine } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  BUCKETS_PATH,
  bucketNamesDirect,
  DELETE,
  deleteObjectDirect,
  expectNames,
  filterFor,
  H1,
  objectKeysDirect,
  objectVersionsDirect,
  openList,
  screen,
  Seeded,
  shownDirect,
} from './services/s3/s3';
import {
  DELETE_H1,
  deletedItem,
  deletePage,
  deletePath,
  deleteSentence,
  EMPTY_H1,
  emptyPath,
  expectFlash,
  expectPageShows,
  NOT_EMPTY,
  NOT_EMPTY_TEXT,
  openDeletePage,
} from './services/s3/s3-bucket-actions';

/** Waits for the bucket list. */
async function expectList(page: Page): Promise<void> {
  await expect(page).toHaveURL(addressOf(BUCKETS_PATH));
  await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
}

/** Waits for the delete page of a bucket that holds nothing: its field shown, no alert. */
async function expectEmptyBucketForm(page: Page): Promise<void> {
  const d = deletePage(page);
  await expect(d.field, 'the confirmation field').toBeVisible();
  await expect(d.alert, `the alert "${NOT_EMPTY}"`).toHaveCount(0);
}

/** Waits for the alert "This bucket is not empty" with its text, the field and "Delete bucket" disabled. */
async function expectNotEmpty(page: Page): Promise<void> {
  const d = deletePage(page);
  await expect(d.alert, `the alert "${NOT_EMPTY}"`).toBeVisible();
  await expect(d.alert, "the alert's text").toContainText(NOT_EMPTY_TEXT);
  await expect(d.field, 'the confirmation field').toBeDisabled();
  await expect(d.delete, '"Delete bucket"').toBeDisabled();
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-delete-bucket-removes-the-bucket', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'delete-removes');
  const [first, second, kept] = [`${p}-first`, `${p}-second`, `${p}-kept`];
  const seeded = new Seeded(ctx, port);
  for (const name of [first, second, kept]) await seeded.bucket(name);
  const d = deletePage(page);

  /** Waits for the list with the flash item of `name`'s deletion and no row for it, and checks it is gone. */
  async function expectDeleted(name: string): Promise<void> {
    await expectList(page);
    await expectFlash(page, 'success', deletedItem(name));
    await filterFor(page, name);
    await expectNames(page, [], `the rows under the filter ${name}`);
    expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets under ${name}`).not.toContain(name);
  }

  await lines.line(
    'With an empty bucket made directly, select it in the list, "Delete" → the delete page with the bucket\'s name in its sentence and the endpoint the emulator line shows; "Delete bucket" is disabled',
    async () => {
      await openList(page);
      await filterFor(page, first);
      await expectNames(page, [first], `the rows under the filter ${first}`);
      await screen(page).radio(first).check(ACTION);
      await screen(page).action(DELETE).click(ACTION);
      await expect(page).toHaveURL(addressOf(deletePath(first)));
      await expect(d.h1, `the delete page's h1 "${DELETE_H1}"`).toBeVisible();
      await expectLine(page, connectedAt(port));
      await expect(emulatorLine(page)).toContainText(new RegExp(endpointPattern(port)));
      await expectPageShows(page, deleteSentence(first, port), 'the sentence names the bucket and the endpoint');
      await expectEmptyBucketForm(page);
      await expect(d.delete, '"Delete bucket" before the name is typed').toBeDisabled();
    },
  );

  await lines.line(
    'Type the name without its last character → still disabled; complete it → enabled; "Delete bucket" → the list with "Bucket “<name>” was deleted from the local emulator." and no row for it; a direct `ListBuckets` does not return it',
    async () => {
      await openDeletePage(page, first);
      await expectEmptyBucketForm(page);
      await d.field.fill(first.slice(0, -1), ACTION);
      await expect(d.delete, '"Delete bucket" with the name one character short').toBeDisabled();
      await d.field.fill(first, ACTION);
      await expect(d.delete, '"Delete bucket" with the name typed').toBeEnabled();
      await d.delete.click(ACTION);
      await expectDeleted(first);
    },
  );

  await lines.line('With another empty bucket, type the name and press Enter → the same', async () => {
    await openDeletePage(page, second);
    await expectEmptyBucketForm(page);
    await d.field.fill(second, ACTION);
    await d.field.press('Enter', ACTION);
    await expectDeleted(second);
  });

  await lines.line('On the delete page, "Cancel" → the list, and the bucket still exists directly', async () => {
    await openDeletePage(page, kept);
    await expectEmptyBucketForm(page);
    await d.cancel.click(ACTION);
    await expectList(page);
    expect(await bucketNamesDirect(ctx, port, kept), `a direct ListBuckets under ${kept}`).toContain(kept);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-delete-bucket-refuses-a-bucket-that-is-not-empty', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'delete-refuses');
  const [holding, marker, late] = [`${p}-object`, `${p}-marker`, `${p}-late`];
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(holding);
  await seeded.object(holding, 'kept.txt', 'kept');
  await seeded.bucket(marker);
  await seeded.configure(marker, { versioning: 'Enabled' });
  await seeded.bucket(late);
  const d = deletePage(page);

  await lines.line(
    'With a bucket that holds an object → the alert "This bucket is not empty", the field and "Delete bucket" disabled; "Empty bucket" → the empty page of that bucket',
    async () => {
      await openDeletePage(page, holding);
      await expectNotEmpty(page);
      await d.emptyBucket.click(ACTION);
      await expect(page).toHaveURL(addressOf(emptyPath(holding)));
      await expect(heading(page, EMPTY_H1), `the empty page's h1 "${EMPTY_H1}"`).toBeVisible();
    },
  );

  await lines.line('With a versioned bucket that holds only a delete marker → the same alert', async () => {
    // The Given: one version, a delete marker over it, then the version itself deleted, so the marker is all there is.
    const version = await seeded.object(marker, 'gone.txt', 'gone');
    await seeded.deleteMarker(marker, 'gone.txt');
    expect(version, 'the version id of the object put').not.toBeNull();
    const removed = await deleteObjectDirect(ctx, port, marker, 'gone.txt', version!);
    ctx.log(`direct DeleteObject ${marker}/gone.txt of version ${version!}: ${shownDirect(removed)}`);
    expect([200, 204], 'the direct DeleteObject of the version answers 200 or 204').toContain(
      'status' in removed ? removed.status : removed.error,
    );
    const items = await objectVersionsDirect(ctx, port, marker);
    expect(
      items?.map((i) => i.kind),
      `a direct ListObjectVersions of ${marker} holds only a delete marker`,
    ).toEqual(['delete-marker']);
    await openDeletePage(page, marker);
    await expectNotEmpty(page);
  });

  await lines.line(
    'With an empty bucket\'s delete page shown and the name typed, put an object directly, "Delete bucket" → the alert appears, the button is disabled, and the bucket and its object still exist directly',
    async () => {
      await openDeletePage(page, late);
      await expectEmptyBucketForm(page);
      await d.field.fill(late, ACTION);
      await expect(d.delete, '"Delete bucket" with the name typed').toBeEnabled();
      await seeded.object(late, 'arrived.txt', 'arrived');
      await d.delete.click(ACTION);
      await expect(d.alert, `the alert "${NOT_EMPTY}" after "Delete bucket"`).toBeVisible();
      await expect(d.delete, '"Delete bucket" after the refusal').toBeDisabled();
      expect(await bucketNamesDirect(ctx, port, late), `a direct ListBuckets under ${late}`).toContain(late);
      expect(await objectKeysDirect(ctx, port, late), `a direct ListObjectsV2 of ${late}`).toEqual(['arrived.txt']);
    },
  );

  lines.end();
});
