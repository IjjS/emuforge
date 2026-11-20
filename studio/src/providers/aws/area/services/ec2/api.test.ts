import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { actOnInstance, getInstance, getTerminationProtection, listInstances } from './api';

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

const FULL = `<item>
  <instanceId>i-0full</instanceId><imageId>ami-1234</imageId>
  <instanceState><code>80</code><name>stopped</name></instanceState>
  <privateDnsName>ip-172-31-0-5.ec2.internal</privateDnsName><dnsName>ec2-1-2-3-4.compute-1.amazonaws.com</dnsName>
  <keyName>dev-key</keyName><instanceType>t3.micro</instanceType>
  <launchTime>2026-11-20T01:02:03.000Z</launchTime>
  <placement><availabilityZone>us-east-1a</availabilityZone></placement>
  <subnetId>subnet-1</subnetId><vpcId>vpc-1</vpcId>
  <privateIpAddress>172.31.0.5</privateIpAddress><ipAddress>1.2.3.4</ipAddress>
  <groupSet><item><groupId>sg-1</groupId><groupName>web</groupName></item></groupSet>
  <stateReason><code>Client.UserInitiatedShutdown</code><message>Client.UserInitiatedShutdown: User initiated shutdown</message></stateReason>
  <architecture>x86_64</architecture>
  <blockDeviceMapping><item><deviceName>/dev/xvda</deviceName><ebs><volumeId>vol-1</volumeId><deleteOnTermination>true</deleteOnTermination></ebs></item></blockDeviceMapping>
  <tagSet><item><key>Name</key><value>web-1</value></item><item><key>env</key><value>dev</value></item></tagSet>
  <platformDetails>Linux/UNIX</platformDetails>
</item>`;

const BARE = (id: string, state = 'terminated') =>
  `<item><instanceId>${id}</instanceId><instanceState><code>48</code><name>${state}</name></instanceState><instanceType>t3.nano</instanceType><launchTime>2026-11-20T00:00:00.000Z</launchTime><placement><availabilityZone>us-east-1b</availabilityZone></placement></item>`;

function reservations(...sets: string[][]): string {
  return `<reservationSet>${sets
    .map(
      (items, n) =>
        `<item><reservationId>r-${String(n)}</reservationId><instancesSet>${items.join('')}</instancesSet></item>`,
    )
    .join('')}</reservationSet>`;
}

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

describe('the instances page', () => {
  it('MaxResults 50; no filter for "Any state" and no name; no token on the first page', async () => {
    await listInstances(endpoint, {}, undefined, signal());
    const [sent] = engine.of('DescribeInstances');
    expect(sent?.params.get('MaxResults')).toBe('50');
    expect(filters(sent?.params ?? new URLSearchParams())).toEqual({});
    expect(sent?.params.has('NextToken')).toBe(false);
  });

  it('the token when given; the state, the name with * around it, and both together', async () => {
    await listInstances(endpoint, {}, 'tok-2', signal());
    await listInstances(endpoint, { state: 'stopped' }, undefined, signal());
    await listInstances(endpoint, { name: 'app' }, undefined, signal());
    await listInstances(endpoint, { state: 'running', name: 'Mid-app' }, 'tok-3', signal());
    const sent = engine.of('DescribeInstances');
    expect(sent[0]?.params.get('NextToken')).toBe('tok-2');
    expect(filters(sent[1]?.params ?? new URLSearchParams())).toEqual({ 'instance-state-name': ['stopped'] });
    expect(filters(sent[2]?.params ?? new URLSearchParams())).toEqual({ 'tag:Name': ['*app*'] });
    expect(filters(sent[3]?.params ?? new URLSearchParams())).toEqual({
      'instance-state-name': ['running'],
      'tag:Name': ['*Mid-app*'],
    });
    expect(sent[3]?.params.get('NextToken')).toBe('tok-3');
    expect(sent.every((one) => !one.params.has('InstanceId.1'))).toBe(true);
  });

  it("the answer: every reservation's instances in order, each with its values and name; the NextToken", async () => {
    engine.on('DescribeInstances', () =>
      ok(
        'DescribeInstances',
        `${reservations([FULL, BARE('i-2')], [BARE('i-3', 'running')])}<nextToken>tok-9</nextToken>`,
      ),
    );
    const page = await listInstances(endpoint, {}, undefined, signal());
    expect(page.nextToken).toBe('tok-9');
    expect(page.instances.map((instance) => instance.id)).toEqual(['i-0full', 'i-2', 'i-3']);
    const [first, second] = page.instances;
    expect(first).toMatchObject({
      id: 'i-0full',
      state: 'stopped',
      type: 't3.micro',
      zone: 'us-east-1a',
      publicIp: '1.2.3.4',
      privateIp: '172.31.0.5',
      launchTime: new Date('2026-11-20T01:02:03.000Z'),
      tags: [
        { key: 'Name', value: 'web-1' },
        { key: 'env', value: 'dev' },
      ],
    });
    expect(second).toEqual({
      id: 'i-2',
      state: 'terminated',
      type: 't3.nano',
      zone: 'us-east-1b',
      launchTime: new Date('2026-11-20T00:00:00.000Z'),
      groups: [],
      volumes: [],
      tags: [],
    });
  });

  it('the last page has no token', async () => {
    engine.on('DescribeInstances', () => ok('DescribeInstances', reservations([BARE('i-2')])));
    const page = await listInstances(endpoint, {}, 'tok', signal());
    expect(page.nextToken).toBeUndefined();
  });
});

