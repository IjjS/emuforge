import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../lib/aws/client-factory';
import { RequestError } from '../../../../lib/aws/request';
import { CHOICES_PAGE_SIZE, listSubnetChoices, listVpcChoices } from './ec2-network-choices';

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

describe('the subnets', () => {
  it('MaxResults 50 and the token; each choice with its zone, CIDR block and VPC', async () => {
    engine.on('DescribeSubnets', () =>
      page(
        'DescribeSubnets',
        'subnetSet',
        `<item><subnetId>subnet-1</subnetId><vpcId>vpc-1</vpcId><availabilityZone>us-east-1a</availabilityZone><cidrBlock>172.31.0.0/20</cidrBlock></item>`,
        'sub-t2',
      ),
    );
    expect(await listSubnetChoices(endpoint, 'sub-t', signal())).toEqual({
      choices: [{ id: 'subnet-1', vpcId: 'vpc-1', zone: 'us-east-1a', cidr: '172.31.0.0/20' }],
      nextToken: 'sub-t2',
    });
    const sent = engine.of('DescribeSubnets')[0]?.params;
    expect(CHOICES_PAGE_SIZE).toBe(50);
    expect(sent?.get('MaxResults')).toBe('50');
    expect(sent?.get('NextToken')).toBe('sub-t');
    expect(filters(sent ?? new URLSearchParams())).toEqual({});
  });

  it('a subnet with a tag Name → the choice carries the name; without one, or an empty one → no name', async () => {
    engine.on('DescribeSubnets', () =>
      page(
        'DescribeSubnets',
        'subnetSet',
        `<item><subnetId>subnet-1</subnetId><tagSet><item><key>env</key><value>dev</value></item><item><key>Name</key><value>app-a</value></item></tagSet></item>
         <item><subnetId>subnet-2</subnetId><tagSet><item><key>env</key><value>dev</value></item></tagSet></item>
         <item><subnetId>subnet-3</subnetId><tagSet><item><key>Name</key><value></value></item></tagSet></item>`,
      ),
    );
    expect((await listSubnetChoices(endpoint, undefined, signal())).choices).toEqual([
      { id: 'subnet-1', name: 'app-a' },
      { id: 'subnet-2' },
      { id: 'subnet-3' },
    ]);
  });

  it('keeps the number of free addresses when the emulator supplies it', async () => {
    engine.on('DescribeSubnets', () =>
      page(
        'DescribeSubnets',
        'subnetSet',
        '<item><subnetId>subnet-1</subnetId><availableIpAddressCount>251</availableIpAddressCount></item>' +
          '<item><subnetId>subnet-2</subnetId></item>',
      ),
    );
    expect((await listSubnetChoices(endpoint, undefined, signal())).choices).toEqual([
      { id: 'subnet-1', availableIpAddressCount: 251 },
      { id: 'subnet-2' },
    ]);
  });

  it('asked for a VPC → the filter vpc-id with its id, with the token; asked for none → no filter', async () => {
    engine.on('DescribeSubnets', () => page('DescribeSubnets', 'subnetSet', ''));
    await listSubnetChoices(endpoint, 'sub-t', signal(), 'vpc-1');
    const first = engine.of('DescribeSubnets')[0]?.params;
    expect(filters(first ?? new URLSearchParams())).toEqual({ 'vpc-id': ['vpc-1'] });
    expect(first?.get('NextToken')).toBe('sub-t');
    expect(first?.get('MaxResults')).toBe('50');

    await listSubnetChoices(endpoint, undefined, signal());
    expect(filters(engine.of('DescribeSubnets')[1]?.params ?? new URLSearchParams())).toEqual({});
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
    expect(filters(sent ?? new URLSearchParams())).toEqual({});

    await listVpcChoices(endpoint, 'vpc-t2', signal());
    expect(engine.of('DescribeVpcs')[1]?.params.get('NextToken')).toBe('vpc-t2');
  });

  it('a VPC with a tag Name → the choice carries the name; without one → no name', async () => {
    engine.on('DescribeVpcs', () =>
      page(
        'DescribeVpcs',
        'vpcSet',
        `<item><vpcId>vpc-1</vpcId><isDefault>false</isDefault><tagSet><item><key>Name</key><value>app</value></item></tagSet></item>
         <item><vpcId>vpc-2</vpcId><isDefault>false</isDefault></item>`,
      ),
    );
    expect((await listVpcChoices(endpoint, undefined, signal())).choices).toEqual([
      { id: 'vpc-1', name: 'app', isDefault: false },
      { id: 'vpc-2', isDefault: false },
    ]);
  });
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    ['DescribeSubnets', (given = signal()) => listSubnetChoices(endpoint, undefined, given)],
    ['DescribeVpcs', (given = signal()) => listVpcChoices(endpoint, undefined, given)],
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
