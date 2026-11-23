// EC2's security groups: the list S4, the create form S5, a group's page S6 with its rules and the add-rule form S7,
// in the built app in front of a real engine and emulator (test-criteria.md, issue 553: task 4).
//
// `studio.ec2-security-group-from-create-to-delete`, `studio.ec2-security-groups-made-elsewhere-and-in-use`.
//
// Each check names its groups and instances with its own prefix `<p>` and removes them when it ends (`Ec2Seeded`).
// The emulator's lists hold other checks' resources, so a check finds its own by the list's name filter, or opens a
// page by its address. Words, direct calls and readers: `services/ec2/ec2.ts`.

import type { Locator, Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ADD_RULE,
  addRulePath,
  alertWith,
  button,
  cancelDialog,
  chooseOption,
  confirmWith,
  countActions,
  CREATE_GROUP,
  CREATE_GROUP_PATH,
  DEFAULT_GROUP_STAYS,
  DELETE,
  dialogOf,
  type DirectRule,
  ec2,
  Ec2Seeded,
  errorOf,
  expectFlash,
  expectRows,
  expectUnavailable,
  expectValueIs,
  field,
  findBy,
  GROUP_NOT_FOUND,
  groupDirect,
  groupPath,
  GROUPS_H1,
  GROUPS_PATH,
  groupsDirect,
  groupsNamed,
  NAME_NOT_SG,
  open,
  PORT_RULE,
  radio,
  rowsOf,
  rulesDirect,
  selectRow,
  TABLE,
  tableOf,
  VIEW_GROUPS,
  world,
} from './services/ec2/ec2';

const NONE = '-';
const RULE_COLUMNS = ['Direction', 'Protocol', 'Port range', 'Source or destination', 'Description', 'Rule ID'] as const;

/** A rule's row as one line of its six values. */
function ruleLine(row: Record<string, string>): string {
  return RULE_COLUMNS.map((column) => row[column] ?? '').join(' | ');
}

/** Waits until the rules table shows exactly the rows `want` (each six values, in the columns' order). */
async function expectRules(rules: Locator, want: string[][], what: string): Promise<void> {
  await expect
    .poll(async () => (await rowsOf(rules)).map(ruleLine).sort(), { message: what, timeout: 30_000 })
    .toEqual(want.map((each) => each.join(' | ')).sort());
}

/** What a rule is found by among the rules the emulator reports. */
interface RuleLike {
  egress: boolean;
  protocol: string;
  from?: string;
  to?: string;
  cidr4?: string;
  cidr6?: string;
  group?: string;
}

function matching(rules: DirectRule[], like: RuleLike): DirectRule[] {
  return rules.filter(
    (rule) =>
      rule.egress === like.egress &&
      rule.protocol === like.protocol &&
      (like.from === undefined || rule.from === like.from) &&
      (like.to === undefined || rule.to === like.to) &&
      (like.cidr4 === undefined || rule.cidr4 === like.cidr4) &&
      (like.cidr6 === undefined || rule.cidr6 === like.cidr6) &&
      (like.group === undefined || rule.group === like.group),
  );
}

/** What S7 is filled with. */
interface RuleEntry {
  direction?: 'inbound' | 'outbound';
  protocol?: 'tcp' | 'udp' | 'icmp' | 'all';
  first?: string;
  last?: string;
  cidr?: string;
  /** A group chosen by typing `typed`. */
  group?: { id: string; typed: string };
  description?: string;
}