describe('an instance', () => {
  it('is asked by the filter instance-id, never by InstanceIds; every value S3 shows', async () => {
    engine.on('DescribeInstances', () => ok('DescribeInstances', reservations([FULL])));
    const read = await getInstance(endpoint, 'i-0full', signal());
    const [sent] = engine.of('DescribeInstances');
    expect(filters(sent?.params ?? new URLSearchParams())).toEqual({ 'instance-id': ['i-0full'] });
    expect(sent?.params.has('InstanceId.1')).toBe(false);
    expect(read).toEqual({
      found: true,
      instance: {
        id: 'i-0full',
        state: 'stopped',
        stateReason: 'Client.UserInitiatedShutdown: User initiated shutdown',
        type: 't3.micro',
        imageId: 'ami-1234',
        launchTime: new Date('2026-11-20T01:02:03.000Z'),
        keyName: 'dev-key',
        zone: 'us-east-1a',
        subnetId: 'subnet-1',
        vpcId: 'vpc-1',
        privateIp: '172.31.0.5',
        publicIp: '1.2.3.4',
        privateDns: 'ip-172-31-0-5.ec2.internal',
        publicDns: 'ec2-1-2-3-4.compute-1.amazonaws.com',
        architecture: 'x86_64',
        platform: 'Linux/UNIX',
        groups: [{ id: 'sg-1', name: 'web' }],
        volumes: [{ device: '/dev/xvda', volumeId: 'vol-1', deleteOnTermination: true }],
        tags: [
          { key: 'Name', value: 'web-1' },
          { key: 'env', value: 'dev' },
        ],
      },
    });
  });

  it('an absent value is absent', async () => {
    engine.on('DescribeInstances', () => ok('DescribeInstances', reservations([BARE('i-2')])));
    const read = await getInstance(endpoint, 'i-2', signal());
    expect(read.found).toBe(true);
    const instance = read.found ? read.instance : undefined;
    for (const key of [
      'stateReason',
      'imageId',
      'keyName',
      'subnetId',
      'vpcId',
      'publicIp',
      'privateDns',
      'publicDns',
    ]) {
      expect(instance && key in instance, key).toBe(false);
    }
  });

  it('an empty answer → "not found", not a failure', async () => {
    engine.on('DescribeInstances', () => ok('DescribeInstances', '<reservationSet/>'));
    await expect(getInstance(endpoint, 'i-gone', signal())).resolves.toEqual({ found: false });
  });
});

