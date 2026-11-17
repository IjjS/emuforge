// The five rules every AWS screen follows, on IAM's three screens, in the built app served by `bun run serve`, in front
// of a real engine and the run's emulator (test-criteria.md, issue 467, "Flow checks, new"; requirement R3 to R6): the
// page says where the roles are once, the wizard and the dialog "Edit summary" state each checked field's rule before
// a submit, the role's ARN has a copy control, and a long value breaks where it can be read.
//
// `studio.iam-screens-say-where-once`, `studio.iam-role-create-states-the-field-rules`,
// `studio.iam-role-page-copies-the-arn`, `studio.iam-values-break-where-they-can-be-read`.
//
// Other checks make roles on the run's emulator at the same time, so each check names its roles with its own prefix
// `<p>` and reads its own roles by name; the list is read under the filter `<p>`. Roles are made and read directly
// with `support/iam.ts`; every role Studio may make is adopted, so it is taken apart when the check ends. The check of
// how values break needs a name of 24 characters that starts with `<p>`, so its prefix is `shortPrefix`. The readers
// of the rules (drawn lines, the clipboard, how often a text is on the page, the header, a field's texts, a pair's
// value, a table's cell): `support/screen-rules.ts`.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, endpointPattern, expectLine } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { getRoleDirect, IamSeeded, tooLongRoleIsGone, type DirectRole } from './support/iam';
import { Lines } from './support/lines';
import { checkPrefix, scrollsSideways } from './support/s3';
import {
  breakAfterProblems,
  cellUnder,
  clipboardText,
  copiedText,
  copyControl,
  drawnLines,
  fieldTexts,
  fieldTextsIn,
  grantClipboard,
  nameOfLength,
  oneLineProblems,
  pageHeader,
  pairValueOf,
  setClipboard,
  shortPrefix,
  timesOnPage,
  whereWords,
} from './support/screen-rules';

// ---------------------------------------------------------------------------------------------------------------
// The screens' words (issue 82's screens; issue 467 requirement R3, R4, R5; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const CREATE_PATH = '/aws/iam/roles/create';
const LIST_H1 = 'Roles';
const FILTER = 'Search items';
const COL_NAME = 'Role name';
const NOT_FOUND = 'Role not found';
/** The tab that is enabled once the role is read (the tabs show, disabled, while "Loading role" is up). */
const TRUST_TAB = 'Trust relationships';

const STEP_TITLES = ['Select trusted entity', 'Add permissions', 'Name, review, and create'] as const;
const NEXT = 'Next';
const CREATE = 'Create role';
const T_SERVICE = 'AWS service';
const T_ACCOUNT = 'AWS account';
const ANOTHER_ACCOUNT = 'Another AWS account';
const F_SERVICE = 'Service or use case';
const F_ACCOUNT_ID = 'Account ID';
const F_NAME = 'Role name';
const F_DESCRIPTION = 'Description';

/** "Edit" of "Summary" and its dialog (issue 82 R5.5). */
const EDIT = 'Edit';
const EDIT_DIALOG = 'Edit summary';
const F_SECONDS = 'Seconds';
const CUSTOM = 'Custom duration';
const SAVE = 'Save changes';

/** "Summary"'s ARN (issue 82 R5.3). */
const F_ARN = 'ARN';

/** The list's description (R3). */
const LIST_DESCRIPTION = 'Last activity is what the emulator reports for a role.';

/** The constraint texts (R4). */
const NAME_RULE = '1 to 64 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -.';
const DESCRIPTION_RULE = 'Up to 1000 characters.';
const ACCOUNT_RULE = '12 digits.';
const SECONDS_RULE = 'A whole number from 3600 to 43200.';

/** The message of a name longer than 64 characters (issue 82 R6.6, its test criteria). */
const NAME_TOO_LONG = 'The name can have up to 64 characters.';

/** How long "Create role" may take to the list. */
const CREATE_BOUND_MS = 20_000;

