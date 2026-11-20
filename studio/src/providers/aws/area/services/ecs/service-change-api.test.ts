// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { deleteService, updateService } from './service-change-api';

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

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('the changes of a service', () => {
  it('update → UpdateService with the cluster, the service and the request; delete → DeleteService with force true', async () => {
    await updateService(
      endpoint,
      'dev',
      'api',
      { desiredCount: 2, taskDefinition: 'web:4', forceNewDeployment: true },
      new AbortController().signal,
    );
    await deleteService(endpoint, 'dev', 'api', new AbortController().signal);
    expect(sent).toEqual([
      {
        target: 'AmazonEC2ContainerServiceV20141113.UpdateService',
        body: { cluster: 'dev', service: 'api', desiredCount: 2, taskDefinition: 'web:4', forceNewDeployment: true },
      },
      {
        target: 'AmazonEC2ContainerServiceV20141113.DeleteService',
        body: { cluster: 'dev', service: 'api', force: true },
      },
    ]);
    sent.length = 0;
    await updateService(endpoint, 'dev', 'api', { desiredCount: 0 }, new AbortController().signal);
    expect(sent[0]?.body).toEqual({ cluster: 'dev', service: 'api', desiredCount: 0 });
  });

  it("a refusal → the failure under its operation's name", async () => {
    answer = { status: 400, body: { __type: 'ServiceNotActiveException', message: 'Service was not ACTIVE.' } };
    const updated = await rejection(
      updateService(endpoint, 'dev', 'api', { desiredCount: 1 }, new AbortController().signal),
    );
    expect(updated).toBeInstanceOf(RequestError);
    expect((updated as RequestError).failure).toEqual({
      kind: 'other',
      operation: 'UpdateService',
      code: 'ServiceNotActiveException',
      message: 'Service was not ACTIVE.',
    });
    answer = { status: 400, body: { __type: 'ServiceNotFoundException', message: 'Service not found.' } };
    const deleted = await rejection(deleteService(endpoint, 'dev', 'api', new AbortController().signal));
    expect((deleted as RequestError).failure).toEqual({
      kind: 'other',
      operation: 'DeleteService',
      code: 'ServiceNotFoundException',
      message: 'Service not found.',
    });
  });
});
