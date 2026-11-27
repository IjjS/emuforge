import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { actOnInstance, getClusterSignIn, getInstance, listInstances } from './api';

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

const FULL = `<DBInstance>
  <DBInstanceIdentifier>app-db</DBInstanceIdentifier>
  <DBInstanceClass>db.t3.micro</DBInstanceClass>
  <Engine>postgres</Engine>
  <DBInstanceStatus>available</DBInstanceStatus>
  <MasterUsername>admin1</MasterUsername>
  <DBName>app</DBName>
  <Endpoint><Address>0.0.0.0</Address><Port>41234</Port></Endpoint>
  <AllocatedStorage>20</AllocatedStorage>
  <InstanceCreateTime>2026-11-20T01:02:03.000Z</InstanceCreateTime>
  <VpcSecurityGroups><VpcSecurityGroupMembership><VpcSecurityGroupId>sg-1</VpcSecurityGroupId><Status>active</Status></VpcSecurityGroupMembership></VpcSecurityGroups>
  <DBParameterGroups><DBParameterGroup><DBParameterGroupName>default.postgres18</DBParameterGroupName><ParameterApplyStatus>in-sync</ParameterApplyStatus></DBParameterGroup></DBParameterGroups>
  <AvailabilityZone>us-east-1a</AvailabilityZone>
  <DBSubnetGroup><DBSubnetGroupName>default</DBSubnetGroupName><VpcId>vpc-1</VpcId><Subnets><Subnet><SubnetIdentifier>subnet-1</SubnetIdentifier></Subnet><Subnet><SubnetIdentifier>subnet-2</SubnetIdentifier></Subnet></Subnets></DBSubnetGroup>
  <PendingModifiedValues><MasterUserPassword>****</MasterUserPassword></PendingModifiedValues>
  <EngineVersion>18.3</EngineVersion>
  <StorageType>gp2</StorageType>
  <Iops>3000</Iops>
  <MultiAZ>false</MultiAZ>
  <DbiResourceId>db-ABC123</DbiResourceId>
  <DBInstanceArn>arn:aws:rds:us-east-1:000000000000:db:app-db</DBInstanceArn>
  <DeletionProtection>true</DeletionProtection>
  <TagList><Tag><Key>env</Key><Value>dev</Value></Tag><Tag><Key>team</Key><Value>a &amp; b</Value></Tag></TagList>
</DBInstance>`;

const BARE = (id: string, status = 'available', more = '') =>
  `<DBInstance><DBInstanceIdentifier>${id}</DBInstanceIdentifier><DBInstanceStatus>${status}</DBInstanceStatus><Engine>aurora-postgresql</Engine><EngineVersion>16.4</EngineVersion><DBInstanceClass>db.r6g.large</DBInstanceClass><Endpoint><Address>0.0.0.0</Address><Port>40001</Port></Endpoint><InstanceCreateTime>2026-11-20T00:00:00.000Z</InstanceCreateTime><DeletionProtection>false</DeletionProtection>${more}</DBInstance>`;

const instances = (...items: string[]) => `<DBInstances>${items.join('')}</DBInstances>`;

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

