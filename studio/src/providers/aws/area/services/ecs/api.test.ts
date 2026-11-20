// @vitest-environment node
import { DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DescribeVpcsCommand } from '@aws-sdk/client-ec2';
import { DescribeServicesCommand, DescribeTaskDefinitionCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  createCluster,
  cutFractions,
  deleteCluster,
  getCluster,
  listClusters,
  sendEc2,
  sendEcs,
  sendLogs,
} from './api';

// The test plays the engine behind the page's `fetch`: its session route, and every AWS request as it leaves the
// browser. ECS and CloudWatch Logs speak JSON 1.1 (`POST /`, the operation in `X-Amz-Target`), EC2 its query
// protocol (form in, XML out), as the emulator answers them.

interface Answer {
  status: number;
  body: string;
  type: string;
}

interface Sent {
  target: string | null;
  operation: string;
  body: Record<string, unknown>;
  form: URLSearchParams | undefined;
}

type Handler = (sent: Sent) => Answer | 'hold';

const JSON_1_1 = 'application/x-amz-json-1.1';
const ECS_PREFIX = 'AmazonEC2ContainerServiceV20141113.';

class FakeEngine {
  readonly sent: Sent[] = [];
  handle: Handler = () => ok({});

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-575' }), { status: 200 });
    }
    const target = request.headers.get('x-amz-target');
    const raw = await request.text();
    const form = target === null ? new URLSearchParams(raw) : undefined;
    const sent: Sent = {
      target,
      operation: target === null ? (form?.get('Action') ?? '') : target.slice(target.indexOf('.') + 1),
      body: target === null || raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>),
      form,
    };
    this.sent.push(sent);
    const answer = this.handle(sent);
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': answer.type } });
  };

  of(operation: string): Sent[] {
    return this.sent.filter((sent) => sent.operation === operation);
  }
}

function ok(body: unknown): Answer {
  return { status: 200, body: JSON.stringify(body), type: JSON_1_1 };
}

function refusal(code: string, message: string): Answer {
  return { status: 400, body: JSON.stringify({ __type: code, message }), type: JSON_1_1 };
}

const ARN = (name: string) => `arn:aws:ecs:us-east-1:000000000000:cluster/${name}`;

function cluster(name: string, extra: Record<string, unknown> = {}) {
  return {
    clusterName: name,
    clusterArn: ARN(name),
    status: 'ACTIVE',
    activeServicesCount: 1,
    runningTasksCount: 2,
    pendingTasksCount: 3,
    ...extra,
  };
}

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9750;

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

async function failureOf(pending: Promise<unknown>): Promise<RequestFailure> {
  const error: unknown = await pending.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(RequestError);
  return (error as RequestError).failure;
}

describe('a page of clusters', () => {
  it('ListClusters with maxResults 25 and the token, then one DescribeClusters of the ARNs, in the list order', async () => {
    engine.handle = (sent) => {
      if (sent.operation === 'ListClusters') {
        return ok({ clusterArns: [ARN('b'), ARN('a')], nextToken: 'tok-2' });
      }
      return ok({
        clusters: [cluster('a'), cluster('b', { status: 'PROVISIONING', activeServicesCount: 0 })],
        failures: [],
      });
    };
    const page = await listClusters(endpoint, 'tok-1', signal());
    expect(engine.sent.map(({ target }) => target)).toEqual([
      `${ECS_PREFIX}ListClusters`,
      `${ECS_PREFIX}DescribeClusters`,
    ]);
    expect(engine.of('ListClusters')[0]?.body).toEqual({ maxResults: 25, nextToken: 'tok-1' });
    expect(engine.of('DescribeClusters')[0]?.body).toEqual({ clusters: [ARN('b'), ARN('a')] });
    expect(page).toEqual({
      clusters: [
        {
          name: 'b',
          arn: ARN('b'),
          status: 'PROVISIONING',
          activeServices: 0,
          runningTasks: 2,
          pendingTasks: 3,
        },
        { name: 'a', arn: ARN('a'), status: 'ACTIVE', activeServices: 1, runningTasks: 2, pendingTasks: 3 },
      ],
      nextToken: 'tok-2',
    });
  });

  it('the first page is asked with no token', async () => {
    engine.handle = () => ok({ clusterArns: [] });
    await listClusters(endpoint, undefined, signal());
    expect(engine.of('ListClusters')[0]?.body).toEqual({ maxResults: 25 });
  });

  it('ListClusters answers no ARN → no DescribeClusters, and the page is empty', async () => {
    engine.handle = () => ok({ clusterArns: [] });
    const page = await listClusters(endpoint, undefined, signal());
    expect(engine.of('DescribeClusters')).toHaveLength(0);
    expect(page).toEqual({ clusters: [] });
  });
});

