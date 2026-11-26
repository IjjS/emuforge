import { expect, startStack, test } from './support';
import { connectedAt, expectLine, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, SIDE_NAVIGATION } from './support/frame';
import {
  clusterFixture, ownSnapshot, seedSnapshot, SNAPSHOT_ID, SNAPSHOTS, snapshotDirect, xmlField,
} from './services/rds/cluster-actions';
import {
  addInstancePath, button, cancelDialog, clusterDirect, clusterPath, CLUSTERS_PATH, confirmWith, countActions, dialogOf,
  emptyOf, expectCell, expectFlash, expectNoRow, expectValueIs, field, open, parseXml, rds, reportsNoCluster,
  rowOf, rowsOf, selectRow, tableOf,
} from './services/rds/rds';

test('studio.rds-take-a-cluster-snapshot', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { prefix, cluster } = await clusterFixture(ctx, port, 'rdstake');
  const existing = prefix + '-existing';
  const created = prefix + '-new';
  await seedSnapshot(ctx, port, cluster.id, existing);
  ownSnapshot(ctx, port, created);
  await open(page, clusterPath(cluster.id), cluster.id);
  const main = page.getByRole('main');
  const dialog = dialogOf(page);
  const takeSnapshot = async (id: string) => {
    await button(main, 'Take snapshot').click(ACTION);
    await field(dialog, SNAPSHOT_ID).getByRole('textbox').fill(id, ACTION);
    await button(dialog, 'Take snapshot').click(ACTION);
  };
  const [refused] = await Promise.all([
    page.waitForResponse(response => {
      const params = new URLSearchParams(response.request().postData() ?? '');
      return params.get('Action') === 'CreateDBClusterSnapshot' && params.get('DBClusterSnapshotIdentifier') === existing;
    }),
    takeSnapshot(existing),
  ]);
  const error = parseXml(await refused.text());
  expect(xmlField(error, 'Error', 'Code')?.text).toBe('DBClusterSnapshotAlreadyExistsFault');
  const message = xmlField(error, 'Error', 'Message')?.text;
  if (!message) throw new Error('The duplicate snapshot response has no error message');
  await expectFlash(page, 'error', existing, message);
  await takeSnapshot(created);
  await expect(page).toHaveURL(addressOf(SNAPSHOTS));
  await expectFlash(page, 'success', 'Creating DB cluster snapshot ' + created);
  const table = tableOf(main, 'DB cluster snapshots');
  await expectCell(table, SNAPSHOT_ID, created, 'Status', 'available');
  expect(await rowOf(table, SNAPSHOT_ID, created)).toMatchObject({ 'Source DB cluster': cluster.id, Engine: cluster.engine });
  expect(await snapshotDirect(ctx, port, created)).toEqual({
    id: created, source: cluster.id, engine: cluster.engine, status: 'available',
  });
});

test('studio.rds-restore-an-orphaned-cluster-snapshot', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { prefix, cluster } = await clusterFixture(ctx, port, 'rdsrestore');
  const id = prefix + '-snap';
  const restored = prefix + '-restored';
  await seedSnapshot(ctx, port, cluster.id, id);
  expect((await rds(ctx, port, 'DeleteDBCluster', {
    DBClusterIdentifier: cluster.id, SkipFinalSnapshot: 'true',
  })).status).toBe(200);
  expect(await reportsNoCluster(ctx, port, cluster.id)).toBe(true);
  await open(page, CLUSTERS_PATH, 'DB clusters');
  const main = page.getByRole('main');
  // The page's own link: the side navigation, inside `main`, holds an entry of the same name (issue 650).
  await main
    .getByRole('link', { name: 'DB cluster snapshots' })
    .and(page.locator(`:not(${SIDE_NAVIGATION} *)`))
    .click(ACTION);
  await expect(page).toHaveURL(addressOf(SNAPSHOTS));
  const table = tableOf(main, 'DB cluster snapshots');
  await expectCell(table, SNAPSHOT_ID, id, 'Source DB cluster', cluster.id);
  await selectRow(table, SNAPSHOT_ID, id);
  await button(main, 'Restore').click(ACTION);
  const dialog = dialogOf(page);
  await field(dialog, 'DB cluster identifier').getByRole('textbox').fill(restored, ACTION);
  await button(dialog, 'Restore').click(ACTION);
  await expect(page).toHaveURL(addressOf(clusterPath(restored)));
  await expectFlash(page, 'success', 'Restoring DB cluster ' + restored);
  await expectValueIs(page, 'Status', 'available');
  const empty = emptyOf(tableOf(main, 'DB instances'));
  await expect(empty).toContainText('No DB instances');
  await expect(empty.getByRole('button', { name: 'Add DB instance' }).or(
    empty.getByRole('link', { name: 'Add DB instance' }),
  )).toHaveAttribute('href', addInstancePath(restored));
  expect(await clusterDirect(ctx, port, restored)).toMatchObject({ id: restored, engine: cluster.engine, status: 'available', members: [] });
});

test('studio.rds-delete-a-cluster-snapshot', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const { prefix, cluster } = await clusterFixture(ctx, port, 'rdsdelete');
  const id = prefix + '-snap';
  const retained = prefix + '-keep';
  await seedSnapshot(ctx, port, cluster.id, retained);
  await seedSnapshot(ctx, port, cluster.id, id);
  await open(page, SNAPSHOTS, 'DB cluster snapshots');
  const main = page.getByRole('main');
  const table = tableOf(main, 'DB cluster snapshots');
  const deletes = countActions(page, 'DeleteDBClusterSnapshot');
  await selectRow(table, SNAPSHOT_ID, id);
  await button(main, 'Delete').click(ACTION);
  await cancelDialog(page);
  expect(deletes.count()).toBe(0);
  expect(await snapshotDirect(ctx, port, id)).toMatchObject({ id, status: 'available' });
  await rowOf(table, SNAPSHOT_ID, id);
  await button(main, 'Delete').click(ACTION);
  await confirmWith(page, 'delete', 'Delete');
  await expectFlash(page, 'success', 'DB cluster snapshot ' + id + ' deleted');
  await expect.poll(async () => {
    const ids = (await rowsOf(table)).map(row => row[SNAPSHOT_ID]);
    return { retained: ids.includes(retained), deleted: ids.includes(id) };
  }).toEqual({ retained: true, deleted: false });
  expect(await snapshotDirect(ctx, port, id)).toBeNull();
});

test('studio.rds-cluster-snapshots-follow-an-emulator-restart', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const { emulator, emulatorPort: port } = await startStack(ctx, { ownEmulator: true });
  const { prefix, cluster } = await clusterFixture(ctx, port, 'rdssnaprestart');
  const id = prefix + '-snap';
  await seedSnapshot(ctx, port, cluster.id, id);
  await open(page, SNAPSHOTS, 'DB cluster snapshots');
  const table = tableOf(page.getByRole('main'), 'DB cluster snapshots');
  await rowOf(table, SNAPSHOT_ID, id);
  await emulator!.stop();
  await expectLine(page, notStartedOn(port));
  await emulator!.startAgain();
  await expectLine(page, connectedAt(port), 60_000);
  await expect(emptyOf(table)).toContainText('No DB cluster snapshots', { timeout: 60_000 });
  await expectNoRow(table, SNAPSHOT_ID, id);
  const answer = await rds(ctx, port, 'DescribeDBClusterSnapshots', { SnapshotType: 'manual' });
  expect(answer.status).toBe(200);
  expect(xmlField(answer.root, 'DescribeDBClusterSnapshotsResult', 'DBClusterSnapshots')?.children).toEqual([]);
});
