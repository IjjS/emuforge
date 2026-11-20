// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { registerTaskDefinition } from './register-api';
import { parseDefinition, STARTER } from './register-form';

// Test criteria, "Unit s7 — services/ecs/register-api.test.ts" (issue 575). The test plays the engine behind the
// page's `fetch`: its session route, and the request as it leaves the browser, answered in ECS's JSON 1.1 as the
// emulator answers.

const JSON_1_1 = 'application/x-amz-json-1.1';

interface Sent {
  target: string | null;
  body: Record<string, unknown>;
}

let sent: Sent[];
let answer: { status: number; body: unknown };
let endpoint: string;
let nextPort = 9830;

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

function starterInput(): Record<string, unknown> {
  const parsed = parseDefinition(STARTER);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.input;
}

describe('register', () => {
  it("RegisterTaskDefinition with the object as its input, unchanged → the answer's family and revision", async () => {
    answer = {
      status: 200,
      body: {
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:us-east-1:000000000000:task-definition/studio-task:4',
          family: 'studio-task',
          revision: 4,
          status: 'ACTIVE',
        },
      },
    };
    const input = starterInput();
    const before = structuredClone(input);
    const registered = await registerTaskDefinition(endpoint, input, new AbortController().signal);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.target).toBe('AmazonEC2ContainerServiceV20141113.RegisterTaskDefinition');
    expect(sent[0]?.body).toEqual(before);
    expect(input).toEqual(before);
    expect(registered).toEqual({ family: 'studio-task', revision: 4 });
  });

  it('a refusal → the failure under RegisterTaskDefinition', async () => {
    answer = {
      status: 400,
      body: { __type: 'ClientException', message: 'Container.image should not be null or empty.' },
    };
    const error: unknown = await registerTaskDefinition(
      endpoint,
      { family: 'web', containerDefinitions: [{ name: 'app' }] },
      new AbortController().signal,
    ).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).failure).toEqual({
      kind: 'other',
      operation: 'RegisterTaskDefinition',
      code: 'ClientException',
      message: 'Container.image should not be null or empty.',
    });
  });
});
