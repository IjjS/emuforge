// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { createService } from './create-service-api';
import type { CreateServiceRequest } from './create-service-form';

const request: CreateServiceRequest = {
  cluster: 'dev',
  serviceName: 'entered',
  taskDefinition: 'web:2',
  desiredCount: 2,
  launchType: 'FARGATE',
  networkConfiguration: {
    awsvpcConfiguration: { subnets: ['subnet-a'], securityGroups: ['sg-a'], assignPublicIp: 'ENABLED' },
  },
};

function engine(body: unknown, status: number) {
  const sent: { url: string; target: string | null; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const outgoing = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(outgoing.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-609' }));
    }
    sent.push({
      url: outgoing.url,
      target: outgoing.headers.get('x-amz-target'),
      body: await outgoing.json(),
    });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

it('sends CreateService via the configured engine and reads the returned identity', async () => {
  const sent = engine({ service: { serviceName: 'returned' } }, 200);
  const endpoint = 'http://127.0.0.1:9609';
  await expect(createService(endpoint, request, new AbortController().signal)).resolves.toBe('returned');
  expect(sent).toEqual([
    { url: `${endpoint}/`, target: 'AmazonEC2ContainerServiceV20141113.CreateService', body: request },
  ]);
});

it('preserves the actual refusal of CreateService', async () => {
  const message = 'Creation of service was not idempotent.';
  engine({ __type: 'InvalidParameterException', message }, 400);
  await expect(createService('http://127.0.0.1:9610', request, new AbortController().signal)).rejects.toMatchObject({
    failure: { kind: 'other', operation: 'CreateService', code: 'InvalidParameterException', message },
  });
});
