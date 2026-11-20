import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  attachInternetGateway,
  createInternetGateway,
  deleteInternetGateway,
  detachInternetGateway,
} from './gateway-changes-api';

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
let nextPort = 9940;

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

function refused(code: string, message: string): Answer {
  return {
    status: 400,
    body: `<Response><Errors><Error><Code>${code}</Code><Message>${message}</Message></Error></Errors><RequestID>r</RequestID></Response>`,
  };
}

describe('create an internet gateway', () => {
  it("with a name TagSpecifications for internet-gateway with the tag Name; the answer's ID", async () => {
    engine.on('CreateInternetGateway', () =>
      ok('CreateInternetGateway', '<internetGateway><internetGatewayId>igw-0new</internetGatewayId></internetGateway>'),
    );
    expect(await createInternetGateway(endpoint, { name: 'edge' }, signal())).toBe('igw-0new');
    const sent = engine.of('CreateInternetGateway')[0]?.params ?? new URLSearchParams();
    expect(sent.get('TagSpecification.1.ResourceType')).toBe('internet-gateway');
    expect(sent.get('TagSpecification.1.Tag.1.Key')).toBe('Name');
    expect(sent.get('TagSpecification.1.Tag.1.Value')).toBe('edge');
    expect(sent.get('TagSpecification.1.Tag.2.Key')).toBeNull();
  });

  it('without a name, no TagSpecifications', async () => {
    engine.on('CreateInternetGateway', () =>
      ok('CreateInternetGateway', '<internetGateway><internetGatewayId>igw-0new</internetGatewayId></internetGateway>'),
    );
    await createInternetGateway(endpoint, {}, signal());
    await createInternetGateway(endpoint, { name: '' }, signal());
    expect(engine.of('CreateInternetGateway')).toHaveLength(2);
    for (const sent of engine.of('CreateInternetGateway')) {
      expect([...sent.params.keys()].some((key) => key.startsWith('TagSpecification'))).toBe(false);
    }
  });
});

describe("a gateway's attachment and delete", () => {
  it("attach → AttachInternetGateway with the gateway's and the VPC's ID", async () => {
    await attachInternetGateway(endpoint, 'igw-1', 'vpc-1', signal());
    const sent = engine.of('AttachInternetGateway')[0]?.params ?? new URLSearchParams();
    expect(sent.get('InternetGatewayId')).toBe('igw-1');
    expect(sent.get('VpcId')).toBe('vpc-1');
  });

  it('detach → DetachInternetGateway with both', async () => {
    await detachInternetGateway(endpoint, 'igw-1', 'vpc-1', signal());
    const sent = engine.of('DetachInternetGateway')[0]?.params ?? new URLSearchParams();
    expect(sent.get('InternetGatewayId')).toBe('igw-1');
    expect(sent.get('VpcId')).toBe('vpc-1');
  });

  it('delete → DeleteInternetGateway with the ID', async () => {
    await deleteInternetGateway(endpoint, 'igw-1', signal());
    expect(engine.of('DeleteInternetGateway')[0]?.params.get('InternetGatewayId')).toBe('igw-1');
  });
});

describe('refusals', () => {
  const cases: [string, string, string, () => Promise<unknown>][] = [
    [
      'AttachInternetGateway',
      'Resource.AlreadyAssociated',
      'resource igw-1 is already attached to network vpc-2',
      () => attachInternetGateway(endpoint, 'igw-1', 'vpc-1', signal()),
    ],
    [
      'AttachInternetGateway',
      'InvalidParameterValue',
      'Network vpc-1 already has an internet gateway attached',
      () => attachInternetGateway(endpoint, 'igw-1', 'vpc-1', signal()),
    ],
    [
      'DetachInternetGateway',
      'Gateway.NotAttached',
      'resource igw-1 is not attached to network vpc-1',
      () => detachInternetGateway(endpoint, 'igw-1', 'vpc-1', signal()),
    ],
    [
      'DeleteInternetGateway',
      'DependencyViolation',
      "The internetGateway 'igw-1' has dependencies and cannot be deleted.",
      () => deleteInternetGateway(endpoint, 'igw-1', signal()),
    ],
  ];
  for (const [operation, code, message, call] of cases) {
    it(`${code} → a failure with the code and message`, async () => {
      engine.on(operation, () => refused(code, message));
      expect(await failureOf(call())).toEqual({ kind: 'other', operation, code, message });
    });
  }
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    ['CreateInternetGateway', (given = signal()) => createInternetGateway(endpoint, {}, given)],
    ['AttachInternetGateway', (given = signal()) => attachInternetGateway(endpoint, 'igw-1', 'vpc-1', given)],
    ['DetachInternetGateway', (given = signal()) => detachInternetGateway(endpoint, 'igw-1', 'vpc-1', given)],
    ['DeleteInternetGateway', (given = signal()) => deleteInternetGateway(endpoint, 'igw-1', given)],
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
