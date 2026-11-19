// Deleting a Lambda function from its own page in the built app, in front of a real engine and the run's emulator
// (issue 516, test-criteria.md, "Integration"; requirement "S2, every tab", task 6): "Delete" in the page's header
// opens the list's delete dialog for this one function; deleted, the list opens with the result; a delete the
// emulator refuses leaves the page, which then says what the emulator holds.
//
// `studio.lambda-function-delete-from-its-page`.
//
// Every function is made directly under the check's prefix `<p>`. Words and readers: `services/lambda/lambda-list.ts`,
// `services/lambda/lambda-page.ts`; direct calls: `services/lambda/lambda.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { deleteFunctionDirect, getFunctionDirect, LambdaSeeded } from './services/lambda/lambda';
import {
  CONFIRM_WORD,
  DELETE,
  DELETE_DIALOG,
  deleteDialog,
  deletedText,
  deleteFailedText,
  flashTexts,
  functionPath,
  FUNCTIONS_PATH,
  listHeading,
} from './services/lambda/lambda-list';
import { functionPage, NOT_FOUND, openFunction } from './services/lambda/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

test('studio.lambda-function-delete-from-its-page', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfd-page');
  const seeded = new LambdaSeeded(ctx, port, p);
  const first = `${p}-first`;
  const second = `${p}-second`;
  await seeded.function(first);
  await seeded.function(second);
  /** "Delete" of the page's header. */
  const header = () => page.getByRole('main').getByRole('button', { name: DELETE, exact: true });

  await lines.line(
    'S2 of the first, "Delete" → `main`\'s dialog "Delete functions" naming this function; typing `confirm` and "Delete" → the list "Event Functions" with "1 function was deleted from the local emulator."; the emulator reports no such function, and still the second',
    async () => {
      await openFunction(page, first);
      await header().click(ACTION);
      const d = deleteDialog(page);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}"`).toBeVisible();
      expect(await d.names(), 'the names the dialog lists').toEqual([first]);
      await d.field.fill(CONFIRM_WORD, ACTION);
      await d.delete.click(ACTION);
      await expect(page).toHaveURL(addressOf(FUNCTIONS_PATH), { timeout: 20_000 });
      await expect(listHeading(page), 'the list').toBeVisible();
      await expect
        .poll(async () => (await flashTexts(page)).some((t) => t.includes(deletedText(1))), {
          message: `the success item "${deletedText(1)}"`,
        })
        .toBe(true);
      const gone = await getFunctionDirect(ctx, port, first);
      expect(gone.found ? 'found' : gone.errorType, `a direct GetFunction ${first}`).toBe('ResourceNotFoundException');
      expect((await getFunctionDirect(ctx, port, second)).found, `a direct GetFunction ${second}`).toBe(true);
    },
  );

  await lines.line(
    'S2 of the second with the dialog open and `confirm` typed, the function deleted directly, "Delete" → S2 stays, with the error item of `main`\'s delete naming `ResourceNotFoundException`; the page then shows "Function not found"',
    async () => {
      await openFunction(page, second);
      await header().click(ACTION);
      const d = deleteDialog(page);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}"`).toBeVisible();
      await d.field.fill(CONFIRM_WORD, ACTION);
      const deleted = await deleteFunctionDirect(ctx, port, second);
      expect('error' in deleted ? deleted.error : deleted.status, `direct DeleteFunction ${second}`).toBe(204);
      await d.delete.click(ACTION);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0);
      await expect
        .poll(async () => (await flashTexts(page)).find((t) => t.includes(deleteFailedText(second))) ?? '', {
          message: `the error item "${deleteFailedText(second)}"`,
        })
        .toContain('ResourceNotFoundException');
      await expect(page).toHaveURL(addressOf(functionPath(second)));
      await expect(functionPage(page, second).notFound, `"${NOT_FOUND}"`).toBeVisible();
    },
  );

  lines.end();
});
