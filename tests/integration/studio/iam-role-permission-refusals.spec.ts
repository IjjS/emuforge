// What a role's "Permissions" does when a change is refused (S2) in the built app served by `bun run serve`, in front
// of a real engine started for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): an
// eleventh managed policy is refused by the emulator and the dialog stays with its answer; the inline policy dialog's
// own checks send nothing; a document the emulator refuses stays in the dialog; a role deleted elsewhere is read again
// and shown as not found; a service-linked role's changes are unavailable with their reason.
//
// `studio.iam-role-permission-refusals-change-nothing`.
//
// Everything is made directly under the check's prefix `<p>` (`services/iam/iam.ts`) and taken apart when the check
// ends. The words of each refusal are read from the same request sent directly, which the emulator refuses the same
// way and which changes nothing. The line that deletes the role is the last on that role.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  attachedPoliciesDirect,
  DOC_A,
  iamAnswer,
  IamSeeded,
  inlinePolicyNamesDirect,
  inlinePolicyTextDirect,
  SERVICE_ROLE_PATH,
} from './services/iam/iam';
import {
  applyFilter,
  button,
  chooseRow,
  dialog,
  documentField,
  headerButton,
  iamPrefix,
  isAvailable,
  openRole,
  PERMISSIONS_POLICIES,
  rowsOf,
  section,
  SERVICE_LINKED_REASON,
  table,
  tablePart,
  unavailableReason,
  watchActions,
} from './services/iam/iam-screens';

const NAME_SIGNS = 'The name can have only letters, digits and the characters + = , . @ _ -.';
const NOT_JSON = 'Enter the policy as one JSON value.';

