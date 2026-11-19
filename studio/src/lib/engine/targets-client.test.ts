import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  engineRefusal,
  FakeEngine,
  openPageAt,
  present,
  TARGETS_REFUSALS,
  targetInfo,
  targetsList,
  targetsRefusal,
  targetTest,
  TOKEN_1,
  TOKEN_2,
  type FakeAnswer,
  type TargetsRefusalCode,
  type TargetsRoute,
} from '../../test/home-test-kit';
import {
  createTargetsClient,
  EngineNotAnswering,
  EngineRefusal,
  TEST_TIME_LIMIT_MS,
  type TargetsClient,
} from './targets-client';

const LOCAL = { name: 'local', endpoint: 'https://127.0.0.1:9301' };
const SECOND = { name: 'second', endpoint: 'https://127.0.0.1:9302' };

let engine: FakeEngine;
let client: TargetsClient;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(5_000_000);
  engine = new FakeEngine();
  engine.targets = [LOCAL, SECOND];
  vi.stubGlobal('fetch', engine.fetch);
  client = createTargetsClient('http://127.0.0.1:8297');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The settled outcome of `promise` once `ms` of time has passed: its value, or what it rejected with. */
async function settle<T>(promise: Promise<T>, ms = 0): Promise<{ value?: T; error?: unknown }> {
  const outcome: { value?: T; error?: unknown; done: boolean } = { done: false };
  promise.then(
    (value) => Object.assign(outcome, { value, done: true }),
    (error: unknown) => Object.assign(outcome, { error, done: true }),
  );
  await vi.advanceTimersByTimeAsync(ms);
  if (!outcome.done) {
    throw new Error(`still pending after ${String(ms)} ms`);
  }
  return outcome;
}

async function refusalOf(promise: Promise<unknown>, ms = 0): Promise<EngineRefusal> {
  const { error } = await settle(promise, ms);
  expect(error).toBeInstanceOf(EngineRefusal);
  return error as EngineRefusal;
}

/** Each call of the client against the route it asks, for a target named `second`. */
const CALLS: Record<TargetsRoute, (signal?: AbortSignal) => Promise<unknown>> = {
  list: (signal) => client.list(signal),
  info: (signal) => client.info('second', signal),
  add: (signal) => client.add(SECOND, signal),
  use: (signal) => client.use('second', signal),
  test: (signal) => client.test('second', signal),
  remove: (signal) => client.remove('second', signal),
};

const ROUTES = Object.keys(CALLS) as TargetsRoute[];

describe('targets client: list', () => {
  it('200 with form, active and targets: the parsed list, each target with name, endpoint and active mark, the form and when it started', async () => {
    engine.answerTargets('list', { ...targetsList([LOCAL, SECOND], 'local', 'native'), delayMs: 300 });
    const { value } = await settle(client.list(), 300);
    expect(value).toEqual({
      form: 'native',
      active: 'local',
      targets: [
        { name: 'local', endpoint: 'https://127.0.0.1:9301', active: true },
        { name: 'second', endpoint: 'https://127.0.0.1:9302', active: false },
      ],
      startedAt: 5_000_000,
    });
  });

  it('a list in the Compose form', async () => {
    engine.answerTargets(
      'list',
      targetsList([{ name: 'compose', endpoint: 'https://127.0.0.1:9297' }], 'compose', 'compose'),
    );
    const { value } = await settle(client.list());
    expect(value).toMatchObject({ form: 'compose', active: 'compose', targets: [{ name: 'compose', active: true }] });
  });

  const target = { name: 'local', endpoint: 'https://127.0.0.1:9301', active: true };
  it.each([
    ['no form', { active: 'local', targets: [target] }],
    ['a form of another value', { form: 'cloud', active: 'local', targets: [target] }],
    ['no active', { form: 'native', targets: [target] }],
    ['no targets', { form: 'native', active: 'local' }],
    ['a target with no name', { form: 'native', active: 'local', targets: [{ endpoint: target.endpoint }] }],
    ['a target with no endpoint', { form: 'native', active: 'local', targets: [{ name: 'local' }] }],
  ])('200 with %s: a refusal with the status and no code', async (_n, json) => {
    engine.answerTargets('list', { status: 200, json });
    const refusal = await refusalOf(client.list());
    expect(refusal.status).toBe(200);
    expect(refusal.code).toBeUndefined();
    expect(refusal.engineMessage).toBeUndefined();
  });
});