/** Fills the add-rule form on the page with `entry`; what the entry leaves out stays as the form opened. */
async function fillRule(page: Page, entry: RuleEntry): Promise<void> {
  const main = page.getByRole('main');
  if (entry.direction !== undefined) await radio(field(main, 'Direction'), entry.direction).click(ACTION);
  if (entry.protocol !== undefined) await chooseOption(field(main, 'Protocol'), entry.protocol);
  if (entry.first !== undefined) await field(main, 'First port').getByRole('textbox').fill(entry.first, ACTION);
  if (entry.last !== undefined) {
    await field(main, 'Last port - optional').getByRole('textbox').fill(entry.last, ACTION);
  }
  if (entry.cidr !== undefined) await field(main, 'CIDR block').getByRole('textbox').fill(entry.cidr, ACTION);
  if (entry.group !== undefined) {
    const peer = field(main, entry.direction === 'outbound' ? 'Destination' : 'Source');
    await radio(peer, 'group').click(ACTION);
    await chooseOption(field(main, 'Security group'), entry.group.id, entry.group.typed);
  }
  if (entry.description !== undefined) {
    await field(main, 'Description - optional').getByRole('textbox').fill(entry.description, ACTION);
  }
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.ec2-security-group-from-create-to-delete', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2sgnew');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const bName = `${p}-src`;
  const b = await seeded.group(bName, `Source ${p}`);
  const name = `${p}-web`;
  const description = `Web ${p}`;
  const main = page.getByRole('main');
  const rules = () => tableOf(main, 'Rules');
  const groupName = () => field(main, 'Name').getByRole('textbox');
  const groupDescription = () => field(main, 'Description').getByRole('textbox');
  let id = '';
  /** The id of the group the lines before made; the line fails when there is none. */
  const made = (): string => {
    expect(id, 'the group of the first line').not.toBe('');
    return id;
  };

  await lines.line(
    'S4, "Create security group" → S5; the name `<prefix>-web`, the description `Web <prefix>`, "Create security group" → S6 of the new group with "Created security group <prefix>-web"; "Rules" has one row, "Outbound", "All", "All", `0.0.0.0/0`',
    async () => {
      await open(page, GROUPS_PATH, GROUPS_H1);
      await main.getByRole('link', { name: CREATE_GROUP, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_GROUP_PATH));
      await expect(heading(page, CREATE_GROUP)).toBeVisible();
      await groupName().fill(name, ACTION);
      await groupDescription().fill(description, ACTION);
      await button(main, CREATE_GROUP).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/ec2\/security-groups\/group\/sg-[0-9a-f]+$/, { timeout: 30_000 });
      id = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');
      await expect(heading(page, name)).toBeVisible({ timeout: 15_000 });
      await expectFlash(page, 'success', `Created security group ${name}`);
      const reported = await rulesDirect(ctx, port, id);
      expect(reported.length, 'the rules the emulator reports').toBe(1);
      await expectRules(
        rules(),
        [['Outbound', 'All', 'All', '0.0.0.0/0', NONE, reported[0]!.id]],
        'the one outbound rule',
      );
    },
  );

  await lines.line('The emulator reports the group with that name and description in the default VPC', async () => {
    const reported = await groupDirect(ctx, port, made());
    expect([reported?.name, reported?.description, reported?.vpcId], 'the group, directly').toEqual([
      name,
      description,
      w.defaultVpc,
    ]);
  });

  await lines.line(
    '"Add rule" → S7; "Inbound", "TCP", the first port `22`, "IPv4 range" `10.0.0.0/8`, the description `ssh`, "Add rule" → S6 with "Added an inbound rule to <prefix>-web"; the row reads "Inbound", "TCP", "22", `10.0.0.0/8`, `ssh`; the emulator reports that rule',
    async () => {
      await open(page, groupPath(made()), name);
      await rules().getByRole('link', { name: ADD_RULE, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(addRulePath(id)));
      await expect(heading(page, ADD_RULE)).toBeVisible({ timeout: 15_000 });
      await expect(radio(field(main, 'Direction'), 'inbound'), '"Inbound" as the form opens').toBeChecked();
      await fillRule(page, { first: '22', cidr: '10.0.0.0/8', description: 'ssh' });
      await button(main, ADD_RULE).click(ACTION);
      await expect(page).toHaveURL(addressOf(groupPath(id)), { timeout: 30_000 });
      await expectFlash(page, 'success', `Added an inbound rule to ${name}`);
      const found = matching(await rulesDirect(ctx, port, id), {
        egress: false,
        protocol: 'tcp',
        from: '22',
        to: '22',
        cidr4: '10.0.0.0/8',
      });
      expect(
        found.map((rule) => rule.description),
        'the rule, directly',
      ).toEqual(['ssh']);
      await expect
        .poll(async () => (await rowsOf(rules())).map(ruleLine), { message: 'the inbound row', timeout: 30_000 })
        .toContain(['Inbound', 'TCP', '22', '10.0.0.0/8', 'ssh', found[0]!.id].join(' | '));
    },
  );

  await lines.line(
    'S7, the same rule again → the form stays with the emulator\'s `InvalidPermission.Duplicate`; the emulator reports one such rule',
    async () => {
      await open(page, addRulePath(made()), ADD_RULE);
      await fillRule(page, { first: '22', cidr: '10.0.0.0/8', description: 'ssh' });
      await button(main, ADD_RULE).click(ACTION);
      await expect(alertWith(main, 'InvalidPermission.Duplicate'), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(page).toHaveURL(addressOf(addRulePath(id)));
      expect(
        matching(await rulesDirect(ctx, port, id), { egress: false, protocol: 'tcp', from: '22', cidr4: '10.0.0.0/8' })
          .length,
        'such rules, directly',
      ).toBe(1);
    },
  );

  await lines.line(
    'S7, "TCP", `80`, "IPv4 range" `not-a-range` → the form stays with the emulator\'s `InvalidParameterValue` and its message that the CIDR block is malformed; the emulator reports no rule for port 80',
    async () => {
      await open(page, addRulePath(made()), ADD_RULE);
      await fillRule(page, { first: '80', cidr: 'not-a-range' });
      await button(main, ADD_RULE).click(ACTION);
      await expect(alertWith(main, 'InvalidParameterValue'), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(alertWith(main, 'malformed'), "the emulator's message").toBeVisible();
      await expect(page).toHaveURL(addressOf(addRulePath(id)));
      expect(
        matching(await rulesDirect(ctx, port, id), { egress: false, protocol: 'tcp', from: '80' }),
        'rules for port 80, directly',
      ).toEqual([]);
    },
  );

  await lines.line(
    'S7, the first port `70000` → "A port is a whole number from 0 to 65535." at the field; no request to add left the page',
    async () => {
      await open(page, addRulePath(made()), ADD_RULE);
      const inbound = countActions(page, 'AuthorizeSecurityGroupIngress');
      const outbound = countActions(page, 'AuthorizeSecurityGroupEgress');
      await fillRule(page, { first: '70000', cidr: '10.0.0.0/8' });
      await button(main, ADD_RULE).click(ACTION);
      await expect(errorOf(field(main, 'First port')), `"${PORT_RULE}"`).toHaveText(PORT_RULE);
      await expect(page).toHaveURL(addressOf(addRulePath(id)));
      expect(inbound.count() + outbound.count(), 'requests to add a rule').toBe(0);
    },
  );

  await lines.line(
    'S7, "Outbound", "UDP", `5000` to `5010`, "Security group", B chosen by typing its name, "Add rule" → S6 with "Added an outbound rule to <prefix>-web"; the row reads "Outbound", "UDP", "5000 - 5010" and B\'s ID, which leads to S6 of B; the emulator reports that rule',
    async () => {
      await open(page, addRulePath(made()), ADD_RULE);
      await fillRule(page, {
        direction: 'outbound',
        protocol: 'udp',
        first: '5000',
        last: '5010',
        group: { id: b, typed: bName },
      });
      await button(main, ADD_RULE).click(ACTION);
      await expect(page).toHaveURL(addressOf(groupPath(id)), { timeout: 30_000 });
      await expectFlash(page, 'success', `Added an outbound rule to ${name}`);
      const found = matching(await rulesDirect(ctx, port, id), {
        egress: true,
        protocol: 'udp',
        from: '5000',
        to: '5010',
        group: b,
      });
      expect(found.length, 'the rule, directly').toBe(1);
      await expect
        .poll(async () => (await rowsOf(rules())).map(ruleLine), { message: 'the outbound row', timeout: 30_000 })
        .toContain(['Outbound', 'UDP', '5000 - 5010', b, NONE, found[0]!.id].join(' | '));
      await rules().getByRole('link', { name: b, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(groupPath(b)));
      await expect(heading(page, bName)).toBeVisible({ timeout: 15_000 });
    },
  );

  await lines.line(
    'S6 of the new group, select the inbound rule, "Delete rule" → "Delete rule?" naming it; type `delete`, "Delete" → "Deleted the rule {rule id}", the row is gone; the emulator reports no inbound rule of the group',
    async () => {
      const inbound = (await rulesDirect(ctx, port, made())).filter((rule) => !rule.egress);
      expect(inbound.length, 'the inbound rules before, directly').toBe(1);
      const ruleId = inbound[0]!.id;
      await open(page, groupPath(id), name);
      await expect
        .poll(async () => (await rowsOf(rules())).map((row) => row['Rule ID']), { message: 'the rule\'s row' })
        .toContain(ruleId);
      await selectRow(rules(), 'Rule ID', ruleId);
      await button(rules(), 'Delete rule').click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete rule?');
      await expect(dialog, 'the dialog names the rule').toContainText('10.0.0.0/8');
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', `Deleted the rule ${ruleId}`);
      await expect
        .poll(async () => (await rowsOf(rules())).map((row) => row['Rule ID']), {
          message: 'the rows after the delete',
          timeout: 30_000,
        })
        .not.toContain(ruleId);
      expect(
        (await rulesDirect(ctx, port, id)).filter((rule) => !rule.egress),
        'the inbound rules, directly',
      ).toEqual([]);
    },
  );

  await lines.line(
    'S5, the name `<prefix>-web` again with a description → the form stays with the emulator\'s `InvalidGroup.Duplicate`; the emulator reports one group of that name',
    async () => {
      made();
      await open(page, CREATE_GROUP_PATH, CREATE_GROUP);
      await groupName().fill(name, ACTION);
      await groupDescription().fill(`Again ${p}`, ACTION);
      await button(main, CREATE_GROUP).click(ACTION);
      await expect(alertWith(main, 'InvalidGroup.Duplicate'), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(page).toHaveURL(addressOf(CREATE_GROUP_PATH));
      expect((await groupsNamed(ctx, port, name)).length, 'groups of that name, directly').toBe(1);
    },
  );

  await lines.line(
    'S5, the name `sg-<prefix>` → "A name cannot start with sg-." at the field; no request to create left the page',
    async () => {
      await open(page, CREATE_GROUP_PATH, CREATE_GROUP);
      const creates = countActions(page, 'CreateSecurityGroup');
      await groupName().fill(`sg-${p}`, ACTION);
      await groupDescription().fill(`Never ${p}`, ACTION);
      await button(main, CREATE_GROUP).click(ACTION);
      await expect(errorOf(field(main, 'Name')), `"${NAME_NOT_SG}"`).toHaveText(NAME_NOT_SG);
      await expect(page).toHaveURL(addressOf(CREATE_GROUP_PATH));
      expect(creates.count(), 'requests to create').toBe(0);
    },
  );

  await lines.line(
    'S6 of the new group, "Delete group", type `delete`, "Delete" → S4 with "Deleted security group <prefix>-web"; the emulator reports no group of that name',
    async () => {
      await open(page, groupPath(made()), name);
      await expectValueIs(page, 'Group ID', id);
      await button(main, 'Delete group').click(ACTION);
      await expect(dialogOf(page), 'the dialog').toContainText('Delete security group?');
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(GROUPS_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Deleted security group ${name}`);
      expect(await groupsNamed(ctx, port, name), 'groups of that name, directly').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.ec2-security-groups-made-elsewhere-and-in-use', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2sgseen');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const bName = `${p}-src`;
  const b = await seeded.group(bName, `Source ${p}`);
  const aName = `${p}-api`;
  const aDescription = `Api ${p}`;
  const a = await seeded.group(aName, aDescription);
  await seeded.ingress(a, { protocol: 'tcp', from: 8000, to: 8100, cidr4: '10.1.0.0/16', description: 'api' });
  await seeded.ingress(a, { protocol: 'udp', from: 53, to: 53, cidr4: '10.1.0.0/16' });
  await seeded.ingress(a, { protocol: 'icmp', from: 8, to: 0, cidr4: '0.0.0.0/0' });
  await seeded.ingress(a, { protocol: '-1', group: b });
  await seeded.ingress(a, { protocol: 'tcp', from: 443, to: 443, cidr6: '::/0' });
  await seeded.instance({ name: `${p}-user`, groupIds: [a] });
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  const rules = () => tableOf(main, 'Rules');

  await lines.line(
    'S4, "Find by name" A\'s name → A\'s row alone with its name, group ID, VPC ID and description as the emulator reports them',
    async () => {
      const reported = await groupDirect(ctx, port, a);
      expect(reported, 'the emulator reports A').not.toBeNull();
      await open(page, GROUPS_PATH, GROUPS_H1);
      await findBy(table, aName);
      const rows = await expectRows(table, 'Group ID', [a], "A's row alone");
      expect(
        [rows[0]?.Name, rows[0]?.['Group ID'], rows[0]?.['VPC ID'], rows[0]?.Description],
        "A's row",
      ).toEqual([reported!.name, reported!.id, reported!.vpcId, reported!.description]);
      expect([rows[0]?.Name, rows[0]?.Description], "A's name and description").toEqual([aName, aDescription]);
    },
  );

  await lines.line(
    'Choose A\'s name → S6: "Security group details" shows the group ID, the name, the description, the VPC ID and the ARN; "Rules" reads, each "Inbound": "TCP" "8000 - 8100" `10.1.0.0/16` `api`; "UDP" "53"; "ICMP" "Type 8, code 0"; "All" "All" with B\'s ID; "TCP" "443" `::/0`; and the outbound rule "All" "All" `0.0.0.0/0`; each with its rule ID as the emulator reports it',
    async () => {
      await open(page, GROUPS_PATH, GROUPS_H1);
      await findBy(table, aName);
      await expectRows(table, 'Group ID', [a], "A's row");
      await table.getByRole('link', { name: aName, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(groupPath(a)));
      await expect(heading(page, aName)).toBeVisible({ timeout: 15_000 });
      const reported = (await groupDirect(ctx, port, a))!;
      expect(reported.arn, 'the ARN the emulator reports').toBeDefined();
      await expectValueIs(page, 'Group ID', a);
      await expectValueIs(page, 'Name', aName);
      await expectValueIs(page, 'Description', aDescription);
      await expectValueIs(page, 'VPC ID', reported.vpcId);
      await expectValueIs(page, 'ARN', reported.arn!);
      const direct = await rulesDirect(ctx, port, a);
      expect(direct.length, 'the rules the emulator reports').toBe(6);
      const idOf = (like: RuleLike): string => {
        const found = matching(direct, like);
        expect(found.length, `the emulator's rule ${JSON.stringify(like)}`).toBe(1);
        return found[0]!.id;
      };
      await expectRules(
        rules(),
        [
          [
            'Inbound',
            'TCP',
            '8000 - 8100',
            '10.1.0.0/16',
            'api',
            idOf({ egress: false, protocol: 'tcp', from: '8000', to: '8100', cidr4: '10.1.0.0/16' }),
          ],
          ['Inbound', 'UDP', '53', '10.1.0.0/16', NONE, idOf({ egress: false, protocol: 'udp', from: '53' })],
          ['Inbound', 'ICMP', 'Type 8, code 0', '0.0.0.0/0', NONE, idOf({ egress: false, protocol: 'icmp' })],
          ['Inbound', 'All', 'All', b, NONE, idOf({ egress: false, protocol: '-1', group: b })],
          ['Inbound', 'TCP', '443', '::/0', NONE, idOf({ egress: false, protocol: 'tcp', from: '443', cidr6: '::/0' })],
          ['Outbound', 'All', 'All', '0.0.0.0/0', NONE, idOf({ egress: true, protocol: '-1', cidr4: '0.0.0.0/0' })],
        ],
        "A's rules",
      );
    },
  );

  await lines.line("Choose B's ID in the rule → S6 of B", async () => {
    await open(page, groupPath(a), aName);
    await rules().getByRole('link', { name: b, exact: true }).click(ACTION);
    await expect(page).toHaveURL(addressOf(groupPath(b)));
    await expect(heading(page, bName)).toBeVisible({ timeout: 15_000 });
    await expectValueIs(page, 'Group ID', b);
  });

  await lines.line(
    'S6 of A, "Delete group", type `delete`, "Delete" → the dialog stays and shows the emulator\'s `DependencyViolation` and its message; "Cancel"; the emulator still reports A',
    async () => {
      await open(page, groupPath(a), aName);
      await expectValueIs(page, 'Group ID', a);
      await button(main, 'Delete group').click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete security group?');
      await confirmWith(page, 'delete', DELETE);
      await expect(dialog, 'the refusal in the dialog').toContainText('DependencyViolation', { timeout: 20_000 });
      await expect(dialog, "the emulator's message").toContainText('has a dependent object');
      await expect(page).toHaveURL(addressOf(groupPath(a)));
      await cancelDialog(page);
      expect((await groupDirect(ctx, port, a))?.name, 'A, directly').toBe(aName);
    },
  );

  await lines.line(
    'S4, "Find by name" `default`, select the group `default` → "Delete" is unavailable ("The default security group cannot be deleted.")',
    async () => {
      const defaults = await groupsDirect(ctx, port, { 'group-name': 'default', 'vpc-id': w.defaultVpc });
      expect(defaults.length, 'the default VPC\'s group default, directly').toBe(1);
      const id = defaults[0]!.id;
      await open(page, GROUPS_PATH, GROUPS_H1);
      await findBy(table, 'default');
      await expect
        .poll(async () => (await rowsOf(table)).map((row) => row['Group ID']), {
          message: 'the row of the group default',
          timeout: 30_000,
        })
        .toContain(id);
      await selectRow(table, 'Group ID', id);
      await expectUnavailable(button(main, DELETE), DEFAULT_GROUP_STAYS, '"Delete" of the group default');
    },
  );

  await lines.line(
    'Open S6 at an ID the emulator does not hold → "Security group not found" with "View security groups", which leads to S4',
    async () => {
      const missing = await seeded.group(`${p}-deleted`, 'Deleted group for the missing detail page');
      const deletion = await ec2(ctx, port, 'DeleteSecurityGroup', { GroupId: missing });
      expect(deletion.status, 'the emulator deleted the group').toBe(200);
      const lookup = await ec2(ctx, port, 'DescribeSecurityGroups', { 'GroupId.1': missing });
      expect(lookup.code, 'the emulator reports the deleted group as missing').toBe('InvalidGroup.NotFound');
      await page.goto(groupPath(missing));
      await expect(main.getByText(GROUP_NOT_FOUND, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(main.locator(TABLE), 'the rules of a group').toHaveCount(0);
      await main.getByRole('link', { name: VIEW_GROUPS, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(GROUPS_PATH));
      await expect(heading(page, GROUPS_H1)).toBeVisible();
    },
  );

  lines.end();
});
