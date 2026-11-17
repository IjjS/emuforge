// Deleting IAM roles from the role list in the built app served by `bun run serve`, in front of a real engine
// started for that Studio and the run's emulator (test-criteria.md, issue 82, Flow checks; requirement R7, R10.3):
// the dialog, roles without anything attached, a role with policies and an instance profile, a role under
// `/aws-service-role/`, and a role that is gone before the dialog's "Delete".
//
// `studio.iam-role-delete-removes-roles-from-the-emulator`.
//
// Other checks make roles on the run's emulator at the same time, so the check names its roles with its own prefix
// `<p>` (lower-case letters and digits) and shows them under a filter that holds `<p>`. Roles, policies and instance
// profiles are made and read directly with `support/iam.ts`; what Studio did not delete is taken apart when the check
// ends. Each line opens the list afresh, so the Flashbar holds only what that line's deletion reported.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { hasFocus } from './support/focus';
import { ACTION } from './support/frame';
import {
  getInstanceProfileDirect,
  getPolicyAnswer,
  getRoleAnswer,
  iamAnswer,
  IamSeeded,
  READ_ONLY_ACCESS,
  roleIsGone,
  SERVICE_ROLE_PATH,
} from './support/iam';
import { Lines } from './support/lines';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R3, R4, R7; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const H1 = 'Roles';
const DELETE = 'Delete';
const CANCEL = 'Cancel';
const FILTER = 'Search items';
const CONFIRM_FIELD = 'To confirm, type delete';
const COL_NAME = 'Role name';
const COL_LAST = 'Last activity';

/** The dialog's title for `n` roles (R7). */
function dialogTitle(n: number): string {
  return n === 1 ? 'Delete 1 role?' : `Delete ${String(n)} roles?`;
}

/** The Flashbar's success item for `n` deleted roles (R7). */
function deletedText(n: number): string {
  return n === 1
    ? '1 role was deleted from the local emulator.'
    : `${String(n)} roles were deleted from the local emulator.`;
}

/** The check's own prefix `<p>`: `efit<run id><tag>`, lower-case letters and digits only. */
function rolePrefix(ctx: Ctx, tag: string): string {
  return `efit${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')}${tag}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
const TABLE = wrapper.findTable().toSelector();
const FLASH_ITEMS = wrapper.findFlashbar().findItems().toSelector();

/** The list's parts inside the page's `main`, the dialog (outside it) and the Flashbar's items. */
function screen(page: Page) {
  const main = page.getByRole('main');
  return {
    h1: main.getByRole('heading', { level: 1, name: new RegExp(`^${H1}(\\s|$)`) }),
    table: main.locator(TABLE).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    deleteAction: main.getByRole('button', { name: DELETE, exact: true }).first(),
    checkbox: (role: string) => main.getByRole('checkbox', { name: role, exact: true }),
    dialog: (n: number) => page.getByRole('dialog', { name: dialogTitle(n) }),
    flashItems: page.locator(FLASH_ITEMS),
  };
}

/** The first-heading cells (`headings[0]`) of the rows of the table inside `root`; `[]` when there is none. */
async function namesIn(root: Locator, headings: string[]): Promise<string[]> {
  if ((await root.count()) === 0) return [];
  return root.first().evaluate((el, wanted) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    for (const table of el.querySelectorAll('table')) {
      if (table.tBodies.length === 0 || table.closest('[aria-hidden="true"]')) continue;
      const head = table.tHead?.rows[0];
      if (!head) continue;
      const names = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
      if (wanted.some((w) => !names.includes(w))) continue;
      const at = names.indexOf(wanted[0]);
      return [...table.tBodies[0].rows]
        .filter((row) => row.cells.length > 1)
        .map((row) => norm((row.cells[at] as HTMLElement | undefined)?.innerText ?? ''));
    }
    return [];
  }, headings);
}

/** Opens the list afresh, applies the filter `text` (typed, then Enter) and waits for exactly `roles`. */
async function listUnder(page: Page, text: string, roles: string[]): Promise<void> {
  const s = screen(page);
  await page.goto(ROLES_PATH);
  await expect(s.h1, `the role list's h1 "${H1}…"`).toBeVisible();
  await s.filter.fill(text, ACTION);
  await s.filter.press('Enter', ACTION);
  await expect
    .poll(() => namesIn(s.table, [COL_NAME, COL_LAST]), { message: `the rows under the filter ${text}` })
    .toEqual(roles);
}

