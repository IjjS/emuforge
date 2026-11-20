// VPC's screens routing a subnet: the internet gateways S12 to S14 and the route tables S7 to S11, in the built app
// in front of a real engine and emulator (test-criteria.md, issue 574: task 3).
//
// `studio.vpc-route-a-subnet-through-an-internet-gateway`, `studio.vpc-take-routing-apart-and-what-is-refused`.
//
// Each check names its VPCs and gateways with its own prefix `<p>` and removes what it and Studio made when it ends
// (`VpcSeeded`). A refusal's message is the emulator's: the check reads it from the same call made directly, which
// the emulator refuses the same way. Words, direct calls and readers: `services/vpc/vpc.ts`.

import type { Locator } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ADD_ROUTE,
  addRoutePath,
  alertWith,
  ALREADY_ATTACHED,
  ASSOCIATE_SUBNET,
  associateSubnetPath,
  associationsOf,
  ATTACH,
  ATTACH_GATEWAY,
  attachGatewayPath,
  button,
  cancelDialog,
  CHOOSE_A_SUBNET,
  CHOOSE_A_VPC,
  chooseOption,
  confirmWith,
  countActions,
  CREATE_GATEWAY,
  CREATE_GATEWAY_PATH,
  CREATE_ROUTE_TABLE,
  createRouteTablePath,
  DELETE,
  DELETE_ROUTE,
  DELETE_ROUTE_TABLE,
  DESTINATION,
  DESTINATION_RULE,
  DETACH,
  DETACH_FIRST,
  dialogOf,
  DISASSOCIATE,
  ec2,
  emptyOf,
  entry,
  errorOf,
  expectCell,
  expectFlash,
  expectNoRow,
  expectRow,
  expectRows,
  expectUnavailable,
  expectValueIs,
  field,
  findBy,
  findOnly,
  gatewayDirect,
  GATEWAYS_H1,
  GATEWAYS_PATH,
  gatewaysNamed,
  idOfAddress,
  link,
  listOf,
  LOCAL_ROUTE_STAYS,
  MAIN_TABLE_STAYS,
  NAME,
  NO_SUBNET_ASSOCIATIONS,
  NONE,
  NOT_ATTACHED,
  open,
  openOption,
  ROUTE_TABLES_H1,
  ROUTE_TABLES_PATH,
  routeTableDirect,
  routeTablePath,
  ROUTES_TURN_BLACKHOLE,
  rowsOf,
  SELECT_ONE_ASSOCIATION,
  selectOf,
  selectRow,
  SUBNET_FIELD,
  tableOf,
  VIEW_GATEWAYS,
  VPC_FIELD,
  vpcPath,
  VpcSeeded,
} from './services/vpc/vpc';

/** A route's row as one line of its destination, target and state. */
function routeLine(row: Record<string, string>): string {
  return [row['Destination'] ?? '', row['Target'] ?? '', row['State'] ?? ''].join(' | ');
}

/** Waits until the routes table shows exactly the routes `want`, each its destination, target and state. */
async function expectRoutes(routes: Locator, want: string[][], what: string): Promise<void> {
  await expect
    .poll(async () => (await rowsOf(routes)).map(routeLine).sort(), { message: what, timeout: 30_000 })
    .toEqual(want.map((each) => each.join(' | ')).sort());
}

