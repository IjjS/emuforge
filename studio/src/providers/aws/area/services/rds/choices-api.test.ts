import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  findSubnetGroup,
  listEngineVersionChoices,
  listSubnetGroupChoices,
  readDefaultVersion,
  readOrderableRows,
  readUpgradeTargets,
} from './choices-api';

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

const notImplemented: Answer = { status: 501, body: '' };

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9860;

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

describe('the engine versions', () => {
  it('Engine, MaxRecords 100, the Marker when given; each version with its description in order; the next marker', async () => {
    engine.on('DescribeDBEngineVersions', () =>
      ok(
        'DescribeDBEngineVersions',
        `<DBEngineVersions><DBEngineVersion><Engine>postgres</Engine><EngineVersion>18.3</EngineVersion><DBEngineVersionDescription>PostgreSQL 18.3-R1</DBEngineVersionDescription></DBEngineVersion><DBEngineVersion><Engine>postgres</Engine><EngineVersion>17.7</EngineVersion></DBEngineVersion></DBEngineVersions><Marker>v-2</Marker>`,
      ),
    );
    expect(await listEngineVersionChoices(endpoint, 'postgres', undefined, signal())).toEqual({
      choices: [{ version: '18.3', description: 'PostgreSQL 18.3-R1' }, { version: '17.7' }],
      marker: 'v-2',
    });
    const [first] = engine.of('DescribeDBEngineVersions');
    expect(first?.params.get('Engine')).toBe('postgres');
    expect(first?.params.get('MaxRecords')).toBe('100');
    expect(first?.params.has('Marker')).toBe(false);

    engine.on('DescribeDBEngineVersions', () => ok('DescribeDBEngineVersions', '<DBEngineVersions/>'));
    expect(await listEngineVersionChoices(endpoint, 'mysql', 'v-2', signal())).toEqual({ choices: [] });
    const second = engine.of('DescribeDBEngineVersions')[1];
    expect(second?.params.get('Engine')).toBe('mysql');
    expect(second?.params.get('Marker')).toBe('v-2');
  });
});