/** Selects `roles`, opens the dialog with "Delete", types `delete` and presses the dialog's "Delete". */
async function deleteThroughDialog(page: Page, roles: string[]): Promise<void> {
  const s = screen(page);
  for (const role of roles) await s.checkbox(role).check(ACTION);
  await s.deleteAction.click(ACTION);
  const dialog = s.dialog(roles.length);
  await expect(dialog, `the dialog "${dialogTitle(roles.length)}"`).toBeVisible();
  await dialog.getByLabel(CONFIRM_FIELD).fill('delete', ACTION);
  await dialog.getByRole('button', { name: DELETE, exact: true }).click(ACTION);
  await expect(dialog, 'the dialog closes once every role is finished').toHaveCount(0, { timeout: 30_000 });
}

/** The Flashbar items' texts, white space collapsed. */
async function flashTexts(page: Page): Promise<string[]> {
  return (await screen(page).flashItems.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** Waits until a Flashbar item holds every one of `parts`. */
async function expectFlash(page: Page, parts: string[], message: string): Promise<void> {
  await expect
    .poll(async () => (await flashTexts(page)).some((t) => parts.every((part) => t.includes(part))), { message })
    .toBe(true);
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-delete-removes-roles-from-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rldelete');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);

  /** After Studio's deletion: `role` is forgotten by the cleanup once a direct `GetRole` says it is gone. */
  async function gone(role: string): Promise<boolean> {
    const isGone = await roleIsGone(ctx, port, role);
    if (isGone) seeded.forget(role);
    return isGone;
  }

  const pair = [`${p}-pair-1`, `${p}-pair-2`];
  for (const role of pair) await seeded.role(role);

  await lines.line(
    'Select two roles made directly, "Delete" → the dialog "Delete 2 roles?" with both in its table; "Delete" is disabled; "Cancel" → a direct `GetRole` returns both, focus on "Delete"',
    async () => {
      await listUnder(page, `${p}-pair`, pair);
      for (const role of pair) await s.checkbox(role).check(ACTION);
      await s.deleteAction.click(ACTION);
      const dialog = s.dialog(2);
      await expect(dialog, `the dialog "${dialogTitle(2)}"`).toBeVisible();
      await expect.poll(() => namesIn(dialog, [COL_NAME, COL_LAST]), { message: "the dialog's table" }).toEqual(pair);
      await expect(
        dialog.getByRole('button', { name: DELETE, exact: true }),
        `the dialog's "${DELETE}"`,
      ).toBeDisabled();
      await dialog.getByRole('button', { name: CANCEL, exact: true }).click(ACTION);
      await expect(dialog, 'the dialog after "Cancel"').toHaveCount(0);
      for (const role of pair) {
        const answer = await getRoleAnswer(ctx, port, role);
        expect(answer.ok, `a direct GetRole of ${role} after "Cancel"`).toBe(true);
      }
      await expect.poll(() => hasFocus(s.deleteAction), { message: `focus is on "${DELETE}"` }).toBe(true);
    },
  );

  await lines.line(
    '"Delete", type `delete`, "Delete" in the dialog → "2 roles were deleted from the local emulator."; the rows are gone; a direct `GetRole` of each answers that the role cannot be found',
    async () => {
      for (const role of pair) if (!seeded.has(role)) await seeded.role(role);
      await listUnder(page, `${p}-pair`, pair);
      await deleteThroughDialog(page, pair);
      await expectFlash(page, [deletedText(2)], `the Flashbar holds "${deletedText(2)}"`);
      await expect
        .poll(async () => (await namesIn(s.table, [COL_NAME, COL_LAST])).filter((n) => pair.includes(n)), {
          message: 'the deleted rows',
        })
        .toEqual([]);
      for (const role of pair) expect(await gone(role), `a direct GetRole of ${role} answers NoSuchEntity`).toBe(true);
    },
  );

  await lines.line(
    'Select a role made directly with the managed policy `ReadOnlyAccess` and a customer managed policy attached, an inline policy, and membership in an instance profile `<p>-profile`; delete it through the dialog → "1 role was deleted from the local emulator."; a direct `GetRole` answers that the role cannot be found; a direct `GetInstanceProfile` of `<p>-profile` returns the profile with no role; a direct `GetPolicy` returns the customer managed policy',
    async () => {
      const full = `${p}-full`;
      const profile = `${p}-profile`;
      await seeded.role(full);
      await seeded.attach(full, READ_ONLY_ACCESS);
      const policy = await seeded.policy(`${p}-policy`);
      await seeded.attach(full, policy);
      await seeded.inline(full, `${p}-inline`);
      await seeded.profile(profile);
      await seeded.addToProfile(profile, full);
      expect((await getInstanceProfileDirect(ctx, port, profile)).roles, `${profile} before`).toEqual([full]);
      await listUnder(page, full, [full]);
      await deleteThroughDialog(page, [full]);
      await expectFlash(page, [deletedText(1)], `the Flashbar holds "${deletedText(1)}"`);
      expect(await gone(full), `a direct GetRole of ${full} answers NoSuchEntity`).toBe(true);
      expect((await getInstanceProfileDirect(ctx, port, profile)).roles, `the roles of ${profile} after`).toEqual([]);
      const kept = await getPolicyAnswer(ctx, port, policy);
      expect(kept.ok, `a direct GetPolicy of ${policy}`).toBe(true);
    },
  );

  await lines.line(
    'Select `<p>-linked` (made directly with the path `/aws-service-role/<p>/`) and delete it through the dialog → the success item; a direct `GetRole` answers that the role cannot be found',
    async () => {
      const linked = `${p}-linked`;
      await seeded.role(linked, { path: `${SERVICE_ROLE_PATH}${p}/` });
      await listUnder(page, linked, [linked]);
      await deleteThroughDialog(page, [linked]);
      await expectFlash(page, [deletedText(1)], `the Flashbar holds "${deletedText(1)}"`);
      expect(await gone(linked), `a direct GetRole of ${linked} answers NoSuchEntity`).toBe(true);
    },
  );

  await lines.line(
    'Select two roles, delete the first directly, then "Delete", `delete`, "Delete" → an error item "Deleting <name> failed" with the emulator\'s code and message for the first, "1 role was deleted from the local emulator." for the other; the list shows neither',
    async () => {
      const [first, other] = [`${p}-gone-1`, `${p}-gone-2`];
      await seeded.role(first);
      await seeded.role(other);
      await listUnder(page, `${p}-gone`, [first, other]);
      for (const role of [first, other]) await s.checkbox(role).check(ACTION);
      await seeded.remove(first);
      // What the emulator answers the first request R7 sends for a role outside `/aws-service-role/`, now.
      const refusal = await iamAnswer(ctx, port, 'ListInstanceProfilesForRole', { RoleName: first }, first);
      expect(refusal.ok, `a direct ListInstanceProfilesForRole of ${first} is refused`).toBe(false);
      if (refusal.ok) return;
      await s.deleteAction.click(ACTION);
      const dialog = s.dialog(2);
      await expect(dialog, `the dialog "${dialogTitle(2)}"`).toBeVisible();
      await dialog.getByLabel(CONFIRM_FIELD).fill('delete', ACTION);
      await dialog.getByRole('button', { name: DELETE, exact: true }).click(ACTION);
      await expect(dialog, 'the dialog closes once every role is finished').toHaveCount(0, { timeout: 30_000 });
      ctx.log(`Flashbar: ${JSON.stringify(await flashTexts(page))}`);
      await expectFlash(
        page,
        [`Deleting ${first} failed`, refusal.code, refusal.message],
        `an error item "Deleting ${first} failed" with ${refusal.code}: ${refusal.message}`,
      );
      await expectFlash(page, [deletedText(1)], `the Flashbar holds "${deletedText(1)}"`);
      expect(await gone(other), `a direct GetRole of ${other} answers NoSuchEntity`).toBe(true);
      await expect
        .poll(async () => (await namesIn(s.table, [COL_NAME, COL_LAST])).filter((n) => n === first || n === other), {
          message: 'the rows of both roles',
        })
        .toEqual([]);
    },
  );

  lines.end();
});
