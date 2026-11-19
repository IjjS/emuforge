// What the policy screens do when a policy is not created or not saved (S6, S5) in the built app served by
// `bun run serve`, in front of a real engine started for that Studio and the run's emulator (test-criteria.md of issue
// 535, Integration): the form's own checks send nothing; a name the emulator holds, a document it refuses and a sixth
// version are shown as the emulator answered them, in the form or dialog that stays open; "Cancel" asks before it
// discards. After each the emulator holds what it held.
//
// `studio.iam-policy-create-and-edit-refusals-change-nothing`.
//
// The policies are made directly under the check's prefix `<p>` (`services/iam/iam.ts`) and taken apart when the
// check ends. The words of each refusal are read from the same request sent directly, which the emulator refuses the
// same way and which changes nothing.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  callerUserDirect,
  DOC_A,
  DOC_B,
  iamAnswer,
  IamSeeded,
  policyDirect,
  policyIsGone,
  policyVersionsDirect,
  policyVersionTextDirect,
} from './services/iam/iam';
import {
  addressOf,
  button,
  CREATE_POLICY_PATH,
  dialog,
  documentField,
  h1,
  iamPrefix,
  openPolicy,
  POLICIES_PATH,
  section,
  watchActions,
} from './services/iam/iam-screens';

const CREATE = 'Create policy';
const NAME_SIGNS = 'The name can have only letters, digits and the characters + = , . @ _ -.';
const DESCRIPTION_LONG = 'The description can have up to 1000 characters.';
const NOT_JSON = 'Enter the policy as one JSON value.';
const CUT_SHORT = '{"Version": ';
const EMPTY_STATEMENTS = '{"Version": "2012-10-17", "Statement": []}';
const DISCARD_TITLE = 'Discard what you entered?';

/** Opens S6 afresh and waits for its `h1`. */
async function openCreate(page: Page): Promise<void> {
  await page.goto(CREATE_POLICY_PATH);
  await expect(h1(page, CREATE), 'the h1 of S6').toBeVisible();
}

