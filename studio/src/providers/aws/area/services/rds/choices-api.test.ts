import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { listEngineVersionChoices, listSubnetGroupChoices } from './choices-api';

// The test plays the engine behind the page's `fetch`: its session route, and each request as it leaves the browser,
// answered in RDS's query protocol (form in, XML out) as the emulator answers.

const XMLNS = 'http://rds.amazonaws.com/doc/2014-10-31/';

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
      return new Response(JSON.stringify({ token: 'emuforge-test-token-573' }), { status: 200 });
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
    body: `<${action}Response xmlns="${XMLNS}"><${action}Result>${body}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
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

describe('the engine versions', () => {
  it('Engine, MaxRecords 100, the Marker when given; each version with its description in order; the next marker', async () => {
    engine.on('DescribeDBEngineVersions', () =>
      ok(
        'DescribeDBEngineVersions',
        `<DBEngineVersions><DBEngineVersion><Engine>postgres</Engine><EngineVersion>18.3</EngineVersion><DBEngineVersionDescription>PostgreSQL 18.3-R1</DBEngineVersionDescription></DBEngineVersion><DBEngineVersion><Engine>postgres</Engine><EngineVersion>17.7</EngineVersion></DBEngineVersion></DBEngineVersions><Marker>v-2</Marker>`,
      ),
    );
    expect(await listEngineVersionChoices(endpoint, 'postgres', undefined, signal())).toEqual({
      choices: [{ version: '18.3', description: 'PostgreSQL 18.3-R1' }, { version: '17.7' }],
      marker: 'v-2',
    });
    const [first] = engine.of('DescribeDBEngineVersions');
    expect(first?.params.get('Engine')).toBe('postgres');
    expect(first?.params.get('MaxRecords')).toBe('100');
    expect(first?.params.has('Marker')).toBe(false);

    engine.on('DescribeDBEngineVersions', () => ok('DescribeDBEngineVersions', '<DBEngineVersions/>'));
    expect(await listEngineVersionChoices(endpoint, 'mysql', 'v-2', signal())).toEqual({ choices: [] });
    const second = engine.of('DescribeDBEngineVersions')[1];
    expect(second?.params.get('Engine')).toBe('mysql');
    expect(second?.params.get('Marker')).toBe('v-2');
  });
});

describe('the DB subnet groups', () => {
  it('MaxRecords 100 and the Marker; each group with its name, description and VPC ID; the next marker', async () => {
    engine.on('DescribeDBSubnetGroups', () =>
      ok(
        'DescribeDBSubnetGroups',
        `<DBSubnetGroups><DBSubnetGroup><DBSubnetGroupName>default</DBSubnetGroupName><DBSubnetGroupDescription>default</DBSubnetGroupDescription><VpcId>vpc-d</VpcId></DBSubnetGroup><DBSubnetGroup><DBSubnetGroupName>bare</DBSubnetGroupName></DBSubnetGroup></DBSubnetGroups><Marker>g-2</Marker>`,
      ),
    );
    expect(await listSubnetGroupChoices(endpoint, undefined, signal())).toEqual({
      choices: [{ name: 'default', description: 'default', vpcId: 'vpc-d' }, { name: 'bare' }],
      marker: 'g-2',
    });
    const [first] = engine.of('DescribeDBSubnetGroups');
    expect(first?.params.get('MaxRecords')).toBe('100');
    expect(first?.params.has('Marker')).toBe(false);

    await listSubnetGroupChoices(endpoint, 'g-2', signal());
    expect(engine.of('DescribeDBSubnetGroups')[1]?.params.get('Marker')).toBe('g-2');
  });
});

describe('every call', () => {
  const calls: [string, (given?: AbortSignal) => Promise<unknown>][] = [
    [
      'DescribeDBEngineVersions',
      (given = signal()) => listEngineVersionChoices(endpoint, 'postgres', undefined, given),
    ],
    ['DescribeDBSubnetGroups', (given = signal()) => listSubnetGroupChoices(endpoint, undefined, given)],
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
