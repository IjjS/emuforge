// Object keys and folder names that differ only by a repeated space, and a key with a tab, in the built app in front
// of a real engine and emulator (test-criteria.md, issue 664).
//
// `studio.s3-keys-that-differ-by-spaces-are-told-apart`.
//
// The check makes one bucket named by its prefix `<p>` with the objects `<p> a b` and `<p> a  b` (two spaces) of
// different sizes, `<p>`, a tab, `tab`, and one object under each of the folders `<p> d x/` and `<p> d  x/`; the
// bucket is removed when the check ends (`Seeded`). The exact identity of a name writes a space next to another as a
// backslash and `u0020` (`SPACE_ESCAPE`) and a tab as a backslash and `t`. What the emulator holds is read directly.
// Words, readers and direct calls: `services/s3/`.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';

import { expect, startStack, test } from './support';
import { crumbLink, crumbs } from './support/aws-area';
import { ACTION, addressOf, titleOf } from './support/frame';
import { Lines } from './support/lines';
import {
  cellOfRowWith,
  checkPrefix,
  drawnText,
  headerHeading,
  modalDialog,
  SPACE_ESCAPE,
  twoSpaceIdentity,
} from './support/service-screens';
import { objectKeysDirect, Seeded } from './services/s3/s3';
import { bucketPath, openObjectsTab } from './services/s3/s3-bucket-page';
import {
  CONFIRM_WORD,
  deleteDialog,
  objectAddress,
  objectPage,
  OVERVIEW,
  rowCheckbox,
  sectionPairs,
} from './services/s3/s3-object-page';
import { showHistory } from './services/s3/object-versions';
import { objectsAddress, objectsTab } from './services/s3/s3-objects';

