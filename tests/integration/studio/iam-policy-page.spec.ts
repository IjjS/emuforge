// A policy's page (S5, `/aws/iam/policies/details?arn=…`) in the built app served by `bun run serve`, in front of a
// real engine started for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): the
// policy's details with a description shown as text, the default version's document, another version's on "Show
// document", what the policy is attached to, an AWS managed policy read with its changes unavailable, and "Policy not
// found".
//
// `studio.iam-policy-page-shows-the-policy`.
//
// The policy, its second version, the role, the user and the group are made directly (`services/iam/iam.ts`) under
// the check's prefix `<p>` and taken apart when the check ends.

import { expect, startStack, test } from './support';
import { ACTION, breadcrumbs } from './support/frame';
import { Lines } from './support/lines';
import { callerUserDirect, DOC_A, DOC_B, IamSeeded, LAMBDA_BASIC, LAMBDA_BASIC_NAME } from './services/iam/iam';
import {
  addressOf,
  AWS_MANAGED_REASON,
  button,
  h1,
  iamPrefix,
  openPolicy,
  policyPath,
  POLICIES_PATH,
  rolePath,
  rowsOf,
  section,
  table,
  tablePart,
  TYPE_AWS,
  TYPE_CUSTOMER,
  unavailableReason,
} from './services/iam/iam-screens';

const DETAILS = 'Policy details';
const DOCUMENT = 'Policy document';
const VERSIONS = 'Versions';
const ATTACHED = 'Attached to';
const NOT_FOUND = 'Policy not found';
const MARKUP = '<img src=x onerror=alert(1)>';