test('studio.iam-policy-create-and-edit-refusals-change-nothing', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'polrefuse');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const seen = watchActions(page, stack.engine.url);
  const account = (await callerUserDirect(ctx, port)).account;
  const arnOf = (name: string) => `arn:aws:iam::${account}:policy/${name}`;
  const nameField = () => main.getByRole('textbox', { name: 'Policy name', exact: true });
  const submit = () => button(main, CREATE).click(ACTION);

  const held = await seeded.policy(`${p}-held`, DOC_A);
  const five = await seeded.policy(`${p}-five`, DOC_A);
  for (let n = 2; n <= 5; n++) await seeded.version(five, DOC_A, true);
  const fiveBefore = await policyVersionsDirect(ctx, port, five);
  expect(fiveBefore.length, `the versions of ${p}-five`).toBe(5);

  await lines.line(
    'On S6, the name `<p> bad` → the alphabet\'s message at the name; a description of 1001 characters → "The description can have up to 1000 characters."; a good name and the text `{"Version": ` → "Enter the policy as one JSON value."; none of the three sent a request to create a policy',
    async () => {
      await openCreate(page);
      await nameField().fill(`${p} bad`, ACTION);
      await submit();
      await expect(main.getByText(NAME_SIGNS, { exact: true }), "the alphabet's message").toBeVisible();

      await openCreate(page);
      await nameField().fill(`${p}-long`, ACTION);
      await main.getByRole('textbox', { name: /^Description/ }).fill('d'.repeat(1001), ACTION);
      await submit();
      await expect(main.getByText(DESCRIPTION_LONG, { exact: true }), "the description's message").toBeVisible();

      await openCreate(page);
      await nameField().fill(`${p}-cut`, ACTION);
      await documentField(main).fill(CUT_SHORT, ACTION);
      await submit();
      await expect(main.getByText(NOT_JSON, { exact: true }), "the document's message").toBeVisible();

      expect(seen.count('CreatePolicy'), 'requests to create a policy that left the page').toBe(0);
      for (const name of [`${p}-long`, `${p}-cut`]) {
        expect(await policyIsGone(ctx, port, arnOf(name)), `the emulator holds no ${name}`).toBe(true);
      }
    },
  );

  await lines.line(
    'The name `<p>-held` with doc-b, "Create policy" → the form stays and shows `EntityAlreadyExists` with the emulator\'s message; the emulator reports `<p>-held` with one version, doc-a',
    async () => {
      const refusal = await iamAnswer(
        ctx,
        port,
        'CreatePolicy',
        { PolicyName: `${p}-held`, PolicyDocument: DOC_B },
        `${p}-held again`,
      );
      expect(refusal.ok, 'a direct CreatePolicy of a held name is refused').toBe(false);
      if (refusal.ok) return;
      expect(refusal.code, 'the code of that refusal').toBe('EntityAlreadyExists');
      await openCreate(page);
      await nameField().fill(`${p}-held`, ACTION);
      await documentField(main).fill(DOC_B, ACTION);
      await submit();
      await expect(main.getByText(refusal.code).first(), 'the code in the form').toBeVisible({ timeout: 30_000 });
      await expect(main.getByText(refusal.message).first(), "the emulator's message in the form").toBeVisible();
      expect(addressOf(page), 'the form stays').toBe(CREATE_POLICY_PATH);
      await expect(nameField(), 'what was typed is kept').toHaveValue(`${p}-held`);
      expect(await policyVersionsDirect(ctx, port, held), `the versions of ${p}-held`).toEqual([
        { id: 'v1', isDefault: true },
      ]);
      expect(await policyVersionTextDirect(ctx, port, held, 'v1'), `the document of ${p}-held`).toBe(DOC_A);
    },
  );

  await lines.line(
    'The name `<p>-empty` with a document whose statement list is empty, "Create policy" → the form stays and shows `MalformedPolicyDocument`; the emulator reports no policy `<p>-empty`',
    async () => {
      await openCreate(page);
      await nameField().fill(`${p}-empty`, ACTION);
      await documentField(main).fill(EMPTY_STATEMENTS, ACTION);
      await submit();
      await expect(main.getByText('MalformedPolicyDocument').first(), 'the code in the form').toBeVisible({
        timeout: 30_000,
      });
      expect(addressOf(page), 'the form stays').toBe(CREATE_POLICY_PATH);
      const gone = await policyIsGone(ctx, port, arnOf(`${p}-empty`));
      if (!gone) seeded.adoptPolicy(arnOf(`${p}-empty`));
      expect(gone, `the emulator holds no ${p}-empty`).toBe(true);
    },
  );

  await lines.line(
    'Type a name, "Cancel" → "Discard what you entered?"; "Keep editing" → the form as it was; "Cancel", "Discard" → S4, and the emulator reports no policy of that name',
    async () => {
      await openCreate(page);
      await nameField().fill(`${p}-dropped`, ACTION);
      await button(main, 'Cancel').click(ACTION);
      const discard = dialog(page, DISCARD_TITLE);
      await expect(discard, `the dialog "${DISCARD_TITLE}"`).toBeVisible();
      await button(discard, 'Keep editing').click(ACTION);
      await expect(discard, 'the dialog after "Keep editing"').toHaveCount(0);
      await expect(nameField(), 'the name as it was').toHaveValue(`${p}-dropped`);
      expect(addressOf(page), 'still S6').toBe(CREATE_POLICY_PATH);
      await button(main, 'Cancel').click(ACTION);
      await button(dialog(page, DISCARD_TITLE), 'Discard').click(ACTION);
      await expect.poll(() => addressOf(page), { message: 'the address of S4' }).toBe(POLICIES_PATH);
      expect(await policyIsGone(ctx, port, arnOf(`${p}-dropped`)), `the emulator holds no ${p}-dropped`).toBe(true);
    },
  );

  await lines.line(
    'On S5 of `<p>-five`, "Edit", the text replaced by doc-b, "Save changes" → the dialog stays and shows `LimitExceeded` with the emulator\'s message; the emulator reports five versions and the same default',
    async () => {
      const refusal = await iamAnswer(
        ctx,
        port,
        'CreatePolicyVersion',
        { PolicyArn: five, PolicyDocument: DOC_B, SetAsDefault: 'true' },
        `a sixth version of ${p}-five`,
      );
      expect(refusal.ok, 'a direct sixth version is refused').toBe(false);
      if (refusal.ok) return;
      expect(refusal.code, 'the code of that refusal').toBe('LimitExceeded');
      const before = await policyDirect(ctx, port, five);
      await openPolicy(page, five, `${p}-five`);
      await button(section(page, 'Policy document'), 'Edit').click(ACTION);
      const editor = dialog(page, `Edit ${p}-five`);
      await expect(documentField(editor), 'the editor holds the default document').toHaveValue(DOC_A);
      await documentField(editor).fill(DOC_B, ACTION);
      await button(editor, 'Save changes').click(ACTION);
      await expect(editor.getByText(refusal.code).first(), 'the code in the dialog').toBeVisible({ timeout: 60_000 });
      await expect(editor.getByText(refusal.message).first(), "the emulator's message in the dialog").toBeVisible();
      await expect(documentField(editor), 'what was typed is kept').toHaveValue(DOC_B);
      expect(await policyVersionsDirect(ctx, port, five), 'the versions the emulator reports').toEqual(fiveBefore);
      expect((await policyDirect(ctx, port, five)).defaultVersionId, 'the default the emulator reports').toBe(
        before.defaultVersionId,
      );
    },
  );

  lines.end();
});
