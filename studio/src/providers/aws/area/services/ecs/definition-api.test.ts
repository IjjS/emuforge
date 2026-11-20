// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { getRevision, listFamilies, listRevisions } from './definition-api';

// The test plays the engine behind the page's `fetch`: its session route, and ECS's JSON 1.1 (`POST /`, the
// operation in `X-Amz-Target`), as the emulator answers it.

interface Sent {
  operation: string;
  body: Record<string, unknown>;
}

interface Answer {
  status: number;
  body: unknown;
}

let sent: Sent[];
let answer: (operation: string) => Answer;
let endpoint: string;
let nextPort = 9790;

const ok = (body: unknown): Answer => ({ status: 200, body });
const refusal = (code: string, message: string): Answer => ({ status: 400, body: { __type: code, message } });

beforeEach(() => {
  sent = [];
  answer = () => ok({});
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-575' }), { status: 200 });
    }
    const target = request.headers.get('x-amz-target') ?? '';
    const operation = target.slice(target.indexOf('.') + 1);
    sent.push({ operation, body: JSON.parse(await request.text()) as Record<string, unknown> });
    const { status, body } = answer(operation);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/x-amz-json-1.1' },
    });
  });
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;
const ARN = (value: string) => `arn:aws:ecs:us-east-1:000000000000:task-definition/${value}`;

describe('a page of families', () => {
  it('ListTaskDefinitionFamilies with status ACTIVE, maxResults 25 and the token; familyPrefix only for a text', async () => {
    answer = () => ok({ families: ['web', 'worker'], nextToken: 'tok-2' });
    const page = await listFamilies(endpoint, '', 'tok-1', signal());
    expect(sent).toEqual([
      { operation: 'ListTaskDefinitionFamilies', body: { status: 'ACTIVE', maxResults: 25, nextToken: 'tok-1' } },
    ]);
    expect(page).toEqual({ items: ['web', 'worker'], nextToken: 'tok-2' });

    answer = () => ok({ families: ['web'] });
    expect(await listFamilies(endpoint, 'we', undefined, signal())).toEqual({ items: ['web'] });
    expect(sent[1]?.body).toEqual({ status: 'ACTIVE', maxResults: 25, familyPrefix: 'we' });
  });
});

describe('a page of revisions', () => {
  it('ListTaskDefinitions with familyPrefix, status, sort DESC, maxResults 25 and the token; each row from its ARN', async () => {
    answer = () => ok({ taskDefinitionArns: [ARN('web:3'), ARN('web:1')], nextToken: 'tok-2' });
    const page = await listRevisions(endpoint, 'web', 'INACTIVE', 'tok-1', signal());
    expect(sent).toEqual([
      {
        operation: 'ListTaskDefinitions',
        body: { familyPrefix: 'web', status: 'INACTIVE', sort: 'DESC', maxResults: 25, nextToken: 'tok-1' },
      },
    ]);
    expect(page).toEqual({
      items: [
        { value: 'web:3', family: 'web', revision: 3 },
        { value: 'web:1', family: 'web', revision: 1 },
      ],
      nextToken: 'tok-2',
    });
  });
});

describe('one revision', () => {
  it('DescribeTaskDefinition with family:revision; the summary, and the containers with command, ports and log group', async () => {
    answer = () =>
      ok({
        taskDefinition: {
          taskDefinitionArn: ARN('web:2'),
          family: 'web',
          revision: 2,
          status: 'ACTIVE',
          networkMode: 'awsvpc',
          compatibilities: ['EC2', 'FARGATE'],
          cpu: '256',
          memory: '512',
          executionRoleArn: 'arn:aws:iam::000000000000:role/exec',
          registeredAt: 1795000000,
          containerDefinitions: [
            {
              name: 'app',
              image: 'busybox',
              essential: false,
              command: ['sh', '-c', 'sleep 3600'],
              portMappings: [
                { containerPort: 80, protocol: 'tcp' },
                { containerPort: 53, protocol: 'udp' },
              ],
              logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/web' } },
            },
            { name: 'side', image: 'nginx' },
          ],
        },
      });
    const read = await getRevision(endpoint, 'web', 2, signal());
    expect(sent).toEqual([{ operation: 'DescribeTaskDefinition', body: { taskDefinition: 'web:2' } }]);
    expect(read.found).toBe(true);
    if (!read.found) return;
    const { answer: raw, ...revision } = read.revision;
    expect(revision).toEqual({
      family: 'web',
      revision: 2,
      arn: ARN('web:2'),
      status: 'ACTIVE',
      networkMode: 'awsvpc',
      compatibilities: ['EC2', 'FARGATE'],
      cpu: '256',
      memory: '512',
      executionRoleArn: 'arn:aws:iam::000000000000:role/exec',
      registeredAt: new Date(1795000000 * 1000),
      containers: [
        {
          name: 'app',
          image: 'busybox',
          essential: false,
          command: ['sh', '-c', 'sleep 3600'],
          ports: [
            { containerPort: 80, protocol: 'tcp' },
            { containerPort: 53, protocol: 'udp' },
          ],
          logGroup: '/ecs/web',
        },
        { name: 'side', image: 'nginx', ports: [] },
      ],
    });
    expect(raw.family).toBe('web');
  });

  it('ClientException "Unable to describe task definition." is not found; another refusal is the failure', async () => {
    answer = () => refusal('ClientException', 'Unable to describe task definition.');
    expect(await getRevision(endpoint, 'web', 9, signal())).toEqual({ found: false });

    answer = () => refusal('ClientException', 'Something else went wrong.');
    const error: unknown = await getRevision(endpoint, 'web', 9, signal()).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).failure).toEqual({
      kind: 'other',
      operation: 'DescribeTaskDefinition',
      code: 'ClientException',
      message: 'Something else went wrong.',
    });
  });
});
