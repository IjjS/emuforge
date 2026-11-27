import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import type { ClusterOperation } from './cluster-operations';
import { addInstance, deleteCluster, getCluster, listClusters, listMembers, operateCluster } from './cluster-api';

// The test plays the engine behind the page's `fetch`: its session route, and each request as it leaves the browser,
// answered in RDS's query protocol (form in, XML out) as the emulator answers.

const XMLNS = 'http://rds.amazonaws.com/doc/2014-10-31/';

interface Answer {
  status: number;
  body: string;
}

interface Sent {
  action: string;
  params: URLSearchParams;
}

type Handler = (sent: Sent) => Answer | 'hold';

class FakeEngine {
  readonly sent: Sent[] = [];
  readonly handlers = new Map<string, Handler>();

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-573' }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const sent = { action: params.get('Action') ?? '', params };
    this.sent.push(sent);
    const answer = this.handlers.get(sent.action)?.(sent) ?? ok(sent.action, '');
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/xml' } });
  };

  on(action: string, handler: Handler) {
    this.handlers.set(action, handler);
  }

  of(action: string): Sent[] {
    return this.sent.filter((sent) => sent.action === action);
  }
}

function ok(action: string, body: string): Answer {
  return {
    status: 200,
    body: `<${action}Response xmlns="${XMLNS}"><${action}Result>${body}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
  };
}

function refused(code: string, message: string, status = 400): Answer {
  return {
    status,
    body: `<ErrorResponse xmlns="${XMLNS}"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
  };
}

const notImplemented: Answer = { status: 501, body: '' };

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9800;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;

async function failureOf(pending: Promise<unknown>) {
  const error: unknown = await pending.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(RequestError);
  return (error as RequestError).failure;
}

const FULL = `<DBCluster>
  <DBClusterIdentifier>app-aur</DBClusterIdentifier>
  <Status>available</Status>
  <Engine>aurora-postgresql</Engine>
  <EngineVersion>16.4</EngineVersion>
  <Port>5432</Port>
  <ClusterCreateTime>2026-11-20T01:02:03.000Z</ClusterCreateTime>
  <Endpoint>app-aur.cluster-x.us-east-1.rds.amazonaws.com</Endpoint>
  <ReaderEndpoint>app-aur.cluster-ro-x.us-east-1.rds.amazonaws.com</ReaderEndpoint>
  <MasterUsername>admin1</MasterUsername>
  <DatabaseName>aurdb</DatabaseName>
  <DBClusterArn>arn:aws:rds:us-east-1:000000000000:cluster:app-aur</DBClusterArn>
  <DbClusterResourceId>cluster-ABC</DbClusterResourceId>
  <DBSubnetGroup>default</DBSubnetGroup>
  <StorageType>aurora</StorageType>
  <VpcSecurityGroups><VpcSecurityGroupMembership><VpcSecurityGroupId>sg-1</VpcSecurityGroupId><Status>active</Status></VpcSecurityGroupMembership></VpcSecurityGroups>
  <DBClusterParameterGroup>default.aurora-postgresql16</DBClusterParameterGroup>
  <DBClusterMembers>
    <DBClusterMember><DBInstanceIdentifier>app-aur-1</DBInstanceIdentifier><IsClusterWriter>true</IsClusterWriter></DBClusterMember>
    <DBClusterMember><DBInstanceIdentifier>app-aur-2</DBInstanceIdentifier><IsClusterWriter>false</IsClusterWriter></DBClusterMember>
  </DBClusterMembers>
  <DeletionProtection>true</DeletionProtection>
  <BackupRetentionPeriod>7</BackupRetentionPeriod>
  <TagList><Tag><Key>env</Key><Value>dev</Value></Tag></TagList>
</DBCluster>`;

const BARE = (id: string, status = 'available') =>
  `<DBCluster><DBClusterIdentifier>${id}</DBClusterIdentifier><Status>${status}</Status><Engine>aurora-mysql</Engine><EngineVersion>8.0</EngineVersion><Port>3306</Port><ClusterCreateTime>2026-11-20T00:00:00.000Z</ClusterCreateTime><DeletionProtection>false</DeletionProtection></DBCluster>`;

