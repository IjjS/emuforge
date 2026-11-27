// EC2's create forms describing their choices and tagging what they make (test-criteria.md, issue 651, "Integration
// scenarios, new"): `studio.ec2-group-rule-and-key-pair-forms-describe-and-tag`.
//
// Each check names what it makes under its own prefix `<p>` and removes it when it ends (`Ec2Seeded`). Options are
// found by value (`support/form-choices.ts`); what a described option says is asserted on the option found.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { addTag, openSelect, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ADD_RULE,
  addRulePath,
  button,
  CREATE_GROUP,
  CREATE_GROUP_PATH,
  CREATE_KEY_PAIR,
  CREATE_KEY_PAIR_PATH,
  ec2,
  Ec2Seeded,
  expectFlash,
  field,
  groupDirect,
  groupPath,
  items,
  keyPairDirect,
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