const BODY_ONE = 'one';
const BODY_TWO = 'the two-space body';
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('studio.s3-keys-that-differ-by-spaces-are-told-apart', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'sn-apart');
  const bucket = p;
  const one = `${p} a b`;
  const two = `${p} a  b`;
  const identity = twoSpaceIdentity(p);
  const tabKey = `${p}\ttab`;
  const tabIdentity = `${p}\\ttab`;
  const folderOne = `${p} d x/`;
  const folderTwo = `${p} d  x/`;
  const folderTwoIdentity = `${p} d${SPACE_ESCAPE}${SPACE_ESCAPE}x`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(bucket);
  await seeded.object(bucket, one, BODY_ONE);
  await seeded.object(bucket, two, BODY_TWO);
  await seeded.object(bucket, tabKey, 'tab');
  await seeded.object(bucket, `${folderOne}in-one`, 'x');
  await seeded.object(bucket, `${folderTwo}in-two`, 'x');
  const tab = objectsTab(page);
  const dialog = deleteDialog(page);
  /** Opens the bucket's Objects at `prefix` and waits for the row whose link is named `shown`. */
  const objects = async (shown: string, prefix = '') => {
    await openObjectsTab(page, bucket, prefix);
    await expect(tab.keyLink(shown), `the link named "${shown}"`).toBeVisible({ timeout: 15_000 });
  };
  /** Opens the two-space object's page by its link on Objects and waits for its overview. */
  const objectOfTwo = async () => {
    await objects(identity);
    await tab.keyLink(identity).click(ACTION);
    await expect(page, "the two-space object's address").toHaveURL(addressOf(objectAddress(bucket, two)));
    await expect(objectPage(page).section(OVERVIEW), `"${OVERVIEW}"`).toBeVisible({ timeout: 15_000 });
  };

  await lines.line(
    "Open the bucket's Objects → links and selection controls of each object, the two-space and the tab ones named by their identities, and the two folders' links; the two-space row reads the name with its two spaces, followed by the identity in brackets",
    async () => {
      await objects(identity);
      for (const name of [one, identity, tabIdentity, folderOne, `${folderTwoIdentity}/`]) {
        await expect(tab.keyLink(name), `the link named "${name}"`).toHaveCount(1);
      }
      await expect(rowCheckbox(page, one), `the selection control "Select ${one}"`).toHaveCount(1);
      await expect(rowCheckbox(page, identity), `the selection control "Select ${identity}"`).toHaveCount(1);
      // Column 1 is the selection control's, column 2 the key.
      const cell = await cellOfRowWith(tab.table, page.getByRole('link', { name: identity, exact: true }), 2);
      expect(await drawnText(cell), "the two-space row's key as drawn").toBe(`${two} (${identity})`);
    },
  );

  await lines.line(
    "Follow the link of the two-space folder → the last crumb reads the folder's identity and the object listed is the one put under it; open that object → the crumb of the folder is a link that leads to the Objects of the two-space folder",
    async () => {
      await objects(identity);
      await tab.keyLink(`${folderTwoIdentity}/`).click(ACTION);
      await expect(tab.keyLink('in-two'), "the two-space folder's object").toBeVisible({ timeout: 15_000 });
      await expect(tab.keyLink('in-one'), "the one-space folder's object").toHaveCount(0);
      expect((await crumbs(page)).at(-1), 'the last crumb').toBe(folderTwoIdentity);
      await tab.keyLink('in-two').click(ACTION);
      await expect(objectPage(page).section(OVERVIEW), `"${OVERVIEW}"`).toBeVisible({ timeout: 15_000 });
      const link = crumbLink(page, folderTwoIdentity);
      await expect(link, "the folder's crumb, a link").toHaveCount(1);
      const target = new URL((await link.getAttribute('href')) ?? '', 'http://127.0.0.1');
      expect(
        { path: target.pathname, prefix: target.searchParams.get('prefix') },
        "where the folder's crumb leads",
      ).toEqual({ path: bucketPath(bucket), prefix: folderTwo });
    },
  );

  await lines.line(
    "Follow the link named by the two-space object's identity → the heading, the last crumb and the document's title are the identity, and the size shown is the two-space object's",
    async () => {
      await objectOfTwo();
      await expect(headerHeading(page), "the heading's accessible name").toHaveAccessibleName(identity);
      expect((await crumbs(page)).at(-1), 'the last crumb').toBe(identity);
      expect(await page.title(), "the document's title").toBe(titleOf(identity));
      await expect
        .poll(async () => (await sectionPairs(page, OVERVIEW)).Size, { message: 'the size shown', timeout: 15_000 })
        .toBe(`${String(BODY_TWO.length)} bytes`);
    },
  );

  await lines.line(
    'Back on Objects, turn "Show versions" on → in the Versions list the key cell of the two-space key reads the key with its two spaces, followed by the identity in brackets, and its selection control\'s name starts "Select <identity> version "',
    async () => {
      await showHistory(page, bucket);
      const control = page.getByRole('radio', { name: new RegExp(`^Select ${escaped(identity)} version `) });
      await expect(control, 'the selection control of the two-space key').toHaveCount(1, { timeout: 15_000 });
      const versions = page.locator(createWrapper().findTable().toSelector()).filter({ has: control });
      // Column 1 is the selection control's, column 2 the key.
      const cell = await cellOfRowWith(versions, control, 2);
      expect(await drawnText(cell), "the two-space key's cell as drawn").toBe(`${two} (${identity})`);
    },
  );

  await lines.line(
    'Open the two-space object\'s page again and choose to delete it → the dialog is named "Delete <identity>?"; confirm as the dialog asks → the emulator holds the one-space object and not the two-space one',
    async () => {
      await objectOfTwo();
      await objectPage(page).delete.click(ACTION);
      await expect(modalDialog(page), "the dialog's accessible name").toHaveAccessibleName(`Delete ${identity}?`);
      await dialog.confirm.fill(CONFIRM_WORD);
      await dialog.delete.click(ACTION);
      await expect(page, 'back on Objects').toHaveURL(addressOf(objectsAddress(bucket)));
      const keys = await objectKeysDirect(ctx, port, bucket);
      expect(
        { one: keys.includes(one), two: keys.includes(two) },
        `a direct ListObjectsV2 of ${bucket}: ${JSON.stringify(keys)}`,
      ).toEqual({ one: true, two: false });
    },
  );

  await lines.line(
    "On Objects select the key with a tab and choose to delete → the dialog's list of what is selected reads the key followed by its identity in brackets; confirm → the emulator holds no object of that key and still the one-space object",
    async () => {
      await objects(tabIdentity);
      await rowCheckbox(page, tabIdentity).check(ACTION);
      await tab.table.getByRole('button', { name: 'Delete', exact: true }).click(ACTION);
      await expect(dialog.confirm, 'the dialog').toBeVisible(ACTION);
      // The dialog fades in: its text is read until it is drawn.
      await expect
        .poll(() => drawnText(modalDialog(page)), { message: 'what the dialog lists as selected', ...ACTION })
        .toContain(`${tabKey} (${tabIdentity})`);
      await dialog.confirm.fill(CONFIRM_WORD);
      await dialog.delete.click(ACTION);
      await expect(tab.keyLink(tabIdentity), 'the row after the deletion').toHaveCount(0, { timeout: 15_000 });
      const keys = await objectKeysDirect(ctx, port, bucket);
      expect(
        { one: keys.includes(one), tab: keys.includes(tabKey) },
        `a direct ListObjectsV2 of ${bucket}: ${JSON.stringify(keys)}`,
      ).toEqual({ one: true, tab: false });
    },
  );

  lines.end();
});
