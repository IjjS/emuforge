// The Lambda function screens while the emulator or the engine stops and starts again, in the built app served by
// `bun run serve` in front of a real engine and a real emulator (test-criteria.md, issue 84, Flow checks; requirement
// R6.5, R7, R10): the list, a function's page, the create form and the delete dialog.
//
// `studio.lambda-function-screens-follow-emulator-stop-and-restart`,
// `studio.lambda-function-screens-say-when-the-engine-stops-answering`.
//
// The restart check has its own emulator: it stops it, and the restarted emulator holds nothing. The engine check
// stops only the engine it started, so it makes its functions on the run's emulator under its own prefix `<p>`.
// "Within two connection checks" is the emulator line's bound (`LINE_CHANGE_BOUND_MS`). "The engine's message" is
// the one the engine answered the page's request with (`EngineAnswers`). Words and readers: `support/lambda-page.ts`
// and `support/lambda-list.ts`; direct calls: `support/lambda.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import {
  connectedAt,
  emulatorLine,
  engineNotAnswering,
  expectLine,
  LINE_CHANGE_BOUND_MS,
  notStartedOn,
} from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { functionNamesDirect, getFunctionDirect, LambdaSeeded, listRolesDirect } from './support/lambda';
import {
  ACTIONS,
  applyFilter,
  COLUMNS,
  CONFIRM_WORD,
  CREATE,
  DELETE_DIALOG,
  deleteDialog,
  expectNames,
  flashTexts,
  functionPath,
  H1,
  headingText,
  NO_FUNCTIONS,
  openDeleteDialog,
  openList,
  REFRESH,
  screen,
  shownNames,
  tokenTexts,
} from './support/lambda-list';
import {
  CONNECTION_STATUS,
  createForm,
  EMULATOR_DID_NOT_ANSWER,
  engineDidNotAnswer,
  EngineAnswers,
  fillForm,
  formKeeps,
  FUNCTION_NOT_READ,
  functionPage,
  LIST_NOT_READ,
  NOT_FOUND,
  openCreateForm,
  openFunction,
  RETRY,
  ROLE_STILL_THERE,
  shownAboveButtons,
  type FormValues,
} from './support/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix } from './support/s3';

/** How long a screen may take to read again by itself once the connection is back: the line's bound, twice. */
const BACK_BOUND_MS = 2 * LINE_CHANGE_BOUND_MS;

/** How long the form may take from "Create Event Function" to the function's page (three requests in order). */
const CREATE_BOUND_MS = 20_000;

/**
 * The list's failure state inside its table: `status` (the emulator line's), "The function list could not be read."
 * and "Retry", with "Connection status" when `withConnectionStatus`.
 */
async function expectListFailure(page: Page, status: RegExp, withConnectionStatus: boolean): Promise<void> {
  const table = screen(page).table;
  await expect(table.getByText(status), `the table shows ${String(status)}`).toBeVisible({
    timeout: LINE_CHANGE_BOUND_MS,
  });
  await expect(table.getByText(LIST_NOT_READ, { exact: true }), `"${LIST_NOT_READ}"`).toBeVisible();
  await expect(table.getByRole('button', { name: RETRY, exact: true }), `"${RETRY}"`).toBeVisible();
  if (withConnectionStatus) {
    await expect(
      table.getByRole('link', { name: CONNECTION_STATUS, exact: true }),
      `"${CONNECTION_STATUS}"`,
    ).toBeVisible();
  }
}

/** Whether the page's main shows `status` outside the emulator line (the line itself may sit in the main). */
async function contentShows(page: Page, status: RegExp): Promise<boolean> {
  const inMain = await page.getByRole('main').getByText(status).count();
  const inLine = await emulatorLine(page).getByText(status).count();
  return inMain > inLine;
}

