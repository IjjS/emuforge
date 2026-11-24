import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import {
  createClusterSnapshot,
  deleteClusterSnapshot,
  listClusterSnapshots,
  restoreClusterSnapshot,
} from './cluster-snapshot-api';

const ENDPOINT = engineEndpoint(9858);
const sent: URLSearchParams[] = [];

function xmlResult(action: string, body: string) {
  return new Response(
    `<${action}Response xmlns="http://rds.amazonaws.com/doc/2014-10-31/"><${action}Result>${body}</${action}Result></${action}Response>`,
    { headers: { 'content-type': 'text/xml' } },
  );
}

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-snapshot-test-token' }));
    }
    const params = new URLSearchParams(await request.text());
    sent.push(params);
    const action = params.get('Action') ?? '';
    if (action === 'DescribeDBClusterSnapshots') {
      const marker = params.has('Marker') ? '' : '<Marker>continuation</Marker>';
      return xmlResult(
        action,
        `<DBClusterSnapshots><DBClusterSnapshot>
        <DBClusterSnapshotIdentifier>external-snap</DBClusterSnapshotIdentifier>
        <DBClusterIdentifier>former-cluster</DBClusterIdentifier>
        <Engine>aurora-postgresql</Engine>
        <Status>available</Status>
        </DBClusterSnapshot></DBClusterSnapshots>${marker}`,
      );
    }
    if (action === 'RestoreDBClusterFromSnapshot') {
      return xmlResult(action, '<DBCluster><DBClusterIdentifier>restored-db</DBClusterIdentifier></DBCluster>');
    }
    return xmlResult(action, '');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RDS cluster snapshot requests', () => {
  it('uses the manual filter and service Marker for each page', async () => {
    const signal = new AbortController().signal;
    const first = await listClusterSnapshots(ENDPOINT, undefined, signal);
    expect(first).toEqual({
      items: [{ id: 'external-snap', sourceId: 'former-cluster', engine: 'aurora-postgresql', status: 'available' }],
      next: 'continuation',
    });
    expect(await listClusterSnapshots(ENDPOINT, first.next, signal)).toEqual({ items: first.items });
    expect(
      sent.map((params) => [
        params.get('Action'),
        params.get('SnapshotType'),
        params.get('MaxRecords'),
        params.get('Marker'),
      ]),
    ).toEqual([
      ['DescribeDBClusterSnapshots', 'manual', '20', null],
      ['DescribeDBClusterSnapshots', 'manual', '20', 'continuation'],
    ]);
  });

  it('sends the selected identifiers for creation, restoration and deletion', async () => {
    const signal = new AbortController().signal;
    await createClusterSnapshot(ENDPOINT, 'source-db', 'new-snap', signal);
    expect(await restoreClusterSnapshot(ENDPOINT, 'new-snap', 'aurora-postgresql', 'Restored-DB', signal)).toBe(
      'restored-db',
    );
    await deleteClusterSnapshot(ENDPOINT, 'new-snap', signal);

    expect(sent.map((params) => Object.fromEntries(params))).toEqual([
      {
        Action: 'CreateDBClusterSnapshot',
        Version: '2014-10-31',
        DBClusterIdentifier: 'source-db',
        DBClusterSnapshotIdentifier: 'new-snap',
      },
      {
        Action: 'RestoreDBClusterFromSnapshot',
        Version: '2014-10-31',
        DBClusterIdentifier: 'Restored-DB',
        SnapshotIdentifier: 'new-snap',
        Engine: 'aurora-postgresql',
      },
      {
        Action: 'DeleteDBClusterSnapshot',
        Version: '2014-10-31',
        DBClusterSnapshotIdentifier: 'new-snap',
      },
    ]);
  });
});