test('studio.iam-policy-page-shows-the-policy', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'polpage');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const name = `${p}-doc`;

  const dialogs: string[] = [];
  page.on('dialog', (opened) => {
    dialogs.push(opened.message());
    void opened.dismiss();
  });

  const arn = await seeded.policy(name, DOC_A, MARKUP);
  const second = await seeded.version(arn, DOC_B, true);
  expect(second, 'the second version the emulator made').toBe('v2');
  await seeded.role(`${p}-r`);
  await seeded.attach(`${p}-r`, arn);
  await seeded.user(`${p}-u`);
  await seeded.attachUser(`${p}-u`, arn);
  await seeded.group(`${p}-g`);
  await seeded.attachGroup(`${p}-g`, arn);

  await lines.line(
    'S5 of `<p>-doc` → the last crumb and the header are `<p>-doc`; "Policy details" shows its ARN, "Customer managed", the description as text (the page holds no image made from it and no dialog opened), the default version `v2`; "Policy document" says "Version v2, the default." and shows doc-b as sent',
    async () => {
      await openPolicy(page, arn, name);
      expect((await breadcrumbs(page)).at(-1), 'the last crumb').toBe(name);
      const details = section(page, DETAILS);
      await expect(details, 'the ARN').toContainText(arn);
      await expect(details, 'the type').toContainText(TYPE_CUSTOMER);
      await expect(details, 'the description as text').toContainText(MARKUP);
      await expect(details, 'the default version').toContainText('v2');
      expect(await main.locator('img[src="x"]').count(), 'an image made from the description').toBe(0);
      expect(dialogs, 'dialogs the page opened').toEqual([]);
      const document = section(page, DOCUMENT);
      await expect(document, 'the version named').toContainText('Version v2, the default.');
      await expect
        .poll(async () => (await document.innerText()).includes(DOC_B), { message: 'doc-b as it was sent' })
        .toBe(true);
    },
  );

  await lines.line(
    '"Versions" lists `v2` (default) and `v1`; "Show document" of `v1` → "Policy document" says "Version v1." and shows doc-a as sent',
    async () => {
      await openPolicy(page, arn, name);
      const versions = table(page, VERSIONS);
      await expect
        .poll(() => rowsOf(versions, ['Version', 'Default']), { message: 'the rows of "Versions"' })
        .toEqual([
          ['v2', 'Yes'],
          ['v1', '-'],
        ]);
      await versions.getByRole('radio', { name: 'v1', exact: true }).check(ACTION);
      await button(tablePart(page, VERSIONS), 'Show document').click(ACTION);
      const document = section(page, DOCUMENT);
      await expect(document, 'the version named').toContainText('Version v1.');
      await expect
        .poll(async () => (await document.innerText()).includes(DOC_A), { message: 'doc-a as it was sent' })
        .toBe(true);
    },
  );

  await lines.line(
    '"Attached to" lists `<p>-r` as "Role", `<p>-u` as "User", `<p>-g` as "Group"; the name `<p>-r` → S2 of that role',
    async () => {
      await openPolicy(page, arn, name);
      const attached = table(page, ATTACHED);
      await expect
        .poll(async () => (await rowsOf(attached, ['Name', 'Kind'])).sort((a, b) => a[1].localeCompare(b[1])), {
          message: 'the rows of "Attached to"',
        })
        .toEqual([
          [`${p}-g`, 'Group'],
          [`${p}-r`, 'Role'],
          [`${p}-u`, 'User'],
        ]);
      await attached.getByRole('link', { name: `${p}-r`, exact: true }).click(ACTION);
      await expect.poll(() => addressOf(page), { message: 'the address of S2' }).toBe(rolePath(`${p}-r`));
      await expect(h1(page, `${p}-r`), "the role's h1").toBeVisible();
    },
  );

  await lines.line(
    'S5 of basic → its sections are shown with "AWS managed" and its document; "Edit", "Delete" and, for its version, "Set as default" and "Delete" are unavailable with "An AWS managed policy cannot be changed." (not the default version\'s reason)',
    async () => {
      await openPolicy(page, LAMBDA_BASIC, LAMBDA_BASIC_NAME);
      await expect(section(page, DETAILS), 'the type').toContainText(TYPE_AWS);
      await expect(section(page, DOCUMENT), 'its document').toContainText('logs:CreateLogGroup');
      await expect(table(page, ATTACHED), '"Attached to"').toBeVisible();
      const versions = table(page, VERSIONS);
      await expect.poll(async () => (await rowsOf(versions, ['Version'])).length, { message: 'its versions' }).toBe(1);
      const only = (await rowsOf(versions, ['Version']))[0][0];
      await versions.getByRole('radio', { name: only, exact: true }).check(ACTION);
      const header = main.locator('h1').locator('xpath=ancestor::*[.//button][1]');
      for (const [what, control] of [
        ['"Edit"', button(section(page, DOCUMENT), 'Edit')],
        ['"Delete" of the policy', button(header, 'Delete')],
        ['"Set as default"', button(tablePart(page, VERSIONS), 'Set as default')],
        ['"Delete" of the version', button(tablePart(page, VERSIONS), 'Delete')],
      ] as const) {
        await expect.poll(() => unavailableReason(control), { message: `the reason on ${what}` }).toBe(AWS_MANAGED_REASON);
      }
    },
  );

  await lines.line(
    'S5 with the ARN of a policy the emulator does not hold, and S5 without `arn` → "Policy not found" with the link "Policies", which leads to S4',
    async () => {
      const account = (await callerUserDirect(ctx, port)).account;
      await page.goto(policyPath(`arn:aws:iam::${account}:policy/${p}-none`));
      await expect(main.getByText(NOT_FOUND, { exact: true }), `"${NOT_FOUND}" for an ARN not held`).toBeVisible();
      await page.goto(`${POLICIES_PATH}/details`);
      await expect(main.getByText(NOT_FOUND, { exact: true }), `"${NOT_FOUND}" without \`arn\``).toBeVisible();
      await main
        .getByText(NOT_FOUND, { exact: true })
        .locator('xpath=ancestor::*[.//a][1]')
        .getByRole('link', { name: 'Policies', exact: true })
        .click(ACTION);
      await expect.poll(() => addressOf(page), { message: 'the address of S4' }).toBe(POLICIES_PATH);
    },
  );

  lines.end();
});