describe('targets client: info, add, use, test, remove', () => {
  it('info 200 reachable: the target, its keys’ folder and its health', async () => {
    engine.answerTargets('info', targetInfo(SECOND, false));
    const { value } = await settle(client.info('second'));
    expect(value).toEqual({
      target: { name: 'second', endpoint: 'https://127.0.0.1:9302', active: false },
      credentialsDir: '~/.aws/emulator/9302/',
      health: { reachable: true },
      startedAt: 5_000_000,
    });
    expect(present(engine.targetRequests('info')[0], 'the info request').path).toBe('/__emuforge/targets/second');
  });

  it('info 200 not reachable: the health with reason and message as text', async () => {
    const message = 'there are no emulator files for port 9302 <b>(~/.aws/emulator/9302/)</b>';
    engine.answerTargets('info', targetInfo(SECOND, false, message));
    const { value } = await settle(client.info('second'));
    expect(value?.health).toEqual({ reachable: false, reason: 'not_started', message });
  });

  it('add sends POST with Content-Type application/json and exactly {"name","endpoint"}; 201: the added target', async () => {
    engine.targets = [LOCAL];
    const { value } = await settle(client.add({ ...SECOND, extra: 'not sent' } as typeof SECOND));
    const request = present(engine.targetRequests('add')[0], 'the add request');
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/__emuforge/targets');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.init.body).toBe('{"name":"second","endpoint":"https://127.0.0.1:9302"}');
    expect(value).toEqual({
      target: { name: 'second', endpoint: 'https://127.0.0.1:9302', active: false },
      startedAt: 5_000_000,
    });
  });

  it('use 200: the list it holds', async () => {
    const { value } = await settle(client.use('second'));
    const request = present(engine.targetRequests('use')[0], 'the use request');
    expect([request.method, request.path]).toEqual(['POST', '/__emuforge/targets/second/use']);
    expect(value).toMatchObject({ form: 'native', active: 'second', targets: [{ active: false }, { active: true }] });
  });

  it('test 200 passed: the five checks in order with status', async () => {
    engine.answerTargets('test', targetTest(SECOND));
    const { value } = await settle(client.test('second'));
    const request = present(engine.targetRequests('test')[0], 'the test request');
    expect([request.method, request.path]).toEqual(['POST', '/__emuforge/targets/second/test']);
    expect(value?.passed).toBe(true);
    expect(value?.checks).toEqual(
      ['files', 'connection', 'tls', 'health', 'credentials'].map((check) => ({
        check,
        status: 'passed',
        reason: '',
        message: '',
      })),
    );
  });

  it('test 200 failed: files failed with reason and message, the four others not run', async () => {
    engine.answerTargets('test', targetTest(SECOND, 'there are no emulator files for port 9302'));
    const { value } = await settle(client.test('second'));
    expect(value?.passed).toBe(false);
    expect(value?.checks).toEqual([
      { check: 'files', status: 'failed', reason: 'not_started', message: 'there are no emulator files for port 9302' },
      ...['connection', 'tls', 'health', 'credentials'].map((check) => ({
        check,
        status: 'not_run',
        reason: '',
        message: '',
      })),
    ]);
  });

  it('remove 204: done, with no body read', async () => {
    const text = vi.fn();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await engine.fetch(input, init);
      if (init?.method === 'DELETE') {
        Object.defineProperty(response, 'text', { value: text });
        Object.defineProperty(response, 'json', { value: text });
      }
      return response;
    });
    const { value } = await settle(client.remove('second'));
    const request = present(engine.targetRequests('remove')[0], 'the remove request');
    expect([request.method, request.path]).toEqual(['DELETE', '/__emuforge/targets/second']);
    expect(value).toEqual({ startedAt: 5_000_000 });
    expect(text).not.toHaveBeenCalled();
  });
});

