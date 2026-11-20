// EC2's instances: the list S1, an instance's page S3, the launch form S2 and the start, stop, reboot and terminate
// actions, in the built app in front of a real engine and emulator (test-criteria.md, issue 553: tasks 1, 2 and 3).
//
// `studio.ec2-instances-made-elsewhere-are-shown`, `studio.ec2-launch-an-instance-reaches-the-emulator`,
// `studio.ec2-stop-start-reboot-terminate-an-instance`, `studio.ec2-screens-follow-an-emulator-restart`.
//
// Each check names its instances (by the tag `Name`), groups and key pairs with its own prefix `<p>` and removes them
// when it ends (`Ec2Seeded`). The emulator's lists hold other checks' resources, so a check finds its own by the
// list's name filter, or opens a page by its address. Words, direct calls and readers: `services/ec2/ec2.ts`.

import { expect, startStack, test } from './support';
import { connectedAt, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alertWith,
  ALREADY_TERMINATED,
  button,
  CANCEL,
  cancelDialog,
  CHOOSE_IMAGE,
  chooseAction,
  chooseInMultiselect,
  chooseOption,
  CLEAR_FILTERS,
  closeActions,
  confirmWith,
  countActions,
  dialogOf,
  DISCARD,
  DISCARD_HEADER,
  Ec2Seeded,
  emptyOf,
  errorOf,
  expectActionAvailable,
  expectActionUnavailable,
  expectCell,
  expectFlash,
  expectRows,
  expectValue,
  expectValueIs,
  field,
  findBy,
  GROUP_NOT_FOUND,
  groupDirect,
  groupPath,
  GROUPS_H1,
  GROUPS_PATH,
  INSTANCE_NOT_FOUND,
  instanceDirect,
  instancePath,
  INSTANCES_H1,
  INSTANCES_PATH,
  instancesNamed,
  KEEP_EDITING,
  KEY_PAIRS_H1,
  KEY_PAIRS_PATH,
  LAUNCH,
  LAUNCH_PATH,
  multiselectOf,
  NO_GROUPS_MATCH,
  NO_INSTANCES,
  NO_INSTANCES_MATCH,
  NO_KEY_PAIRS,
  ONLY_RUNNING_REBOOTS,
  ONLY_RUNNING_STOPS,
  ONLY_STOPPED_STARTS,
  open,
  REFRESH,
  reportsState,
  rowsOf,
  selectOf,
  selectRow,
  TABLE,
  tableOf,
  TERMINATE,
  typeInMultiselect,
  VIEW_INSTANCES,
  world,
} from './services/ec2/ec2';

const NONE = '-';

// ---------------------------------------------------------------------------------------------------------------

