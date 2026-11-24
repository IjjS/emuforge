import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { clusterAction, clusterFixture, xmlField } from './services/rds/cluster-actions';
import {
  button, chooseOption, clusterDirect, clusterPath, dialogOf, expectCell, expectFlash, expectValueIs,
  field, instanceDirect, instancePath, open, rds, tableOf,
} from './services/rds/rds';

test('studio.rds-stop-and-start-a-cluster', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { prefix, cluster, seeded } = await clusterFixture(ctx, port, 'rdscycle');
  const member = await seeded.instance({
    id: prefix + '-member', engine: cluster.engine, clusterId: cluster.id, instanceClass: 'db.r6g.large',
  });
  await open(page, instancePath(member), member);
  await page.getByRole('link', { name: 'Open DB cluster' }).click(ACTION);
  await expect(page).toHaveURL(addressOf(clusterPath(cluster.id)));
  const members = tableOf(page.getByRole('main'), 'DB instances');
  for (const [action, message, status] of [
    ['stop', 'Stopping DB cluster ', 'stopped'], ['start', 'Starting DB cluster ', 'available'],
  ] as const) {
    await clusterAction(page, action);
    await expectFlash(page, 'success', message + cluster.id);
    await expectValueIs(page, 'Status', status);
    await expectCell(members, 'DB identifier', member, 'Status', status);
    expect((await instanceDirect(ctx, port, member))?.status).toBe(status);
    expect((await clusterDirect(ctx, port, cluster.id))?.status).toBe(status);
  }
});

test('studio.rds-modify-a-cluster', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { cluster } = await clusterFixture(ctx, port, 'rdsmodify', true);
  await open(page, clusterPath(cluster.id), cluster.id);
  await clusterAction(page, 'modify');
  const dialog = dialogOf(page);
  await dialog.getByRole('checkbox', { name: 'Deletion protection' }).uncheck(ACTION);
  await field(dialog, 'Backup retention period (days)').getByRole('textbox').fill('7', ACTION);
  await button(dialog, 'Save changes').click(ACTION);
  await expectFlash(page, 'success', 'DB cluster ' + cluster.id + ' updated');
  await expectValueIs(page, 'Deletion protection', 'Off');
  await expectValueIs(page, 'Backup retention period (days)', '7');
  await expect(button(page.getByRole('main'), 'Delete')).toBeEnabled();
  const answer = await rds(ctx, port, 'DescribeDBClusters', { DBClusterIdentifier: cluster.id });
  expect(answer.status).toBe(200);
  const row = xmlField(answer.root, 'DescribeDBClustersResult', 'DBClusters', 'DBCluster');
  expect(row?.children.find(c => c.name === 'BackupRetentionPeriod')?.text).toBe('7');
  expect(row?.children.find(c => c.name === 'DeletionProtection')?.text).toBe('false');
});

test('studio.rds-fail-over-to-a-selected-reader', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { prefix, cluster, seeded } = await clusterFixture(ctx, port, 'rdspromote');
  const member = (suffix: string) => seeded.instance({
    id: prefix + suffix, engine: cluster.engine, clusterId: cluster.id, instanceClass: 'db.r6g.large',
  });
  const writer = await member('-a');
  await member('-b');
  const target = await member('-c');
  await open(page, clusterPath(cluster.id), cluster.id);
  await clusterAction(page, 'failover');
  const dialog = dialogOf(page);
  await chooseOption(field(dialog, 'Target DB instance'), target);
  await button(dialog, 'Fail over').click(ACTION);
  await expectFlash(page, 'success', 'Failing over DB cluster ' + cluster.id);
  const members = tableOf(page.getByRole('main'), 'DB instances');
  await expectCell(members, 'DB identifier', target, 'Role', 'Writer');
  await expectCell(members, 'DB identifier', writer, 'Role', 'Reader');
  await expectValueIs(page, 'Status', 'available');
  expect((await clusterDirect(ctx, port, cluster.id))?.members).toEqual(expect.arrayContaining([
    { id: writer, writer: false }, { id: target, writer: true },
  ]));
});
