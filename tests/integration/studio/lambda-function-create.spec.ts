// The form "Create Event Function" in the built app served by `bun run serve`, in front of a real engine started for
// that Studio and the run's emulator (test-criteria.md, issue 84, Flow checks; requirement R6.2 to R6.6, R10.3): a
// function made through the form exists in the emulator with what the form sent and runs; what the form refuses
// sends nothing; the emulator's refusal is shown and the role made before it stays; a double press makes one
// function; an abandoned form keeps nothing.
//
// `studio.lambda-function-create-appears-in-the-emulator`, `studio.lambda-function-create-refusals-create-nothing`,
// `studio.lambda-function-create-repeated-and-abandoned`.
//
// Other checks make functions and roles on the run's emulator at the same time, so every name here is under the
// check's prefix `<p>`, and "nothing new in the emulator" compares the functions and roles a refused form could
// have made: those under `<p>`, and roles whose name starts with "-role-" (what "Create default role" would name for
// an empty function name, R6.5). Words and readers: `support/lambda-page.ts` and `support/lambda-list.ts`; direct
// calls: `support/lambda.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { hasFocus } from './support/focus';
import { ACTION, addressOf, heading } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import {
  attachedPoliciesDirect,
  BASIC_EXECUTION_POLICY,
  createFunctionDirect,
  functionConfigurationDirect,
  functionNamesDirect,
  getFunctionDirect,
  getRoleDirect,
  invokeDirect,
  isGreeting,
  LambdaSeeded,
  listRolesDirect,
  shownDirect,
  waitForState,
} from './support/lambda';
import {
  applyFilter,
  CREATE,
  expectNames,
  flashTexts,
  functionPath,
  FUNCTIONS_PATH,
  openList,
  screen,
} from './support/lambda-list';
import {
  BEING_CREATED,
  CREATE_DEFAULT_ROLE,
  CREATE_FAILED,
  createdFlash,
  createForm,
  ENTER_NAME,
  fillForm,
  formKeeps,
  FUNCTION_NAME,
  messageUnder,
  NAME_ALPHABET,
  openCreateForm,
  roleStillThere,
  ROLE_STILL_THERE,
  runtimeOf,
  shownAboveButtons,
  USE_ANOTHER_ROLE,
  type FormValues,
} from './support/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix, appeared, watchText } from './support/s3';

/** How long the form may take from "Create Event Function" to the function's page (three requests in order). */
const CREATE_BOUND_MS = 20_000;

/** The role name "Create default role" gives a function `name` starts with this (R6.5). */
const roleStart = (name: string) => `${name}-role-`;

/** The role's name from its ARN. */
const roleNameOf = (arn: string) => arn.split('/').pop() ?? '';

/** Waits until one of the area's Flashbar items holds every one of `parts`. */
async function expectFlash(page: Page, parts: string[], message: string): Promise<void> {
  await expect
    .poll(async () => (await flashTexts(page)).some((t) => parts.every((part) => t.includes(part))), {
      message,
      timeout: CREATE_BOUND_MS,
    })
    .toBe(true);
}

