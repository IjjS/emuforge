// Changing what a role may do (S2, "Permissions") in the built app served by `bun run serve`, in front of a real engine
// started for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): "Attach policies" with
// its filter, its "Attached" mark and its own check of an empty choice; attaching two policies; detaching one; adding,
// editing and deleting an inline policy. After each change the emulator reports it.
//
// `studio.iam-role-permission-changes-reach-the-emulator`.
//
// The role and the two policies are made directly under the check's prefix `<p>` (`services/iam/iam.ts`) and taken
// apart when the check ends. The lines follow one another on the one role.

import type { Locator } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  attachedPoliciesDirect,
  DOC_A,
  DOC_B,
  getPolicyAnswer,
  IamSeeded,
  inlinePolicyNamesDirect,
  inlinePolicyTextDirect,
  LAMBDA_BASIC,
  LAMBDA_BASIC_NAME,
} from './services/iam/iam';
import {
  applyFilter,
  button,
  chooseRow,
  confirmByTyping,
  dialog,
  documentField,
  expectFlash,
  iamPrefix,
  openRole,
  PERMISSIONS_POLICIES,
  rowOf,
  rowsOf,
  table,
  tablePart,
  TYPE_INLINE,
  watchActions,
} from './services/iam/iam-screens';

const ATTACH = 'Attach policies';
const TO_ATTACH = 'Policies to attach';

