// The IAM role screens while the emulator or the engine stops and starts again, in the built app served by
// `bun run serve` in front of a real engine started for that Studio (test-criteria.md, issue 82, Flow checks;
// requirement R10): the list, a role's page and the wizard with the check's own emulator stopped and started again,
// and the list and the delete dialog with the engine stopped and started again.
//
// `studio.iam-role-screens-follow-emulator-stop-and-restart`, `studio.iam-role-screens-say-when-the-engine-stops-answering`.
//
// The emulator check has its own emulator: it stops it, and the restarted emulator holds no role (requirement R2).
// The engine check uses the run's emulator and names its roles with its own prefix `<p>` (lower-case letters and
// digits). "Within two connection checks" is the emulator line's bound (`LINE_CHANGE_BOUND_MS`). Roles are made and
// read directly with `support/iam.ts` and taken apart when the check ends.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { connectedAt, engineNotAnswering, expectLine, LINE_CHANGE_BOUND_MS, notStartedOn } from './support/aws-area';
import { ACTION, heading } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { containing, getRoleAnswer, IamSeeded, roleNamesDirect, xmlTree, textAt } from './support/iam';
import { Lines } from './support/lines';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R4, R5, R6, R7, R10; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const CREATE_PATH = '/aws/iam/roles/create';
const LIST_H1 = 'Roles';
const FILTER = 'Search items';
const COL_NAME = 'Role name';
const COL_TRUSTED = 'Trusted entities';
const COL_LAST = 'Last activity';
const REFRESH = 'Refresh roles';
const REFRESH_ROLE = 'Refresh role';
const DELETE = 'Delete';
const CREATE = 'Create role';
const NEXT = 'Next';
const RETRY = 'Retry';
const CONNECTION_STATUS = 'Connection status';
const NO_ROLES = 'No roles';
const NOT_FOUND = 'Role not found';
const LIST_NOT_READ = 'The role list could not be read.';
const ROLE_NOT_READ = 'The role could not be read.';
const EMULATOR_SILENT = 'The emulator did not answer';
const CONFIRM_FIELD = 'To confirm, type delete';
const F_SERVICE = 'Service or use case';
const F_NAME = 'Role name';
const F_DESCRIPTION = 'Description';
const STEP_3 = 'Name, review, and create';

function rolePath(name: string): string {
  return `/aws/iam/roles/details/${encodeURIComponent(name)}`;
}

/** The action's failure when no answer came from the engine (R10.3). */
function engineSilent(origin: string): string {
  return `The EmuForge engine at ${origin} did not answer`;
}

function createdText(name: string): string {
  return `Role “${name}” was created in the local emulator.`;
}

/** How long a screen may take to read again by itself once the connection is back: the line's bound, twice. */
const BACK_BOUND_MS = 2 * LINE_CHANGE_BOUND_MS;

