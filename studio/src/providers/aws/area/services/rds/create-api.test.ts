import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { createCluster, createInstance } from './create-api';

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
let nextPort = 9880;

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

const PASSWORD = 'pa55-Word!x';

/** The names a request sent, its action and version left out. */
function names(params: URLSearchParams | undefined): string[] {
  return [...(params?.keys() ?? [])].filter((name) => name !== 'Action' && name !== 'Version').sort();
}

const createdInstance = (id: string) =>
  ok(
    'CreateDBInstance',
    `<DBInstance><DBInstanceIdentifier>${id}</DBInstanceIdentifier><DBInstanceStatus>creating</DBInstanceStatus></DBInstance>`,
  );
const createdCluster = (id: string) =>
  ok(
    'CreateDBCluster',
    `<DBCluster><DBClusterIdentifier>${id}</DBClusterIdentifier><Status>creating</Status></DBCluster>`,
  );

describe('a DB instance', () => {
  it('the required values only → those six and nothing else; each engine as the API names it', async () => {
    for (const engineName of ['postgres', 'mysql', 'mariadb']) {
      engine.on('CreateDBInstance', () => createdInstance('app-db'));
      await createInstance(
        endpoint,
        {
          identifier: 'App-DB',
          engine: engineName,
          instanceClass: 'db.t3.micro',
          allocatedStorage: 20,
          masterUsername: 'admin1',
          masterPassword: PASSWORD,
        },
        signal(),
      );
      const sent = engine.of('CreateDBInstance').at(-1)?.params;
      expect(names(sent)).toEqual(
        [
          'AllocatedStorage',
          'DBInstanceClass',
          'DBInstanceIdentifier',
          'Engine',
          'MasterUserPassword',
          'MasterUsername',
        ].sort(),
      );
      expect(sent?.get('DBInstanceIdentifier')).toBe('App-DB');
      expect(sent?.get('Engine')).toBe(engineName);
      expect(sent?.get('DBInstanceClass')).toBe('db.t3.micro');
      expect(sent?.get('AllocatedStorage')).toBe('20');
      expect(sent?.get('MasterUsername')).toBe('admin1');
      expect(sent?.get('MasterUserPassword')).toBe(PASSWORD);
    }
  });

  const instance = {
    identifier: 'app-db',
    engine: 'postgres',
    instanceClass: 'db.t3.micro',
    allocatedStorage: 100,
    masterUsername: 'admin1',
    masterPassword: PASSWORD,
  };

  it('serializes the selected storage type, IOPS, zone, encryption, protection and tags', async () => {
    engine.on('CreateDBInstance', () => createdInstance('app-db'));
    await createInstance(
      endpoint,
      {
        ...instance,
        storageType: 'io1',
        iops: 3000,
        availabilityZone: 'us-east-1a',
        encrypted: true,
        kmsKeyId: 'arn:aws:kms:us-east-1:000000000000:key/test',
        deletionProtection: true,
        tags: [{ key: 'project', value: 'studio' }],
      },
      signal(),
    );

    const sent = engine.of('CreateDBInstance')[0]?.params;
    expect(sent?.get('StorageType')).toBe('io1');
    expect(sent?.get('Iops')).toBe('3000');
    expect(sent?.get('AvailabilityZone')).toBe('us-east-1a');
    expect(sent?.get('StorageEncrypted')).toBe('true');
    expect(sent?.get('KmsKeyId')).toBe('arn:aws:kms:us-east-1:000000000000:key/test');
    expect(sent?.get('DeletionProtection')).toBe('true');
    expect(sent?.get('Tags.Tag.1.Key')).toBe('project');
    expect(sent?.get('Tags.Tag.1.Value')).toBe('studio');
  });

  it('omits unselected storage and key, and sends MultiAZ without a zone', async () => {
    engine.on('CreateDBInstance', () => createdInstance('app-db'));
    await createInstance(
      endpoint,
      {
        ...instance,
        multiAz: true,
        availabilityZone: 'us-east-1a',
        encrypted: true,
      },
      signal(),
    );

    const sent = engine.of('CreateDBInstance')[0]?.params;
    expect(sent?.get('MultiAZ')).toBe('true');
    expect(sent?.get('StorageEncrypted')).toBe('true');
    for (const member of ['StorageType', 'Iops', 'AvailabilityZone', 'KmsKeyId']) {
      expect(sent?.has(member)).toBe(false);
    }
  });

  it("with a version, a database name, a subnet group and two security groups → those too; the answer's identifier as the emulator gave it", async () => {
    engine.on('CreateDBInstance', () => createdInstance('app-db'));
    const id = await createInstance(
      endpoint,
      {
        identifier: 'App-DB',
        engine: 'postgres',
        instanceClass: 'db.t3.micro',
        allocatedStorage: 25,
        masterUsername: 'admin1',
        masterPassword: PASSWORD,
        engineVersion: '17.7',
        dbName: 'app_db1',
        subnetGroupName: 'default',
        securityGroupIds: ['sg-1', 'sg-2'],
      },
      signal(),
    );
    expect(id).toBe('app-db');
    const sent = engine.of('CreateDBInstance')[0]?.params;
    expect(sent?.get('EngineVersion')).toBe('17.7');
    expect(sent?.get('DBName')).toBe('app_db1');
    expect(sent?.get('DBSubnetGroupName')).toBe('default');
    expect(sent?.get('AllocatedStorage')).toBe('25');
    expect(sent?.get('VpcSecurityGroupIds.VpcSecurityGroupId.1')).toBe('sg-1');
    expect(sent?.get('VpcSecurityGroupIds.VpcSecurityGroupId.2')).toBe('sg-2');
  });
});

