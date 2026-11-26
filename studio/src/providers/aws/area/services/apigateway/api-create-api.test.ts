import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createApi } from './api-create-api';

const endpoint = 'http://127.0.0.1:9682';
const sent = vi.fn<(path: string, method: string, body: unknown) => void>();
const answers = new Map<string, Response>();

beforeEach(() => {
  sent.mockClear();
  answers.clear();
  vi.stubGlobal('fetch', async (input: Request | string) => {
    const { pathname } = new URL(input instanceof Request ? input.url : input);
    if (pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    if (!(input instanceof Request)) throw new Error('Expected an SDK request');
    sent(pathname, input.method, await input.json());
    return answers.get(pathname) ?? Response.json({});
  });
});

afterEach(() => vi.unstubAllGlobals());

const http = { kind: 'HTTP', name: 'Local HTTP', description: 'Service routes', defaultStage: 'create' } as const;
const rest = { kind: 'REST', name: 'Local REST', description: 'Service methods', endpointType: 'PRIVATE' } as const;
const stagePath = '/v2/apis/http-id/stages';

function answerHttp() {
  answers.set('/v2/apis', Response.json({ apiId: 'http-id', name: http.name }));
}

it.each([rest.description, ''])(
  'creates REST with its endpoint type and only a supplied description (%j)',
  async (description) => {
    answers.set('/restapis', Response.json({ id: 'rest-id', name: rest.name }));
    await expect(createApi(endpoint, { ...rest, description }, new AbortController().signal)).resolves.toEqual({
      kind: 'REST',
      id: 'rest-id',
      name: rest.name,
    });
    expect(sent.mock.calls).toEqual([
      [
        '/restapis',
        'POST',
        {
          name: rest.name,
          ...(description ? { description } : {}),
          endpointConfiguration: { types: ['PRIVATE'] },
        },
      ],
    ]);
  },
);

it.each(['create', 'skip'] as const)('creates HTTP with the selected stage behavior (%s)', async (defaultStage) => {
  answerHttp();
  await expect(createApi(endpoint, { ...http, defaultStage }, new AbortController().signal)).resolves.toEqual({
    kind: 'HTTP',
    id: 'http-id',
    name: http.name,
  });
  expect(sent.mock.calls).toEqual([
    ['/v2/apis', 'POST', { name: http.name, description: http.description, protocolType: 'HTTP' }],
    ...(defaultStage === 'create' ? [[stagePath, 'POST', { stageName: '$default', autoDeploy: true }]] : []),
  ]);
});

it('returns the created HTTP API and the stage refusal reason', async () => {
  answerHttp();
  answers.set(stagePath, Response.json({ message: 'Stage creation was refused' }, { status: 400 }));
  await expect(createApi(endpoint, http, new AbortController().signal)).resolves.toMatchObject({
    kind: 'HTTP',
    id: 'http-id',
    name: http.name,
    stageFailure: { operation: 'CreateStage', message: 'Stage creation was refused' },
  });
  expect(sent.mock.calls.map(([path]) => path)).toEqual(['/v2/apis', stagePath]);
});

it('sends no stage command when HTTP creation is refused', async () => {
  answers.set('/v2/apis', Response.json({ message: 'API creation was refused' }, { status: 400 }));
  await expect(createApi(endpoint, http, new AbortController().signal)).rejects.toMatchObject({
    failure: { operation: 'CreateApi', message: 'API creation was refused' },
  });
  expect(sent.mock.calls.map(([path]) => path)).toEqual(['/v2/apis']);
});