describe('targets client: refusals', () => {
  const cases = ROUTES.filter((route) => route !== 'list' && route !== 'info').flatMap((route) =>
    (Object.keys(TARGETS_REFUSALS) as TargetsRefusalCode[]).map((code) => [route, code] as const),
  );
  it.each(cases)('%s answered %s: a refusal with that status, code and message', async (route, code) => {
    engine.answerTargets(route, targetsRefusal(code, `the engine's words for ${code}`));
    const refusal = await refusalOf(CALLS[route]());
    expect(refusal.status).toBe(TARGETS_REFUSALS[code]);
    expect(refusal.code).toBe(code);
    expect(refusal.engineMessage).toBe(`the engine's words for ${code}`);
  });

  it.each(ROUTES)(
    '%s answered 500 with a body that is not JSON: a refusal with status 500 and no code',
    async (route) => {
      engine.answerTargets(route, { status: 500, text: 'Internal Server Error' });
      const refusal = await refusalOf(CALLS[route]());
      expect(refusal.status).toBe(500);
      expect(refusal.code).toBeUndefined();
    },
  );
});

describe('targets client: how it talks to the engine', () => {
  it.each(ROUTES)(
    '%s goes to http://127.0.0.1:<engine port> with the token in the header only, credentials omitted, not cached, no redirect',
    async (route) => {
      await settle(CALLS[route]());
      const request = present(engine.targetRequests(route)[0], `the ${route} request`);
      expect(request.origin).toBe('http://127.0.0.1:8297');
      expect(request.headers['x-emuforge-session']).toBe(TOKEN_1);
      expect(request.url.includes(TOKEN_1)).toBe(false);
      expect(request.init.credentials).toBe('omit');
      expect(request.init.cache).toBe('no-store');
      expect(request.init.redirect).toBe('error');
      const session = present(engine.sessions[0], 'the session request');
      expect(session.origin).toBe('http://127.0.0.1:8297');
      expect([session.init.credentials, session.init.cache, session.init.redirect]).toEqual([
        'omit',
        'no-store',
        'error',
      ]);
      expect(engine.requests.filter((r) => r.url.includes(TOKEN_1))).toEqual([]);
    },
  );

  it.each(['SessionInvalid', 'SessionRequired'])(
    'a 401 %s: one new session and one retry with the new token',
    async (code) => {
      engine.sessionAnswers = [
        { status: 200, json: { token: TOKEN_1 } },
        { status: 200, json: { token: TOKEN_2 } },
      ];
      engine.answerTargets('list', engineRefusal(401, code));
      const { value } = await settle(client.list());
      expect(value?.active).toBe('local');
      expect(engine.sessions).toHaveLength(2);
      expect(engine.targetRequests('list').map((r) => r.headers['x-emuforge-session'])).toEqual([TOKEN_1, TOKEN_2]);
    },
  );

  it('a second 401: a refusal with that code and no third request', async () => {
    engine.sessionAnswers = [
      { status: 200, json: { token: TOKEN_1 } },
      { status: 200, json: { token: TOKEN_2 } },
    ];
    engine.answerTargets('use', engineRefusal(401, 'SessionInvalid'), engineRefusal(401, 'SessionRequired'));
    const refusal = await refusalOf(client.use('second'));
    expect([refusal.status, refusal.code]).toEqual([401, 'SessionRequired']);
    expect(engine.targetRequests('use')).toHaveLength(2);
    expect(engine.sessions).toHaveLength(2);
  });

  it('the token is kept across calls: one session for several requests', async () => {
    await settle(client.list());
    await settle(client.info('local'));
    expect(engine.sessions).toHaveLength(1);
  });
});