test('studio.iam-role-permission-refusals-change-nothing', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'rolerefuse');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const seen = watchActions(page, stack.engine.url);
  const full = `${p}-full`;
  const linked = `${p}-linked`;
  const held = `${p}-held`;

  await seeded.role(full);
  const attached: string[] = [];
  for (let n = 1; n <= 10; n++) {
    const arn = await seeded.policy(`${p}-n${String(n)}`);
    await seeded.attach(full, arn);
    attached.push(arn);
  }
  await seeded.inline(full, held, DOC_A);
  const eleventh = await seeded.policy(`${p}-n11`);
  await seeded.role(linked, { path: `${SERVICE_ROLE_PATH}${p}/` });

  const action = (name: string) => button(tablePart(page, PERMISSIONS_POLICIES), name);

  /** Opens the role's page and "Add inline policy"; returns the dialog. */
  async function openAdd() {
    await openRole(page, full);
    await action('Add inline policy').click(ACTION);
    const opened = dialog(page, 'Add inline policy');
    await expect(opened, 'the dialog').toBeVisible();
    return opened;
  }

  await lines.line(
    'On S2 of `<p>-full`, "Attach policies", choose `<p>-n11`, "Attach" → the dialog stays and says "<p>-n11 was not attached." with `LimitExceeded` and the emulator\'s message; the emulator reports ten attached policies',
    async () => {
      const refusal = await iamAnswer(
        ctx,
        port,
        'AttachRolePolicy',
        { RoleName: full, PolicyArn: eleventh },
        `an eleventh policy to ${full}`,
      );
      expect(refusal.ok, 'a direct eleventh attach is refused').toBe(false);
      if (refusal.ok) return;
      expect(refusal.code, 'the code of that refusal').toBe('LimitExceeded');
      await openRole(page, full);
      await action('Attach policies').click(ACTION);
      const opened = dialog(page, `Attach policies to ${full}`);
      const choices = opened.getByRole('table', { name: 'Policies to attach', exact: true });
      await applyFilter(opened, `${p}-n11`);
      await expect
        .poll(async () => (await rowsOf(choices, ['Policy name'])).flat(), { message: 'the row' })
        .toEqual([`${p}-n11`]);
      await chooseRow(choices, `${p}-n11`);
      await button(opened, 'Attach').click(ACTION);
      await expect(opened.getByText(`${p}-n11 was not attached.`), 'which policy was not attached').toBeVisible({
        timeout: 60_000,
      });
      await expect(opened, 'the code').toContainText(refusal.code);
      await expect(opened, "the emulator's message").toContainText(refusal.message);
      expect(
        (await attachedPoliciesDirect(ctx, port, full)).map((a) => a.arn).sort(),
        'the policies the emulator reports attached',
      ).toEqual([...attached].sort());
    },
  );

  await lines.line(
    '"Add inline policy" with the name `<p> bad` → the alphabet\'s message at the name; with the name `<p>-held` → "<p>-full already has an inline policy named <p>-held."; with a new name and the text `{"Version": ` → "Enter the policy as one JSON value."; none of the three sent a request to put a policy',
    async () => {
      const before = seen.count('PutRolePolicy');
      for (const [name, text, message] of [
        [`${p} bad`, null, NAME_SIGNS],
        [held, null, `${full} already has an inline policy named ${held}.`],
        [`${p}-new`, '{"Version": ', NOT_JSON],
      ] as const) {
        const opened = await openAdd();
        await opened.getByRole('textbox', { name: 'Policy name', exact: true }).fill(name, ACTION);
        if (text !== null) await documentField(opened).fill(text, ACTION);
        await button(opened, 'Add policy').click(ACTION);
        await expect(opened.getByText(message, { exact: true }), `the message for the name ${name}`).toBeVisible();
      }
      expect(seen.count('PutRolePolicy') - before, 'requests to put a policy that left the page').toBe(0);
    },
  );

  await lines.line(
    'A new name and the text `[1]`, "Add policy" → the dialog stays and shows `MalformedPolicyDocument` with the emulator\'s message; the emulator reports `<p>-held` as the role\'s only inline policy, with doc-a',
    async () => {
      const refusal = await iamAnswer(
        ctx,
        port,
        'PutRolePolicy',
        { RoleName: full, PolicyName: `${p}-list`, PolicyDocument: '[1]' },
        `${p}-list of ${full}`,
      );
      expect(refusal.ok, 'a direct PutRolePolicy of `[1]` is refused').toBe(false);
      if (refusal.ok) return;
      expect(refusal.code, 'the code of that refusal').toBe('MalformedPolicyDocument');
      const opened = await openAdd();
      await opened.getByRole('textbox', { name: 'Policy name', exact: true }).fill(`${p}-list`, ACTION);
      await documentField(opened).fill('[1]', ACTION);
      await button(opened, 'Add policy').click(ACTION);
      await expect(opened.getByText(refusal.code).first(), 'the code in the dialog').toBeVisible({ timeout: 30_000 });
      await expect(opened, "the emulator's message").toContainText(refusal.message);
      await expect(documentField(opened), 'what was typed is kept').toHaveValue('[1]');
      expect(await inlinePolicyNamesDirect(ctx, port, full), 'the inline policies the emulator reports').toEqual([
        held,
      ]);
      expect(await inlinePolicyTextDirect(ctx, port, full, held), `the document of ${held}`).toBe(DOC_A);
    },
  );

  await lines.line(
    'On S2 of `<p>-linked` → "Attach policies", "Add inline policy" and, on "Trust relationships", "Edit trust policy" are unavailable, each with "The emulator does not let a service-linked role\'s policies or trust policy be changed."; "Edit" of "Summary" and "Delete" in the header are available',
    async () => {
      await openRole(page, linked);
      for (const name of ['Attach policies', 'Add inline policy']) {
        await expect
          .poll(() => unavailableReason(action(name)), { message: `the reason on "${name}"` })
          .toBe(SERVICE_LINKED_REASON);
      }
      expect(await isAvailable(button(section(page, 'Summary'), 'Edit')), '"Edit" of "Summary"').toBe(true);
      expect(await isAvailable(headerButton(page, 'Delete')), '"Delete" in the header').toBe(true);
      await openRole(page, linked, true);
      await expect
        .poll(() => unavailableReason(button(section(page, 'Trust policy'), 'Edit trust policy')), {
          message: 'the reason on "Edit trust policy"',
        })
        .toBe(SERVICE_LINKED_REASON);
    },
  );

  await lines.line(
    'Choose the row `<p>-n1`; the role is deleted directly (its policies detached and removed first); "Detach", "Detach" → the page shows "Role not found"',
    async () => {
      await openRole(page, full);
      await chooseRow(table(page, PERMISSIONS_POLICIES), `${p}-n1`);
      await seeded.remove(full);
      await action('Detach').click(ACTION);
      const opened = dialog(page, `Detach ${p}-n1?`);
      await button(opened, 'Detach').click(ACTION);
      await expect(opened, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expect(main.getByText('Role not found', { exact: true }), '"Role not found"').toBeVisible();
    },
  );

  lines.end();
});
