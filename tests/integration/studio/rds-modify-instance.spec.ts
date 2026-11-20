import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { openModify } from './services/rds/modify';
import {
  CHANGED_WITH_INSTANCE,
  clusterDirect,
  expectFlash,
  expectNoRow,
  expectValueIs,
  expectValueParts,
  instanceDirect,
  instancePath,
  INSTANCES_PATH,
  rdsPrefix,
  RdsSeeded,
  rowOf,
  runPassword,
  TABLE,
} from './services/rds/rds';

test('studio.rds-modify-and-rename-a-db-instance', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = rdsPrefix(ctx, 'rdsedit');
  const seeded = new RdsSeeded(ctx, port, prefix);
  const original = await seeded.instance({
    id: `${prefix}-original`, engine: 'postgres', instanceClass: 'db.t3.micro',
    storage: 20, masterUsername: 'dbadmin', password: runPassword(), protection: true,
  });
  const renamed = `${prefix}-renamed`;
  const form = await openModify(page, original);
  await form.identifier.fill(renamed, ACTION);
  await form.instanceClass.fill('db.t3.small', ACTION);
  await form.storage.fill('30', ACTION);
  await form.password.fill(runPassword(), ACTION);
  await form.protection.uncheck(ACTION);
  await form.save.click(ACTION);
  await expect(page).toHaveURL(addressOf(instancePath(renamed)));
  await expectFlash(page, 'success', `Modifying ${renamed}.`);
  await expectValueIs(page, 'Status', 'available');
  await expectValueIs(page, 'Class', 'db.t3.small');
  await expectValueIs(page, 'Allocated storage', '30 GiB');
  await expectValueIs(page, 'Deletion protection', 'Off');
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();

  await page.goto(INSTANCES_PATH);
  const table = page.getByRole('main').locator(TABLE);
  await rowOf(table, 'DB identifier', renamed);
  await expectNoRow(table, 'DB identifier', original);
  expect(await instanceDirect(ctx, port, renamed)).toMatchObject({
    id: renamed, status: 'available', instanceClass: 'db.t3.small', storage: '30', protection: false,
  });
  expect(await instanceDirect(ctx, port, original)).toBeNull();
});

test('studio.rds-refuses-an-occupied-instance-identifier', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = rdsPrefix(ctx, 'rdscollision');
  const seeded = new RdsSeeded(ctx, port, prefix);
  const original = await seeded.instance({
    id: `${prefix}-original`, engine: 'postgres', instanceClass: 'db.t3.micro', storage: 20,
  });
  const occupied = await seeded.instance({
    id: `${prefix}-occupied`, engine: 'postgres', instanceClass: 'db.t3.small', storage: 30,
  });
  const before = await Promise.all([original, occupied].map((id) => instanceDirect(ctx, port, id)));
  const form = await openModify(page, original);
  await form.identifier.fill(occupied, ACTION);
  await form.save.click(ACTION);
  await expect(form.failure).toContainText('DB instance already exists');
  await expect(page).toHaveURL(addressOf(instancePath(original)));
  await form.identifier.fill(`${prefix}-unused`, ACTION);
  await expect(form.save).toBeEnabled();
  await form.cancel.click(ACTION);
  await expect(form.dialog).toBeHidden();
  await expectValueIs(page, 'DB identifier', original);
  const after = await Promise.all([original, occupied].map((id) => instanceDirect(ctx, port, id)));
  expect(after).toEqual(before);
});

test('studio.rds-modifies-a-cluster-member', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = rdsPrefix(ctx, 'rdsmemberedit');
  const seeded = new RdsSeeded(ctx, port, prefix);
  const cluster = await seeded.cluster({
    id: `${prefix}-cluster`, engine: 'aurora-postgresql', masterUsername: 'clusteradmin', password: runPassword(),
  });
  const original = await seeded.instance({
    id: `${prefix}-member`, engine: cluster.engine, instanceClass: 'db.r6g.large', clusterId: cluster.id,
  });
  const renamed = `${prefix}-renamed`;
  const form = await openModify(page, original);
  await expect(form.clusterGuidance).toHaveText('The cluster manages storage and master credentials.');
  await expect(form.storage).toHaveCount(0);
  await expect(form.password).toHaveCount(0);
  await form.identifier.fill(renamed, ACTION);
  await form.instanceClass.fill('db.r6g.xlarge', ACTION);
  await form.protection.check(ACTION);
  await form.save.click(ACTION);
  await expect(page).toHaveURL(addressOf(instancePath(renamed)));
  await expectFlash(page, 'success', `Modifying ${renamed}.`);
  await expectValueIs(page, 'Status', 'available');
  await expectValueIs(page, 'Class', 'db.r6g.xlarge');
  await expectValueParts(page, 'Deletion protection', ['On', CHANGED_WITH_INSTANCE]);
  expect(await instanceDirect(ctx, port, renamed)).toMatchObject({
    id: renamed, status: 'available', instanceClass: 'db.r6g.xlarge', protection: true, clusterId: cluster.id,
  });
  expect(await instanceDirect(ctx, port, original)).toBeNull();
  expect(await clusterDirect(ctx, port, cluster.id)).toMatchObject({
    masterUsername: cluster.masterUsername, protection: cluster.protection, members: [{ id: renamed }],
  });
});
