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
  emptyOf,
  instancesDirect,
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

async function removeVolume(ctx: Ctx, port: number, id: string) {
  const volume = await readVolume(ctx, port, id);
  if (!volume) return;
  if (volume.attachments.length) {
    const detached = await ec2(ctx, port, 'DetachVolume', { VolumeId: id });
    expect(detached.status).toBe(200);
  }
  await expect.poll(async () => (await readVolume(ctx, port, id))?.state, { timeout: 30_000 }).toBe('available');
  expect((await ec2(ctx, port, 'DeleteVolume', { VolumeId: id })).status).toBe(200);
  await expect.poll(() => readVolume(ctx, port, id), { timeout: 30_000 }).toBeNull();
}

export function ownVolume(ctx: Ctx, port: number, id: string) {
  ctx.own({ dispose: () => removeVolume(ctx, port, id) });
}

export async function seedStorage(ctx: Ctx, port: number, secondZone = false) {
  const defaults = await world(ctx, port);
  const prefix = checkPrefix(ctx, ctx.id.split('.').pop()!);
  const bootVolumes = new Set<string>();
  // Register around Ec2Seeded so teardown discovers block devices before termination and removes them afterward.
  ctx.own({
    async dispose() {
      const failures: string[] = [];
      for (const id of bootVolumes) {
        try {
          await removeVolume(ctx, port, id);
        } catch (error) {
          failures.push(id + ': ' + String(error));
        }
      }
      if (failures.length) throw new Error(failures.join('\n'));
    },
  });
  const seeded = new Ec2Seeded(ctx, port, prefix, defaults);
  ctx.own({
    async dispose() {
      // RunInstances tags each instance in the creation request, even if setup fails before returning its ID.
      const instances = await instancesDirect(ctx, port, { 'tag:Name': [prefix + '-same', prefix + '-other'] });
      for (const instance of instances) {
        for (const mapping of instance.volumes) {
          if (mapping.volumeId) bootVolumes.add(mapping.volumeId);
        }
      }
    },
  });
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

/** Read complete pages until the requested ID is found or the last settled page is exhausted. */
async function listContains(page: Page, id: string) {
  const table = volumeTable(page);
  const next = page.locator(ui.findPagination().findNextPageButton().toSelector());
  let previousFirst: string | undefined;
  for (;;) {
    const ids = async () => (await rowsOf(table)).map((row) => row['Volume ID']);
    await expect
      .poll(
        async () => {
          const first = (await ids())[0];
          if (first) return first !== previousFirst;
          const empty = emptyOf(table);
          return (await empty.isVisible()) && /^No (more )?volumes$/.test((await empty.innerText()).trim());
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const current = await ids();
    if (current.includes(id)) return true;
    if (!(await next.isEnabled())) return false;
    previousFirst = current[0];
    await next.click(ACTION);
  }
}

export async function findVolume(page: Page, id: string) {
  await open(page, volumesPath, 'Volumes');
  expect(await listContains(page, id), 'the created volume is listed').toBe(true);
  return volumeTable(page).getByRole('link', { name: id, exact: true });
}

export async function expectVolumeAbsent(page: Page, id: string) {
  expect(await listContains(page, id), 'the deleted volume across all list pages').toBe(false);
}

export async function instanceOption(page: Page, id: string) {
  const dialog = dialogOf(page);
  await selectOf(field(dialog, 'Instance')).click(ACTION);
  const option = page.locator(ui.findSelect().findDropdown().findOptionByValue(id).toSelector());
  const options = page.locator(ui.findSelect().findDropdown().findOptions().toSelector());
  const more = button(dialog, 'Load more');
  await expect(option.or(more).first()).toBeVisible({ timeout: 20_000 });
  while (!(await option.isVisible())) {
    const before = await options.count();
    await more.click(ACTION);
    await expect
      .poll(async () => (await option.isVisible()) || (await options.count()) > before, {
        timeout: 20_000,
        message: 'the selected instance or another page of instance choices',
      })
      .toBe(true);
  }
  return option;
}

/**
 * Opens "Instance", waits for the option of `offered` and reads the list to its end ("Load more" until it is gone);
 * the list is left open, with no option of `absent` in it or the check fails (issue 651: an instance of another
 * zone is not offered).
 */
export async function expectInstanceNotOffered(page: Page, offered: string, absent: string) {
  const dialog = dialogOf(page);
  await instanceOption(page, offered);
  const options = page.locator(ui.findSelect().findDropdown().findOptions().toSelector());
  const more = button(dialog, 'Load more');
  while (await more.isVisible()) {
    const before = await options.count();
    await more.click(ACTION);
    await expect
      .poll(async () => (await options.count()) > before || !(await more.isVisible()), { timeout: 20_000 })
      .toBe(true);
  }
  const option = page.locator(ui.findSelect().findDropdown().findOptionByValue(absent).toSelector());
  await expect(option, 'the instance of the other zone among the choices').toHaveCount(0);
  await page.keyboard.press('Escape');
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
  // This volume was created empty and the scenario attaches it once. All three values belong to its sole row.
  const attachments = ui.findTable();
  await expect(page.locator(attachments.findRows().toSelector())).toHaveCount(1);
  const cell = (column: number) => page.locator(attachments.findBodyCell(1, column).toSelector());
  await expect(cell(1).getByRole('link', { name: instance, exact: true })).toBeVisible();
  await expect(cell(2)).toHaveText(device);
  await expect(cell(3)).toHaveText('attached');
}
