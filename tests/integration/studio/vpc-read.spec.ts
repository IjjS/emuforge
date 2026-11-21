// VPC's screens showing a network made elsewhere: the lists S1, S4, S7 and S12 and the pages S3, S6 and S9, in the
// built app in front of a real engine and emulator (test-criteria.md, issue 574: task 1).
//
// `studio.vpc-network-made-elsewhere-is-shown`, `studio.vpc-screens-follow-an-emulator-restart`.
//
// Each check names its VPCs and gateways with its own prefix `<p>` and removes what it made when it ends
// (`VpcSeeded`). The emulator's lists hold other checks' resources and the default world, so a check finds its own by
// the list's name filter, or opens a page by its address. Words, direct calls and readers: `services/vpc/vpc.ts`.

import type { Locator, Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, heading, SIDE_NAVIGATION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  APPLIES_AS,
  ASSOCIATED_WITH_SUBNET,
  attachGatewayPath,
  button,
  CLEAR_FILTER,
  emptyOf,
  expectFirstPart,
  expectRow,
  expectRows,
  expectValueIs,
  filterOf,
  findBy,
  GATEWAY_NOT_FOUND,
  gatewayDirect,
  GATEWAYS_H1,
  GATEWAYS_PATH,
  gatewaysDirect,
  link,
  listOf,
  NO_SUCH,
  NO_VPCS_MATCH,
  open,
  PUBLIC_ON_LAUNCH,
  ROUTE_TABLE_NOT_FOUND,
  ROUTE_TABLES_H1,
  ROUTE_TABLES_PATH,
  routeTableDirect,
  routeTablePath,
  routeTablesOf,
  ROUTES_OF_TABLE,
  rowsOf,
  SUBNET_NOT_FOUND,
  subnetDirect,
  subnetPath,
  SUBNETS_H1,
  SUBNETS_PATH,
  subnetsOf,
  TABLE,
  tableLabelled,
  tableOf,
  VIEW_GATEWAYS,
  VIEW_ROUTE_TABLES,
  VIEW_SUBNETS,
  VIEW_VPCS,
  VPC_NOT_FOUND,
  VPC_PATH,
  vpcAttributeDirect,
  vpcDirect,
  vpcPath,
  VPCS_H1,
  VPCS_MAIN_TABLE,
  VPCS_PATH,
  vpcsDirect,
  VpcSeeded,
} from './services/vpc/vpc';

/** Waits until the routes table shows exactly the routes `want`, each its destination, target and state. */
async function expectRoutes(routes: Locator, want: string[][], what: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await rowsOf(routes))
          .map((row) => [row['Destination'] ?? '', row['Target'] ?? '', row['State'] ?? ''].join(' | '))
          .sort(),
      { message: what, timeout: 30_000 },
    )
    .toEqual(want.map((each) => each.join(' | ')).sort());
}