const clusters = (...items: string[]) => `<DBClusters>${items.join('')}</DBClusters>`;

describe('the clusters page', () => {
  it('MaxRecords 50 and the Marker; each cluster in order with its values; the next marker', async () => {
    engine.on('DescribeDBClusters', (sent) =>
      ok(
        'DescribeDBClusters',
        `${clusters(FULL, BARE('b-aur', 'creating'))}${sent.params.has('Marker') ? '' : '<Marker>m1</Marker>'}`,
      ),
    );
    const page = await listClusters(endpoint, undefined, signal());
    const first = engine.of('DescribeDBClusters')[0]?.params;
    expect(first?.get('MaxRecords')).toBe('50');
    expect(first?.has('Marker')).toBe(false);
    expect(page.marker).toBe('m1');
    expect(
      page.clusters.map((c) => [
        c.id,
        c.status,
        c.engine,
        c.engineVersion,
        c.members.length,
        c.port,
        c.createdAt?.toISOString(),
        c.deletionProtection,
      ]),
    ).toEqual([
      ['app-aur', 'available', 'aurora-postgresql', '16.4', 2, 5432, '2026-11-20T01:02:03.000Z', true],
      ['b-aur', 'creating', 'aurora-mysql', '8.0', 0, 3306, '2026-11-20T00:00:00.000Z', false],
    ]);

    const next = await listClusters(endpoint, 'm1', signal());
    expect(engine.of('DescribeDBClusters')[1]?.params.get('Marker')).toBe('m1');
    expect(next.marker).toBeUndefined();
  });
});

describe('one cluster', () => {
  it('asked by DBClusterIdentifier; every value S6 shows', async () => {
    engine.on('DescribeDBClusters', () => ok('DescribeDBClusters', clusters(FULL)));
    const read = await getCluster(endpoint, 'app-aur', signal());
    expect(engine.of('DescribeDBClusters')[0]?.params.get('DBClusterIdentifier')).toBe('app-aur');
    expect(read).toEqual({
      found: true,
      cluster: {
        id: 'app-aur',
        status: 'available',
        engine: 'aurora-postgresql',
        engineVersion: '16.4',
        port: 5432,
        createdAt: new Date('2026-11-20T01:02:03.000Z'),
        endpoint: 'app-aur.cluster-x.us-east-1.rds.amazonaws.com',
        readerEndpoint: 'app-aur.cluster-ro-x.us-east-1.rds.amazonaws.com',
        masterUsername: 'admin1',
        databaseName: 'aurdb',
        arn: 'arn:aws:rds:us-east-1:000000000000:cluster:app-aur',
        resourceId: 'cluster-ABC',
        subnetGroup: 'default',
        storageType: 'aurora',
        securityGroups: ['sg-1'],
        parameterGroup: 'default.aurora-postgresql16',
        members: [
          { id: 'app-aur-1', writer: true },
          { id: 'app-aur-2', writer: false },
        ],
        deletionProtection: true,
        backupRetentionPeriod: 7,
        tags: [{ key: 'env', value: 'dev' }],
      },
    });
  });

  it('an absent value is absent', async () => {
    engine.on('DescribeDBClusters', () =>
      ok('DescribeDBClusters', clusters('<DBCluster><DBClusterIdentifier>x</DBClusterIdentifier></DBCluster>')),
    );
    expect(await getCluster(endpoint, 'x', signal())).toEqual({
      found: true,
      cluster: { id: 'x', status: '', securityGroups: [], members: [], deletionProtection: false, tags: [] },
    });
  });

  it('DBClusterNotFoundFault → "not found", not a failure', async () => {
    engine.on('DescribeDBClusters', () => refused('DBClusterNotFoundFault', 'DBCluster nope not found.', 404));
    expect(await getCluster(endpoint, 'nope', signal())).toEqual({ found: false });
  });
});

