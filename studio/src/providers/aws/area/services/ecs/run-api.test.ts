// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { runTask } from './run-api';
import type { RunRequest } from './run-form';

// The test plays the engine behind the page's `fetch`: its session route, and the request as it leaves the browser,
// answered in ECS's JSON 1.1 as the emulator answers.

const JSON_1_1 = 'application/x-amz-json-1.1';

interface Sent {
  target: string | null;
  body: Record<string, unknown>;
}

let sent: Sent[];
let answer: { status: number; body: unknown };
let endpoint: string;
let nextPort = 9790;

const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  if (new URL(request.url).pathname === '/__emuforge/session') {
    return new Response(JSON.stringify({ token: 'emuforge-test-token-575' }), { status: 200 });
  }
  const raw = await request.text();
  sent.push({
    target: request.headers.get('x-amz-target'),
    body: raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>),
  });
  return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': JSON_1_1 } });
};

beforeEach(() => {
  sent = [];
  answer = { status: 200, body: {} };
  vi.stubGlobal('fetch', fakeFetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const REQUEST: RunRequest = {
  cluster: 'dev',
  taskDefinition: 'web:3',
  count: 3,
  launchType: 'FARGATE',
  networkConfiguration: {
    awsvpcConfiguration: { subnets: ['subnet-a'], securityGroups: ['sg-1'], assignPublicIp: 'ENABLED' },
  },
};

const TASK = (id: string) => `arn:aws:ecs:us-east-1:000000000000:task/dev/${id}`;

describe('run', () => {
  it("RunTask with the request as built → the answer's task ids and its failures' reasons", async () => {
    answer = {
      status: 200,
      body: {
        tasks: [{ taskArn: TASK('aaa111') }, { taskArn: TASK('bbb222') }],
        failures: [{ arn: 'arn:x', reason: 'RESOURCE:ENI' }],
      },
    };
    const outcome = await runTask(endpoint, REQUEST, new AbortController().signal);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.target).toBe('AmazonEC2ContainerServiceV20141113.RunTask');
    // The SDK adds its own idempotency token; the rest is the request as built.
    expect(sent[0]?.body).toEqual({ ...REQUEST, clientToken: expect.any(String) });
    expect(outcome).toEqual({ taskIds: ['aaa111', 'bbb222'], failures: ['RESOURCE:ENI'] });
  });

  it('a refusal → the failure under RunTask', async () => {
    answer = {
      status: 400,
      body: { __type: 'InvalidParameterException', message: 'TaskDefinition is inactive' },
    };
    const error: unknown = await runTask(endpoint, REQUEST, new AbortController().signal).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).failure).toEqual({
      kind: 'other',
      operation: 'RunTask',
      code: 'InvalidParameterException',
      message: 'TaskDefinition is inactive',
    });
  });
});
