import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  deleteSecurityGroup,
  deleteSecurityGroupRule,
  getSecurityGroup,
  listSecurityGroupRules,
  listSecurityGroups,
} from './group-api';

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
let nextPort = 9700;

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

const GROUP_A = `<item><ownerId>000000000000</ownerId><groupId>sg-a</groupId><groupName>web</groupName>
  <groupDescription>Web servers</groupDescription><vpcId>vpc-1</vpcId>
  <securityGroupArn>arn:aws:ec2:us-east-1:000000000000:security-group/sg-a</securityGroupArn></item>`;
const GROUP_B = `<item><groupId>sg-b</groupId><groupName>default</groupName><groupDescription>default VPC security group</groupDescription><vpcId>vpc-1</vpcId></item>`;

const RULES = `<securityGroupRuleSet>
  <item><securityGroupRuleId>sgr-1</securityGroupRuleId><groupId>sg-a</groupId><isEgress>false</isEgress>
    <ipProtocol>tcp</ipProtocol><fromPort>8000</fromPort><toPort>8100</toPort><cidrIpv4>10.1.0.0/16</cidrIpv4><description>api</description></item>
  <item><securityGroupRuleId>sgr-2</securityGroupRuleId><groupId>sg-a</groupId><isEgress>false</isEgress>
    <ipProtocol>tcp</ipProtocol><fromPort>443</fromPort><toPort>443</toPort><cidrIpv6>::/0</cidrIpv6></item>
  <item><securityGroupRuleId>sgr-3</securityGroupRuleId><groupId>sg-a</groupId><isEgress>false</isEgress>
    <ipProtocol>-1</ipProtocol><fromPort>-1</fromPort><toPort>-1</toPort><referencedGroupInfo><groupId>sg-b</groupId><userId>000000000000</userId></referencedGroupInfo></item>
  <item><securityGroupRuleId>sgr-4</securityGroupRuleId><groupId>sg-a</groupId><isEgress>true</isEgress>
    <ipProtocol>-1</ipProtocol><fromPort>-1</fromPort><toPort>-1</toPort><cidrIpv4>0.0.0.0/0</cidrIpv4></item>
</securityGroupRuleSet>`;

describe('the groups page', () => {
  it('MaxResults 50, no filter without a text, the token; the filter group-name with * around a text', async () => {
    await listSecurityGroups(endpoint, '', undefined, signal());
    await listSecurityGroups(endpoint, 'web', 'tok-2', signal());
    const [first, second] = engine.of('DescribeSecurityGroups');
    expect(first?.params.get('MaxResults')).toBe('50');
    expect(filters(first?.params ?? new URLSearchParams())).toEqual({});
    expect(first?.params.has('NextToken')).toBe(false);
    expect(second?.params.get('MaxResults')).toBe('50');
    expect(filters(second?.params ?? new URLSearchParams())).toEqual({ 'group-name': ['*web*'] });
    expect(second?.params.get('NextToken')).toBe('tok-2');
  });

  it("each group's ID, name, description, VPC and ARN in order; the token", async () => {
    engine.on('DescribeSecurityGroups', () =>
      ok(
        'DescribeSecurityGroups',
        `<securityGroupInfo>${GROUP_A}${GROUP_B}</securityGroupInfo><nextToken>tok-9</nextToken>`,
      ),
    );
    const page = await listSecurityGroups(endpoint, '', undefined, signal());
    expect(page).toEqual({
      groups: [
        {
          id: 'sg-a',
          name: 'web',
          description: 'Web servers',
          vpcId: 'vpc-1',
          arn: 'arn:aws:ec2:us-east-1:000000000000:security-group/sg-a',
        },
        { id: 'sg-b', name: 'default', description: 'default VPC security group', vpcId: 'vpc-1' },
      ],
      nextToken: 'tok-9',
    });
  });

  it('a page without a token has none', async () => {
    engine.on('DescribeSecurityGroups', () => ok('DescribeSecurityGroups', '<securityGroupInfo/>'));
    await expect(listSecurityGroups(endpoint, '', 'tok', signal())).resolves.toEqual({ groups: [] });
  });
});

describe('a group', () => {
  it('asked by GroupIds; the answer → the group', async () => {
    engine.on('DescribeSecurityGroups', () =>
      ok('DescribeSecurityGroups', `<securityGroupInfo>${GROUP_A}</securityGroupInfo>`),
    );
    const read = await getSecurityGroup(endpoint, 'sg-a', signal());
    const [sent] = engine.of('DescribeSecurityGroups');
    expect(sent?.params.get('GroupId.1')).toBe('sg-a');
    expect(sent?.params.has('MaxResults')).toBe(false);
    expect(read).toEqual({
      found: true,
      group: {
        id: 'sg-a',
        name: 'web',
        description: 'Web servers',
        vpcId: 'vpc-1',
        arn: 'arn:aws:ec2:us-east-1:000000000000:security-group/sg-a',
      },
    });
  });

  it('InvalidGroup.NotFound → "not found" rather than a failure', async () => {
    engine.on('DescribeSecurityGroups', () =>
      refused('InvalidGroup.NotFound', "The security group 'sg-gone' does not exist"),
    );
    await expect(getSecurityGroup(endpoint, 'sg-gone', signal())).resolves.toEqual({ found: false });
  });

  it('another refusal → a failure with the code and message', async () => {
    engine.on('DescribeSecurityGroups', () => refused('InternalError', 'broke'));
    expect(await failureOf(getSecurityGroup(endpoint, 'sg-a', signal()))).toEqual({
      kind: 'other',
      operation: 'DescribeSecurityGroups',
      code: 'InternalError',
      message: 'broke',
    });
  });
});

