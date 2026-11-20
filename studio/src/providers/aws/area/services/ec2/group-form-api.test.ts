import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { addSecurityGroupRule, createSecurityGroup, type NewRule } from './group-form-api';

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

function refused(code: string, message: string): Answer {
  return {
    status: 400,
    body: `<Response><Errors><Error><Code>${code}</Code><Message>${message}</Message></Error></Errors><RequestID>r</RequestID></Response>`,
  };
}

const notImplemented: Answer = { status: 501, body: '' };

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9840;

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

/** The parameters a request sent, by name, without those every request of the protocol carries. */
function sentParams(sent: Sent | undefined): Record<string, string> {
  const result = Object.fromEntries((sent?.params ?? new URLSearchParams()).entries());
  delete result.Action;
  delete result.Version;
  return result;
}

const CREATED = ok('CreateSecurityGroup', '<return>true</return><groupId>sg-0new</groupId>');

const RANGE: NewRule = { egress: false, protocol: 'tcp', fromPort: 22, peer: { kind: 'ipv4', value: '10.0.0.0/16' } };

async function sentRule(rule: NewRule): Promise<Record<string, string>> {
  const action = rule.egress ? 'AuthorizeSecurityGroupEgress' : 'AuthorizeSecurityGroupIngress';
  const before = engine.of(action).length;
  await addSecurityGroupRule(endpoint, 'sg-1', rule, signal());
  const sent = engine.of(action);
  expect(sent).toHaveLength(before + 1);
  return sentParams(sent.at(-1));
}

describe('create a group', () => {
  // The SDK's `Description` goes on the wire as `GroupDescription`.
  it("GroupName and Description, VpcId only when a VPC is chosen; the answer's group ID", async () => {
    engine.on('CreateSecurityGroup', () => CREATED);
    expect(await createSecurityGroup(endpoint, { name: 'web', description: 'Web servers' }, signal())).toBe('sg-0new');
    expect(sentParams(engine.of('CreateSecurityGroup')[0])).toEqual({
      GroupName: 'web',
      GroupDescription: 'Web servers',
    });
    expect(
      await createSecurityGroup(endpoint, { name: 'web', description: 'Web servers', vpcId: 'vpc-1' }, signal()),
    ).toBe('sg-0new');
    expect(sentParams(engine.of('CreateSecurityGroup')[1])).toEqual({
      GroupName: 'web',
      GroupDescription: 'Web servers',
      VpcId: 'vpc-1',
    });
  });
});

describe('add a rule', () => {
  it('an inbound rule → AuthorizeSecurityGroupIngress, an outbound one → AuthorizeSecurityGroupEgress, each with the group and one permission', async () => {
    expect(await sentRule(RANGE)).toEqual({
      GroupId: 'sg-1',
      'IpPermissions.1.IpProtocol': 'tcp',
      'IpPermissions.1.FromPort': '22',
      'IpPermissions.1.ToPort': '22',
      'IpPermissions.1.IpRanges.1.CidrIp': '10.0.0.0/16',
    });
    expect(await sentRule({ ...RANGE, egress: true })).toEqual({
      GroupId: 'sg-1',
      'IpPermissions.1.IpProtocol': 'tcp',
      'IpPermissions.1.FromPort': '22',
      'IpPermissions.1.ToPort': '22',
      'IpPermissions.1.IpRanges.1.CidrIp': '10.0.0.0/16',
    });
    expect(engine.of('AuthorizeSecurityGroupIngress')).toHaveLength(1);
    expect(engine.of('AuthorizeSecurityGroupEgress')).toHaveLength(1);
  });

  it('TCP with one port → tcp and it twice; UDP with two → udp and the two; ICMP → icmp -1 -1; All → -1 -1 -1', async () => {
    const ports = (params: Record<string, string>) => [
      params['IpPermissions.1.IpProtocol'],
      params['IpPermissions.1.FromPort'],
      params['IpPermissions.1.ToPort'],
    ];
    expect(ports(await sentRule({ ...RANGE, protocol: 'tcp', fromPort: 443 }))).toEqual(['tcp', '443', '443']);
    expect(ports(await sentRule({ ...RANGE, protocol: 'udp', fromPort: 1000, toPort: 2000 }))).toEqual([
      'udp',
      '1000',
      '2000',
    ]);
    expect(ports(await sentRule({ ...RANGE, protocol: 'icmp', fromPort: 8, toPort: 9 }))).toEqual(['icmp', '-1', '-1']);
    expect(ports(await sentRule({ ...RANGE, protocol: 'all' }))).toEqual(['-1', '-1', '-1']);
  });

  it('an IPv4 range → IpRanges, an IPv6 range → Ipv6Ranges, a group → UserIdGroupPairs; the description when given', async () => {
    const peerParams = (params: Record<string, string>) =>
      Object.fromEntries(Object.entries(params).filter(([key]) => /Ranges|Groups/.test(key)));
    expect(peerParams(await sentRule(RANGE))).toEqual({ 'IpPermissions.1.IpRanges.1.CidrIp': '10.0.0.0/16' });
    expect(peerParams(await sentRule({ ...RANGE, description: 'SSH' }))).toEqual({
      'IpPermissions.1.IpRanges.1.CidrIp': '10.0.0.0/16',
      'IpPermissions.1.IpRanges.1.Description': 'SSH',
    });
    expect(peerParams(await sentRule({ ...RANGE, peer: { kind: 'ipv6', value: '2001:db8::/32' } }))).toEqual({
      'IpPermissions.1.Ipv6Ranges.1.CidrIpv6': '2001:db8::/32',
    });
    expect(
      peerParams(await sentRule({ ...RANGE, peer: { kind: 'group', value: 'sg-2' }, description: 'From the app' })),
    ).toEqual({
      'IpPermissions.1.Groups.1.GroupId': 'sg-2',
      'IpPermissions.1.Groups.1.Description': 'From the app',
    });
  });
});