describe('reading one cluster', () => {
  it('ACTIVE → the cluster; a failure MISSING → not found; status INACTIVE → not found', async () => {
    engine.handle = () => ok({ clusters: [cluster('dev')], failures: [] });
    expect(await getCluster(endpoint, 'dev', signal())).toEqual({
      found: true,
      cluster: { name: 'dev', arn: ARN('dev'), status: 'ACTIVE', activeServices: 1, runningTasks: 2, pendingTasks: 3 },
    });
    expect(engine.of('DescribeClusters')[0]?.body).toEqual({ clusters: ['dev'] });

    engine.handle = () => ok({ clusters: [], failures: [{ arn: ARN('gone'), reason: 'MISSING' }] });
    expect(await getCluster(endpoint, 'gone', signal())).toEqual({ found: false });

    engine.handle = () => ok({ clusters: [cluster('old', { status: 'INACTIVE' })], failures: [] });
    expect(await getCluster(endpoint, 'old', signal())).toEqual({ found: false });
  });
});

describe('create and delete', () => {
  it('CreateCluster with clusterName, DeleteCluster with cluster', async () => {
    engine.handle = (sent) => ok({ cluster: cluster(String(sent.body.clusterName ?? sent.body.cluster)) });
    await createCluster(endpoint, 'dev', signal());
    await deleteCluster(endpoint, 'dev', signal());
    expect(engine.sent.map(({ operation, body }) => [operation, body])).toEqual([
      ['CreateCluster', { clusterName: 'dev' }],
      ['DeleteCluster', { cluster: 'dev' }],
    ]);
  });
});

describe('the other two senders', () => {
  it('sendLogs and sendEc2 → each its command through sendRequest with the operation named, on its own client', async () => {
    engine.handle = (sent) =>
      sent.target === null
        ? {
            status: 200,
            body: '<DescribeVpcsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>r</requestId><vpcSet/></DescribeVpcsResponse>',
            type: 'text/xml',
          }
        : ok({ logGroups: [] });
    await sendLogs(
      endpoint,
      'DescribeLogGroups',
      (client, abortSignal) => client.send(new DescribeLogGroupsCommand({}), { abortSignal }),
      signal(),
    );
    await sendEc2(
      endpoint,
      'DescribeVpcs',
      (client, abortSignal) => client.send(new DescribeVpcsCommand({}), { abortSignal }),
      signal(),
    );
    expect(engine.sent[0]?.target).toBe('Logs_20140328.DescribeLogGroups');
    expect(engine.sent[1]?.target).toBeNull();
    expect(engine.sent[1]?.form?.get('Action')).toBe('DescribeVpcs');

    engine.handle = (sent) =>
      sent.target === null
        ? {
            status: 400,
            body: '<Response><Errors><Error><Code>Bad</Code><Message>no</Message></Error></Errors><RequestID>r</RequestID></Response>',
            type: 'text/xml',
          }
        : refusal('ResourceNotFoundException', 'no group');
    expect(
      await failureOf(
        sendLogs(
          endpoint,
          'GetLogEvents named',
          (client, abortSignal) => client.send(new DescribeLogGroupsCommand({}), { abortSignal }),
          signal(),
        ),
      ),
    ).toMatchObject({ kind: 'other', operation: 'GetLogEvents named', code: 'ResourceNotFoundException' });
    expect(
      await failureOf(
        sendEc2(
          endpoint,
          'DescribeSubnets named',
          (client, abortSignal) => client.send(new DescribeVpcsCommand({}), { abortSignal }),
          signal(),
        ),
      ),
    ).toMatchObject({ kind: 'other', operation: 'DescribeSubnets named', code: 'Bad' });
  });
});

