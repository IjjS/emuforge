// VPC's screens making and deleting a network: the create forms S2 and S5, a subnet's public addresses on S6, and
// the delete dialogs of S1, S3, S4 and S6, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 574: task 2).
//
// `studio.vpc-create-a-vpc-and-its-subnets`, `studio.vpc-subnet-public-addresses-on-launch`,
// `studio.vpc-delete-subnets-and-vpcs-free-and-in-use`.
//
// Each check names its VPCs with its own prefix `<p>` and removes what it and Studio made when it ends (`VpcSeeded`,
// which finds what is in a VPC by the VPC's `vpc-id`). A refusal's message is the emulator's: the check reads it from
// the same call made directly, which the emulator refuses the same way. Words, direct calls and readers:
// `services/vpc/vpc.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alertWith,
  BLOCK,
  button,
  CANCEL,
  cancelDialog,
  CHOSEN_BY_EMULATOR,
  chooseOption,
  confirmWith,
  countActions,
  CREATE_SUBNET,
  CREATE_SUBNET_PATH,
  CREATE_VPC,
  CREATE_VPC_PATH,
  createSubnetPath,
  DELETE,
  DELETE_SUBNET,
  DELETE_VPC,
  dialogOf,
  DISCARD,
  DISCARD_HEADER,
  ec2,
  emptyOf,
  entry,
  errorOf,
  expectFirstPart,
  expectFlash,
  expectNoRow,
  expectRow,
  expectRows,
  expectUnavailable,
  field,
  findBy,
  idOfAddress,
  instanceDirect,
  KEEP_EDITING,
  link,
  listOf,
  NAME,
  NO_GATEWAY_ATTACHED,
  NO_SUBNETS,
  NO_SUCH,
  open,
  PUBLIC_ON_LAUNCH,
  routeTableDirect,
  routeTablesOf,
  SELECT_ONE_SUBNET,
  selectOf,
  selectRow,
  SIZE_RULE,
  SUBNET_IN_USE,
  subnetDirect,
  subnetPath,
  SUBNETS_H1,
  SUBNETS_PATH,
  subnetsOf,
  tableOf,
  TURN_OFF,
  TURN_ON,
  VPC_BLOCK_RULE,
  VPC_FIELD,
  VPC_IN_USE,
  vpcDirect,
  vpcPath,
  VPCS_H1,
  VPCS_PATH,
  vpcsNamed,
  VpcSeeded,
  warningOf,
  ZONE_FIELD,
} from './services/vpc/vpc';

const REFUSED = 'DependencyViolation';

/** The message of a call the emulator must refuse with `code`, made directly; the check's line fails otherwise. */
async function refusal(answer: Awaited<ReturnType<typeof ec2>>, code: string, what: string): Promise<string> {
  expect(answer.code, `${what}, asked directly: the emulator's code`).toBe(code);
  expect(answer.message ?? '', `${what}, asked directly: the emulator's message`).not.toBe('');
  return answer.message ?? '';
}

