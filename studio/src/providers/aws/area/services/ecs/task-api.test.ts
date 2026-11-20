// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { getTask, listTasks, stopTask } from './task-api';

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

const TASK_ARN = (id: string) => `arn:aws:ecs:us-east-1:000000000000:task/dev/${id}`;
const DEFINITION_ARN = 'arn:aws:ecs:us-east-1:000000000000:task-definition/web:3';

function rawTask(id: string, extra: Record<string, unknown> = {}) {
  return {
    taskArn: TASK_ARN(id),
    lastStatus: 'STOPPED',
    desiredStatus: 'STOPPED',
    taskDefinitionArn: DEFINITION_ARN,
    group: 'service:api',
    launchType: 'FARGATE',
    startedBy: 'ecs-svc/123',
    createdAt: 1_790_000_000,
    startedAt: 1_790_000_005,
    stoppedAt: 1_790_000_060,
    stopCode: 'EssentialContainerExited',
    stoppedReason: 'Essential container in task exited',
    cpu: '256',
    memory: '512',
    attachments: [
      {
        type: 'ElasticNetworkInterface',
        details: [
          { name: 'subnetId', value: 'subnet-1' },
          { name: 'networkInterfaceId', value: 'eni-1' },
          { name: 'macAddress', value: '0a:00:00:00:00:01' },
          { name: 'privateIPv4Address', value: '10.0.0.7' },
        ],
      },
    ],
    containers: [
      { name: 'app', image: 'busybox:1', lastStatus: 'STOPPED', exitCode: 0, reason: 'done' },
      { name: 'side', image: 'busybox:1', lastStatus: 'STOPPED', exitCode: 3 },
    ],
    ...extra,
  };
}

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9850;

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

describe('a page of tasks', () => {
  it('ListTasks with the cluster, desiredStatus, serviceName, maxResults 25 and the token, then one DescribeTasks of the ARNs', async () => {
    engine.handle = (sent) =>
      sent.operation === 'ListTasks'
        ? { taskArns: [TASK_ARN('b'), TASK_ARN('a')], nextToken: 'tok-3' }
        : { tasks: [rawTask('a'), rawTask('b')] };
    const page = await listTasks(endpoint, 'dev', { desiredStatus: 'STOPPED', service: 'api' }, 'tok-2', signal());
    expect(engine.of('ListTasks').map((sent) => sent.body)).toEqual([
      { cluster: 'dev', desiredStatus: 'STOPPED', serviceName: 'api', maxResults: 25, nextToken: 'tok-2' },
    ]);
    expect(engine.of('DescribeTasks').map((sent) => sent.body)).toEqual([
      { cluster: 'dev', tasks: [TASK_ARN('b'), TASK_ARN('a')] },
    ]);
    expect(page.tasks.map((task) => task.id)).toEqual(['b', 'a']);
    expect(page.nextToken).toBe('tok-3');
  });

  it('no service and no token are left out; no ARN → no DescribeTasks', async () => {
    engine.handle = () => ({ taskArns: [] });
    const page = await listTasks(endpoint, 'dev', { desiredStatus: 'RUNNING' }, undefined, signal());
    expect(engine.of('ListTasks').map((sent) => sent.body)).toEqual([
      { cluster: 'dev', desiredStatus: 'RUNNING', maxResults: 25 },
    ]);
    expect(engine.of('DescribeTasks')).toEqual([]);
    expect(page).toEqual({ tasks: [] });
  });
});

describe('a described task', () => {
  it('its values, the network details of its attachment, and its containers with exit code 0 kept', async () => {
    engine.handle = () => ({ tasks: [rawTask('abc')] });
    expect(await getTask(endpoint, 'dev', 'abc', signal())).toEqual({
      found: true,
      task: {
        id: 'abc',
        arn: TASK_ARN('abc'),
        lastStatus: 'STOPPED',
        desiredStatus: 'STOPPED',
        definitionArn: DEFINITION_ARN,
        definition: { family: 'web', revision: 3 },
        group: 'service:api',
        launchType: 'FARGATE',
        startedBy: 'ecs-svc/123',
        createdAt: new Date(1_790_000_000_000),
        startedAt: new Date(1_790_000_005_000),
        stoppedAt: new Date(1_790_000_060_000),
        stopCode: 'EssentialContainerExited',
        stoppedReason: 'Essential container in task exited',
        cpu: '256',
        memory: '512',
        subnet: 'subnet-1',
        networkInterface: 'eni-1',
        privateIp: '10.0.0.7',
        containers: [
          { name: 'app', image: 'busybox:1', status: 'STOPPED', exitCode: 0, reason: 'done' },
          { name: 'side', image: 'busybox:1', status: 'STOPPED', exitCode: 3 },
        ],
      },
    });
    expect(engine.of('DescribeTasks').map((sent) => sent.body)).toEqual([{ cluster: 'dev', tasks: ['abc'] }]);
  });
});

describe('one task', () => {
  it('answered → the task; a failure MISSING → not found', async () => {
    engine.handle = () => ({ tasks: [rawTask('abc')] });
    expect((await getTask(endpoint, 'dev', 'abc', signal())).found).toBe(true);
    engine.handle = () => ({ tasks: [], failures: [{ arn: 'nope', reason: 'MISSING' }] });
    expect(await getTask(endpoint, 'dev', 'nope', signal())).toEqual({ found: false });
  });
});

describe('stop', () => {
  it('StopTask with the cluster and the task', async () => {
    engine.handle = () => ({ task: rawTask('abc') });
    await stopTask(endpoint, 'dev', 'abc', signal());
    expect(engine.of('StopTask').map((sent) => sent.body)).toEqual([{ cluster: 'dev', task: 'abc' }]);
  });
});
