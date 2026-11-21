// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { listFargateRevisions } from './create-service-choices';

const eligible = { status: 'ACTIVE', networkMode: 'awsvpc', compatibilities: ['FARGATE'] };
const arn = (value: string) => `arn:aws:ecs:us-east-1:000000000000:task-definition/${value}`;
function page(values: string[], nextToken?: string) {
  return { taskDefinitionArns: values.map(arn), nextToken };
}

function engine(
  pages: Record<string, ReturnType<typeof page>>,
  descriptions: Record<string, Partial<typeof eligible>> = {},
) {
  const lists: unknown[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-609' }));
    }
    const body = (await request.json()) as { nextToken?: string; taskDefinition?: string };
    const options = { headers: { 'content-type': 'application/x-amz-json-1.1' } };
    if (request.headers.get('x-amz-target')?.endsWith('.ListTaskDefinitions')) {
      lists.push(body);
      return new Response(JSON.stringify(pages[body.nextToken ?? 'first']), options);
    }
    if (body.taskDefinition === 'web:9') {
      return new Response(
        JSON.stringify({ __type: 'ClientException', message: 'Unable to describe task definition.' }),
        {
          ...options,
          status: 400,
        },
      );
    }
    return new Response(
      JSON.stringify({ taskDefinition: { ...eligible, ...descriptions[body.taskDefinition ?? ''] } }),
      options,
    );
  });
  return lists;
}

const query = (nextToken?: string) => ({
  familyPrefix: 'web',
  status: 'ACTIVE',
  sort: 'DESC',
  maxResults: 50,
  ...(nextToken === undefined ? {} : { nextToken }),
});

afterEach(() => vi.unstubAllGlobals());

it('skips a whole incompatible first page, verifying compatibility, status and network mode', async () => {
  const lists = engine(
    {
      first: page(['web:5', 'web:4', 'web:3'], 'older'),
      older: page(['web:2', 'web-other:1']),
    },
    {
      'web:5': { compatibilities: ['EC2'] },
      'web:4': { status: 'INACTIVE' },
      'web:3': { networkMode: 'bridge' },
    },
  );
  await expect(
    listFargateRevisions('http://127.0.0.1:9611', 'web', undefined, new AbortController().signal),
  ).resolves.toEqual({
    items: [{ value: 'web:2', family: 'web', revision: 2 }],
  });
  expect(lists).toEqual([query(), query('older')]);
});

it('follows both raw continuations on Load more past an ineligible middle page', async () => {
  const lists = engine(
    { first: page(['web:4'], 'middle'), middle: page(['web:3'], 'oldest'), oldest: page(['web:1']) },
    {
      'web:3': { networkMode: 'bridge' },
    },
  );
  const endpoint = 'http://127.0.0.1:9612';
  const signal = new AbortController().signal;
  const first = await listFargateRevisions(endpoint, 'web', undefined, signal);
  expect(first.items.map(({ value }) => value)).toEqual(['web:4']);
  const older = await listFargateRevisions(endpoint, 'web', first.next, signal);
  expect(older.items.map(({ value }) => value)).toEqual(['web:1']);
  expect(lists).toEqual([query(), query('middle'), query('oldest')]);
});

it('preserves a failed revision description as a failure of the page', async () => {
  engine({ first: page(['web:9']) });
  await expect(
    listFargateRevisions('http://127.0.0.1:9613', 'web', undefined, new AbortController().signal),
  ).rejects.toMatchObject({
    failure: {
      kind: 'other',
      operation: 'DescribeTaskDefinition',
      code: 'ClientException',
      message: 'Unable to describe task definition.',
    },
  });
});
