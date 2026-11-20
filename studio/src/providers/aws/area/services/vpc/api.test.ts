import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  getDnsSetting,
  getInternetGateway,
  getRouteTable,
  getSubnet,
  getVpc,
  listInternetGateways,
  listRouteTables,
  listSubnets,
  listVpcs,
} from './api';

// The test plays the engine behind the page's `fetch`: its session route, and each request as it leaves the browser,
// answered in EC2's query protocol (form in, XML out) as the emulator answers.

const XMLNS = 'http://ec2.amazonaws.com/doc/2016-11-15/';

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
      return new Response(JSON.stringify({ token: 'emuforge-test-token-553' }), { status: 200 });
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
    body: `<${action}Response xmlns="${XMLNS}"><requestId>r</requestId>${body}</${action}Response>`,
  };
}

const notImplemented: Answer = { status: 501, body: '' };

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9930;

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

/** The filters a request sent, by name. */
function filters(params: URLSearchParams): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (let n = 1; params.has(`Filter.${String(n)}.Name`); n += 1) {
    const values: string[] = [];
    for (let v = 1; params.has(`Filter.${String(n)}.Value.${String(v)}`); v += 1) {
      values.push(params.get(`Filter.${String(n)}.Value.${String(v)}`) ?? '');
    }
    result[params.get(`Filter.${String(n)}.Name`) ?? ''] = values;
  }
  return result;
}

const page = (action: string, set: string, items: string, next?: string) =>
  ok(action, `<${set}>${items}</${set}>${next === undefined ? '' : `<nextToken>${next}</nextToken>`}`);

const tags = (pairs: [string, string][]) =>
  `<tagSet>${pairs.map(([k, v]) => `<item><key>${k}</key><value>${v}</value></item>`).join('')}</tagSet>`;

const lists = [
  [
    'DescribeVpcs',
    'vpcSet',
    (token?: string, name?: string) => listVpcs(endpoint, { ...(name === undefined ? {} : { name }) }, token, signal()),
  ],
  [
    'DescribeSubnets',
    'subnetSet',
    (token?: string, name?: string) =>
      listSubnets(endpoint, { ...(name === undefined ? {} : { name }) }, token, signal()),
  ],
  [
    'DescribeRouteTables',
    'routeTableSet',
    (token?: string, name?: string) =>
      listRouteTables(endpoint, { ...(name === undefined ? {} : { name }) }, token, signal()),
  ],
  [
    'DescribeInternetGateways',
    'internetGatewaySet',
    (token?: string, name?: string) =>
      listInternetGateways(endpoint, { ...(name === undefined ? {} : { name }) }, token, signal()),
  ],
] as const;

describe('a page of a list', () => {
  for (const [action, set, list] of lists) {
    it(`${action}: MaxResults 50; the token when given; no filter without a text; tag:Name with * around a text; the next token`, async () => {
      engine.on(action, () => page(action, set, '', 'next-1'));
      expect((await list()).nextToken).toBe('next-1');
      const first = engine.of(action)[0]?.params ?? new URLSearchParams();
      expect(first.get('MaxResults')).toBe('50');
      expect(first.has('NextToken')).toBe(false);
      expect(filters(first)).toEqual({});

      engine.on(action, () => page(action, set, ''));
      expect((await list('tok', 'web')).nextToken).toBeUndefined();
      const second = engine.of(action)[1]?.params ?? new URLSearchParams();
      expect(second.get('NextToken')).toBe('tok');
      expect(filters(second)).toEqual({ 'tag:Name': ['*web*'] });
    });
  }
});