function rolePath(name: string): string {
  return `/aws/iam/roles/details/${encodeURIComponent(name)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The screens.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
const LIST_TABLE = wrapper.findTable().toSelector();
const SELECT_TRIGGER = wrapper.findSelect().findTrigger().toSelector();

function screen(page: Page) {
  const main = page.getByRole('main');
  const dialog = page.getByRole('dialog', { name: EDIT_DIALOG });
  return {
    main,
    listH1: main.getByRole('heading', { level: 1, name: new RegExp(`^${LIST_H1}(\\s|$)`) }),
    listTable: page.locator(LIST_TABLE).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    step: (k: 1 | 2 | 3) => heading(page, STEP_TITLES[k - 1]),
    button: (name: string) => main.getByRole('button', { name, exact: true }),
    radio: (name: string) => main.getByRole('radio', { name, exact: true }),
    service: main.getByLabel(F_SERVICE, { exact: true }),
    accountId: main.getByLabel(F_ACCOUNT_ID, { exact: true }),
    roleName: main.getByLabel(F_NAME, { exact: true }),
    description: main.getByLabel(F_DESCRIPTION, { exact: true }),
    dialog,
    duration: page.locator(SELECT_TRIGGER).first(),
    seconds: dialog.getByLabel(F_SECONDS, { exact: true }),
    save: dialog.getByRole('button', { name: SAVE, exact: true }),
  };
}

async function sizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
}

/** The list under the filter `text`, connected to the emulator on `port`, its rows exactly `names`. */
async function listUnder(page: Page, port: number, text: string, names: string[]): Promise<void> {
  const s = screen(page);
  await page.goto(ROLES_PATH);
  await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
  await expectLine(page, connectedAt(port), 20_000);
  await s.filter.fill(text, ACTION);
  await s.filter.press('Enter', ACTION);
  await expect
    .poll(
      async () => (await s.listTable.locator('tbody tr').getByRole('link').allInnerTexts()).map((t) => t.trim()).sort(),
      { message: `the rows under the filter ${text}` },
    )
    .toEqual([...names].sort());
}

/**
 * Opens the page of `role` and waits until it is read: the `h1`, the tab "Trust relationships" enabled and the ARN in
 * "Summary" as a direct answer gives it. The `h1` and the first tab show while the role is still read.
 */
async function openRead(page: Page, role: DirectRole): Promise<void> {
  await page.goto(rolePath(role.name));
  await expect(heading(page, role.name), `the role's page with the h1 "${role.name}"`).toBeVisible();
  await expect(screen(page).main.getByRole('tab', { name: TRUST_TAB, exact: true }), 'the role is read').toBeEnabled();
  await expect(pairValueOf(page, F_ARN), `"${F_ARN}" of ${role.name}`).toContainText(role.arn);
}

/** Opens the wizard at step `k` by its address and waits for the step's title. */
async function openWizard(page: Page, k: 1 | 2 | 3 = 1): Promise<void> {
  await page.goto(k === 1 ? CREATE_PATH : `${CREATE_PATH}?step=${String(k)}`);
  await expect(screen(page).step(k), `the wizard's step ${String(k)}`).toBeVisible();
}

/** "Next", then waits for step `k`. */
async function next(page: Page, k: 2 | 3): Promise<void> {
  await screen(page).button(NEXT).click(ACTION);
  await expect(screen(page).step(k), `step ${String(k)} after "${NEXT}"`).toBeVisible();
}

/** The wizard from step 1, "AWS service" `lambda.amazonaws.com`, up to step 3 with `name` and `description`. */
async function completeWizard(page: Page, name: string, description?: string): Promise<void> {
  const s = screen(page);
  await openWizard(page);
  await s.radio(T_SERVICE).check(ACTION);
  await s.service.fill('lambda.amazonaws.com', ACTION);
  await s.service.press('Tab', ACTION);
  await next(page, 2);
  await next(page, 3);
  await s.roleName.fill(name, ACTION);
  if (description !== undefined) await s.description.fill(description, ACTION);
}

