// RDS's DB instances: the list S1, a DB instance's page S3, the create form S2 and the start, stop, reboot and delete
// actions, in the built app in front of a real engine and emulator (test-criteria.md, issue 573: tasks 1, 2 and 3).
//
// `studio.rds-instances-made-elsewhere-are-shown`, `studio.rds-create-a-db-instance-reaches-the-emulator`,
// `studio.rds-stop-start-reboot-delete-a-db-instance`, `studio.rds-screens-follow-an-emulator-restart`.
//
// Each check names its DB instances, DB clusters and security groups under its own prefix `<p>` and removes them when
// it ends (`RdsSeeded`). The emulator's lists hold other checks' resources and have no filter, so a check finds its
// own rows by their identifier, or opens a page by its address. Words, direct calls and readers:
// `services/rds/rds.ts`. No password is logged or put in an assertion's message.

import { expect, startStack, test } from './support';
import { connectedAt, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { openSelect, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { creationDateText, SEOUL } from './support/service-screens';
import { waitFor } from './support/wait';
import {
  ADD_INSTANCE,
  addInstancePath,
  alertWith,
  button,
  CANCEL,
  cancelDialog,
  CHANGED_WITH_INSTANCE,
  chooseInMultiselect,
  chooseOption,
  CLUSTER_NOT_FOUND,
  clusterPath,
  CLUSTERS_H1,
  CLUSTERS_PATH,
  confirmWith,
  countActions,
  CREATE_INSTANCE,
  CREATE_INSTANCE_PATH,
  DELETE,
  dialogOf,
  DISCARD,
  DISCARD_HEADER,
  emptyOf,
  engineText,
  engineVersions,
  errorOf,
  expectAvailable,
  expectCell,
  expectFlash,
  expectNoRow,
  expectUnavailable,
  expectValueIs,
  expectValueParts,
  field,
  IDENTIFIER_BEGINS,
  INSTANCE_NOT_FOUND,
  instanceAnswer,
  instanceDirect,
  instancePath,
  INSTANCES_H1,
  INSTANCES_PATH,
  instancesDirect,
  KEEP_EDITING,
  NO_CLUSTERS,
  NO_INSTANCES,
  NONE,
  ONLY_AVAILABLE_REBOOTS,
  ONLY_AVAILABLE_STOPS,
  ONLY_STOPPED_STARTS,
  open,
  PASSWORD_AT_LEAST,
  PROTECTION_IS_ON,
  radio,
  rds,
  rdsPrefix,
  RdsSeeded,
  REBOOT,
  REFRESH,
  reportsNoInstance,
  reportsStatus,
  rowOf,
  rowsOf,
  runPassword,
  selectRow,
  snapshotsOf,
  START,
  STOP,
  TABLE,
  tableOf,
  valueOf,
  valuePartsOf,
  VIEW_INSTANCES,
} from './services/rds/rds';

// "Created" is written in the zone the check sets on its browser context.
test.use({ timezoneId: SEOUL.timeZone });

const CLASS = 'db.t3.micro';
const ID = 'DB identifier';

// ---------------------------------------------------------------------------------------------------------------

test('studio.rds-instances-made-elsewhere-are-shown', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsshown');
  const seeded = new RdsSeeded(ctx, port, p);
  const password = runPassword();
  const group = await seeded.group(`${p}-sg`);
  const a = await seeded.instance({
    id: `${p}-app`,
    engine: 'postgres',
    instanceClass: CLASS,
    storage: 20,
    masterUsername: 'appadmin',
    password,
    dbName: 'appdb',
    groupIds: [group],
    tags: { Team: 'checks', Stage: 'local' },
  });
  const b = await seeded.instance({ id: `${p}-idle`, engine: 'mysql', instanceClass: CLASS });
  await seeded.stop(b);
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();

  await lines.line(
    'Open S1 → a row for A and one for B, each with its DB identifier, status (`available`, `stopped`), engine with its version, class, port and creation time as the emulator reports them, and "DB cluster" "-"',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      for (const [id, status] of [
        [a, 'available'],
        [b, 'stopped'],
      ] as const) {
        const row = await rowOf(table, ID, id);
        const reported = await instanceDirect(ctx, port, id);
        expect(reported, `the emulator reports ${id}`).not.toBeNull();
        expect(
          [row[ID], row.Status, row.Engine, row.Class, row['DB cluster'], row.Port, row.Created],
          `the row of ${id}`,
        ).toEqual([
          id,
          reported!.status,
          engineText(reported!.engine, reported!.version),
          reported!.instanceClass,
          NONE,
          reported!.port ?? NONE,
          creationDateText(reported!.created ?? null, SEOUL),
        ]);
        expect(row.Status, `the status of ${id}`).toBe(status);
      }
    },
  );

  await lines.line(
    'Choose A\'s DB identifier → S3 at the address that holds the identifier: "Connection" shows the endpoint address, the port, the master user name and `appdb`; "DB instance details" the identifier, `available`, the engine with its version, the class, "20 GiB", the storage type, "DB cluster" "-", the Availability Zone, the ARN, the resource ID, the parameter group and "Deletion protection" "Off"; "Network" the DB subnet group `default`, its VPC ID, its subnets\' IDs, and G\'s ID with its status; "Tags" both tags; each as the emulator reports it',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await rowOf(table, ID, a);
      await table.getByRole('link', { name: a, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(instancePath(a)));
      await expect(heading(page, a)).toBeVisible({ timeout: 15_000 });
      const reported = (await instanceDirect(ctx, port, a))!;
      expect(
        [reported.address, reported.port, reported.zone, reported.arn, reported.resourceId, reported.vpcId].filter(
          (each) => each === undefined,
        ),
        'values the emulator reports none of',
      ).toEqual([]);
      await expectValueIs(page, 'Endpoint address', reported.address!);
      await expectValueIs(page, 'Port', reported.port!);
      expect(reported.masterUsername, 'the master user name, directly').toBe('appadmin');
      await expectValueIs(page, 'Master user name', 'appadmin');
      expect(reported.dbName, 'the database name, directly').toBe('appdb');
      await expectValueIs(page, 'Database name', 'appdb');

      await expectValueIs(page, ID, a);
      await expectValueIs(page, 'Status', 'available');
      await expectValueIs(page, 'Engine', engineText(reported.engine, reported.version));
      await expectValueIs(page, 'Class', reported.instanceClass);
      expect(reported.storage, 'the storage, directly').toBe('20');
      await expectValueIs(page, 'Allocated storage', '20 GiB');
      await expectValueIs(page, 'Storage type', reported.storageType ?? NONE);
      await expectValueIs(page, 'DB cluster', NONE);
      await expectValueIs(page, 'Availability Zone', reported.zone!);
      await expectValueIs(page, 'ARN', reported.arn!);
      await expectValueIs(page, 'Resource ID', reported.resourceId!);
      expect(reported.parameterGroups.length, 'the parameter groups the emulator reports').toBeGreaterThan(0);
      await expectValueParts(page, 'Parameter group', reported.parameterGroups);
      await expectValueIs(page, 'Deletion protection', 'Off');

      expect(reported.subnetGroup, 'the DB subnet group, directly').toBe('default');
      await expectValueIs(page, 'DB subnet group', 'default');
      await expectValueIs(page, 'VPC ID', reported.vpcId!);
      expect(reported.subnets.length, 'the subnets the emulator reports').toBeGreaterThan(0);
      await expectValueParts(page, 'Subnets', reported.subnets);
      expect(
        reported.groups.map((each) => each.id),
        'the security groups, directly',
      ).toEqual([group]);
      await expectValueParts(
        page,
        'Security groups',
        reported.groups.flatMap((each) => [each.id, ...(each.status === undefined ? [] : [each.status])]),
      );

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
    "The emulator's answer for A (`DescribeDBInstances`) holds the master user name and nowhere the password the check gave; S3 of A shows that password nowhere",
    async () => {
      const answer = await instanceAnswer(ctx, port, a);
      expect(answer?.instance.masterUsername, 'the master user name in the answer').toBe('appadmin');
      expect(answer!.body.includes(password), 'the answer holds the password').toBe(false);
      await open(page, instancePath(a), a);
      await expectValueIs(page, 'Master user name', 'appadmin');
      expect((await page.content()).includes(password), 'the page holds the password').toBe(false);
    },
  );

  await lines.line(
    'S3 of B → `stopped`; "Master user name" "-", "Database name" "-", "Allocated storage" "-"',
    async () => {
      await open(page, instancePath(b), b);
      await expectValueIs(page, 'Status', 'stopped');
      await expectValueIs(page, 'Master user name', NONE);
      await expectValueIs(page, 'Database name', NONE);
      await expectValueIs(page, 'Allocated storage', NONE);
    },
  );

  await lines.line(
    'Open S3 at an identifier the emulator does not hold → "DB instance not found" with "View DB instances", which leads to S1',
    async () => {
      const missing = `${p}-none`;
      expect(await instanceDirect(ctx, port, missing), 'the emulator holds no such DB instance').toBeNull();
      await page.goto(instancePath(missing));
      await expect(main.getByText(INSTANCE_NOT_FOUND, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(main.locator(TABLE), 'sections of a DB instance').toHaveCount(0);
      await main.getByRole('link', { name: VIEW_INSTANCES, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(INSTANCES_PATH));
      await expect(heading(page, INSTANCES_H1)).toBeVisible();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.rds-create-a-db-instance-reaches-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsmake');
  const seeded = new RdsSeeded(ctx, port, p);
  const password = runPassword();
  const group = await seeded.group(`${p}-sg`);
  const x = await seeded.instance({ id: `${p}-held`, engine: 'postgres', instanceClass: CLASS });
  const held = (await instanceDirect(ctx, port, x))!;
  const main = page.getByRole('main');
  const identifier = () => field(main, 'DB instance identifier').getByRole('textbox');
  const instanceClass = () => field(main, 'DB instance class');
  const storage = () => field(main, 'Allocated storage (GiB)').getByRole('textbox');
  const user = () => field(main, 'Master user name').getByRole('textbox');
  // A password field has no role of a text box.
  const secret = () => field(main, 'Master password').locator('input:not([type="checkbox"])');
  const database = () => field(main, 'Database name - optional').getByRole('textbox');
  const version = () => field(main, 'Engine version - optional');
  const subnetGroup = () => field(main, 'DB subnet group - optional');
  const groups = () => field(main, 'Security groups - optional');
  const submit = () => button(main, CREATE_INSTANCE);
  /**
   * "Create DB instance" once the form has settled: the form sends nothing while the emulator's classes for the
   * engine and version are being read, and the class field can be opened once they are.
   */
  const send = async () => {
    await expect(triggerOf(instanceClass()), 'the classes are read').toBeEnabled({ timeout: 20_000 });
    await submit().click(ACTION);
  };
  /** S2 with the identifier, a master user name and a password entered. */
  const formWith = async (id: string, userName: string) => {
    await open(page, CREATE_INSTANCE_PATH, CREATE_INSTANCE);
    await identifier().fill(id, ACTION);
    await user().fill(userName, ACTION);
    await secret().fill(password, ACTION);
  };
  /** What the emulator answers a `CreateDBInstance` it refuses (nothing is made). */
  const refusal = async (params: Record<string, string>) => {
    const answer = await rds(ctx, port, 'CreateDBInstance', {
      Engine: 'postgres',
      DBInstanceClass: CLASS,
      ...params,
    });
    expect(answer.status, 'the status of the refused create, directly').not.toBe(200);
    return answer;
  };
  let chosen = '';

  await lines.line(
    'S1, "Create DB instance" → S2; the identifier `<prefix>-WEB` (upper case in it), "PostgreSQL" as it stands, a version of the emulator\'s list for `postgres` chosen, the class `db.t3.micro` as the choice stands and the storage as it stands, a master user name, a password, the database name `webdb`, the DB subnet group `default` chosen, G chosen by typing its name; "Create DB instance" → S3 at `<prefix>-web` with "Creating DB instance <prefix>-web"; S3 reads `available` without a refresh (changed, issue 651)',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await main.getByRole('link', { name: CREATE_INSTANCE, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_INSTANCE_PATH));
      await expect(heading(page, CREATE_INSTANCE)).toBeVisible();
      await identifier().fill(`${p}-WEB`, ACTION);
      await expect(radio(main, 'postgres'), '"PostgreSQL" as it stands').toBeChecked();
      const versions = await engineVersions(ctx, port, 'postgres');
      // Another version than the one the emulator gives by itself, when its list has one.
      chosen = versions.find((each) => each !== held.version) ?? versions[0]!;
      await chooseOption(version(), chosen);
      await expect(triggerOf(instanceClass()), 'the class as the choice stands').toContainText(CLASS);
      await expect(storage(), 'the storage as it stands').toHaveValue('20');
      await user().fill('webadmin', ACTION);
      await secret().fill(password, ACTION);
      await database().fill('webdb', ACTION);
      await chooseOption(subnetGroup(), 'default');
      await chooseInMultiselect(groups(), group, `${p}-sg`);
      await send();
      await expect(page).toHaveURL(addressOf(instancePath(`${p}-web`)), { timeout: 30_000 });
      await expectFlash(page, 'success', `Creating DB instance ${p}-web`);
      await expectValueIs(page, 'Status', 'available');
    },
  );

  await lines.line(
    'The emulator reports the DB instance `<prefix>-web`, in lower case, with `postgres`, that version, `db.t3.micro`, 20 GiB, the master user name, `webdb`, the DB subnet group `default` and the group G; the address of S3 holds no password',
    async () => {
      expect(chosen, 'the version of the first line').not.toBe('');
      const named = (await instancesDirect(ctx, port)).filter((each) => each.id.toLowerCase() === `${p}-web`);
      expect(
        named.map((each) => each.id),
        'the DB instances of that identifier in either case, directly',
      ).toEqual([`${p}-web`]);
      const reported = named[0]!;
      expect(
        [
          reported.engine,
          reported.version,
          reported.instanceClass,
          reported.storage,
          reported.masterUsername,
          reported.dbName,
          reported.subnetGroup,
          reported.groups.map((each) => each.id),
        ],
        'the DB instance, directly',
      ).toEqual(['postgres', chosen, CLASS, '20', 'webadmin', 'webdb', 'default', [group]]);
      expect(page.url().includes(password), 'the address holds the password').toBe(false);
    },
  );

  await lines.line(
    'S2, the identifier `<prefix>-bare`, "MySQL", a master user name and a password, everything else as it stands → S3; the emulator reports the instance with `mysql`, a version of the emulator\'s list for `mysql` that S3 shows too, and the DB subnet group `default`',
    async () => {
      await formWith(`${p}-bare`, 'bareadmin');
      await radio(main, 'mysql').click(ACTION);
      await expect(radio(main, 'mysql'), '"MySQL" chosen').toBeChecked();
      await send();
      await expect(page).toHaveURL(addressOf(instancePath(`${p}-bare`)), { timeout: 30_000 });
      await expectValueIs(page, 'Status', 'available');
      const reported = await instanceDirect(ctx, port, `${p}-bare`);
      expect([reported?.engine, reported?.subnetGroup], 'the DB instance, directly').toEqual(['mysql', 'default']);
      expect(await engineVersions(ctx, port, 'mysql'), "the emulator's versions of mysql").toContain(reported!.version);
      await expectValueIs(page, 'Engine', `mysql ${reported!.version!}`);
    },
  );

  await lines.line(
    "S2, the identifier `<prefix>-held` with the required fields → the form stays with the emulator's `DBInstanceAlreadyExists` and its message, every entry as it was; the emulator still reports X as it was made",
    async () => {
      const direct = await refusal({ DBInstanceIdentifier: x });
      expect(direct.code, "the emulator's code, directly").toBe('DBInstanceAlreadyExists');
      await formWith(x, 'heldadmin');
      await send();
      await expect(alertWith(main, 'DBInstanceAlreadyExists'), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(alertWith(main, direct.message!), "the emulator's message").toBeVisible();
      await expect(page).toHaveURL(addressOf(CREATE_INSTANCE_PATH));
      await expect(identifier(), 'the identifier as typed').toHaveValue(x);
      await expect(user(), 'the master user name as typed').toHaveValue('heldadmin');
      expect((await secret().inputValue()) === password, 'the password is as typed').toBe(true);
      await expect(triggerOf(instanceClass()), 'the class as it stood').toContainText(CLASS);
      await expect(storage(), 'the storage as it stood').toHaveValue('20');
      expect(await instanceDirect(ctx, port, x), 'X, directly').toEqual(held);
    },
  );

  await lines.line(
    'S2, the identifier `<p>-cls`, `db.nosuch` typed in "DB instance class" → "No classes match" and no option of the value `db.nosuch.large`; nothing is sent; the emulator reports no DB instance `<p>-cls` (changed, issue 651)',
    async () => {
      await formWith(`${p}-cls`, 'clsadmin');
      const creates = countActions(page, 'CreateDBInstance');
      const list = await openSelect(instanceClass());
      await list.expectOption(CLASS);
      await list.type('db.nosuch');
      await list.expectSays('No classes match');
      await list.expectNone('db.nosuch.large');
      await list.close();
      await expect(page).toHaveURL(addressOf(CREATE_INSTANCE_PATH));
      expect(creates.count(), 'requests to create').toBe(0);
      expect(await instanceDirect(ctx, port, `${p}-cls`), 'a DB instance of that identifier, directly').toBeNull();
    },
  );

  await lines.line(
    'S2, the identifier `1<prefix>` → "An identifier begins with a letter." at the field; a password of 7 characters → "A master password has at least 8 characters." at the field; no request to create left the page',
    async () => {
      await open(page, CREATE_INSTANCE_PATH, CREATE_INSTANCE);
      const creates = countActions(page, 'CreateDBInstance');
      await identifier().fill(`1${p}`, ACTION);
      await user().fill('badadmin', ACTION);
      await secret().fill('Abc1234', ACTION);
      await send();
      await expect(errorOf(field(main, 'DB instance identifier')), `"${IDENTIFIER_BEGINS}"`).toHaveText(
        IDENTIFIER_BEGINS,
      );
      await expect(errorOf(field(main, 'Master password')), `"${PASSWORD_AT_LEAST}"`).toHaveText(PASSWORD_AT_LEAST);
      await expect(page).toHaveURL(addressOf(CREATE_INSTANCE_PATH));
      expect(creates.count(), 'requests to create').toBe(0);
      expect(await instanceDirect(ctx, port, `1${p}`), 'a DB instance of that identifier, directly').toBeNull();
    },
  );

  await lines.line(
    '"Cancel" → "Discard what you entered?"; "Keep editing" keeps the form; "Cancel", "Discard" → S1',
    async () => {
      await open(page, CREATE_INSTANCE_PATH, CREATE_INSTANCE);
      await identifier().fill(`${p}-never`, ACTION);
      await button(main, CANCEL).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the discard dialog').toContainText(DISCARD_HEADER);
      await button(dialog, KEEP_EDITING).click(ACTION);
      await expect(dialog, 'the dialog after "Keep editing"').toHaveCount(0);
      await expect(identifier(), 'the identifier as typed').toHaveValue(`${p}-never`);
      await button(main, CANCEL).click(ACTION);
      await button(dialogOf(page), DISCARD).click(ACTION);
      await expect(page).toHaveURL(addressOf(INSTANCES_PATH));
      expect(await instanceDirect(ctx, port, `${p}-never`), 'a DB instance of that identifier, directly').toBeNull();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.rds-stop-start-reboot-delete-a-db-instance', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsstate');
  const seeded = new RdsSeeded(ctx, port, p);
  const a = await seeded.instance({ id: `${p}-a`, engine: 'postgres', instanceClass: CLASS });
  const prot = await seeded.instance({ id: `${p}-p`, engine: 'postgres', instanceClass: CLASS, protection: true });
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  /** S1 with A's row selected. */
  const selectA = async () => {
    await open(page, INSTANCES_PATH, INSTANCES_H1);
    await selectRow(table, ID, a);
  };

  await lines.line(
    'S1, no row selected → "Start", "Stop", "Reboot" and "Delete" are unavailable; select A → "Start" is unavailable ("Only a stopped DB instance can be started."), the other three available',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await rowOf(table, ID, a);
      for (const action of [START, STOP, REBOOT, DELETE]) {
        await expectUnavailable(button(main, action), null, `"${action}" with no row selected`);
      }
      await selectRow(table, ID, a);
      await expectUnavailable(button(main, START), ONLY_STOPPED_STARTS, '"Start" of an available DB instance');
      for (const action of [STOP, REBOOT, DELETE]) await expectAvailable(button(main, action), `"${action}"`);
    },
  );

  await lines.line(
    '"Stop" → "Stopping <prefix>-a"; the row reads `stopped` without a refresh; the emulator reports `stopped`',
    async () => {
      await selectA();
      await button(main, STOP).click(ACTION);
      await expectFlash(page, 'success', `Stopping ${a}`);
      await expectCell(table, ID, a, 'Status', 'stopped');
      expect(await reportsStatus(ctx, port, a, 'stopped'), 'stopped, directly').toBe(true);
    },
  );

  await lines.line(
    'A selected and `stopped` → "Stop" and "Reboot" unavailable with their reasons; "Start" → "Starting <prefix>-a", the row reads `available` without a refresh; the emulator reports `available`',
    async () => {
      expect(await reportsStatus(ctx, port, a, 'stopped'), 'A is stopped, directly').toBe(true);
      await selectA();
      await expectCell(table, ID, a, 'Status', 'stopped');
      await expectUnavailable(button(main, STOP), ONLY_AVAILABLE_STOPS, '"Stop" of a stopped DB instance');
      await expectUnavailable(button(main, REBOOT), ONLY_AVAILABLE_REBOOTS, '"Reboot" of a stopped DB instance');
      await button(main, START).click(ACTION);
      await expectFlash(page, 'success', `Starting ${a}`);
      await expectCell(table, ID, a, 'Status', 'available');
      expect(await reportsStatus(ctx, port, a, 'available'), 'available, directly').toBe(true);
    },
  );

  await lines.line(
    '"Reboot" → "Rebooting <prefix>-a"; the row reads `available` again and the emulator reports `available`',
    async () => {
      expect(await reportsStatus(ctx, port, a, 'available'), 'A is available, directly').toBe(true);
      await selectA();
      await expectCell(table, ID, a, 'Status', 'available');
      await button(main, REBOOT).click(ACTION);
      await expectFlash(page, 'success', `Rebooting ${a}`);
      expect(await reportsStatus(ctx, port, a, 'available'), 'available, directly').toBe(true);
      await expectCell(table, ID, a, 'Status', 'available');
    },
  );

  await lines.line(
    'S3 of A, "Delete" → "Delete DB instance?" naming A; "Cancel" → the emulator still reports A',
    async () => {
      expect(await reportsStatus(ctx, port, a, 'available'), 'A is available, directly').toBe(true);
      await open(page, instancePath(a), a);
      await expectValueIs(page, 'Status', 'available');
      await button(main, DELETE).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete DB instance?');
      await expect(dialog, 'the dialog names A').toContainText(a);
      await cancelDialog(page);
      expect((await instanceDirect(ctx, port, a))?.status, 'A after "Cancel", directly').toBe('available');
    },
  );

  await lines.line(
    '"Delete", type `delete`, "Delete" → S1 with "Deleting <prefix>-a" and no row for A; the emulator reports no DB instance of that identifier and no DB snapshot of it',
    async () => {
      await open(page, instancePath(a), a);
      await expectValueIs(page, 'Status', 'available');
      await button(main, DELETE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(INSTANCES_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Deleting ${a}`);
      expect(await reportsNoInstance(ctx, port, a), 'no DB instance of that identifier, directly').toBe(true);
      // The list is read (P's row is there) and holds no row for A.
      await rowOf(table, ID, prot);
      await expectNoRow(table, ID, a);
      expect(await snapshotsOf(ctx, port, a), 'the DB snapshots of A, directly').toEqual([]);
    },
  );

  await lines.line(
    'S1, select P → "Delete" is unavailable ("Deletion protection is on."); a `DeleteDBInstance` of P made directly is refused by the emulator, which still reports P',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await selectRow(table, ID, prot);
      await expectUnavailable(button(main, DELETE), PROTECTION_IS_ON, '"Delete" of a protected DB instance');
      const answer = await rds(ctx, port, 'DeleteDBInstance', {
        DBInstanceIdentifier: prot,
        SkipFinalSnapshot: 'true',
      });
      expect(answer.status, 'the status of the direct delete').not.toBe(200);
      expect((await instanceDirect(ctx, port, prot))?.status, 'P after the refused delete, directly').toBe(
        'available',
      );
    },
  );

  await lines.line(
    'S3 of P → "Deletion protection" "On" with "Changed with ModifyDBInstance."; the protection turned off directly with `ModifyDBInstance`, "Refresh" → "Off"; "Delete", type `delete`, "Delete" → S1 with "Deleting <prefix>-p"; the emulator reports no DB instance of that identifier',
    async () => {
      await open(page, instancePath(prot), prot);
      await expectValueParts(page, 'Deletion protection', ['On', CHANGED_WITH_INSTANCE]);
      const modified = await rds(ctx, port, 'ModifyDBInstance', {
        DBInstanceIdentifier: prot,
        DeletionProtection: 'false',
        ApplyImmediately: 'true',
      });
      expect(modified.status, 'the status of the direct ModifyDBInstance').toBe(200);
      const off = await waitFor(60_000, async () => {
        const found = await instanceDirect(ctx, port, prot);
        return found?.protection === false && found.status === 'available' ? true : undefined;
      });
      expect(off, 'the protection is off and P available, directly').toBe(true);
      await button(main, REFRESH).click(ACTION);
      await expectValueIs(page, 'Deletion protection', 'Off');
      await button(main, DELETE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expect(page).toHaveURL(addressOf(INSTANCES_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Deleting ${prot}`);
      expect(await reportsNoInstance(ctx, port, prot), 'no DB instance of that identifier, directly').toBe(true);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.rds-screens-follow-an-emulator-restart', async ({ ctx, page, context }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = rdsPrefix(ctx, 'rdsrestart');
  const seeded = new RdsSeeded(ctx, port, p);
  const instance = await seeded.instance({ id: `${p}-kept`, engine: 'postgres', instanceClass: CLASS });
  const cluster = (await seeded.cluster({ id: `${p}-c`, engine: 'aurora-postgresql' })).id;
  const member = await seeded.instance({
    id: `${p}-c-1`,
    engine: 'aurora-postgresql',
    instanceClass: 'db.r6g.large',
    clusterId: cluster,
  });

  // The five screens, each in a page of its own, read before the restart.
  const s1 = page;
  await open(s1, INSTANCES_PATH, INSTANCES_H1);
  await rowOf(s1.getByRole('main').locator(TABLE).first(), ID, instance);
  const s3 = await context.newPage();
  await open(s3, instancePath(instance), instance);
  await expectValueIs(s3, ID, instance);
  const s4 = await context.newPage();
  await open(s4, CLUSTERS_PATH, CLUSTERS_H1);
  await rowOf(s4.getByRole('main').locator(TABLE).first(), 'DB cluster identifier', cluster);
  const s6 = await context.newPage();
  await open(s6, clusterPath(cluster), cluster);
  await rowOf(tableOf(s6.getByRole('main'), 'DB instances'), ID, member);
  const s7 = await context.newPage();
  await open(s7, addInstancePath(cluster), ADD_INSTANCE);
  await expect(s7.getByRole('main').locator('form'), 'the form of S7 before the restart').toHaveCount(1);
  const pages = [s1, s3, s4, s6, s7];

  await lines.line(
    'S1, S3 of the instance, S4, S6 and S7 of the cluster each open in a page of its own; the emulator is restarted → once the emulator line reads "Connected" again: S1 shows "No DB instances"; S3 "DB instance not found"; S4 "No DB clusters"; S6 and S7 "DB cluster not found"; none with a row or a value of before',
    async () => {
      await emulator.stop();
      // Each page reads again by itself once it is connected again.
      for (const each of pages) {
        await each.bringToFront();
        await expectLine(each, notStartedOn(port));
      }
      await emulator.startAgain();
      for (const each of pages) {
        await each.bringToFront();
        await expectLine(each, connectedAt(port), 60_000);
      }
      expect(await instancesDirect(ctx, port), 'the DB instances after the restart, directly').toEqual([]);

      await s1.bringToFront();
      const t1 = s1.getByRole('main').locator(TABLE).first();
      await expect(emptyOf(t1), `"${NO_INSTANCES}" on S1`).toContainText(NO_INSTANCES, { timeout: 60_000 });
      expect(await rowsOf(t1), 'rows on S1').toEqual([]);
      await expect(s1.getByRole('main'), 'the DB instance of before on S1').not.toContainText(instance);

      await s3.bringToFront();
      const m3 = s3.getByRole('main');
      await expect(m3.getByText(INSTANCE_NOT_FOUND, { exact: true }), `"${INSTANCE_NOT_FOUND}" on S3`).toBeVisible({
        timeout: 60_000,
      });
      expect(await valueOf(m3, ID), 'a value of before on S3').toBeNull();
      expect(await valuePartsOf(m3, 'Parameter group'), 'a value of before on S3').toEqual([]);

      await s4.bringToFront();
      const t4 = s4.getByRole('main').locator(TABLE).first();
      await expect(emptyOf(t4), `"${NO_CLUSTERS}" on S4`).toContainText(NO_CLUSTERS, { timeout: 60_000 });
      expect(await rowsOf(t4), 'rows on S4').toEqual([]);
      await expect(s4.getByRole('main'), 'the DB cluster of before on S4').not.toContainText(cluster);

      await s6.bringToFront();
      const m6 = s6.getByRole('main');
      await expect(m6.getByText(CLUSTER_NOT_FOUND, { exact: true }), `"${CLUSTER_NOT_FOUND}" on S6`).toBeVisible({
        timeout: 60_000,
      });
      await expect(m6.locator(TABLE), 'sections on S6').toHaveCount(0);
      await expect(m6, 'the member of before on S6').not.toContainText(member);

      await s7.bringToFront();
      const m7 = s7.getByRole('main');
      await expect(m7.getByText(CLUSTER_NOT_FOUND, { exact: true }), `"${CLUSTER_NOT_FOUND}" on S7`).toBeVisible({
        timeout: 60_000,
      });
      await expect(m7.locator('form'), 'the form on S7').toHaveCount(0);
    },
  );

  lines.end();
});
