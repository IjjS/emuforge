import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import { expect, startStack, test } from './support';
import { connectedAt, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf } from './support/frame';
import {
  alertWith,
  button,
  chooseOption,
  confirmWith,
  dialogOf,
  ec2,
  emptyOf,
  expectFlash,
  expectValueIs,
  field,
  instancePath,
  instancesDirect,
  items,
  open,
  parseXml,
  rowsOf,
  tableOf,
  textAt,
} from './services/ec2/ec2';
import {
  device,
  expectAttached,
  expectVolumeAbsent,
  findVolume,
  instanceOption,
  ownVolume,
  readVolume,
  seedStorage,
  submitAttachment,
  volumePath,
  volumeTable,
  volumesPath,
} from './services/ec2/volumes';

const ui = createWrapper();

test('studio.ec2-create-and-delete-a-volume', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const zones = await ec2(ctx, port, 'DescribeAvailabilityZones');
  expect(zones.status).toBe(200);
  const zone = textAt(items(zones.root, 'availabilityZoneInfo')[0], 'zoneName');
  if (!zone) throw new Error('The emulator returned no zone');
  await open(page, '/aws/ec2', 'Instances');
  await page.locator(ui.findSideNavigation().findLinkByHref(volumesPath).toSelector()).click(ACTION);
  const main = page.getByRole('main');
  await volumeTable(page).getByRole('link', { name: 'Create volume' }).click(ACTION);
  await chooseOption(field(main, 'Availability Zone'), zone);
  await field(main, 'Size (GiB)').getByRole('textbox').fill('8');
  const response = page.waitForResponse(
    (r) => new URLSearchParams(r.request().postData() ?? '').get('Action') === 'CreateVolume',
  );
  await button(main, 'Create volume').click(ACTION);
  const id = textAt(parseXml(await (await response).text()), 'volumeId');
  if (!id) throw new Error('The create response did not identify the volume');
  ownVolume(ctx, port, id);
  await expect(page).toHaveURL(addressOf(volumePath(id)));
  await expectValueIs(page, 'State', 'available');
  await expectFlash(page, 'success', 'Volume ' + id + ' created.');
  await expectValueIs(page, 'Size', '8 GiB');
  await expectValueIs(page, 'Type', 'gp2');
  await expectValueIs(page, 'Availability Zone', zone);
  expect(await readVolume(ctx, port, id)).toEqual({
    id,
    state: 'available',
    zone,
    size: '8',
    type: 'gp2',
    attachments: [],
  });
  await (await findVolume(page, id)).click(ACTION);
  await expect(page).toHaveURL(addressOf(volumePath(id)));
  await button(main, 'Delete volume').click(ACTION);
  const deleted = page.waitForResponse((response) => {
    const params = new URLSearchParams(response.request().postData() ?? '');
    return response.ok() && params.get('Action') === 'DeleteVolume' && params.get('VolumeId') === id;
  });
  // Match a request started after the successful deletion so an earlier, still-pending read cannot satisfy this wait.
  const freshList = deleted.then(() =>
    page.waitForRequest((request) => {
      const params = new URLSearchParams(request.postData() ?? '');
      return (
        params.get('Action') === 'DescribeVolumes' &&
        !params.has('NextToken') &&
        !Array.from(params.keys()).some((key) => /^(?:Filter|VolumeId)(?:\.|$)/.test(key))
      );
    }),
  );
  const [listRequest] = await Promise.all([freshList, confirmWith(page, id, 'Delete volume')]);
  const listResponse = await listRequest.response();
  if (!listResponse?.ok()) throw new Error('The volume list refresh after deletion did not succeed');
  const reply = parseXml(await listResponse.text());
  expect(reply.name).toBe('DescribeVolumesResponse');
  const ids = items(reply, 'volumeSet').map((volume) => textAt(volume, 'volumeId'));
  await expect(page).toHaveURL(addressOf(volumesPath));
  const list = volumeTable(page);
  if (!ids.length) await expect(emptyOf(list)).toHaveText('No volumes');
  await expect.poll(async () => (await rowsOf(list)).map((row) => row['Volume ID'])).toEqual(ids);
  await expectFlash(page, 'success', 'Volume ' + id + ' deleted.');
  await expectVolumeAbsent(page, id);
  expect(await readVolume(ctx, port, id)).toBeNull();
});

