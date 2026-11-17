// "Create role" in the built app served by `bun run serve`, in front of a real engine started for that Studio and the
// run's emulator (test-criteria.md, issue 82, Flow checks; requirement R6.2 to R6.8, R10.3): roles of each trusted
// entity type with policies, a description and a tag, as the emulator then reports them and the AWS CLI lists them;
// what the form refuses and what the emulator refuses; a double press, "Cancel", leaving and coming back, and a reload.
//
// `studio.iam-role-create-appears-in-the-emulator`, `studio.iam-role-create-refusals-create-nothing`,
// `studio.iam-role-create-repeated-and-abandoned`.
//
// Other checks make roles on the run's emulator at the same time, so each check names its roles with its own prefix
// `<p>` (lower-case letters and digits). Roles and policies are made and read directly with `support/iam.ts`; every
// role Studio may have made is adopted, so it is taken apart when the check ends. An emulator's refusal the wizard
// must show is read from the emulator itself with the same request sent directly, which it refuses and so changes
// nothing (requirement R2, `CreateRole`).

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { crumbLink } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import {
  attachedPoliciesDirect,
  awsCli,
  callerUserDirect,
  containing,
  createRoleParams,
  getRoleDirect,
  iamAnswer,
  IamSeeded,
  instanceProfilesForRoleDirect,
  READ_ONLY_ACCESS,
  roleIsGone,
  roleNamesDirect,
  type DirectRole,
} from './support/iam';
import { markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R6, R9.4, R10.3; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const CREATE_PATH = '/aws/iam/roles/create';
const LIST_H1 = 'Roles';
const FILTER = 'Search items';
const COL_NAME = 'Role name';
const COL_TRUSTED = 'Trusted entities';

/** The three steps' titles, each the page's `h1` while it is shown (R6.2). */
const STEP_TITLES = ['Select trusted entity', 'Add permissions', 'Name, review, and create'] as const;

const NEXT = 'Next';
const PREVIOUS = 'Previous';
const CANCEL = 'Cancel';
const CREATE = 'Create role';

/** Step 1 (R6.3). */
const T_SERVICE = 'AWS service';
const T_ACCOUNT = 'AWS account';
const T_CUSTOM = 'Custom trust policy';
const F_SERVICE = 'Service or use case';
const THIS_ACCOUNT = 'This account';
const ANOTHER_ACCOUNT = 'Another AWS account';
const F_ACCOUNT_ID = 'Account ID';
const REQUIRE_EXTERNAL_ID = 'Require external ID';
const F_EXTERNAL_ID = 'External ID';
const REQUIRE_MFA = 'Require MFA';
const F_CUSTOM = 'Custom trust policy';

/** Step 2 (R6.4) and step 3 (R6.5). */
const POLICIES = 'Permissions policies';
const COL_POLICY = 'Policy name';
const F_NAME = 'Role name';
const F_DESCRIPTION = 'Description';
const ADD_TAG = 'Add new tag';

/** The rules' messages (R6.6). */
const M_SERVICE = 'Enter a service principal.';
const M_NAME_SIGNS = 'Use only letters, digits and +=,.@_-';

/** The Flashbar's success item (R6.7) and the wizard's failure title (R10.3). */
function createdText(name: string): string {
  return `Role “${name}” was created in the local emulator.`;
}
const CREATE_FAILED = 'Creating the role failed';

/** The check's own prefix `<p>`: `efit<run id><tag>`, lower-case letters and digits only. */
function rolePrefix(ctx: Ctx, tag: string): string {
  return `efit${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')}${tag}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
const FLASH_ITEMS = wrapper.findFlashbar().findItems().toSelector();
const LIST_TABLE = wrapper.findTable().toSelector();
const TAG_EDITOR = wrapper.findTagEditor();
const TAG_KEY = `${TAG_EDITOR.findRow(1).findField(1).findControl().toSelector()} input`;
const TAG_VALUE = `${TAG_EDITOR.findRow(1).findField(2).findControl().toSelector()} input`;

function screen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    step: (k: 1 | 2 | 3) => heading(page, STEP_TITLES[k - 1]),
    button: (name: string) => main.getByRole('button', { name, exact: true }),
    radio: (name: string) => main.getByRole('radio', { name, exact: true }),
    checkbox: (name: string) => main.getByRole('checkbox', { name, exact: true }),
    service: main.getByLabel(F_SERVICE, { exact: true }),
    accountId: main.getByLabel(F_ACCOUNT_ID, { exact: true }),
    externalId: main.getByLabel(F_EXTERNAL_ID, { exact: true }),
    custom: main.getByRole('textbox', { name: F_CUSTOM, exact: true }),
    policies: main.getByRole('table', { name: POLICIES, exact: true }),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    roleName: main.getByLabel(F_NAME, { exact: true }),
    description: main.getByLabel(F_DESCRIPTION, { exact: true }),
    tagKey: page.locator(TAG_KEY),
    tagValue: page.locator(TAG_VALUE),
    flashItems: page.locator(FLASH_ITEMS),
    listH1: main.getByRole('heading', { level: 1, name: new RegExp(`^${LIST_H1}(\\s|$)`) }),
    listTable: page.locator(LIST_TABLE).first(),
  };
}

/** Opens the wizard (at `?step=<k>` when given) and waits for the step's `h1`. */
async function openWizard(page: Page, step?: 1 | 2 | 3): Promise<void> {
  await page.goto(step === undefined ? CREATE_PATH : `${CREATE_PATH}?step=${String(step)}`);
  await expect(screen(page).step(step ?? 1), `the wizard's step ${String(step ?? 1)}`).toBeVisible();
}

/** "Next", then waits for step `k`. */
async function next(page: Page, k: 2 | 3): Promise<void> {
  await screen(page).button(NEXT).click(ACTION);
  await expect(screen(page).step(k), `step ${String(k)} after "${NEXT}"`).toBeVisible();
}

/** Types `text` into a field and leaves it with Tab, so a field with suggestions closes them. */
async function typeInto(page: Page, field: ReturnType<typeof screen>['service'], text: string): Promise<void> {
  await field.fill(text, ACTION);
  await field.press('Tab', ACTION);
}

/** What step 1 is given. */
type Trusted =
  | { type: 'service'; principal: string }
  | { type: 'this-account'; externalId?: string; mfa?: boolean }
  | { type: 'another-account'; account: string }
  | { type: 'custom'; document: string };

/** Fills step 1 with `trusted` (the wizard on step 1). */
async function fillStep1(page: Page, trusted: Trusted): Promise<void> {
  const s = screen(page);
  if (trusted.type === 'service') {
    await s.radio(T_SERVICE).check(ACTION);
    await typeInto(page, s.service, trusted.principal);
  } else if (trusted.type === 'custom') {
    await s.radio(T_CUSTOM).check(ACTION);
    await s.custom.fill(trusted.document, ACTION);
  } else {
    await s.radio(T_ACCOUNT).check(ACTION);
    if (trusted.type === 'another-account') {
      await s.radio(ANOTHER_ACCOUNT).check(ACTION);
      await typeInto(page, s.accountId, trusted.account);
    } else {
      await expect(s.radio(THIS_ACCOUNT), `"${THIS_ACCOUNT}"`).toBeChecked();
      if (trusted.externalId !== undefined) {
        await s.checkbox(REQUIRE_EXTERNAL_ID).check(ACTION);
        await typeInto(page, s.externalId, trusted.externalId);
      }
      if (trusted.mfa) await s.checkbox(REQUIRE_MFA).check(ACTION);
    }
  }
}

/** The data row of `policy` in step 2's table. */
function policyRow(page: Page, policy: string) {
  return screen(page)
    .policies.getByRole('row')
    .filter({ has: page.getByRole('cell', { name: policy, exact: true }) });
}

/** On step 2: finds each of `policies` with the filter and selects it. */
async function selectPolicies(page: Page, policies: string[]): Promise<void> {
  const s = screen(page);
  for (const policy of policies) {
    await s.filter.fill(policy, ACTION);
    await s.filter.press('Enter', ACTION);
    const row = policyRow(page, policy);
    await expect(row, `the row of ${policy} under the filter`).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole('checkbox').check(ACTION);
  }
}

/** On step 3: the name, a description and tags. */
async function fillStep3(page: Page, name: string, description?: string, tag?: { key: string; value: string }) {
  const s = screen(page);
  await s.roleName.fill(name, ACTION);
  if (description !== undefined) await s.description.fill(description, ACTION);
  if (tag !== undefined) {
    await s.button(ADD_TAG).click(ACTION);
    await s.tagKey.fill(tag.key, ACTION);
    await s.tagValue.fill(tag.value, ACTION);
    await s.tagValue.press('Tab', ACTION);
  }
}

/** The whole wizard from step 1 up to step 3 filled, "Create role" not pressed. */
async function completeWizard(
  page: Page,
  trusted: Trusted,
  name: string,
  more: { policies?: string[]; description?: string; tag?: { key: string; value: string } } = {},
): Promise<void> {
  await openWizard(page);
  await fillStep1(page, trusted);
  await next(page, 2);
  if (more.policies !== undefined) await selectPolicies(page, more.policies);
  await next(page, 3);
  await fillStep3(page, name, more.description, more.tag);
}

async function flashTexts(page: Page): Promise<string[]> {
  return (await screen(page).flashItems.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

async function expectFlash(page: Page, parts: string[], message: string): Promise<void> {
  await expect
    .poll(async () => (await flashTexts(page)).some((t) => parts.every((part) => t.includes(part))), { message })
    .toBe(true);
}

/** "Create role" on step 3; waits for the list with the Flashbar's success item for `name`. */
async function createAndExpectList(page: Page, name: string): Promise<void> {
  const s = screen(page);
  await s.button(CREATE).click(ACTION);
  await expect(page, 'the list opens').toHaveURL(addressOf(ROLES_PATH), { timeout: 20_000 });
  await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
  await expectFlash(page, [createdText(name)], `the Flashbar says "${createdText(name)}"`);
}

/** On the role list (opened when another page is shown): applies the filter `text`, typed, then Enter. */
async function applyListFilter(page: Page, text: string): Promise<void> {
  const s = screen(page);
  if ((await s.listH1.count()) === 0) {
    await page.goto(ROLES_PATH);
    await expect(s.listH1).toBeVisible();
  }
  await s.filter.fill(text, ACTION);
  await s.filter.press('Enter', ACTION);
}

/** The role list's rows as shown: name and trusted entities. */
async function listRows(page: Page): Promise<{ name: string; trusted: string }[]> {
  const s = screen(page);
  if ((await s.listTable.count()) === 0) return [];
  const read = () =>
    s.listTable.evaluate(
      (el, cols) => {
        const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
        for (const table of el.querySelectorAll('table')) {
          if (table.tBodies.length === 0 || table.closest('[aria-hidden="true"]')) continue;
          const head = table.tHead?.rows[0];
          if (!head) continue;
          const names = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
          const at = cols.map((c) => names.indexOf(c));
          if (at.some((i) => i < 0)) continue;
          return [...table.tBodies[0].rows]
            .filter((r) => r.cells.length > 1)
            .map((r) => ({
              name: norm((r.cells[at[0]] as HTMLElement | undefined)?.innerText ?? ''),
              trusted: norm((r.cells[at[1]] as HTMLElement | undefined)?.innerText ?? ''),
            }));
        }
        return [];
      },
      [COL_NAME, COL_TRUSTED],
    );
  return read();
}

/** A one-statement statement list of a trust policy, members of one written as the value itself. */
function statements(role: DirectRole): Record<string, unknown>[] {
  const doc = role.trustPolicy as { Statement?: unknown } | null;
  const list = doc?.Statement;
  return (Array.isArray(list) ? list : list === undefined ? [] : [list]) as Record<string, unknown>[];
}
const one = (v: unknown) => (Array.isArray(v) && v.length === 1 ? (v[0] as unknown) : v);

/** The statement of `role`'s trust policy as `{ effect, action, principal, condition }`; fails unless there is one. */
function onlyStatement(role: DirectRole) {
  const list = statements(role);
  expect(list.length, `the statements of ${role.name}'s trust policy ${role.trustPolicyText}`).toBe(1);
  const st = list[0] ?? {};
  const principal = Object.fromEntries(
    Object.entries((st.Principal ?? {}) as Record<string, unknown>).map(([k, v]) => [k, one(v)]),
  );
  return { effect: st.Effect, action: one(st.Action), principal, condition: st.Condition ?? null };
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-create-appears-in-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rcappear');
  const seeded = new IamSeeded(ctx, port);
  const customer = `${p}-cust`;
  const customerArn = await seeded.policy(customer);
  const names = { new: `${p}-new`, odd: `${p}-odd`, full: `${p}-full`, other: `${p}-other`, custom: `${p}-custom` };
  for (const name of Object.values(names)) seeded.adopt(name);
  const s = screen(page);
  const fullDescription = `Made by Studio for ${p}`;

  await lines.line(
    'On the wizard: "Service or use case" `lambda.amazonaws.com`, "Next", "Next", name `<p>-new`, "Create role" → the list with "Role “<p>-new” was created in the local emulator."; apply the filter `<p>` → its row with "AWS Service: lambda"; a direct `GetRole` reports a trust policy with one statement that allows `sts:AssumeRole` to the service `lambda.amazonaws.com`, the path `/` and no description; a direct `ListAttachedRolePolicies` returns none; a direct `ListInstanceProfilesForRole` returns none',
    async () => {
      await completeWizard(page, { type: 'service', principal: 'lambda.amazonaws.com' }, names.new);
      await createAndExpectList(page, names.new);
      await applyListFilter(page, p);
      await expect
        .poll(async () => (await listRows(page)).find((r) => r.name === names.new)?.trusted ?? null, {
          message: `the row of ${names.new} under the filter <p>`,
        })
        .toBe('AWS Service: lambda');
      const direct = await getRoleDirect(ctx, port, names.new);
      expect(onlyStatement(direct), `the trust policy of ${names.new}`).toEqual({
        effect: 'Allow',
        action: 'sts:AssumeRole',
        principal: { Service: 'lambda.amazonaws.com' },
        condition: null,
      });
      expect({ path: direct.path, description: direct.description ?? '' }, 'path and description').toEqual({
        path: '/',
        description: '',
      });
      expect(await attachedPoliciesDirect(ctx, port, names.new), 'a direct ListAttachedRolePolicies').toEqual([]);
      expect(await instanceProfilesForRoleDirect(ctx, port, names.new), 'a direct ListInstanceProfilesForRole').toEqual(
        [],
      );
    },
  );

  await lines.line(
    '"Service or use case" `<p>-nonsense` (a principal that names no service), name `<p>-odd`, "Create role" → created; a direct `GetRole` reports that principal',
    async () => {
      await completeWizard(page, { type: 'service', principal: `${p}-nonsense` }, names.odd);
      await createAndExpectList(page, names.odd);
      expect(onlyStatement(await getRoleDirect(ctx, port, names.odd)).principal, 'the principal').toEqual({
        Service: `${p}-nonsense`,
      });
    },
  );

  await lines.line(
    '"AWS account", "This account", "Require external ID" with `<p>-ext`, "Require MFA"; on step 2 select `ReadOnlyAccess` (found with the filter) and a customer managed policy made directly; name `<p>-full`, a description, a tag `team` = `studio`, "Create role" → a direct `GetRole` reports the principal `arn:aws:iam::<account>:root` with the account of a direct `GetUser`, both conditions, the description and the tag; a direct `ListAttachedRolePolicies` returns the two policies',
    async () => {
      const account = (await callerUserDirect(ctx, port)).account;
      await completeWizard(page, { type: 'this-account', externalId: `${p}-ext`, mfa: true }, names.full, {
        policies: ['ReadOnlyAccess', customer],
        description: fullDescription,
        tag: { key: 'team', value: 'studio' },
      });
      await createAndExpectList(page, names.full);
      const direct = await getRoleDirect(ctx, port, names.full);
      const st = onlyStatement(direct);
      expect({ effect: st.effect, action: st.action, principal: st.principal }, 'the statement').toEqual({
        effect: 'Allow',
        action: 'sts:AssumeRole',
        principal: { AWS: `arn:aws:iam::${account}:root` },
      });
      const condition = (st.condition ?? {}) as Record<string, Record<string, unknown>>;
      expect(
        {
          externalId: one(condition.StringEquals?.['sts:ExternalId']),
          mfa: String(one(condition.Bool?.['aws:MultiFactorAuthPresent'])),
        },
        'the conditions',
      ).toEqual({ externalId: `${p}-ext`, mfa: 'true' });
      expect({ description: direct.description, tags: direct.tags }, 'description and tags').toEqual({
        description: fullDescription,
        tags: [{ key: 'team', value: 'studio' }],
      });
      const attached = (await attachedPoliciesDirect(ctx, port, names.full)).map((a) => a.arn).sort();
      expect(attached, 'a direct ListAttachedRolePolicies').toEqual([READ_ONLY_ACCESS, customerArn].sort());
    },
  );

  await lines.line(
    '"AWS account", "Another AWS account" with `123456789012`, name `<p>-other` → a direct `GetRole` reports the principal `arn:aws:iam::123456789012:root` and no condition',
    async () => {
      await completeWizard(page, { type: 'another-account', account: '123456789012' }, names.other);
      await createAndExpectList(page, names.other);
      const st = onlyStatement(await getRoleDirect(ctx, port, names.other));
      expect({ principal: st.principal, condition: st.condition }, 'principal and condition').toEqual({
        principal: { AWS: 'arn:aws:iam::123456789012:root' },
        condition: null,
      });
    },
  );

  await lines.line(
    '"Custom trust policy" with a document typed on several lines that allows `sts:AssumeRole` to `states.amazonaws.com`, name `<p>-custom` → a direct `GetRole` reports a trust policy of that content',
    async () => {
      const document = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'states.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      };
      const text = JSON.stringify(document, null, 2);
      expect(text.split('\n').length, 'the document is on several lines').toBeGreaterThan(1);
      await completeWizard(page, { type: 'custom', document: text }, names.custom);
      await createAndExpectList(page, names.custom);
      expect((await getRoleDirect(ctx, port, names.custom)).trustPolicy, 'the trust policy read back').toEqual(
        document,
      );
    },
  );

  await lines.line('Open the page of `<p>-full` from its row → the same values as the direct calls', async () => {
    const direct = await getRoleDirect(ctx, port, names.full);
    const attached = await attachedPoliciesDirect(ctx, port, names.full);
    await page.goto(ROLES_PATH);
    await expect(s.listH1).toBeVisible();
    await applyListFilter(page, names.full);
    await expect
      .poll(async () => (await listRows(page)).map((r) => r.name), { message: `the row of ${names.full}` })
      .toEqual([names.full]);
    await s.listTable.getByRole('link', { name: names.full, exact: true }).click(ACTION);
    await expect(heading(page, names.full), `the h1 "${names.full}"`).toBeVisible();
    await expect(s.main, 'the ARN').toContainText(direct.arn);
    await expect(s.main, 'the description').toContainText(fullDescription);
    const table = s.main.getByRole('table', { name: POLICIES, exact: true });
    for (const a of attached) {
      await expect(table.getByRole('cell', { name: a.name, exact: true }), `the row of ${a.name}`).toBeVisible();
    }
    expect(attached.length, 'a direct ListAttachedRolePolicies').toBe(2);
  });

  await lines.line(
    'The AWS CLI pointed at the emulator lists the five roles (what Studio makes is there for any tool)',
    async () => {
      const run = await awsCli(ctx, port, ['iam', 'list-roles']);
      expect(run.exit, 'aws iam list-roles').toBe(0);
      const listed = ((JSON.parse(run.stdout || '{}') as { Roles?: { RoleName: string }[] }).Roles ?? []).map(
        (r) => r.RoleName,
      );
      expect(containing(listed, p).sort(), 'the roles of <p> the AWS CLI lists').toEqual(Object.values(names).sort());
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-create-refusals-create-nothing', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rcrefuse');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);
  const existing = `${p}-exists`;
  await seeded.role(existing);
  const empty = `${p}-empty`;
  seeded.adopt(empty);
  seeded.adopt(`${p}-skip`);

  await lines.line('"Next" on an empty step 1 → "Enter a service principal." and step 1 stays', async () => {
    await openWizard(page);
    await s.button(NEXT).click(ACTION);
    await expect(s.main.getByText(M_SERVICE, { exact: true }), `"${M_SERVICE}"`).toBeVisible();
    await expect(s.step(1), 'step 1 stays').toBeVisible();
    await expect(s.step(2), 'not step 2').toHaveCount(0);
  });

  await lines.line(
    'Open the wizard with `?step=3`, name `<p>-skip`, "Create role" → step 1 with its message; a direct `GetRole` of `<p>-skip` answers that the role cannot be found',
    async () => {
      await openWizard(page, 3);
      await s.roleName.fill(`${p}-skip`, ACTION);
      await s.button(CREATE).click(ACTION);
      await expect(s.step(1), 'step 1').toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${addressOf(CREATE_PATH).source.slice(0, -1)}\\?step=1$`));
      await expect(s.main.getByText(M_SERVICE, { exact: true }), `"${M_SERVICE}"`).toBeVisible();
      expect(await roleIsGone(ctx, port, `${p}-skip`), `a direct GetRole of ${p}-skip`).toBe(true);
    },
  );

  await lines.line(
    'A complete wizard with the name `<p> x` → the message about the allowed characters; no role with `<p> x`',
    async () => {
      const spaced = `${p} x`;
      await completeWizard(page, { type: 'service', principal: 'lambda.amazonaws.com' }, spaced);
      await s.button(CREATE).click(ACTION);
      await expect(s.main.getByText(M_NAME_SIGNS, { exact: true }), `"${M_NAME_SIGNS}"`).toBeVisible();
      await expect(s.step(3), 'step 3 stays').toBeVisible();
      const held = await roleNamesDirect(ctx, port);
      expect(
        held.filter((n) => n.startsWith(p) && n.includes(' ')),
        `a direct ListRoles: a role named "${spaced}"`,
      ).toEqual([]);
    },
  );

  await lines.line(
    'The name of a role that exists, in the other case → the wizard stays on step 3 with every value and shows "Creating the role failed" with the emulator\'s code and message; a direct `ListRoles` returns one role of that name',
    async () => {
      const other = existing.toUpperCase();
      const description = `Again ${p}`;
      await completeWizard(page, { type: 'service', principal: 'lambda.amazonaws.com' }, other, { description });
      await s.button(CREATE).click(ACTION);
      const refusal = await iamAnswer(ctx, port, 'CreateRole', createRoleParams(other), other);
      if (refusal.ok) seeded.adopt(other);
      expect(refusal.ok, `a direct CreateRole of ${other} is refused`).toBe(false);
      if (refusal.ok) return;
      await expect(s.main.getByText(CREATE_FAILED), `"${CREATE_FAILED}"`).toBeVisible();
      await expect(s.main, "the emulator's code").toContainText(refusal.code);
      await expect(s.main, "the emulator's message").toContainText(refusal.message);
      await expect(s.step(3), 'step 3 stays').toBeVisible();
      await expect(s.roleName, 'the name typed').toHaveValue(other);
      await expect(s.description, 'the description typed').toHaveValue(description);
      await expect(s.main, "step 1's principal in the review").toContainText('lambda.amazonaws.com');
      const same = (await roleNamesDirect(ctx, port)).filter((n) => n.toLowerCase() === existing.toLowerCase());
      expect(same, 'a direct ListRoles: the roles of that name').toEqual([existing]);
    },
  );

  await lines.line(
    '"Custom trust policy" `{}`, a valid name, "Create role" → the wizard stays and shows the emulator\'s refusal (a policy without statements); a direct `GetRole` of the name answers that the role cannot be found',
    async () => {
      await completeWizard(page, { type: 'custom', document: '{}' }, empty);
      await s.button(CREATE).click(ACTION);
      const refusal = await iamAnswer(ctx, port, 'CreateRole', createRoleParams(empty, { trust: '{}' }), empty);
      expect(refusal.ok, `a direct CreateRole of ${empty} with {} is refused`).toBe(false);
      if (refusal.ok) return;
      await expect(s.main.getByText(CREATE_FAILED), `"${CREATE_FAILED}"`).toBeVisible();
      await expect(s.main, "the emulator's code").toContainText(refusal.code);
      await expect(s.main, "the emulator's message").toContainText(refusal.message);
      await expect(s.step(3), 'the wizard stays on step 3').toBeVisible();
      expect(await roleIsGone(ctx, port, empty), `a direct GetRole of ${empty}`).toBe(true);
    },
  );

  await lines.line(
    'Change the custom policy to one with a statement, "Create role" → the list, and the role exists in the emulator',
    async () => {
      if ((await s.step(3).count()) === 0 || (await s.roleName.inputValue(ACTION)) !== empty) {
        await completeWizard(page, { type: 'custom', document: '{}' }, empty);
      }
      await s.button(PREVIOUS).click(ACTION);
      await expect(s.step(2)).toBeVisible();
      await s.button(PREVIOUS).click(ACTION);
      await expect(s.step(1)).toBeVisible();
      const document = {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      };
      await s.custom.fill(JSON.stringify(document, null, 2), ACTION);
      await next(page, 2);
      await next(page, 3);
      await expect(s.roleName, 'the name kept').toHaveValue(empty);
      await createAndExpectList(page, empty);
      expect((await getRoleDirect(ctx, port, empty)).trustPolicy, `a direct GetRole of ${empty}`).toEqual(document);
    },
  );

  await lines.line(
    "A direct `CreateRole` with a trust policy that is not JSON is refused by the emulator, and a direct `AttachRolePolicy` of an eleventh managed policy to a role is refused (the two refusals R9.4 names that the form's own rules keep Studio from sending)",
    async () => {
      const notJson = `${p}-notjson`;
      const refusal = await iamAnswer(
        ctx,
        port,
        'CreateRole',
        createRoleParams(notJson, { trust: '{not json' }),
        notJson,
      );
      if (refusal.ok) seeded.adopt(notJson);
      expect(refusal.ok ? 'created' : refusal.code, `a direct CreateRole of ${notJson}`).toBe(
        'MalformedPolicyDocument',
      );
      const ten = `${p}-ten`;
      await seeded.role(ten);
      for (let i = 1; i <= 10; i++) await seeded.attach(ten, await seeded.policy(`${p}-pol${String(i)}`));
      const eleventh = await seeded.policy(`${p}-pol11`);
      const attach = await iamAnswer(ctx, port, 'AttachRolePolicy', { RoleName: ten, PolicyArn: eleventh }, ten);
      expect(attach.ok ? 'attached' : attach.code, 'a direct AttachRolePolicy of an eleventh policy').toBe(
        'LimitExceeded',
      );
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-create-repeated-and-abandoned', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rcrepeat');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);
  const twice = `${p}-twice`;
  const dropped = `${p}-dropped`;
  seeded.adopt(twice);
  seeded.adopt(dropped);
  const lambda: Trusted = { type: 'service', principal: 'lambda.amazonaws.com' };

  /** Step 1 as a new wizard shows it: "AWS service" chosen and "Service or use case" empty. */
  async function expectEmptyStep1(): Promise<void> {
    await expect(s.step(1), 'step 1').toBeVisible();
    await expect(s.radio(T_SERVICE), `"${T_SERVICE}" chosen`).toBeChecked();
    await expect(s.service, `"${F_SERVICE}" empty`).toHaveValue('');
  }

  await lines.line(
    'Complete the wizard and press "Create role" twice quickly → one role; a direct `ListRoles` returns the name once and no failure is shown',
    async () => {
      await completeWizard(page, lambda, twice);
      await s.button(CREATE).dblclick(ACTION);
      await expect(page, 'the list opens').toHaveURL(addressOf(ROLES_PATH), { timeout: 20_000 });
      await expectFlash(page, [createdText(twice)], `the Flashbar says "${createdText(twice)}"`);
      expect(
        (await roleNamesDirect(ctx, port)).filter((n) => n === twice),
        'a direct ListRoles',
      ).toEqual([twice]);
      const texts = await flashTexts(page);
      expect(
        texts.filter((t) => t.includes('failed')),
        'Flashbar items that report a failure',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Complete the wizard up to step 3, "Cancel" → the list; a direct `GetRole` of the name answers that the role cannot be found; open the wizard again → step 1, every field empty, "AWS service" chosen',
    async () => {
      await completeWizard(page, lambda, dropped, { description: `Dropped ${p}` });
      await s.button(CANCEL).click(ACTION);
      await expect(page).toHaveURL(addressOf(ROLES_PATH));
      await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
      expect(await roleIsGone(ctx, port, dropped), `a direct GetRole of ${dropped}`).toBe(true);
      await s.button(CREATE).first().click(ACTION);
      await expect(page).toHaveURL(new RegExp(`${addressOf(CREATE_PATH).source.slice(0, -1)}(\\?step=1)?$`));
      await expectEmptyStep1();
    },
  );

  await lines.line(
    'Fill step 1, "Next", follow the crumb "Roles", come back with the browser\'s back → the wizard at the step of the address with nothing typed',
    async () => {
      await openWizard(page);
      await fillStep1(page, lambda);
      await next(page, 2);
      await expect(page).toHaveURL(/\?step=2$/);
      await crumbLink(page, LIST_H1).click(ACTION);
      await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\?step=2$/);
      await expect(s.step(2), 'step 2, the step of the address').toBeVisible();
      await expect(s.policies.getByRole('checkbox', { checked: true }), 'no policy selected').toHaveCount(0);
      await s.button(PREVIOUS).click(ACTION);
      await expectEmptyStep1();
    },
  );

  await lines.line(
    'Reload the document on step 2 → step 2 (`?step=2`), no policy selected; "Previous" → an empty step 1',
    async () => {
      await openWizard(page);
      await fillStep1(page, lambda);
      await next(page, 2);
      await selectPolicies(page, ['ReadOnlyAccess']);
      await expect(s.policies.getByRole('checkbox', { checked: true }), 'one policy selected').toHaveCount(1);
      await markPage(page);
      await page.reload();
      expect(await stillSamePage(page), 'the document was loaded again').toBe(false);
      await expect(page).toHaveURL(/\?step=2$/);
      await expect(s.step(2), 'step 2 after the reload').toBeVisible();
      await expect
        .poll(async () => (await s.policies.getByRole('row').count()) > 1, { message: 'the policy table holds rows' })
        .toBe(true);
      await expect(s.policies.getByRole('checkbox', { checked: true }), 'no policy selected').toHaveCount(0);
      await s.button(PREVIOUS).click(ACTION);
      await expectEmptyStep1();
    },
  );

  lines.end();
});