describe('a DB cluster', () => {
  it('the required values only → those four and nothing else', async () => {
    engine.on('CreateDBCluster', () => createdCluster('aur-1'));
    await createCluster(
      endpoint,
      { identifier: 'aur-1', engine: 'aurora-postgresql', masterUsername: 'admin1', masterPassword: PASSWORD },
      signal(),
    );
    const sent = engine.of('CreateDBCluster')[0]?.params;
    expect(names(sent)).toEqual(['DBClusterIdentifier', 'Engine', 'MasterUserPassword', 'MasterUsername'].sort());
    expect(sent?.get('Engine')).toBe('aurora-postgresql');
    expect(sent?.get('MasterUserPassword')).toBe(PASSWORD);
  });

  it('serializes the selected zones, storage type, encryption, protection and tags', async () => {
    engine.on('CreateDBCluster', () => createdCluster('aur-1'));
    await createCluster(
      endpoint,
      {
        identifier: 'aur-1',
        engine: 'aurora-postgresql',
        masterUsername: 'admin1',
        masterPassword: PASSWORD,
        availabilityZones: ['us-east-1a', 'us-east-1b'],
        storageType: 'aurora-iopt1',
        encrypted: true,
        kmsKeyId: 'arn:aws:kms:us-east-1:000000000000:key/test',
        deletionProtection: true,
        tags: [{ key: 'project', value: 'studio' }],
      },
      signal(),
    );

    const sent = engine.of('CreateDBCluster')[0]?.params;
    expect(sent?.get('AvailabilityZones.AvailabilityZone.1')).toBe('us-east-1a');
    expect(sent?.get('AvailabilityZones.AvailabilityZone.2')).toBe('us-east-1b');
    expect(sent?.get('StorageType')).toBe('aurora-iopt1');
    expect(sent?.get('StorageEncrypted')).toBe('true');
    expect(sent?.get('KmsKeyId')).toBe('arn:aws:kms:us-east-1:000000000000:key/test');
    expect(sent?.get('DeletionProtection')).toBe('true');
    expect(sent?.get('Tags.Tag.1.Key')).toBe('project');
    expect(sent?.get('Tags.Tag.1.Value')).toBe('studio');
  });

  it("with the rest → EngineVersion, DatabaseName, DBSubnetGroupName, VpcSecurityGroupIds; the answer's identifier", async () => {
    engine.on('CreateDBCluster', () => createdCluster('aur-1'));
    const id = await createCluster(
      endpoint,
      {
        identifier: 'Aur-1',
        engine: 'aurora-mysql',
        masterUsername: 'admin1',
        masterPassword: PASSWORD,
        engineVersion: '8.0.mysql_aurora.3.08.0',
        databaseName: 'app',
        subnetGroupName: 'default',
        securityGroupIds: ['sg-1', 'sg-2'],
      },
      signal(),
    );
    expect(id).toBe('aur-1');
    const sent = engine.of('CreateDBCluster')[0]?.params;
    expect(sent?.get('Engine')).toBe('aurora-mysql');
    expect(sent?.get('EngineVersion')).toBe('8.0.mysql_aurora.3.08.0');
    expect(sent?.get('DatabaseName')).toBe('app');
    expect(sent?.has('DBName')).toBe(false);
    expect(sent?.get('DBSubnetGroupName')).toBe('default');
    expect(sent?.get('VpcSecurityGroupIds.VpcSecurityGroupId.1')).toBe('sg-1');
    expect(sent?.get('VpcSecurityGroupIds.VpcSecurityGroupId.2')).toBe('sg-2');
  });
});

describe('a refusal', () => {
  const instance = () =>
    createInstance(
      endpoint,
      {
        identifier: 'app-db',
        engine: 'postgres',
        instanceClass: 'db.nosuch.large',
        allocatedStorage: 20,
        masterUsername: 'admin1',
        masterPassword: PASSWORD,
      },
      signal(),
    );
  const cluster = () =>
    createCluster(
      endpoint,
      { identifier: 'aur-1', engine: 'aurora-postgresql', masterUsername: 'admin1', masterPassword: PASSWORD },
      signal(),
    );

  const cases: [string, string, string, () => Promise<unknown>][] = [
    ['CreateDBInstance', 'DBInstanceAlreadyExists', 'DB instance already exists', instance],
    ['CreateDBCluster', 'DBClusterAlreadyExistsFault', 'DB cluster already exists', cluster],
    ['CreateDBInstance', 'InvalidParameterCombination', 'DBInstanceClass db.nosuch.large is not supported.', instance],
    ['CreateDBInstance', 'InstanceQuotaExceeded', 'Instance quota exceeded', instance],
  ];
  for (const [operation, code, message, call] of cases) {
    it(`${code} → a failure with the code and message, and no password in it`, async () => {
      engine.on(operation, () => refused(code, message));
      const error: unknown = await call().then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(RequestError);
      const failure = (error as RequestError).failure;
      expect(failure).toEqual({ kind: 'other', operation, code, message });
      expect(JSON.stringify(failure)).not.toContain(PASSWORD);
      expect(String((error as RequestError).message)).not.toContain(PASSWORD);
      expect(JSON.stringify(error)).not.toContain(PASSWORD);
    });
  }

  it('a 501 → "not implemented" with CreateDBInstance or CreateDBCluster', async () => {
    engine.on('CreateDBInstance', () => notImplemented);
    engine.on('CreateDBCluster', () => notImplemented);
    expect(await failureOf(instance())).toEqual({ kind: 'not-implemented', operation: 'CreateDBInstance' });
    expect(await failureOf(cluster())).toEqual({ kind: 'not-implemented', operation: 'CreateDBCluster' });
  });
});
