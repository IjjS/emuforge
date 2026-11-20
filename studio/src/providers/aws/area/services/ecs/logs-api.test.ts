// @vitest-environment node
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import * as api from './api';
import { getContainerLogs, getLogLines } from './logs-api';

// The test plays the engine behind the page's `fetch`: ECS and CloudWatch Logs both speak JSON 1.1, the operation in
// `X-Amz-Target`. `api.ts`'s senders are watched, so every request is seen to go through them.

vi.mock('./api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api')>();
  return { ...real, sendEcs: vi.fn(real.sendEcs), sendLogs: vi.fn(real.sendLogs) };
});

interface Sent {
  operation: string;
  body: Record<string, unknown>;
}

interface Answer {
  status: number;
  body: unknown;
}

const JSON_1_1 = 'application/x-amz-json-1.1';

class FakeEngine {
  readonly sent: Sent[] = [];
  handle: (sent: Sent) => Answer = () => ({ status: 200, body: {} });

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-575' }), { status: 200 });
    }
    const target = request.headers.get('x-amz-target') ?? '';
    const raw = await request.text();
    const sent: Sent = {
      operation: target.slice(target.indexOf('.') + 1),
      body: raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>),
    };
    this.sent.push(sent);
    const answer = this.handle(sent);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': JSON_1_1 },
    });
  };
}

const ok = (body: unknown): Answer => ({ status: 200, body });
const refusal = (code: string, message: string): Answer => ({ status: 400, body: { __type: code, message } });

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9880;

beforeEach(() => {
  vi.clearAllMocks();
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;
const LOG = { group: '/ecs/web', stream: 'web/app/abc' };

describe('the senders', () => {
  it("every request goes through api.ts's sendEcs or sendLogs, and the file hands no client class to the factory", async () => {
    engine.handle = (sent) =>
      sent.operation === 'DescribeTaskDefinition' ? ok({ taskDefinition: { containerDefinitions: [] } }) : ok({});
    await getContainerLogs(endpoint, 'web:3', 'abc', signal());
    await getLogLines(endpoint, LOG, undefined, signal());
    expect(vi.mocked(api.sendEcs).mock.calls.map((call) => call[1])).toEqual(['DescribeTaskDefinition']);
    expect(vi.mocked(api.sendLogs).mock.calls.map((call) => call[1])).toEqual(['GetLogEvents']);
    const source = readFileSync(new URL('./logs-api.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/createAwsClient|client-factory|LogsClient\b|ECSClient\b/);
  });
});

describe('the log configurations', () => {
  it('per container the group and the stream {prefix}/{container}/{task}; no awslogs, or no prefix → none', async () => {
    engine.handle = () =>
      ok({
        taskDefinition: {
          containerDefinitions: [
            {
              name: 'app',
              logConfiguration: {
                logDriver: 'awslogs',
                options: { 'awslogs-group': '/ecs/web', 'awslogs-stream-prefix': 'web' },
              },
            },
            { name: 'plain' },
            {
              name: 'noprefix',
              logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/web' } },
            },
          ],
        },
      });
    expect(await getContainerLogs(endpoint, 'arn:aws:ecs:us-east-1:0:task-definition/web:3', 'abc', signal())).toEqual([
      { container: 'app', log: { group: '/ecs/web', stream: 'web/app/abc' } },
      { container: 'plain' },
      { container: 'noprefix' },
    ]);
    expect(engine.sent.map((sent) => sent.body)).toEqual([
      { taskDefinition: 'arn:aws:ecs:us-east-1:0:task-definition/web:3' },
    ]);
  });
});

describe('the lines', () => {
  it('from the head with startFromHead and limit 200; with a token, nextToken; events as time and message', async () => {
    engine.handle = () =>
      ok({
        events: [
          { timestamp: 1_790_000_000_000, message: 'one' },
          { timestamp: 1_790_000_001_000, message: 'two' },
        ],
        nextForwardToken: 'f/2',
      });
    expect(await getLogLines(endpoint, LOG, undefined, signal())).toEqual({
      lines: [
        { time: new Date(1_790_000_000_000), message: 'one' },
        { time: new Date(1_790_000_001_000), message: 'two' },
      ],
      nextToken: 'f/2',
    });
    await getLogLines(endpoint, LOG, 'f/2', signal());
    expect(engine.sent.map((sent) => sent.body)).toEqual([
      { logGroupName: '/ecs/web', logStreamName: 'web/app/abc', startFromHead: true, limit: 200 },
      { logGroupName: '/ecs/web', logStreamName: 'web/app/abc', startFromHead: true, limit: 200, nextToken: 'f/2' },
    ]);
  });

  it('ResourceNotFoundException → no line and no token; any other refusal → the failure', async () => {
    engine.handle = () => refusal('ResourceNotFoundException', 'The specified log stream does not exist.');
    expect(await getLogLines(endpoint, LOG, undefined, signal())).toEqual({ lines: [] });
    engine.handle = () => refusal('InvalidParameterException', 'bad');
    const error: unknown = await getLogLines(endpoint, LOG, undefined, signal()).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).failure).toMatchObject({
      kind: 'other',
      operation: 'GetLogEvents',
      code: 'InvalidParameterException',
      message: 'bad',
    });
  });
});
