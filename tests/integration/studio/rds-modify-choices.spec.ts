// RDS's modify dialogs choosing from what the emulator holds (test-criteria.md, issue 651, "Integration scenarios,
// new"): `studio.rds-modify-instance-follows-its-parents` and
// `studio.rds-modify-cluster-version-storage-and-groups`.
//
// The network (`RdsNetwork`) is made before the check's `RdsSeeded`, which removes the DB instances first. Options
// are found by value (`support/form-choices.ts`); what a described option says is asserted on the option found.

import { EnvError, expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { chosenOf, openMultiselect, openSelect, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { RdsNetwork, rowDirect } from './services/rds/choices';
import { clusterAction } from './services/rds/cluster-actions';
import { expectModifyResult, openModify } from './services/rds/modify';
import {
  button,
  clusterDirect,
  clusterPath,
  dialogOf,
  errorOf,
  expectFlash,
  expectValueIs,
  field,
  instanceDirect,
  instancePath,
  open,
  rds,
  rdsPrefix,
  RdsSeeded,
  reportsClusterStatus,
  reportsNoCluster,
  reportsNoInstance,
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

test('studio.rds-modify-cluster-version-storage-and-groups', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const { emulatorPort: port } = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsclmod');
  const net = await RdsNetwork.make(ctx, port, p, 64);
  const seeded = new RdsSeeded(ctx, port, p);
  const k = `${p}-k`;
  const k2 = `${p}-k2`;
  const made = await rds(ctx, port, 'CreateDBCluster', {
    DBClusterIdentifier: k, Engine: 'aurora-postgresql', EngineVersion: '16.4', DBSubnetGroupName: net.subnetGroup,
    MasterUsername: 'clmodadmin', MasterUserPassword: runPassword(),
  });
  if (made.status !== 200 || !(await reportsClusterStatus(ctx, port, k, 'available'))) {
    throw new EnvError(`the DB cluster ${k} was not made: ${String(made.status)} ${made.code ?? ''}`);
  }
  const member = (suffix: string) =>
    seeded.instance({ id: `${k}${suffix}`, engine: 'aurora-postgresql', clusterId: k, instanceClass: 'db.r6g.large' });
  const writer = await member('-w');
  const reader = await member('-r');
  const dialogField = (label: string) => field(dialogOf(page), label);
  const save = () => button(dialogOf(page), 'Save changes');
  const modify = async (id: string) => {
    await open(page, clusterPath(id), id);
    await clusterAction(page, 'modify');
    await expect(dialogOf(page), 'the Modify dialog').toBeVisible();
  };

  await lines.line(
    'S6, "Modify": "Engine version" offers 16.6 as "Minor upgrade" and no option 16.5; "Storage type" offers `aurora` and `aurora-iopt1`; "Security groups" offers `<p>-in`',
    async () => {
      await modify(k);
      const versions = await openSelect(dialogField('Engine version'));
      await versions.expectOption('16.6', 'Minor upgrade');
      await versions.expectNone('16.5');
      await versions.close();
      const types = await openSelect(dialogField('Storage type'));
      await types.expectOption('aurora');
      await types.expectOption('aurora-iopt1');
      await types.close();
      const groups = await openMultiselect(dialogField('Security groups'));
      await groups.type(p);
      await groups.expectOption(net.inId, `${p}-in`);
      await groups.close();
    },
  );

  await lines.line(
    '16.6, `aurora-iopt1` and `<p>-in` chosen, "Save" → "DB cluster <p>-k updated"; the emulator reports 16.6, `aurora-iopt1` and `<p>-in`',
    async () => {
      await modify(k);
      await (await openSelect(dialogField('Engine version'))).choose('16.6');
      await expect(triggerOf(dialogField('Engine version')), '16.6 chosen').toContainText('16.6');
      await (await openSelect(dialogField('Storage type'))).choose('aurora-iopt1');
      await expect(triggerOf(dialogField('Storage type')), 'the storage type chosen').toContainText('aurora-iopt1');
      const groups = await openMultiselect(dialogField('Security groups'));
      await groups.type(p);
      await groups.choose(net.inId);
      await groups.close();
      await expect(chosenOf(dialogField('Security groups')).filter({ hasText: `${p}-in` }), '`<p>-in` chosen').toHaveCount(1);
      await expect(save(), '"Save changes"').toBeEnabled({ timeout: 20_000 });
      await save().click(ACTION);
      await expectFlash(page, 'success', `DB cluster ${k} updated`);
      await expect
        .poll(
          async () => {
            const now = await clusterDirect(ctx, port, k);
            return [now?.version, (await rowDirect(ctx, port, 'cluster', k))?.text('StorageType'), now?.groups.includes(net.inId)];
          },
          { message: 'the version, storage type and group, directly', timeout: 60_000 },
        )
        .toEqual(['16.6', 'aurora-iopt1', true]);
    },
  );

  await lines.line(
    '"Modify", the identifier `<p>-k2`, "Save" → the page of `<p>-k2` with the result; the emulator reports `<p>-k2` and no cluster `<p>-k`',
    async () => {
      await modify(k);
      await dialogField('DB cluster identifier').getByRole('textbox').fill(k2, ACTION);
      await expect(save(), '"Save changes"').toBeEnabled({ timeout: 20_000 });
      await save().click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(k2)), { timeout: 30_000 });
      await expectFlash(page, 'success', `DB cluster ${k2} updated`);
      await expect.poll(async () => (await clusterDirect(ctx, port, k2))?.id, { timeout: 60_000 }).toBe(k2);
      expect(await clusterDirect(ctx, port, k), 'the cluster of the old identifier, directly').toBeNull();
    },
  );

  await lines.line(
    '"Fail over": the reader\'s option shows its class and its zone as the emulator reports them',
    async () => {
      // Which member reads is the emulator's to say: the cluster was upgraded and renamed since they were made.
      const readerNow = (await clusterDirect(ctx, port, k2))?.members.find((each) => !each.writer)?.id;
      expect(readerNow, "the cluster's reader, directly").toBeDefined();
      const reported = await instanceDirect(ctx, port, readerNow!);
      expect([reported?.instanceClass, reported?.zone].every(Boolean), "the reader's class and zone, directly").toBe(true);
      await open(page, clusterPath(k2), k2);
      // "Fail over" is offered once the renamed, upgraded cluster is available again.
      await expectValueIs(page, 'Status', 'available');
      await clusterAction(page, 'failover');
      await expect(dialogOf(page), 'the Fail over dialog').toBeVisible();
      const targets = await openSelect(dialogField('Target DB instance'));
      await targets.expectOption(readerNow!, reported!.instanceClass, reported!.zone!);
      await targets.close();
      await button(dialogOf(page), 'Cancel').click(ACTION);
      await expect(dialogOf(page), 'the dialog after "Cancel"').toHaveCount(0);
    },
  );

  await lines.line(
    '"Modify" opened, the cluster\'s reader and writer and then the cluster deleted outside, the retention period changed, "Save" → the dialog closes and the page shows the emulator\'s refusal; the emulator reports no cluster `<p>-k2`',
    async () => {
      await modify(k2);
      for (const id of [reader, writer]) {
        await rds(ctx, port, 'DeleteDBInstance', { DBInstanceIdentifier: id, SkipFinalSnapshot: 'true' });
      }
      for (const id of [reader, writer]) expect(await reportsNoInstance(ctx, port, id), `no DB instance ${id}`).toBe(true);
      await rds(ctx, port, 'DeleteDBCluster', { DBClusterIdentifier: k2, SkipFinalSnapshot: 'true' });
      expect(await reportsNoCluster(ctx, port, k2), 'no DB cluster, directly').toBe(true);
      const direct = await rds(ctx, port, 'ModifyDBCluster', {
        DBClusterIdentifier: k2, BackupRetentionPeriod: '9', ApplyImmediately: 'true',
      });
      expect(direct.status, 'the status of the refused change, directly').not.toBe(200);
      await dialogField('Backup retention period (days)').getByRole('textbox').fill('9', ACTION);
      await save().click(ACTION);
      await expect(dialogOf(page), 'the dialog closes').toHaveCount(0, { timeout: 20_000 });
      await expectFlash(page, 'error', direct.code!, direct.message!);
      expect(await clusterDirect(ctx, port, k2), 'the cluster, directly').toBeNull();
    },
  );

  lines.end();
});