describe('the instances page', () => {
  it('MaxRecords 50, no Marker for the first page; the instances in order with their values; the next marker', async () => {
    engine.on('DescribeDBInstances', () =>
      ok(
        'DescribeDBInstances',
        `${instances(BARE('b-member', 'creating', '<DBClusterIdentifier>aur-1</DBClusterIdentifier>'), BARE('a-other', 'stopped'))}<Marker>m-2</Marker>`,
      ),
    );
    const page = await listInstances(endpoint, undefined, signal());
    const [sent] = engine.of('DescribeDBInstances');
    expect(sent?.params.get('MaxRecords')).toBe('50');
    expect(sent?.params.has('Marker')).toBe(false);
    expect(page.marker).toBe('m-2');
    expect(page.instances.map((instance) => instance.id)).toEqual(['b-member', 'a-other']);
    expect(page.instances[0]).toEqual({
      id: 'b-member',
      status: 'creating',
      engine: 'aurora-postgresql',
      engineVersion: '16.4',
      instanceClass: 'db.r6g.large',
      clusterId: 'aur-1',
      address: '0.0.0.0',
      port: 40001,
      createdAt: new Date('2026-11-20T00:00:00.000Z'),
      deletionProtection: false,
      parameterGroups: [],
      securityGroups: [],
      tags: [],
    });
    expect(page.instances[1]?.clusterId).toBeUndefined();
  });

  it('the marker when given; an answer without one → no next marker', async () => {
    engine.on('DescribeDBInstances', () => ok('DescribeDBInstances', instances(BARE('c'))));
    const page = await listInstances(endpoint, 'm-2', signal());
    expect(engine.of('DescribeDBInstances')[0]?.params.get('Marker')).toBe('m-2');
    expect(engine.of('DescribeDBInstances')[0]?.params.get('MaxRecords')).toBe('50');
    expect(page.marker).toBeUndefined();
    expect('marker' in page).toBe(false);
  });
});

describe('an instance', () => {
  it('asked by DBInstanceIdentifier; every value S3 shows', async () => {
    engine.on('DescribeDBInstances', () => ok('DescribeDBInstances', instances(FULL)));
    const read = await getInstance(endpoint, 'app-db', signal());
    expect(engine.of('DescribeDBInstances')[0]?.params.get('DBInstanceIdentifier')).toBe('app-db');
    expect(read).toEqual({
      found: true,
      instance: {
        id: 'app-db',
        status: 'available',
        engine: 'postgres',
        engineVersion: '18.3',
        instanceClass: 'db.t3.micro',
        address: '0.0.0.0',
        port: 41234,
        createdAt: new Date('2026-11-20T01:02:03.000Z'),
        masterUsername: 'admin1',
        dbName: 'app',
        allocatedStorage: 20,
        storageType: 'gp2',
        iops: 3000,
        multiAz: false,
        zone: 'us-east-1a',
        arn: 'arn:aws:rds:us-east-1:000000000000:db:app-db',
        resourceId: 'db-ABC123',
        parameterGroups: ['default.postgres18'],
        subnetGroup: { name: 'default', vpcId: 'vpc-1', subnets: ['subnet-1', 'subnet-2'] },
        securityGroups: [{ id: 'sg-1', status: 'active' }],
        deletionProtection: true,
        tags: [
          { key: 'env', value: 'dev' },
          { key: 'team', value: 'a & b' },
        ],
      },
    });
  });

  it('an absent value is absent', async () => {
    engine.on('DescribeDBInstances', () => ok('DescribeDBInstances', instances(BARE('m-1'))));
    const read = await getInstance(endpoint, 'm-1', signal());
    const instance = read.found ? read.instance : undefined;
    expect(instance).toBeDefined();
    for (const key of [
      'masterUsername',
      'dbName',
      'allocatedStorage',
      'storageType',
      'iops',
      'multiAz',
      'zone',
      'arn',
      'subnetGroup',
    ]) {
      expect(instance && key in instance, key).toBe(false);
    }
  });

  it('a masked password in PendingModifiedValues → nothing of it is in the result', async () => {
    engine.on('DescribeDBInstances', () => ok('DescribeDBInstances', instances(FULL)));
    const read = await getInstance(endpoint, 'app-db', signal());
    const json = JSON.stringify(read);
    expect(json).not.toContain('****');
    expect(json.toLowerCase()).not.toContain('password');
    expect(json).not.toContain('PendingModifiedValues');
  });

  it('DBInstanceNotFound → "not found", not a failure', async () => {
    engine.on('DescribeDBInstances', () => refused('DBInstanceNotFound', 'DBInstance gone not found.', 404));
    await expect(getInstance(endpoint, 'gone', signal())).resolves.toEqual({ found: false });
  });
});