test('studio.iam-role-permission-changes-reach-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'roleperm');
  const seeded = new IamSeeded(ctx, port);
  const seen = watchActions(page, stack.engine.url);
  const role = `${p}-app`;
  const inline = `${p}-in`;

  await seeded.role(role);
  await seeded.attach(role, LAMBDA_BASIC);
  const one = await seeded.policy(`${p}-one`);
  const two = await seeded.policy(`${p}-two`);

  const policies = () => table(page, PERMISSIONS_POLICIES);
  const action = (name: string) => button(tablePart(page, PERMISSIONS_POLICIES), name);
  const names = async () => (await rowsOf(policies(), ['Policy name'])).flat();
  const attachedArns = async () => (await attachedPoliciesDirect(ctx, port, role)).map((a) => a.arn).sort();

  /** Opens the role's page and "Attach policies"; returns the dialog and its table. */
  async function openAttach(): Promise<{ opened: Locator; choices: Locator }> {
    await openRole(page, role);
    await action(ATTACH).click(ACTION);
    const opened = dialog(page, `Attach policies to ${role}`);
    await expect(opened, 'the dialog').toBeVisible();
    return { opened, choices: opened.getByRole('table', { name: TO_ATTACH, exact: true }) };
  }

  await lines.line(
    'On S2, "Attach policies" → the dialog opens; with the filter `<p>-` it holds `<p>-one` and `<p>-two`; with the filter `AWSLambdaBasicExecutionRole` that policy is marked "Attached" and cannot be chosen',
    async () => {
      const { opened, choices } = await openAttach();
      await applyFilter(opened, `${p}-`);
      await expect
        .poll(async () => (await rowsOf(choices, ['Policy name'])).flat(), { message: `the rows under ${p}-` })
        .toEqual([`${p}-one`, `${p}-two`]);
      await applyFilter(opened, LAMBDA_BASIC_NAME);
      await expect
        .poll(() => rowsOf(choices, ['Policy name', 'Attached']), { message: 'the row of the attached policy' })
        .toEqual([[LAMBDA_BASIC_NAME, 'Attached']]);
      await expect(
        rowOf(choices, LAMBDA_BASIC_NAME).locator('input[type="checkbox"]'),
        'the check box of the attached policy',
      ).toBeDisabled();
    },
  );

  await lines.line(
    '"Attach" with nothing chosen → "Choose at least one policy." and no request to attach left the page',
    async () => {
      const { opened } = await openAttach();
      const before = seen.count('AttachRolePolicy');
      await button(opened, 'Attach').click(ACTION);
      await expect(opened.getByText('Choose at least one policy.', { exact: true }), 'the message').toBeVisible();
      expect(seen.count('AttachRolePolicy') - before, 'requests to attach that left the page').toBe(0);
    },
  );

  await lines.line(
    'Choose `<p>-one` and `<p>-two`, "Attach" → the dialog closes, the Flashbar says "Attached 2 policies to <p>-app.", the table lists both; the emulator reports the three policies attached to the role',
    async () => {
      const { opened, choices } = await openAttach();
      await applyFilter(opened, `${p}-`);
      await expect.poll(async () => (await rowsOf(choices, ['Policy name'])).length, { message: 'the rows' }).toBe(2);
      await chooseRow(choices, `${p}-one`);
      await chooseRow(choices, `${p}-two`);
      await button(opened, 'Attach').click(ACTION);
      await expect(opened, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expectFlash(page, [`Attached 2 policies to ${role}.`], 'the result of the attach');
      await expect
        .poll(names, { message: 'the rows of "Permissions policies"' })
        .toEqual(expect.arrayContaining([`${p}-one`, `${p}-two`, LAMBDA_BASIC_NAME]));
      expect(await attachedArns(), 'the policies the emulator reports attached').toEqual(
        [LAMBDA_BASIC, one, two].sort(),
      );
    },
  );

  await lines.line(
    'Choose the row `<p>-two`, "Detach" → the dialog "Detach <p>-two?"; "Detach" → "Detached <p>-two from <p>-app."; the emulator reports `<p>-two` no longer attached to the role and still held as a policy',
    async () => {
      await openRole(page, role);
      await chooseRow(policies(), `${p}-two`);
      await action('Detach').click(ACTION);
      const opened = dialog(page, `Detach ${p}-two?`);
      await expect(opened, 'the dialog').toBeVisible();
      await button(opened, 'Detach').click(ACTION);
      await expect(opened, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expectFlash(page, [`Detached ${p}-two from ${role}.`], 'the result of the detach');
      expect(await attachedArns(), 'the policies the emulator reports attached').toEqual([LAMBDA_BASIC, one].sort());
      expect((await getPolicyAnswer(ctx, port, two)).ok, `the emulator still holds ${p}-two`).toBe(true);
    },
  );

  await lines.line(
    '"Add inline policy": the name `<p>-in`, the document\'s text replaced by doc-a, "Add policy" → "Inline policy <p>-in added to <p>-app.", the row is listed as "Customer inline"; the emulator reports the role\'s inline policy `<p>-in` with the text of doc-a as typed',
    async () => {
      await openRole(page, role);
      await action('Add inline policy').click(ACTION);
      const opened = dialog(page, 'Add inline policy');
      await opened.getByRole('textbox', { name: 'Policy name', exact: true }).fill(inline, ACTION);
      await documentField(opened).fill(DOC_A, ACTION);
      await button(opened, 'Add policy').click(ACTION);
      await expect(opened, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expectFlash(page, [`Inline policy ${inline} added to ${role}.`], 'the result of the add');
      await expect
        .poll(async () => (await rowsOf(policies(), ['Policy name', 'Type'])).filter((r) => r[0] === inline), {
          message: 'the row of the inline policy',
        })
        .toEqual([[inline, TYPE_INLINE]]);
      expect(await inlinePolicyTextDirect(ctx, port, role, inline), 'the document the emulator reports').toBe(DOC_A);
    },
  );

  await lines.line(
    'Choose `<p>-in`, "Edit" → the editor holds the text of doc-a; replace it by doc-b, "Save changes" → "Inline policy <p>-in of <p>-app saved."; the emulator reports the text of doc-b',
    async () => {
      await openRole(page, role);
      await chooseRow(policies(), inline);
      await action('Edit inline policy').click(ACTION);
      const opened = dialog(page, `Edit ${inline}`);
      await expect(documentField(opened), 'the editor holds doc-a').toHaveValue(DOC_A, { timeout: 30_000 });
      await documentField(opened).fill(DOC_B, ACTION);
      await button(opened, 'Save changes').click(ACTION);
      await expect(opened, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expectFlash(page, [`Inline policy ${inline} of ${role} saved.`], 'the result of the save');
      expect(await inlinePolicyTextDirect(ctx, port, role, inline), 'the document the emulator reports').toBe(DOC_B);
    },
  );

  await lines.line(
    'Choose `<p>-in`, "Delete" → the dialog "Delete <p>-in?", whose "Delete" is unavailable until `delete` is typed; type it, "Delete" → "Inline policy <p>-in deleted from <p>-app."; the emulator reports no inline policy of the role',
    async () => {
      await openRole(page, role);
      await chooseRow(policies(), inline);
      await action('Delete inline policy').click(ACTION);
      await confirmByTyping(page, `Delete ${inline}?`);
      await expectFlash(page, [`Inline policy ${inline} deleted from ${role}.`], 'the result of the deletion');
      expect(await inlinePolicyNamesDirect(ctx, port, role), 'the inline policies the emulator reports').toEqual([]);
    },
  );

  lines.end();
});