test('studio.ec2-instances-made-elsewhere-are-shown', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2shown');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const key = await seeded.keyPair(`${p}-key`);
  const groupName = `${p}-sg`;
  const group = await seeded.group(groupName, `Shown ${p}`);
  const a = await seeded.instance({
    name: `${p}-App`,
    tags: { Team: 'checks' },
    keyName: key,
    groupIds: [group],
    subnetId: w.subnet['us-east-1b']!,
  });
  const b = await seeded.instance({ name: `${p}-idle` });
  await seeded.stop(b);
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();

  await lines.line(
    'Open S1, type `<prefix>` in "Name" → a row for A and one for B, each with its name, instance ID, state (`running`, `stopped`), type, Availability Zone, private IPv4 and, for A, public IPv4 as the emulator reports them; B\'s public IPv4 reads "-"',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await findBy(table, p);
      const rows = await expectRows(table, 'Instance ID', [a, b], 'the rows of A and B');
      for (const id of [a, b]) {
        const reported = await instanceDirect(ctx, port, id);
        expect(reported, `the emulator reports ${id}`).not.toBeNull();
        const row = rows.find((each) => each['Instance ID'] === id);
        expect(
          [
            row?.Name,
            row?.State,
            row?.Type,
            row?.['Availability Zone'],
            row?.['Private IPv4'],
            row?.['Public IPv4'],
          ],
          `the row of ${id}`,
        ).toEqual([
          reported!.tags.Name,
          reported!.state,
          reported!.type,
          reported!.zone,
          reported!.privateIp ?? NONE,
          reported!.publicIp ?? NONE,
        ]);
      }
      expect(rows.find((each) => each['Instance ID'] === a)?.State, "A's state").toBe('running');
      const rowB = rows.find((each) => each['Instance ID'] === b);
      expect([rowB?.State, rowB?.['Public IPv4']], "B's state and public IPv4").toEqual(['stopped', NONE]);
    },
  );

  await lines.line(
    '"Name" `<prefix>-App` → A\'s row alone; `<PREFIX>-APP` in the other letter case → "No instances match"; "Clear filters" → the filters are empty and rows are shown again',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await findBy(table, `${p}-App`);
      await expectRows(table, 'Instance ID', [a], "A's row alone");
      await findBy(table, `${p}-App`.toUpperCase());
      await expect(emptyOf(table), `"${NO_INSTANCES_MATCH}"`).toContainText(NO_INSTANCES_MATCH, { timeout: 20_000 });
      await button(emptyOf(table), CLEAR_FILTERS).click(ACTION);
      await expect(page.getByRole('searchbox', { name: 'Name' }).or(table.getByPlaceholder('Find by name')).first()).toHaveValue('');
      await expect
        .poll(async () => (await rowsOf(table)).length, { message: 'rows after "Clear filters"', timeout: 20_000 })
        .toBeGreaterThan(0);
    },
  );

  await lines.line('"State" `stopped` with "Name" `<prefix>` → B\'s row alone', async () => {
    await open(page, INSTANCES_PATH, INSTANCES_H1);
    await findBy(table, p);
    await expectRows(table, 'Instance ID', [a, b], 'both rows before the state is chosen');
    await chooseOption(table, 'stopped');
    await expectRows(table, 'Instance ID', [b], "B's row alone");
  });

  await lines.line(
    'Choose A\'s instance ID → S3 at the address that holds the ID: "Instance details", "Network", "Security groups", "Volumes" and "Tags" each as the emulator reports it; "Termination protection" "Off"',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await findBy(table, `${p}-App`);
      await expectRows(table, 'Instance ID', [a], "A's row");
      await table.getByRole('link', { name: a, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(instancePath(a)));
      await expect(heading(page, `${p}-App`)).toBeVisible({ timeout: 15_000 });
      const reported = (await instanceDirect(ctx, port, a))!;
      await expectValueIs(page, 'Instance ID', a);
      await expectValue(page, 'State', 'running');
      await expectValueIs(page, 'Type', reported.type);
      await expectValueIs(page, 'Image ID', reported.imageId);
      await expectValueIs(page, 'Key pair', key);
      await expectValueIs(page, 'Architecture', reported.architecture ?? NONE);
      await expectValueIs(page, 'Termination protection', 'Off');
      await expectValueIs(page, 'Availability Zone', 'us-east-1b');
      await expectValueIs(page, 'Subnet ID', w.subnet['us-east-1b']!);
      await expectValueIs(page, 'VPC ID', w.defaultVpc);
      await expectValueIs(page, 'Private IPv4', reported.privateIp ?? NONE);
      await expectValueIs(page, 'Public IPv4', reported.publicIp ?? NONE);
      await expectValueIs(page, 'Private DNS name', reported.privateDns ?? NONE);
      await expectValueIs(page, 'Public DNS name', reported.publicDns ?? NONE);
      expect(await rowsOf(tableOf(main, 'Security groups')), 'the groups').toEqual([
        { Name: groupName, 'Group ID': group },
      ]);
      expect(reported.volumes.length, 'the volumes the emulator reports').toBeGreaterThan(0);
      expect(await rowsOf(tableOf(main, 'Volumes')), 'the volumes').toEqual(
        reported.volumes.map((v) => ({
          Device: v.device,
          'Volume ID': v.volumeId,
          'Deleted on termination': v.deleteOnTermination === 'true' ? 'Yes' : 'No',
        })),
      );
      const tags = await rowsOf(tableOf(main, 'Tags'));
      expect(tags, 'the tags').toEqual(
        expect.arrayContaining([
          { Key: 'Name', Value: `${p}-App` },
          { Key: 'Team', Value: 'checks' },
        ]),
      );
      expect(tags.length, 'the number of tags, as the emulator reports').toBe(Object.keys(reported.tags).length);
    },
  );

  await lines.line("Choose the group's name → S6 of that group", async () => {
    await open(page, instancePath(a), `${p}-App`);
    await tableOf(main, 'Security groups').getByRole('link', { name: groupName, exact: true }).click(ACTION);
    await expect(page).toHaveURL(addressOf(groupPath(group)));
    await expect(heading(page, groupName)).toBeVisible({ timeout: 15_000 });
  });

  await lines.line('S3 of B → `stopped` with the emulator\'s reason, "Public IPv4" "-"', async () => {
    await open(page, instancePath(b), `${p}-idle`);
    const reported = (await instanceDirect(ctx, port, b))!;
    expect(reported.stateReason, "the emulator's reason").toBeDefined();
    await expectValue(page, 'State', 'stopped');
    await expectValue(page, 'State', reported.stateReason!);
    await expectValueIs(page, 'Public IPv4', NONE);
  });

  await lines.line(
    'Open S3 at a well-formed ID the emulator does not hold → "Instance not found" with "View instances", which leads to S1',
    async () => {
      const missing = 'i-0123456789abcdef0';
      expect(await instanceDirect(ctx, port, missing), 'the emulator holds no such instance').toBeNull();
      await page.goto(instancePath(missing));
      await expect(main.getByText(INSTANCE_NOT_FOUND, { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(main.locator(TABLE), 'sections of an instance').toHaveCount(0);
      await main.getByRole('link', { name: VIEW_INSTANCES, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(INSTANCES_PATH));
      await expect(heading(page, INSTANCES_H1)).toBeVisible();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.ec2-launch-an-instance-reaches-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2launch');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const key = await seeded.keyPair(`${p}-key`);
  const g = await seeded.group(`${p}-g`, `G ${p}`);
  const other = await seeded.vpcWithSubnet('10.77.0.0/16', '10.77.1.0/24', 'us-east-1a');
  const h = await seeded.group(`${p}-h`, `H ${p}`, other.vpcId);
  const main = page.getByRole('main');
  const name = () => field(main, 'Name - optional').getByRole('textbox');
  const image = () => field(main, 'Image');
  const type = () => field(main, 'Instance type');
  const keyPair = () => field(main, 'Key pair - optional');
  const subnet = () => field(main, 'Subnet - optional');
  const groups = () => field(main, 'Security groups - optional');
  const submit = () => button(main, LAUNCH);
  const chooseImageAndType = async () => {
    await chooseOption(image(), w.image.id, w.image.name);
    await chooseOption(type(), w.type, 't3.mic');
  };
  /** The id of the instance whose page the launch led to. */
  const launched = async (): Promise<string> => {
    await expect(page).toHaveURL(/\/aws\/ec2\/instances\/instance\/i-[0-9a-f]+$/, { timeout: 30_000 });
    return decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');
  };
  let first = '';

  await lines.line(
    'S1, "Launch instance" → S2; the name `<prefix>-web`; an image chosen by typing a part of its name; `t3.micro` by typing `t3.mic`; the key pair, the default subnet of `us-east-1b` and, typing its name, G; "Launch instance" → S3 of a new instance with "Launched instance {id}"',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await main.getByRole('link', { name: LAUNCH, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(LAUNCH_PATH));
      await expect(heading(page, LAUNCH)).toBeVisible();
      await name().fill(`${p}-web`, ACTION);
      await chooseImageAndType();
      await chooseOption(keyPair(), key);
      await chooseOption(subnet(), w.subnet['us-east-1b']!);
      await chooseInMultiselect(groups(), g, `${p}-g`);
      await submit().click(ACTION);
      first = await launched();
      await expectFlash(page, 'success', `Launched instance ${first}`);
    },
  );

  await lines.line(
    'The emulator reports that instance with the tag `Name`, the image, the type, the key pair, the subnet and the group G alone; S3 shows `running` without a refresh',
    async () => {
      expect(first, 'the instance of the first line').not.toBe('');
      const reported = await instanceDirect(ctx, port, first);
      expect(
        [
          reported?.tags.Name,
          reported?.imageId,
          reported?.type,
          reported?.keyName,
          reported?.subnetId,
          reported?.groups.map((each) => each.id),
        ],
        'the instance, directly',
      ).toEqual([`${p}-web`, w.image.id, w.type, key, w.subnet['us-east-1b'], [g]]);
      await expectValue(page, 'State', 'running');
    },
  );

  await lines.line(
    'S2 with no subnet chosen, H\'s name typed in "Security groups" → "No security groups match"; with the second VPC\'s subnet chosen, the same text → H is offered',
    async () => {
      await open(page, LAUNCH_PATH, LAUNCH);
      await typeInMultiselect(groups(), `${p}-h`);
      const m = multiselectOf(groups());
      await expect(m.list, `"${NO_GROUPS_MATCH}"`).toContainText(NO_GROUPS_MATCH, { timeout: 20_000 });
      await expect(m.option(h), 'H among the default VPC\'s groups').toHaveCount(0);
      await page.keyboard.press('Escape');
      await chooseOption(subnet(), other.subnetId);
      await typeInMultiselect(groups(), `${p}-h`);
      await expect(m.option(h), 'H among the second VPC\'s groups').toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Escape');
    },
  );

  await lines.line("S2 with G chosen, then the second VPC's subnet chosen → no group is chosen any more", async () => {
    await open(page, LAUNCH_PATH, LAUNCH);
    await chooseInMultiselect(groups(), g, `${p}-g`);
    await chooseOption(subnet(), other.subnetId);
    await expect(multiselectOf(groups()).tokens, 'the chosen groups').toHaveCount(0);
  });

  await lines.line(
    'S2, the name `<prefix>-bare`, an image and a type only, "Launch instance" → S3; the emulator reports the instance with the group `default` and in the default subnet of `us-east-1a`',
    async () => {
      await open(page, LAUNCH_PATH, LAUNCH);
      await name().fill(`${p}-bare`, ACTION);
      await chooseImageAndType();
      await submit().click(ACTION);
      const id = await launched();
      const reported = await instanceDirect(ctx, port, id);
      expect(
        [reported?.tags.Name, reported?.groups.map((each) => each.name), reported?.subnetId, reported?.keyName],
        'the instance, directly',
      ).toEqual([`${p}-bare`, ['default'], w.subnet['us-east-1a'], undefined]);
    },
  );

  await lines.line(
    'S2, a type but no image, "Launch instance" → "Choose an image." at the field; no request to launch left the page',
    async () => {
      await open(page, LAUNCH_PATH, LAUNCH);
      const launches = countActions(page, 'RunInstances');
      await chooseOption(type(), w.type, 't3.mic');
      await submit().click(ACTION);
      await expect(errorOf(image()), `"${CHOOSE_IMAGE}"`).toHaveText(CHOOSE_IMAGE);
      await expect(page).toHaveURL(addressOf(LAUNCH_PATH));
      expect(launches.count(), 'requests to launch').toBe(0);
    },
  );

  await lines.line(
    'S2, the name `<prefix>-1c`, an image, `t3.micro`, the default subnet of `us-east-1c`, "Launch instance" → the form stays with the emulator\'s `Unsupported` and its message, every entry as it was; the emulator reports no instance of that name',
    async () => {
      await open(page, LAUNCH_PATH, LAUNCH);
      await name().fill(`${p}-1c`, ACTION);
      await chooseImageAndType();
      await chooseOption(subnet(), w.subnet['us-east-1c']!);
      await submit().click(ACTION);
      await expect(alertWith(main, 'Unsupported'), 'the refusal in the form').toBeVisible({ timeout: 20_000 });
      await expect(alertWith(main, 'us-east-1c'), "the emulator's message").toBeVisible();
      await expect(page).toHaveURL(addressOf(LAUNCH_PATH));
      await expect(name(), 'the name as typed').toHaveValue(`${p}-1c`);
      await expect(selectOf(image()), 'the image as chosen').toContainText(w.image.name);
      await expect(selectOf(type()), 'the type as chosen').toContainText(w.type);
      await expect(selectOf(subnet()), 'the subnet as chosen').toContainText(w.subnet['us-east-1c']!);
      expect(await instancesNamed(ctx, port, `${p}-1c`), 'instances of that name, directly').toEqual([]);
    },
  );

  await lines.line(
    '"Cancel" → "Discard what you entered?"; "Keep editing" keeps the form; "Cancel", "Discard" → S1',
    async () => {
      await open(page, LAUNCH_PATH, LAUNCH);
      await name().fill(`${p}-never`, ACTION);
      await button(main, CANCEL).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the discard dialog').toContainText(DISCARD_HEADER);
      await button(dialog, KEEP_EDITING).click(ACTION);
      await expect(dialog, 'the dialog after "Keep editing"').toHaveCount(0);
      await expect(name(), 'the name as typed').toHaveValue(`${p}-never`);
      await button(main, CANCEL).click(ACTION);
      await button(dialogOf(page), DISCARD).click(ACTION);
      await expect(page).toHaveURL(addressOf(INSTANCES_PATH));
      expect(await instancesNamed(ctx, port, `${p}-never`), 'instances of that name, directly').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.ec2-stop-start-reboot-terminate-an-instance', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2state');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const a = await seeded.instance({ name: `${p}-a` });
  const prot = await seeded.instance({ name: `${p}-p`, protection: true });
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  /** S1 with A's row alone, selected. */
  const selectA = async () => {
    await open(page, INSTANCES_PATH, INSTANCES_H1);
    await findBy(table, `${p}-a`);
    await expectRows(table, 'Instance ID', [a], "A's row");
    await selectRow(table, 'Instance ID', a);
  };

  await lines.line(
    'S1, "Name" `<prefix>-a`, no row selected → "Start", "Stop", "Reboot" and "Terminate" are unavailable; select A → "Start" is unavailable ("Only a stopped instance can be started."), the other three available',
    async () => {
      await open(page, INSTANCES_PATH, INSTANCES_H1);
      await findBy(table, `${p}-a`);
      await expectRows(table, 'Instance ID', [a], "A's row");
      for (const action of ['start', 'stop', 'reboot', 'terminate']) {
        await expectActionUnavailable(page, action, null);
      }
      await closeActions(page);
      await selectRow(table, 'Instance ID', a);
      await expectActionUnavailable(page, 'start', ONLY_STOPPED_STARTS);
      for (const action of ['stop', 'reboot', 'terminate']) await expectActionAvailable(page, action);
      await closeActions(page);
    },
  );

  await lines.line(
    '"Stop" → "Stopping {id}"; the row reads `stopped` without a refresh; the emulator reports `stopped`',
    async () => {
      await selectA();
      await chooseAction(page, 'stop');
      await expectFlash(page, 'success', `Stopping ${a}`);
      await expectCell(table, 'Instance ID', a, 'State', 'stopped');
      expect(await reportsState(ctx, port, a, 'stopped'), 'stopped, directly').toBe(true);
    },
  );

  await lines.line(
    'A selected and `stopped` → "Stop" and "Reboot" unavailable with their reasons; "Start" → "Starting {id}", the row reads `running` without a refresh; the emulator reports `running`',
    async () => {
      expect(await reportsState(ctx, port, a, 'stopped'), 'A is stopped, directly').toBe(true);
      await selectA();
      await expectCell(table, 'Instance ID', a, 'State', 'stopped');
      await expectActionUnavailable(page, 'stop', ONLY_RUNNING_STOPS);
      await expectActionUnavailable(page, 'reboot', ONLY_RUNNING_REBOOTS);
      await chooseAction(page, 'start');
      await expectFlash(page, 'success', `Starting ${a}`);
      await expectCell(table, 'Instance ID', a, 'State', 'running');
      expect(await reportsState(ctx, port, a, 'running'), 'running, directly').toBe(true);
    },
  );

  await lines.line('"Reboot" → "Rebooting {id}"; the emulator reports `running`', async () => {
    expect(await reportsState(ctx, port, a, 'running'), 'A is running, directly').toBe(true);
    await selectA();
    await expectCell(table, 'Instance ID', a, 'State', 'running');
    await chooseAction(page, 'reboot');
    await expectFlash(page, 'success', `Rebooting ${a}`);
    expect(await reportsState(ctx, port, a, 'running'), 'running, directly').toBe(true);
  });

  await lines.line(
    'S3 of A, "Terminate" → "Terminate instance?" naming A; "Cancel" → the emulator still reports `running`',
    async () => {
      await open(page, instancePath(a), `${p}-a`);
      await expectValue(page, 'State', 'running');
      await chooseAction(page, 'terminate');
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Terminate instance?');
      await expect(dialog, 'the dialog names A').toContainText(`${p}-a`);
      await cancelDialog(page);
      expect((await instanceDirect(ctx, port, a))?.state, 'the state after "Cancel", directly').toBe('running');
    },
  );

  await lines.line(
    '"Terminate", type `terminate`, "Terminate" → "Terminating {id}"; the page stays S3 and reads `terminated` without a refresh; "Terminate" is unavailable ("This instance is already terminated."); the emulator reports `terminated`',
    async () => {
      await open(page, instancePath(a), `${p}-a`);
      await expectValue(page, 'State', 'running');
      await chooseAction(page, 'terminate');
      await confirmWith(page, 'terminate', TERMINATE);
      await expectFlash(page, 'success', `Terminating ${a}`);
      await expectValue(page, 'State', 'terminated');
      await expect(page).toHaveURL(addressOf(instancePath(a)));
      await expectActionUnavailable(page, 'terminate', ALREADY_TERMINATED);
      await closeActions(page);
      expect(await reportsState(ctx, port, a, 'terminated'), 'terminated, directly').toBe(true);
    },
  );

  await lines.line('S1, "Name" `<prefix>-a` → A is listed, `terminated`', async () => {
    expect(await reportsState(ctx, port, a, 'terminated'), 'A is terminated, directly').toBe(true);
    await open(page, INSTANCES_PATH, INSTANCES_H1);
    await findBy(table, `${p}-a`);
    await expectRows(table, 'Instance ID', [a], "A's row");
    await expectCell(table, 'Instance ID', a, 'State', 'terminated');
  });

  await lines.line(
    'S3 of P → "Termination protection" "On"; "Terminate", type `terminate`, "Terminate" → the emulator\'s `OperationNotPermitted` and its message are shown; the emulator still reports `running`',
    async () => {
      await open(page, instancePath(prot), `${p}-p`);
      await expectValueIs(page, 'Termination protection', 'On');
      await chooseAction(page, 'terminate');
      await confirmWith(page, 'terminate', TERMINATE);
      await expectFlash(page, 'error', 'OperationNotPermitted', 'may not be terminated');
      await expect(dialogOf(page), 'the dialog after the answer').toHaveCount(0);
      expect((await instanceDirect(ctx, port, prot))?.state, 'the state, directly').toBe('running');
      await expectValue(page, 'State', 'running');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.ec2-screens-follow-an-emulator-restart', async ({ ctx, page, context }) => {
  test.setTimeout(360_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2restart');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const key = await seeded.keyPair(`${p}-key`);
  const group = await seeded.group(`${p}-sg`, `Kept ${p}`);
  const instance = await seeded.instance({ name: `${p}-kept`, keyName: key, groupIds: [group] });

  // The five screens, each in a page of its own, read before the restart.
  const s1 = page;
  await open(s1, INSTANCES_PATH, INSTANCES_H1);
  await expectRows(s1.getByRole('main').locator(TABLE).first(), 'Instance ID', [instance], 'S1 before the restart');
  const s3 = await context.newPage();
  await open(s3, instancePath(instance), `${p}-kept`);
  await expectValueIs(s3, 'Instance ID', instance);
  const s4 = await context.newPage();
  await open(s4, GROUPS_PATH, GROUPS_H1);
  await expectRows(s4.getByRole('main').locator(TABLE).first(), 'Name', ['default', `${p}-sg`], 'S4 before the restart');
  const s6 = await context.newPage();
  await open(s6, groupPath(group), `${p}-sg`);
  await expectValueIs(s6, 'Group ID', group);
  const s8 = await context.newPage();
  await open(s8, KEY_PAIRS_PATH, KEY_PAIRS_H1);
  await expectRows(s8.getByRole('main').locator(TABLE).first(), 'Name', [key], 'S8 before the restart');
  const pages = [s1, s3, s4, s6, s8];

  await lines.line(
    'S1, S3 of the instance, S4, S6 of the group and S8 each open in a page of its own; the emulator is restarted → once the emulator line reads "Connected" again: S1 shows "No instances"; S3 "Instance not found"; S4 the group `default` alone; S6 "Security group not found"; S8 "No key pairs"; none with a row or a value of before',
    async () => {
      await emulator.stop();
      // A read while the emulator is stopped fails; each page reads again by itself once it is connected again.
      for (const each of pages) {
        await each.bringToFront();
        await expectLine(each, notStartedOn(port));
        await button(each.getByRole('main'), REFRESH).first().click(ACTION);
      }
      await emulator.startAgain();
      for (const each of pages) {
        await each.bringToFront();
        await expectLine(each, connectedAt(port), 60_000);
      }
      expect(await groupDirect(ctx, port, group), 'the group after the restart, directly').toBeNull();

      await s1.bringToFront();
      const t1 = s1.getByRole('main').locator(TABLE).first();
      await expect(emptyOf(t1), `"${NO_INSTANCES}" on S1`).toContainText(NO_INSTANCES, { timeout: 60_000 });
      expect(await rowsOf(t1), 'rows on S1').toEqual([]);
      await expect(s1.getByRole('main'), 'the instance of before on S1').not.toContainText(instance);

      await s3.bringToFront();
      const m3 = s3.getByRole('main');
      await expect(m3.getByText(INSTANCE_NOT_FOUND, { exact: true }), `"${INSTANCE_NOT_FOUND}" on S3`).toBeVisible({
        timeout: 60_000,
      });
      await expect(m3, 'a value of before on S3').not.toContainText(key);
      await expect(m3.locator(TABLE), 'sections on S3').toHaveCount(0);

      await s4.bringToFront();
      const t4 = s4.getByRole('main').locator(TABLE).first();
      await expectRows(t4, 'Name', ['default'], 'S4 shows the group default alone');
      await expect(s4.getByRole('main'), 'the group of before on S4').not.toContainText(group);

      await s6.bringToFront();
      const m6 = s6.getByRole('main');
      await expect(m6.getByText(GROUP_NOT_FOUND, { exact: true }), `"${GROUP_NOT_FOUND}" on S6`).toBeVisible({
        timeout: 60_000,
      });
      await expect(m6, 'a value of before on S6').not.toContainText(`Kept ${p}`);
      await expect(m6.locator(TABLE), 'the rules on S6').toHaveCount(0);

      await s8.bringToFront();
      const t8 = s8.getByRole('main').locator(TABLE).first();
      await expect(emptyOf(t8), `"${NO_KEY_PAIRS}" on S8`).toContainText(NO_KEY_PAIRS, { timeout: 60_000 });
      expect(await rowsOf(t8), 'rows on S8').toEqual([]);
    },
  );

  lines.end();
});
