// RDS's create forms choosing from what the emulator holds (test-criteria.md, issue 651, "Integration scenarios,
// new"): `studio.rds-create-instance-chooses-class-storage-and-placement` and
// `studio.rds-cluster-forms-choose-from-the-emulator`.
//
// The check makes a KMS key, which the API cannot delete at once, so it runs on an emulator of its own. Its network
// (`RdsNetwork`) is made before its `RdsSeeded`, which removes the DB instances first. Options are found by value
// (`support/form-choices.ts`); what a described option says is asserted on the option found.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { addTag, chosenOf, makeKey, openMultiselect, openSelect, tagsShown, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { defaultVersion, defaultVpcId, orderableRows, RdsNetwork, rowDirect, ZONE_B, ZONE_C, zoneIds } from './services/rds/choices';
import {
  ADD_INSTANCE,
  addInstancePath,
  alertWith,
  button,
  clusterDirect,
  clusterPath,
  countActions,
  CREATE_CLUSTER,
  CREATE_CLUSTER_PATH,
  CREATE_INSTANCE,
  CREATE_INSTANCE_PATH,
  errorOf,
  expectFlash,
  field,
  instanceDirect,
  instancePath,
  open,
  radio,
  rds,
  rdsPrefix,
  RdsSeeded,
  runPassword,
} from './services/rds/rds';

const CLASS = 'db.t3.micro';