describe('failures', () => {
  it('InvalidGroup.Duplicate, InvalidPermission.Duplicate, InvalidParameterValue → a failure with the code and message', async () => {
    engine.on('CreateSecurityGroup', () =>
      refused('InvalidGroup.Duplicate', "The security group 'web' already exists"),
    );
    expect(await failureOf(createSecurityGroup(endpoint, { name: 'web', description: 'd' }, signal()))).toEqual({
      kind: 'other',
      operation: 'CreateSecurityGroup',
      code: 'InvalidGroup.Duplicate',
      message: "The security group 'web' already exists",
    });
    engine.on('AuthorizeSecurityGroupIngress', () =>
      refused('InvalidPermission.Duplicate', 'the specified rule already exists'),
    );
    expect(await failureOf(addSecurityGroupRule(endpoint, 'sg-1', RANGE, signal()))).toEqual({
      kind: 'other',
      operation: 'AuthorizeSecurityGroupIngress',
      code: 'InvalidPermission.Duplicate',
      message: 'the specified rule already exists',
    });
    engine.on('AuthorizeSecurityGroupEgress', () => refused('InvalidParameterValue', 'invalid CIDR: nope'));
    expect(
      await failureOf(
        addSecurityGroupRule(
          endpoint,
          'sg-1',
          { ...RANGE, egress: true, peer: { kind: 'ipv4', value: 'nope' } },
          signal(),
        ),
      ),
    ).toEqual({
      kind: 'other',
      operation: 'AuthorizeSecurityGroupEgress',
      code: 'InvalidParameterValue',
      message: 'invalid CIDR: nope',
    });
  });

  it('every call: a 501 → "not implemented" with its operation', async () => {
    for (const action of ['CreateSecurityGroup', 'AuthorizeSecurityGroupIngress', 'AuthorizeSecurityGroupEgress']) {
      engine.on(action, () => notImplemented);
    }
    expect(await failureOf(createSecurityGroup(endpoint, { name: 'web', description: 'd' }, signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'CreateSecurityGroup',
    });
    expect(await failureOf(addSecurityGroupRule(endpoint, 'sg-1', RANGE, signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'AuthorizeSecurityGroupIngress',
    });
    expect(await failureOf(addSecurityGroupRule(endpoint, 'sg-1', { ...RANGE, egress: true }, signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'AuthorizeSecurityGroupEgress',
    });
  });

  it('an aborted signal ends the request', async () => {
    for (const [action, start] of [
      ['CreateSecurityGroup', (s: AbortSignal) => createSecurityGroup(endpoint, { name: 'a', description: 'd' }, s)],
      ['AuthorizeSecurityGroupIngress', (s: AbortSignal) => addSecurityGroupRule(endpoint, 'sg-1', RANGE, s)],
    ] as const) {
      engine.on(action, () => 'hold');
      const controller = new AbortController();
      const pending = start(controller.signal);
      await vi.waitFor(() => {
        expect(engine.of(action)).toHaveLength(1);
      });
      const reason = new Error('left the page');
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    }
  });
});
