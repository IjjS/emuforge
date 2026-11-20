import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  getDefaultVpc,
  listGroupChoices,
  listImageChoices,
  listInstanceTypeChoices,
  listKeyPairChoices,
  listSubnetChoices,
  listVpcChoices,
} from './choices-api';

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
let nextPort = 9760;

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

describe('the images', () => {
  it('MaxResults 50, the token, the filter name with * around a text and none without; each choice; the next token', async () => {
    engine.on('DescribeImages', () =>
      page(
        'DescribeImages',
        'imagesSet',
        `<item><imageId>ami-1</imageId><name>al2023</name><architecture>x86_64</architecture><platformDetails>Linux/UNIX</platformDetails></item>
         <item><imageId>ami-2</imageId></item><item><name>no id</name></item>`,
        'img-2',
      ),
    );
    const first = await listImageChoices(endpoint, '', undefined, signal());
    expect(first).toEqual({
      choices: [{ id: 'ami-1', name: 'al2023', architecture: 'x86_64', platform: 'Linux/UNIX' }, { id: 'ami-2' }],
      nextToken: 'img-2',
    });
    const sent = engine.of('DescribeImages')[0]?.params;
    expect(sent?.get('MaxResults')).toBe('50');
    expect(sent?.has('NextToken')).toBe(false);
    expect(filters(sent ?? new URLSearchParams())).toEqual({});

    await listImageChoices(endpoint, 'al', 'img-2', signal());
    const second = engine.of('DescribeImages')[1]?.params;
    expect(second?.get('NextToken')).toBe('img-2');
    expect(filters(second ?? new URLSearchParams())).toEqual({ name: ['*al*'] });
  });
});

describe('the instance types', () => {
  it('MaxResults 50, the token, the filter instance-type likewise; each choice; the next token', async () => {
    engine.on('DescribeInstanceTypes', () =>
      page(
        'DescribeInstanceTypes',
        'instanceTypeSet',
        `<item><instanceType>t3.micro</instanceType><vCpuInfo><defaultVCpus>2</defaultVCpus></vCpuInfo>
           <memoryInfo><sizeInMiB>1024</sizeInMiB></memoryInfo>
           <processorInfo><supportedArchitectures><item>x86_64</item><item>i386</item></supportedArchitectures></processorInfo></item>
         <item><instanceType>t4g.nano</instanceType></item>`,
        'type-2',
      ),
    );
    expect(await listInstanceTypeChoices(endpoint, undefined, undefined, signal())).toEqual({
      choices: [
        { type: 't3.micro', vcpus: 2, memoryMiB: 1024, architectures: ['x86_64', 'i386'] },
        { type: 't4g.nano', architectures: [] },
      ],
      nextToken: 'type-2',
    });
    const sent = engine.of('DescribeInstanceTypes')[0]?.params;
    expect(sent?.get('MaxResults')).toBe('50');
    expect(filters(sent ?? new URLSearchParams())).toEqual({});

    await listInstanceTypeChoices(endpoint, 't3', 'type-2', signal());
    const second = engine.of('DescribeInstanceTypes')[1]?.params;
    expect(second?.get('NextToken')).toBe('type-2');
    expect(filters(second ?? new URLSearchParams())).toEqual({ 'instance-type': ['*t3*'] });
  });
});

describe('the subnets', () => {
  it('MaxResults 50 and the token; each choice with its zone, CIDR block and VPC', async () => {
    engine.on('DescribeSubnets', () =>
      page(
        'DescribeSubnets',
        'subnetSet',
        `<item><subnetId>subnet-1</subnetId><vpcId>vpc-1</vpcId><availabilityZone>us-east-1a</availabilityZone><cidrBlock>172.31.0.0/20</cidrBlock></item>`,
      ),
    );
    expect(await listSubnetChoices(endpoint, 'sub-t', signal())).toEqual({
      choices: [{ id: 'subnet-1', vpcId: 'vpc-1', zone: 'us-east-1a', cidr: '172.31.0.0/20' }],
    });
    const sent = engine.of('DescribeSubnets')[0]?.params;
    expect(sent?.get('MaxResults')).toBe('50');
    expect(sent?.get('NextToken')).toBe('sub-t');
    expect(filters(sent ?? new URLSearchParams())).toEqual({});
  });
});