describe('the rules page', () => {
  it('the filter group-id, MaxResults 100, the token', async () => {
    await listSecurityGroupRules(endpoint, 'sg-a', undefined, signal());
    await listSecurityGroupRules(endpoint, 'sg-a', 'tok-r', signal());
    const [first, second] = engine.of('DescribeSecurityGroupRules');
    expect(filters(first?.params ?? new URLSearchParams())).toEqual({ 'group-id': ['sg-a'] });
    expect(first?.params.get('MaxResults')).toBe('100');
    expect(first?.params.has('NextToken')).toBe(false);
    expect(second?.params.get('NextToken')).toBe('tok-r');
  });

  it("each rule's ID, direction, protocol, ports, source or destination and description in order; the token", async () => {
    engine.on('DescribeSecurityGroupRules', () =>
      ok('DescribeSecurityGroupRules', `${RULES}<nextToken>tok-n</nextToken>`),
    );
    expect(await listSecurityGroupRules(endpoint, 'sg-a', undefined, signal())).toEqual({
      rules: [
        {
          id: 'sgr-1',
          egress: false,
          protocol: 'tcp',
          fromPort: 8000,
          toPort: 8100,
          peer: { kind: 'ipv4', value: '10.1.0.0/16' },
          description: 'api',
        },
        {
          id: 'sgr-2',
          egress: false,
          protocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          peer: { kind: 'ipv6', value: '::/0' },
        },
        {
          id: 'sgr-3',
          egress: false,
          protocol: '-1',
          fromPort: -1,
          toPort: -1,
          peer: { kind: 'group', value: 'sg-b' },
        },
        {
          id: 'sgr-4',
          egress: true,
          protocol: '-1',
          fromPort: -1,
          toPort: -1,
          peer: { kind: 'ipv4', value: '0.0.0.0/0' },
        },
      ],
      nextToken: 'tok-n',
    });
  });
});

describe('the deletes', () => {
  it('a group → DeleteSecurityGroup with the ID', async () => {
    await deleteSecurityGroup(endpoint, 'sg-a', signal());
    const [sent] = engine.of('DeleteSecurityGroup');
    expect(sent?.params.get('GroupId')).toBe('sg-a');
  });

  it('DependencyViolation and CannotDelete → a failure with the code and message', async () => {
    engine.on('DeleteSecurityGroup', () => refused('DependencyViolation', 'resource sg-a has a dependent object'));
    expect(await failureOf(deleteSecurityGroup(endpoint, 'sg-a', signal()))).toEqual({
      kind: 'other',
      operation: 'DeleteSecurityGroup',
      code: 'DependencyViolation',
      message: 'resource sg-a has a dependent object',
    });
    engine.on('DeleteSecurityGroup', () =>
      refused('CannotDelete', 'the specified group: "sg-b" name: "default" cannot be deleted by a user'),
    );
    expect(await failureOf(deleteSecurityGroup(endpoint, 'sg-b', signal()))).toMatchObject({
      code: 'CannotDelete',
      message: 'the specified group: "sg-b" name: "default" cannot be deleted by a user',
    });
  });

  it('an inbound rule → RevokeSecurityGroupIngress, an outbound one → RevokeSecurityGroupEgress, each with the group and the one rule ID', async () => {
    await deleteSecurityGroupRule(endpoint, 'sg-a', { id: 'sgr-1', egress: false }, signal());
    await deleteSecurityGroupRule(endpoint, 'sg-a', { id: 'sgr-4', egress: true }, signal());
    expect(
      engine.sent.map((sent) => [
        sent.action,
        sent.params.get('GroupId'),
        sent.params.get('SecurityGroupRuleId.1'),
        sent.params.has('SecurityGroupRuleId.2'),
        sent.params.has('IpPermissions.1.IpProtocol'),
      ]),
    ).toEqual([
      ['RevokeSecurityGroupIngress', 'sg-a', 'sgr-1', false, false],
      ['RevokeSecurityGroupEgress', 'sg-a', 'sgr-4', false, false],
    ]);
  });
});

describe('every call', () => {
  const calls: [string, (abort: AbortSignal) => Promise<unknown>][] = [
    ['DescribeSecurityGroups', (abort) => listSecurityGroups(endpoint, '', undefined, abort)],
    ['DescribeSecurityGroups', (abort) => getSecurityGroup(endpoint, 'sg-a', abort)],
    ['DescribeSecurityGroupRules', (abort) => listSecurityGroupRules(endpoint, 'sg-a', undefined, abort)],
    ['DeleteSecurityGroup', (abort) => deleteSecurityGroup(endpoint, 'sg-a', abort)],
    [
      'RevokeSecurityGroupIngress',
      (abort) => deleteSecurityGroupRule(endpoint, 'sg-a', { id: 'r', egress: false }, abort),
    ],
    [
      'RevokeSecurityGroupEgress',
      (abort) => deleteSecurityGroupRule(endpoint, 'sg-a', { id: 'r', egress: true }, abort),
    ],
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
