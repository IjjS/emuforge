// A role's page with its two tabs (S2) in the built app served by `bun run serve`, in front of a real engine started
// for that Studio and the run's emulator (test-criteria.md of issue 535, Integration): "Permissions" lists the
// policies and reads no document until one is asked for; "Show document" of an inline, a customer managed and an AWS
// managed policy shows each as the emulator holds it, several at once; a managed policy the emulator does not hold says
// so in its row; a managed policy's name leads to its page; "Trust relationships" is addressed by `?tab=trust`, shows
// the trusted entities and the trust policy, and is kept by a reload and left by the browser's back.
//
// `studio.iam-role-page-shows-each-policy-document-and-the-trust-policy`.
//
// The role and its policies are made directly under the check's prefix `<p>` (`services/iam/iam.ts`) and taken apart
// when the check ends.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import {
  attachedPoliciesDirect,
  DOC_A,
  DOC_B,
  getRoleDirect,
  IamSeeded,
  inlinePolicyNamesDirect,
  LAMBDA_BASIC,
  LAMBDA_BASIC_NAME,
} from './services/iam/iam';
import {
  addressOf,
  button,
  expectDocument,
  h1,
  iamPrefix,
  openRole,
  PERMISSIONS_POLICIES,
  policyPath,
  rolePath,
  rowOf,
  rowsOf,
  section,
  selectedTab,
  shownDocument,
  tab,
  TAB_PERMISSIONS,
  TAB_TRUST,
  table,
  TYPE_AWS,
  TYPE_CUSTOMER,
  TYPE_INLINE,
  watchActions,
} from './services/iam/iam-screens';

const DOCUMENT_ACTIONS = ['GetRolePolicy', 'GetPolicyVersion'];

