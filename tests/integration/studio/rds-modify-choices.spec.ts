// RDS's modify dialogs choosing from what the emulator holds (test-criteria.md, issue 651, "Integration scenarios,
// new"): `studio.rds-modify-instance-follows-its-parents`.
//
// The network (`RdsNetwork`) is made before the check's `RdsSeeded`, which removes the DB instances first. Options
// are found by value (`support/form-choices.ts`); what a described option says is asserted on the option found.

import { EnvError, expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { chosenOf, openMultiselect, openSelect, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { RdsNetwork, rowDirect } from './services/rds/choices';
import { expectModifyResult, openModify } from './services/rds/modify';
import {
  errorOf,
  field,
  instanceDirect,
  instancePath,
  open,
  rds,
  rdsPrefix,
  RdsSeeded,
  runPassword,
} from './services/rds/rds';

const NOT_IN_LIST = "Not in the emulator's list";
const ODD_CLASS = 'db.r8gd.large';

test('studio.rds-modify-instance-follows-its-parents', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const { emulatorPort: port } = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsmodpick');
  const net = await RdsNetwork.make(ctx, port, p, 63);
  const seeded = new RdsSeeded(ctx, port, p);
  const m = await seeded.instance({
    id: `${p}-m`, engine: 'postgres', version: '16.4', instanceClass: 'db.t3.micro', storage: 20,
    masterUsername: 'modadmin', password: runPassword(),
  });
  const odd = await seeded.instance({ id: `${p}-odd`, engine: 'mysql', instanceClass: 'db.t3.micro', storage: 20 });
  const changed = await rds(ctx, port, 'ModifyDBInstance', {
    DBInstanceIdentifier: odd, DBInstanceClass: ODD_CLASS, ApplyImmediately: 'true',
  });
  if (changed.status !== 200) throw new EnvError(`direct ModifyDBInstance to ${ODD_CLASS} answered ${String(changed.status)}`);
  await expect
    .poll(async () => (await instanceDirect(ctx, port, odd))?.instanceClass, { timeout: 60_000 })
    .toBe(ODD_CLASS);
  const started = (await instanceDirect(ctx, port, m))!;
  const reports = (id: string, read: () => Promise<unknown>, want: unknown, what: string) =>
    expect.poll(read, { message: `${what} of ${id}, directly`, timeout: 60_000 }).toEqual(want);
  const dialogField = (label: string) => field(page.getByRole('dialog'), label);

  await lines.line(
    'S3 of `<p>-m`, "Modify": "Engine version" stands on "Keep 16.4"; it offers 16.13 as "Minor upgrade" and 17.9 as "Major upgrade", and no option 16.5',
    async () => {
      await open(page, instancePath(m), m);
      await openModify(page);
      await expect(triggerOf(dialogField('Engine version')), '"Keep 16.4"').toContainText('Keep 16.4');
      const versions = await openSelect(dialogField('Engine version'));
      await versions.expectOption('16.13', 'Minor upgrade');
      await versions.expectOption('17.9', 'Major upgrade');
      await versions.expectNone('16.5');
      await versions.close();
    },
  );

  await lines.line(
    '16.13 chosen → the class still reads `db.t3.micro`; "Save changes" → the page\'s result; the emulator reports 16.13 and the class, storage and groups as they were',
    async () => {
      await open(page, instancePath(m), m);
      const form = await openModify(page);
      await (await openSelect(dialogField('Engine version'))).choose('16.13');
      await expect(triggerOf(dialogField('Engine version')), '16.13 chosen').toContainText('16.13');
      await expect(triggerOf(page.locator('#rds-modify-field-class')), 'the class').toContainText('db.t3.micro');
      await expect(form.save, '"Save changes" once the classes of 16.13 are read').toBeEnabled({ timeout: 20_000 });
      await form.save.click(ACTION);
      await expectModifyResult(page, m);
      await reports(m, async () => (await instanceDirect(ctx, port, m))?.version, '16.13', 'the version');
      const now = await instanceDirect(ctx, port, m);
      expect(
        [now?.instanceClass, now?.storage, now?.storageType, now?.groups],
        'the class, storage and groups, directly',
      ).toEqual([started.instanceClass, started.storage, started.storageType, started.groups]);
    },
  );

  await lines.line(
    '"Modify": "Storage type" `io1` chosen with the storage 100 and IOPS 3000, "Save changes" → the emulator reports `io1`, 100 GiB, 3000 IOPS',
    async () => {
      await open(page, instancePath(m), m);
      const form = await openModify(page);
      await (await openSelect(dialogField('Storage type'))).choose('io1');
      await expect(triggerOf(dialogField('Storage type')), 'io1 chosen').toContainText('io1');
      await form.storage.fill('100', ACTION);
      await dialogField('Provisioned IOPS').getByRole('textbox').fill('3000', ACTION);
      await expect(form.save, '"Save changes"').toBeEnabled({ timeout: 20_000 });
      await form.save.click(ACTION);
      await expectModifyResult(page, m);
      await reports(
        m,
        async () => {
          const now = await instanceDirect(ctx, port, m);
          return [now?.storageType, now?.storage, (await rowDirect(ctx, port, 'instance', m))?.text('Iops')];
        },
        ['io1', '100', '3000'],
        'the storage',
      );
    },
  );

  await lines.line(
    '"Modify": "DB subnet group" `<p>-sng` chosen → the instance\'s group is no longer chosen, the field says "Choose security groups of {`<p>-v`\'s id}" and "Save changes" cannot be pressed; `<p>-in` chosen, "Save changes" → the emulator reports `<p>-sng` and `<p>-in`',
    async () => {
      await open(page, instancePath(m), m);
      const form = await openModify(page);
      const groups = () => dialogField('Security groups');
      await expect(chosenOf(groups()), "the instance's groups as it opens").toHaveCount(started.groups.length, {
        timeout: 20_000,
      });
      await (await openSelect(dialogField('DB subnet group'))).choose(net.subnetGroup);
      await expect(triggerOf(dialogField('DB subnet group')), 'the subnet group chosen').toContainText(net.subnetGroup);
      await expect(errorOf(groups()), 'the field asks for groups of the VPC').toHaveText(
        `Choose security groups of ${net.vpcId}`,
        { timeout: 20_000 },
      );
      await expect(chosenOf(groups()), 'no group is chosen any more').toHaveCount(0);
      await expect(form.save, '"Save changes" cannot be pressed').toBeDisabled();
      const offered = await openMultiselect(groups());
      await offered.type(p);
      await offered.choose(net.inId);
      await offered.close();
      await expect(chosenOf(groups()), '`<p>-in` chosen').toHaveCount(1);
      await expect(form.save, '"Save changes"').toBeEnabled({ timeout: 20_000 });
      await form.save.click(ACTION);
      await expectModifyResult(page, m);
      await reports(
        m,
        async () => {
          const now = await instanceDirect(ctx, port, m);
          return [now?.subnetGroup, now?.groups.map((each) => each.id)];
        },
        [net.subnetGroup, [net.inId]],
        'the subnet group and the groups',
      );
    },
  );

  await lines.line(
    'S3 of `<p>-odd`, "Modify": the class reads `db.r8gd.large` with "Not in the emulator\'s list"; "Deletion protection" ticked, "Save changes" → the emulator reports deletion protection on and the class `db.r8gd.large`',
    async () => {
      await open(page, instancePath(odd), odd);
      const form = await openModify(page);
      const instanceClass = triggerOf(page.locator('#rds-modify-field-class'));
      await expect(instanceClass, 'the class as the emulator reports it').toContainText(ODD_CLASS, { timeout: 20_000 });
      await expect(instanceClass, `"${NOT_IN_LIST}"`).toContainText(NOT_IN_LIST, { timeout: 20_000 });
      await form.protection.check(ACTION);
      await expect(form.save, '"Save changes"').toBeEnabled({ timeout: 20_000 });
      await form.save.click(ACTION);
      await expectModifyResult(page, odd);
      await reports(
        odd,
        async () => {
          const now = await instanceDirect(ctx, port, odd);
          return [now?.protection, now?.instanceClass];
        },
        [true, ODD_CLASS],
        'the protection and the class',
      );
    },
  );

  lines.end();
});
