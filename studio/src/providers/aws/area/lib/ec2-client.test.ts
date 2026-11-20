import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../lib/aws/request';
import { DescribeVpcsCommand, EC2Client } from '@aws-sdk/client-ec2';
import * as factory from '../../../../lib/aws/client-factory';
import { nameOf, sendEc2, tagsOf, text, withValues } from './ec2-client';

vi.mock('../../../../lib/aws/client-factory', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../lib/aws/client-factory')>();
  return { ...real, createAwsClient: vi.fn(real.createAwsClient) };
});

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
let nextPort = 9900;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = factory.engineEndpoint(nextPort);
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

const describe1 = (given: AbortSignal, at = endpoint) =>
  sendEc2(
    at,
    'DescribeVpcs',
    (client, abortSignal) => client.send(new DescribeVpcsCommand({}), { abortSignal }),
    given,
  );

describe('sendEc2', () => {
  it('one client per endpoint, made by the factory with the EC2 class', async () => {
    const clients: EC2Client[] = [];
    const grab = (client: EC2Client) => {
      clients.push(client);
      return Promise.resolve();
    };
    await sendEc2(endpoint, 'X', grab, signal());
    await sendEc2(endpoint, 'X', grab, signal());
    const other = factory.engineEndpoint(nextPort + 500);
    await sendEc2(other, 'X', grab, signal());
    expect(clients[0]).toBeInstanceOf(EC2Client);
    expect(clients[1]).toBe(clients[0]);
    expect(clients[2]).not.toBe(clients[0]);
    const made = vi.mocked(factory.createAwsClient).mock.calls;
    expect(made).toHaveLength(2);
    expect(made[0]?.[0]).toBe(EC2Client);
    expect(made[0]?.[1]).toEqual({ endpoint });
    expect(made[1]?.[1]).toEqual({ endpoint: other });
  });

  it("a command is sent with its operation's name, and its answer is returned", async () => {
    engine.on('DescribeVpcs', () => ok('DescribeVpcs', '<vpcSet><item><vpcId>vpc-1</vpcId></item></vpcSet>'));
    const output = await describe1(signal());
    expect(output.Vpcs?.[0]?.VpcId).toBe('vpc-1');
    expect(engine.of('DescribeVpcs')).toHaveLength(1);
  });

  it('a refusal → a failure with the code and message', async () => {
    engine.on('DescribeVpcs', () => ({
      status: 400,
      body: '<Response><Errors><Error><Code>InvalidParameterValue</Code><Message>bad value</Message></Error></Errors><RequestID>r</RequestID></Response>',
    }));
    expect(await failureOf(describe1(signal()))).toMatchObject({ code: 'InvalidParameterValue', message: 'bad value' });
  });

  it('a 501 → the "not implemented" kind with the operation\'s name', async () => {
    engine.on('DescribeVpcs', () => notImplemented);
    expect(await failureOf(describe1(signal()))).toEqual({ kind: 'not-implemented', operation: 'DescribeVpcs' });
  });

  it('an aborted signal ends the request', async () => {
    engine.on('DescribeVpcs', () => 'hold');
    const controller = new AbortController();
    const pending = describe1(controller.signal);
    await vi.waitFor(() => {
      expect(engine.of('DescribeVpcs')).toHaveLength(1);
    });
    const reason = new Error('left the page');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

describe('text', () => {
  it('a text that is not empty → itself; an empty one or a value that is no text → none', () => {
    expect(text('vpc-1')).toBe('vpc-1');
    expect(text('')).toBeUndefined();
    expect(text(undefined)).toBeUndefined();
    expect(text(5)).toBeUndefined();
    expect(text(null)).toBeUndefined();
  });
});

describe('tagsOf', () => {
  it("the tags in the answer's order; a tag without a key left out; a value absent → empty", () => {
    expect(
      tagsOf([
        { Key: 'b', Value: '2' },
        { Value: 'orphan' },
        { Key: '', Value: 'x' },
        { Key: 'a' },
        { Key: 'Name', Value: 'n' },
      ]),
    ).toEqual([
      { key: 'b', value: '2' },
      { key: 'a', value: '' },
      { key: 'Name', value: 'n' },
    ]);
    expect(tagsOf(undefined)).toEqual([]);
  });
});

describe('withValues', () => {
  it('copies the values that are present and leaves an absent one absent', () => {
    const target: { id: string; name?: string; cidr?: string; zero?: number } = { id: 'x' };
    const result = withValues(target, { name: 'n', cidr: undefined, zero: 0 });
    expect(result).toBe(target);
    expect(result).toEqual({ id: 'x', name: 'n', zero: 0 });
    expect('cidr' in result).toBe(false);
  });
});

describe('nameOf', () => {
  it('the value of the tag Name; none without one or with an empty one', () => {
    expect(
      nameOf([
        { key: 'env', value: 'dev' },
        { key: 'Name', value: 'app' },
      ]),
    ).toBe('app');
    expect(nameOf([{ key: 'env', value: 'dev' }])).toBeUndefined();
    expect(nameOf([{ key: 'Name', value: '' }])).toBeUndefined();
    expect(nameOf([])).toBeUndefined();
  });
});