describe('the filters of a VPC and a subnet', () => {
  it('the subnets and the route tables of a VPC → vpc-id; the gateways of a VPC → attachment.vpc-id', async () => {
    await listSubnets(endpoint, { vpcId: 'vpc-1' }, undefined, signal());
    expect(filters(engine.of('DescribeSubnets')[0]?.params ?? new URLSearchParams())).toEqual({ 'vpc-id': ['vpc-1'] });
    await listRouteTables(endpoint, { vpcId: 'vpc-1' }, undefined, signal());
    expect(filters(engine.of('DescribeRouteTables')[0]?.params ?? new URLSearchParams())).toEqual({
      'vpc-id': ['vpc-1'],
    });
    await listInternetGateways(endpoint, { vpcId: 'vpc-1' }, undefined, signal());
    expect(filters(engine.of('DescribeInternetGateways')[0]?.params ?? new URLSearchParams())).toEqual({
      'attachment.vpc-id': ['vpc-1'],
    });
  });

  it("the route table of a subnet → association.subnet-id; a VPC's main table → vpc-id with association.main true", async () => {
    await listRouteTables(endpoint, { subnetId: 'subnet-1' }, undefined, signal());
    expect(filters(engine.of('DescribeRouteTables')[0]?.params ?? new URLSearchParams())).toEqual({
      'association.subnet-id': ['subnet-1'],
    });
    await listRouteTables(endpoint, { vpcId: 'vpc-1', main: true }, undefined, signal());
    expect(filters(engine.of('DescribeRouteTables')[1]?.params ?? new URLSearchParams())).toEqual({
      'vpc-id': ['vpc-1'],
      'association.main': ['true'],
    });
  });

  it('a filter together with a name and a token', async () => {
    await listSubnets(endpoint, { vpcId: 'vpc-1', name: 'app' }, 'tok', signal());
    const sent = engine.of('DescribeSubnets')[0]?.params ?? new URLSearchParams();
    expect(filters(sent)).toEqual({ 'vpc-id': ['vpc-1'], 'tag:Name': ['*app*'] });
    expect(sent.get('NextToken')).toBe('tok');
    expect(sent.get('MaxResults')).toBe('50');
  });
});

describe('one resource', () => {
  const reads = [
    ['DescribeVpcs', 'vpcSet', 'vpc-id', 'vpcId', 'vpc-1', (id: string) => getVpc(endpoint, id, signal()), 'VpcId'],
    [
      'DescribeSubnets',
      'subnetSet',
      'subnet-id',
      'subnetId',
      'subnet-1',
      (id: string) => getSubnet(endpoint, id, signal()),
      'SubnetId',
    ],
    [
      'DescribeRouteTables',
      'routeTableSet',
      'route-table-id',
      'routeTableId',
      'rtb-1',
      (id: string) => getRouteTable(endpoint, id, signal()),
      'RouteTableId',
    ],
    [
      'DescribeInternetGateways',
      'internetGatewaySet',
      'internet-gateway-id',
      'internetGatewayId',
      'igw-1',
      (id: string) => getInternetGateway(endpoint, id, signal()),
      'InternetGatewayId',
    ],
  ] as const;
  for (const [action, set, filterName, field, id, read, idsArgument] of reads) {
    it(`${action}: asked by the filter ${filterName}, never by the …Ids argument; an empty answer → "not found"`, async () => {
      engine.on(action, () => page(action, set, `<item><${field}>${id}</${field}></item>`));
      const answer = await read(id);
      expect(answer.found).toBe(true);
      const sent = engine.of(action)[0]?.params ?? new URLSearchParams();
      expect(filters(sent)).toEqual({ [filterName]: [id] });
      expect([...sent.keys()].some((key) => key.startsWith(idsArgument))).toBe(false);

      engine.on(action, () => page(action, set, ''));
      expect(await read(id)).toEqual({ found: false });
    });
  }
});

