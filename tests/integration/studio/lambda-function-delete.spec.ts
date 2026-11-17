// Deleting Lambda functions from the function list in the built app served by `bun run serve`, in front of a real
// engine started for that Studio and the run's emulator (test-criteria.md, issue 84, Flow checks; requirement R7,
// R10.3): the dialog "Delete functions", what the emulator holds afterwards, a delete the emulator refuses, Esc, and
// the role "Create default role" made, which stays.
//
// `studio.lambda-function-delete-removes-functions-from-the-emulator`.
//
// Other checks make functions on the run's emulator at the same time, so every function here is named under the
// check's prefix `<p>`, and each line works under its own filter `<p>-<line>-`. Words and readers:
// `support/lambda-list.ts`; direct calls: `support/lambda.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { hasFocus } from './support/focus';
import { ACTION, addressOf, heading } from './support/frame';
import {
  deleteFunctionDirect,
  endpointOf,
  functionNamesDirect,
  getFunctionDirect,
  getRoleDirect,
  LambdaSeeded,
} from './services/lambda/lambda';
import {
  ACTIONS,
  applyFilter,
  CONFIRM_WORD,
  CREATE,
  CREATE_PATH,
  DELETE_DIALOG,
  deleteDialog,
  deletedText,
  deleteFailedText,
  expectNames,
  flashTexts,
  FUNCTION_NAME_FIELD,
  functionPath,
  openDeleteDialog,
  openList,
  screen,
  tokenTexts,
} from './services/lambda/lambda-list';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

/** Waits until one of the area's Flashbar items holds every one of `parts`. */
async function expectFlash(page: Page, parts: string[], message: string): Promise<void> {
  await expect
    .poll(async () => (await flashTexts(page)).some((t) => parts.every((part) => t.includes(part))), { message })
    .toBe(true);
}