test('studio.ec2-attach-and-detach-an-external-volume', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { id, instance } = await seedStorage(ctx, port);
  await (await findVolume(page, id)).click(ACTION);
  const main = page.getByRole('main');
  await button(main, 'Attach volume').click(ACTION);
  await submitAttachment(page, instance);
  await expectAttached(page, id, instance);
  expect((await readVolume(ctx, port, id))?.attachments).toEqual([{ instance, device, state: 'attached' }]);
  await tableOf(main, 'Attachments').getByRole('link', { name: instance, exact: true }).click(ACTION);
  await expect(page).toHaveURL(addressOf(instancePath(instance)));
  await volumeTable(page).getByRole('link', { name: id, exact: true }).click(ACTION);
  await expect(page).toHaveURL(addressOf(volumePath(id)));
  await button(tableOf(main, 'Attachments'), 'Detach volume').click(ACTION);
  const dialog = dialogOf(page);
  await expect(dialog).toContainText(instance);
  await expect(dialog).toContainText(device);
  await button(dialog, 'Detach volume').click(ACTION);
  await expectValueIs(page, 'State', 'available');
  await expect(emptyOf(tableOf(main, 'Attachments'))).toContainText('No attachments');
  await expectFlash(page, 'success', 'Detachment requested for ' + id + '.');
  expect(await readVolume(ctx, port, id)).toMatchObject({ state: 'available', attachments: [] });
});

test('studio.ec2-volume-refusals-preserve-storage', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { id, instance, other } = await seedStorage(ctx, port, true);
  await open(page, volumePath(id), id);
  const main = page.getByRole('main');
  await button(main, 'Attach volume').click(ACTION);
  await submitAttachment(page, other!);
  const alert = alertWith(dialogOf(page), 'InvalidVolume.ZoneMismatch');
  await expect(alert).toContainText('InvalidVolume.ZoneMismatch');
  expect(await readVolume(ctx, port, id)).toMatchObject({ state: 'available', attachments: [] });
  await submitAttachment(page, instance);
  await expectAttached(page, id, instance);
  await button(main, 'Delete volume').click(ACTION);
  await confirmWith(page, id, 'Delete volume');
  const refusal = dialogOf(page).getByRole('alert');
  await expect(refusal).toContainText('VolumeInUse');
  await expect(refusal).toContainText('Volume ' + id + ' is currently attached to {' + instance + '}');
  expect(await readVolume(ctx, port, id)).toMatchObject({
    state: 'in-use',
    attachments: [{ instance, device, state: 'attached' }],
  });
});

test('studio.ec2-volumes-follow-an-emulator-restart', async ({ ctx, page, context }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const { id, instance } = await seedStorage(ctx, port);
  await expect(await findVolume(page, id)).toBeVisible();
  const detail = await context.newPage();
  await open(detail, volumePath(id), id);
  await button(detail.getByRole('main'), 'Attach volume').click(ACTION);
  await expect(await instanceOption(detail, instance)).toBeVisible();
  await stack.emulator!.stop();
  for (const tab of [page, detail]) {
    await tab.bringToFront();
    await expectLine(tab, notStartedOn(port));
  }
  await expect(dialogOf(detail)).toHaveCount(0);
  await stack.emulator!.startAgain();
  for (const tab of [page, detail]) {
    await tab.bringToFront();
    await expectLine(tab, connectedAt(port), 60_000);
  }
  await expect(emptyOf(volumeTable(page))).toContainText('No volumes');
  await expect(detail.getByRole('main').getByText('Volume not found', { exact: true })).toBeVisible();
  const volumes = await ec2(ctx, port, 'DescribeVolumes');
  expect(volumes.status).toBe(200);
  expect(items(volumes.root, 'volumeSet')).toEqual([]);
  expect(await instancesDirect(ctx, port, {})).toEqual([]);
});