/** The check's own prefix `<p>`: `efit<run id><tag>`, lower-case letters and digits only. */
function rolePrefix(ctx: Ctx, tag: string): string {
  return `efit${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')}${tag}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
const LIST_TABLE = wrapper.findTable().toSelector();
const TABLE_EMPTY = wrapper.findTable().findEmptySlot().toSelector();
const FLASH_ITEMS = wrapper.findFlashbar().findItems().toSelector();

function screen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    h1: main.getByRole('heading', { level: 1, name: new RegExp(`^${LIST_H1}(\\s|$)`) }),
    table: page.locator(LIST_TABLE).first(),
    empty: page.locator(TABLE_EMPTY).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    button: (name: string) => main.getByRole('button', { name, exact: true }).first(),
    flashItems: page.locator(FLASH_ITEMS),
  };
}

/** The list's data rows as shown: the "Role name" cells; `[]` when there is no table. */
async function shownNames(page: Page): Promise<string[]> {
  const table = screen(page).table;
  if ((await table.count()) === 0) return [];
  return table.evaluate((el, col) => {
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    for (const t of el.querySelectorAll('table')) {
      if (t.tBodies.length === 0 || t.closest('[aria-hidden="true"]')) continue;
      const head = t.tHead?.rows[0];
      if (!head) continue;
      const at = [...head.cells].map((c) => norm((c as HTMLElement).innerText)).indexOf(col);
      if (at < 0) continue;
      return [...t.tBodies[0].rows]
        .filter((r) => r.cells.length > 1)
        .map((r) => norm((r.cells[at] as HTMLElement | undefined)?.innerText ?? ''));
    }
    return [];
  }, COL_NAME);
}

async function expectNames(page: Page, names: string[], message: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => shownNames(page), { timeout, message }).toEqual(names);
}

/** The list's failure state in the table: `status`, "The role list could not be read." and "Retry". */
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

/** The heading, the three actions and the three columns of the list are there. */
async function expectListFrame(page: Page): Promise<void> {
  const s = screen(page);
  await expect(s.h1, `the h1 "${LIST_H1}…"`).toBeVisible();
  for (const action of [REFRESH, DELETE, CREATE]) await expect(s.button(action), `"${action}"`).toBeVisible();
  for (const column of [COL_NAME, COL_TRUSTED, COL_LAST]) {
    await expect(s.table.getByRole('columnheader', { name: column }).first(), `the column "${column}"`).toBeVisible();
  }
}

async function openList(page: Page): Promise<void> {
  await page.goto(ROLES_PATH);
  await expect(screen(page).h1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
}

async function applyFilter(page: Page, text: string): Promise<void> {
  await screen(page).filter.fill(text, ACTION);
  await screen(page).filter.press('Enter', ACTION);
}

/** The wizard from step 1 to a filled step 3 with a service principal, a name and a description. */
async function fillWizard(page: Page, name: string, description: string): Promise<void> {
  const main = screen(page).main;
  await page.goto(CREATE_PATH);
  await expect(heading(page, 'Select trusted entity')).toBeVisible();
  await main.getByLabel(F_SERVICE, { exact: true }).fill('lambda.amazonaws.com', ACTION);
  await main.getByLabel(F_SERVICE, { exact: true }).press('Tab', ACTION);
  await screen(page).button(NEXT).click(ACTION);
  await expect(heading(page, 'Add permissions')).toBeVisible();
  await screen(page).button(NEXT).click(ACTION);
  await expect(heading(page, STEP_3)).toBeVisible();
  await main.getByLabel(F_NAME, { exact: true }).fill(name, ACTION);
  await main.getByLabel(F_DESCRIPTION, { exact: true }).fill(description, ACTION);
}

async function flashTexts(page: Page): Promise<string[]> {
  return (await screen(page).flashItems.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-screens-follow-emulator-stop-and-restart', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rslife');
  const seeded = new IamSeeded(ctx, port);
  const two = [`${p}-a`, `${p}-b`];
  for (const name of two) await seeded.role(name);
  const s = screen(page);
  let running = true;

  /** Starts the emulator again when a line before left it stopped. */
  async function ensureRunning(): Promise<void> {
    if (!running) {
      await emulator.startAgain();
      running = true;
    }
  }

  await lines.line(
    'With two roles shown, stop the emulator and choose "Refresh roles" → within two connection checks the table shows the emulator line\'s status for the state with "The role list could not be read.", the link "Connection status" and "Retry"; the heading, actions and columns stay',
    async () => {
      await openList(page);
      await expectNames(page, await roleNamesDirect(ctx, port), 'the rows before the emulator stops');
      expect([...(await shownNames(page))].sort(), 'the two roles are shown').toEqual([...two].sort());
      await markPage(page);
      await emulator.stop();
      running = false;
      await s.button(REFRESH).click(ACTION);
      await expectListFailure(page, notStartedOn(port), true);
      await expectLine(page, notStartedOn(port));
      await expectListFrame(page);
    },
  );

  await lines.line(
    'Start the emulator again → without a reload and without any action the list shows "No roles" and `h1` "Roles (0)" (the restarted emulator holds none; a direct `ListRoles` agrees)',
    async () => {
      if (running) {
        await openList(page);
        await markPage(page);
        await emulator.stop();
        running = false;
        await s.button(REFRESH).click(ACTION);
        await expectLine(page, notStartedOn(port));
      }
      await emulator.startAgain();
      running = true;
      await expect(s.empty.getByText(NO_ROLES, { exact: true }), `"${NO_ROLES}" by itself`).toBeVisible({
        timeout: BACK_BOUND_MS,
      });
      await expect
        .poll(async () => (await s.h1.innerText(ACTION)).replace(/\s+/g, ' ').trim(), { message: 'the h1' })
        .toBe(`${LIST_H1} (0)`);
      expect(await roleNamesDirect(ctx, port), 'a direct ListRoles of the restarted emulator').toEqual([]);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'On a role\'s page, stop the emulator and "Refresh role" → "The role could not be read." with the line\'s status; start the emulator → without any action "Role not found"',
    async () => {
      await ensureRunning();
      const one = `${p}-page`;
      await seeded.role(one);
      await page.goto(rolePath(one));
      await expect(heading(page, one), `the role's page with the h1 "${one}"`).toBeVisible();
      await expect(s.main.getByRole('tab').first(), 'the role is loaded').toBeVisible();
      await markPage(page);
      await emulator.stop();
      running = false;
      await s.button(REFRESH_ROLE).click(ACTION);
      await expect(s.main.getByText(ROLE_NOT_READ, { exact: true }), `"${ROLE_NOT_READ}"`).toBeVisible({
        timeout: LINE_CHANGE_BOUND_MS,
      });
      await expect(s.main.getByText(notStartedOn(port)), "the line's status in the page").toBeVisible();
      await emulator.startAgain();
      running = true;
      await expect(s.main.getByText(NOT_FOUND, { exact: true }), `"${NOT_FOUND}" by itself`).toBeVisible({
        timeout: BACK_BOUND_MS,
      });
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
      const answer = await getRoleAnswer(ctx, port, one);
      expect(answer.ok ? 'found' : answer.code, `a direct GetRole of ${one} after the restart`).toBe('NoSuchEntity');
    },
  );

  await lines.line(
    'On a complete wizard\'s step 3, stop the emulator and "Create role" → the wizard stays with every value and shows "The emulator did not answer" with the engine\'s message above its buttons; start the emulator, "Create role" → the list, and the role exists in the emulator',
    async () => {
      await ensureRunning();
      const made = `${p}-wizard`;
      const description = `Made while stopped ${p}`;
      seeded.adopt(made);
      await fillWizard(page, made, description);
      await emulator.stop();
      running = false;
      // Settled either way, so a line that fails before awaiting it leaves no rejection behind.
      const answered = page
        .waitForResponse(
          (r) =>
            r.url().startsWith(stack.engine.url) &&
            new URLSearchParams(r.request().postData() ?? '').get('Action') === 'CreateRole',
          { timeout: 20_000 },
        )
        .catch(() => null);
      await s.button(CREATE).click(ACTION);
      const response = await answered;
      expect(response, 'the page sent CreateRole to the engine and it answered').not.toBeNull();
      if (response === null) return;
      const message = textAt(xmlTree(await response.text()), 'ErrorResponse', 'Error', 'Message') ?? '';
      ctx.log(`the engine answered CreateRole ${String(response.status())}: ${message}`);
      expect(response.status(), "the engine's answer to CreateRole").toBe(503);
      await expect(s.main.getByText(EMULATOR_SILENT), `"${EMULATOR_SILENT}"`).toBeVisible();
      expect(message, "the engine's message").not.toBe('');
      await expect(s.main, "the engine's message").toContainText(message);
      await expect(heading(page, STEP_3), 'the wizard stays on step 3').toBeVisible();
      await expect(s.main.getByLabel(F_NAME, { exact: true }), 'the name').toHaveValue(made);
      await expect(s.main.getByLabel(F_DESCRIPTION, { exact: true }), 'the description').toHaveValue(description);
      const above = await s.main.evaluate(
        (el, { text, button }) => {
          const failure = [...el.querySelectorAll('*')].find(
            (x) => x.children.length === 0 && (x.textContent ?? '').includes(text),
          );
          const create = [...el.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === button);
          if (!failure || !create) return null;
          return failure.getBoundingClientRect().bottom <= create.getBoundingClientRect().top + 0.5;
        },
        { text: EMULATOR_SILENT, button: CREATE },
      );
      expect(above, `"${EMULATOR_SILENT}" above the buttons`).toBe(true);

      await emulator.startAgain();
      running = true;
      await expectLine(page, connectedAt(port), BACK_BOUND_MS);
      await s.button(CREATE).click(ACTION);
      await expect
        .poll(async () => (await flashTexts(page)).some((t) => t.includes(createdText(made))), {
          message: `the Flashbar says "${createdText(made)}"`,
          timeout: 20_000,
        })
        .toBe(true);
      await expect(s.h1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
      const answer = await getRoleAnswer(ctx, port, made);
      expect(answer.ok, `a direct GetRole of ${made}`).toBe(true);
    },
  );

  await ensureRunning();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-screens-say-when-the-engine-stops-answering', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const engine = stack.engine;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rsengine');
  const seeded = new IamSeeded(ctx, port);
  const kept = `${p}-kept`;
  await seeded.role(kept);
  const s = screen(page);
  let running = true;

  async function ensureRunning(): Promise<void> {
    if (!running) {
      await engine.startAgain();
      running = true;
    }
  }

  await lines.line(
    'Stop the engine and choose "Refresh roles" on the role list → within two connection checks the table shows "The EmuForge engine at `<engine origin>` is not answering", as the emulator line does, with "The role list could not be read." and "Retry"',
    async () => {
      await openList(page);
      await applyFilter(page, p);
      await expectNames(page, [kept], 'the rows under the filter <p>');
      await markPage(page);
      await engine.stop();
      running = false;
      await s.button(REFRESH).click(ACTION);
      await expectListFailure(page, engineNotAnswering(engine.url), false);
      await expectLine(page, engineNotAnswering(engine.url));
    },
  );

  await lines.line(
    'Start the engine again → without a reload the rows return (the filter `<p>` lists what a direct `ListRoles` holds with that text)',
    async () => {
      if (running) {
        await openList(page);
        await applyFilter(page, p);
        await markPage(page);
        await engine.stop();
        running = false;
      }
      await engine.startAgain();
      running = true;
      await expectLine(page, connectedAt(port), BACK_BOUND_MS);
      const direct = containing(await roleNamesDirect(ctx, port), p);
      expect(direct, 'a direct ListRoles under <p>').toEqual([kept]);
      if ((await s.filter.inputValue(ACTION)) !== p) await applyFilter(page, p);
      await expectNames(page, direct, 'the rows under the filter <p> once the engine answers', BACK_BOUND_MS);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'With a role selected and the delete dialog open with `delete` typed, stop the engine and choose "Delete" → the dialog closes with an error item that the engine did not answer; start the engine → a direct `GetRole` returns the role',
    async () => {
      await ensureRunning();
      await openList(page);
      await applyFilter(page, p);
      await expectNames(page, [kept], 'the rows under the filter <p>');
      await s.main.getByRole('checkbox', { name: kept, exact: true }).check(ACTION);
      await s.button(DELETE).click(ACTION);
      const dialog = page.getByRole('dialog', { name: 'Delete 1 role?' });
      await expect(dialog, 'the dialog "Delete 1 role?"').toBeVisible();
      await dialog.getByLabel(CONFIRM_FIELD).fill('delete', ACTION);
      await engine.stop();
      running = false;
      await dialog.getByRole('button', { name: DELETE, exact: true }).click(ACTION);
      await expect(dialog, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expect
        .poll(async () => (await flashTexts(page)).some((t) => t.includes(engineSilent(engine.url))), {
          message: `an error item "${engineSilent(engine.url)}"`,
        })
        .toBe(true);
      await engine.startAgain();
      running = true;
      const answer = await getRoleAnswer(ctx, port, kept);
      expect(answer.ok, `a direct GetRole of ${kept}`).toBe(true);
    },
  );

  await ensureRunning();
  lines.end();
});