describe('a VPC', () => {
  it('its ID, state, block, every block of CidrBlockAssociationSet, whether it is the default, its tags; an absent value absent', async () => {
    engine.on('DescribeVpcs', () =>
      page(
        'DescribeVpcs',
        'vpcSet',
        `<item><vpcId>vpc-1</vpcId><state>available</state><cidrBlock>10.0.0.0/16</cidrBlock><isDefault>false</isDefault>
           <cidrBlockAssociationSet><item><cidrBlock>10.0.0.0/16</cidrBlock></item><item><cidrBlock>10.1.0.0/16</cidrBlock></item></cidrBlockAssociationSet>
           ${tags([
             ['Name', 'app'],
             ['env', 'dev'],
           ])}</item>
         <item><vpcId>vpc-d</vpcId><isDefault>true</isDefault></item>`,
      ),
    );
    expect((await listVpcs(endpoint, {}, undefined, signal())).items).toEqual([
      {
        id: 'vpc-1',
        state: 'available',
        cidr: '10.0.0.0/16',
        cidrs: ['10.0.0.0/16', '10.1.0.0/16'],
        isDefault: false,
        tags: [
          { key: 'Name', value: 'app' },
          { key: 'env', value: 'dev' },
        ],
      },
      { id: 'vpc-d', state: '', cidrs: [], isDefault: true, tags: [] },
    ]);
  });

  it('a DNS setting: DescribeVpcAttribute with enableDnsSupport or enableDnsHostnames; true → on, false → off', async () => {
    engine.on('DescribeVpcAttribute', (sent) =>
      sent.params.get('Attribute') === 'enableDnsSupport'
        ? ok('DescribeVpcAttribute', '<vpcId>vpc-1</vpcId><enableDnsSupport><value>true</value></enableDnsSupport>')
        : ok(
            'DescribeVpcAttribute',
            '<vpcId>vpc-1</vpcId><enableDnsHostnames><value>false</value></enableDnsHostnames>',
          ),
    );
    expect(await getDnsSetting(endpoint, 'vpc-1', 'enableDnsSupport', signal())).toBe(true);
    expect(await getDnsSetting(endpoint, 'vpc-1', 'enableDnsHostnames', signal())).toBe(false);
    const sent = engine
      .of('DescribeVpcAttribute')
      .map((each) => [each.params.get('VpcId'), each.params.get('Attribute')]);
    expect(sent).toEqual([
      ['vpc-1', 'enableDnsSupport'],
      ['vpc-1', 'enableDnsHostnames'],
    ]);
  });
});

describe('a subnet', () => {
  it('its ID, ARN, state, VPC, block, zone, free addresses, default subnet, public addresses on, tags', async () => {
    engine.on('DescribeSubnets', () =>
      page(
        'DescribeSubnets',
        'subnetSet',
        `<item><subnetId>subnet-1</subnetId><subnetArn>arn:aws:ec2:us-east-1:000000000000:subnet/subnet-1</subnetArn>
           <state>available</state><vpcId>vpc-1</vpcId><cidrBlock>10.0.1.0/24</cidrBlock><availabilityZone>us-east-1a</availabilityZone>
           <availableIpAddressCount>251</availableIpAddressCount><defaultForAz>false</defaultForAz><mapPublicIpOnLaunch>true</mapPublicIpOnLaunch>
           ${tags([['Name', 'app-a']])}</item>
         <item><subnetId>subnet-2</subnetId><defaultForAz>true</defaultForAz></item>`,
      ),
    );
    expect((await listSubnets(endpoint, {}, undefined, signal())).items).toEqual([
      {
        id: 'subnet-1',
        arn: 'arn:aws:ec2:us-east-1:000000000000:subnet/subnet-1',
        state: 'available',
        vpcId: 'vpc-1',
        cidr: '10.0.1.0/24',
        zone: 'us-east-1a',
        freeAddresses: 251,
        isDefault: false,
        publicAddresses: true,
        tags: [{ key: 'Name', value: 'app-a' }],
      },
      { id: 'subnet-2', state: '', isDefault: true, publicAddresses: false, tags: [] },
    ]);
  });
});