describe('the members', () => {
  it('DescribeDBInstances with the filter db-cluster-id and MaxRecords 100; each as an instance of the list', async () => {
    engine.on('DescribeDBInstances', () =>
      ok(
        'DescribeDBInstances',
        `<DBInstances><DBInstance><DBInstanceIdentifier>app-aur-1</DBInstanceIdentifier><DBInstanceStatus>available</DBInstanceStatus><Engine>aurora-postgresql</Engine><DBInstanceClass>db.r6g.large</DBInstanceClass><AvailabilityZone>us-east-1a</AvailabilityZone><DBClusterIdentifier>app-aur</DBClusterIdentifier><Endpoint><Address>0.0.0.0</Address><Port>40001</Port></Endpoint></DBInstance></DBInstances>`,
      ),
    );
    const members = await listMembers(endpoint, 'app-aur', signal());
    const params = engine.of('DescribeDBInstances')[0]?.params;
    expect(params?.get('MaxRecords')).toBe('100');
    expect(params?.get('Filters.Filter.1.Name')).toBe('db-cluster-id');
    expect(params?.get('Filters.Filter.1.Values.Value.1')).toBe('app-aur');
    expect(members).toEqual([
      {
        id: 'app-aur-1',
        status: 'available',
        engine: 'aurora-postgresql',
        instanceClass: 'db.r6g.large',
        zone: 'us-east-1a',
        clusterId: 'app-aur',
        address: '0.0.0.0',
        port: 40001,
        parameterGroups: [],
        securityGroups: [],
        deletionProtection: false,
        tags: [],
      },
    ]);
  });
});

describe('the changes', () => {
  it('delete → DeleteDBCluster with the identifier and SkipFinalSnapshot true', async () => {
    await deleteCluster(endpoint, 'app-aur', signal());
    const params = engine.of('DeleteDBCluster')[0]?.params;
    expect(params?.get('DBClusterIdentifier')).toBe('app-aur');
    expect(params?.get('SkipFinalSnapshot')).toBe('true');
  });

  it("add an instance → CreateDBInstance with the five values and nothing else; the answer's identifier", async () => {
    engine.on('CreateDBInstance', () =>
      ok('CreateDBInstance', '<DBInstance><DBInstanceIdentifier>app-aur-3</DBInstanceIdentifier></DBInstance>'),
    );
    const id = await addInstance(
      endpoint,
      {
        id: 'App-Aur-3',
        clusterId: 'app-aur',
        engine: 'aurora-postgresql',
        engineVersion: '16.4',
        instanceClass: 'db.r6g.large',
      },
      signal(),
    );
    expect(id).toBe('app-aur-3');
    const params = engine.of('CreateDBInstance')[0]?.params;
    const sent = Object.fromEntries(
      [...(params?.entries() ?? [])].filter(([key]) => key !== 'Action' && key !== 'Version'),
    );
    expect(sent).toEqual({
      DBInstanceIdentifier: 'App-Aur-3',
      DBClusterIdentifier: 'app-aur',
      Engine: 'aurora-postgresql',
      EngineVersion: '16.4',
      DBInstanceClass: 'db.r6g.large',
    });
  });

  it('sends the chosen zone and tags on the member', async () => {
    await addInstance(
      endpoint,
      {
        id: 'app-aur-3',
        clusterId: 'app-aur',
        engine: 'aurora-postgresql',
        engineVersion: '16.4',
        instanceClass: 'db.r6g.large',
        zone: 'us-east-1a',
        tags: [{ key: 'env', value: 'dev' }],
      },
      signal(),
    );
    expect(Object.fromEntries(engine.sent[0]?.params ?? [])).toMatchObject({
      AvailabilityZone: 'us-east-1a',
      'Tags.Tag.1.Key': 'env',
      'Tags.Tag.1.Value': 'dev',
    });
  });

  it('a refusal → a failure with the code and message as they came', async () => {
    const cases: [string, string, () => Promise<unknown>][] = [
      ['DeleteDBCluster', 'InvalidDBClusterStateFault', () => deleteCluster(endpoint, 'app-aur', signal())],
      ['DeleteDBCluster', 'DBClusterNotFoundFault', () => deleteCluster(endpoint, 'gone', signal())],
      [
        'CreateDBInstance',
        'InvalidParameterCombination',
        () =>
          addInstance(
            endpoint,
            { id: 'a', clusterId: 'c', engine: 'aurora-mysql', engineVersion: '8.0', instanceClass: 'db.nosuch.large' },
            signal(),
          ),
      ],
    ];
    for (const [operation, code, call] of cases) {
      engine.on(operation, () => refused(code, `${code} as it came.`, code === 'DBClusterNotFoundFault' ? 404 : 400));
      expect(await failureOf(call())).toEqual({ kind: 'other', operation, code, message: `${code} as it came.` });
    }
  });
});