describe('termination protection', () => {
  it('DescribeInstanceAttribute with disableApiTermination; true → on, false → off', async () => {
    engine.on('DescribeInstanceAttribute', () =>
      ok(
        'DescribeInstanceAttribute',
        '<instanceId>i-1</instanceId><disableApiTermination><value>true</value></disableApiTermination>',
      ),
    );
    await expect(getTerminationProtection(endpoint, 'i-1', signal())).resolves.toBe(true);
    const [sent] = engine.of('DescribeInstanceAttribute');
    expect(sent?.params.get('InstanceId')).toBe('i-1');
    expect(sent?.params.get('Attribute')).toBe('disableApiTermination');

    engine.on('DescribeInstanceAttribute', () =>
      ok(
        'DescribeInstanceAttribute',
        '<instanceId>i-1</instanceId><disableApiTermination><value>false</value></disableApiTermination>',
      ),
    );
    await expect(getTerminationProtection(endpoint, 'i-1', signal())).resolves.toBe(false);
  });
});

describe('the actions', () => {
  it('start, stop, reboot, terminate → each its operation with the one id', async () => {
    await actOnInstance(endpoint, 'start', 'i-1', signal());
    await actOnInstance(endpoint, 'stop', 'i-2', signal());
    await actOnInstance(endpoint, 'reboot', 'i-3', signal());
    await actOnInstance(endpoint, 'terminate', 'i-4', signal());
    expect(
      engine.sent.map((sent) => [sent.action, sent.params.get('InstanceId.1'), sent.params.has('InstanceId.2')]),
    ).toEqual([
      ['StartInstances', 'i-1', false],
      ['StopInstances', 'i-2', false],
      ['RebootInstances', 'i-3', false],
      ['TerminateInstances', 'i-4', false],
    ]);
  });

  it('a refusal → a failure with the code and message as they came', async () => {
    const message =
      "The instance 'i-1' may not be terminated. Modify its 'disableApiTermination' instance attribute and try again.";
    engine.on('TerminateInstances', () => refused('OperationNotPermitted', message));
    expect(await failureOf(actOnInstance(endpoint, 'terminate', 'i-1', signal()))).toEqual({
      kind: 'other',
      operation: 'TerminateInstances',
      code: 'OperationNotPermitted',
      message,
    });
    engine.on('RebootInstances', () =>
      refused('IncorrectInstanceState', "The instance 'i-1' is not in a state from which it can be rebooted."),
    );
    expect(await failureOf(actOnInstance(endpoint, 'reboot', 'i-1', signal()))).toMatchObject({
      code: 'IncorrectInstanceState',
      message: "The instance 'i-1' is not in a state from which it can be rebooted.",
    });
    engine.on('StopInstances', () => refused('InvalidInstanceID.NotFound', "The instance ID 'i-9' does not exist"));
    expect(await failureOf(actOnInstance(endpoint, 'stop', 'i-9', signal()))).toMatchObject({
      operation: 'StopInstances',
      code: 'InvalidInstanceID.NotFound',
      message: "The instance ID 'i-9' does not exist",
    });
  });
});

describe('every call', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['DescribeInstances', () => listInstances(endpoint, {}, undefined, signal())],
    ['DescribeInstances', () => getInstance(endpoint, 'i-1', signal())],
    ['DescribeInstanceAttribute', () => getTerminationProtection(endpoint, 'i-1', signal())],
    ['StartInstances', () => actOnInstance(endpoint, 'start', 'i-1', signal())],
    ['StopInstances', () => actOnInstance(endpoint, 'stop', 'i-1', signal())],
    ['RebootInstances', () => actOnInstance(endpoint, 'reboot', 'i-1', signal())],
    ['TerminateInstances', () => actOnInstance(endpoint, 'terminate', 'i-1', signal())],
  ];
  for (const [operation, call] of calls) {
    it(`${operation}: a 501 → "not implemented" with the operation's name`, async () => {
      engine.on(operation, () => notImplemented);
      expect(await failureOf(call())).toEqual({ kind: 'not-implemented', operation });
    });
  }

  it('an aborted signal ends the request', async () => {
    engine.on('DescribeInstances', () => 'hold');
    const controller = new AbortController();
    const pending = listInstances(endpoint, {}, undefined, controller.signal);
    await vi.waitFor(() => {
      expect(engine.of('DescribeInstances')).toHaveLength(1);
    });
    const reason = new Error('left the page');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
