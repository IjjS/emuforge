import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, type Ctx } from '../../support/check';
import { ACTION } from '../../support/frame';
import { button, rds, rdsPrefix, RdsSeeded, runPassword, type Xml } from './rds';

export const SNAPSHOTS = '/aws/rds/cluster-snapshots';
export const SNAPSHOT_ID = 'DB cluster snapshot identifier';

export async function clusterFixture(ctx: Ctx, port: number, tag: string, protection = false) {
  const prefix = rdsPrefix(ctx, tag);
  const seeded = new RdsSeeded(ctx, port, prefix);
  const cluster = await seeded.cluster({
    id: prefix + '-source', engine: 'aurora-postgresql', masterUsername: 'dbadmin', password: runPassword(), protection,
  });
  return { prefix, cluster, seeded };
}

export async function clusterAction(page: Page, id: 'stop' | 'start' | 'modify' | 'failover') {
  await button(page.getByRole('main'), 'Actions').click(ACTION);
  await page.locator(createWrapper().findButtonDropdown().findItemById(id).toSelector()).click(ACTION);
}

export function xmlField(root: Xml, ...names: string[]) {
  let node: Xml | undefined = root;
  for (const name of names) node = node?.children.find((child) => child.name === name);
  return node;
}

export async function snapshotDirect(ctx: Ctx, port: number, id: string) {
  const answer = await rds(ctx, port, 'DescribeDBClusterSnapshots', { DBClusterSnapshotIdentifier: id });
  if (answer.code === 'DBClusterSnapshotNotFoundFault') return null;
  expect(answer.status).toBe(200);
  const row = xmlField(answer.root, 'DescribeDBClusterSnapshotsResult', 'DBClusterSnapshots', 'DBClusterSnapshot');
  if (!row) return null;
  return {
    id: xmlField(row, 'DBClusterSnapshotIdentifier')?.text, source: xmlField(row, 'DBClusterIdentifier')?.text,
    engine: xmlField(row, 'Engine')?.text, status: xmlField(row, 'Status')?.text,
  };
}

export function ownSnapshot(ctx: Ctx, port: number, id: string) {
  ctx.own({ async dispose() {
    const answer = await rds(ctx, port, 'DeleteDBClusterSnapshot', { DBClusterSnapshotIdentifier: id });
    if (answer.status !== 200 && answer.code !== 'DBClusterSnapshotNotFoundFault') {
      throw new Error('Snapshot cleanup failed for ' + id + ': ' + answer.code);
    }
  } });
}

export async function seedSnapshot(ctx: Ctx, port: number, cluster: string, id: string) {
  ownSnapshot(ctx, port, id);
  const answer = await rds(ctx, port, 'CreateDBClusterSnapshot', {
    DBClusterIdentifier: cluster, DBClusterSnapshotIdentifier: id,
  });
  expect(answer.status).toBe(200);
  await expect.poll(() => snapshotDirect(ctx, port, id), { timeout: 60_000 }).toMatchObject({ status: 'available' });
}
