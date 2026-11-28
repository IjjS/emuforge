// EC2's volume forms choosing the type, the snapshot, the key and the instance (test-criteria.md, issue 651,
// "Integration scenarios, new"): `studio.ec2-volume-forms-choose-type-snapshot-key-and-instance`.
//
// The check makes a KMS key, which the API cannot delete at once, so it runs on an emulator of its own. Options are
// found by value (`support/form-choices.ts`); what a described option says is asserted on the option found.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';

import { EnvError, expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { addTag, makeKey, openSelect, tagsShown, triggerOf } from './support/form-choices';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alertWith,
  button,
  countActions,
  dialogOf,
  ec2,
  Ec2Seeded,
  errorOf,
  expectFlash,
  field,
  instanceDirect,
  items,
  open,
  textAt,
  world,
} from './services/ec2/ec2';
import { expectInstanceNotOffered, instanceOption, ownVolume, readVolume, volumePath, volumesPath } from './services/ec2/volumes';

const CREATE = 'Create volume';
const ZONE = 'us-east-1b';

test('studio.ec2-volume-forms-choose-type-snapshot-key-and-instance', async ({ ctx, page }) => {
  test.setTimeout(420_000);
  const { emulatorPort: port } = await startStack(ctx, { ownEmulator: true });
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2volpick');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const key = await makeKey(ctx, port, { alias: `alias/${p}-key` });
  const made = async (action: string, params: Record<string, string>, id: string) => {
    const answer = await ec2(ctx, port, action, params);
    const found = textAt(answer.root, id);
    if (answer.status !== 200 || found === undefined) throw new EnvError(`direct ${action} answered ${String(answer.status)}`);
    return found;
  };
  const source = await made('CreateVolume', { AvailabilityZone: ZONE, Size: '3' }, 'volumeId');
  ownVolume(ctx, port, source);
  await expect.poll(async () => (await readVolume(ctx, port, source))?.state, { timeout: 30_000 }).toBe('available');
  const snapshot = async () => {
    const id = await made('CreateSnapshot', { VolumeId: source }, 'snapshotId');
    ctx.own({ dispose: async () => void (await ec2(ctx, port, 'DeleteSnapshot', { SnapshotId: id })) });
    return id;
  };
  const s = await snapshot();
  const s2 = await snapshot();
  const run = await seeded.instance({ name: `${p}-run`, subnetId: w.subnet[ZONE]! });
  const stop = await seeded.instance({ name: `${p}-stop`, subnetId: w.subnet[ZONE]! });
  await seeded.stop(stop);
  const gone = await seeded.instance({ name: `${p}-gone`, subnetId: w.subnet[ZONE]! });
  await ec2(ctx, port, 'TerminateInstances', { 'InstanceId.1': gone });
  await expect.poll(async () => (await instanceDirect(ctx, port, gone))?.state, { timeout: 30_000 }).toBe('terminated');
  const other = await seeded.instance({ name: `${p}-other`, subnetId: w.subnet['us-east-1c']! });
  const main = page.getByRole('main');
  const size = () => field(main, 'Size (GiB)').or(field(main, 'Size (GiB) - optional')).first();
  const iops = () => field(main, 'IOPS').or(field(main, 'IOPS - optional')).first();
  const pick = async (label: string, value: string) => {
    await (await openSelect(field(main, label))).choose(value);
  };
  const openCreate = async () => {
    await open(page, `${volumesPath}/create`, CREATE);
    await pick('Availability Zone', ZONE);
  };
  const volumesFrom = async (snapshotId: string) =>
    items((await ec2(ctx, port, 'DescribeVolumes', { 'Filter.1.Name': 'snapshot-id', 'Filter.1.Value.1': snapshotId })).root, 'volumeSet').length;
  let volume = '';

  await lines.line(
    'S of "Create volume": `io1` chosen with no IOPS → "Enter the IOPS."; `sc1` with the snapshot `S` and no size → "The snapshot\'s 3 GiB is under sc1\'s minimum: enter a size."; no request to create left the page',
    async () => {
      await openCreate();
      const creates = countActions(page, 'CreateVolume');
      await pick('Volume type', 'io1');
      await button(main, CREATE).click(ACTION);
      await expect(errorOf(iops()), '"Enter the IOPS."').toHaveText('Enter the IOPS.');
      await pick('Volume type', 'sc1');
      await pick('Snapshot - optional', s);
      await size().getByRole('textbox').fill('', ACTION);
      await button(main, CREATE).click(ACTION);
      await expect(errorOf(size()), "the snapshot's size under sc1's minimum").toHaveText(
        "The snapshot's 3 GiB is under sc1's minimum: enter a size.",
      );
      expect(creates.count(), 'requests to create').toBe(0);
    },
  );

  await lines.line(
    '`us-east-1b`, `gp3`, the snapshot `S` and no size, IOPS 4000, throughput 250, "Encrypt the volume" with the key of `alias/<p>-key`, the tag `team` = `core`; "Create volume" → the result; the emulator reports a 3 GiB gp3 volume from `S` in `us-east-1b` with 4000 IOPS, 250 MiB/s, encrypted with that key, and the tag',
    async () => {
      await openCreate();
      await pick('Volume type', 'gp3');
      await pick('Snapshot - optional', s);
      await size().getByRole('textbox').fill('', ACTION);
      await iops().getByRole('textbox').fill('4000', ACTION);
      await field(main, 'Throughput (MiB/s) - optional').getByRole('textbox').fill('250', ACTION);
      await main.getByRole('checkbox', { name: 'Encrypt the volume', exact: true }).check(ACTION);
      await pick('KMS key', key.arn);
      await addTag(main, 'team', 'core');
      await button(main, CREATE).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/ec2\/volumes\/volume\/vol-[0-9a-f]+$/, { timeout: 30_000 });
      volume = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');
      ownVolume(ctx, port, volume);
      await expectFlash(page, 'success', `Volume ${volume} created.`);
      const node = items((await ec2(ctx, port, 'DescribeVolumes', { 'VolumeId.1': volume })).root, 'volumeSet')[0];
      expect(
        {
          size: textAt(node, 'size'),
          type: textAt(node, 'volumeType'),
          snapshot: textAt(node, 'snapshotId'),
          zone: textAt(node, 'availabilityZone'),
          iops: textAt(node, 'iops'),
          throughput: textAt(node, 'throughput'),
          encrypted: textAt(node, 'encrypted'),
          key: textAt(node, 'kmsKeyId'),
          tags: Object.fromEntries(items(node, 'tagSet').map((tag) => [textAt(tag, 'key'), textAt(tag, 'value')])),
        },
        'the volume, directly',
      ).toEqual({
        size: '3', type: 'gp3', snapshot: s, zone: ZONE, iops: '4000', throughput: '250', encrypted: 'true',
        key: key.arn, tags: { team: 'core' },
      });
    },
  );

  await lines.line(
    'The form again with the snapshot `S2` chosen, `S2` deleted outside, "Create volume" → the form stays with the emulator\'s refusal, every entry as it was; the emulator reports no further volume',
    async () => {
      await openCreate();
      await pick('Volume type', 'gp3');
      await pick('Snapshot - optional', s2);
      await addTag(main, 'team', 'core');
      expect((await ec2(ctx, port, 'DeleteSnapshot', { SnapshotId: s2 })).status, 'S2 deleted, directly').toBe(200);
      const direct = await ec2(ctx, port, 'CreateVolume', { AvailabilityZone: ZONE, VolumeType: 'gp3', SnapshotId: s2 });
      expect(direct.status, 'the status of the refused create, directly').not.toBe(200);
      await button(main, CREATE).click(ACTION);
      await expect(alertWith(main, direct.code!), "the emulator's code in the form").toBeVisible({ timeout: 20_000 });
      await expect(alertWith(main, direct.message!), "the emulator's message").toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${volumesPath}/create$`));
      await expect(triggerOf(field(main, 'Availability Zone')), 'the zone as chosen').toContainText(ZONE);
      await expect(triggerOf(field(main, 'Volume type')), 'the type as chosen').toContainText('gp3');
      await expect(triggerOf(field(main, 'Snapshot - optional')), 'the snapshot as chosen').toContainText(s2);
      expect(await tagsShown(main), 'the tag as entered').toEqual([['team', 'core']]);
      expect(await volumesFrom(s2), 'volumes made from S2, directly').toBe(0);
    },
  );

  await lines.line(
    'The volume\'s page, "Attach volume": "Instance" offers `<p>-run` and `<p>-stop`, each with its state and type, and neither `<p>-gone` nor `<p>-other`; `<p>-run` chosen → "In use on {its id}:" with its root device\'s name',
    async () => {
      expect(volume, 'the volume of the second line').not.toBe('');
      await open(page, volumePath(volume), volume);
      await button(main, 'Attach volume').click(ACTION);
      await expectInstanceNotOffered(page, run, gone);
      await expectInstanceNotOffered(page, stop, other);
      const offered = await instanceOption(page, stop);
      await expect(offered, '`<p>-stop` with its state and type').toContainText('stopped');
      await expect(offered, '`<p>-stop` with its type').toContainText(w.type);
      // The list is open: the option of `<p>-run` is read in it, with no second click on the field.
      const running = page.locator(createWrapper().findSelect().findDropdown().findOptionByValue(run).toSelector());
      await expect(running, '`<p>-run` with its state and type').toContainText('running');
      await expect(running, '`<p>-run` with its type').toContainText(w.type);
      await running.click(ACTION);
      const root = (await instanceDirect(ctx, port, run))?.volumes[0]?.device;
      expect(root, "the root device of `<p>-run`, directly").toBeDefined();
      await expect(field(dialogOf(page), 'Device name'), 'the devices in use').toContainText(`In use on ${run}:`);
      await expect(field(dialogOf(page), 'Device name'), 'the root device').toContainText(root!);
    },
  );

  await lines.line(
    'That device name typed, "Attach" → the dialog stays with the emulator\'s refusal; the emulator reports the volume `available`; `/dev/sdf` typed, "Attach" → the emulator reports the attachment to `<p>-run` at `/dev/sdf`',
    async () => {
      const dialog = dialogOf(page);
      const root = (await instanceDirect(ctx, port, run))?.volumes[0]?.device ?? '';
      const direct = await ec2(ctx, port, 'AttachVolume', { VolumeId: volume, InstanceId: run, Device: root });
      expect(direct.status, 'the status of the refused attachment, directly').not.toBe(200);
      await field(dialog, 'Device name').getByRole('textbox').fill(root, ACTION);
      await button(dialog, 'Attach volume').click(ACTION);
      await expect(alertWith(dialog, direct.code!), "the emulator's code in the dialog").toBeVisible({ timeout: 20_000 });
      await expect(alertWith(dialog, direct.message!), "the emulator's message").toBeVisible();
      expect(await readVolume(ctx, port, volume), 'the volume, directly').toMatchObject({ state: 'available', attachments: [] });
      await field(dialog, 'Device name').getByRole('textbox').fill('/dev/sdf', ACTION);
      await button(dialog, 'Attach volume').click(ACTION);
      await expect
        .poll(async () => (await readVolume(ctx, port, volume))?.attachments, { message: 'the attachment, directly', timeout: 30_000 })
        .toMatchObject([{ instance: run, device: '/dev/sdf' }]);
    },
  );

  lines.end();
});
