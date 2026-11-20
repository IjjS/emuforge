import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { createSubnet, deleteSubnet, listAvailabilityZones, setPublicAddresses } from './subnet-changes-api';

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
let nextPort = 9960;

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

function refusal(code: string, message: string): Answer {
  return {
    status: 400,
    body: `<Response><Errors><Error><Code>${code}</Code><Message>${message}</Message></Error></Errors><RequestID>r</RequestID></Response>`,
  };
}

describe('the Availability Zones', () => {
  it("one DescribeAvailabilityZones; each zone's name in the answer's order", async () => {
    engine.on('DescribeAvailabilityZones', () =>
      ok(
        'DescribeAvailabilityZones',
        '<availabilityZoneInfo><item><zoneName>us-east-1b</zoneName></item><item><zoneName>us-east-1a</zoneName></item><item><zoneName>us-east-1c</zoneName></item></availabilityZoneInfo>',
      ),
    );
    expect(await listAvailabilityZones(endpoint, signal())).toEqual(['us-east-1b', 'us-east-1a', 'us-east-1c']);
    expect(engine.sent).toHaveLength(1);
    expect(engine.of('DescribeAvailabilityZones')).toHaveLength(1);
  });
});

describe('create a subnet', () => {
  it("VpcId, CidrBlock, AvailabilityZone and TagSpecifications for subnet with the tag Name; the answer's subnet ID", async () => {
    engine.on('CreateSubnet', () => ok('CreateSubnet', '<subnet><subnetId>subnet-0new</subnetId></subnet>'));
    expect(
      await createSubnet(endpoint, { vpcId: 'vpc-1', cidr: '10.0.1.0/24', zone: 'us-east-1a', name: 'app' }, signal()),
    ).toBe('subnet-0new');
    const sent = engine.of('CreateSubnet')[0]?.params ?? new URLSearchParams();
    expect(sent.get('VpcId')).toBe('vpc-1');
    expect(sent.get('CidrBlock')).toBe('10.0.1.0/24');
    expect(sent.get('AvailabilityZone')).toBe('us-east-1a');
    expect(sent.get('TagSpecification.1.ResourceType')).toBe('subnet');
    expect(sent.get('TagSpecification.1.Tag.1.Key')).toBe('Name');
    expect(sent.get('TagSpecification.1.Tag.1.Value')).toBe('app');
  });

  it('no zone and no name → neither AvailabilityZone nor TagSpecifications', async () => {
    engine.on('CreateSubnet', () => ok('CreateSubnet', '<subnet><subnetId>subnet-0new</subnetId></subnet>'));
    await createSubnet(endpoint, { vpcId: 'vpc-1', cidr: '10.0.1.0/24' }, signal());
    await createSubnet(endpoint, { vpcId: 'vpc-1', cidr: '10.0.1.0/24', zone: '', name: '' }, signal());
    for (const sent of engine.of('CreateSubnet')) {
      expect(sent.params.get('AvailabilityZone')).toBeNull();
      expect([...sent.params.keys()].some((key) => key.startsWith('TagSpecification'))).toBe(false);
      expect(sent.params.get('VpcId')).toBe('vpc-1');
    }
  });

  for (const code of ['InvalidSubnet.Range', 'InvalidSubnet.Conflict']) {
    it(`${code} → a failure with the code and message`, async () => {
      engine.on('CreateSubnet', () => refusal(code, 'The CIDR is not valid.'));
      expect(await failureOf(createSubnet(endpoint, { vpcId: 'vpc-1', cidr: '10.9.0.0/24' }, signal()))).toEqual({
        kind: 'other',
        operation: 'CreateSubnet',
        code,
        message: 'The CIDR is not valid.',
      });
    });
  }
});

describe('public addresses on launch', () => {
  it("ModifySubnetAttribute with the subnet's ID and MapPublicIpOnLaunch true, or false", async () => {
    await setPublicAddresses(endpoint, 'subnet-1', true, signal());
    await setPublicAddresses(endpoint, 'subnet-1', false, signal());
    const sent = engine.of('ModifySubnetAttribute').map((each) => each.params);
    expect(sent.map((params) => params.get('SubnetId'))).toEqual(['subnet-1', 'subnet-1']);
    expect(sent.map((params) => params.get('MapPublicIpOnLaunch.Value'))).toEqual(['true', 'false']);
  });
});

describe('delete a subnet', () => {
  it('DeleteSubnet with the ID', async () => {
    await deleteSubnet(endpoint, 'subnet-1', signal());
    expect(engine.of('DeleteSubnet')[0]?.params.get('SubnetId')).toBe('subnet-1');
  });

  it('DependencyViolation → a failure with the code and message', async () => {
    engine.on('DeleteSubnet', () =>
      refusal('DependencyViolation', "The subnet 'subnet-1' has dependencies and cannot be deleted."),
    );
    expect(await failureOf(deleteSubnet(endpoint, 'subnet-1', signal()))).toEqual({
      kind: 'other',
      operation: 'DeleteSubnet',
      code: 'DependencyViolation',
      message: "The subnet 'subnet-1' has dependencies and cannot be deleted.",
    });
  });
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    ['DescribeAvailabilityZones', (given = signal()) => listAvailabilityZones(endpoint, given)],
    ['CreateSubnet', (given = signal()) => createSubnet(endpoint, { vpcId: 'vpc-1', cidr: '10.0.1.0/24' }, given)],
    ['ModifySubnetAttribute', (given = signal()) => setPublicAddresses(endpoint, 'subnet-1', true, given)],
    ['DeleteSubnet', (given = signal()) => deleteSubnet(endpoint, 'subnet-1', given)],
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
