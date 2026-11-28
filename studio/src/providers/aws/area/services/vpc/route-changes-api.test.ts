import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { ROUTE_TARGET_KINDS, type RouteTargetKind } from './route-targets';
import { associateSubnet, createRoute, deleteRoute, disassociateSubnet } from './route-changes-api';

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

describe('add a route', () => {
  const targets: [RouteTargetKind, string][] = [
    ['GatewayId', 'igw-1'],
    ['NatGatewayId', 'nat-1'],
    ['InstanceId', 'i-1'],
    ['NetworkInterfaceId', 'eni-1'],
  ];
  it.each(targets)('CreateRoute sends the destination and only %s as the target', async (kind, id) => {
    engine.on('CreateRoute', () => ok('CreateRoute', '<return>true</return>'));
    await createRoute(endpoint, { routeTableId: 'rtb-1', destination: '8.8.8.8/16', target: { kind, id } }, signal());
    const sent = engine.of('CreateRoute')[0]?.params ?? new URLSearchParams();
    expect(sent.get('RouteTableId')).toBe('rtb-1');
    expect(sent.get('DestinationCidrBlock')).toBe('8.8.8.8/16');
    expect([...sent].filter(([name]) => Object.hasOwn(ROUTE_TARGET_KINDS, name))).toEqual([[kind, id]]);
  });
});

describe('delete a route', () => {
  it('DeleteRoute with RouteTableId and DestinationCidrBlock', async () => {
    await deleteRoute(endpoint, 'rtb-1', '0.0.0.0/0', signal());
    const sent = engine.of('DeleteRoute')[0]?.params ?? new URLSearchParams();
    expect(sent.get('RouteTableId')).toBe('rtb-1');
    expect(sent.get('DestinationCidrBlock')).toBe('0.0.0.0/0');
  });
});

describe('associate and disassociate', () => {
  it("AssociateRouteTable with RouteTableId and SubnetId; the answer's association ID", async () => {
    engine.on('AssociateRouteTable', () => ok('AssociateRouteTable', '<associationId>rtbassoc-0new</associationId>'));
    expect(await associateSubnet(endpoint, 'rtb-1', 'subnet-1', signal())).toBe('rtbassoc-0new');
    const sent = engine.of('AssociateRouteTable')[0]?.params ?? new URLSearchParams();
    expect(sent.get('RouteTableId')).toBe('rtb-1');
    expect(sent.get('SubnetId')).toBe('subnet-1');
  });

  it("DisassociateRouteTable with the association's ID", async () => {
    await disassociateSubnet(endpoint, 'rtbassoc-1', signal());
    expect(engine.of('DisassociateRouteTable')[0]?.params.get('AssociationId')).toBe('rtbassoc-1');
  });
});

describe('refusals', () => {
  const cases: [string, string, string, () => Promise<unknown>][] = [
    [
      'CreateRoute',
      'RouteAlreadyExists',
      'The route identified by 0.0.0.0/0 already exists.',
      () =>
        createRoute(
          endpoint,
          { routeTableId: 'rtb-1', destination: '0.0.0.0/0', target: { kind: 'GatewayId', id: 'igw-1' } },
          signal(),
        ),
    ],
    [
      'AssociateRouteTable',
      'Resource.AlreadyAssociated',
      'resource subnet-1 is already associated with route table rtb-2',
      () => associateSubnet(endpoint, 'rtb-1', 'subnet-1', signal()),
    ],
    [
      'DeleteRoute',
      'InvalidRoute.NotFound',
      'no route with destination-cidr-block 10.9.0.0/16 in route table rtb-1',
      () => deleteRoute(endpoint, 'rtb-1', '10.9.0.0/16', signal()),
    ],
    [
      'DisassociateRouteTable',
      'InvalidAssociationID.NotFound',
      "The association ID 'rtbassoc-9' does not exist",
      () => disassociateSubnet(endpoint, 'rtbassoc-9', signal()),
    ],
    [
      'DisassociateRouteTable',
      'InvalidParameterValue',
      'cannot disassociate the main route table association rtbassoc-main',
      () => disassociateSubnet(endpoint, 'rtbassoc-main', signal()),
    ],
  ];
  for (const [operation, code, message, call] of cases) {
    it(`${operation}: ${code} → a failure with the code and message`, async () => {
      engine.on(operation, () => refusal(code, message));
      expect(await failureOf(call())).toEqual({ kind: 'other', operation, code, message });
    });
  }
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    [
      'CreateRoute',
      (given = signal()) =>
        createRoute(
          endpoint,
          { routeTableId: 'rtb-1', destination: '0.0.0.0/0', target: { kind: 'GatewayId', id: 'igw-1' } },
          given,
        ),
    ],
    ['DeleteRoute', (given = signal()) => deleteRoute(endpoint, 'rtb-1', '0.0.0.0/0', given)],
    ['AssociateRouteTable', (given = signal()) => associateSubnet(endpoint, 'rtb-1', 'subnet-1', given)],
    ['DisassociateRouteTable', (given = signal()) => disassociateSubnet(endpoint, 'rtbassoc-1', given)],
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