/** A free text of exactly `length` characters, in words. */
function textOfLength(length: number): string {
  const words = ['kept', 'to', 'see', 'how', 'long', 'a', 'description', 'may', 'be'];
  let text = '';
  for (let i = 0; text.length < length; i++) text += `${text === '' ? '' : ' '}${words[i % words.length]}`;
  return text.slice(0, length).replace(/\s$/, 'x');
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-screens-say-where-once', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'isr-where');
  const seeded = new IamSeeded(ctx, port);
  const role = await seeded.role(`${p}-a`);
  const missing = `${p}-missing`;
  const endpoint = endpointPattern(port);

  const screens: { name: string; open: () => Promise<void> }[] = [
    { name: 'the list', open: () => listUnder(page, port, p, [role.name]) },
    {
      name: "a role's page",
      open: async () => {
        await openRead(page, role);
        await expectLine(page, connectedAt(port), 20_000);
      },
    },
    {
      name: `"${NOT_FOUND}"`,
      open: async () => {
        await page.goto(rolePath(missing));
        await expect(screen(page).main.getByText(NOT_FOUND, { exact: true }).first(), `"${NOT_FOUND}"`).toBeVisible({
          timeout: 20_000,
        });
        await expectLine(page, connectedAt(port), 20_000);
      },
    },
    ...([1, 2, 3] as const).map((k) => ({
      name: `the wizard's step ${String(k)}`,
      open: async () => {
        await openWizard(page, k);
        await expectLine(page, connectedAt(port), 20_000);
      },
    })),
  ];

  await lines.line(
    'Open the list, a role\'s page, "Role not found" and each step of the wizard, connected → on each the endpoint the emulator line shows is on the page once and the header holds neither "AWS account" nor "local emulator"',
    async () => {
      const found: string[] = [];
      for (const screenOf of screens) {
        await screenOf.open();
        const times = await timesOnPage(page, endpoint);
        if (times !== 1) found.push(`${screenOf.name}: the endpoint is on the page ${String(times)} times`);
        const header = await pageHeader(page);
        ctx.log(`${screenOf.name}: header ${JSON.stringify(header)}`);
        for (const words of whereWords(header)) found.push(`${screenOf.name}: the header holds "${words}"`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line('The list → under the `h1`: "Last activity is what the emulator reports for a role."', async () => {
    await listUnder(page, port, p, [role.name]);
    const header = await pageHeader(page);
    ctx.log(`the list's header ${JSON.stringify(header)}`);
    expect(header?.description ?? null, "the description under the list's h1").toBe(LIST_DESCRIPTION);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-create-states-the-field-rules', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'isr-field');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);
  const longest = nameOfLength(`${p}+=,.@_-`, 64);
  const tooLong = nameOfLength(`${p}-long-`, 65);
  seeded.adopt(longest);
  seeded.adopt(tooLong);
  const edited = await seeded.role(`${p}-edit`);

  await lines.line(
    'On step 3 → under "Role name": "1 to 64 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -."; under "Description": "Up to 1000 characters."; no message is shown',
    async () => {
      await openWizard(page, 3);
      await expect(s.roleName, `"${F_NAME}"`).toBeVisible();
      const name = await fieldTexts(page, F_NAME);
      const description = await fieldTexts(page, F_DESCRIPTION);
      ctx.log(`"${F_NAME}": ${JSON.stringify(name)}; "${F_DESCRIPTION}": ${JSON.stringify(description)}`);
      expect({ name, description }, 'what the two fields show under them').toEqual({
        name: { fields: 1, constraint: NAME_RULE, error: null },
        description: { fields: 1, constraint: DESCRIPTION_RULE, error: null },
      });
    },
  );

  await lines.line(
    'On step 1 with "AWS account", "Another AWS account" → under "Account ID": "12 digits."',
    async () => {
      await openWizard(page, 1);
      await s.radio(T_ACCOUNT).check(ACTION);
      await s.radio(ANOTHER_ACCOUNT).check(ACTION);
      await expect(s.accountId, `"${F_ACCOUNT_ID}"`).toBeVisible();
      const texts = await fieldTexts(page, F_ACCOUNT_ID);
      ctx.log(`"${F_ACCOUNT_ID}": ${JSON.stringify(texts)}`);
      expect(texts.constraint, `the constraint text under "${F_ACCOUNT_ID}"`).toBe(ACCOUNT_RULE);
    },
  );

  await lines.line(
    'Complete the wizard with a name of 64 characters starting with `<p>` that holds each of `+ = , . @ _ -` and a description of 1000 characters → the list; a direct `GetRole` returns that name and a description of 1000 characters',
    async () => {
      const description = textOfLength(1000);
      expect(longest.length, 'the name is 64 characters long').toBe(64);
      expect(description.length, 'the description is 1000 characters long').toBe(1000);
      await completeWizard(page, longest, description);
      await s.button(CREATE).click(ACTION);
      await expect(page, 'the list opens').toHaveURL(addressOf(ROLES_PATH), { timeout: CREATE_BOUND_MS });
      await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
      const direct = await getRoleDirect(ctx, port, longest);
      expect({ name: direct.name, description: direct.description }, `a direct GetRole ${longest}`).toEqual({
        name: longest,
        description,
      });
    },
  );

  await lines.line(
    'A name of 65 characters, "Create role" → the message about the length beside the constraint text; a direct `GetRole` of it answers that the role cannot be found',
    async () => {
      expect(tooLong.length, 'the name is 65 characters long').toBe(65);
      await completeWizard(page, tooLong);
      await s.button(CREATE).click(ACTION);
      await expect
        .poll(() => fieldTexts(page, F_NAME), { message: `what "${F_NAME}" shows under it` })
        .toEqual({ fields: 1, constraint: NAME_RULE, error: NAME_TOO_LONG });
      await expect(s.step(3), 'step 3 stays').toBeVisible();
      expect(await tooLongRoleIsGone(ctx, port, tooLong), `a direct GetRole of ${tooLong}`).toBe(true);
    },
  );

  await lines.line(
    'On the page of a role made directly, "Edit", "Custom duration" → under "Description": "Up to 1000 characters."; under "Seconds": "A whole number from 3600 to 43200."; type 43200, "Save changes" → a direct `GetRole` reports 43200',
    async () => {
      await openRead(page, edited);
      await s.main.getByRole('button', { name: EDIT, exact: true }).click(ACTION);
      await expect(s.dialog, `the dialog "${EDIT_DIALOG}"`).toBeVisible();
      await s.duration.click(ACTION);
      await page.getByRole('option', { name: CUSTOM, exact: true }).click(ACTION);
      await expect(s.seconds, `"${F_SECONDS}"`).toBeVisible();
      const description = await fieldTextsIn(s.dialog, F_DESCRIPTION);
      const seconds = await fieldTextsIn(s.dialog, F_SECONDS);
      ctx.log(`"${F_DESCRIPTION}": ${JSON.stringify(description)}; "${F_SECONDS}": ${JSON.stringify(seconds)}`);
      const shown = { description: description.constraint, seconds: seconds.constraint };
      await s.seconds.fill('43200', ACTION);
      await s.save.click(ACTION);
      await expect(s.dialog, 'the dialog closes').toHaveCount(0, { timeout: CREATE_BOUND_MS });
      await expect
        .poll(async () => (await getRoleDirect(ctx, port, edited.name)).maxSessionDuration, {
          message: `a direct GetRole ${edited.name}: MaxSessionDuration`,
        })
        .toBe(43200);
      expect(shown, 'the constraint texts in the dialog').toEqual({
        description: DESCRIPTION_RULE,
        seconds: SECONDS_RULE,
      });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-page-copies-the-arn', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'isr-copy');
  const seeded = new IamSeeded(ctx, port);
  const role = await seeded.role(`${p}-role`, { path: `/${p}/` });
  await grantClipboard(context, stack.studio.origin);

  await lines.line(
    'On the page of a role made directly with the path `/<p>/`, press "Copy ARN" → "ARN copied" is shown and the clipboard\'s text equals the `Arn` a direct `GetRole` returns',
    async () => {
      const direct = await getRoleDirect(ctx, port, role.name);
      expect(direct.path, `the path of ${role.name}`).toBe(`/${p}/`);
      await openRead(page, direct);
      await setClipboard(page, 'before');
      await screen(page)
        .main.getByRole('button', { name: copyControl(F_ARN), exact: true })
        .click(ACTION);
      await expect(page.getByText(copiedText(F_ARN), { exact: true }).first()).toBeVisible();
      await expect.poll(() => clipboardText(page), { message: "the clipboard's text" }).toBe(direct.arn);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-values-break-where-they-can-be-read', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = shortPrefix(ctx, 'iv');
  const seeded = new IamSeeded(ctx, port);
  const name = nameOfLength(`${p}-`, 24);
  const role = await seeded.role(name, { path: `/${p}/team/` });

  await lines.line(
    'On the page of a role made directly with the path `/<p>/team/`, its name 24 characters starting with `<p>` → "ARN" is drawn on more than one line and every line of it but the last ends with `:` or `/` — 390 wide',
    async () => {
      expect(name.length, 'the name is 24 characters long').toBe(24);
      await sizeTo(page, 390);
      await openRead(page, role);
      const arn = await drawnLines(pairValueOf(page, F_ARN), role.arn);
      ctx.log(`"${F_ARN}" ${role.arn} drawn ${JSON.stringify(arn)}`);
      await sizeTo(page, 1280);
      expect(breakAfterProblems(arn, [':', '/'], `"${F_ARN}"`)).toEqual([]);
    },
  );

  await lines.line(
    'The list under the filter `<p>`, with that role → the name is on one line; the page does not scroll sideways — 1280 and 390 wide',
    async () => {
      const found: string[] = [];
      for (const width of [1280, 390]) {
        await sizeTo(page, width);
        await listUnder(page, port, p, [name]);
        const cell = await cellUnder(screen(page).listTable, name, COL_NAME);
        const at = `${String(width)} wide`;
        found.push(...oneLineProblems(await drawnLines(cell, name), `${at}: the name`));
        if (await scrollsSideways(page)) found.push(`${at}: the page scrolls sideways`);
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  lines.end();
});