/** Opens `path` and waits for `title` in the place of the page's sections, then follows `view` to `listPath`. */
async function expectNotFound(page: Page, path: string, title: string, view: string, listPath: string): Promise<void> {
  const main = page.getByRole('main');
  await page.goto(path);
  await expect(main.getByText(title, { exact: true }), `"${title}" at ${path}`).toBeVisible({ timeout: 30_000 });
  await link(main, view).click(ACTION);
  await expect(page, `"${view}" leads to its list`).toHaveURL(addressOf(listPath));
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-network-made-elsewhere-is-shown', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcread');
  const seeded = new VpcSeeded(ctx, port, p);
  const vpcName = `${p}-Main`;
  const block = '10.61.0.0/16';
  const vpc = await seeded.vpc(vpcName, block, { Purpose: `Shown ${p}` });
  const otherPrefix = checkPrefix(ctx, 'vpcinventory-control');
  const otherVpc = await new VpcSeeded(ctx, port, otherPrefix).vpc(otherPrefix, '10.60.0.0/16');
  const a = await seeded.subnet(vpc, `${p}-a`, '10.61.1.0/24', 'us-east-1a');
  const b = await seeded.subnet(vpc, `${p}-b`, '10.61.2.0/24', 'us-east-1b');
  await seeded.publicOnLaunch(b, true);
  const igw = await seeded.gateway(`${p}-igw`);
  await seeded.attach(igw, vpc);
  const rt = await seeded.routeTable(vpc, `${p}-rt`);
  await seeded.route(rt, '0.0.0.0/0', igw);
  const association = await seeded.associate(rt, a);
  const mainTable = (await routeTablesOf(ctx, port, vpc)).find((each) => each.main)?.id ?? '';
  expect(mainTable, "the VPC's main route table, directly").not.toBe('');
  const main = page.getByRole('main');

  await lines.line(
    'Open S1 from the side navigation of `/aws/vpc`, type `<prefix>` in "Find by name" → the VPC\'s row with its name, VPC ID, state `available`, `10.61.0.0/16` and "No" under "Default", as the emulator reports them',
    async () => {
      await open(page, VPC_PATH, VPCS_H1);
      await link(page.locator(SIDE_NAVIGATION), VPCS_H1).click(ACTION);
      await expect(page).toHaveURL(addressOf(VPCS_PATH));
      await expect(heading(page, VPCS_H1)).toBeVisible();
      const table = listOf(page);
      // The unfiltered list includes a VPC outside the search prefix.
      await expectRow(table, 'VPC ID', otherVpc);
      await findBy(table, p);
      const row = await expectRow(table, 'Name', vpcName, { only: true });
      const reported = await vpcDirect(ctx, port, vpc);
      expect(reported, 'the VPC, directly').not.toBeNull();
      expect(reported?.state, 'its state, directly').toBe('available');
      expect(reported?.cidr, 'its block, directly').toBe(block);
      expect(reported?.isDefault, 'whether it is the default, directly').toBe(false);
      expect(row, 'the row of the VPC').toMatchObject({
        Name: reported?.tags['Name'],
        'VPC ID': vpc,
        State: reported?.state,
        'IPv4 CIDR': reported?.cidr,
        Default: 'No',
      });
    },
  );

  await lines.line(
    '"Find by name" `<PREFIX>-MAIN` in the other letter case → "No VPCs match"; "Clear filter" → the filter is empty and rows are shown again',
    async () => {
      await open(page, VPCS_PATH, VPCS_H1);
      const table = listOf(page);
      const other = vpcName.toUpperCase();
      expect(other, 'the name in the other letter case').not.toBe(vpcName);
      await findBy(table, other);
      await expect(emptyOf(table), `"${NO_VPCS_MATCH}"`).toContainText(NO_VPCS_MATCH, { timeout: 30_000 });
      await button(emptyOf(table), CLEAR_FILTER).click(ACTION);
      await expect(filterOf(table), 'the filter after "Clear filter"').toHaveValue('');
      await expect
        .poll(async () => (await rowsOf(table)).length > 0, { message: 'rows are shown again', timeout: 30_000 })
        .toBe(true);
    },
  );

  await lines.line(
    'Choose the VPC ID → S3 at the address that holds the ID: the heading is `<prefix>-Main`; "VPC details" shows the ID, `available`, `10.61.0.0/16`, "Default VPC" "No", "DNS resolution" "On", "DNS hostnames" "Off"; "Subnets" a row each for a and b with name, subnet ID, block, zone and free addresses; "Route tables" a row for `<prefix>-rt` ("Main" "No", "Associated subnets" 1) and one for the VPC\'s main table ("Yes", 0); "Internet gateway" the gateway\'s ID and name; "Tags" both tags; each as the emulator reports it',
    async () => {
      await open(page, VPCS_PATH, VPCS_H1);
      const table = listOf(page);
      await findBy(table, p);
      await expectRow(table, 'Name', vpcName);
      await link(table, vpc).click(ACTION);
      await expect(page).toHaveURL(addressOf(vpcPath(vpc)));
      await expect(heading(page, vpcName)).toBeVisible({ timeout: 15_000 });

      const reported = await vpcDirect(ctx, port, vpc);
      await expectValueIs(page, 'VPC ID', vpc);
      await expectValueIs(page, 'State', 'available');
      await expectValueIs(page, 'IPv4 CIDR blocks', block);
      await expectValueIs(page, 'Default VPC', 'No');
      expect(await vpcAttributeDirect(ctx, port, vpc, 'enableDnsSupport'), 'DNS resolution, directly').toBe(true);
      expect(await vpcAttributeDirect(ctx, port, vpc, 'enableDnsHostnames'), 'DNS hostnames, directly').toBe(false);
      await expectValueIs(page, 'DNS resolution', 'On');
      await expectValueIs(page, 'DNS hostnames', 'Off');

      const subnets = tableOf(main, 'Subnets');
      const subnetRows = await expectRows(subnets, 'Subnet ID', [a, b], 'the subnets a and b');
      for (const each of await subnetsOf(ctx, port, vpc)) {
        expect(
          subnetRows.find((row) => row['Subnet ID'] === each.id),
          `the row of ${each.id}`,
        ).toMatchObject({
          Name: each.tags['Name'],
          'IPv4 CIDR': each.cidr,
          'Availability Zone': each.zone,
          'Free IPv4 addresses': each.free,
        });
      }
      expect(subnetRows.find((row) => row['Subnet ID'] === b)?.['Availability Zone'], "b's zone").toBe('us-east-1b');

      const tables = tableOf(main, 'Route tables');
      const tableRows = await expectRows(tables, 'Route table ID', [rt, mainTable], 'the two route tables');
      expect(
        tableRows.find((row) => row['Route table ID'] === rt),
        'the row of <prefix>-rt',
      ).toMatchObject({ Name: `${p}-rt`, Main: 'No', 'Associated subnets': '1' });
      expect(
        tableRows.find((row) => row['Route table ID'] === mainTable),
        'the row of the main table',
      ).toMatchObject({ Main: 'Yes', 'Associated subnets': '0' });

      expect((await gatewayDirect(ctx, port, igw))?.vpcIds, 'the attachment, directly').toEqual([vpc]);
      await expectValueIs(page, 'Internet gateway ID', igw);
      await expectValueIs(page, 'Name', `${p}-igw`);

      const tags = tableOf(main, 'Tags');
      const tagRows = await expectRows(tags, 'Key', Object.keys(reported?.tags ?? {}), 'both tags');
      expect(Object.fromEntries(tagRows.map((row) => [row['Key'], row['Value']])), 'the tags').toEqual({
        Name: vpcName,
        Purpose: `Shown ${p}`,
      });
    },
  );

  await lines.line(
    'Choose subnet b\'s ID → S6: "Subnet details" shows the ID, the ARN, `available`, the VPC ID, the block, `us-east-1b`, the free addresses, "Default subnet" "No" and "Public IPv4 address on launch" "On"; "Route table" shows the main table\'s ID with "The VPC\'s main route table" and its local route',
    async () => {
      await open(page, vpcPath(vpc), vpcName);
      const subnets = tableOf(main, 'Subnets');
      await expectRow(subnets, 'Subnet ID', b);
      await link(subnets, b).click(ACTION);
      await expect(page).toHaveURL(addressOf(subnetPath(b)));
      await expect(heading(page, `${p}-b`)).toBeVisible({ timeout: 15_000 });
      const reported = await subnetDirect(ctx, port, b);
      expect(reported, 'subnet b, directly').not.toBeNull();
      expect(reported?.publicOnLaunch, 'MapPublicIpOnLaunch of b, directly').toBe(true);
      await expectValueIs(page, 'Subnet ID', b);
      expect(reported?.arn, "b's ARN, directly").toBeDefined();
      await expectValueIs(page, 'ARN', reported?.arn ?? '');
      await expectValueIs(page, 'State', 'available');
      await expectValueIs(page, 'VPC ID', vpc);
      await expectValueIs(page, 'IPv4 CIDR', '10.61.2.0/24');
      await expectValueIs(page, 'Availability Zone', 'us-east-1b');
      await expectValueIs(page, 'Free IPv4 addresses', reported?.free ?? '');
      await expectValueIs(page, 'Default subnet', 'No');
      await expectFirstPart(page, PUBLIC_ON_LAUNCH, 'On');
      await expectValueIs(page, 'Route table ID', mainTable);
      await expectValueIs(page, APPLIES_AS, VPCS_MAIN_TABLE);
      await expectRoutes(tableLabelled(main, ROUTES_OF_TABLE), [[block, 'local', 'active']], 'the local route alone');
    },
  );

  await lines.line(
    'S6 of subnet a → "Public IPv4 address on launch" "Off"; "Route table" shows `<prefix>-rt`\'s ID with "Associated with this subnet" and the routes `10.61.0.0/16` to `local` and `0.0.0.0/0` to the gateway\'s ID, each `active`; the VPC ID leads to S3',
    async () => {
      await open(page, subnetPath(a), `${p}-a`);
      await expectFirstPart(page, PUBLIC_ON_LAUNCH, 'Off');
      await expectValueIs(page, 'Route table ID', rt);
      await expectValueIs(page, APPLIES_AS, ASSOCIATED_WITH_SUBNET);
      await expectRoutes(
        tableLabelled(main, ROUTES_OF_TABLE),
        [
          [block, 'local', 'active'],
          ['0.0.0.0/0', igw, 'active'],
        ],
        'the two routes of <prefix>-rt',
      );
      await link(main, vpc).click(ACTION);
      await expect(page).toHaveURL(addressOf(vpcPath(vpc)));
      await expect(heading(page, vpcName)).toBeVisible({ timeout: 15_000 });
    },
  );

  await lines.line(
    'S4, "Find by name" `<prefix>` → rows for a and b with name, subnet ID, VPC ID, block, zone and free addresses as the emulator reports them',
    async () => {
      await open(page, SUBNETS_PATH, SUBNETS_H1);
      const table = listOf(page);
      await findBy(table, p);
      const reported = await subnetsOf(ctx, port, vpc);
      expect(reported.map((each) => each.id).sort(), 'the subnets of the VPC, directly').toEqual([a, b].sort());
      for (const each of reported) {
        expect(await expectRow(table, 'Subnet ID', each.id), `the row of ${each.id}`).toMatchObject({
          Name: each.tags['Name'],
          'VPC ID': vpc,
          'IPv4 CIDR': each.cidr,
          'Availability Zone': each.zone,
          'Free IPv4 addresses': each.free,
        });
      }
    },
  );

  await lines.line(
    'S7, "Find by name" `<prefix>-rt` → its row with name, route table ID, VPC ID, "Main" "No" and "Associated subnets" 1; choose the ID → S9: "Route table details" shows the ID, the VPC ID and "Main" "No"; "Routes" the two routes with destination, target and `active`; "Subnet associations" a row with subnet a\'s ID, which leads to S6 of a, and the association\'s ID as the emulator reports it',
    async () => {
      await open(page, ROUTE_TABLES_PATH, ROUTE_TABLES_H1);
      const table = listOf(page);
      await findBy(table, `${p}-rt`);
      expect(await expectRow(table, 'Route table ID', rt), 'the row of <prefix>-rt').toMatchObject({
        Name: `${p}-rt`,
        'VPC ID': vpc,
        Main: 'No',
        'Associated subnets': '1',
      });
      await link(table, rt).click(ACTION);
      await expect(page).toHaveURL(addressOf(routeTablePath(rt)));
      await expect(heading(page, `${p}-rt`)).toBeVisible({ timeout: 15_000 });
      await expectValueIs(page, 'Route table ID', rt);
      await expectValueIs(page, 'VPC ID', vpc);
      await expectValueIs(page, 'Main', 'No');
      await expectRoutes(
        tableOf(main, 'Routes'),
        [
          [block, 'local', 'active'],
          ['0.0.0.0/0', igw, 'active'],
        ],
        'the two routes',
      );
      const reported = await routeTableDirect(ctx, port, rt);
      expect(
        reported?.associations.filter((each) => each.subnetId === a).map((each) => each.id),
        "a's association, directly",
      ).toEqual([association]);
      const associations = tableOf(main, 'Subnet associations');
      const rows = await expectRows(associations, 'Subnet ID', [a], "the association of subnet a's row");
      expect(rows[0]?.['Association ID'], "the association's ID").toBe(association);
      await link(associations, a).click(ACTION);
      await expect(page).toHaveURL(addressOf(subnetPath(a)));
      await expect(heading(page, `${p}-a`)).toBeVisible({ timeout: 15_000 });
    },
  );

  await lines.line(
    'S12, "Find by name" `<prefix>-igw` → its row with name, ID, "Attached" and the VPC\'s ID, which leads to S3',
    async () => {
      await open(page, GATEWAYS_PATH, GATEWAYS_H1);
      const table = listOf(page);
      await findBy(table, `${p}-igw`);
      expect(await expectRow(table, 'Internet gateway ID', igw), 'the row of the gateway').toMatchObject({
        Name: `${p}-igw`,
        State: 'Attached',
        'VPC ID': vpc,
      });
      await link(table, vpc).click(ACTION);
      await expect(page).toHaveURL(addressOf(vpcPath(vpc)));
      await expect(heading(page, vpcName)).toBeVisible({ timeout: 15_000 });
    },
  );

  await lines.line(
    'Open S3, S6 and S9 each at a well-formed ID the emulator does not hold → "VPC not found", "Subnet not found", "Route table not found", each with its link ("View VPCs", "View subnets", "View route tables") that leads to its list; S14 at such a gateway ID → "Internet gateway not found" with "View internet gateways"',
    async () => {
      expect(await vpcDirect(ctx, port, NO_SUCH.vpc), 'the VPC of that ID, directly').toBeNull();
      expect(await subnetDirect(ctx, port, NO_SUCH.subnet), 'the subnet of that ID, directly').toBeNull();
      expect(await routeTableDirect(ctx, port, NO_SUCH.routeTable), 'the route table of that ID, directly').toBeNull();
      expect(await gatewayDirect(ctx, port, NO_SUCH.gateway), 'the gateway of that ID, directly').toBeNull();
      await expectNotFound(page, vpcPath(NO_SUCH.vpc), VPC_NOT_FOUND, VIEW_VPCS, VPCS_PATH);
      await expectNotFound(page, subnetPath(NO_SUCH.subnet), SUBNET_NOT_FOUND, VIEW_SUBNETS, SUBNETS_PATH);
      await expectNotFound(
        page,
        routeTablePath(NO_SUCH.routeTable),
        ROUTE_TABLE_NOT_FOUND,
        VIEW_ROUTE_TABLES,
        ROUTE_TABLES_PATH,
      );
      await expectNotFound(page, attachGatewayPath(NO_SUCH.gateway), GATEWAY_NOT_FOUND, VIEW_GATEWAYS, GATEWAYS_PATH);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-screens-follow-an-emulator-restart', async ({ ctx, page, context }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcrestart');
  const seeded = new VpcSeeded(ctx, port, p);
  const vpc = await seeded.vpc(`${p}-kept`, '10.66.0.0/16');
  const subnet = await seeded.subnet(vpc, `${p}-sub`, '10.66.1.0/24');
  const rt = await seeded.routeTable(vpc, `${p}-rt`);
  const igw = await seeded.gateway(`${p}-igw`);
  await seeded.attach(igw, vpc);
  const before = [vpc, subnet, rt, igw];

  // The seven screens, each in a page of its own, read before the restart.
  const s1 = page;
  await open(s1, VPCS_PATH, VPCS_H1);
  await expectRow(listOf(s1), 'VPC ID', vpc);
  const s3 = await context.newPage();
  await open(s3, vpcPath(vpc), `${p}-kept`);
  await expectValueIs(s3, 'VPC ID', vpc);
  const s4 = await context.newPage();
  await open(s4, SUBNETS_PATH, SUBNETS_H1);
  await expectRow(listOf(s4), 'Subnet ID', subnet);
  const s6 = await context.newPage();
  await open(s6, subnetPath(subnet), `${p}-sub`);
  await expectValueIs(s6, 'Subnet ID', subnet);
  const s7 = await context.newPage();
  await open(s7, ROUTE_TABLES_PATH, ROUTE_TABLES_H1);
  await expectRow(listOf(s7), 'Route table ID', rt);
  const s9 = await context.newPage();
  await open(s9, routeTablePath(rt), `${p}-rt`);
  await expectValueIs(s9, 'Route table ID', rt);
  const s12 = await context.newPage();
  await open(s12, GATEWAYS_PATH, GATEWAYS_H1);
  await expectRow(listOf(s12), 'Internet gateway ID', igw);
  const pages = [s1, s3, s4, s6, s7, s9, s12];

  await lines.line(
    'S1, S3 of the VPC, S4, S6 of the subnet, S7, S9 of the table and S12 each open in a page of its own; the emulator is restarted → once the emulator line reads "Connected" again: S1 shows the default VPC alone; S3 "VPC not found"; S4 the three default subnets alone; S6 "Subnet not found"; S7 the default VPC\'s main table alone; S9 "Route table not found"; S12 the default world\'s one gateway alone; none with a row or a value of before',
    async () => {
      await emulator.stop();
      // Nothing is pressed on a page: each reads again by itself once it is connected again.
      for (const each of pages) {
        await each.bringToFront();
        await expectLine(each, notStartedOn(port));
      }
      await emulator.startAgain();
      for (const each of pages) {
        await each.bringToFront();
        await expectLine(each, connectedAt(port), 60_000);
      }
      expect(await vpcDirect(ctx, port, vpc), 'the VPC after the restart, directly').toBeNull();
      const vpcs = await vpcsDirect(ctx, port);
      expect(
        vpcs.map((each) => each.isDefault),
        'the VPCs after the restart, directly: the default one alone',
      ).toEqual([true]);
      const defaultVpc = vpcs[0]?.id ?? '';
      const subnets = (await subnetsOf(ctx, port, defaultVpc)).map((each) => each.id);
      expect(subnets.length, 'the default subnets, directly').toBe(3);
      const tables = await routeTablesOf(ctx, port, defaultVpc);
      expect(
        tables.map((each) => each.main),
        "the default VPC's route tables, directly: its main one alone",
      ).toEqual([true]);
      const gateways = (await gatewaysDirect(ctx, port)).map((each) => each.id);
      expect(gateways.length, "the default world's gateways, directly").toBe(1);

      const lists: [Page, string, string[], string][] = [
        [s1, 'VPC ID', [defaultVpc], 'S1 shows the default VPC alone'],
        [s4, 'Subnet ID', subnets, 'S4 shows the three default subnets alone'],
        [s7, 'Route table ID', tables.map((each) => each.id), "S7 shows the default VPC's main table alone"],
        [s12, 'Internet gateway ID', gateways, "S12 shows the default world's one gateway alone"],
      ];
      for (const [each, column, want, what] of lists) {
        await each.bringToFront();
        await expectRows(listOf(each), column, want, what);
        for (const id of before) await expect(each.getByRole('main'), `${id} of before`).not.toContainText(id);
      }
      const gone: [Page, string][] = [
        [s3, VPC_NOT_FOUND],
        [s6, SUBNET_NOT_FOUND],
        [s9, ROUTE_TABLE_NOT_FOUND],
      ];
      for (const [each, title] of gone) {
        await each.bringToFront();
        const main = each.getByRole('main');
        await expect(main.getByText(title, { exact: true }), `"${title}"`).toBeVisible({ timeout: 60_000 });
        await expect(main.locator(TABLE), 'the sections of before').toHaveCount(0);
        await expect(main, 'a value of before').not.toContainText(p);
      }
    },
  );

  lines.end();
});
