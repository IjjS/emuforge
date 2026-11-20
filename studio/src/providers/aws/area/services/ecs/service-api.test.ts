// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { getService, listServices } from './service-api';

// The test plays the engine behind the page's `fetch`: its session route, and every ECS request (JSON 1.1, the
// operation in `X-Amz-Target`) as the emulator answers it.

interface Sent {
  operation: string;
  body: Record<string, unknown>;
}

const JSON_1_1 = 'application/x-amz-json-1.1';

class FakeEngine {
  readonly sent: Sent[] = [];
  handle: (sent: Sent) => unknown = () => ({});

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
    return new Response(JSON.stringify(this.handle(sent)), { status: 200, headers: { 'content-type': JSON_1_1 } });
  };

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }
}

const SERVICE_ARN = (name: string) => `arn:aws:ecs:us-east-1:000000000000:service/dev/${name}`;
const DEFINITION_ARN = 'arn:aws:ecs:us-east-1:000000000000:task-definition/web:3';

function rawService(name: string, extra: Record<string, unknown> = {}) {
  return {
    serviceName: name,
    serviceArn: SERVICE_ARN(name),
    status: 'ACTIVE',
    desiredCount: 2,
    runningCount: 1,
    pendingCount: 0,
    taskDefinition: DEFINITION_ARN,
    launchType: 'FARGATE',
    createdAt: 1_790_000_000,
    networkConfiguration: {
      awsvpcConfiguration: { subnets: ['subnet-1', 'subnet-2'], securityGroups: ['sg-1'], assignPublicIp: 'ENABLED' },
    },
    deployments: [
      {
        id: 'ecs-svc/1',
        status: 'PRIMARY',
        rolloutState: 'IN_PROGRESS',
        taskDefinition: DEFINITION_ARN,
        desiredCount: 2,
        runningCount: 1,
        pendingCount: 0,
        failedTasks: 0,
        updatedAt: 1_790_000_010,
      },
    ],
    events: [
      { id: 'e1', createdAt: 1_790_000_001, message: 'has started 1 tasks' },
      { id: 'e3', createdAt: 1_790_000_030, message: 'has reached a steady state' },
      { id: 'e2', createdAt: 1_790_000_020, message: 'has started 1 tasks' },
    ],
    ...extra,
  };
}

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9870;

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

describe('a page of services', () => {
  it('ListServices with the cluster, maxResults 10 and the token, then one DescribeServices of at most 10 names', async () => {
    const names = Array.from({ length: 10 }, (_, index) => `s${String(index)}`);
    engine.handle = (sent) =>
      sent.operation === 'ListServices'
        ? { serviceArns: names.map(SERVICE_ARN), nextToken: 'tok-3' }
        : { services: [...names].reverse().map((name) => rawService(name)) };
    const page = await listServices(endpoint, 'dev', 'tok-2', signal());
    expect(engine.of('ListServices').map((sent) => sent.body)).toEqual([
      { cluster: 'dev', maxResults: 10, nextToken: 'tok-2' },
    ]);
    const described = engine.of('DescribeServices');
    expect(described).toHaveLength(1);
    expect(described[0]?.body).toEqual({ cluster: 'dev', services: names.map(SERVICE_ARN) });
    expect(page.services.map((service) => service.name)).toEqual(names);
    expect(page.nextToken).toBe('tok-3');
  });

  it('no token is left out; no ARN → no DescribeServices', async () => {
    engine.handle = () => ({ serviceArns: [] });
    const page = await listServices(endpoint, 'dev', undefined, signal());
    expect(engine.of('ListServices').map((sent) => sent.body)).toEqual([{ cluster: 'dev', maxResults: 10 }]);
    expect(engine.of('DescribeServices')).toEqual([]);
    expect(page).toEqual({ services: [] });
  });
});

describe('a described service', () => {
  it('its values, network configuration, deployments and events newest first', async () => {
    engine.handle = () => ({ services: [rawService('api')] });
    expect(await getService(endpoint, 'dev', 'api', signal())).toEqual({
      found: true,
      service: {
        name: 'api',
        arn: SERVICE_ARN('api'),
        status: 'ACTIVE',
        desired: 2,
        running: 1,
        pending: 0,
        definitionArn: DEFINITION_ARN,
        definition: { family: 'web', revision: 3 },
        launchType: 'FARGATE',
        createdAt: new Date(1_790_000_000_000),
        network: { subnets: ['subnet-1', 'subnet-2'], securityGroups: ['sg-1'], assignPublicIp: 'ENABLED' },
        deployments: [
          {
            id: 'ecs-svc/1',
            status: 'PRIMARY',
            rolloutState: 'IN_PROGRESS',
            definitionArn: DEFINITION_ARN,
            definition: { family: 'web', revision: 3 },
            desired: 2,
            running: 1,
            pending: 0,
            failed: 0,
            updatedAt: new Date(1_790_000_010_000),
          },
        ],
        events: [
          { id: 'e3', createdAt: new Date(1_790_000_030_000), message: 'has reached a steady state' },
          { id: 'e2', createdAt: new Date(1_790_000_020_000), message: 'has started 1 tasks' },
          { id: 'e1', createdAt: new Date(1_790_000_001_000), message: 'has started 1 tasks' },
        ],
      },
    });
    expect(engine.of('DescribeServices').map((sent) => sent.body)).toEqual([{ cluster: 'dev', services: ['api'] }]);
  });

  it('no network configuration → no network values', async () => {
    engine.handle = () => ({ services: [rawService('api', { networkConfiguration: undefined })] });
    const read = await getService(endpoint, 'dev', 'api', signal());
    expect(read.found && read.service.network).toBeUndefined();
  });
});

describe('one service', () => {
  it('answered ACTIVE, DRAINING or INACTIVE → the service; a failure MISSING → not found', async () => {
    for (const status of ['ACTIVE', 'DRAINING', 'INACTIVE']) {
      engine.handle = () => ({ services: [rawService('api', { status })] });
      const read = await getService(endpoint, 'dev', 'api', signal());
      expect(read.found && read.service.status).toBe(status);
    }
    engine.handle = () => ({ services: [], failures: [{ arn: SERVICE_ARN('nope'), reason: 'MISSING' }] });
    expect(await getService(endpoint, 'dev', 'nope', signal())).toEqual({ found: false });
  });
});
