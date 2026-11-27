// VPCs whose `Name` tags differ only by a repeated space, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 664).
//
// `studio.vpc-name-tags-that-differ-by-spaces-are-told-apart`.
//
// The check makes two VPCs whose `Name` tags are `<p> a b` and `<p> a  b` (two spaces) under its prefix `<p>`; both
// are removed when the check ends (`VpcSeeded`). The exact identity of the two-space name is `<p> a`, a backslash and
// `u0020` twice, `b` (`twoSpaceIdentity`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/vpc/vpc.ts`.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  cellOfRowWith,
  checkPrefix,
  drawnText,
  headerHeading,
  modalDialog,
  twoSpaceIdentity,
} from './support/service-screens';
import {
  button,
  confirmWith,
  DELETE,
  dialogOf,
  findBy,
  open,
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
  const rowControl = (name: string) => table.getByRole('radio', { name, exact: true });
  /** Opens VPCs, narrowed to the check's two. */
  const listed = async () => {
    await open(page, VPCS_PATH, VPCS_H1);
    await findBy(table, p);
    await expect(rowControl(identity), `the selection control named "${identity}"`).toHaveCount(1, {
      timeout: 15_000,
    });
  };

  await lines.line(
    'Open VPCs → selection controls of both names, the two-space one named by its identity, and the row of the two-space VPC reads its name with its two spaces, followed by the identity in brackets',
    async () => {
      await listed();
      await expect(rowControl(one), `the selection control named "${one}"`).toHaveCount(1);
      // Column 1 is the selection control's, column 2 the name.
      const cell = await cellOfRowWith(table, page.getByRole('radio', { name: identity, exact: true }), 2);
      expect(await drawnText(cell), "the two-space VPC's name as drawn").toBe(`${two} (${identity})`);
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
      await listed();
      await rowControl(identity).check(ACTION);
      await button(main, DELETE).click(ACTION);
      // The dialog fades in: its text is read until it is drawn.
      await expect
        .poll(() => drawnText(modalDialog(page)), { message: "the dialog's sentence", ...ACTION })
        .toContain(`${two} (${identity})`);
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