/** The list keeps its heading, actions and columns (R10.1). */
async function expectListFrame(page: Page): Promise<void> {
  const s = screen(page);
  await expect(s.h1, `the h1 "${H1}"`).toBeVisible();
  for (const action of [REFRESH, ACTIONS]) await expect(s.action(action), `"${action}"`).toBeVisible();
  await expect(s.create, `"${CREATE}"`).toBeVisible();
  for (const column of COLUMNS) {
    await expect(s.table.getByRole('columnheader', { name: column }).first(), `the column "${column}"`).toBeVisible();
  }
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-screens-follow-emulator-stop-and-restart', async ({ ctx, page, context }) => {
  test.setTimeout(360_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfs-restart');
  let seeded = new LambdaSeeded(ctx, port, p);
  const two = [`${p}-a`, `${p}-b`];
  for (const name of two) await seeded.function(name);
  const answers = EngineAnswers.attach(ctx, context, stack.engine.url);
  const s = screen(page);
  let running = true;

  /** Starts the emulator again when a line before left it stopped; the restarted one holds nothing. */
  async function ensureRunning(): Promise<void> {
    if (running) return;
    await emulator.startAgain();
    running = true;
    await expectLine(page, connectedAt(port), BACK_BOUND_MS).catch(() => undefined);
  }

  await lines.line(
    'With two functions shown, stop the emulator and choose "Refresh" → within two connection checks the table shows the emulator line\'s status for the state with "The function list could not be read.", the link "Connection status" and "Retry"; the heading, actions and columns stay',
    async () => {
      await openList(page);
      await expectNames(page, await functionNamesDirect(ctx, port), 'the two rows before the emulator stops');
      expect([...(await shownNames(page))].sort(), 'the two functions are shown').toEqual(two);
      await markPage(page);
      await emulator.stop();
      running = false;
      await s.action(REFRESH).click(ACTION);
      await expectListFailure(page, notStartedOn(port), true);
      await expectLine(page, notStartedOn(port));
      await expectListFrame(page);
    },
  );

  await lines.line(
    'Start the emulator again → without a reload and without any action the list shows "No functions" and `h1` "Event Functions (0)" (the restarted emulator holds none; a direct `ListFunctions` agrees)',
    async () => {
      if (running) {
        await emulator.stop();
        running = false;
      }
      await emulator.startAgain();
      running = true;
      seeded = new LambdaSeeded(ctx, port, p);
      await expect(s.empty.getByText(NO_FUNCTIONS, { exact: true }), `"${NO_FUNCTIONS}" by itself`).toBeVisible({
        timeout: BACK_BOUND_MS,
      });
      await expect.poll(() => headingText(page), { message: 'the h1' }).toBe(`${H1} (0)`);
      expect(await functionNamesDirect(ctx, port), 'a direct ListFunctions of the restarted emulator').toEqual([]);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'On a function\'s page, stop the emulator and "Refresh" → "The function could not be read." with the line\'s status; start the emulator → without any action "Function not found"',
    async () => {
      await ensureRunning();
      const name = `${p}-page`;
      await seeded.function(name);
      await openFunction(page, name);
      const f = functionPage(page, name);
      await expect(f.tab('Code'), 'the page of the function').toBeVisible();
      await markPage(page);
      await emulator.stop();
      running = false;
      await f.refresh.click(ACTION);
      await expect(f.notRead, `"${FUNCTION_NOT_READ}"`).toBeVisible({ timeout: LINE_CHANGE_BOUND_MS });
      await expect
        .poll(() => contentShows(page, notStartedOn(port)), { message: "the line's status in the page's content" })
        .toBe(true);
      await expectLine(page, notStartedOn(port));
      await emulator.startAgain();
      running = true;
      seeded = new LambdaSeeded(ctx, port, p);
      await expect(f.notFound, `"${NOT_FOUND}" by itself`).toBeVisible({ timeout: BACK_BOUND_MS });
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'On a complete create form with "Create default role", stop the emulator and "Create Event Function" → the form stays with every value and shows "The emulator did not answer" with the engine\'s message above the buttons, and no sentence about a created role; start the emulator, "Create Event Function" → the function\'s page, and the function and one role exist in the emulator',
    async () => {
      await ensureRunning();
      const name = `${p}-form`;
      const values: FormValues = { name, runtime: 'Python 3.13', architecture: 'arm64' };
      await openCreateForm(page);
      await fillForm(page, values);
      await emulator.stop();
      running = false;
      await expectLine(page, notStartedOn(port));
      await createForm(page).create.click(ACTION);
      await expect
        .poll(
          async () => {
            await answers.settle();
            return answers.latest(['EmulatorUnavailable', 'EmulatorTimeout'])?.message ?? null;
          },
          {
            message: 'the engine answered the form with EmulatorUnavailable or EmulatorTimeout',
            timeout: CREATE_BOUND_MS,
          },
        )
        .not.toBeNull();
      const message = answers.latest(['EmulatorUnavailable', 'EmulatorTimeout'])?.message ?? '';
      ctx.log(`the engine's message: ${message}`);
      await expect
        .poll(() => shownAboveButtons(page, [EMULATOR_DID_NOT_ANSWER, message]), {
          message: `"${EMULATOR_DID_NOT_ANSWER}" with the engine's message above the buttons`,
          timeout: CREATE_BOUND_MS,
        })
        .toBe(true);
      expect(await formKeeps(page, values), 'the form keeps every value').toEqual([]);
      await expect(page.getByRole('main'), 'no sentence about a role').not.toContainText(ROLE_STILL_THERE);
      await emulator.startAgain();
      running = true;
      seeded = new LambdaSeeded(ctx, port, p);
      await expectLine(page, connectedAt(port), BACK_BOUND_MS);
      await createForm(page).create.click(ACTION);
      await expect(page).toHaveURL(addressOf(functionPath(name)), { timeout: CREATE_BOUND_MS });
      await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
      expect(await functionNamesDirect(ctx, port, name), `functions named ${name}`).toEqual([name]);
      const roles = (await listRolesDirect(ctx, port, name)).map((r) => r.name);
      ctx.log(`roles starting with ${name}: ${JSON.stringify(roles)}`);
      expect(roles, `roles whose name starts with ${name}`).toHaveLength(1);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-screens-say-when-the-engine-stops-answering', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const engine = stack.engine;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfs-engine');
  const seeded = new LambdaSeeded(ctx, port, p);
  const listed = `${p}-a`;
  const kept = `${p}-kept`;
  await seeded.function(listed);
  await seeded.function(kept);
  const s = screen(page);
  const d = deleteDialog(page);
  let running = true;

  /** The list under the filter `<p>`. */
  async function underPrefix(): Promise<void> {
    const tokens = await tokenTexts(page);
    if (tokens.length !== 1 || !tokens[0].includes(p)) await applyFilter(page, p);
  }

  await openList(page);
  await underPrefix();
  await expectNames(page, await functionNamesDirect(ctx, port, p), 'the rows under the filter <p>');
  await markPage(page);

  await lines.line(
    'Stop the engine and choose "Refresh" on the function list → within two connection checks the table shows "The EmuForge engine at `<engine origin>` is not answering", as the emulator line does, with "The function list could not be read." and "Retry"',
    async () => {
      await engine.stop();
      running = false;
      await s.action(REFRESH).click(ACTION);
      await expectListFailure(page, engineNotAnswering(engine.url), false);
      await expectLine(page, engineNotAnswering(engine.url));
    },
  );

  await lines.line(
    'Start the engine again → without a reload the rows return (the filter `<p>` lists what a direct `ListFunctions` returns under that prefix)',
    async () => {
      if (running) await engine.stop();
      await engine.startAgain();
      running = true;
      await expectLine(page, connectedAt(port), BACK_BOUND_MS);
      const direct = await functionNamesDirect(ctx, port, p);
      expect([...direct].sort(), 'a direct ListFunctions under <p>').toEqual([listed, kept].sort());
      await underPrefix();
      await expectNames(page, direct, 'the rows under the filter <p> once the engine answers', BACK_BOUND_MS);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'With a function selected, the delete dialog open and `confirm` typed, stop the engine and choose "Delete" → the dialog closes with an error item that the engine did not answer; start the engine → a direct `GetFunction` returns the function',
    async () => {
      if (!running) {
        await engine.startAgain();
        running = true;
      }
      await openList(page);
      await expectLine(page, connectedAt(port), BACK_BOUND_MS);
      await underPrefix();
      await expectNames(page, await functionNamesDirect(ctx, port, p), 'the rows under the filter <p>');
      await openDeleteDialog(page, [kept]);
      await d.field.fill(CONFIRM_WORD, ACTION);
      await engine.stop();
      running = false;
      await d.delete.click(ACTION);
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0, { timeout: CREATE_BOUND_MS });
      const wanted = engineDidNotAnswer(engine.url);
      await expect
        .poll(async () => (await flashTexts(page)).some((t) => t.includes(wanted)), {
          message: `an error item "${wanted}"`,
        })
        .toBe(true);
      await engine.startAgain();
      running = true;
      const read = await getFunctionDirect(ctx, port, kept);
      expect(read.found, `a direct GetFunction ${kept} returns it`).toBe(true);
    },
  );

  if (!running) await engine.startAgain();
  lines.end();
});
