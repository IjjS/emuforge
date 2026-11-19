// Deleting a customer managed policy (S5, S4) in the built app served by `bun run serve`, in front of a real engine
// started for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): the dialog names what
// the policy is detached from first, the deletion detaches it from a role, a user and a group, removes its versions and
// the policy and leaves the three; the same from the list; and a policy that is gone before "Delete" is reported with
// the step that failed.
//
// `studio.iam-policy-delete-detaches-and-removes`.
//
// Everything is made directly under the check's prefix `<p>` (`services/iam/iam.ts`) and what Studio did not delete
// is taken apart when the check ends.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  attachedPoliciesDirect,
  DOC_A,
  DOC_B,
  getRoleAnswer,
  iamAnswer,
  IamSeeded,
  members,
  policyIsGone,
  at,
} from './services/iam/iam';
import {
  addressOf,
  applyFilter,
  button,
  confirmByTyping,
  confirmField,
  dialog,
  expectFlash,
  flashTexts,
  headerButton,
  iamPrefix,
  isAvailable,
  openPolicy,
  POLICIES_PATH,
  rowsOf,
  table,
} from './services/iam/iam-screens';

const POLICIES = 'Policies';

test('studio.iam-policy-delete-detaches-and-removes', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'poldelete');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const [role, user, group] = [`${p}-r`, `${p}-u`, `${p}-g`];

  const used = await seeded.policy(`${p}-used`, DOC_A);
  await seeded.version(used, DOC_B, false);
  await seeded.version(used, DOC_B, true);
  await seeded.role(role);
  await seeded.attach(role, used);
  await seeded.user(user);
  await seeded.attachUser(user, used);
  await seeded.group(group);
  await seeded.attachGroup(group, used);
  const plain = await seeded.policy(`${p}-plain`);
  const race = await seeded.policy(`${p}-race`);

  /** The ARNs of a direct `ListAttached<Kind>Policies` of `name`. */
  async function attachedTo(kind: 'User' | 'Group', name: string): Promise<string[]> {
    const action = `ListAttached${kind}Policies`;
    const read = await iamAnswer(ctx, port, action, { [`${kind}Name`]: name }, name);
    expect(read.ok, `a direct ${action} of ${name}: the ${kind.toLowerCase()} is still held`).toBe(true);
    if (!read.ok) return [];
    return members(at(read.xml, `${action}Response`, `${action}Result`), 'AttachedPolicies').map(
      (m) => m.children.find((c) => c.name === 'PolicyArn')?.text ?? '',
    );
  }

  await lines.line(
    'On S5 of `<p>-used`, "Delete" → the dialog "Delete <p>-used?" says it is first detached from 3 entities and names `<p>-r`, `<p>-u` and `<p>-g` with their kinds; "Delete" is unavailable until `delete` is typed',
    async () => {
      await openPolicy(page, used, `${p}-used`);
      await expect
        .poll(async () => (await rowsOf(table(page, 'Attached to'), ['Name'])).length, {
          message: '"Attached to" is read',
        })
        .toBe(3);
      await headerButton(page, 'Delete').click(ACTION);
      const opened = dialog(page, `Delete ${p}-used?`);
      await expect(opened, 'the dialog').toBeVisible();
      await expect(opened, 'how many entities').toContainText('It is first detached from 3 entities:');
      const text = (await opened.innerText()).replace(/\s+/g, ' ');
      for (const [name, kind] of [
        [role, 'Role'],
        [user, 'User'],
        [group, 'Group'],
      ]) {
        expect(text, `the dialog names ${name}`).toContain(name);
        expect(text, `the dialog names the kind ${kind}`).toContain(kind);
      }
      expect(await isAvailable(button(opened, 'Delete')), '"Delete" before `delete` is typed').toBe(false);
      await confirmField(opened).fill('delete', ACTION);
      expect(await isAvailable(button(opened, 'Delete')), '"Delete" once `delete` is typed').toBe(true);
      await button(opened, 'Cancel').click(ACTION);
      await expect(opened, 'the dialog after "Cancel"').toHaveCount(0);
    },
  );

  await lines.line(
    'Type it, "Delete" → S4 opens with "Policy <p>-used deleted."; the emulator reports no such policy, and the role, the user and the group still held, none with the policy attached',
    async () => {
      await openPolicy(page, used, `${p}-used`);
      await expect
        .poll(async () => (await rowsOf(table(page, 'Attached to'), ['Name'])).length, {
          message: '"Attached to" is read',
        })
        .toBe(3);
      await headerButton(page, 'Delete').click(ACTION);
      await confirmByTyping(page, `Delete ${p}-used?`);
      await expect.poll(() => addressOf(page), { message: 'the address of S4', timeout: 30_000 }).toBe(POLICIES_PATH);
      await expectFlash(page, [`Policy ${p}-used deleted.`], 'the result on S4');
      expect(await policyIsGone(ctx, port, used), `the emulator holds no ${p}-used`).toBe(true);
      expect((await getRoleAnswer(ctx, port, role)).ok, `the emulator still holds ${role}`).toBe(true);
      expect(
        (await attachedPoliciesDirect(ctx, port, role)).map((a) => a.arn),
        `the policies attached to ${role}`,
      ).toEqual([]);
      expect(await attachedTo('User', user), `the policies attached to ${user}`).toEqual([]);
      expect(await attachedTo('Group', group), `the policies attached to ${group}`).toEqual([]);
    },
  );

  await lines.line(
    'On S4, choose `<p>-plain`, "Delete", confirm → "Policy <p>-plain deleted.", the list no longer holds it; the emulator reports no such policy',
    async () => {
      await page.goto(POLICIES_PATH);
      await applyFilter(main, `${p}-plain`);
      const list = table(page, POLICIES);
      await expect
        .poll(async () => (await rowsOf(list, ['Policy name'])).flat(), { message: 'the row' })
        .toEqual([`${p}-plain`]);
      await list.getByRole('radio', { name: `${p}-plain`, exact: true }).check(ACTION);
      await button(main, 'Delete').click(ACTION);
      await confirmByTyping(page, `Delete ${p}-plain?`);
      await expectFlash(page, [`Policy ${p}-plain deleted.`], 'the result on S4');
      await expect
        .poll(async () => (await rowsOf(list, ['Policy name'])).flat(), { message: 'the rows after the deletion' })
        .toEqual([]);
      expect(await policyIsGone(ctx, port, plain), `the emulator holds no ${p}-plain`).toBe(true);
    },
  );

  await lines.line(
    'On S5 of `<p>-race`, "Delete" opens the dialog; the policy is deleted directly; confirm → the Flashbar reports the failed step with `NoSuchEntity`, and the page shows "Policy not found"',
    async () => {
      await openPolicy(page, race, `${p}-race`);
      await headerButton(page, 'Delete').click(ACTION);
      await expect(dialog(page, `Delete ${p}-race?`), 'the dialog').toBeVisible();
      await seeded.removePolicy(race);
      await confirmByTyping(page, `Delete ${p}-race?`);
      await expect(main.getByText('Policy not found', { exact: true }), 'the page after the answer').toBeVisible();
      ctx.log(`Flashbar: ${JSON.stringify(await flashTexts(page))}; address ${addressOf(page)}`);
      await expectFlash(page, ['failed', 'NoSuchEntity'], 'the failed step with NoSuchEntity');
      await expect(main.getByText('Policy not found', { exact: true }), '"Policy not found"').toBeVisible();
    },
  );

  lines.end();
});