test('studio.iam-role-page-shows-each-policy-document-and-the-trust-policy', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = iamPrefix(ctx, 'roledocs');
  const seeded = new IamSeeded(ctx, port);
  const main = page.getByRole('main');
  const seen = watchActions(page, stack.engine.url);
  const role = `${p}-fn`;
  const absentName = `${p}-absent`;
  const absent = `arn:aws:iam::aws:policy/${absentName}`;

  await seeded.role(role);
  const read = await seeded.policy(`${p}-read`, DOC_A);
  await seeded.attach(role, read);
  await seeded.attach(role, LAMBDA_BASIC);
  await seeded.attach(role, absent);
  await seeded.inline(role, `${p}-inline`, DOC_B);

  const policies = () => table(page, PERMISSIONS_POLICIES);
  const show = (name: string) => button(policies(), `Show document of ${name}`).click(ACTION);

  await lines.line(
    'Open S2 of `<p>-fn` → the tabs are "Permissions" (selected) and "Trust relationships" and no other; "Permissions policies" lists the four policies with their types ("Customer managed", "AWS managed", "AWS managed", "Customer inline"); no document is shown and no request for a document left the page',
    async () => {
      await openRole(page, role);
      expect(
        (await main.getByRole('tab').allInnerTexts()).map((t) => t.trim()),
        'the tabs',
      ).toEqual([TAB_PERMISSIONS, TAB_TRUST]);
      expect(await selectedTab(page), 'the selected tab').toBe(TAB_PERMISSIONS);
      const attached = await attachedPoliciesDirect(ctx, port, role);
      const inline = await inlinePolicyNamesDirect(ctx, port, role);
      const expected = [
        ...attached.map((a) => [a.name, a.arn.startsWith('arn:aws:iam::aws:') ? TYPE_AWS : TYPE_CUSTOMER]),
        ...inline.map((n) => [n, TYPE_INLINE]),
      ];
      expect(expected.map((r) => r[1]).sort(), 'the types a direct read gives').toEqual(
        [TYPE_AWS, TYPE_AWS, TYPE_INLINE, TYPE_CUSTOMER].sort(),
      );
      await expect
        .poll(() => rowsOf(policies(), ['Policy name', 'Type']), { message: 'the rows of "Permissions policies"' })
        .toEqual(expected);
      expect(await policies().locator('code').count(), 'documents shown as the page opens').toBe(0);
      expect(
        DOCUMENT_ACTIONS.map((a) => seen.count(a)),
        'requests for a document that left the page',
      ).toEqual([0, 0]);
    },
  );

  await lines.line(
    '"Show document" of `<p>-inline` → the text of doc-b, character for character as it was sent; of `<p>-read` → the text of doc-a as sent; of basic → a document that holds `logs:CreateLogGroup`; the three stay shown together',
    async () => {
      await openRole(page, role);
      await show(`${p}-inline`);
      await expectDocument(rowOf(policies(), `${p}-inline`), DOC_B, 'doc-b in the row of the inline policy');
      await show(`${p}-read`);
      await expectDocument(rowOf(policies(), `${p}-read`), DOC_A, 'doc-a in the row of the customer managed policy');
      await show(LAMBDA_BASIC_NAME);
      await expect(rowOf(policies(), LAMBDA_BASIC_NAME), "basic's document").toContainText('logs:CreateLogGroup');
      await expectDocument(rowOf(policies(), `${p}-inline`), DOC_B, 'doc-b is still shown');
      await expectDocument(rowOf(policies(), `${p}-read`), DOC_A, 'doc-a is still shown');
    },
  );

  await lines.line(
    '"Show document" of absent → "Policy not found" with that ARN in the row\'s place for a document, and the row stays listed',
    async () => {
      await openRole(page, role);
      await show(absentName);
      const row = rowOf(policies(), absentName);
      await expect(row, '"Policy not found" in the row').toContainText('Policy not found');
      await expect(row, 'the ARN in the row').toContainText(absent);
      expect((await rowsOf(policies(), ['Policy name'])).flat(), 'the rows').toContain(absentName);
    },
  );

  await lines.line('"Hide document" of `<p>-inline` → its document is no longer shown, the others are', async () => {
    await openRole(page, role);
    await show(`${p}-inline`);
    await show(`${p}-read`);
    await expectDocument(rowOf(policies(), `${p}-inline`), DOC_B, 'doc-b is shown first');
    await expectDocument(rowOf(policies(), `${p}-read`), DOC_A, 'doc-a is shown first');
    await button(policies(), `Hide document of ${p}-inline`).click(ACTION);
    await expect(rowOf(policies(), `${p}-inline`).locator('code'), "the inline policy's document").toHaveCount(0);
    await expectDocument(rowOf(policies(), `${p}-read`), DOC_A, 'doc-a is still shown');
  });

  await lines.line("The name `<p>-read` → S5 of that policy's ARN opens", async () => {
    await openRole(page, role);
    await policies()
      .getByRole('link', { name: `${p}-read`, exact: true })
      .click(ACTION);
    await expect.poll(() => addressOf(page), { message: 'the address of S5' }).toBe(policyPath(read));
    await expect(h1(page, `${p}-read`), "the policy's h1").toBeVisible();
  });

  await lines.line(
    'Back on S2, the tab "Trust relationships" → the address ends `?tab=trust`; "Trusted entities" names `lambda.amazonaws.com`; "Trust policy" shows the role\'s trust policy over several indented lines, equal as JSON to what the emulator reports for the role',
    async () => {
      await openRole(page, role);
      await tab(page, TAB_TRUST).click(ACTION);
      await expect.poll(() => addressOf(page), { message: 'the address' }).toBe(`${rolePath(role)}?tab=trust`);
      // The section names an entity as the list's column does (requirement, "Trust relationships"): the service
      // `lambda.amazonaws.com` reads "AWS Service: lambda".
      await expect(section(page, 'Trusted entities'), '"Trusted entities"').toContainText('AWS Service: lambda');
      const shown = await shownDocument(section(page, 'Trust policy'));
      const shownLines = shown.split('\n');
      expect(shownLines.length, 'the lines of the trust policy shown').toBeGreaterThan(1);
      expect(
        shownLines.some((l) => /^ {2}\S/.test(l)),
        'a line indented by two spaces',
      ).toBe(true);
      expect(JSON.parse(shown), 'the trust policy shown, as JSON').toEqual(
        (await getRoleDirect(ctx, port, role)).trustPolicy,
      );
    },
  );

  await lines.line(
    'Reload the page → "Trust relationships" is still the selected tab; the browser\'s back → "Permissions"',
    async () => {
      await openRole(page, role);
      await tab(page, TAB_TRUST).click(ACTION);
      await expect.poll(() => selectedTab(page), { message: 'the tab after the choice' }).toBe(TAB_TRUST);
      await page.reload();
      await expect(tab(page, TAB_TRUST), 'the tabs after the reload').toBeVisible();
      await expect.poll(() => selectedTab(page), { message: 'the tab after the reload' }).toBe(TAB_TRUST);
      await page.goBack();
      await expect.poll(() => selectedTab(page), { message: "the tab after the browser's back" }).toBe(TAB_PERMISSIONS);
      expect(addressOf(page), 'the address after back').toBe(rolePath(role));
    },
  );

  lines.end();
});