describe('the VPCs', () => {
  it('MaxResults 50 and the token; each choice with its CIDR block and whether it is the default', async () => {
    engine.on('DescribeVpcs', () =>
      page(
        'DescribeVpcs',
        'vpcSet',
        `<item><vpcId>vpc-1</vpcId><cidrBlock>172.31.0.0/16</cidrBlock><isDefault>true</isDefault></item>
         <item><vpcId>vpc-2</vpcId><cidrBlock>10.0.0.0/16</cidrBlock><isDefault>false</isDefault></item>`,
        'vpc-t2',
      ),
    );
    expect(await listVpcChoices(endpoint, undefined, signal())).toEqual({
      choices: [
        { id: 'vpc-1', cidr: '172.31.0.0/16', isDefault: true },
        { id: 'vpc-2', cidr: '10.0.0.0/16', isDefault: false },
      ],
      nextToken: 'vpc-t2',
    });
    const sent = engine.of('DescribeVpcs')[0]?.params;
    expect(sent?.get('MaxResults')).toBe('50');
    expect(sent?.has('NextToken')).toBe(false);
  });

  it('the default VPC: the filter is-default true → its ID; an answer with none → none', async () => {
    engine.on('DescribeVpcs', () =>
      page('DescribeVpcs', 'vpcSet', '<item><vpcId>vpc-d</vpcId><isDefault>true</isDefault></item>'),
    );
    expect(await getDefaultVpc(endpoint, signal())).toBe('vpc-d');
    expect(filters(engine.of('DescribeVpcs')[0]?.params ?? new URLSearchParams())).toEqual({ 'is-default': ['true'] });

    engine.on('DescribeVpcs', () => page('DescribeVpcs', 'vpcSet', ''));
    expect(await getDefaultVpc(endpoint, signal())).toBeUndefined();
  });
});

describe('the security groups', () => {
  it('MaxResults 50, the token, vpc-id when a VPC is given and none without, group-name with * around a text', async () => {
    engine.on('DescribeSecurityGroups', () =>
      page(
        'DescribeSecurityGroups',
        'securityGroupInfo',
        `<item><groupId>sg-1</groupId><groupName>default</groupName></item><item><groupId>sg-2</groupId></item>`,
        'sg-t',
      ),
    );
    expect(await listGroupChoices(endpoint, {}, undefined, signal())).toEqual({
      choices: [{ id: 'sg-1', name: 'default' }, { id: 'sg-2' }],
      nextToken: 'sg-t',
    });
    const first = engine.of('DescribeSecurityGroups')[0]?.params;
    expect(first?.get('MaxResults')).toBe('50');
    expect(filters(first ?? new URLSearchParams())).toEqual({});

    await listGroupChoices(endpoint, { vpcId: 'vpc-1', name: 'web' }, 'sg-t', signal());
    const second = engine.of('DescribeSecurityGroups')[1]?.params;
    expect(second?.get('NextToken')).toBe('sg-t');
    expect(filters(second ?? new URLSearchParams())).toEqual({ 'vpc-id': ['vpc-1'], 'group-name': ['*web*'] });

    await listGroupChoices(endpoint, { vpcId: 'vpc-1' }, undefined, signal());
    expect(filters(engine.of('DescribeSecurityGroups')[2]?.params ?? new URLSearchParams())).toEqual({
      'vpc-id': ['vpc-1'],
    });
  });
});

describe('the key pairs', () => {
  it('one request with no page; each name', async () => {
    engine.on('DescribeKeyPairs', () =>
      page(
        'DescribeKeyPairs',
        'keySet',
        '<item><keyName>dev</keyName><keyPairId>key-1</keyPairId></item><item><keyName>ci</keyName></item>',
      ),
    );
    expect(await listKeyPairChoices(endpoint, signal())).toEqual([{ name: 'dev' }, { name: 'ci' }]);
    const sent = engine.of('DescribeKeyPairs');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.params.has('MaxResults')).toBe(false);
    expect(sent[0]?.params.has('NextToken')).toBe(false);
  });
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    ['DescribeImages', (given = signal()) => listImageChoices(endpoint, '', undefined, given)],
    ['DescribeInstanceTypes', (given = signal()) => listInstanceTypeChoices(endpoint, '', undefined, given)],
    ['DescribeSubnets', (given = signal()) => listSubnetChoices(endpoint, undefined, given)],
    ['DescribeVpcs', (given = signal()) => listVpcChoices(endpoint, undefined, given)],
    ['DescribeVpcs', (given = signal()) => getDefaultVpc(endpoint, given)],
    ['DescribeSecurityGroups', (given = signal()) => listGroupChoices(endpoint, {}, undefined, given)],
    ['DescribeKeyPairs', (given = signal()) => listKeyPairChoices(endpoint, given)],
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