describe('the DB subnet groups', () => {
  it('MaxRecords 100 and the Marker; each group with its name, description and VPC ID; the next marker', async () => {
    engine.on('DescribeDBSubnetGroups', () =>
      ok(
        'DescribeDBSubnetGroups',
        `<DBSubnetGroups><DBSubnetGroup><DBSubnetGroupName>default</DBSubnetGroupName><DBSubnetGroupDescription>default</DBSubnetGroupDescription><VpcId>vpc-d</VpcId></DBSubnetGroup><DBSubnetGroup><DBSubnetGroupName>bare</DBSubnetGroupName></DBSubnetGroup></DBSubnetGroups><Marker>g-2</Marker>`,
      ),
    );
    expect(await listSubnetGroupChoices(endpoint, undefined, signal())).toEqual({
      choices: [{ name: 'bare' }, { name: 'default', description: 'default', vpcId: 'vpc-d' }],
      marker: 'g-2',
    });
    const [first] = engine.of('DescribeDBSubnetGroups');
    expect(first?.params.get('MaxRecords')).toBe('100');
    expect(first?.params.has('Marker')).toBe(false);

    await listSubnetGroupChoices(endpoint, 'g-2', signal());
    expect(engine.of('DescribeDBSubnetGroups')[1]?.params.get('Marker')).toBe('g-2');
  });
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    [
      'DescribeDBEngineVersions',
      (given = signal()) => listEngineVersionChoices(endpoint, 'postgres', undefined, given),
    ],
    ['DescribeDBSubnetGroups', (given = signal()) => listSubnetGroupChoices(endpoint, undefined, given)],
  ];
  for (const [operation, call] of calls) {
    it(`${operation}: a 501 → "not implemented" with the operation's name`, async () => {
      engine.on(operation, () => notImplemented);
      expect(await failureOf(call())).toEqual({ kind: 'not-implemented', operation });
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

describe('read orderable rows', () => {
  const operation = 'DescribeOrderableDBInstanceOptions';
  it('reads the full catalogue for a concrete engine and version, on the API markers', async () => {
    engine.on(operation, ({ params }) => {
      const next = params.get('Marker') === 'row-2';
      const row = `<OrderableDBInstanceOption><DBInstanceClass>${next ? 'db.second' : 'db.first'}</DBInstanceClass><StorageType>gp2</StorageType><MinStorageSize>20</MinStorageSize></OrderableDBInstanceOption>`;
      return ok(
        operation,
        `<OrderableDBInstanceOptions>${row}</OrderableDBInstanceOptions>${next ? '' : '<Marker>row-2</Marker>'}`,
      );
    });
    expect(await readOrderableRows(endpoint, 'postgres', '18.3', signal())).toEqual([
      { DBInstanceClass: 'db.first', StorageType: 'gp2', MinStorageSize: 20 },
      { DBInstanceClass: 'db.second', StorageType: 'gp2', MinStorageSize: 20 },
    ]);
    expect(
      engine
        .of(operation)
        .map(({ params }) => ['Engine', 'EngineVersion', 'MaxRecords', 'Marker'].map((key) => params.get(key))),
    ).toEqual([
      ['postgres', '18.3', '100', null],
      ['postgres', '18.3', '100', 'row-2'],
    ]);
  });

  it('makes no request without a version', async () => {
    await expect(readOrderableRows(endpoint, 'postgres', undefined, signal())).resolves.toEqual([]);
    expect(engine.sent).toEqual([]);
  });
});

describe('default and upgrade versions', () => {
  const operation = 'DescribeDBEngineVersions';

  it('reads the engine default using DefaultOnly', async () => {
    engine.on(operation, () =>
      ok(
        operation,
        '<DBEngineVersions><DBEngineVersion><EngineVersion>18.3</EngineVersion></DBEngineVersion></DBEngineVersions>',
      ),
    );
    await expect(readDefaultVersion(endpoint, 'postgres', signal())).resolves.toBe('18.3');
    expect(engine.of(operation)[0]?.params.get('DefaultOnly')).toBe('true');
    expect(engine.of(operation)[0]?.params.get('Engine')).toBe('postgres');
  });

  it('reads the upgrade targets of the starting version with their major flags', async () => {
    engine.on(operation, () =>
      ok(
        operation,
        '<DBEngineVersions><DBEngineVersion><EngineVersion>16.4</EngineVersion><ValidUpgradeTarget><UpgradeTarget><EngineVersion>16.13</EngineVersion><IsMajorVersionUpgrade>false</IsMajorVersionUpgrade></UpgradeTarget><UpgradeTarget><EngineVersion>17.9</EngineVersion><IsMajorVersionUpgrade>true</IsMajorVersionUpgrade></UpgradeTarget></ValidUpgradeTarget></DBEngineVersion></DBEngineVersions>',
      ),
    );
    await expect(readUpgradeTargets(endpoint, 'postgres', '16.4', signal())).resolves.toEqual([
      { version: '16.13', major: false },
      { version: '17.9', major: true },
    ]);
    expect(engine.of(operation)[0]?.params.get('Engine')).toBe('postgres');
    expect(engine.of(operation)[0]?.params.get('EngineVersion')).toBe('16.4');
  });
});

describe('group placement', () => {
  const operation = 'DescribeDBSubnetGroups';
  const zone = (name: string) =>
    `<Subnet><SubnetAvailabilityZone><Name>${name}</Name></SubnetAvailabilityZone></Subnet>`;
  const group = (name: string) =>
    `<DBSubnetGroup><DBSubnetGroupName>${name}</DBSubnetGroupName><VpcId>vpc-${name}</VpcId><Subnets>${zone('us-east-1b')}${zone('us-east-1a')}${zone('us-east-1b')}</Subnets></DBSubnetGroup>`;

  it('includes the VPC and distinct zones, in group name order', async () => {
    engine.on(operation, () => ok(operation, `<DBSubnetGroups>${group('b')}${group('a')}</DBSubnetGroups>`));
    await expect(listSubnetGroupChoices(endpoint, undefined, signal())).resolves.toEqual({
      choices: [
        { name: 'a', vpcId: 'vpc-a', zones: ['us-east-1a', 'us-east-1b'] },
        { name: 'b', vpcId: 'vpc-b', zones: ['us-east-1a', 'us-east-1b'] },
      ],
    });
  });

  it.each([
    ['b', [null, 'b']],
    ['missing', [null, 'b', 'c']],
  ])('reads just enough pages to look for %s', async (name, markers) => {
    engine.on(operation, ({ params }) => {
      const current = params.get('Marker') ?? 'a';
      const next = { a: '<Marker>b</Marker>', b: '<Marker>c</Marker>' }[current] ?? '';
      return ok(operation, `<DBSubnetGroups>${group(current)}</DBSubnetGroups>${next}`);
    });
    const found = await findSubnetGroup(endpoint, name, signal());
    expect(found?.name).toBe(name === 'b' ? 'b' : undefined);
    expect(engine.of(operation).map(({ params }) => params.get('Marker'))).toEqual(markers);
  });
});
