// VPC's create forms describing their choices and tagging what they make, the add route form's target chosen from
// what the route table's VPC holds, and the attach form offering only the VPCs without an internet gateway
// (test-criteria.md, issue 651, "Integration scenarios, new"): `studio.vpc-create-forms-describe-and-tag`,
// `studio.vpc-route-table-forms-choose-targets-and-subnets`, `studio.vpc-attach-offers-only-free-vpcs`.
//
// Each check names what it makes under its own prefix `<p>` and removes it when it ends (`VpcSeeded`). Options are
// found by value (`support/form-choices.ts`); what a described option says is asserted on the option found, against
// what the emulator reports of the same resource. Words, direct calls and readers: `services/vpc/vpc.ts`.

import { EnvError, expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { addTag, openSelect, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ADD_ROUTE,
  addRoutePath,
  alertWith,
  ASSOCIATE_SUBNET,
  associateSubnetPath,
  ATTACH,
  ATTACH_GATEWAY,
  attachGatewayPath,
  BLOCK,
  button,
  countActions,
  CREATE_GATEWAY,
  CREATE_GATEWAY_PATH,
  CREATE_ROUTE_TABLE,
  CREATE_SUBNET,
  CREATE_SUBNET_PATH,
  CREATE_VPC,
  CREATE_VPC_PATH,
  createRouteTablePath,
  DESTINATION,
  ec2,
  entry,
  errorOf,
  expectFlash,
  field,
  gatewayDirect,
  GATEWAYS_H1,
  GATEWAYS_PATH,
  gatewaysNamed,
  idOfAddress,
  items,
  NAME,
  open,
  routeTableDirect,
  routeTablePath,
  SUBNET_FIELD,
  subnetDirect,
  textAt,
  VPC_FIELD,
  vpcDirect,
  VpcSeeded,
  ZONE_FIELD,
} from './services/vpc/vpc';

const TARGET_TYPE = 'Target type';
const TARGET = 'Target';

/** A direct call the check needs answered; its answer. */
async function asked(
  ctx: Parameters<typeof ec2>[0],
  port: number,
  action: string,
  params: Record<string, string>,
): Promise<Awaited<ReturnType<typeof ec2>>> {
  const answer = await ec2(ctx, port, action, params);
  if (answer.status !== 200) {
    throw new EnvError(`direct ${action} answered ${String(answer.status)} ${answer.code ?? ''} ${answer.message ?? ''}`);
  }
  return answer;
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-create-forms-describe-and-tag', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcforms');
  // Removes what Studio makes below: the VPC is found by its name under the prefix, and what is in it by the VPC.
  new VpcSeeded(ctx, port, p);
  const main = page.getByRole('main');
  const block = '10.71.0.0/16';
  const vpcName = `${p}-v`;
  const gwName = `${p}-gw`;
  let vpc = '';
  const made = (): string => {
    expect(vpc, 'the VPC of the first line').not.toBe('');
    return vpc;
  };

  await lines.line(
    'S of "Create VPC": the block `10.71.0.0/16`, the name `<p>-v`, the tag `team` = `core` → the emulator reports the VPC with the tags `Name` and `team`',
    async () => {
      await open(page, CREATE_VPC_PATH, CREATE_VPC);
      await entry(page, BLOCK).fill(block, ACTION);
      await entry(page, NAME).fill(vpcName, ACTION);
      await addTag(main, 'team', 'core');
      await button(main, CREATE_VPC).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/vpc\/vpcs\/vpc\/vpc-[0-9a-f]+$/, { timeout: 30_000 });
      vpc = idOfAddress(page);
      const reported = await vpcDirect(ctx, port, vpc);
      expect(reported?.cidr, 'the block, directly').toBe(block);
      expect(reported?.tags, 'the tags, directly').toEqual({ Name: vpcName, team: 'core' });
    },
  );

  await lines.line(
    '"Create subnet": `<p>-v` chosen (its option shows its block) → the block field says "Inside 10.71.0.0/16, and not overlapping another subnet of the VPC."; the zone `us-east-1b` shows its zone id; the block `10.71.1.0/24`, the tag `tier` = `app` → the emulator reports the subnet in `us-east-1b` with the tag',
    async () => {
      const zones = await asked(ctx, port, 'DescribeAvailabilityZones', {});
      const zoneId = items(zones.root, 'availabilityZoneInfo')
        .map((each) => ({ name: textAt(each, 'zoneName'), id: textAt(each, 'zoneId') }))
        .find((each) => each.name === 'us-east-1b')?.id;
      if (zoneId === undefined || zoneId === '') throw new EnvError('the emulator reports no zone id of us-east-1b');

      await open(page, CREATE_SUBNET_PATH, CREATE_SUBNET);
      const vpcs = await openSelect(field(main, VPC_FIELD));
      await vpcs.type(made());
      await vpcs.expectOption(made(), vpcName, block);
      await vpcs.choose(made());
      await expect(triggerOf(field(main, VPC_FIELD)), 'the VPC chosen').toContainText(made());
      await expect(field(main, BLOCK), 'what the block field says').toContainText(
        `Inside ${block}, and not overlapping another subnet of the VPC.`,
      );
      const zoneList = await openSelect(field(main, ZONE_FIELD));
      await zoneList.expectOption('us-east-1b', 'us-east-1b', zoneId);
      await zoneList.choose('us-east-1b');
      await expect(triggerOf(field(main, ZONE_FIELD)), 'the zone chosen').toContainText('us-east-1b');
      await entry(page, BLOCK).fill('10.71.1.0/24', ACTION);
      await addTag(main, 'tier', 'app');
      await button(main, CREATE_SUBNET).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/vpc\/subnets\/subnet\/subnet-[0-9a-f]+$/, { timeout: 30_000 });
      const reported = await subnetDirect(ctx, port, idOfAddress(page));
      expect(reported, 'the subnet, directly').toMatchObject({ vpcId: made(), cidr: '10.71.1.0/24', zone: 'us-east-1b' });
      expect(reported?.tags, "the subnet's tags, directly").toEqual({ tier: 'app' });
    },
  );

  await lines.line(
    '"Create route table" for `<p>-v` with the tag `tier` = `app`, and "Create internet gateway" with the name `<p>-gw` and the tag `edge` = `yes` → the emulator reports each with its tags',
    async () => {
      await open(page, createRouteTablePath(made()), CREATE_ROUTE_TABLE);
      await expect(triggerOf(field(main, VPC_FIELD)), 'the VPC the form opened for').toContainText(made(), {
        timeout: 30_000,
      });
      await addTag(main, 'tier', 'app');
      await button(main, CREATE_ROUTE_TABLE).click(ACTION);
      await expect(page).toHaveURL(/\/rtb-[0-9a-f]+$/, { timeout: 30_000 });
      const table = await routeTableDirect(ctx, port, idOfAddress(page));
      expect(table?.vpcId, "the route table's VPC, directly").toBe(made());
      expect(table?.tags, "the route table's tags, directly").toEqual({ tier: 'app' });

      await open(page, CREATE_GATEWAY_PATH, CREATE_GATEWAY);
      await entry(page, NAME).fill(gwName, ACTION);
      await addTag(main, 'edge', 'yes');
      await button(main, CREATE_GATEWAY).click(ACTION);
      await expect(page).toHaveURL(addressOf(GATEWAYS_PATH), { timeout: 30_000 });
      await expect(heading(page, GATEWAYS_H1)).toBeVisible({ timeout: 15_000 });
      await expectFlash(page, 'success', 'Created internet gateway');
      const gateways = await gatewaysNamed(ctx, port, gwName);
      expect(gateways.map((each) => each.tags), "the gateway's tags, directly").toEqual([{ Name: gwName, edge: 'yes' }]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-route-table-forms-choose-targets-and-subnets', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpctargets');
  const seeded = new VpcSeeded(ctx, port, p);
  const main = page.getByRole('main');
  const rtName = `${p}-rt`;

  const v = await seeded.vpc(`${p}-v`, '10.72.0.0/16');
  const subnet = await seeded.subnet(v, `${p}-s`, '10.72.1.0/24', 'us-east-1b');
  const rt = await seeded.routeTable(v, rtName);
  const n = await seeded.natGateway(subnet);
  const i = await seeded.instance(`${p}-i`, subnet);
  const w = await seeded.vpc(`${p}-w`, '10.73.0.0/16');
  const j = await seeded.instance(`${p}-j`, await seeded.subnet(w, `${p}-t`, '10.73.1.0/24'));
  const made = await asked(ctx, port, 'CreateNetworkInterface', { SubnetId: subnet });
  const e = textAt(made.root, 'networkInterface', 'networkInterfaceId') ?? '';
  if (e === '') throw new EnvError('the emulator gave the network interface no id');
  // Before `VpcSeeded` removes the subnet: the routes this check adds through Studio, then the interface.
  ctx.own({
    async dispose() {
      for (const destination of ['10.90.0.0/16', '10.91.0.0/16', '10.92.0.0/16']) {
        await ec2(ctx, port, 'DeleteRoute', { RouteTableId: rt, DestinationCidrBlock: destination });
      }
      await ec2(ctx, port, 'DeleteNetworkInterface', { NetworkInterfaceId: e });
    },
  });

  /** What the emulator reports of the NAT gateway, the instance and the interface, as the options describe them. */
  const natNow = async () => {
    const node = items((await asked(ctx, port, 'DescribeNatGateways', { 'NatGatewayId.1': n })).root, 'natGatewaySet')[0];
    return { state: textAt(node, 'state') ?? '', subnetId: textAt(node, 'subnetId') ?? '' };
  };
  const instanceNow = async () => {
    const answer = await asked(ctx, port, 'DescribeInstances', { 'InstanceId.1': i });
    const node = items(items(answer.root, 'reservationSet')[0], 'instancesSet')[0];
    return { state: textAt(node, 'instanceState', 'name') ?? '', address: textAt(node, 'privateIpAddress') ?? '' };
  };
  const interfaceNow = async () => {
    const answer = await asked(ctx, port, 'DescribeNetworkInterfaces', { 'NetworkInterfaceId.1': e });
    const node = items(answer.root, 'networkInterfaceSet')[0];
    return {
      status: textAt(node, 'status') ?? '',
      address: textAt(node, 'privateIpAddress') ?? '',
      subnetId: textAt(node, 'subnetId') ?? '',
    };
  };
  /** The routes of the table as the emulator reports them: destination and whichever target member it names. */
  const routesNow = async () => {
    const answer = await asked(ctx, port, 'DescribeRouteTables', { 'RouteTableId.1': rt });
    return items(items(answer.root, 'routeTableSet')[0], 'routeSet').map((each) => ({
      destination: textAt(each, 'destinationCidrBlock') ?? '',
      nat: textAt(each, 'natGatewayId') ?? '',
      instance: textAt(each, 'instanceId') ?? '',
      nic: textAt(each, 'networkInterfaceId') ?? '',
    }));
  };
  // The NAT gateway's state is asserted on its option, so it is waited for here until it no longer moves.
  await expect
    .poll(async () => (await natNow()).state, { message: 'the NAT gateway is available, directly', timeout: 60_000 })
    .toBe('available');

  const chooseKind = async (kind: string, label: string): Promise<void> => {
    await (await openSelect(field(main, TARGET_TYPE))).choose(kind);
    await expect(triggerOf(field(main, TARGET_TYPE)), `"${label}" chosen`).toContainText(label);
  };
  const openForm = async (): Promise<void> => {
    await open(page, addRoutePath(rt), ADD_ROUTE);
    await expect(main, 'S10 names the table').toContainText(`Adds a route to ${rtName}.`, { timeout: 30_000 });
  };

  await lines.line(
    'S10 of `<p>-rt`: "Target" cannot be opened and says "Choose Target type first"; "NAT gateway" chosen → "Target" offers `N` with its state and subnet; "Instance" → `I` with its state and private address, and not `J`; "Network interface" → `E` with its status, address and subnet',
    async () => {
      await openForm();
      await expect(triggerOf(field(main, TARGET)), '"Target" cannot be opened').toBeDisabled();
      await expect(triggerOf(field(main, TARGET)), 'what "Target" says').toContainText('Choose Target type first');

      await chooseKind('NatGatewayId', 'NAT gateway');
      const nat = await natNow();
      expect(nat.subnetId, "the NAT gateway's subnet, directly").toBe(subnet);
      let targets = await openSelect(field(main, TARGET));
      await targets.expectOption(n, n, nat.state, nat.subnetId);
      await targets.close();

      await chooseKind('InstanceId', 'Instance');
      const instance = await instanceNow();
      expect(instance.address, "the instance's private address, directly").not.toBe('');
      targets = await openSelect(field(main, TARGET));
      await targets.expectOption(i, i, instance.state, instance.address);
      await targets.expectNone(j);
      await targets.close();

      await chooseKind('NetworkInterfaceId', 'Network interface');
      const nic = await interfaceNow();
      expect(nic.status, "the interface's status, directly").not.toBe('');
      expect(nic.address, "the interface's address, directly").not.toBe('');
      targets = await openSelect(field(main, TARGET));
      await targets.expectOption(e, e, nic.status, nic.address, subnet);
      await targets.close();
    },
  );

  await lines.line('"NAT gateway" and `N` chosen, then "Instance" chosen → "Target" is empty again', async () => {
    await openForm();
    await chooseKind('NatGatewayId', 'NAT gateway');
    await (await openSelect(field(main, TARGET))).choose(n);
    await expect(triggerOf(field(main, TARGET)), 'N chosen').toContainText(n);
    await chooseKind('InstanceId', 'Instance');
    await expect(triggerOf(field(main, TARGET)), '"Target" after the type changed').not.toContainText(n);
    await expect(triggerOf(field(main, TARGET)), '"Target" is empty').toContainText('Choose a target');
  });

  await lines.line('"Internet gateway" chosen → "No internet gateways in {`<p>-v`\'s id}"', async () => {
    await openForm();
    await chooseKind('GatewayId', 'Internet gateway');
    const targets = await openSelect(field(main, TARGET));
    await targets.expectSays(`No internet gateways in ${v}`);
    await targets.close();
  });

  await lines.line(
    'The destination `10.90.0.0/16`, "NAT gateway", `N`; "Add route" → S9 with the result; the emulator reports the route to `N`; the same with `10.91.0.0/16` and `I`, and `10.92.0.0/16` and `E`',
    async () => {
      const add = async (destination: string, kind: string, label: string, target: string): Promise<void> => {
        await openForm();
        await entry(page, DESTINATION).fill(destination, ACTION);
        await chooseKind(kind, label);
        await (await openSelect(field(main, TARGET))).choose(target);
        await expect(triggerOf(field(main, TARGET)), `${target} chosen`).toContainText(target);
        await button(main, ADD_ROUTE).click(ACTION);
        await expect(page).toHaveURL(addressOf(routeTablePath(rt)), { timeout: 30_000 });
        await expect(heading(page, rtName)).toBeVisible({ timeout: 15_000 });
        await expectFlash(page, 'success', `Saved the route to ${target} in ${rt}`);
      };
      await add('10.90.0.0/16', 'NatGatewayId', 'NAT gateway', n);
      expect((await routesNow()).find((each) => each.destination === '10.90.0.0/16')?.nat, 'the route to N, directly').toBe(n);
      await add('10.91.0.0/16', 'InstanceId', 'Instance', i);
      expect(
        (await routesNow()).find((each) => each.destination === '10.91.0.0/16')?.instance,
        'the route to I, directly',
      ).toBe(i);
      await add('10.92.0.0/16', 'NetworkInterfaceId', 'Network interface', e);
      expect((await routesNow()).find((each) => each.destination === '10.92.0.0/16')?.nic, 'the route to E, directly').toBe(e);
    },
  );

  await lines.line("S11 of `<p>-rt`: the subnet's option shows its zone and block", async () => {
    await open(page, associateSubnetPath(rt), ASSOCIATE_SUBNET);
    const subnets = await openSelect(field(main, SUBNET_FIELD));
    await subnets.expectOption(subnet, subnet, 'us-east-1b', '10.72.1.0/24');
    await subnets.close();
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.vpc-attach-offers-only-free-vpcs', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'vpcattach');
  const seeded = new VpcSeeded(ctx, port, p);
  const main = page.getByRole('main');

  const a = await seeded.vpc(`${p}-a`, '10.74.0.0/16');
  const b = await seeded.vpc(`${p}-b`, '10.75.0.0/16');
  const c = await seeded.vpc(`${p}-c`, '10.76.0.0/16');
  const g = await seeded.gateway(`${p}-g`);
  await seeded.attach(g, a);
  const h = await seeded.gateway(`${p}-h`);
  const x = await seeded.gateway(`${p}-x`);
  const vpcField = () => field(main, VPC_FIELD);

  await lines.line(
    'S14 of `H`: "VPC" lists `<p>-a` with "Has {G\'s id}", and it cannot be chosen; `<p>-b` and `<p>-c` can',
    async () => {
      await open(page, attachGatewayPath(h), ATTACH_GATEWAY);
      const vpcs = await openSelect(vpcField());
      await vpcs.type(p);
      await vpcs.expectOption(a, `Has ${g}`);
      await expect(vpcs.unavailable(a), '<p>-a cannot be chosen').toHaveCount(1);
      await vpcs.expectOption(b, `${p}-b`);
      await vpcs.expectOption(c, `${p}-c`);
      await expect(vpcs.unavailable(b), '<p>-b can be chosen').toHaveCount(0);
      await expect(vpcs.unavailable(c), '<p>-c can be chosen').toHaveCount(0);
      await expect(vpcs.option(b), '<p>-b has no mark').not.toContainText('Has ');
      await expect(vpcs.option(c), '<p>-c has no mark').not.toContainText('Has ');
      await vpcs.close();
    },
  );

  await lines.line(
    'S14 of `H` at `?vpc=` `<p>-a`\'s id → "VPC" is empty and says "{`<p>-a`\'s id} already has {G\'s id}. Choose another VPC."',
    async () => {
      await open(page, `${attachGatewayPath(h)}?vpc=${encodeURIComponent(a)}`, ATTACH_GATEWAY);
      await expect(errorOf(vpcField()), 'what "VPC" says').toHaveText(`${a} already has ${g}. Choose another VPC.`, {
        timeout: 30_000,
      });
      await expect(triggerOf(vpcField()), '"VPC" is empty').not.toContainText(a);
    },
  );

  await lines.line(
    'S14 of `H`, `<p>-b` chosen; `X` attached to `<p>-b` outside; "Attach" → the form stays with the emulator\'s message that the network already has an internet gateway attached; the emulator reports `H` without an attachment',
    async () => {
      await open(page, attachGatewayPath(h), ATTACH_GATEWAY);
      const vpcs = await openSelect(vpcField());
      await vpcs.type(b);
      await vpcs.choose(b);
      await expect(triggerOf(vpcField()), '<p>-b chosen').toContainText(b);
      await seeded.attach(x, b);
      const sent = countActions(page, 'AttachInternetGateway');
      await button(main, ATTACH).click(ACTION);
      // The emulator's own message: the same call made directly is refused the same way.
      const direct = await ec2(ctx, port, 'AttachInternetGateway', { InternetGatewayId: h, VpcId: b });
      expect(direct.status, 'attaching H to <p>-b, asked directly: the emulator refuses').not.toBe(200);
      expect(direct.message ?? '', "the emulator's message, directly").toContain('already has an internet gateway attached');
      await expect(alertWith(main, direct.message ?? ''), "the emulator's message on the form").toBeVisible({
        timeout: 30_000,
      });
      await expect(heading(page, ATTACH_GATEWAY), 'the form stays').toBeVisible();
      expect(sent.count(), 'AttachInternetGateway requests that left the page').toBe(1);
      expect((await gatewayDirect(ctx, port, h))?.vpcIds, "H's attachments, directly").toEqual([]);
    },
  );

  await lines.line(
    '"VPC" opened again → `<p>-b` is listed with "Has {X\'s id}", is no longer chosen, and the field says "{`<p>-b`\'s id} already has {X\'s id}. Choose another VPC."; `<p>-c` chosen, "Attach" → the gateways list with "Attached {H\'s id} to {`<p>-c`\'s id}"; the emulator reports the attachment',
    async () => {
      const vpcs = await openSelect(vpcField());
      await vpcs.type(p);
      await vpcs.expectOption(b, `Has ${x}`);
      await expect(errorOf(vpcField()), 'what "VPC" says').toHaveText(`${b} already has ${x}. Choose another VPC.`, {
        timeout: 30_000,
      });
      await expect(triggerOf(vpcField()), '<p>-b is no longer chosen').not.toContainText(b);
      await vpcs.choose(c);
      await expect(triggerOf(vpcField()), '<p>-c chosen').toContainText(c);
      await button(main, ATTACH).click(ACTION);
      await expect(page).toHaveURL(addressOf(GATEWAYS_PATH), { timeout: 30_000 });
      await expect(heading(page, GATEWAYS_H1)).toBeVisible({ timeout: 15_000 });
      await expectFlash(page, 'success', `Attached ${h} to ${c}`);
      expect((await gatewayDirect(ctx, port, h))?.vpcIds, "H's attachments, directly").toEqual([c]);
    },
  );

  lines.end();
});
