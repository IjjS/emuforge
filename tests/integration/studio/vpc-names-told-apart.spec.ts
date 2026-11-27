// VPCs whose `Name` tags differ only by a repeated space, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 664).
//
// `studio.vpc-name-tags-that-differ-by-spaces-are-told-apart`.
//
// The check makes two VPCs whose `Name` tags are `<p> a b` and `<p> a  b` (two spaces) under its prefix `<p>`; both
// are removed when the check ends (`VpcSeeded`). The exact identity of the two-space name is `<p> a`, a backslash and
// `u0020` twice, `b` (`twoSpaceIdentity`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/vpc/vpc.ts`.

import type { Locator } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  checkPrefix,
  drawnText,
  headerHeading,
  modalContent,
  rowReading,
  twoSpaceIdentity,
} from './support/service-screens';
import {
  button,
  confirmWith,
  DELETE,
  dialogOf,
  findBy,
  open,
  rowsOf,
  TABLE,
  vpcDirect,
  vpcPath,
  VPCS_H1,
  VPCS_PATH,
  VpcSeeded,
} from './services/vpc/vpc';

test('studio.vpc-name-tags-that-differ-by-spaces-are-told-apart', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcnames');
  const one = `${p} a b`;
  const two = `${p} a  b`;
  const identity = twoSpaceIdentity(p);
  const seeded = new VpcSeeded(ctx, port, p);
  const vpcOne = await seeded.vpc(one, '10.165.0.0/16');
  const vpcTwo = await seeded.vpc(two, '10.166.0.0/16');
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  const control = (row: Locator, name: string) => row.getByRole('radio', { name, exact: true });
  // Column 1 is the selection control's, column 2 the name. A row is found by the name it reads; its selection
  // control is that row's.
  /** Opens VPCs, narrowed to the check's two, and waits for the two-space VPC's row. */
  const listed = async () => {
    await open(page, VPCS_PATH, VPCS_H1);
    await findBy(table, p);
    await expect.poll(async () => (await rowsOf(table)).length, { message: "the check's two rows, alone", timeout: 15_000 }).toBe(2);
    return (await rowReading(table, 2, `${two} (${identity})`)).row;
  };

  await lines.line(
    'Open VPCs → selection controls of both names, the two-space one named by its identity, and the row of the two-space VPC reads its name with its two spaces, followed by the identity in brackets',
    async () => {
      const rowTwo = await listed();
      await expect(control(rowTwo, identity), `the two-space row's control, named "${identity}"`).toHaveCount(1);
      const rowOne = (await rowReading(table, 2, one)).row;
      await expect(control(rowOne, one), `the one-space row's control, named "${one}"`).toHaveCount(1);
    },
  );

  await lines.line("Open the two-space VPC's page by its ID → the page's heading is named by the identity", async () => {
    await page.goto(vpcPath(vpcTwo));
    await expect(headerHeading(page), "the heading's accessible name").toHaveAccessibleName(identity, {
      timeout: 15_000,
    });
  });

  await lines.line(
    "On VPCs select the two-space VPC and delete it → the dialog's sentence reads the name followed by the identity in brackets; confirm → the emulator holds the one-space VPC and not the two-space one",
    async () => {
      await control(await listed(), identity).check(ACTION);
      await button(main, DELETE).click(ACTION);
      // The sentence is the paragraph of the dialog's content. The dialog fades in: it is read until it is drawn.
      const sentence = modalContent(page).getByRole('paragraph');
      await expect(sentence, "the dialog's sentence").toHaveCount(1);
      await expect
        .poll(async () => (await drawnText(sentence)).slice(0, `${two} (${identity}) `.length), {
          message: "how the dialog's sentence starts",
          ...ACTION,
        })
        .toBe(`${two} (${identity}) `);
      await confirmWith(page, 'delete', DELETE);
      await expect(dialogOf(page), 'the dialog after the delete').toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(async () => (await vpcDirect(ctx, port, vpcTwo)) === null, {
          message: 'the two-space VPC is gone, directly',
          timeout: 10_000,
        })
        .toBe(true);
      expect(await vpcDirect(ctx, port, vpcOne), 'the one-space VPC, directly').not.toBeNull();
    },
  );

  lines.end();
});