describe('targets client: time limits and signals', () => {
  it.each(ROUTES)('%s failing at the network level: the engine not answering', async (route) => {
    engine.answerTargets(route, { network: true });
    const { error } = await settle(CALLS[route]());
    expect(error).toBeInstanceOf(EngineNotAnswering);
  });

  it.each(ROUTES.filter((route) => route !== 'test'))(
    '%s with no answer in 5 s: the engine not answering, and its request aborted',
    async (route) => {
      engine.answerTargets(route, { hang: true });
      const pending = CALLS[route]();
      await expect(settle(pending, 4_999)).rejects.toThrow('still pending');
      const { error } = await settle(pending, 1);
      expect(error).toBeInstanceOf(EngineNotAnswering);
      expect(present(engine.targetRequests(route)[0], 'the request').aborted()).toBe(true);
    },
  );

  it('a test with no answer in 15 s: the engine not answering, its request aborted; not at 14.9 s', async () => {
    engine.answerTargets('test', { hang: true });
    const pending = client.test('second');
    await expect(settle(pending, TEST_TIME_LIMIT_MS - 100)).rejects.toThrow('still pending');
    expect(present(engine.targetRequests('test')[0], 'the test request').aborted()).toBe(false);
    const { error } = await settle(pending, 100);
    expect(error).toBeInstanceOf(EngineNotAnswering);
    expect(present(engine.targetRequests('test')[0], 'the test request').aborted()).toBe(true);
  });

  it('a test that answers at 14.9 s: its answer is used', async () => {
    engine.answerTargets('test', { ...targetTest(SECOND), delayMs: TEST_TIME_LIMIT_MS - 100 });
    const { value } = await settle(client.test('second'), TEST_TIME_LIMIT_MS - 100);
    expect(value?.passed).toBe(true);
  });

  it.each(ROUTES)('%s with its signal aborted: ends at once with the signal’s reason', async (route) => {
    engine.answerTargets(route, { hang: true });
    const controller = new AbortController();
    const pending = CALLS[route](controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    const reason = new DOMException('left the page', 'AbortError');
    controller.abort(reason);
    const { error } = await settle(pending);
    expect(error).toBe(reason);
    expect(present(engine.targetRequests(route)[0], 'the request').aborted()).toBe(true);
  });

  it('a late answer after the signal aborted is not used', async () => {
    const late: FakeAnswer = { ...targetsList([LOCAL, SECOND], 'second'), delayMs: 1_000, ignoreAbort: true };
    engine.answerTargets('list', late);
    const controller = new AbortController();
    const pending = client.list(controller.signal);
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    const { value, error } = await settle(pending, 1_000);
    expect(value).toBeUndefined();
    expect(error).toBe(controller.signal.reason);
  });

  it('a signal aborted before the call: no request', async () => {
    const controller = new AbortController();
    controller.abort();
    const { error } = await settle(client.list(controller.signal));
    expect(error).toBe(controller.signal.reason);
    expect(engine.requests).toEqual([]);
  });
});

describe('targets client: a base through Studio’s port (issue 503)', () => {
  const BASE = 'https://name.test/__engine';
  const PATHS: Record<TargetsRoute, string> = {
    list: 'GET https://name.test/__engine/__emuforge/targets',
    info: 'GET https://name.test/__engine/__emuforge/targets/second',
    add: 'POST https://name.test/__engine/__emuforge/targets',
    use: 'POST https://name.test/__engine/__emuforge/targets/second/use',
    test: 'POST https://name.test/__engine/__emuforge/targets/second/test',
    remove: 'DELETE https://name.test/__engine/__emuforge/targets/second',
  };
  let restore: () => void;

  beforeEach(() => {
    restore = openPageAt('https://name.test/');
    engine.configPath = '/__engine';
    client = createTargetsClient(BASE);
  });

  afterEach(() => {
    restore();
  });

  it.each(ROUTES)(
    '%s: its request goes to <base>/__emuforge/targets… with the token, none to 127.0.0.1',
    async (route) => {
      engine.targets = route === 'add' ? [LOCAL] : [LOCAL, SECOND];
      const { error } = await settle(CALLS[route]());

      expect(error).toBeUndefined();
      expect(client.origin).toBe(BASE);
      expect(engine.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
        'GET https://name.test/__engine/__emuforge/session',
        PATHS[route],
      ]);
      expect(present(engine.targetRequests(route)[0], route).headers['x-emuforge-session']).toBe(TOKEN_1);
      expect(engine.requests.filter((r) => r.url.includes('127.0.0.1'))).toEqual([]);
    },
  );
});

describe('targets client: a base on loopback (issue 503)', () => {
  it.each(ROUTES)('http://127.0.0.1:8400, %s: the request of today', async (route) => {
    engine.targets = route === 'add' ? [LOCAL] : [LOCAL, SECOND];
    client = createTargetsClient('http://127.0.0.1:8400');
    const { error } = await settle(CALLS[route]());

    expect(error).toBeUndefined();
    const request = present(engine.targetRequests(route)[0], route);
    expect(request.origin).toBe('http://127.0.0.1:8400');
    expect(request.headers['x-emuforge-session']).toBe(TOKEN_1);
    expect(present(engine.sessions[0], 'the session').url).toBe('http://127.0.0.1:8400/__emuforge/session');
  });
});