/** Waits until the open dialog shows the emulator's refusal `code`. */
async function expectDialogRefusal(page: Page, code: string): Promise<void> {
  await expect(dialogOf(page), `the dialog stays and shows ${code}`).toContainText(code, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-create-a-vpc-and-its-subnets', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcnew');
  // Makes nothing itself: it removes what Studio makes under the prefix when the check ends.
  new VpcSeeded(ctx, port, p);
  const main = page.getByRole('main');
  const vpcName = `${p}-net`;
  let vpc = '';
  /** The id of the VPC the first line made; the line fails when there is none. */
  const made = (): string => {
    expect(vpc, 'the VPC of the first line').not.toBe('');
    return vpc;
  };
  /** Opens S5 with the VPC of the first line chosen, and waits until "VPC" shows it. */
  const openSubnetForm = async (): Promise<void> => {
    await open(page, createSubnetPath(made()), CREATE_SUBNET);
    await expect(selectOf(field(main, VPC_FIELD)), 'the VPC chosen by the address').toContainText(made(), {
      timeout: 30_000,
    });
  };

  await lines.line(
    'S1, "Create VPC" → S2; the name `<prefix>-net`, the block `10.62.0.0/16`, "Create VPC" → S3 of a new VPC with "Created VPC {id}"; the emulator reports that VPC with the tag `Name` and the block; "Subnets" reads "No subnets"; "Route tables" has one row, "Main" "Yes"; "Internet gateway" says none is attached',
    async () => {
      await open(page, VPCS_PATH, VPCS_H1);
      await link(main, CREATE_VPC).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_VPC_PATH));
      await expect(heading(page, CREATE_VPC)).toBeVisible();
      await entry(page, NAME).fill(vpcName, ACTION);
      await entry(page, BLOCK).fill('10.62.0.0/16', ACTION);
      await button(main, CREATE_VPC).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/vpc\/vpcs\/vpc\/vpc-[0-9a-f]+$/, { timeout: 30_000 });
      vpc = idOfAddress(page);
      await expect(heading(page, vpcName)).toBeVisible({ timeout: 15_000 });
      await expectFlash(page, 'success', `Created VPC ${vpc}`);
      const reported = await vpcDirect(ctx, port, vpc);
      expect(reported?.tags['Name'], 'the tag Name, directly').toBe(vpcName);
      expect(reported?.cidr, 'the block, directly').toBe('10.62.0.0/16');
      await expect(emptyOf(tableOf(main, 'Subnets')), `"${NO_SUBNETS}"`).toContainText(NO_SUBNETS, {
        timeout: 30_000,
      });
      await expectRows(tableOf(main, 'Route tables'), 'Main', ['Yes'], 'one route table, the main one');
      await expect(main.getByText(NO_GATEWAY_ATTACHED, { exact: true }), `"${NO_GATEWAY_ATTACHED}"`).toBeVisible({
        timeout: 30_000,
      });
    },
  );

  await lines.line(
    'S3, "Create subnet" → S5 with that VPC chosen in "VPC"; the name `<prefix>-one`, the zone `us-east-1b`, the block `10.62.1.0/24`, "Create subnet" → S6 of a new subnet with "Created subnet {id}"; the emulator reports it in that VPC with the name, the block and `us-east-1b`',
    async () => {
      await open(page, vpcPath(made()), vpcName);
      await link(tableOf(main, 'Subnets'), CREATE_SUBNET).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(createSubnetPath(made())));
      await expect(heading(page, CREATE_SUBNET)).toBeVisible();
      await expect(selectOf(field(main, VPC_FIELD)), 'the VPC chosen in "VPC"').toContainText(made(), {
        timeout: 30_000,
      });
      await entry(page, NAME).fill(`${p}-one`, ACTION);
      await chooseOption(field(main, ZONE_FIELD), 'us-east-1b');
      await entry(page, BLOCK).fill('10.62.1.0/24', ACTION);
      await button(main, CREATE_SUBNET).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/vpc\/subnets\/subnet\/subnet-[0-9a-f]+$/, { timeout: 30_000 });
      const id = idOfAddress(page);
      await expect(heading(page, `${p}-one`)).toBeVisible({ timeout: 15_000 });
      await expectFlash(page, 'success', `Created subnet ${id}`);
      expect(await subnetDirect(ctx, port, id), 'the subnet, directly').toMatchObject({
        vpcId: made(),
        cidr: '10.62.1.0/24',
        zone: 'us-east-1b',
        tags: { Name: `${p}-one` },
      });
    },
  );

  await lines.line(
    'S5 opened from S4\'s "Create subnet", the VPC chosen by its ID, the zone left "Chosen by the emulator", the block `10.62.2.0/24` → S6; the emulator reports the subnet in `us-east-1a` with no tag `Name`; S6\'s heading is its ID',
    async () => {
      await open(page, SUBNETS_PATH, SUBNETS_H1);
      await link(main, CREATE_SUBNET).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_SUBNET_PATH));
      await expect(heading(page, CREATE_SUBNET)).toBeVisible();
      await chooseOption(field(main, VPC_FIELD), made(), made());
      await expect(selectOf(field(main, VPC_FIELD)), 'the VPC chosen by its ID').toContainText(made());
      await expect(selectOf(field(main, ZONE_FIELD)), 'the zone as the form opened').toContainText(CHOSEN_BY_EMULATOR);
      await entry(page, BLOCK).fill('10.62.2.0/24', ACTION);
      await button(main, CREATE_SUBNET).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/vpc\/subnets\/subnet\/subnet-[0-9a-f]+$/, { timeout: 30_000 });
      const id = idOfAddress(page);
      const reported = await subnetDirect(ctx, port, id);
      expect(reported, 'the subnet, directly').toMatchObject({ vpcId: made(), cidr: '10.62.2.0/24', zone: 'us-east-1a' });
      expect(reported?.tags['Name'], 'its tag Name, directly').toBeUndefined();
      await expect(heading(page, id), "S6's heading is the subnet's ID").toBeVisible({ timeout: 15_000 });
    },
  );

  await lines.line(
    "S5 with that VPC, the block `10.63.0.0/24` (outside the VPC's) → the form stays with the emulator's `InvalidSubnet.Range` and its message, every entry as it was; the emulator reports no subnet with that block",
    async () => {
      await openSubnetForm();
      await entry(page, NAME).fill(`${p}-out`, ACTION);
      await entry(page, BLOCK).fill('10.63.0.0/24', ACTION);
      await button(main, CREATE_SUBNET).click(ACTION);
      const alert = alertWith(main, 'InvalidSubnet.Range');
      await expect(alert, 'the refusal on the form').toBeVisible({ timeout: 30_000 });
      const message = await refusal(
        await ec2(ctx, port, 'CreateSubnet', { VpcId: made(), CidrBlock: '10.63.0.0/24' }),
        'InvalidSubnet.Range',
        'a subnet outside the block',
      );
      await expect(alert, "the emulator's message").toContainText(message);
      await expect(page, 'the form stays').toHaveURL(addressOf(createSubnetPath(made())));
      await expect(entry(page, NAME), 'the name as it was').toHaveValue(`${p}-out`);
      await expect(entry(page, BLOCK), 'the block as it was').toHaveValue('10.63.0.0/24');
      await expect(selectOf(field(main, VPC_FIELD)), 'the VPC as it was').toContainText(made());
      await expect(selectOf(field(main, ZONE_FIELD)), 'the zone as it was').toContainText(CHOSEN_BY_EMULATOR);
      expect(
        (await subnetsOf(ctx, port, made())).filter((each) => each.cidr === '10.63.0.0/24'),
        'subnets with that block, directly',
      ).toEqual([]);
    },
  );

  await lines.line(
    "S5 with that VPC, the block `10.62.1.128/25` (inside the first subnet's) → the form stays with the emulator's `InvalidSubnet.Conflict`; the emulator reports two subnets in the VPC",
    async () => {
      await openSubnetForm();
      await entry(page, BLOCK).fill('10.62.1.128/25', ACTION);
      await button(main, CREATE_SUBNET).click(ACTION);
      await expect(alertWith(main, 'InvalidSubnet.Conflict'), 'the refusal on the form').toBeVisible({
        timeout: 30_000,
      });
      await expect(page, 'the form stays').toHaveURL(addressOf(createSubnetPath(made())));
      expect((await subnetsOf(ctx, port, made())).length, 'the subnets of the VPC, directly').toBe(2);
    },
  );

  await lines.line(
    'S5, the block `10.62.3.0/29` → "The block\'s size must be from /16 to /28." at the field; no request to create left the page',
    async () => {
      await openSubnetForm();
      const sent = countActions(page, 'CreateSubnet');
      await entry(page, BLOCK).fill('10.62.3.0/29', ACTION);
      await button(main, CREATE_SUBNET).click(ACTION);
      await expect(errorOf(field(main, BLOCK)), 'the message at the field').toHaveText(SIZE_RULE);
      expect(sent.count(), 'CreateSubnet requests that left the page').toBe(0);
    },
  );

  await lines.line(
    'S2, the block `not-a-cidr` → "Enter an IPv4 block in CIDR notation, such as 10.0.0.0/16." at the field; the block `10.0.0.0/15` → "The block\'s size must be from /16 to /28."; no request to create left the page',
    async () => {
      await open(page, CREATE_VPC_PATH, CREATE_VPC);
      const sent = countActions(page, 'CreateVpc');
      await entry(page, BLOCK).fill('not-a-cidr', ACTION);
      await button(main, CREATE_VPC).click(ACTION);
      await expect(errorOf(field(main, BLOCK)), 'the message for no block').toHaveText(VPC_BLOCK_RULE);
      await entry(page, BLOCK).fill('10.0.0.0/15', ACTION);
      await button(main, CREATE_VPC).click(ACTION);
      await expect(errorOf(field(main, BLOCK)), 'the message for the size').toHaveText(SIZE_RULE);
      expect(sent.count(), 'CreateVpc requests that left the page').toBe(0);
    },
  );

  await lines.line(
    'S5 at `?vpc=` a well-formed ID the emulator does not hold → "VPC" is unchosen and under it reads "The emulator holds no VPC {id}. Choose another."',
    async () => {
      expect(await vpcDirect(ctx, port, NO_SUCH.vpc), 'the VPC of that ID, directly').toBeNull();
      await open(page, createSubnetPath(NO_SUCH.vpc), CREATE_SUBNET);
      const vpcField = field(main, VPC_FIELD);
      await expect(warningOf(vpcField), 'the sentence under "VPC"').toHaveText(
        `The emulator holds no VPC ${NO_SUCH.vpc}. Choose another.`,
        { timeout: 30_000 },
      );
      await expect(selectOf(vpcField), '"VPC" is unchosen').not.toContainText(NO_SUCH.vpc);
    },
  );

  await lines.line(
    'S2, a name typed, "Cancel" → "Discard what you entered?"; "Keep editing" keeps the form; "Cancel", "Discard" → S1; the emulator reports no VPC of that name',
    async () => {
      const name = `${p}-dropped`;
      await open(page, CREATE_VPC_PATH, CREATE_VPC);
      await entry(page, NAME).fill(name, ACTION);
      await button(main, CANCEL).click(ACTION);
      await expect(dialogOf(page), `"${DISCARD_HEADER}"`).toContainText(DISCARD_HEADER);
      await button(dialogOf(page), KEEP_EDITING).click(ACTION);
      await expect(dialogOf(page), 'the dialog after "Keep editing"').toHaveCount(0);
      await expect(page, 'the form is kept').toHaveURL(addressOf(CREATE_VPC_PATH));
      await expect(entry(page, NAME), 'the name is kept').toHaveValue(name);
      await button(main, CANCEL).click(ACTION);
      await button(dialogOf(page), DISCARD).click(ACTION);
      await expect(page).toHaveURL(addressOf(VPCS_PATH));
      await expect(heading(page, VPCS_H1)).toBeVisible();
      expect(await vpcsNamed(ctx, port, name), 'VPCs of that name, directly').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-subnet-public-addresses-on-launch', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcpub');
  const seeded = new VpcSeeded(ctx, port, p);
  const vpc = await seeded.vpc(`${p}-v`, '10.67.0.0/16');
  const subnet = await seeded.subnet(vpc, `${p}-pub`, '10.67.1.0/24');
  const main = page.getByRole('main');

  await lines.line(
    'S6 of the subnet → "Public IPv4 address on launch" "Off"; "Turn on" → "Public IPv4 addresses on launch turned on for {id}" and the value reads "On" without a refresh; the emulator reports `MapPublicIpOnLaunch` true',
    async () => {
      await open(page, subnetPath(subnet), `${p}-pub`);
      await expectFirstPart(page, PUBLIC_ON_LAUNCH, 'Off');
      await button(main, TURN_ON).click(ACTION);
      await expectFlash(page, 'success', `Public IPv4 addresses on launch turned on for ${subnet}`);
      await expectFirstPart(page, PUBLIC_ON_LAUNCH, 'On');
      expect((await subnetDirect(ctx, port, subnet))?.publicOnLaunch, 'MapPublicIpOnLaunch, directly').toBe(true);
    },
  );

  await lines.line(
    'An instance launched directly into the subnet → the emulator reports it with a public IPv4 address',
    async () => {
      const instance = await seeded.instance(`${p}-first`, subnet);
      expect((await instanceDirect(ctx, port, instance))?.publicIp, 'its public IPv4 address, directly').toBeDefined();
    },
  );

  await lines.line(
    '"Turn off" → "Public IPv4 addresses on launch turned off for {id}", the value reads "Off"; the emulator reports false; a second instance launched directly into the subnet → the emulator reports it with no public IPv4 address',
    async () => {
      await open(page, subnetPath(subnet), `${p}-pub`);
      await expectFirstPart(page, PUBLIC_ON_LAUNCH, 'On');
      await button(main, TURN_OFF).click(ACTION);
      await expectFlash(page, 'success', `Public IPv4 addresses on launch turned off for ${subnet}`);
      await expectFirstPart(page, PUBLIC_ON_LAUNCH, 'Off');
      expect((await subnetDirect(ctx, port, subnet))?.publicOnLaunch, 'MapPublicIpOnLaunch, directly').toBe(false);
      const instance = await seeded.instance(`${p}-second`, subnet);
      expect((await instanceDirect(ctx, port, instance))?.publicIp, 'its public IPv4 address, directly').toBeUndefined();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-delete-subnets-and-vpcs-free-and-in-use', async ({ ctx, page }) => {
  test.setTimeout(360_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcdel');
  const seeded = new VpcSeeded(ctx, port, p);
  const a = await seeded.vpc(`${p}-a`, '10.68.0.0/16');
  const a1 = await seeded.subnet(a, `${p}-a1`, '10.68.1.0/24');
  const a2 = await seeded.subnet(a, `${p}-a2`, '10.68.2.0/24');
  const a3 = await seeded.subnet(a, `${p}-a3`, '10.68.3.0/24');
  await seeded.instance(`${p}-held`, a1);
  await seeded.natGateway(a2);
  const b = await seeded.vpc(`${p}-b`, '10.69.0.0/16');
  await seeded.group(b, `${p}-own`);
  const c = await seeded.vpc(`${p}-c`, '10.70.0.0/16');
  await seeded.attach(await seeded.gateway(`${p}-igw`), c);
  const d = await seeded.vpc(`${p}-d`, '10.71.0.0/16');
  const second = await seeded.routeTable(d, `${p}-second`);
  const main = page.getByRole('main');

  /** On S4: finds the subnet `name`, selects it and opens its delete dialog. */
  const deleteOnList = async (path: string, h1: string, name: string): Promise<void> => {
    await open(page, path, h1);
    const table = listOf(page);
    await findBy(table, name);
    await expectRow(table, 'Name', name);
    await selectRow(table, 'Name', name);
    await button(main, DELETE).click(ACTION);
  };

  await lines.line(
    'S6 of A1, "Delete subnet" → "Delete subnet?" naming it, with the sentence that the emulator refuses while something is in the subnet; type `delete`, "Delete" → the dialog stays and shows the emulator\'s `DependencyViolation` and its message; "Cancel"; the emulator still reports A1',
    async () => {
      await open(page, subnetPath(a1), `${p}-a1`);
      await button(main, DELETE_SUBNET).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete subnet?');
      await expect(dialog, 'the dialog names the subnet').toContainText(`${p}-a1`);
      await expect(dialog, "the dialog's sentence").toContainText(SUBNET_IN_USE);
      await confirmWith(page, 'delete', DELETE);
      await expectDialogRefusal(page, REFUSED);
      const message = await refusal(
        await ec2(ctx, port, 'DeleteSubnet', { SubnetId: a1 }),
        REFUSED,
        'deleting a subnet that holds an instance',
      );
      await expect(dialog, "the emulator's message").toContainText(message);
      await cancelDialog(page);
      expect(await subnetDirect(ctx, port, a1), 'A1, directly').not.toBeNull();
    },
  );

  await lines.line(
    'S4, "Find by name" A2\'s name, select it, "Delete", type `delete`, "Delete" → the dialog stays with `DependencyViolation`; "Cancel"; the emulator still reports A2',
    async () => {
      await deleteOnList(SUBNETS_PATH, SUBNETS_H1, `${p}-a2`);
      await confirmWith(page, 'delete', DELETE);
      await expectDialogRefusal(page, REFUSED);
      await cancelDialog(page);
      expect(await subnetDirect(ctx, port, a2), 'A2, directly').not.toBeNull();
    },
  );

  await lines.line(
    'S4, "Find by name" A3\'s name, no row selected → "Delete" is unavailable ("Select one subnet."); select A3, "Delete", "Cancel" → the emulator still reports A3; "Delete", type `delete`, "Delete" → "Deleted subnet {name}" and the row is gone; the emulator reports no such subnet',
    async () => {
      await open(page, SUBNETS_PATH, SUBNETS_H1);
      const table = listOf(page);
      await findBy(table, `${p}-a3`);
      await expectRow(table, 'Name', `${p}-a3`);
      await expectUnavailable(button(main, DELETE), SELECT_ONE_SUBNET, '"Delete" with no row selected');
      await selectRow(table, 'Name', `${p}-a3`);
      await button(main, DELETE).click(ACTION);
      await cancelDialog(page);
      expect(await subnetDirect(ctx, port, a3), 'A3 after "Cancel", directly').not.toBeNull();
      await button(main, DELETE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', `Deleted subnet ${p}-a3`);
      await expectNoRow(table, 'Name', `${p}-a3`);
      expect(await subnetDirect(ctx, port, a3), 'A3 after the delete, directly').toBeNull();
    },
  );

  await lines.line(
    'S3 of A, "Delete VPC" → "Delete VPC?" naming it, with the sentence of what the emulator refuses; type `delete`, "Delete" → the dialog stays with `DependencyViolation`; the emulator still reports A',
    async () => {
      await open(page, vpcPath(a), `${p}-a`);
      await button(main, DELETE_VPC).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete VPC?');
      await expect(dialog, 'the dialog names the VPC').toContainText(`${p}-a`);
      await expect(dialog, "the dialog's sentence").toContainText(VPC_IN_USE);
      await confirmWith(page, 'delete', DELETE);
      await expectDialogRefusal(page, REFUSED);
      expect(await vpcDirect(ctx, port, a), 'A, directly').not.toBeNull();
      await cancelDialog(page);
    },
  );

  await lines.line(
    'S1, "Find by name" B\'s name, select it, "Delete", type `delete`, "Delete" → the dialog stays with `DependencyViolation`; the emulator still reports B; the same for C',
    async () => {
      for (const [name, id] of [
        [`${p}-b`, b],
        [`${p}-c`, c],
      ] as const) {
        await deleteOnList(VPCS_PATH, VPCS_H1, name);
        await confirmWith(page, 'delete', DELETE);
        await expectDialogRefusal(page, REFUSED);
        expect(await vpcDirect(ctx, port, id), `${name}, directly`).not.toBeNull();
        await cancelDialog(page);
      }
    },
  );

  await lines.line(
    'S3 of D, "Delete VPC", type `delete`, "Delete" → S1 with "Deleted VPC <prefix>-d"; the emulator reports no VPC D and no route table of D, the second one included',
    async () => {
      await open(page, vpcPath(d), `${p}-d`);
      await button(main, DELETE_VPC).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(VPCS_PATH), { timeout: 30_000 });
      await expect(heading(page, VPCS_H1)).toBeVisible();
      await expectFlash(page, 'success', `Deleted VPC ${p}-d`);
      expect(await vpcDirect(ctx, port, d), 'D, directly').toBeNull();
      expect(await routeTablesOf(ctx, port, d), 'the route tables of D, directly').toEqual([]);
      expect(await routeTableDirect(ctx, port, second), "D's second route table, directly").toBeNull();
    },
  );

  lines.end();
});