/** The message of a call the emulator must refuse, made directly; with a `code`, the code it must refuse with. */
function refusal(answer: Awaited<ReturnType<typeof ec2>>, code: string | null, what: string): string {
  expect(answer.status, `${what}, asked directly: the emulator refuses`).not.toBe(200);
  if (code !== null) expect(answer.code, `${what}, asked directly: the emulator's code`).toBe(code);
  expect(answer.message ?? '', `${what}, asked directly: the emulator's message`).not.toBe('');
  return answer.message ?? '';
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-route-a-subnet-through-an-internet-gateway', async ({ ctx, page }) => {
  test.setTimeout(360_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcroute');
  const seeded = new VpcSeeded(ctx, port, p);
  const block = '10.64.0.0/16';
  const vpc = await seeded.vpc(`${p}-v`, block);
  const subnet = await seeded.subnet(vpc, `${p}-s`, '10.64.1.0/24');
  const main = page.getByRole('main');
  const gwName = `${p}-gw`;
  const rtName = `${p}-rt`;
  let gw = '';
  let rt = '';
  /** The gateway and the route table the lines before made; the line fails when there is none. */
  const gateway = (): string => {
    expect(gw, 'the internet gateway of the first line').not.toBe('');
    return gw;
  };
  const table = (): string => {
    expect(rt, 'the route table of the third line').not.toBe('');
    return rt;
  };
  const routes = () => tableOf(main, 'Routes');
  const associations = () => tableOf(main, 'Subnet associations');
  /** Opens S10 of the table and waits until "Target" shows the gateway. */
  const openAddRoute = async (): Promise<void> => {
    await open(page, addRoutePath(table()), ADD_ROUTE);
    await expectValueIs(page, 'Internet gateway ID', gateway());
  };
  /** S9 of the table, as S10 and S11 lead back to it. */
  const expectTablePage = async (): Promise<void> => {
    await expect(page).toHaveURL(addressOf(routeTablePath(table())), { timeout: 30_000 });
    await expect(heading(page, rtName)).toBeVisible({ timeout: 15_000 });
  };
  /** S12 with the gateway's row found by its name. */
  const openGateways = async (): Promise<Locator> => {
    await open(page, GATEWAYS_PATH, GATEWAYS_H1);
    const list = listOf(page);
    await findOnly(list, gwName);
    return list;
  };

  await lines.line(
    'S12, "Create internet gateway" → S13; the name `<prefix>-gw`, "Create internet gateway" → S12 with "Created internet gateway {id}"; "Find by name" `<prefix>-gw` → its row reads "Detached" and "-" under "VPC ID"; the emulator reports the gateway with the tag `Name` and no attachment',
    async () => {
      await open(page, GATEWAYS_PATH, GATEWAYS_H1);
      await link(main, CREATE_GATEWAY).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_GATEWAY_PATH));
      await expect(heading(page, CREATE_GATEWAY)).toBeVisible();
      await entry(page, NAME).fill(gwName, ACTION);
      await button(main, CREATE_GATEWAY).click(ACTION);
      await expect(page).toHaveURL(addressOf(GATEWAYS_PATH), { timeout: 30_000 });
      await expect(heading(page, GATEWAYS_H1)).toBeVisible();
      const list = listOf(page);
      await findBy(list, gwName);
      const row = await expectRow(list, 'Name', gwName);
      const reported = await gatewaysNamed(ctx, port, gwName);
      expect(reported.length, 'the gateways of that name, directly').toBe(1);
      gw = reported[0]?.id ?? '';
      expect(reported[0]?.vpcIds, 'its attachments, directly').toEqual([]);
      await expectFlash(page, 'success', `Created internet gateway ${gw}`);
      expect(row, 'the row of the gateway').toMatchObject({
        'Internet gateway ID': gw,
        State: 'Detached',
        'VPC ID': NONE,
      });
    },
  );

  await lines.line(
    'Select it → "Detach" is unavailable ("This gateway is not attached."); "Attach" → S14 naming the gateway; "Attach" with no VPC → "Choose a VPC." at the field, no request to attach left the page; choose the VPC by its ID (the choice shows its name and block), "Attach" → S12 with "Attached {id} to {vpc id}"; the row reads "Attached" with the VPC\'s ID; the emulator reports the attachment',
    async () => {
      const list = await openGateways();
      await selectRow(list, 'Name', gwName);
      await expectUnavailable(button(main, DETACH), NOT_ATTACHED, '"Detach" of a detached gateway');
      // With a gateway selected "Attach" is a link to that gateway's S14.
      await link(main, ATTACH).click(ACTION);
      await expect(page).toHaveURL(addressOf(attachGatewayPath(gateway())));
      await expect(heading(page, ATTACH_GATEWAY)).toBeVisible();
      await expect(main, 'S14 names the gateway').toContainText(`Attaches ${gwName} to a VPC.`, { timeout: 30_000 });
      const sent = countActions(page, 'AttachInternetGateway');
      await button(main, ATTACH).click(ACTION);
      const vpcField = field(main, VPC_FIELD);
      await expect(errorOf(vpcField), 'the message at "VPC"').toHaveText(CHOOSE_A_VPC);
      expect(sent.count(), 'AttachInternetGateway requests that left the page').toBe(0);
      const option = await openOption(vpcField, vpc, vpc);
      await expect(option, "the choice shows the VPC's name").toContainText(`${p}-v`);
      await expect(option, "the choice shows the VPC's block").toContainText(block);
      await option.click(ACTION);
      await expect(selectOf(vpcField), 'the VPC chosen').toContainText(vpc);
      await button(main, ATTACH).click(ACTION);
      await expect(page).toHaveURL(addressOf(GATEWAYS_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Attached ${gateway()} to ${vpc}`);
      const after = listOf(page);
      await findBy(after, gwName);
      await expectCell(after, 'Name', gwName, 'State', 'Attached');
      await expectCell(after, 'Name', gwName, 'VPC ID', vpc);
      expect((await gatewayDirect(ctx, port, gateway()))?.vpcIds, 'the attachment, directly').toEqual([vpc]);
    },
  );

  await lines.line(
    'S3 of the VPC, "Create route table" → S8 with that VPC chosen; the name `<prefix>-rt`, "Create route table" → S9 of a new table with "Created route table {id}"; "Routes" has the local route alone; "Subnet associations" reads "No subnet associations"; the emulator reports the table in the VPC with the name',
    async () => {
      await open(page, vpcPath(vpc), `${p}-v`);
      await link(tableOf(main, 'Route tables'), CREATE_ROUTE_TABLE).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(createRouteTablePath(vpc)));
      await expect(heading(page, CREATE_ROUTE_TABLE)).toBeVisible();
      await expect(selectOf(field(main, VPC_FIELD)), 'the VPC chosen').toContainText(vpc, { timeout: 30_000 });
      await entry(page, NAME).fill(rtName, ACTION);
      await button(main, CREATE_ROUTE_TABLE).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/vpc\/route-tables\/route-table\/rtb-[0-9a-f]+$/, { timeout: 30_000 });
      rt = idOfAddress(page);
      await expect(heading(page, rtName)).toBeVisible({ timeout: 15_000 });
      await expectFlash(page, 'success', `Created route table ${rt}`);
      await expectRoutes(routes(), [[block, 'local', 'active']], 'the local route alone');
      await expect(emptyOf(associations()), `"${NO_SUBNET_ASSOCIATIONS}"`).toContainText(NO_SUBNET_ASSOCIATIONS);
      const reported = await routeTableDirect(ctx, port, rt);
      expect(reported?.vpcId, "the table's VPC, directly").toBe(vpc);
      expect(reported?.tags['Name'], "the table's tag Name, directly").toBe(rtName);
    },
  );

  await lines.line(
    'S9, "Add route" → S10 naming the table; "Target" shows the gateway\'s ID and name; the destination `0.0.0.0/0`, "Add route" → S9 with "Saved the route to {gateway id} in {id}"; "Routes" has a row `0.0.0.0/0`, the gateway\'s ID, `active`; the emulator reports that route',
    async () => {
      await open(page, routeTablePath(table()), rtName);
      await link(routes(), ADD_ROUTE).click(ACTION);
      await expect(page).toHaveURL(addressOf(addRoutePath(table())));
      await expect(heading(page, ADD_ROUTE)).toBeVisible();
      await expect(main, 'S10 names the table').toContainText(`Adds a route to ${rtName}.`, { timeout: 30_000 });
      await expectValueIs(page, 'Internet gateway ID', gateway());
      await expectValueIs(page, 'Name', gwName);
      await entry(page, DESTINATION).fill('0.0.0.0/0', ACTION);
      await button(main, ADD_ROUTE).click(ACTION);
      await expectTablePage();
      await expectFlash(page, 'success', `Saved the route to ${gateway()} in ${table()}`);
      await expectRoutes(
        routes(),
        [
          [block, 'local', 'active'],
          ['0.0.0.0/0', gateway(), 'active'],
        ],
        'the local route and the route to the gateway',
      );
      expect(
        (await routeTableDirect(ctx, port, table()))?.routes.filter((each) => each.destination === '0.0.0.0/0'),
        'the route, directly',
      ).toEqual([{ destination: '0.0.0.0/0', target: gateway(), state: 'active' }]);
    },
  );

  await lines.line(
    'S10, the destination `10.99.8.8/16`, "Add route" → S9, whose "Routes" has the row `10.99.0.0/16` and none that reads `10.99.8.8/16`; the emulator reports the route as `10.99.0.0/16`',
    async () => {
      await openAddRoute();
      await entry(page, DESTINATION).fill('10.99.8.8/16', ACTION);
      await button(main, ADD_ROUTE).click(ACTION);
      await expectTablePage();
      await expectRow(routes(), 'Destination', '10.99.0.0/16');
      expect(
        (await rowsOf(routes())).filter((row) => row['Destination'] === '10.99.8.8/16'),
        'rows that read 10.99.8.8/16',
      ).toEqual([]);
      const reported = (await routeTableDirect(ctx, port, table()))?.routes.map((each) => each.destination);
      expect(reported, 'the routes, directly').toContain('10.99.0.0/16');
      expect(reported, 'the routes, directly').not.toContain('10.99.8.8/16');
    },
  );

  await lines.line(
    'S10, the destination `0.0.0.0/0` again, "Add route" → S9 with "Saved the route to {gateway id} in {id}"; the emulator reports one route `0.0.0.0/0` in the table',
    async () => {
      await openAddRoute();
      await entry(page, DESTINATION).fill('0.0.0.0/0', ACTION);
      await button(main, ADD_ROUTE).click(ACTION);
      await expectTablePage();
      await expectFlash(page, 'success', `Saved the route to ${gateway()} in ${table()}`);
      expect(
        (await routeTableDirect(ctx, port, table()))?.routes.filter((each) => each.destination === '0.0.0.0/0').length,
        'the routes 0.0.0.0/0 of the table, directly',
      ).toBe(1);
    },
  );

  await lines.line(
    'S10, the destination `abc` → "Enter an IPv4 block in CIDR notation, such as 0.0.0.0/0." at the field; no request to add left the page',
    async () => {
      await openAddRoute();
      const sent = countActions(page, 'CreateRoute');
      await entry(page, DESTINATION).fill('abc', ACTION);
      await button(main, ADD_ROUTE).click(ACTION);
      await expect(errorOf(field(main, DESTINATION)), 'the message at the field').toHaveText(DESTINATION_RULE);
      expect(sent.count(), 'CreateRoute requests that left the page').toBe(0);
    },
  );

  await lines.line(
    "S10, the destination `10.64.0.0/16` (the local route's) → the form stays with the emulator's `RouteAlreadyExists` and its message, the entry as it was; the emulator reports the table's routes unchanged",
    async () => {
      const before = (await routeTableDirect(ctx, port, table()))?.routes;
      await openAddRoute();
      await entry(page, DESTINATION).fill(block, ACTION);
      await button(main, ADD_ROUTE).click(ACTION);
      const alert = alertWith(main, 'RouteAlreadyExists');
      await expect(alert, 'the refusal on the form').toBeVisible({ timeout: 30_000 });
      const message = refusal(
        await ec2(ctx, port, 'CreateRoute', {
          RouteTableId: table(),
          DestinationCidrBlock: block,
          GatewayId: gateway(),
        }),
        'RouteAlreadyExists',
        "a route at the local route's destination",
      );
      await expect(alert, "the emulator's message").toContainText(message);
      await expect(page, 'the form stays').toHaveURL(addressOf(addRoutePath(table())));
      await expect(entry(page, DESTINATION), 'the entry as it was').toHaveValue(block);
      expect((await routeTableDirect(ctx, port, table()))?.routes, 'the routes, directly').toEqual(before);
    },
  );

  await lines.line(
    'S9, "Associate subnet" → S11 naming the VPC and the table; "Associate subnet" with none chosen → "Choose a subnet."; choose the subnet by its ID, "Associate subnet" → S9 with "Associated {subnet id} with {id}"; "Subnet associations" has its row; the emulator reports the association',
    async () => {
      await open(page, routeTablePath(table()), rtName);
      await link(associations(), ASSOCIATE_SUBNET).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(associateSubnetPath(table())));
      await expect(heading(page, ASSOCIATE_SUBNET)).toBeVisible();
      await expect(main, 'S11 names the VPC and the table').toContainText(
        `Associates a subnet of ${vpc} with ${rtName}.`,
        { timeout: 30_000 },
      );
      const sent = countActions(page, 'AssociateRouteTable');
      await button(main, ASSOCIATE_SUBNET).click(ACTION);
      const subnetField = field(main, SUBNET_FIELD);
      await expect(errorOf(subnetField), 'the message at "Subnet"').toHaveText(CHOOSE_A_SUBNET);
      expect(sent.count(), 'AssociateRouteTable requests that left the page').toBe(0);
      await chooseOption(subnetField, subnet, subnet);
      await button(main, ASSOCIATE_SUBNET).click(ACTION);
      await expectTablePage();
      await expectFlash(page, 'success', `Associated ${subnet} with ${table()}`);
      await expectRows(associations(), 'Subnet ID', [subnet], "the subnet's association");
      expect((await associationsOf(ctx, port, subnet)).length, 'the associations of the subnet, directly').toBe(1);
      expect(
        (await routeTableDirect(ctx, port, table()))?.associations.map((each) => each.subnetId),
        "the table's associations, directly",
      ).toEqual([subnet]);
    },
  );

  await lines.line(
    "S11, the same subnet again → the form stays with the emulator's `Resource.AlreadyAssociated` and its message; the emulator reports one association of the subnet",
    async () => {
      await open(page, associateSubnetPath(table()), ASSOCIATE_SUBNET);
      await chooseOption(field(main, SUBNET_FIELD), subnet, subnet);
      await button(main, ASSOCIATE_SUBNET).click(ACTION);
      const alert = alertWith(main, 'Resource.AlreadyAssociated');
      await expect(alert, 'the refusal on the form').toBeVisible({ timeout: 30_000 });
      const message = refusal(
        await ec2(ctx, port, 'AssociateRouteTable', { RouteTableId: table(), SubnetId: subnet }),
        'Resource.AlreadyAssociated',
        'a second association of the subnet',
      );
      await expect(alert, "the emulator's message").toContainText(message);
      await expect(page, 'the form stays').toHaveURL(addressOf(associateSubnetPath(table())));
      expect((await associationsOf(ctx, port, subnet)).length, 'the associations of the subnet, directly').toBe(1);
    },
  );

  await lines.line(
    'S12, select the gateway, "Detach" → "Detach internet gateway?" naming the gateway and the VPC, with the sentence that routes to it stay and turn to blackhole; "Cancel" → the emulator still reports the attachment; "Detach", "Detach" → "Detached {id} from {vpc id}", the row reads "Detached"; the emulator reports no attachment and the table\'s route `0.0.0.0/0` with the state `blackhole`',
    async () => {
      const list = await openGateways();
      await selectRow(list, 'Name', gwName);
      await button(main, DETACH).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Detach internet gateway?');
      await expect(dialog, 'the dialog names the gateway').toContainText(gwName);
      await expect(dialog, 'the dialog names the VPC').toContainText(vpc);
      await expect(dialog, "the dialog's sentence").toContainText(ROUTES_TURN_BLACKHOLE);
      await cancelDialog(page);
      expect((await gatewayDirect(ctx, port, gateway()))?.vpcIds, 'the attachment after "Cancel", directly').toEqual([
        vpc,
      ]);
      await button(main, DETACH).click(ACTION);
      await button(dialogOf(page), DETACH).click(ACTION);
      await expectFlash(page, 'success', `Detached ${gateway()} from ${vpc}`);
      await expectCell(list, 'Name', gwName, 'State', 'Detached');
      expect((await gatewayDirect(ctx, port, gateway()))?.vpcIds, 'the attachments, directly').toEqual([]);
      expect(
        (await routeTableDirect(ctx, port, table()))?.routes.find((each) => each.destination === '0.0.0.0/0')?.state,
        'the state of the route 0.0.0.0/0, directly',
      ).toBe('blackhole');
    },
  );

  await lines.line(
    'S9 of the table → the route `0.0.0.0/0` reads `blackhole`; "Add route" → S10 says "No internet gateway is attached to {vpc id}. Attach one to add a route to it." with "View internet gateways", and "Add route" there cannot be sent',
    async () => {
      await open(page, routeTablePath(table()), rtName);
      await expectCell(routes(), 'Destination', '0.0.0.0/0', 'State', 'blackhole');
      await link(routes(), ADD_ROUTE).click(ACTION);
      await expect(page).toHaveURL(addressOf(addRoutePath(table())));
      await expect(heading(page, ADD_ROUTE)).toBeVisible();
      await expect(main, 'what S10 says of the target').toContainText(
        `No internet gateway is attached to ${vpc}. Attach one to add a route to it.`,
        { timeout: 30_000 },
      );
      await expect(link(main, VIEW_GATEWAYS), `"${VIEW_GATEWAYS}"`).toBeVisible();
      await expect(button(main, ADD_ROUTE), '"Add route" cannot be sent').toBeDisabled();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-take-routing-apart-and-what-is-refused', async ({ ctx, page }) => {
  test.setTimeout(360_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcapart');
  const seeded = new VpcSeeded(ctx, port, p);
  const block = '10.72.0.0/16';
  const vpc = await seeded.vpc(`${p}-v`, block);
  const subnet = await seeded.subnet(vpc, `${p}-s`, '10.72.1.0/24');
  const gName = `${p}-g`;
  const g = await seeded.gateway(gName);
  await seeded.attach(g, vpc);
  const h = await seeded.gateway(`${p}-h`);
  const tName = `${p}-t`;
  const t = await seeded.routeTable(vpc, tName);
  await seeded.route(t, '0.0.0.0/0', g);
  await seeded.associate(t, subnet);
  const main = page.getByRole('main');
  const routes = () => tableOf(main, 'Routes');
  const associations = () => tableOf(main, 'Subnet associations');
  /** S12 with G's row found by its name and selected. */
  const selectG = async (): Promise<Locator> => {
    await open(page, GATEWAYS_PATH, GATEWAYS_H1);
    const list = listOf(page);
    await findOnly(list, gName);
    await selectRow(list, 'Name', gName);
    return list;
  };

  await lines.line(
    'S3 of the VPC, the ID of the row that reads "Main" "Yes" chosen in "Route tables" → S9 of the VPC\'s main table: "Delete route table" is unavailable ("A VPC\'s main route table cannot be deleted."); asked directly to delete it, the emulator refuses and still reports it',
    async () => {
      await open(page, vpcPath(vpc), `${p}-v`);
      const tables = tableOf(main, 'Route tables');
      const row = await expectRow(tables, 'Main', 'Yes');
      const mainTable = row['Route table ID'] ?? '';
      await link(tables, mainTable).click(ACTION);
      await expect(page).toHaveURL(addressOf(routeTablePath(mainTable)));
      await expectValueIs(page, 'Main', 'Yes');
      await expectUnavailable(button(main, DELETE_ROUTE_TABLE), MAIN_TABLE_STAYS, '"Delete route table" of a main table');
      refusal(await ec2(ctx, port, 'DeleteRouteTable', { RouteTableId: mainTable }), null, 'deleting a main table');
      expect(await routeTableDirect(ctx, port, mainTable), 'the main table, directly').not.toBeNull();
    },
  );

  await lines.line(
    'S9 of T, "Delete route table", type `delete`, "Delete" → the dialog stays and shows the emulator\'s `DependencyViolation` and its message; "Cancel"; the emulator still reports T',
    async () => {
      await open(page, routeTablePath(t), tName);
      await button(main, DELETE_ROUTE_TABLE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog stays and shows the refusal').toContainText('DependencyViolation', {
        timeout: 30_000,
      });
      const message = refusal(
        await ec2(ctx, port, 'DeleteRouteTable', { RouteTableId: t }),
        'DependencyViolation',
        'deleting a table with an association',
      );
      await expect(dialog, "the emulator's message").toContainText(message);
      await cancelDialog(page);
      expect(await routeTableDirect(ctx, port, t), 'T, directly').not.toBeNull();
    },
  );

  await lines.line(
    'S9 of T, the local route selected → "Delete route" is unavailable ("The local route cannot be deleted."); asked directly to delete the local route, the emulator refuses and still reports it',
    async () => {
      await open(page, routeTablePath(t), tName);
      await expectRow(routes(), 'Target', 'local');
      await selectRow(routes(), 'Target', 'local');
      await expectUnavailable(button(main, DELETE_ROUTE), LOCAL_ROUTE_STAYS, '"Delete route" of the local route');
      refusal(
        await ec2(ctx, port, 'DeleteRoute', { RouteTableId: t, DestinationCidrBlock: block }),
        null,
        'deleting the local route',
      );
      expect(
        (await routeTableDirect(ctx, port, t))?.routes.filter((each) => each.target === 'local').length,
        'the local route, directly',
      ).toBe(1);
    },
  );

  await lines.line(
    'The route `0.0.0.0/0` selected, "Delete route" → "Delete route?" naming the destination, the target and T; type `delete`, "Delete" → "Deleted the route 0.0.0.0/0" and the row is gone; the emulator reports no such route in T',
    async () => {
      await open(page, routeTablePath(t), tName);
      await expectRow(routes(), 'Destination', '0.0.0.0/0');
      await selectRow(routes(), 'Destination', '0.0.0.0/0');
      await button(main, DELETE_ROUTE).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete route?');
      await expect(dialog, 'the dialog names the destination').toContainText('0.0.0.0/0');
      await expect(dialog, 'the dialog names the target').toContainText(g);
      await expect(dialog, 'the dialog names T').toContainText(tName);
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', 'Deleted the route 0.0.0.0/0');
      await expectNoRow(routes(), 'Destination', '0.0.0.0/0');
      expect(
        (await routeTableDirect(ctx, port, t))?.routes.filter((each) => each.destination === '0.0.0.0/0'),
        'the routes 0.0.0.0/0 of T, directly',
      ).toEqual([]);
    },
  );

  await lines.line(
    'No association selected → "Disassociate" is unavailable ("Select one association."); the association selected, "Disassociate" → "Disassociate subnet?" naming the subnet and T; "Disassociate" → "Disassociated {subnet id}" and "No subnet associations"; the emulator reports no association of the subnet',
    async () => {
      await open(page, routeTablePath(t), tName);
      await expectRow(associations(), 'Subnet ID', subnet);
      await expectUnavailable(button(main, DISASSOCIATE), SELECT_ONE_ASSOCIATION, '"Disassociate" with none selected');
      await selectRow(associations(), 'Subnet ID', subnet);
      await button(main, DISASSOCIATE).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Disassociate subnet?');
      await expect(dialog, 'the dialog names the subnet').toContainText(subnet);
      await expect(dialog, 'the dialog names T').toContainText(tName);
      await button(dialog, DISASSOCIATE).click(ACTION);
      await expectFlash(page, 'success', `Disassociated ${subnet}`);
      await expect(emptyOf(associations()), `"${NO_SUBNET_ASSOCIATIONS}"`).toContainText(NO_SUBNET_ASSOCIATIONS, {
        timeout: 30_000,
      });
      expect(await associationsOf(ctx, port, subnet), 'the associations of the subnet, directly').toEqual([]);
    },
  );

  await lines.line(
    'S7, "Find by name" `<prefix>-t`, select T, "Delete", type `delete`, "Delete" → "Deleted route table <prefix>-t" and the row is gone; the emulator reports no such table',
    async () => {
      await open(page, ROUTE_TABLES_PATH, ROUTE_TABLES_H1);
      const list = listOf(page);
      await findOnly(list, tName);
      await selectRow(list, 'Name', tName);
      await button(main, DELETE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', `Deleted route table ${tName}`);
      await expectNoRow(list, 'Name', tName);
      expect(await routeTableDirect(ctx, port, t), 'T, directly').toBeNull();
    },
  );

  await lines.line(
    'S12, G selected → "Attach" is unavailable ("This gateway is already attached.") and "Delete" unavailable ("Detach the gateway before deleting it."); asked directly to delete G, the emulator refuses and still reports it',
    async () => {
      await selectG();
      // With a gateway selected "Attach" is a link to that gateway's S14, here an unavailable one.
      await expectUnavailable(link(main, ATTACH), ALREADY_ATTACHED, '"Attach" of an attached gateway');
      await expectUnavailable(button(main, DELETE), DETACH_FIRST, '"Delete" of an attached gateway');
      refusal(await ec2(ctx, port, 'DeleteInternetGateway', { InternetGatewayId: g }), null, 'deleting G attached');
      expect(await gatewayDirect(ctx, port, g), 'G, directly').not.toBeNull();
    },
  );

  await lines.line(
    'S14 of G (by its address) → "{id} is attached to {vpc id}." with "View internet gateways", and no form to send',
    async () => {
      await open(page, attachGatewayPath(g), ATTACH_GATEWAY);
      await expect(main.getByText(`${g} is attached to ${vpc}.`, { exact: true }), 'what S14 says').toBeVisible({
        timeout: 30_000,
      });
      await expect(link(main, VIEW_GATEWAYS), `"${VIEW_GATEWAYS}"`).toBeVisible();
      await expect(button(main, ATTACH), 'a form to send').toHaveCount(0);
    },
  );

  await lines.line(
    'S14 of H, the VPC chosen, "Attach" → the form stays with the emulator\'s message that the network already has an internet gateway attached; the emulator reports H without an attachment',
    async () => {
      await open(page, attachGatewayPath(h), ATTACH_GATEWAY);
      const vpcField = field(main, VPC_FIELD);
      await chooseOption(vpcField, vpc, vpc);
      await button(main, ATTACH).click(ACTION);
      const message = refusal(
        await ec2(ctx, port, 'AttachInternetGateway', { InternetGatewayId: h, VpcId: vpc }),
        null,
        'a second gateway for the VPC',
      );
      await expect(alertWith(main, message), "the emulator's message on the form").toBeVisible({ timeout: 30_000 });
      await expect(page, 'the form stays').toHaveURL(addressOf(attachGatewayPath(h)));
      await expect(selectOf(vpcField), 'the VPC as it was').toContainText(vpc);
      expect((await gatewayDirect(ctx, port, h))?.vpcIds, "H's attachments, directly").toEqual([]);
    },
  );

  await lines.line(
    'S12, G selected, "Detach", "Detach"; then "Delete" → "Delete internet gateway?" naming it; type `delete`, "Delete" → "Deleted internet gateway {name}" and the row is gone; the emulator reports no gateway G',
    async () => {
      const list = await selectG();
      await button(main, DETACH).click(ACTION);
      await button(dialogOf(page), DETACH).click(ACTION);
      await expectCell(list, 'Name', gName, 'State', 'Detached');
      await button(main, DELETE).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete internet gateway?');
      await expect(dialog, 'the dialog names the gateway').toContainText(gName);
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', `Deleted internet gateway ${gName}`);
      await expectNoRow(list, 'Name', gName);
      expect(await gatewayDirect(ctx, port, g), 'G, directly').toBeNull();
    },
  );

  lines.end();
});