/** Presses "Create Event Function" and waits for the page of `name`. */
async function createAndOpen(page: Page, name: string): Promise<void> {
  await createForm(page).create.click(ACTION);
  await expect(page).toHaveURL(addressOf(functionPath(name)), { timeout: CREATE_BOUND_MS });
  await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-create-appears-in-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfc-appears');
  const seeded = new LambdaSeeded(ctx, port, p);
  const made: string[] = [];
  const first = `${p}-new`;
  /** The role "Create default role" made for `first`, once the first line read it. */
  let defaultRole: string | null = null;

  await lines.line(
    'Create `<p>-new` as the form opens ("Node.js 24.x", "x86_64", "Create default role") → the function\'s page with `h1` `<p>-new` and the Flashbar naming the function and its role; "Being created" shows and clears without any action; a direct `GetFunction` returns runtime `nodejs24.x`, architecture `x86_64`, handler `index.handler` and a role ARN under `/service-role/` whose name starts with `<p>-new-role-`',
    async () => {
      await openCreateForm(page);
      await watchText(page, BEING_CREATED);
      await createForm(page).name.fill(first, ACTION);
      await createAndOpen(page, first);
      made.push(first);
      const read = await getFunctionDirect(ctx, port, first);
      expect(read.found, `a direct GetFunction ${first}`).toBe(true);
      if (!read.found) return;
      const c = read.configuration;
      ctx.log(
        `direct GetFunction ${first}: ${JSON.stringify({ runtime: c.Runtime, architectures: c.Architectures, handler: c.Handler, role: c.Role })}`,
      );
      defaultRole = roleNameOf(c.Role);
      expect(
        { runtime: c.Runtime, architectures: c.Architectures, handler: c.Handler },
        `what ${first} was created with`,
      ).toEqual({ runtime: 'nodejs24.x', architectures: ['x86_64'], handler: 'index.handler' });
      expect(c.Role, 'the role ARN is under /service-role/').toContain(':role/service-role/');
      expect(defaultRole.startsWith(roleStart(first)), `the role ${defaultRole} starts with ${roleStart(first)}`).toBe(
        true,
      );
      await expectFlash(page, [createdFlash(first, defaultRole)], `the Flashbar "${createdFlash(first, defaultRole)}"`);
      await expect
        .poll(() => appeared(page, BEING_CREATED), {
          message: `"${BEING_CREATED}" was shown`,
          timeout: CREATE_BOUND_MS,
        })
        .toBe(true);
      await expect(
        page.getByRole('main').getByText(BEING_CREATED, { exact: true }),
        `"${BEING_CREATED}" clears`,
      ).toHaveCount(0, { timeout: CREATE_BOUND_MS });
      await expect(page).toHaveURL(addressOf(functionPath(first)));
    },
  );

  await lines.line(
    'A direct IAM `GetRole` returns that role, and `ListAttachedRolePolicies` lists `AWSLambdaBasicExecutionRole` for it',
    async () => {
      const role = defaultRole ?? (await listRolesDirect(ctx, port, roleStart(first)))[0]?.name ?? null;
      expect(role, `a role that starts with ${roleStart(first)}`).not.toBeNull();
      if (role === null) return;
      const got = await getRoleDirect(ctx, port, role);
      expect(got?.name, `a direct GetRole ${role}`).toBe(role);
      expect(got?.path, `the path of ${role}`).toBe('/service-role/');
      const policies = await attachedPoliciesDirect(ctx, port, role);
      ctx.log(`policies of ${role}: ${JSON.stringify(policies)}`);
      expect(
        policies.map((x) => x.arn),
        `the policies attached to ${role}`,
      ).toContain(BASIC_EXECUTION_POLICY);
    },
  );

  await lines.line('A direct `Invoke` of `<p>-new` once it is `Active` → the greeting', async () => {
    expect(await waitForState(ctx, port, first), `${first} becomes Active`).toBe('Active');
    const invoked = await invokeDirect(ctx, port, first);
    ctx.log(
      `Invoke ${first}: status ${String(invoked.status)} ${String(invoked.errorType)} ${invoked.payload.slice(0, 200)}`,
    );
    expect(invoked.status, `a direct Invoke ${first}`).toBe(200);
    expect(
      isGreeting(invoked.payload),
      `the payload of ${first} is the greeting: ${invoked.payload.slice(0, 200)}`,
    ).toBe(true);
  });

  await lines.line(
    'For each of "Node.js 22.x", "Python 3.14" and "Python 3.13", on "arm64", with "Use another role" and a role made directly → the function exists with that runtime, `arm64` and that role, its handler is the one of R6.5, and a direct `Invoke` returns the greeting; no further role exists in the emulator\'s IAM',
    async () => {
      const roleName = `${p}-direct-role`;
      const roleArn = await seeded.role(roleName);
      const rolesBefore = (await listRolesDirect(ctx, port, p)).map((r) => r.name).sort();
      const found: string[] = [];
      for (const [label, tag] of [
        ['Node.js 22.x', 'node22'],
        ['Python 3.14', 'py314'],
        ['Python 3.13', 'py313'],
      ] as const) {
        const name = `${p}-${tag}`;
        const runtime = runtimeOf(label);
        await openCreateForm(page);
        await fillForm(page, { name, runtime: label, architecture: 'arm64', role: roleName });
        await createAndOpen(page, name);
        made.push(name);
        await expectFlash(page, [createdFlash(name, null)], `the Flashbar "${createdFlash(name, null)}"`);
        const c = await functionConfigurationDirect(ctx, port, name);
        ctx.log(
          `direct GetFunctionConfiguration ${name}: ${JSON.stringify({ runtime: c?.Runtime, architectures: c?.Architectures, handler: c?.Handler, role: c?.Role })}`,
        );
        const what =
          c === null ? null : { runtime: c.Runtime, architectures: c.Architectures, role: c.Role, handler: c.Handler };
        const wanted = { runtime: runtime.id, architectures: ['arm64'], role: roleArn, handler: runtime.handler };
        if (JSON.stringify(what) !== JSON.stringify(wanted)) {
          found.push(`${name}: ${JSON.stringify(what)}, not ${JSON.stringify(wanted)}`);
          continue;
        }
        const state = await waitForState(ctx, port, name);
        if (state !== 'Active') {
          found.push(`${name}: ${String(state)}, not Active`);
          continue;
        }
        const invoked = await invokeDirect(ctx, port, name);
        if (invoked.status !== 200 || !isGreeting(invoked.payload)) {
          found.push(`${name}: Invoke answered ${String(invoked.status)} ${invoked.payload.slice(0, 200)}`);
        }
      }
      expect(found, 'functions made with "Use another role" on arm64').toEqual([]);
      const rolesAfter = (await listRolesDirect(ctx, port, p)).map((r) => r.name).sort();
      expect(rolesAfter, 'the roles under <p> after the three forms: no further role').toEqual(rolesBefore);
    },
  );

  await lines.line('The list under the filter `<p>` shows every function created here', async () => {
    const direct = await functionNamesDirect(ctx, port, p);
    expect([...direct].sort(), 'a direct ListFunctions under <p>').toEqual([...made].sort());
    await openList(page);
    await applyFilter(page, p);
    await expectNames(page, direct, 'the rows under the filter <p>');
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-create-refusals-create-nothing', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfc-refusals');
  const seeded = new LambdaSeeded(ctx, port, p);
  const f = createForm(page);

  /** What a refused form could have made: functions and roles under `<p>`, and roles named for an empty name. */
  const mayHaveMade = (name: string) => name.startsWith(p) || name.startsWith('-role-');
  const snapshot = async () => ({
    functions: (await functionNamesDirect(ctx, port)).filter(mayHaveMade).sort(),
    roles: (await listRolesDirect(ctx, port))
      .map((r) => r.name)
      .filter(mayHaveMade)
      .sort(),
  });

  await lines.line(
    '"Create Event Function" with an empty name → "Enter a function name.", focus on the field; a direct `ListFunctions` and `ListRoles` hold nothing new',
    async () => {
      const before = await snapshot();
      await openCreateForm(page);
      await f.create.click(ACTION);
      await expect
        .poll(() => messageUnder(page, FUNCTION_NAME, ENTER_NAME), { message: `"${ENTER_NAME}" under the field` })
        .toBe(true);
      await expect.poll(() => hasFocus(f.name), { message: `focus on "${FUNCTION_NAME}"` }).toBe(true);
      expect(await snapshot(), 'functions and roles a refused form could have made').toEqual(before);
    },
  );

  await lines.line(
    'A name with a period → "Use only letters, digits, hyphens (-) and underscores (_)."; nothing new in the emulator',
    async () => {
      const before = await snapshot();
      await openCreateForm(page);
      await f.name.fill(`${p}-a.b`, ACTION);
      await f.create.click(ACTION);
      await expect
        .poll(() => messageUnder(page, FUNCTION_NAME, NAME_ALPHABET), { message: `"${NAME_ALPHABET}" under the field` })
        .toBe(true);
      expect(await snapshot(), 'functions and roles a refused form could have made').toEqual(before);
    },
  );

  // Lines 3 and 4: a function made directly whose name the form then asks for.
  const taken = `${p}-taken`;
  const description = `Made by ${p} directly`;
  await seeded.function(taken, { runtime: 'nodejs22.x', description });
  const roleName = `${p}-direct-role`;
  await seeded.role(roleName);
  // What the emulator answers a CreateFunction of a name it holds: the code and message the form is to show. The
  // name is taken, so this changes nothing.
  const refused = await createFunctionDirect(ctx, port, taken, { role: await seeded.functionRole() });
  const conflict = 'error' in refused ? null : { code: refused.errorType, message: refused.message ?? '' };
  ctx.log(`a second direct CreateFunction ${taken}: ${shownDirect(refused)}`);

  await lines.line(
    'The name of a function made directly, with "Use another role" → the form stays with every value and shows "Creating the function failed" with `ResourceConflictException` and the emulator\'s message; the function made directly is unchanged (its runtime and description as before)',
    async () => {
      expect(conflict?.code, `a second direct CreateFunction ${taken}`).toBe('ResourceConflictException');
      expect(conflict?.message, "the emulator's message for it").not.toBe('');
      const values: FormValues = { name: taken, runtime: 'Python 3.13', architecture: 'arm64', role: roleName };
      await openCreateForm(page);
      await fillForm(page, values);
      await f.create.click(ACTION);
      const parts = [CREATE_FAILED, 'ResourceConflictException', conflict?.message ?? ''];
      await expect
        .poll(() => shownAboveButtons(page, parts), {
          message: `${JSON.stringify(parts)} above the buttons`,
          timeout: CREATE_BOUND_MS,
        })
        .toBe(true);
      expect(await formKeeps(page, values), 'the form keeps every value').toEqual([]);
      await expect(page.getByRole('main'), 'no sentence about a role').not.toContainText(ROLE_STILL_THERE);
      const c = await functionConfigurationDirect(ctx, port, taken);
      expect({ runtime: c?.Runtime, description: c?.Description }, `${taken} as it was made`).toEqual({
        runtime: 'nodejs22.x',
        description,
      });
    },
  );

  await lines.line(
    'The same name with "Create default role" → the failure, followed by the sentence that the role was created and is still there; a direct `GetRole` returns that role; pressing again creates no second role (a direct `ListRoles` holds one role whose name starts with the function\'s name)',
    async () => {
      const values: FormValues = { name: taken };
      await openCreateForm(page);
      await fillForm(page, values);
      await f.create.click(ACTION);
      await expect
        .poll(async () => (await listRolesDirect(ctx, port, roleStart(taken))).length, {
          message: `a role starting with ${roleStart(taken)} in the emulator`,
          timeout: CREATE_BOUND_MS,
        })
        .toBe(1);
      const role = (await listRolesDirect(ctx, port, roleStart(taken)))[0].name;
      const parts = [CREATE_FAILED, 'ResourceConflictException', roleStillThere(role)];
      await expect
        .poll(() => shownAboveButtons(page, parts), {
          message: `${JSON.stringify(parts)} above the buttons`,
          timeout: CREATE_BOUND_MS,
        })
        .toBe(true);
      const text = (await page.getByRole('main').innerText(ACTION)).replace(/\s+/g, ' ');
      expect(
        text.indexOf(CREATE_FAILED) >= 0 && text.indexOf(roleStillThere(role)) > text.indexOf(CREATE_FAILED),
        'the sentence about the role follows the failure',
      ).toBe(true);
      expect((await getRoleDirect(ctx, port, role))?.name, `a direct GetRole ${role}`).toBe(role);
      expect(await formKeeps(page, values), 'the form keeps every value').toEqual([]);
      await f.create.click(ACTION);
      await expect
        .poll(() => shownAboveButtons(page, [CREATE_FAILED, 'ResourceConflictException']), {
          message: 'the failure again after the second press',
          timeout: CREATE_BOUND_MS,
        })
        .toBe(true);
      const roles = (await listRolesDirect(ctx, port, taken)).map((r) => r.name);
      expect(roles, `roles whose name starts with ${taken} after the second press`).toEqual([role]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-create-repeated-and-abandoned', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfc-repeated');
  // Deletes every function and role under `<p>` when the check ends, those Studio made included.
  new LambdaSeeded(ctx, port, p);
  const f = createForm(page);

  await lines.line(
    'A valid form, "Create Event Function" pressed twice quickly → one function and one role with that prefix in the emulator',
    async () => {
      const name = `${p}-twice`;
      await openCreateForm(page);
      await f.name.fill(name, ACTION);
      await f.create.dblclick(ACTION);
      await expect(page).toHaveURL(addressOf(functionPath(name)), { timeout: CREATE_BOUND_MS });
      expect(await functionNamesDirect(ctx, port, name), `functions whose name starts with ${name}`).toEqual([name]);
      const roles = (await listRolesDirect(ctx, port, name)).map((r) => r.name);
      ctx.log(`roles starting with ${name}: ${JSON.stringify(roles)}`);
      expect(roles, `roles whose name starts with ${name}`).toHaveLength(1);
      expect(roles[0]?.startsWith(roleStart(name)), `the one role starts with ${roleStart(name)}`).toBe(true);
    },
  );

  await lines.line(
    'Type a name, "Cancel", open the form again → an empty form; no function of that name exists',
    async () => {
      const name = `${p}-cancelled`;
      await openList(page);
      await markPage(page);
      await screen(page).create.click(ACTION);
      await expect(f.h1, `the h1 "${CREATE}"`).toBeVisible();
      await f.name.fill(name, ACTION);
      await f.cancel.click(ACTION);
      await expect(page).toHaveURL(addressOf(FUNCTIONS_PATH));
      await screen(page).create.click(ACTION);
      await expect(f.h1, `the h1 "${CREATE}" again`).toBeVisible();
      expect(await stillSamePage(page), 'the form was opened again without a reload').toBe(true);
      await expect(f.name, `"${FUNCTION_NAME}" of the form opened again`).toHaveValue('');
      await expect(f.radio(CREATE_DEFAULT_ROLE), `"${CREATE_DEFAULT_ROLE}" of the form opened again`).toBeChecked();
      expect(await functionNamesDirect(ctx, port, name), `functions named ${name}`).toEqual([]);
    },
  );

  await lines.line(
    "Type a name, go back in the browser's history, go forward → an empty form; no function of that name exists",
    async () => {
      const name = `${p}-abandoned`;
      await openList(page);
      await markPage(page);
      await screen(page).create.click(ACTION);
      await expect(f.h1, `the h1 "${CREATE}"`).toBeVisible();
      await f.name.fill(name, ACTION);
      await f.radio(USE_ANOTHER_ROLE).check(ACTION);
      await page.goBack();
      await expect(page).toHaveURL(addressOf(FUNCTIONS_PATH));
      await page.goForward();
      await expect(f.h1, `the h1 "${CREATE}" after going forward`).toBeVisible();
      expect(await stillSamePage(page), 'the history moved without a reload').toBe(true);
      await expect(f.name, `"${FUNCTION_NAME}" after going forward`).toHaveValue('');
      await expect(f.radio(CREATE_DEFAULT_ROLE), `"${CREATE_DEFAULT_ROLE}" after going forward`).toBeChecked();
      expect(await functionNamesDirect(ctx, port, name), `functions named ${name}`).toEqual([]);
    },
  );

  lines.end();
});
