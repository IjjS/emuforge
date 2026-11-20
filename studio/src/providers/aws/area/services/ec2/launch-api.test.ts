import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { launchInstance } from './launch-api';

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
let nextPort = 9820;

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

const LAUNCHED = ok(
  'RunInstances',
  '<reservationId>r-1</reservationId><instancesSet><item><instanceId>i-0new</instanceId><instanceState><code>0</code><name>pending</name></instanceState></item></instancesSet>',
);

/**
 * The parameters a request sent, by name, without those every request of the protocol carries and the idempotency
 * token the SDK adds to every `RunInstances` by itself.
 */
function sentParams(params: URLSearchParams): Record<string, string> {
  const result = Object.fromEntries(params.entries());
  delete result.Action;
  delete result.Version;
  delete result.ClientToken;
  return result;
}

describe('the launch', () => {
  it('an image and a type only → ImageId, InstanceType, MinCount 1, MaxCount 1 and nothing else', async () => {
    engine.on('RunInstances', () => LAUNCHED);
    expect(await launchInstance(endpoint, { imageId: 'ami-1', instanceType: 't3.micro', name: '', securityGroupIds: [] }, signal())).toBe(
      'i-0new',
    );
    expect(sentParams(engine.of('RunInstances')[0]?.params ?? new URLSearchParams())).toEqual({
      ImageId: 'ami-1',
      InstanceType: 't3.micro',
      MinCount: '1',
      MaxCount: '1',
    });
  });

  it("with a name, a key pair, a subnet and two groups → the Name tag, KeyName, SubnetId, SecurityGroupIds; the answer's instance ID", async () => {
    engine.on('RunInstances', () => LAUNCHED);
    const id = await launchInstance(
      endpoint,
      {
        imageId: 'ami-1',
        instanceType: 't3.micro',
        name: 'web-1',
        keyName: 'dev',
        subnetId: 'subnet-1',
        securityGroupIds: ['sg-1', 'sg-2'],
      },
      signal(),
    );
    expect(id).toBe('i-0new');
    expect(sentParams(engine.of('RunInstances')[0]?.params ?? new URLSearchParams())).toEqual({
      ImageId: 'ami-1',
      InstanceType: 't3.micro',
      MinCount: '1',
      MaxCount: '1',
      KeyName: 'dev',
      SubnetId: 'subnet-1',
      'SecurityGroupId.1': 'sg-1',
      'SecurityGroupId.2': 'sg-2',
      'TagSpecification.1.ResourceType': 'instance',
      'TagSpecification.1.Tag.1.Key': 'Name',
      'TagSpecification.1.Tag.1.Value': 'web-1',
    });
  });

  it('a refusal → a failure with the code and message; a 501 → "not implemented" with RunInstances', async () => {
    const message =
      'Your requested instance type (t3.micro) is not supported in your requested Availability Zone (us-east-1c).';
    engine.on('RunInstances', () => refused('Unsupported', message));
    expect(await failureOf(launchInstance(endpoint, { imageId: 'ami-1', instanceType: 't3.micro' }, signal()))).toEqual({
      kind: 'other',
      operation: 'RunInstances',
      code: 'Unsupported',
      message,
    });
    engine.on('RunInstances', () => notImplemented);
    expect(await failureOf(launchInstance(endpoint, { imageId: 'ami-1', instanceType: 't3.micro' }, signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'RunInstances',
    });
  });
});