describe('a route table', () => {
  it('its ID, VPC, tags; main; each route in order with its destination, its one target and its state; each association; the subnets counted', async () => {
    engine.on('DescribeRouteTables', () =>
      page(
        'DescribeRouteTables',
        'routeTableSet',
        `<item><routeTableId>rtb-1</routeTableId><vpcId>vpc-1</vpcId>
           <routeSet>
             <item><destinationCidrBlock>10.0.0.0/16</destinationCidrBlock><gatewayId>local</gatewayId><state>active</state></item>
             <item><destinationCidrBlock>0.0.0.0/0</destinationCidrBlock><gatewayId>igw-1</gatewayId><state>blackhole</state></item>
             <item><destinationIpv6CidrBlock>::/0</destinationIpv6CidrBlock><natGatewayId>nat-1</natGatewayId><state>active</state></item>
             <item><destinationPrefixListId>pl-1</destinationPrefixListId><vpcPeeringConnectionId>pcx-1</vpcPeeringConnectionId><state>active</state></item>
           </routeSet>
           <associationSet>
             <item><routeTableAssociationId>rtbassoc-m</routeTableAssociationId><main>true</main></item>
             <item><routeTableAssociationId>rtbassoc-1</routeTableAssociationId><subnetId>subnet-1</subnetId><main>false</main></item>
             <item><routeTableAssociationId>rtbassoc-2</routeTableAssociationId><subnetId>subnet-2</subnetId><main>false</main></item>
           </associationSet>
           ${tags([['Name', 'public']])}</item>
         <item><routeTableId>rtb-2</routeTableId></item>`,
      ),
    );
    expect((await listRouteTables(endpoint, {}, undefined, signal())).items).toEqual([
      {
        id: 'rtb-1',
        vpcId: 'vpc-1',
        main: true,
        routes: [
          { destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' },
          { destination: { kind: 'ipv4', value: '0.0.0.0/0' }, target: 'igw-1', state: 'blackhole' },
          { destination: { kind: 'ipv6', value: '::/0' }, target: 'nat-1', state: 'active' },
          { destination: { kind: 'prefix-list', value: 'pl-1' }, target: 'pcx-1', state: 'active' },
        ],
        associations: [
          { id: 'rtbassoc-m', main: true },
          { id: 'rtbassoc-1', subnetId: 'subnet-1', main: false },
          { id: 'rtbassoc-2', subnetId: 'subnet-2', main: false },
        ],
        subnetCount: 2,
        tags: [{ key: 'Name', value: 'public' }],
      },
      { id: 'rtb-2', main: false, routes: [], associations: [], subnetCount: 0, tags: [] },
    ]);
  });
});

describe('an internet gateway', () => {
  it('its ID, tags and the VPC of its attachment, none when it has no attachment', async () => {
    engine.on('DescribeInternetGateways', () =>
      page(
        'DescribeInternetGateways',
        'internetGatewaySet',
        `<item><internetGatewayId>igw-1</internetGatewayId><attachmentSet><item><vpcId>vpc-1</vpcId><state>available</state></item></attachmentSet>${tags([['Name', 'gw']])}</item>
         <item><internetGatewayId>igw-2</internetGatewayId><attachmentSet/></item>`,
      ),
    );
    expect((await listInternetGateways(endpoint, {}, undefined, signal())).items).toEqual([
      { id: 'igw-1', vpcId: 'vpc-1', tags: [{ key: 'Name', value: 'gw' }] },
      { id: 'igw-2', tags: [] },
    ]);
  });
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    ['DescribeVpcs', (given = signal()) => listVpcs(endpoint, {}, undefined, given)],
    ['DescribeVpcs', (given = signal()) => getVpc(endpoint, 'vpc-1', given)],
    ['DescribeVpcAttribute', (given = signal()) => getDnsSetting(endpoint, 'vpc-1', 'enableDnsSupport', given)],
    ['DescribeSubnets', (given = signal()) => listSubnets(endpoint, {}, undefined, given)],
    ['DescribeSubnets', (given = signal()) => getSubnet(endpoint, 'subnet-1', given)],
    ['DescribeRouteTables', (given = signal()) => listRouteTables(endpoint, {}, undefined, given)],
    ['DescribeRouteTables', (given = signal()) => getRouteTable(endpoint, 'rtb-1', given)],
    ['DescribeInternetGateways', (given = signal()) => listInternetGateways(endpoint, {}, undefined, given)],
    ['DescribeInternetGateways', (given = signal()) => getInternetGateway(endpoint, 'igw-1', given)],
  ];
  for (const [operation, call] of calls) {
    it(`${operation}: a refusal → a failure with the code and message`, async () => {
      engine.on(operation, () => ({
        status: 400,
        body: '<Response><Errors><Error><Code>InvalidParameterValue</Code><Message>bad filter</Message></Error></Errors><RequestID>r</RequestID></Response>',
      }));
      expect(await failureOf(call())).toMatchObject({
        kind: 'other',
        operation,
        code: 'InvalidParameterValue',
        message: 'bad filter',
      });
    });

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
