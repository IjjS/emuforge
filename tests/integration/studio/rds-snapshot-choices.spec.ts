// RDS's DB cluster snapshot dialogs tagging a snapshot and restoring into a chosen network (test-criteria.md, issue
// 651, "Integration scenarios, new"): `studio.rds-snapshot-forms-tag-and-restore-into-a-chosen-network`.
//
// The check makes a KMS key, which the API cannot delete at once, so it runs on an emulator of its own. Its network
// (`RdsNetwork`) is made before its `RdsSeeded`, which removes the DB clusters first. Options are found by value.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { addTag, chosenOf, makeKey, openMultiselect, openSelect, tagsShown, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { RdsNetwork, rowDirect, ZONE_C } from './services/rds/choices';
import { ownSnapshot, SNAPSHOT_ID, SNAPSHOTS } from './services/rds/cluster-actions';
import {
  button,
  clusterDirect,
  clusterPath,
  dialogOf,
  expectCell,
  expectFlash,
  field,
  open,
  rds,
  rdsPrefix,
  RdsSeeded,
  runPassword,
  selectRow,
  tableOf,
  type Xml,
} from './services/rds/rds';

test('studio.rds-snapshot-forms-tag-and-restore-into-a-chosen-network', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const { emulatorPort: port } = await startStack(ctx, { ownEmulator: true });
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdssnappick');
  const net = await RdsNetwork.make(ctx, port, p, 65);
  const seeded = new RdsSeeded(ctx, port, p);
  const key = await makeKey(ctx, port, { alias: `alias/${p}-key` });
  const src = await seeded.cluster({
    id: `${p}-src`, engine: 'aurora-postgresql', masterUsername: 'snapadmin', password: runPassword(),
  });
  const held = await seeded.cluster({ id: `${p}-held`, engine: 'aurora-postgresql' });
  const snap = `${p}-snap`;
  const back = `${p}-back`;
  ownSnapshot(ctx, port, snap);
  const main = page.getByRole('main');
  const dialog = () => dialogOf(page);
  const snapshots = () => tableOf(main, 'DB cluster snapshots');
  /** The tags the emulator holds for the resource of `arn`. */
  const tagsOf = async (arn: string | undefined) => {
    if (arn === undefined) return null;
    const answer = await rds(ctx, port, 'ListTagsForResource', { ResourceName: arn });
    if (answer.status !== 200) return null;
    const tags: Record<string, string> = {};
    const walk = (node: Xml) => {
      const text = (name: string) => node.children.find((each) => each.name === name)?.text;
      if (node.name === 'Tag' && text('Key') !== undefined) tags[text('Key')!] = text('Value') ?? '';
      node.children.forEach(walk);
    };
    walk(answer.root);
    return tags;
  };
  /** The snapshots page with "Restore" of `<p>-snap` open. */
  const openRestore = async () => {
    await open(page, SNAPSHOTS, 'DB cluster snapshots');
    await expectCell(snapshots(), SNAPSHOT_ID, snap, 'Status', 'available');
    await selectRow(snapshots(), SNAPSHOT_ID, snap);
    await button(main, 'Restore').click(ACTION);
    await expect(dialog(), 'the Restore dialog').toBeVisible();
  };
  const chooseSubnetGroup = async () => {
    const subnetGroup = field(dialog(), 'DB subnet group - optional');
    await (await openSelect(subnetGroup)).choose(net.subnetGroup);
    await expect(triggerOf(subnetGroup), 'the subnet group chosen').toContainText(net.subnetGroup);
  };

  await lines.line(
    'S6 of `<p>-src`, "Create snapshot", the identifier `<p>-snap`, the tag `kept` = `yes` → the snapshots page with its result; the emulator reports the snapshot with the tag',
    async () => {
      await open(page, clusterPath(src.id), src.id);
      await button(main, 'Take snapshot').click(ACTION);
      await field(dialog(), SNAPSHOT_ID).getByRole('textbox').fill(snap, ACTION);
      await addTag(dialog(), 'kept', 'yes');
      await button(dialog(), 'Take snapshot').click(ACTION);
      await expect(page).toHaveURL(addressOf(SNAPSHOTS), { timeout: 30_000 });
      await expectFlash(page, 'success', `Creating DB cluster snapshot ${snap}`);
      await expectCell(snapshots(), SNAPSHOT_ID, snap, 'Status', 'available');
      const row = await rowDirect(ctx, port, 'cluster-snapshot', snap);
      expect(row?.text('DBClusterIdentifier'), "the snapshot's source, directly").toBe(src.id);
      expect(await tagsOf(row?.text('DBClusterSnapshotArn')), "the snapshot's tags, directly").toEqual({ kept: 'yes' });
    },
  );

  await lines.line(
    '"Restore" of `<p>-snap`: the identifier `<p>-back`, `<p>-sng`, `<p>-in`, the zone `us-east-1c`, the key of `alias/<p>-key`, "Deletion protection", the tag `from` = `snap`; "Restore" → the result; the emulator reports `<p>-back` in `<p>-sng` with `<p>-in`, encrypted with that key, deletion protection on, the tag, and the version of `<p>-src`',
    async () => {
      await openRestore();
      await field(dialog(), 'DB cluster identifier').getByRole('textbox').fill(back, ACTION);
      await chooseSubnetGroup();
      const groups = field(dialog(), 'Security groups - optional');
      const offered = await openMultiselect(groups);
      await offered.type(p);
      await offered.choose(net.inId);
      await offered.close();
      await expect(chosenOf(groups), '`<p>-in` chosen').toHaveCount(1);
      const zones = field(dialog(), 'Availability Zones');
      const zoneList = await openMultiselect(zones);
      await zoneList.choose(ZONE_C);
      await zoneList.close();
      await expect(chosenOf(zones), 'the zone chosen').toContainText(ZONE_C);
      const keyField = field(dialog(), 'KMS key');
      await (await openSelect(keyField)).choose(key.arn);
      await expect(triggerOf(keyField), 'the key chosen').toContainText(`alias/${p}-key`);
      await dialog().getByRole('checkbox', { name: 'Deletion protection', exact: true }).check(ACTION);
      await addTag(dialog(), 'from', 'snap');
      await button(dialog(), 'Restore').click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(back)), { timeout: 30_000 });
      await expectFlash(page, 'success', `Restoring DB cluster ${back}`);
      await expect.poll(async () => (await clusterDirect(ctx, port, back))?.status, { timeout: 60_000 }).toBe('available');
      const reported = await clusterDirect(ctx, port, back);
      const row = await rowDirect(ctx, port, 'cluster', back);
      expect(
        {
          subnetGroup: reported?.subnetGroup,
          groups: reported?.groups,
          encrypted: row?.text('StorageEncrypted'),
          key: row?.text('KmsKeyId'),
          protection: reported?.protection,
          tags: reported?.tags,
          version: reported?.version,
        },
        'the restored DB cluster, directly',
      ).toEqual({
        subnetGroup: net.subnetGroup,
        groups: [net.inId],
        encrypted: 'true',
        key: key.arn,
        protection: true,
        tags: { from: 'snap' },
        version: src.version,
      });
    },
  );

  await lines.line(
    '"Restore" of `<p>-snap` with the identifier `<p>-held`, `<p>-sng` and the tag `from` = `snap` → the dialog closes and the page shows the emulator\'s refusal; "Restore" opened again holds the identifier, `<p>-sng` and the tag; the emulator reports `<p>-held` as it was made',
    async () => {
      const direct = await rds(ctx, port, 'RestoreDBClusterFromSnapshot', {
        DBClusterIdentifier: held.id, SnapshotIdentifier: snap, Engine: 'aurora-postgresql',
        DBSubnetGroupName: net.subnetGroup,
      });
      expect(direct.status, 'the status of the refused restore, directly').not.toBe(200);
      await openRestore();
      await field(dialog(), 'DB cluster identifier').getByRole('textbox').fill(held.id, ACTION);
      await chooseSubnetGroup();
      await addTag(dialog(), 'from', 'snap');
      await button(dialog(), 'Restore').click(ACTION);
      await expect(dialog(), 'the dialog closes').toHaveCount(0, { timeout: 20_000 });
      await expectFlash(page, 'error', direct.code!, direct.message!);
      await button(main, 'Restore').click(ACTION);
      await expect(dialog(), 'the Restore dialog again').toBeVisible();
      await expect(field(dialog(), 'DB cluster identifier').getByRole('textbox'), 'the identifier').toHaveValue(held.id);
      await expect(triggerOf(field(dialog(), 'DB subnet group - optional')), 'the subnet group').toContainText(net.subnetGroup);
      expect(await tagsShown(dialog()), 'the tag').toEqual([['from', 'snap']]);
      expect(await clusterDirect(ctx, port, held.id), '`<p>-held`, directly').toEqual(held);
    },
  );

  lines.end();
});
