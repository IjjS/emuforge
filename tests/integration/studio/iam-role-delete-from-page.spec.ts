// Deleting a role from its own page (S2) in the built app served by `bun run serve`, in front of a real engine started
// for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): "Delete" in the header opens the
// role list's dialog for this one role; "Cancel" changes nothing; a confirmed delete leads to the role list with the
// dialog's result there, and the role's address then says the role is not found.
//
// `studio.iam-role-delete-from-its-page`.
//
// The role is made directly under the check's prefix `<p>` (`services/iam/iam.ts`), with a managed and an inline
// policy; it is deleted by Studio, or taken apart when the check ends.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { applyFilter } from './services/iam/iam-screens';
import { DOC_A, getRoleAnswer, IamSeeded, LAMBDA_BASIC, roleIsGone } from './services/iam/iam';
import {
  addressOf,
  button,
  confirmByTyping,
  dialog,
  expectFlash,
  headerButton,
  iamPrefix,
  openRole,
  rolePath,
  ROLES_PATH,
  rowsOf,
} from './services/iam/iam-screens';

const TITLE = 'Delete 1 role?';
const DELETED = '1 role was deleted from the local emulator.';

test('studio.iam-role-delete-from-its-page', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'rolegone');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const role = `${p}-gone`;
  await seeded.role(role);
  await seeded.attach(role, LAMBDA_BASIC);
  await seeded.inline(role, `${p}-inline`, DOC_A);

  await lines.line(
    'On S2, "Delete" in the header → `main`\'s dialog "Delete 1 role?"; "Cancel" → the dialog closes and the emulator still reports the role',
    async () => {
      await openRole(page, role);
      await headerButton(page, 'Delete').click(ACTION);
      const opened = dialog(page, TITLE);
      await expect(opened, `the dialog "${TITLE}"`).toBeVisible();
      await expect(opened, 'the dialog names the role').toContainText(role);
      await button(opened, 'Cancel').click(ACTION);
      await expect(opened, 'the dialog after "Cancel"').toHaveCount(0);
      expect((await getRoleAnswer(ctx, port, role)).ok, 'a direct GetRole after "Cancel"').toBe(true);
    },
  );

  await lines.line(
    '"Delete" again, type `delete`, "Delete" → S1 opens and shows the dialog\'s result; the list does not hold `<p>-gone`; the emulator reports no such role',
    async () => {
      await openRole(page, role);
      await headerButton(page, 'Delete').click(ACTION);
      await confirmByTyping(page, TITLE);
      await expect.poll(() => addressOf(page), { message: 'the address of S1', timeout: 30_000 }).toBe(ROLES_PATH);
      await expectFlash(page, [DELETED], "the dialog's result on S1");
      await applyFilter(main, role);
      await expect
        .poll(
          async () => (await rowsOf(main.getByRole('table', { name: 'Roles', exact: true }), ['Role name'])).flat(),
          {
            message: "the rows under the role's name",
          },
        )
        .toEqual([]);
      const gone = await roleIsGone(ctx, port, role);
      if (gone) seeded.forget(role);
      expect(gone, 'a direct GetRole answers NoSuchEntity').toBe(true);
    },
  );

  await lines.line('The address of S2 of `<p>-gone` → "Role not found"', async () => {
    await page.goto(rolePath(role));
    await expect(main.getByText('Role not found', { exact: true }), '"Role not found"').toBeVisible();
  });

  lines.end();
});
