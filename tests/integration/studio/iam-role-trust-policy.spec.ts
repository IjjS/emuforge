// Editing a role's trust policy (S2, "Trust relationships") in the built app served by `bun run serve`, in front of a
// real engine started for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): the editor
// opens with the document the tab shows; a saved policy reaches the emulator as typed and both sections follow; a text
// that is not JSON sends nothing; a document the emulator refuses stays in the dialog with its answer and changes
// nothing; the role list names the new trusted entities.
//
// `studio.iam-role-trust-policy-edit-reaches-the-emulator`.
//
// The role is made directly under the check's prefix `<p>` (`services/iam/iam.ts`) and deleted when the check ends.
// The lines follow one another on the one role.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { getRoleDirect, IamSeeded } from './services/iam/iam';
import {
  applyFilter,
  button,
  dialog,
  documentField,
  expectFlash,
  iamPrefix,
  openRole,
  ROLES_PATH,
  rowsOf,
  section,
  shownDocument,
  watchActions,
} from './services/iam/iam-screens';

const EDIT = 'Edit trust policy';
const FIELD = 'Trust policy';
const NOT_JSON = 'Enter the trust policy as one JSON value.';
const SERVICES = ['lambda.amazonaws.com', 'states.amazonaws.com'];
/**
 * How "Trusted entities" names a service principal, on the list and on the tab alike (requirement, "Trust
 * relationships"; `main`'s list checks): `lambda.amazonaws.com` reads "AWS Service: lambda".
 */
const namedAs = (service: string) => `AWS Service: ${service.replace(/\.amazonaws\.com$/, '')}`;

const TWO_SERVICES = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: SERVICES }, Action: 'sts:AssumeRole' }],
  },
  null,
  2,
);
const NO_PRINCIPAL = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole' }],
});

test('studio.iam-role-trust-policy-edit-reaches-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'roletrust');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const seen = watchActions(page, stack.engine.url);
  const role = `${p}-trust`;
  await seeded.role(role);

  /** Opens the tab and the editor; returns the dialog. */
  async function openEditor() {
    await openRole(page, role, true);
    await button(section(page, FIELD), EDIT).click(ACTION);
    const editor = dialog(page, EDIT);
    await expect(editor, `the dialog "${EDIT}"`).toBeVisible();
    return editor;
  }

  await lines.line(
    'On S2, "Trust relationships", "Edit trust policy" → the editor holds the trust policy as the tab shows it',
    async () => {
      await openRole(page, role, true);
      const shown = await shownDocument(section(page, FIELD));
      await button(section(page, FIELD), EDIT).click(ACTION);
      await expect(documentField(dialog(page, EDIT), FIELD), 'the editor').toHaveValue(shown);
    },
  );

  await lines.line(
    'Replace the text by a trust policy that lets `lambda.amazonaws.com` and `states.amazonaws.com` assume the role, "Save changes" → "Trust policy of <p>-trust saved."; "Trusted entities" names both services and "Trust policy" shows both; the emulator reports a trust policy equal as JSON to what was typed',
    async () => {
      const editor = await openEditor();
      await documentField(editor, FIELD).fill(TWO_SERVICES, ACTION);
      await button(editor, 'Save changes').click(ACTION);
      await expect(editor, 'the dialog closes').toHaveCount(0, { timeout: 30_000 });
      await expectFlash(page, [`Trust policy of ${role} saved.`], 'the result of the save');
      for (const service of SERVICES) {
        await expect(section(page, 'Trusted entities'), `"Trusted entities" names ${service}`).toContainText(
          namedAs(service),
        );
        await expect(section(page, FIELD), `"Trust policy" shows ${service}`).toContainText(service);
      }
      expect((await getRoleDirect(ctx, port, role)).trustPolicy, 'the trust policy the emulator reports').toEqual(
        JSON.parse(TWO_SERVICES),
      );
    },
  );

  await lines.line(
    '"Edit trust policy", the text `{"Version": ` , "Save changes" → "Enter the trust policy as one JSON value." and no request to change the trust policy left the page',
    async () => {
      const editor = await openEditor();
      const before = seen.count('UpdateAssumeRolePolicy');
      await documentField(editor, FIELD).fill('{"Version": ', ACTION);
      await button(editor, 'Save changes').click(ACTION);
      await expect(editor.getByText(NOT_JSON, { exact: true }), 'the message at the field').toBeVisible();
      expect(seen.count('UpdateAssumeRolePolicy') - before, 'requests to change the trust policy').toBe(0);
    },
  );

  await lines.line(
    'The text of a statement without a principal, "Save changes" → the dialog stays and shows `MalformedPolicyDocument` with "Missing required field Principal"; the emulator reports the trust policy saved two steps before',
    async () => {
      const editor = await openEditor();
      await documentField(editor, FIELD).fill(NO_PRINCIPAL, ACTION);
      await button(editor, 'Save changes').click(ACTION);
      await expect(editor.getByText('MalformedPolicyDocument').first(), 'the code in the dialog').toBeVisible({
        timeout: 30_000,
      });
      await expect(editor, "the emulator's message").toContainText('Missing required field Principal');
      await expect(documentField(editor, FIELD), 'what was typed is kept').toHaveValue(NO_PRINCIPAL);
      expect((await getRoleDirect(ctx, port, role)).trustPolicy, 'the trust policy the emulator reports').toEqual(
        JSON.parse(TWO_SERVICES),
      );
    },
  );

  await lines.line('On S1 the row of `<p>-trust` names both services under "Trusted entities"', async () => {
    await page.goto(ROLES_PATH);
    await expect(main.getByRole('heading', { level: 1, name: /^Roles(\s|$)/ }), 'the role list').toBeVisible();
    await applyFilter(main, role);
    const list = main.getByRole('table', { name: 'Roles', exact: true });
    await expect.poll(async () => (await rowsOf(list, ['Role name'])).flat(), { message: 'the row' }).toEqual([role]);
    const entities = (await rowsOf(list, ['Trusted entities']))[0][0];
    for (const service of SERVICES) expect(entities, `the row names ${service}`).toContain(namedAs(service));
  });

  lines.end();
});