describe('every call', () => {
  const member = {
    id: 'a',
    clusterId: 'c',
    engine: 'aurora-mysql',
    engineVersion: '8.0',
    instanceClass: 'db.r6g.large',
  };
  const calls: [string, (abort: AbortSignal) => Promise<unknown>][] = [
    ['DescribeDBClusters', (abort) => listClusters(endpoint, undefined, abort)],
    ['DescribeDBClusters', (abort) => getCluster(endpoint, 'c', abort)],
    ['DescribeDBInstances', (abort) => listMembers(endpoint, 'c', abort)],
    ['DeleteDBCluster', (abort) => deleteCluster(endpoint, 'c', abort)],
    ['CreateDBInstance', (abort) => addInstance(endpoint, member, abort)],
  ];
  for (const [operation, call] of calls) {
    it(`${operation}: a 501 → "not implemented" with the operation's name`, async () => {
      engine.on(operation, () => notImplemented);
      expect(await failureOf(call(signal()))).toEqual({ kind: 'not-implemented', operation });
    });
    it(`${operation}: an aborted signal ends the request`, async () => {
      engine.on(operation, () => 'hold');
      const controller = new AbortController();
      const pending = call(controller.signal);
      await vi.waitFor(() => {
        expect(engine.of(operation)).toHaveLength(1);
      });
      const reason = new Error('left the page');
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    });
  }
});

describe('cluster operations', () => {
  const cases: [string, ClusterOperation, Record<string, string>][] = [
    ['StopDBCluster', { kind: 'stop' }, {}],
    ['StartDBCluster', { kind: 'start' }, {}],
    [
      'ModifyDBCluster',
      { kind: 'modify', changes: { deletionProtection: false } },
      { ApplyImmediately: 'true', DeletionProtection: 'false' },
    ],
    [
      'ModifyDBCluster',
      { kind: 'modify', changes: { backupRetentionPeriod: 35 } },
      { ApplyImmediately: 'true', BackupRetentionPeriod: '35' },
    ],
    ['FailoverDBCluster', { kind: 'failover', target: 'app-aur-3' }, { TargetDBInstanceIdentifier: 'app-aur-3' }],
  ];

  it.each(cases)('sends %s with only the selected fields', async (operation, action, fields) => {
    await expect(operateCluster(endpoint, 'app-aur', action, signal())).resolves.toBe('app-aur');
    expect(engine.sent.map((request) => Object.fromEntries(request.params))).toEqual([
      { Action: operation, Version: '2014-10-31', DBClusterIdentifier: 'app-aur', ...fields },
    ]);
  });

  it.each([
    ['answer-id', 'answer-id'],
    ['app-aur', 'written-id'],
    [undefined, 'written-id'],
  ])('serializes the changed members and reads the rename identifier from %s', async (answered, expected) => {
    engine.on('ModifyDBCluster', () =>
      ok(
        'ModifyDBCluster',
        answered === undefined ? '' : `<DBCluster><DBClusterIdentifier>${answered}</DBClusterIdentifier></DBCluster>`,
      ),
    );
    const id = await operateCluster(
      endpoint,
      'app-aur',
      {
        kind: 'modify',
        changes: {
          newIdentifier: 'written-id',
          version: { version: '17.4', major: true },
          securityGroupIds: ['sg-new'],
          storageType: 'aurora-iopt1',
        },
      },
      signal(),
    );
    expect(id).toBe(expected);
    expect(Object.fromEntries(engine.sent[0]?.params ?? [])).toEqual({
      Action: 'ModifyDBCluster',
      Version: '2014-10-31',
      DBClusterIdentifier: 'app-aur',
      NewDBClusterIdentifier: 'written-id',
      EngineVersion: '17.4',
      AllowMajorVersionUpgrade: 'true',
      'VpcSecurityGroupIds.VpcSecurityGroupId.1': 'sg-new',
      StorageType: 'aurora-iopt1',
      ApplyImmediately: 'true',
    });
  });
});