test('studio.rds-create-instance-chooses-class-storage-and-placement', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const { emulatorPort: port } = await startStack(ctx, { ownEmulator: true });
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdspick');
  const net = await RdsNetwork.make(ctx, port, p, 61);
  new RdsSeeded(ctx, port, p);
  const outId = await net.group(`${p}-out`);
  const key = await makeKey(ctx, port, { alias: `alias/${p}-key` });
  const off = await makeKey(ctx, port, { description: `${p}-off`, disabled: true });
  const zones = await zoneIds(ctx, port);
  const version = await defaultVersion(ctx, port, 'postgres');
  const rows = (await orderableRows(ctx, port, 'postgres', version)).filter((row) => row.instanceClass === CLASS);
  const types = [...new Set(rows.flatMap((row) => row.storageType ?? []))];
  const io1 = rows.find((row) => row.storageType === 'io1');
  const main = page.getByRole('main');
  const text = (label: string) => field(main, label).getByRole('textbox');
  const toggle = (name: string) => main.getByRole('checkbox', { name, exact: true });
  const instanceClass = () => field(main, 'DB instance class');
  const storageType = () => field(main, 'Storage type');
  const subnetGroup = () => field(main, 'DB subnet group - optional');
  const groups = () => field(main, 'Security groups - optional');
  const zone = () => field(main, 'Availability Zone');
  const keyField = () => field(main, 'KMS key');
  const settled = () => expect(triggerOf(instanceClass()), 'the classes are read').toBeEnabled({ timeout: 20_000 });
  expect(await defaultVpcId(ctx, port), 'the default VPC is not the one made').not.toBe(net.vpcId);

  await lines.line(
    'S2, "DB instance class" opened with "PostgreSQL" → `db.t3.micro` is offered, with "Storage:" and the storage types the emulator\'s orderable rows give it for the default version; "Storage type" then offers those types and "Chosen by the emulator"',
    async () => {
      expect(types.length, "the storage types of db.t3.micro in the emulator's rows").toBeGreaterThan(0);
      await open(page, CREATE_INSTANCE_PATH, CREATE_INSTANCE);
      await expect(radio(main, 'postgres'), '"PostgreSQL" as it stands').toBeChecked();
      await settled();
      const classes = await openSelect(instanceClass());
      await classes.expectOption(CLASS, 'Storage:', ...types);
      await classes.close();
      await expect(triggerOf(instanceClass()), 'the class as the choice stands').toContainText(CLASS);
      const offered = await openSelect(storageType());
      for (const type of types) await offered.expectOption(type);
      await offered.expectOption('', 'Chosen by the emulator');
      await offered.close();
    },
  );

  await lines.line(
    '`io1` chosen with the storage 20 → "The storage is a whole number from {min} to {max} for io1." with the row\'s range, and "Enter the IOPS." at "Provisioned IOPS"; no request to create left the page',
    async () => {
      expect(io1, "the emulator's row of db.t3.micro with io1").toBeDefined();
      const creates = countActions(page, 'CreateDBInstance');
      await (await openSelect(storageType())).choose('io1');
      await expect(triggerOf(storageType()), 'io1 chosen').toContainText('io1');
      await text('DB instance identifier').fill(`${p}-full`, ACTION);
      await text('Allocated storage (GiB)').fill('20', ACTION);
      await text('Master user name').fill('fulladmin', ACTION);
      await field(main, 'Master password').locator('input:not([type="checkbox"])').fill(runPassword(), ACTION);
      await button(main, CREATE_INSTANCE).click(ACTION);
      await expect(errorOf(field(main, 'Allocated storage (GiB)')), 'the storage range of io1').toHaveText(
        `The storage is a whole number from ${io1!.minStorage!} to ${io1!.maxStorage!} for io1.`,
      );
      await expect(errorOf(field(main, 'Provisioned IOPS')), '"Enter the IOPS."').toHaveText('Enter the IOPS.');
      await expect(page).toHaveURL(addressOf(CREATE_INSTANCE_PATH));
      expect(creates.count(), 'requests to create').toBe(0);
      expect(await instanceDirect(ctx, port, `${p}-full`), 'a DB instance of that identifier, directly').toBeNull();
    },
  );

  await lines.line(
    '"DB subnet group" `<p>-sng` chosen (its option shows `<p>-v`\'s id and both zones) → "Security groups" offers `<p>-in` with its id and description, and not `<p>-out`; "Availability Zone" offers `us-east-1b` and `us-east-1c` with their zone ids, and no other zone',
    async () => {
      const subnetGroups = await openSelect(subnetGroup());
      await subnetGroups.expectOption(net.subnetGroup, net.vpcId, ZONE_B, ZONE_C);
      await subnetGroups.choose(net.subnetGroup);
      await expect(triggerOf(subnetGroup()), 'the subnet group chosen').toContainText(net.subnetGroup);
      const offered = await openMultiselect(groups());
      await offered.type(p);
      await offered.expectOption(net.inId, `${p}-in`, net.inId, `description of ${p}-in`);
      await offered.expectNone(outId);
      await offered.close();
      const zoneList = await openSelect(zone());
      await zoneList.expectOption(ZONE_B, zones[ZONE_B]!);
      await zoneList.expectOption(ZONE_C, zones[ZONE_C]!);
      await zoneList.expectNone(...Object.keys(zones).filter((each) => each !== ZONE_B && each !== ZONE_C));
      await zoneList.close();
    },
  );

  await lines.line(
    '`<p>-in` chosen, then "DB subnet group" put on "Chosen by the emulator" → `<p>-in` is no longer chosen; `<p>-sng` and `<p>-in` chosen again',
    async () => {
      const pick = async () => {
        const offered = await openMultiselect(groups());
        await offered.type(p);
        await offered.choose(net.inId);
        await offered.close();
        await expect(chosenOf(groups()), '`<p>-in` chosen').toHaveCount(1);
      };
      await pick();
      await (await openSelect(subnetGroup())).choose('');
      await expect(triggerOf(subnetGroup()), '"Chosen by the emulator"').toContainText('Chosen by the emulator');
      await expect(chosenOf(groups()), 'no group is chosen any more').toHaveCount(0);
      await (await openSelect(subnetGroup())).choose(net.subnetGroup);
      await expect(triggerOf(subnetGroup()), 'the subnet group chosen again').toContainText(net.subnetGroup);
      await pick();
      await expect(chosenOf(groups()), 'the chosen group').toContainText(`${p}-in`);
    },
  );

  await lines.line(
    '"Encrypt storage" ticked → "KMS key" offers the key of `alias/<p>-key` with its alias, usage and spec, and no key of the description `<p>-off`',
    async () => {
      await toggle('Encrypt storage').check(ACTION);
      const keys = await openSelect(keyField());
      await keys.expectOption(key.arn, `alias/${p}-key`, 'ENCRYPT_DECRYPT', 'SYMMETRIC_DEFAULT');
      await keys.expectNone(off.arn);
      await keys.choose(key.arn);
      await expect(triggerOf(keyField()), 'the key chosen').toContainText(`alias/${p}-key`);
    },
  );

  await lines.line(
    'The identifier `<p>-full`, storage 100, IOPS 3000, the zone `us-east-1b`, that key, "Deletion protection", the tag `team` = `core`, a master user and password; "Create DB instance" → S3 with "Creating DB instance <p>-full"; the emulator reports the instance with `db.t3.micro`, `io1`, 3000 IOPS, 100 GiB, `<p>-sng`, `<p>-in` alone, `us-east-1b`, encrypted with that key, deletion protection on and the tag',
    async () => {
      await text('Allocated storage (GiB)').fill('100', ACTION);
      await text('Provisioned IOPS').fill('3000', ACTION);
      await (await openSelect(zone())).choose(ZONE_B);
      await expect(triggerOf(zone()), 'the zone chosen').toContainText(ZONE_B);
      await toggle('Deletion protection').check(ACTION);
      await addTag(main, 'team', 'core');
      await settled();
      await button(main, CREATE_INSTANCE).click(ACTION);
      await expect(page).toHaveURL(addressOf(instancePath(`${p}-full`)), { timeout: 30_000 });
      await expectFlash(page, 'success', `Creating DB instance ${p}-full`);
      const reported = await instanceDirect(ctx, port, `${p}-full`);
      const row = await rowDirect(ctx, port, 'instance', `${p}-full`);
      expect(
        {
          instanceClass: reported?.instanceClass,
          storageType: reported?.storageType,
          iops: row?.text('Iops'),
          storage: reported?.storage,
          subnetGroup: reported?.subnetGroup,
          groups: reported?.groups.map((each) => each.id),
          zone: reported?.zone,
          encrypted: row?.text('StorageEncrypted'),
          key: row?.text('KmsKeyId'),
          protection: reported?.protection,
          tags: reported?.tags,
        },
        'the DB instance, directly',
      ).toEqual({
        instanceClass: CLASS,
        storageType: 'io1',
        iops: '3000',
        storage: '100',
        subnetGroup: net.subnetGroup,
        groups: [net.inId],
        zone: ZONE_B,
        encrypted: 'true',
        key: key.arn,
        protection: true,
        tags: { team: 'core' },
      });
    },
  );

  lines.end();
});