test('studio.lambda-function-delete-removes-functions-from-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfl-delete');
  const seeded = new LambdaSeeded(ctx, port, p);
  const s = screen(page);
  const d = deleteDialog(page);

  // Line 1 and 2: three functions under `<p>-one-`; two of them are deleted.
  const one = `${p}-one-`;
  const [first, second, third] = [`${one}a`, `${one}b`, `${one}c`];
  for (const name of [first, second, third]) await seeded.function(name);

  /** The list under the filter `text`. */
  async function listedUnder(text: string, names: string[]): Promise<void> {
    if (!/\/aws\/lambda\/functions$/.test(new URL(page.url()).pathname)) await openList(page);
    const tokens = await tokenTexts(page);
    if (tokens.length !== 1 || !tokens[0].includes(text)) await applyFilter(page, text);
    await expectNames(page, names, `the rows under the filter ${text}`);
  }

  await lines.line(
    'Select two of three functions under the filter, "Actions", "Delete" → the dialog "Delete functions" lists both names and names the emulator\'s endpoint; "Delete" is disabled; typing `confirm` enables it',
    async () => {
      await openList(page);
      await listedUnder(one, [first, second, third]);
      await openDeleteDialog(page, [first, second]);
      await expect.poll(() => d.names(), { message: 'the names the dialog lists' }).toEqual([first, second]);
      await expect(d.dialog, "the dialog names the emulator's endpoint").toContainText(endpointOf(port));
      await expect(d.delete, '"Delete" with the field empty').toBeDisabled();
      await d.field.fill(CONFIRM_WORD, ACTION);
      await expect(d.delete, `"Delete" with "${CONFIRM_WORD}" typed`).toBeEnabled();
    },
  );

  await lines.line(
    '"Delete" → the success item "2 functions were deleted from the local emulator.", the list shows the third function only, and a direct `GetFunction` answers `ResourceNotFoundException` for both and returns the third',
    async () => {
      // The Given: the dialog of the line before, open for the two with `confirm` typed, whether or not that line held.
      if (!(await d.dialog.isVisible())) {
        await listedUnder(one, [first, second, third]);
        await openDeleteDialog(page, [first, second]);
      }
      await d.field.fill(CONFIRM_WORD, ACTION);
      await d.delete.click(ACTION);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0);
      await expectFlash(page, [deletedText(2)], `the success item "${deletedText(2)}"`);
      await expectNames(page, [third], 'the rows under the filter <p>-one- after the delete');
      for (const name of [first, second]) {
        const read = await getFunctionDirect(ctx, port, name);
        expect(read.found ? 'found' : read.errorType, `a direct GetFunction ${name}`).toBe('ResourceNotFoundException');
      }
      const kept = await getFunctionDirect(ctx, port, third);
      expect(kept.found, `a direct GetFunction ${third} returns it`).toBe(true);
    },
  );

  await lines.line(
    'With a function selected and the dialog open, delete it directly, type `confirm`, "Delete" → an error item "Deleting <name> failed" with `ResourceNotFoundException` and the emulator\'s message; the list no longer shows it',
    async () => {
      const two = `${p}-two-`;
      const gone = `${two}gone`;
      await seeded.function(gone);
      await openList(page);
      await listedUnder(two, [gone]);
      await openDeleteDialog(page, [gone]);
      const deleted = await deleteFunctionDirect(ctx, port, gone);
      expect('error' in deleted ? deleted.error : deleted.status, `direct DeleteFunction ${gone}`).toBe(204);
      // What the emulator answers a DeleteFunction of a function it no longer holds: the code and message the error
      // item is to show. The function is already gone, so this changes nothing.
      const refused = await deleteFunctionDirect(ctx, port, gone);
      expect('error' in refused ? refused.error : refused.errorType, `a second direct DeleteFunction ${gone}`).toBe(
        'ResourceNotFoundException',
      );
      const message = 'error' in refused ? '' : (refused.message ?? '');
      expect(message, "the emulator's message for it").not.toBe('');
      await d.field.fill(CONFIRM_WORD, ACTION);
      await d.delete.click(ACTION);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0);
      await expectFlash(
        page,
        [deleteFailedText(gone), 'ResourceNotFoundException', message],
        `an error item "${deleteFailedText(gone)}" with ResourceNotFoundException and "${message}"`,
      );
      await expectNames(page, [], 'the rows under the filter <p>-two- after the delete');
    },
  );

  await lines.line(
    'Open the dialog and press Esc → no function is deleted (a direct `GetFunction` returns the function) and focus is on "Actions"',
    async () => {
      const three = `${p}-three-`;
      const kept = `${three}kept`;
      await seeded.function(kept);
      await openList(page);
      await listedUnder(three, [kept]);
      await openDeleteDialog(page, [kept]);
      await page.keyboard.press('Escape');
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0);
      await expect
        .poll(() => hasFocus(s.action(ACTIONS)), {
          message: `focus is on "${ACTIONS}"`,
        })
        .toBe(true);
      const read = await getFunctionDirect(ctx, port, kept);
      expect(read.found, `a direct GetFunction ${kept} returns it`).toBe(true);
      expect(await functionNamesDirect(ctx, port, three), 'a direct ListFunctions under <p>-three-').toEqual([kept]);
    },
  );

  await lines.line(
    'A function Studio created with "Create default role", deleted here → a direct IAM `GetRole` still returns its role',
    async () => {
      const four = `${p}-four-`;
      const made = `${four}made`;
      await page.goto(CREATE_PATH);
      await expect(heading(page, CREATE), `the h1 "${CREATE}"`).toBeVisible();
      await page.getByRole('main').getByLabel(FUNCTION_NAME_FIELD, { exact: true }).fill(made, ACTION);
      // "Create default role" is the execution role's choice at start (R6.2).
      await page.getByRole('main').getByRole('button', { name: CREATE, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(functionPath(made)), {
        timeout: 15_000,
      });
      const created = await getFunctionDirect(ctx, port, made);
      expect(created.found, `a direct GetFunction ${made} after the form`).toBe(true);
      if (!created.found) return;
      const roleArn = created.configuration.Role;
      const roleName = roleArn.split('/').pop() ?? '';
      ctx.log(`the role Studio made for ${made}: ${roleArn}`);
      expect(roleName.startsWith(`${made}-role-`), `the role ${roleName} is the one "Create default role" made`).toBe(
        true,
      );
      expect(await getRoleDirect(ctx, port, roleName), `a direct GetRole ${roleName} before the delete`).not.toBeNull();
      await openList(page);
      await listedUnder(four, [made]);
      await openDeleteDialog(page, [made]);
      await d.field.fill(CONFIRM_WORD, ACTION);
      await d.delete.click(ACTION);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0);
      await expectFlash(page, [deletedText(1)], `the success item "${deletedText(1)}"`);
      const read = await getFunctionDirect(ctx, port, made);
      expect(read.found ? 'found' : read.errorType, `a direct GetFunction ${made}`).toBe('ResourceNotFoundException');
      const role = await getRoleDirect(ctx, port, roleName);
      expect(role?.arn, `a direct GetRole ${roleName} after the delete returns the role`).toBe(roleArn);
    },
  );

  lines.end();
});
