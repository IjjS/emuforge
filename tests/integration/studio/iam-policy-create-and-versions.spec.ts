// Creating a customer managed policy and working with its versions (S6, S5) in the built app served by
// `bun run serve`, in front of a real engine started for that Studio and the run's emulator (test-criteria.md of issue
// 535, Integration): "Create policy" from the skeleton, "Edit" saving a new default version, "Set as default",
// deleting a version, and the default version's "Delete" unavailable.
//
// `studio.iam-policy-create-and-versions-reach-the-emulator`.
//
// The policy is made by Studio under the check's prefix `<p>`; the check adopts it, reads it directly after each step
// (`services/iam/iam.ts`) and takes it apart when it ends. The lines follow one another on the one policy.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  callerUserDirect,
  DOC_A,
  DOC_B,
  IamSeeded,
  policyDirect,
  policyVersionsDirect,
  policyVersionTextDirect,
} from './services/iam/iam';
import {
  addressOf,
  button,
  confirmByTyping,
  CREATE_POLICY_PATH,
  dialog,
  documentField,
  expectDocument,
  expectFlash,
  h1,
  iamPrefix,
  openPolicy,
  policyPath,
  POLICIES_PATH,
  rowsOf,
  section,
  table,
  tablePart,
  unavailableReason,
} from './services/iam/iam-screens';

const CREATE = 'Create policy';
const VERSIONS = 'Versions';
const DOCUMENT = 'Policy document';
const DESCRIPTION = 'made in studio';

test('studio.iam-policy-create-and-versions-reach-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'polcreate');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const name = `${p}-new`;
  const account = (await callerUserDirect(ctx, port)).account;
  const arn = `arn:aws:iam::${account}:policy/${name}`;
  seeded.adoptPolicy(arn);
  const versions = () => rowsOf(table(page, VERSIONS), ['Version', 'Default']);
  const chooseVersion = (id: string) => table(page, VERSIONS).getByRole('radio', { name: id, exact: true }).check(ACTION);

  await lines.line(
    'S4, "Create policy" → S6, whose document starts with the skeleton (a statement with an empty list of actions); the name `<p>-new`, the description `made in studio`, the text replaced by doc-a, "Create policy" → S5 of the new policy with "Policy <p>-new created."; the emulator reports the policy with that description and, as its default version `v1`, the text of doc-a as typed',
    async () => {
      await page.goto(POLICIES_PATH);
      await button(main, CREATE).first().click(ACTION);
      await expect.poll(() => addressOf(page), { message: 'the address of S6' }).toBe(CREATE_POLICY_PATH);
      await expect(h1(page, CREATE), 'the h1 of S6').toBeVisible();
      const skeleton = JSON.parse(await documentField(main).inputValue()) as {
        Statement: { Action: unknown }[];
      };
      expect(skeleton.Statement.map((s) => s.Action), 'the skeleton: one statement with no action').toEqual([[]]);
      await main.getByRole('textbox', { name: 'Policy name', exact: true }).fill(name, ACTION);
      await main.getByRole('textbox', { name: /^Description/ }).fill(DESCRIPTION, ACTION);
      await documentField(main).fill(DOC_A, ACTION);
      await button(main, CREATE).click(ACTION);
      await expect.poll(() => addressOf(page), { message: 'the address of S5', timeout: 30_000 }).toBe(policyPath(arn));
      await expectFlash(page, [`Policy ${name} created.`], 'the result of the creation');
      const made = await policyDirect(ctx, port, arn);
      expect(made.description, 'the description the emulator reports').toBe(DESCRIPTION);
      expect(made.defaultVersionId, 'the default version the emulator reports').toBe('v1');
      expect(await policyVersionTextDirect(ctx, port, arn, 'v1'), 'the document of v1 the emulator reports').toBe(DOC_A);
    },
  );

  await lines.line(
    '"Edit" → the editor holds doc-a; replace by doc-b, "Save changes" → "<p>-new saved as version v2, now the default."; "Versions" lists `v2` (default) and `v1`; the emulator reports `v2` as the default with doc-b',
    async () => {
      await openPolicy(page, arn, name);
      await button(section(page, DOCUMENT), 'Edit').click(ACTION);
      const editor = dialog(page, `Edit ${name}`);
      await expect(documentField(editor), 'the editor holds doc-a').toHaveValue(DOC_A);
      await documentField(editor).fill(DOC_B, ACTION);
      await button(editor, 'Save changes').click(ACTION);
      await expect(editor, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expectFlash(page, [`${name} saved as version v2, now the default.`], 'the result of the save');
      await expect.poll(versions, { message: 'the rows of "Versions"' }).toEqual([
        ['v2', 'Yes'],
        ['v1', '-'],
      ]);
      expect((await policyDirect(ctx, port, arn)).defaultVersionId, 'the default the emulator reports').toBe('v2');
      expect(await policyVersionTextDirect(ctx, port, arn, 'v2'), 'the document of v2 the emulator reports').toBe(DOC_B);
    },
  );

  await lines.line(
    'Choose `v1`, "Set as default" → "Version v1 is now the default of <p>-new."; "Policy document" shows doc-a; the emulator reports `v1` as the default',
    async () => {
      await openPolicy(page, arn, name);
      await chooseVersion('v1');
      await button(tablePart(page, VERSIONS), 'Set as default').click(ACTION);
      await expectFlash(page, [`Version v1 is now the default of ${name}.`], 'the result of "Set as default"');
      await expect(section(page, DOCUMENT), 'the version named').toContainText('Version v1, the default.');
      await expectDocument(section(page, DOCUMENT), DOC_A, '"Policy document" shows doc-a');
      expect((await policyDirect(ctx, port, arn)).defaultVersionId, 'the default the emulator reports').toBe('v1');
    },
  );

  await lines.line(
    'Choose `v2`, "Delete" → the dialog "Delete version v2?", confirmed by typing `delete` → "Version v2 of <p>-new deleted."; the emulator reports `v1` as the policy\'s only version',
    async () => {
      await openPolicy(page, arn, name);
      await chooseVersion('v2');
      await button(tablePart(page, VERSIONS), 'Delete').click(ACTION);
      await confirmByTyping(page, 'Delete version v2?');
      await expectFlash(page, [`Version v2 of ${name} deleted.`], 'the result of the deletion');
      expect(await policyVersionsDirect(ctx, port, arn), 'the versions the emulator reports').toEqual([
        { id: 'v1', isDefault: true },
      ]);
    },
  );

  await lines.line('Choose `v1` → "Delete" is unavailable with "The default version cannot be deleted."', async () => {
    await openPolicy(page, arn, name);
    await chooseVersion('v1');
    await expect
      .poll(() => unavailableReason(button(tablePart(page, VERSIONS), 'Delete')), { message: 'the reason on "Delete"' })
      .toBe('The default version cannot be deleted.');
  });

  lines.end();
});
