import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION } from '../../support/frame';
import { checkPrefix } from '../../support/service-screens';
import {
  button,
  dialogOf,
  ec2,
  Ec2Seeded,
  expectCell,
  expectFlash,
  expectValueIs,
  field,
  items,
  open,
  rowsOf,
  selectOf,
  tableOf,
  textAt,
  world,
} from './ec2';

const ui = createWrapper();
export const volumesPath = '/aws/ec2/volumes';
export const volumePath = (id: string) => volumesPath + '/volume/' + id;
export const device = '/dev/sdf';
export const volumeTable = (page: Page) => tableOf(page.getByRole('main'), 'Volumes');

export async function readVolume(ctx: Ctx, port: number, id: string) {
  const reply = await ec2(ctx, port, 'DescribeVolumes', { 'Filter.1.Name': 'volume-id', 'Filter.1.Value.1': id });
  expect(reply.status).toBe(200);
  const node = items(reply.root, 'volumeSet')[0];
  if (!node) return null;
  return {
    id: textAt(node, 'volumeId'),
    state: textAt(node, 'status'),
    zone: textAt(node, 'availabilityZone'),
    size: textAt(node, 'size'),
    type: textAt(node, 'volumeType'),
    attachments: items(node, 'attachmentSet').map((item) => ({
      instance: textAt(item, 'instanceId'),
      device: textAt(item, 'device'),
      state: textAt(item, 'status'),
    })),
  };
}

export function ownVolume(ctx: Ctx, port: number, id: string) {
  ctx.own({
    async dispose() {
      const volume = await readVolume(ctx, port, id);
      if (!volume) return;
      if (volume.attachments.length) {
        const detached = await ec2(ctx, port, 'DetachVolume', { VolumeId: id });
        expect(detached.status).toBe(200);
      }
      await expect.poll(async () => (await readVolume(ctx, port, id))?.state, { timeout: 30_000 }).toBe('available');
      expect((await ec2(ctx, port, 'DeleteVolume', { VolumeId: id })).status).toBe(200);
    },
  });
}

export async function seedStorage(ctx: Ctx, port: number, secondZone = false) {
  const defaults = await world(ctx, port);
  const prefix = checkPrefix(ctx, 'volume');
  const seeded = new Ec2Seeded(ctx, port, prefix, defaults);
  const instance = await seeded.instance({ name: prefix + '-same', subnetId: defaults.subnet['us-east-1a']! });
  const other = secondZone
    ? await seeded.instance({ name: prefix + '-other', subnetId: defaults.subnet['us-east-1b']! })
    : undefined;
  const created = await ec2(ctx, port, 'CreateVolume', { AvailabilityZone: 'us-east-1a', Size: '4' });
  const id = textAt(created.root, 'volumeId');
  if (!id || created.status !== 200) throw new EnvError('CreateVolume did not return the seed volume ID');
  ownVolume(ctx, port, id);
  await expect.poll(async () => (await readVolume(ctx, port, id))?.state, { timeout: 30_000 }).toBe('available');
  return { id, instance, other };
}

/** Find this check's ID, following actual list pages when the account holds older volumes. */
export async function findVolume(page: Page, id: string) {
  await open(page, volumesPath, 'Volumes');
  const table = volumeTable(page);
  const link = table.getByRole('link', { name: id, exact: true });
  const next = page.locator(ui.findPagination().findNextPageButton().toSelector());
  const loading = page.locator(ui.findTable().findLoadingText().toSelector());
  await expect.poll(async () => (await rowsOf(table)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  while (!(await link.isVisible())) {
    const previous = (await rowsOf(table))[0]?.['Volume ID'];
    await expect(next).toBeEnabled();
    await next.click(ACTION);
    await expect.poll(async () => (await rowsOf(table))[0]?.['Volume ID']).not.toBe(previous);
    await expect(loading).toBeHidden();
  }
  return link;
}

export async function instanceOption(page: Page, id: string) {
  const dialog = dialogOf(page);
  await selectOf(field(dialog, 'Instance')).click(ACTION);
  const option = page.locator(ui.findSelect().findDropdown().findOptionByValue(id).toSelector());
  const more = button(dialog, 'Load more');
  await expect(option.or(more).first()).toBeVisible({ timeout: 20_000 });
  while (!(await option.isVisible())) {
    await more.click(ACTION);
    await expect(option.or(more).first()).toBeVisible({ timeout: 20_000 });
  }
  return option;
}

export async function submitAttachment(page: Page, instance: string) {
  const dialog = dialogOf(page);
  await (await instanceOption(page, instance)).click(ACTION);
  await field(dialog, 'Device name').getByRole('textbox').fill(device);
  await button(dialog, 'Attach volume').click(ACTION);
}

export async function expectAttached(page: Page, id: string, instance: string) {
  await expectFlash(page, 'success', 'Attachment requested for ' + id + '.');
  await expectValueIs(page, 'State', 'in-use');
  const table = tableOf(page.getByRole('main'), 'Attachments');
  await expectCell(table, 'Device', device, 'State', 'attached');
  await expect(table.getByRole('link', { name: instance, exact: true })).toBeVisible();
}