test('studio.rds-cluster-forms-choose-from-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const { emulatorPort: port } = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsclpick');
  const net = await RdsNetwork.make(ctx, port, p, 62);
  new RdsSeeded(ctx, port, p);
  const zones = await zoneIds(ctx, port);
  const cluster = `${p}-c`;
  const member = `${cluster}-1`;
  const main = page.getByRole('main');
  const text = (label: string) => field(main, label).getByRole('textbox');
  const instanceClass = () => field(main, 'DB instance class');
  const storageType = () => field(main, 'Storage type');
  const subnetGroup = () => field(main, 'DB subnet group - optional');
  const groups = () => field(main, 'Security groups - optional');
  const clusterZones = () => field(main, 'Availability Zones');
  const zone = () => field(main, 'Availability Zone');
  const others = Object.keys(zones).filter((each) => each !== ZONE_B && each !== ZONE_C);
  const settledTypes = () =>
    expect(storageType().getByText('Checking Storage type'), 'the storage types are read').toHaveCount(0, {
      timeout: 20_000,
    });
  const settledClasses = () =>
    expect(triggerOf(instanceClass()), 'the classes are read').toBeEnabled({ timeout: 20_000 });
  let otherClass = '';

  await lines.line(
    'S5, "Aurora PostgreSQL": "Storage type" offers `aurora` and `aurora-iopt1` and "Chosen by the emulator"; `<p>-sng` chosen → "Availability Zones" offers its two zones alone',
    async () => {
      await open(page, CREATE_CLUSTER_PATH, CREATE_CLUSTER);
      await expect(radio(main, 'aurora-postgresql'), '"Aurora PostgreSQL" as it stands').toBeChecked();
      await settledTypes();
      const types = await openSelect(storageType());
      await types.expectOption('aurora');
      await types.expectOption('aurora-iopt1');
      await types.expectOption('', 'Chosen by the emulator');
      await types.close();
      await (await openSelect(subnetGroup())).choose(net.subnetGroup);
      await expect(triggerOf(subnetGroup()), 'the subnet group chosen').toContainText(net.subnetGroup);
      const zoneList = await openMultiselect(clusterZones());
      await zoneList.expectOption(ZONE_B);
      await zoneList.expectOption(ZONE_C);
      await zoneList.expectNone(...others);
      await zoneList.close();
    },
  );

  await lines.line(
    'The identifier `<p>-c`, a master user name and a password, `aurora-iopt1`, `<p>-sng`, `<p>-in`, the zone `us-east-1b`, "Deletion protection" off, the tag `team` = `core`; "Create DB cluster" → S6; the emulator reports the cluster with `aurora-iopt1`, `<p>-sng`, `<p>-in`, a zone list that holds `us-east-1b`, and the tag',
    async () => {
      await text('DB cluster identifier').fill(cluster, ACTION);
      await text('Master user name').fill('pickadmin', ACTION);
      await field(main, 'Master password').locator('input:not([type="checkbox"])').fill(runPassword(), ACTION);
      await (await openSelect(storageType())).choose('aurora-iopt1');
      await expect(triggerOf(storageType()), 'the storage type chosen').toContainText('aurora-iopt1');
      const offered = await openMultiselect(groups());
      await offered.type(p);
      await offered.choose(net.inId);
      await offered.close();
      await expect(chosenOf(groups()), '`<p>-in` chosen').toHaveCount(1);
      const zoneList = await openMultiselect(clusterZones());
      await zoneList.choose(ZONE_B);
      await zoneList.close();
      await expect(chosenOf(clusterZones()), 'the zone chosen').toContainText(ZONE_B);
      await main.getByRole('checkbox', { name: 'Deletion protection', exact: true }).uncheck(ACTION);
      await addTag(main, 'team', 'core');
      await settledTypes();
      await button(main, CREATE_CLUSTER).click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(cluster)), { timeout: 30_000 });
      const reported = await clusterDirect(ctx, port, cluster);
      const row = await rowDirect(ctx, port, 'cluster', cluster);
      expect(
        {
          storageType: row?.text('StorageType'),
          subnetGroup: reported?.subnetGroup,
          groups: reported?.groups,
          protection: reported?.protection,
          tags: reported?.tags,
        },
        'the DB cluster, directly',
      ).toEqual({
        storageType: 'aurora-iopt1',
        subnetGroup: net.subnetGroup,
        groups: [net.inId],
        protection: false,
        tags: { team: 'core' },
      });
      expect(row?.texts('AvailabilityZones', 'AvailabilityZone'), "the cluster's zones, directly").toContain(ZONE_B);
    },
  );

  await lines.line(
    'S7 of `<p>-c`: "DB instance class" offers classes of the emulator\'s orderable rows for the cluster\'s engine and version, and "Availability Zone" the two zones of `<p>-sng` and "No preference"; the identifier `<p>-c-1`, a class of the list other than the one it starts on, `us-east-1c`, the tag `role` = `writer`; "Add DB instance" → S6; the emulator reports the member with that class, `us-east-1c` and the tag',
    async () => {
      const made = await clusterDirect(ctx, port, cluster);
      expect(made?.version, "the cluster's version, directly").toBeDefined();
      const classes = [...new Set((await orderableRows(ctx, port, 'aurora-postgresql', made!.version!)).map((row) => row.instanceClass))];
      await open(page, addInstancePath(cluster), ADD_INSTANCE);
      await settledClasses();
      const standing = ((await triggerOf(instanceClass()).textContent()) ?? '').trim();
      otherClass = classes.find((each) => each !== '' && !standing.includes(each)) ?? '';
      expect(otherClass, "a class of the emulator's rows other than the one the form starts on").not.toBe('');
      const classList = await openSelect(instanceClass());
      for (const each of classes.slice(0, 3)) await classList.expectOption(each);
      await classList.choose(otherClass);
      await expect(triggerOf(instanceClass()), 'the class chosen').toContainText(otherClass);
      const zoneList = await openSelect(zone());
      await zoneList.expectOption(ZONE_B);
      await zoneList.expectOption(ZONE_C);
      await zoneList.expectOption('', 'No preference');
      await zoneList.expectNone(...others);
      await zoneList.choose(ZONE_C);
      await expect(triggerOf(zone()), 'the zone chosen').toContainText(ZONE_C);
      await text('DB instance identifier').fill(member, ACTION);
      await addTag(main, 'role', 'writer');
      await button(main, ADD_INSTANCE).click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(cluster)), { timeout: 30_000 });
      await expect
        .poll(async () => (await instanceDirect(ctx, port, member))?.status, { timeout: 60_000 })
        .toBe('available');
      const reported = await instanceDirect(ctx, port, member);
      expect(
        [reported?.clusterId, reported?.instanceClass, reported?.zone, reported?.tags],
        'the member, directly',
      ).toEqual([cluster, otherClass, ZONE_C, { role: 'writer' }]);
    },
  );

  await lines.line(
    "S7, the identifier `<p>-c-1` again → the form stays with the emulator's refusal, every entry as it was; the emulator reports one DB instance of that identifier, as it was",
    async () => {
      const before = await instanceDirect(ctx, port, member);
      expect(before, 'the member of the line before, directly').not.toBeNull();
      const direct = await rds(ctx, port, 'CreateDBInstance', {
        DBInstanceIdentifier: member,
        DBClusterIdentifier: cluster,
        Engine: 'aurora-postgresql',
        EngineVersion: before!.version!,
        DBInstanceClass: otherClass,
      });
      expect(direct.status, 'the status of the refused create, directly').not.toBe(200);
      await open(page, addInstancePath(cluster), ADD_INSTANCE);
      await settledClasses();
      await text('DB instance identifier').fill(member, ACTION);
      await (await openSelect(instanceClass())).choose(otherClass);
      await addTag(main, 'role', 'writer');
      const sent = countActions(page, 'CreateDBInstance');
      await button(main, ADD_INSTANCE).click(ACTION);
      await expect(alertWith(main, direct.code!), "the emulator's code in the form").toBeVisible({ timeout: 20_000 });
      await expect(alertWith(main, direct.message!), "the emulator's message").toBeVisible();
      expect(sent.count(), 'requests to create').toBe(1);
      await expect(page).toHaveURL(addressOf(addInstancePath(cluster)));
      await expect(text('DB instance identifier'), 'the identifier as typed').toHaveValue(member);
      await expect(triggerOf(instanceClass()), 'the class as chosen').toContainText(otherClass);
      expect(await tagsShown(main), 'the tag as entered').toEqual([['role', 'writer']]);
      expect(await instanceDirect(ctx, port, member), 'the member, directly').toEqual(before);
    },
  );

  lines.end();
});
