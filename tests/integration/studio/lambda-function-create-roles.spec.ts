// The select "Existing role" of the form "Create Event Function" in the built app served by `bun run serve`, in front
// of a real engine and the check's own emulator (test-criteria.md, issue 84, Flow checks; requirement R6.2, R9.4):
// the roles of the emulator's IAM, read page by page as the select asks for them.
//
// `studio.lambda-function-create-lists-the-roles-of-the-emulator`.
//
// The check has its own emulator, emptied of the roles it starts with (`withoutRoles`): it needs the whole list of
// roles, empty and then exactly 52. Words and readers:
// `support/lambda-page.ts`; direct calls: `support/lambda.ts`.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { LambdaSeeded, listRolesDirect, listRolesPage, withoutRoles } from './services/lambda/lambda';
import {
  createForm,
  EXISTING_ROLE,
  NO_ROLES,
  openCreateForm,
  optionNames,
  optionTexts,
  USE_ANOTHER_ROLE,
} from './services/lambda/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

/** How long the select may take to show what a page of `ListRoles` brought. */
const ROLES_BOUND_MS = 15_000;

test('studio.lambda-function-create-lists-the-roles-of-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfc-roles');
  const seeded = new LambdaSeeded(ctx, port, p);
  await withoutRoles(ctx, port);
  const f = createForm(page);

  /** Opens the form, chooses "Use another role" and opens "Existing role". */
  async function openRoles(): Promise<void> {
    await openCreateForm(page);
    await f.radio(USE_ANOTHER_ROLE).check(ACTION);
    await expect(f.existingRole, `"${EXISTING_ROLE}"`).toBeVisible();
    await f.existingRole.click(ACTION);
  }

  await lines.line(
    'On an emulator without roles, choose "Use another role" and open "Existing role" → "No roles"',
    async () => {
      expect(await listRolesDirect(ctx, port), 'a direct ListRoles of the emulator').toEqual([]);
      await openRoles();
      await expect(page.getByText(NO_ROLES, { exact: true }), `"${NO_ROLES}"`).toBeVisible({ timeout: ROLES_BOUND_MS });
      expect(await optionTexts(page), 'the options').toEqual([]);
    },
  );

  // 52 roles: the one under `/service-role/` is the 26th made.
  const serviceRole = `${p}-26`;
  for (let i = 1; i <= 52; i++) {
    const name = `${p}-${String(i).padStart(2, '0')}`;
    await seeded.role(name, name === serviceRole ? '/service-role/' : '/');
  }

  await lines.line(
    'With 52 roles made directly (one under the path `/service-role/`), open "Existing role" → the first options are the first 50 a direct `ListRoles` with `MaxItems` 50 returns; scrolling to the end adds the last 2; the role under `/service-role/` is shown with its path',
    async () => {
      const first = await listRolesPage(ctx, port, { maxItems: 50 });
      expect(first.roles, 'a direct ListRoles with MaxItems 50 lists 50').toHaveLength(50);
      expect(first.isTruncated, 'a direct ListRoles with MaxItems 50 of 52 is truncated').toBe(true);
      const rest = await listRolesPage(ctx, port, { maxItems: 50, marker: first.marker ?? undefined });
      const firstNames = first.roles.map((r) => r.name);
      const restNames = rest.roles.map((r) => r.name);
      expect(restNames, 'the second direct page holds the last 2').toHaveLength(2);
      await openRoles();
      await expect
        .poll(() => optionNames(page), { message: 'the first options', timeout: ROLES_BOUND_MS })
        .toEqual(firstNames);
      // Scroll to the end of the options, as a user reaching the last one does.
      await expect
        .poll(
          async () => {
            await f.options.last().scrollIntoViewIfNeeded(ACTION);
            return optionNames(page);
          },
          { message: 'the options once the end is reached', timeout: ROLES_BOUND_MS },
        )
        .toEqual([...firstNames, ...restNames]);
      const texts = await optionTexts(page);
      const shown = texts.find((t) => t.split(' ')[0] === serviceRole);
      ctx.log(`the option of ${serviceRole}: ${JSON.stringify(shown)}`);
      expect(shown, `the option of ${serviceRole} shows its path`).toContain('/service-role/');
    },
  );

  lines.end();
});
