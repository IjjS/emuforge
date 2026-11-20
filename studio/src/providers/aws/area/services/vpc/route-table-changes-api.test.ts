import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { createRouteTable, deleteRouteTable } from './route-table-changes-api';

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

describe('create a route table', () => {
  it("VpcId; with a name TagSpecifications for route-table with the tag Name; the answer's route table ID", async () => {
    engine.on('CreateRouteTable', () =>
      ok('CreateRouteTable', '<routeTable><routeTableId>rtb-0new</routeTableId><vpcId>vpc-1</vpcId></routeTable>'),
    );
    expect(await createRouteTable(endpoint, { vpcId: 'vpc-1', name: 'app' }, signal())).toBe('rtb-0new');
    const sent = engine.of('CreateRouteTable')[0]?.params ?? new URLSearchParams();
    expect(sent.get('VpcId')).toBe('vpc-1');
    expect(sent.get('TagSpecification.1.ResourceType')).toBe('route-table');
    expect(sent.get('TagSpecification.1.Tag.1.Key')).toBe('Name');
    expect(sent.get('TagSpecification.1.Tag.1.Value')).toBe('app');
    expect(sent.get('TagSpecification.1.Tag.2.Key')).toBeNull();
  });

  it('without a name, no TagSpecifications', async () => {
    engine.on('CreateRouteTable', () =>
      ok('CreateRouteTable', '<routeTable><routeTableId>rtb-0new</routeTableId></routeTable>'),
    );
    await createRouteTable(endpoint, { vpcId: 'vpc-1' }, signal());
    await createRouteTable(endpoint, { vpcId: 'vpc-1', name: '' }, signal());
    expect(engine.of('CreateRouteTable')).toHaveLength(2);
    for (const sent of engine.of('CreateRouteTable')) {
      expect([...sent.params.keys()].some((key) => key.startsWith('TagSpecification'))).toBe(false);
    }
  });
});

describe('delete a route table', () => {
  it('DeleteRouteTable with the ID', async () => {
    await deleteRouteTable(endpoint, 'rtb-1', signal());
    expect(engine.of('DeleteRouteTable')[0]?.params.get('RouteTableId')).toBe('rtb-1');
  });

  it('DependencyViolation → a failure with the code and message', async () => {
    engine.on('DeleteRouteTable', () => ({
      status: 400,
      body: "<Response><Errors><Error><Code>DependencyViolation</Code><Message>The routeTable 'rtb-1' has dependencies and cannot be deleted.</Message></Error></Errors><RequestID>r</RequestID></Response>",
    }));
    expect(await failureOf(deleteRouteTable(endpoint, 'rtb-1', signal()))).toEqual({
      kind: 'other',
      operation: 'DeleteRouteTable',
      code: 'DependencyViolation',
      message: "The routeTable 'rtb-1' has dependencies and cannot be deleted.",
    });
  });
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    ['CreateRouteTable', (given = signal()) => createRouteTable(endpoint, { vpcId: 'vpc-1' }, given)],
    ['DeleteRouteTable', (given = signal()) => deleteRouteTable(endpoint, 'rtb-1', given)],
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