describe('a failed request', () => {
  it('a refusal → rejects with the failure of sendRequest under its operation name', async () => {
    engine.handle = () => refusal('ClusterContainsTasksException', 'The cluster has tasks');
    expect(await failureOf(deleteCluster(endpoint, 'dev', signal()))).toEqual({
      kind: 'other',
      operation: 'DeleteCluster',
      code: 'ClusterContainsTasksException',
      message: 'The cluster has tasks',
    });
    engine.handle = () => ({ status: 501, body: '', type: JSON_1_1 });
    expect(await failureOf(listClusters(endpoint, undefined, signal()))).toEqual({
      kind: 'not-implemented',
      operation: 'ListClusters',
    });
  });

  it('an aborted signal ends the request at once', async () => {
    engine.handle = () => 'hold';
    const controller = new AbortController();
    const result = getCluster(endpoint, 'dev', controller.signal);
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(1);
    });
    const reason = new Error('left');
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
  });
});

describe('the emulator’s epoch times of 9 fractional digits', () => {
  // As the emulator writes them (DescribeServices on 9310): more digits than a double holds, which the SDK's own
  // reader refuses. ECS's client reads each to the emulator's millisecond.
  const NINE = '1795161554.763557799';
  const MILLIS = Date.UTC(2026, 10, 20, 7, 59, 14, 763);
  const raw = (body: string): Answer => ({ status: 200, body, type: JSON_1_1 });

  it('reads DescribeServices whose createdAt has 9 fractional digits, to the millisecond', async () => {
    engine.handle = () =>
      raw(
        `{"services":[{"serviceName":"web","createdAt":${NINE},"deployments":[{"id":"d-1","createdAt":${NINE},"updatedAt":${NINE}}],"events":[{"id":"e-1","createdAt":${NINE},"message":"at 1.123456789"}]}],"failures":[]}`,
      );
    const output = await sendEcs(
      endpoint,
      'DescribeServices',
      (client, abortSignal) =>
        client.send(new DescribeServicesCommand({ cluster: 'dev', services: ['web'] }), { abortSignal }),
      signal(),
    );
    const service = output.services?.[0];
    expect(service?.createdAt?.getTime()).toBe(MILLIS);
    expect(service?.deployments?.[0]?.updatedAt?.getTime()).toBe(MILLIS);
    expect(service?.events?.[0]?.createdAt?.getTime()).toBe(MILLIS);
    expect(service?.events?.[0]?.message).toBe('at 1.123456789');
  });

  it('reads DescribeTasks whose times have 9 fractional digits, to the millisecond', async () => {
    engine.handle = () =>
      raw(
        `{"tasks":[{"taskArn":"arn:aws:ecs:us-east-1:000000000000:task/dev/t1","createdAt":${NINE},"startedAt":${NINE},"stoppedAt":${NINE}}],"failures":[]}`,
      );
    const output = await sendEcs(
      endpoint,
      'DescribeTasks',
      (client, abortSignal) =>
        client.send(new DescribeTasksCommand({ cluster: 'dev', tasks: ['t1'] }), { abortSignal }),
      signal(),
    );
    const task = output.tasks?.[0];
    expect(task?.createdAt?.getTime()).toBe(MILLIS);
    expect(task?.startedAt?.getTime()).toBe(MILLIS);
    expect(task?.stoppedAt?.getTime()).toBe(MILLIS);
  });

  it('reads DescribeTaskDefinition whose registeredAt has 9 fractional digits, to the millisecond', async () => {
    engine.handle = () =>
      raw(
        `{"taskDefinition":{"family":"web","revision":2,"registeredAt":${NINE},"containerDefinitions":[{"name":"app","image":"busybox:1.36.123456"}]}}`,
      );
    const output = await sendEcs(
      endpoint,
      'DescribeTaskDefinition',
      (client, abortSignal) =>
        client.send(new DescribeTaskDefinitionCommand({ taskDefinition: 'web:2' }), { abortSignal }),
      signal(),
    );
    expect(output.taskDefinition?.registeredAt?.getTime()).toBe(MILLIS);
    expect(output.taskDefinition?.containerDefinitions?.[0]?.image).toBe('busybox:1.36.123456');
  });

  it('cuts only numbers of more than 3 fractional digits, never inside a string', () => {
    expect(cutFractions(`{"a":${NINE},"b":1.5,"c":-2.1234,"d":"7.123456","e":1.23456e5,"f":12}`)).toBe(
      '{"a":1795161554.763,"b":1.5,"c":-2.123,"d":"7.123456","e":1.23456e5,"f":12}',
    );
  });
});
