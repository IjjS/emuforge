// RDS's DB clusters: the list S4, the create form S5, a DB cluster's page S6 and "Add DB instance" S7, in the built
// app in front of a real engine and emulator (test-criteria.md, issue 573: task 4).
//
// `studio.rds-cluster-from-create-to-delete`, `studio.rds-clusters-made-elsewhere-are-shown`.
//
// Each check names its DB clusters, DB instances and security groups under its own prefix `<p>` and removes them when
// it ends (`RdsSeeded`). The emulator's lists hold other checks' resources and have no filter, so a check finds its
// own rows by their identifier, or opens a page by its address. Words, direct calls and readers:
// `services/rds/rds.ts`. No password is logged or put in an assertion's message.

import { EnvError, expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { openSelect, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { creationDateText, SEOUL } from './support/service-screens';
import { waitFor } from './support/wait';
import {
  ADD_INSTANCE,
  addInstancePath,
  alertWith,
  AURORA_NOT_BY_ITSELF,
  button,
  CHANGED_WITH_CLUSTER,
  chooseOption,
  CLUSTER_NOT_FOUND,
  clusterDirect,
  clusterPath,
  CLUSTERS_H1,
  CLUSTERS_PATH,
  clusterSnapshotsOf,
  confirmWith,
  countActions,
  CREATE_CLUSTER,
  CREATE_CLUSTER_PATH,
  DELETE,
  dialogOf,
  emptyOf,
  engineText,
  engineVersions,
  expectAvailable,
  expectCell,
  expectFlash,
  expectNoRow,
  expectUnavailable,
  expectValueIs,
  expectValueParts,
  field,
  instanceDirect,
  instancePath,
  INSTANCES_H1,
  INSTANCES_PATH,
  MEMBERS_FIRST,
  NO_INSTANCES,
  NONE,
  open,
  PROTECTION_IS_ON,
  radio,
  rds,
  rdsPrefix,
  RdsSeeded,
  REBOOT,
  REFRESH,
  reportsClusterStatus,
  reportsNoCluster,
  reportsNoInstance,
  reportsStatus,
  rowOf,
  rowsOf,
  runPassword,
  selectRow,
  START,
  STOP,
  TABLE,
  tableOf,
  valueLocator,
  VIEW_CLUSTERS,
} from './services/rds/rds';

// "Created" is written in the zone the check sets on its browser context.
test.use({ timezoneId: SEOUL.timeZone });

/** The class the checks give a member of an Aurora DB cluster. */
const MEMBER_CLASS = 'db.r6g.large';
const ID = 'DB identifier';
const CLUSTER_ID = 'DB cluster identifier';
const MEMBERS = 'DB instances';

// ---------------------------------------------------------------------------------------------------------------

test('studio.rds-cluster-from-create-to-delete', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsclu');
  const seeded = new RdsSeeded(ctx, port, p);
  const password = runPassword();
  const held = await seeded.cluster({ id: `${p}-held`, engine: 'aurora-postgresql' });
  const versions = await engineVersions(ctx, port, 'aurora-postgresql');
  const chosen = versions.find((each) => each !== held.version);
  if (chosen === undefined) {
    throw new EnvError(`the emulator lists no version of aurora-postgresql other than ${held.version ?? 'none'}`);
  }
  const aur = `${p}-aur`;
  const first = `${aur}-1`;
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  const members = () => tableOf(main, MEMBERS);
  const clusterIdentifier = () => field(main, CLUSTER_ID).getByRole('textbox');
  const instanceIdentifier = () => field(main, 'DB instance identifier').getByRole('textbox');
  const instanceClass = () => field(main, 'DB instance class');
  /**
   * "Create DB cluster" once the form has settled: the form sends nothing while the emulator's storage types for the
   * engine and version are being read, which "Storage type" says until they are.
   */
  const sendCluster = async () => {
    await expect(field(main, 'Storage type').getByText('Checking Storage type'), 'the storage types are read').toHaveCount(0, {
      timeout: 20_000,
    });
    await button(main, CREATE_CLUSTER).click(ACTION);
  };
  const user = () => field(main, 'Master user name').getByRole('textbox');
  // A password field has no role of a text box.
  const secret = () => field(main, 'Master password').locator('input:not([type="checkbox"])');
  const database = () => field(main, 'Database name - optional').getByRole('textbox');

  await lines.line(
    'S4, "Create DB cluster" → S5; the identifier `<prefix>-AUR`, "Aurora PostgreSQL" as it stands, a version of the emulator\'s list for `aurora-postgresql` other than H\'s chosen, a master user name, a password, the database name `aurdb`; "Create DB cluster" → S6 at `<prefix>-aur` with "Creating DB cluster <prefix>-aur"; S6 reads `available` without a refresh, and "DB instances" reads "No DB instances"',
    async () => {
      await open(page, CLUSTERS_PATH, CLUSTERS_H1);
      await main.getByRole('link', { name: CREATE_CLUSTER, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_CLUSTER_PATH));
      await expect(heading(page, CREATE_CLUSTER)).toBeVisible();
      await clusterIdentifier().fill(`${p}-AUR`, ACTION);
      await expect(radio(main, 'aurora-postgresql'), '"Aurora PostgreSQL" as it stands').toBeChecked();
      await chooseOption(field(main, 'Engine version - optional'), chosen);
      await user().fill('auradmin', ACTION);
      await secret().fill(password, ACTION);
      await database().fill('aurdb', ACTION);
      await sendCluster();
      await expect(page).toHaveURL(addressOf(clusterPath(aur)), { timeout: 30_000 });
      await expectFlash(page, 'success', `Creating DB cluster ${aur}`);
      await expectValueIs(page, 'Status', 'available');
      await expect(emptyOf(members()), `"${NO_INSTANCES}"`).toContainText(NO_INSTANCES, { timeout: 30_000 });
    },
  );

  await lines.line(
    'The emulator reports the DB cluster `<prefix>-aur` with `aurora-postgresql`, that version, the master user name and `aurdb`, and no member',
    async () => {
      const reported = await clusterDirect(ctx, port, aur);
      expect(
        [reported?.engine, reported?.version, reported?.masterUsername, reported?.databaseName, reported?.members],
        'the DB cluster, directly',
      ).toEqual(['aurora-postgresql', chosen, 'auradmin', 'aurdb', []]);
    },
  );

  await lines.line(
    "S5, the identifier `<prefix>-held` with the required fields → the form stays with the emulator's `DBClusterAlreadyExistsFault` and its message; the emulator still reports H as it was made",
    async () => {
      const direct = await rds(ctx, port, 'CreateDBCluster', {
        DBClusterIdentifier: held.id,
        Engine: 'aurora-postgresql',
      });
      expect(direct.code, "the emulator's code, directly").toBe('DBClusterAlreadyExistsFault');
      await open(page, CREATE_CLUSTER_PATH, CREATE_CLUSTER);
      await clusterIdentifier().fill(held.id, ACTION);
      await user().fill('heldadmin', ACTION);
      await secret().fill(password, ACTION);
      await sendCluster();
      await expect(alertWith(main, 'DBClusterAlreadyExistsFault'), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(alertWith(main, direct.message!), "the emulator's message").toBeVisible();
      await expect(page).toHaveURL(addressOf(CREATE_CLUSTER_PATH));
      expect(await clusterDirect(ctx, port, held.id), 'H, directly').toEqual(held);
    },
  );

  await lines.line(
    'S6 of `<prefix>-aur`, "Add DB instance" → S7, whose description names the cluster; the identifier `<prefix>-aur-1`, the class `db.r6g.large` as the choice stands, "Add DB instance" → S6 with "Creating DB instance <prefix>-aur-1"; its row reads "Writer", `available` without a refresh, the class and the port as the emulator reports them (changed, issue 651)',
    async () => {
      await open(page, clusterPath(aur), aur);
      await expectValueIs(page, 'Status', 'available');
      await main.getByRole('link', { name: ADD_INSTANCE, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(addInstancePath(aur)));
      await expect(heading(page, ADD_INSTANCE)).toBeVisible({ timeout: 15_000 });
      await expect(main, 'the description names the cluster').toContainText(aur);
      await instanceIdentifier().fill(first, ACTION);
      await expect(triggerOf(instanceClass()), 'the class as the choice stands').toContainText(MEMBER_CLASS);
      await expect(triggerOf(instanceClass()), 'the classes are read').toBeEnabled({ timeout: 20_000 });
      await button(main, ADD_INSTANCE).click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(aur)), { timeout: 30_000 });
      await expectFlash(page, 'success', `Creating DB instance ${first}`);
      await expectCell(members(), ID, first, 'Status', 'available');
      const row = await rowOf(members(), ID, first);
      const reported = await instanceDirect(ctx, port, first);
      expect([row.Role, row.Class, row.Port], 'the row of the member').toEqual([
        'Writer',
        reported?.instanceClass,
        reported?.port,
      ]);
      expect(reported?.instanceClass, 'the class the emulator reports is the one that stood').toBe(MEMBER_CLASS);
    },
  );

  await lines.line(
    "The emulator reports the DB instance `<prefix>-aur-1` as a member of `<prefix>-aur`, with the cluster's engine and the cluster's version (not H's)",
    async () => {
      const reported = await instanceDirect(ctx, port, first);
      expect([reported?.clusterId, reported?.engine, reported?.version], 'the member, directly').toEqual([
        aur,
        'aurora-postgresql',
        chosen,
      ]);
      expect(reported?.version, "the member's version is not H's").not.toBe(held.version);
      expect((await clusterDirect(ctx, port, aur))?.members, "the cluster's members, directly").toEqual([
        { id: first, writer: true },
      ]);
    },
  );

  await lines.line(
    'S7, the identifier `<p>-aur-2`, `db.nosuch` typed in "DB instance class" → "No classes match" and no option of the value `db.nosuch.large`; nothing is sent; the emulator reports no DB instance `<p>-aur-2` (changed, issue 651)',
    async () => {
      await open(page, addInstancePath(aur), ADD_INSTANCE);
      await instanceIdentifier().fill(`${aur}-2`, ACTION);
      const creates = countActions(page, 'CreateDBInstance');
      const list = await openSelect(instanceClass());
      await list.expectOption(MEMBER_CLASS);
      await list.type('db.nosuch');
      await list.expectSays('No classes match');
      await list.expectNone('db.nosuch.large');
      await list.close();
      await expect(page).toHaveURL(addressOf(addInstancePath(aur)));
      expect(creates.count(), 'requests to create').toBe(0);
      expect(await instanceDirect(ctx, port, `${aur}-2`), 'a DB instance of that identifier, directly').toBeNull();
    },
  );

  await lines.line(
    'S6 → "Delete" is unavailable ("Delete the cluster\'s DB instances first, each from its own page."); a `DeleteDBCluster` made directly is refused by the emulator, which still reports the cluster',
    async () => {
      await open(page, clusterPath(aur), aur);
      await rowOf(members(), ID, first);
      await expectUnavailable(button(main, DELETE), MEMBERS_FIRST, '"Delete" of a cluster with a member');
      const answer = await rds(ctx, port, 'DeleteDBCluster', { DBClusterIdentifier: aur, SkipFinalSnapshot: 'true' });
      expect(answer.status, 'the status of the direct delete').not.toBe(200);
      expect((await clusterDirect(ctx, port, aur))?.status, 'the cluster after the refused delete, directly').toBe(
        'available',
      );
    },
  );

  await lines.line(
    'Choose `<prefix>-aur-1` → S3 of it, whose "DB cluster" leads to S6; on S3 "Delete", type `delete`, "Delete" → S1 with "Deleting <prefix>-aur-1"; the emulator reports no DB instance of that identifier',
    async () => {
      await open(page, clusterPath(aur), aur);
      await rowOf(members(), ID, first);
      await members().getByRole('link', { name: first, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(instancePath(first)));
      await expect(heading(page, first)).toBeVisible({ timeout: 15_000 });
      await valueLocator(main, 'DB cluster').getByRole('link', { name: aur, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(aur)));
      await expect(heading(page, aur)).toBeVisible({ timeout: 15_000 });
      await open(page, instancePath(first), first);
      await expectValueIs(page, 'Status', 'available');
      await button(main, DELETE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(INSTANCES_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Deleting ${first}`);
      expect(await reportsNoInstance(ctx, port, first), 'no DB instance of that identifier, directly').toBe(true);
    },
  );

  await lines.line(
    'S6 of `<prefix>-aur` → "No DB instances"; "Delete" → "Delete DB cluster?" naming it; type `delete`, "Delete" → S4 with "Deleting DB cluster <prefix>-aur" and no row for it; the emulator reports no DB cluster of that identifier and no DB cluster snapshot of it',
    async () => {
      expect(await reportsNoInstance(ctx, port, first), 'the member is gone, directly').toBe(true);
      await open(page, clusterPath(aur), aur);
      await expect(emptyOf(members()), `"${NO_INSTANCES}"`).toContainText(NO_INSTANCES, { timeout: 30_000 });
      await button(main, DELETE).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete DB cluster?');
      await expect(dialog, 'the dialog names the cluster').toContainText(aur);
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(CLUSTERS_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Deleting DB cluster ${aur}`);
      expect(await reportsNoCluster(ctx, port, aur), 'no DB cluster of that identifier, directly').toBe(true);
      // The list is read (H's row is there) and holds no row for the cluster.
      await rowOf(table, CLUSTER_ID, held.id);
      await expectNoRow(table, CLUSTER_ID, aur);
      expect(await clusterSnapshotsOf(ctx, port, aur), 'the DB cluster snapshots of it, directly').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.rds-clusters-made-elsewhere-are-shown', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdscshown');
  const seeded = new RdsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}-sg`);
  const c = (
    await seeded.cluster({
      id: `${p}-c`,
      engine: 'aurora-postgresql',
      masterUsername: 'cadmin',
      password: runPassword(),
      databaseName: 'cdb',
      groupIds: [group],
      tags: { Team: 'checks', Stage: 'local' },
    })
  ).id;
  const member = (id: string) =>
    seeded.instance({ id, engine: 'aurora-postgresql', instanceClass: MEMBER_CLASS, clusterId: c });
  const c1 = await member(`${p}-c-1`);
  const c2 = await member(`${p}-c-2`);
  const q = (await seeded.cluster({ id: `${p}-q`, engine: 'aurora-mysql', protection: true })).id;
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  const members = () => tableOf(main, MEMBERS);

  await lines.line(
    'Open S4 → a row for C with its DB cluster identifier, `available`, the engine with its version, "DB instances" 2, the port and the creation time as the emulator reports them; a row for Q with "DB instances" 0',
    async () => {
      await open(page, CLUSTERS_PATH, CLUSTERS_H1);
      const row = await rowOf(table, CLUSTER_ID, c);
      const reported = (await clusterDirect(ctx, port, c))!;
      expect(reported.members.length, "C's members, directly").toBe(2);
      expect(
        [row[CLUSTER_ID], row.Status, row.Engine, row[MEMBERS], row.Port, row.Created],
        'the row of C',
      ).toEqual([
        c,
        'available',
        engineText(reported.engine, reported.version),
        '2',
        reported.port ?? NONE,
        creationDateText(reported.created ?? null, SEOUL),
      ]);
      expect(reported.status, "C's status, directly").toBe('available');
      expect((await rowOf(table, CLUSTER_ID, q))[MEMBERS], '"DB instances" of Q').toBe('0');
    },
  );

  await lines.line(
    'Choose C\'s identifier → S6: "Connection" shows the writer endpoint, the reader endpoint, the port, the master user name and `cdb`; "DB cluster details" the identifier, `available`, the engine with its version, the ARN, the resource ID, the DB subnet group, G\'s ID, the cluster parameter group and "Deletion protection" "Off"; "DB instances" a row for `<prefix>-c-1` with "Writer" and one for `<prefix>-c-2` with "Reader", each with its status, class and port; "Tags" both tags; each as the emulator reports it',
    async () => {
      await open(page, CLUSTERS_PATH, CLUSTERS_H1);
      await rowOf(table, CLUSTER_ID, c);
      await table.getByRole('link', { name: c, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(c)));
      await expect(heading(page, c)).toBeVisible({ timeout: 15_000 });
      const reported = (await clusterDirect(ctx, port, c))!;
      expect(
        [
          reported.endpoint,
          reported.readerEndpoint,
          reported.port,
          reported.arn,
          reported.resourceId,
          reported.subnetGroup,
          reported.parameterGroup,
        ].filter((each) => each === undefined),
        'values the emulator reports none of',
      ).toEqual([]);
      await expectValueIs(page, 'Writer endpoint', reported.endpoint!);
      await expectValueIs(page, 'Reader endpoint', reported.readerEndpoint!);
      await expectValueIs(page, 'Port', reported.port!);
      expect([reported.masterUsername, reported.databaseName], 'the sign-in values, directly').toEqual([
        'cadmin',
        'cdb',
      ]);
      await expectValueIs(page, 'Master user name', 'cadmin');
      await expectValueIs(page, 'Database name', 'cdb');

      await expectValueIs(page, CLUSTER_ID, c);
      await expectValueIs(page, 'Status', 'available');
      await expectValueIs(page, 'Engine', engineText(reported.engine, reported.version));
      await expectValueIs(page, 'ARN', reported.arn!);
      await expectValueIs(page, 'Resource ID', reported.resourceId!);
      await expectValueIs(page, 'DB subnet group', reported.subnetGroup!);
      expect(reported.groups, 'the security groups, directly').toEqual([group]);
      await expectValueIs(page, 'Security groups', group);
      await expectValueIs(page, 'Cluster parameter group', reported.parameterGroup!);
      await expectValueIs(page, 'Deletion protection', 'Off');

      expect(reported.members, "C's members, directly").toEqual(
        expect.arrayContaining([
          { id: c1, writer: true },
          { id: c2, writer: false },
        ]),
      );
      for (const [id, role] of [
        [c1, 'Writer'],
        [c2, 'Reader'],
      ] as const) {
        const row = await rowOf(members(), ID, id);
        const direct = await instanceDirect(ctx, port, id);
        expect([row.Role, row.Status, row.Class, row.Port], `the row of ${id}`).toEqual([
          role,
          direct?.status,
          direct?.instanceClass,
          direct?.port,
        ]);
      }

      const tags = await rowsOf(tableOf(main, 'Tags'));
      expect(tags, 'the tags').toEqual(
        expect.arrayContaining([
          { Key: 'Team', Value: 'checks' },
          { Key: 'Stage', Value: 'local' },
        ]),
      );
      expect(tags.length, 'the number of tags, as the emulator reports').toBe(Object.keys(reported.tags).length);
    },
  );

  await lines.line(
    'S1 → the row of `<prefix>-c-1` reads "DB cluster" `<prefix>-c`, which leads to S6 of C',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      expect((await rowOf(table, ID, c1))['DB cluster'], '"DB cluster" of the member').toBe(c);
      // The members' rows alone hold a link of the cluster's name.
      await table.getByRole('link', { name: c, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(clusterPath(c)));
      await expect(heading(page, c)).toBeVisible({ timeout: 15_000 });
    },
  );

  await lines.line(
    'S3 of `<prefix>-c-1` → "Start" and "Stop" are unavailable ("An Aurora DB instance starts and stops only with its DB cluster."), "Reboot" available; a `StopDBInstance` of it made directly is refused by the emulator, which still reports it `available`; "Connection" shows each sign-in value from the direct member read when present, otherwise from C with a "From DB cluster <prefix>-c" link to S6 of C',
    async () => {
      await open(page, instancePath(c1), c1);
      await expectValueIs(page, 'Status', 'available');
      await expectUnavailable(button(main, START), AURORA_NOT_BY_ITSELF, '"Start" of an Aurora DB instance');
      await expectUnavailable(button(main, STOP), AURORA_NOT_BY_ITSELF, '"Stop" of an Aurora DB instance');
      await expectAvailable(button(main, REBOOT), '"Reboot"');
      const answer = await rds(ctx, port, 'StopDBInstance', { DBInstanceIdentifier: c1 });
      expect(answer.status, 'the status of the direct StopDBInstance').not.toBe(200);
      expect((await instanceDirect(ctx, port, c1))?.status, 'the member after the refused stop, directly').toBe(
        'available',
      );

      const cluster = (await clusterDirect(ctx, port, c))!;
      const own = (await instanceDirect(ctx, port, c1))!;
      expect([cluster.masterUsername, cluster.databaseName], "C's sign-in values, directly").toEqual([
        'cadmin',
        'cdb',
      ]);
      const from = `From DB cluster ${c}`;
      for (const [label, memberValue, clusterValue] of [
        ['Master user name', own.masterUsername, cluster.masterUsername!],
        ['Database name', own.dbName, cluster.databaseName!],
      ] as const) {
        const shown = valueLocator(main, label);
        await expect(shown.getByText(memberValue ?? clusterValue, { exact: true }), label).toBeVisible({
          timeout: 30_000,
        });
        if (memberValue === undefined) {
          await expect(shown.getByText(from, { exact: true })).toBeVisible();
          const link = shown.getByRole('link', { name: `DB cluster ${c}`, exact: true });
          await expect(link).toHaveAttribute('href', clusterPath(c));
          await link.click(ACTION);
          await expect(page).toHaveURL(addressOf(clusterPath(c)));
          await expect(heading(page, c)).toBeVisible({ timeout: 15_000 });
          await open(page, instancePath(c1), c1);
        } else {
          await expect(shown).not.toContainText('From DB cluster');
          await expect(shown.getByRole('link')).toHaveCount(0);
        }
      }
    },
  );

  await lines.line(
    'A `StopDBCluster` of C made directly → the emulator reports `<prefix>-c-1` `stopped`; a `StartDBCluster` → `available` again (the last line of the check that reads C)',
    async () => {
      const stopped = await rds(ctx, port, 'StopDBCluster', { DBClusterIdentifier: c });
      expect(stopped.status, 'the status of the direct StopDBCluster').toBe(200);
      expect(await reportsStatus(ctx, port, c1, 'stopped'), 'the member is stopped, directly').toBe(true);
      expect(await reportsClusterStatus(ctx, port, c, 'stopped'), 'C is stopped, directly').toBe(true);
      const started = await rds(ctx, port, 'StartDBCluster', { DBClusterIdentifier: c });
      expect(started.status, 'the status of the direct StartDBCluster').toBe(200);
      expect(await reportsStatus(ctx, port, c1, 'available'), 'the member is available again, directly').toBe(true);
    },
  );

  await lines.line(
    'S4, select Q → "Delete" is unavailable ("Deletion protection is on."); a `DeleteDBCluster` of Q made directly is refused by the emulator, which still reports Q',
    async () => {
      await open(page, CLUSTERS_PATH, CLUSTERS_H1);
      await selectRow(table, CLUSTER_ID, q);
      await expectUnavailable(button(main, DELETE), PROTECTION_IS_ON, '"Delete" of a protected DB cluster');
      const answer = await rds(ctx, port, 'DeleteDBCluster', { DBClusterIdentifier: q, SkipFinalSnapshot: 'true' });
      expect(answer.status, 'the status of the direct delete').not.toBe(200);
      expect((await clusterDirect(ctx, port, q))?.status, 'Q after the refused delete, directly').toBe('available');
    },
  );

  await lines.line(
    'S6 of Q → "Deletion protection" "On" with "Changed with ModifyDBCluster."; the protection turned off directly with `ModifyDBCluster`, "Refresh" → "Off"; "Delete", type `delete`, "Delete" → S4 with "Deleting DB cluster <prefix>-q"; the emulator reports no DB cluster of that identifier',
    async () => {
      await open(page, clusterPath(q), q);
      await expectValueParts(page, 'Deletion protection', ['On', CHANGED_WITH_CLUSTER]);
      const modified = await rds(ctx, port, 'ModifyDBCluster', {
        DBClusterIdentifier: q,
        DeletionProtection: 'false',
        ApplyImmediately: 'true',
      });
      expect(modified.status, 'the status of the direct ModifyDBCluster').toBe(200);
      const off = await waitFor(60_000, async () => {
        const found = await clusterDirect(ctx, port, q);
        return found?.protection === false && found.status === 'available' ? true : undefined;
      });
      expect(off, 'the protection is off and Q available, directly').toBe(true);
      await button(main, REFRESH).click(ACTION);
      await expectValueIs(page, 'Deletion protection', 'Off');
      await button(main, DELETE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(CLUSTERS_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Deleting DB cluster ${q}`);
      expect(await reportsNoCluster(ctx, port, q), 'no DB cluster of that identifier, directly').toBe(true);
    },
  );

  await lines.line(
    'Open S6 at an identifier the emulator does not hold → "DB cluster not found" with "View DB clusters", which leads to S4; S7 at that identifier → "DB cluster not found" and no form',
    async () => {
      const missing = `${p}-none`;
      expect(await clusterDirect(ctx, port, missing), 'the emulator holds no such DB cluster').toBeNull();
      await page.goto(clusterPath(missing));
      await expect(main.getByText(CLUSTER_NOT_FOUND, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(main.locator(TABLE), 'sections of a DB cluster').toHaveCount(0);
      await main.getByRole('link', { name: VIEW_CLUSTERS, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(CLUSTERS_PATH));
      await expect(heading(page, CLUSTERS_H1)).toBeVisible();
      await page.goto(addInstancePath(missing));
      await expect(main.getByText(CLUSTER_NOT_FOUND, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(main.locator('form'), 'the form of S7').toHaveCount(0);
    },
  );

  lines.end();
});