describe("a member's DB cluster", () => {
  it('asked by DBClusterIdentifier → its master user name and database name; one it does not hold → none', async () => {
    engine.on('DescribeDBClusters', () =>
      ok(
        'DescribeDBClusters',
        '<DBClusters><DBCluster><DBClusterIdentifier>aur-1</DBClusterIdentifier><MasterUsername>clusteradmin</MasterUsername><DatabaseName>cdb</DatabaseName></DBCluster></DBClusters>',
      ),
    );
    await expect(getClusterSignIn(endpoint, 'aur-1', signal())).resolves.toEqual({
      masterUsername: 'clusteradmin',
      databaseName: 'cdb',
    });
    expect(engine.of('DescribeDBClusters')[0]?.params.get('DBClusterIdentifier')).toBe('aur-1');
    engine.on('DescribeDBClusters', () => refused('DBClusterNotFoundFault', 'DBCluster gone not found.', 404));
    await expect(getClusterSignIn(endpoint, 'gone', signal())).resolves.toEqual({});
  });
});

describe('the actions', () => {
  it('start, stop, reboot → each its operation with the one identifier; delete with SkipFinalSnapshot true', async () => {
    await actOnInstance(endpoint, 'start', 'db-1', signal());
    await actOnInstance(endpoint, 'stop', 'db-2', signal());
    await actOnInstance(endpoint, 'reboot', 'db-3', signal());
    await actOnInstance(endpoint, 'delete', 'db-4', signal());
    expect(
      engine.sent.map((sent) => [
        sent.action,
        sent.params.get('DBInstanceIdentifier'),
        sent.params.get('SkipFinalSnapshot'),
        sent.params.has('FinalDBSnapshotIdentifier'),
      ]),
    ).toEqual([
      ['StartDBInstance', 'db-1', null, false],
      ['StopDBInstance', 'db-2', null, false],
      ['RebootDBInstance', 'db-3', null, false],
      ['DeleteDBInstance', 'db-4', 'true', false],
    ]);
  });

  it('a refusal → a failure with the code and message as they came', async () => {
    engine.on('StopDBInstance', () => refused('InvalidDBInstanceState', 'Instance db-1 is not in available state.'));
    expect(await failureOf(actOnInstance(endpoint, 'stop', 'db-1', signal()))).toEqual({
      kind: 'other',
      operation: 'StopDBInstance',
      code: 'InvalidDBInstanceState',
      message: 'Instance db-1 is not in available state.',
    });
    const protectedMessage = 'Cannot delete protected DB Instance, please disable deletion protection and try again.';
    engine.on('DeleteDBInstance', () => refused('InvalidParameterCombination', protectedMessage));
    expect(await failureOf(actOnInstance(endpoint, 'delete', 'db-1', signal()))).toEqual({
      kind: 'other',
      operation: 'DeleteDBInstance',
      code: 'InvalidParameterCombination',
      message: protectedMessage,
    });
    engine.on('RebootDBInstance', () => refused('DBInstanceNotFound', 'DBInstance db-9 not found.', 404));
    expect(await failureOf(actOnInstance(endpoint, 'reboot', 'db-9', signal()))).toEqual({
      kind: 'other',
      operation: 'RebootDBInstance',
      code: 'DBInstanceNotFound',
      message: 'DBInstance db-9 not found.',
    });
  });
});

describe('every call', () => {
  const calls: [string, (abort: AbortSignal) => Promise<unknown>][] = [
    ['DescribeDBInstances', (abort) => listInstances(endpoint, undefined, abort)],
    ['DescribeDBInstances', (abort) => getInstance(endpoint, 'db-1', abort)],
    ['DescribeDBClusters', (abort) => getClusterSignIn(endpoint, 'aur-1', abort)],
    ['StartDBInstance', (abort) => actOnInstance(endpoint, 'start', 'db-1', abort)],
    ['StopDBInstance', (abort) => actOnInstance(endpoint, 'stop', 'db-1', abort)],
    ['RebootDBInstance', (abort) => actOnInstance(endpoint, 'reboot', 'db-1', abort)],
    ['DeleteDBInstance', (abort) => actOnInstance(endpoint, 'delete', 'db-1', abort)],
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
