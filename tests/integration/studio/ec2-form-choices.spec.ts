// EC2's create forms describing their choices and tagging what they make (test-criteria.md, issue 651, "Integration
// scenarios, new"): `studio.ec2-group-rule-and-key-pair-forms-describe-and-tag` and
// `studio.ec2-launch-and-retype-follow-the-vpc-and-the-zone`.
//
// Each check names what it makes under its own prefix `<p>` and removes it when it ends (`Ec2Seeded`). Options are
// found by value (`support/form-choices.ts`); what a described option says is asserted on the option found.

import { EnvError, expect, startStack, test } from './support';
import { directIam } from './support/aws-clients-general';
import { ACTION } from './support/frame';
import { addTag, chosenOf, openMultiselect, openSelect, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import { edit, save } from './services/ec2/instance-changes';
import {
  ADD_RULE,
  addRulePath,
  button,
  chooseOption,
  countActions,
  CREATE_GROUP,
  CREATE_GROUP_PATH,
  CREATE_KEY_PAIR,
  CREATE_KEY_PAIR_PATH,
  ec2,
  Ec2Seeded,
  errorOf,
  expectFlash,
  field,
  groupDirect,
  groupPath,
  groupsNamed,
  instanceDirect,
  instancePath,
  instancesNamed,
  items,
  keyPairDirect,
  LAUNCH,
  LAUNCH_PATH,
  open,
  radio,
  rulesDirect,
  textAt,
  world,
  type Xml,
} from './services/ec2/ec2';

/** The tags of a described item (`tagSet`). */
function tagsOf(node: Xml | undefined): Record<string, string> {
  return Object.fromEntries(items(node, 'tagSet').map((tag) => [textAt(tag, 'key') ?? '', textAt(tag, 'value') ?? '']));
}

test('studio.ec2-group-rule-and-key-pair-forms-describe-and-tag', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const { emulatorPort: port } = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2forms');
  const seeded = new Ec2Seeded(ctx, port, p, await world(ctx, port));
  const BLOCK = '10.81.0.0/16';
  const v = await seeded.vpcWithSubnet(BLOCK, '10.81.1.0/24', 'us-east-1a');
  const peer = await seeded.group(`${p}-peer`, `peer of ${p}`, v.vpcId);
  const main = page.getByRole('main');
  let web = '';

  await lines.line(
    'S5: `<p>-v` in "VPC" shows its block; the name `<p>-web`, a description, `<p>-v`, the tag `team` = `core`; "Create security group" → its page; the emulator reports the group in `<p>-v` with the tag',
    async () => {
      await open(page, CREATE_GROUP_PATH, CREATE_GROUP);
      await field(main, 'Name').getByRole('textbox').fill(`${p}-web`, ACTION);
      await field(main, 'Description').getByRole('textbox').fill(`Web of ${p}`, ACTION);
      const vpcs = await openSelect(field(main, 'VPC - optional'));
      await vpcs.expectOption(v.vpcId, BLOCK);
      await vpcs.choose(v.vpcId);
      await expect(triggerOf(field(main, 'VPC - optional')), 'the VPC chosen').toContainText(v.vpcId);
      await addTag(main, 'team', 'core');
      await button(main, CREATE_GROUP).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/ec2\/security-groups\/group\/sg-[0-9a-f]+$/, { timeout: 30_000 });
      web = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');
      const reported = await groupDirect(ctx, port, web);
      expect([reported?.name, reported?.vpcId], 'the group, directly').toEqual([`${p}-web`, v.vpcId]);
      const answer = await ec2(ctx, port, 'DescribeSecurityGroups', { 'GroupId.1': web });
      expect(tagsOf(items(answer.root, 'securityGroupInfo')[0]), "the group's tags, directly").toEqual({ team: 'core' });
    },
  );

  await lines.line(
    '"Add rule" of `<p>-web`: "Security group" as the peer kind → `<p>-peer` is offered with its id and description; inbound TCP 443 from `<p>-peer`, the tag `use` = `https` → the group\'s page with the result; the emulator reports the rule with that peer and the tag on the rule',
    async () => {
      expect(web, 'the group of the first line').not.toBe('');
      await open(page, addRulePath(web), ADD_RULE);
      await expect(radio(field(main, 'Direction'), 'inbound'), '"Inbound" as the form opens').toBeChecked();
      await (await openSelect(field(main, 'Protocol'))).choose('tcp');
      await field(main, 'First port').getByRole('textbox').fill('443', ACTION);
      await radio(field(main, 'Source'), 'group').click(ACTION);
      const peers = await openSelect(field(main, 'Security group'));
      await peers.type(`${p}-peer`);
      await peers.expectOption(peer, `${p}-peer`, peer, `peer of ${p}`);
      await peers.choose(peer);
      await addTag(main, 'use', 'https');
      await button(main, ADD_RULE).click(ACTION);
      await expect(page).toHaveURL(new RegExp(`${groupPath(web).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), { timeout: 30_000 });
      await expectFlash(page, 'success');
      const rule = (await rulesDirect(ctx, port, web)).find((each) => !each.egress && each.group === peer);
      expect([rule?.protocol, rule?.from, rule?.to], 'the rule, directly').toEqual(['tcp', '443', '443']);
      const answer = await ec2(ctx, port, 'DescribeSecurityGroupRules', {
        'Filter.1.Name': 'group-id',
        'Filter.1.Value.1': web,
      });
      const node = items(answer.root, 'securityGroupRuleSet').find((each) => textAt(each, 'securityGroupRuleId') === rule?.id);
      expect(tagsOf(node), "the rule's tags, directly").toEqual({ use: 'https' });
    },
  );

  await lines.line(
    'S9: the name `<p>-key`, ED25519, the tag `team` = `core` → the private key is shown as on `main`; the emulator reports the key pair with the tag',
    async () => {
      await open(page, CREATE_KEY_PAIR_PATH, CREATE_KEY_PAIR);
      await field(main, 'Name').getByRole('textbox').fill(`${p}-key`, ACTION);
      await radio(field(main, 'Type'), 'ed25519').click(ACTION);
      await addTag(main, 'team', 'core');
      await button(main, CREATE_KEY_PAIR).click(ACTION);
      await expect(main.getByRole('textbox', { name: 'Private key', exact: true }), 'the private key').toHaveValue(
        /PRIVATE KEY/,
        { timeout: 30_000 },
      );
      expect((await keyPairDirect(ctx, port, `${p}-key`))?.type, 'the key pair, directly').toBe('ed25519');
      const answer = await ec2(ctx, port, 'DescribeKeyPairs', { 'KeyName.1': `${p}-key` });
      expect(tagsOf(items(answer.root, 'keySet')[0]), "the key pair's tags, directly").toEqual({ team: 'core' });
    },
  );

  lines.end();
});

/** The first element named `name` anywhere below `node`. */
function anywhere(node: Xml | undefined, name: string): Xml | undefined {
  for (const each of node?.children ?? []) {
    if (each.name === name) return each;
    const deeper = anywhere(each, name);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

test('studio.ec2-launch-and-retype-follow-the-vpc-and-the-zone', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const { emulatorPort: port } = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2zone');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const ZONE_F = 'us-east-1f';
  const BLOCK_F = '10.82.6.0/24';
  const BLOCK_B = '10.82.2.0/24';
  const v = await seeded.vpcWithSubnet('10.82.0.0/16', BLOCK_F, ZONE_F);
  const f = v.subnetId;
  const madeB = await ec2(ctx, port, 'CreateSubnet', { VpcId: v.vpcId, CidrBlock: BLOCK_B, AvailabilityZone: 'us-east-1b' });
  const b = textAt(anywhere(madeB.root, 'subnet'), 'subnetId');
  if (madeB.status !== 200 || b === undefined) throw new EnvError('CreateSubnet in us-east-1b did not answer a subnet');
  ctx.own({ dispose: async () => void (await ec2(ctx, port, 'DeleteSubnet', { SubnetId: b })) });
  const g = await seeded.group(`${p}-g`, `G ${p}`, v.vpcId);
  const defaultGroup = (await groupsNamed(ctx, port, 'default')).find((each) => each.vpcId === w.defaultVpc)?.id;
  const defaultBlock = textAt(
    items((await ec2(ctx, port, 'DescribeVpcs', { 'VpcId.1': w.defaultVpc })).root, 'vpcSet')[0],
    'cidrBlock',
  );
  // The instance profile with one role.
  const prof = `${p}-prof`;
  const iam = async (action: string, params: Record<string, string>, must = true) => {
    const answer = await directIam(ctx, port, action, params);
    if ('error' in answer) throw new EnvError(`direct ${action}: ${answer.error}`);
    ctx.log(`direct iam ${action}: status ${String(answer.status)}`);
    if (must && answer.status !== 200) throw new EnvError(`direct ${action} answered ${String(answer.status)}`);
  };
  ctx.own({
    async dispose() {
      await iam('RemoveRoleFromInstanceProfile', { InstanceProfileName: prof, RoleName: `${p}-role` }, false);
      await iam('DeleteInstanceProfile', { InstanceProfileName: prof }, false);
      await iam('DeleteRole', { RoleName: `${p}-role` }, false);
    },
  });
  await iam('CreateRole', {
    RoleName: `${p}-role`,
    AssumeRolePolicyDocument: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }],
    }),
  });
  await iam('CreateInstanceProfile', { InstanceProfileName: prof });
  await iam('AddRoleToInstanceProfile', { InstanceProfileName: prof, RoleName: `${p}-role` });
  // The types the emulator offers in us-east-1f, taken at run time.
  const offered = items(
    (
      await ec2(ctx, port, 'DescribeInstanceTypeOfferings', {
        LocationType: 'availability-zone',
        'Filter.1.Name': 'location',
        'Filter.1.Value.1': ZONE_F,
      })
    ).root,
    'instanceTypeOfferingSet',
  ).flatMap((each) => textAt(each, 'instanceType') ?? []);
  if (offered.length < 2 || offered.includes('t3.micro')) {
    throw new EnvError(`the emulator's offerings of ${ZONE_F} do not fit the scenario: ${offered.slice(0, 5).join(', ')}`);
  }
  const [T, otherType] = [offered[0]!, offered[1]!];
  const main = page.getByRole('main');
  const name = () => field(main, 'Name - optional').getByRole('textbox');
  const vpc = () => field(main, 'VPC');
  const subnet = () => field(main, 'Subnet');
  const type = () => field(main, 'Instance type');
  const groups = () => field(main, 'Security groups - optional');
  const profile = () => field(main, 'IAM instance profile');
  const userData = `#!/bin/sh\necho ${p}`;
  let launched = '';
  ctx.own({
    async dispose() {
      if (launched === '') return;
      await ec2(ctx, port, 'ModifyInstanceAttribute', { InstanceId: launched, 'DisableApiTermination.Value': 'false' });
      await ec2(ctx, port, 'TerminateInstances', { 'InstanceId.1': launched });
    },
  });

  await lines.line(
    'S2: "VPC" stands on the default VPC, shown with its block and "Default VPC", and "Subnet" on "Chosen by the emulator"; `<p>-v` chosen → "Subnet" is empty and offers `<p>-f` and `<p>-b` alone, each with its zone, block and free addresses; "Security groups" offers `<p>-g` and not the default VPC\'s `default`',
    async () => {
      expect([defaultGroup, defaultBlock].every(Boolean), "the default VPC's group and block, directly").toBe(true);
      await open(page, LAUNCH_PATH, LAUNCH);
      await expect(triggerOf(vpc()), 'the default VPC as "VPC" stands').toContainText(w.defaultVpc, { timeout: 20_000 });
      await expect(triggerOf(subnet()), '"Subnet" as it stands').toContainText('Chosen by the emulator');
      const vpcs = await openSelect(vpc());
      await vpcs.expectOption(w.defaultVpc, defaultBlock!, 'Default VPC');
      await vpcs.choose(v.vpcId);
      await expect(triggerOf(vpc()), 'the VPC chosen').toContainText(v.vpcId);
      await expect(triggerOf(subnet()), '"Subnet" is empty').not.toContainText(/Chosen by the emulator|subnet-/);
      const subnets = await openSelect(subnet());
      await subnets.expectOption(f, ZONE_F, BLOCK_F, 'free addresses');
      await subnets.expectOption(b, 'us-east-1b', BLOCK_B, 'free addresses');
      await subnets.expectNone(...Object.values(w.subnet));
      await expect(subnets.options(), 'the two subnets of the VPC alone').toHaveCount(2);
      await subnets.close();
      const offeredGroups = await openMultiselect(groups());
      await offeredGroups.expectOption(g, `${p}-g`);
      await offeredGroups.expectNone(defaultGroup!);
      await offeredGroups.close();
    },
  );

  await lines.line(
    'With `<p>-v` chosen and no subnet: the name `<p>-none`, an image and `t3.micro` chosen, "Launch instance" → "Choose a subnet." at the field; no request to launch left the page, and the emulator reports no instance named `<p>-none`',
    async () => {
      const launches = countActions(page, 'RunInstances');
      await name().fill(`${p}-none`, ACTION);
      await chooseOption(field(main, 'Image'), w.image.id, w.image.name.slice(1, -1));
      await chooseOption(type(), 't3.micro', 't3.mic');
      await button(main, LAUNCH).click(ACTION);
      await expect(errorOf(subnet()), '"Choose a subnet."').toHaveText('Choose a subnet.');
      expect(launches.count(), 'requests to launch').toBe(0);
      expect(await instancesNamed(ctx, port, `${p}-none`), 'instances of that name, directly').toEqual([]);
    },
  );

  await lines.line(
    'In that form, `<p>-f` chosen → no type is chosen any more, and `t3.micro` is not offered; T is, with its vCPUs, memory and architectures',
    async () => {
      await (await openSelect(subnet())).choose(f);
      await expect(triggerOf(subnet()), 'the subnet chosen').toContainText(f);
      await expect(triggerOf(type()), 'no type is chosen any more').toContainText('Choose an instance type', {
        timeout: 20_000,
      });
      const types = await openSelect(type());
      await types.type(T);
      await types.expectOption(T, 'vCPU', 'GiB');
      await expect(types.option(T), "T's architectures").toContainText(/x86_64|arm64|i386/);
      await types.type('t3.micro');
      await types.expectSays('No instance types match');
      await types.expectNone('t3.micro');
      await types.type(T);
      await types.choose(T);
      await expect(triggerOf(type()), 'T chosen').toContainText(T);
    },
  );

  await lines.line(
    'The name `<p>-i`, an image, `<p>-f`, T, `<p>-g`, the profile `<p>-prof` (its option shows "1 roles"), "Termination protection", the user data `#!/bin/sh` and a second line, the tag `team` = `core`; "Launch instance" → S3; the emulator reports the instance in `<p>-f` with T, `<p>-g`, the profile, termination protection on, the tags `Name` and `team`, and user data that decodes to the text entered, character for character',
    async () => {
      await name().fill(`${p}-i`, ACTION);
      const offeredGroups = await openMultiselect(groups());
      await offeredGroups.choose(g);
      await offeredGroups.close();
      await expect(chosenOf(groups()), '`<p>-g` chosen').toHaveCount(1);
      const profiles = await openSelect(profile());
      await profiles.expectOption(prof, '1 roles');
      await profiles.choose(prof);
      await main.getByRole('checkbox', { name: 'Termination protection', exact: true }).check(ACTION);
      await field(main, 'User data - optional').locator('textarea').fill(userData, ACTION);
      await addTag(main, 'team', 'core');
      await button(main, LAUNCH).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/ec2\/instances\/instance\/i-[0-9a-f]+$/, { timeout: 30_000 });
      launched = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');
      const reported = await instanceDirect(ctx, port, launched);
      const raw = await ec2(ctx, port, 'DescribeInstances', { 'InstanceId.1': launched });
      const attribute = async (attr: string) =>
        textAt((await ec2(ctx, port, 'DescribeInstanceAttribute', { InstanceId: launched, Attribute: attr })).root, attr, 'value');
      expect(
        {
          subnet: reported?.subnetId,
          type: reported?.type,
          groups: reported?.groups.map((each) => each.id),
          tags: reported?.tags,
          protection: await attribute('disableApiTermination'),
        },
        'the instance, directly',
      ).toEqual({ subnet: f, type: T, groups: [g], tags: { Name: `${p}-i`, team: 'core' }, protection: 'true' });
      expect(textAt(anywhere(raw.root, 'iamInstanceProfile'), 'arn') ?? '', "the instance's profile, directly").toContain(prof);
      const sent = (await attribute('userData')) ?? '';
      expect(Buffer.from(sent, 'base64').toString('utf8') === userData, 'the user data decodes to the text entered').toBe(true);
    },
  );

  await lines.line(
    'S3 of that instance, stopped outside: the type editor does not offer `t3.micro` and offers a type of `us-east-1f` other than T; that type chosen and saved → the emulator reports it',
    async () => {
      expect(launched, 'the instance of the line before').not.toBe('');
      await seeded.stop(launched);
      await open(page, instancePath(launched), `${p}-i`);
      const dialog = await edit(page, 'Change instance type');
      const types = await openSelect(field(dialog, 'Instance type'));
      await types.type('t3.micro');
      await types.expectSays('No instance types match');
      await types.expectNone('t3.micro');
      await types.type(otherType);
      await types.expectOption(otherType);
      await types.choose(otherType);
      await save(page);
      await expect
        .poll(async () => (await instanceDirect(ctx, port, launched))?.type, { message: 'the type, directly', timeout: 30_000 })
        .toBe(otherType);
    },
  );

  lines.end();
});
