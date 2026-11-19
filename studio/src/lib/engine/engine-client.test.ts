import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advance,
  connected,
  connectedTo,
  emulatorDown,
  emulatorDownOn,
  engineRefusal,
  FakeEngine,
  present,
  renderApp,
  row,
  connectionNotice,
  TOKEN_1,
  TOKEN_2,
} from '../../test/home-test-kit';
import { createEngineClient, startedAtOf, targetOf, type CheckResult } from './engine-client';

const SESSION_URL = 'http://127.0.0.1:8297/__emuforge/session';
const HEALTH_URL = 'http://127.0.0.1:8297/__emuforge/health';

let engine: FakeEngine;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function alertText(): string {
  return (connectionNotice().textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Which engine route each engine request went to, in order. */
function engineRoutes(): string[] {
  return engine.requests.filter((r) => r.origin.startsWith('http://127.0.0.1:')).map((r) => r.path);
}

describe('engine client: session', () => {
  it('opens a session without credentials and not cached, then asks health with its token in a header only', async () => {
    renderApp('/');
    await advance();
    expect(engineRoutes()).toEqual(['/__emuforge/session', '/__emuforge/health']);
    const session = present(engine.sessions[0], 'the session request');
    expect(session.url).toBe(SESSION_URL);
    expect(session.init.credentials).toBe('omit');
    expect(session.init.cache).toBe('no-store');
    expect(session.headers['x-emuforge-session']).toBeUndefined();
    const health = present(engine.healths[0], 'the health request');
    expect(health.url).toBe(HEALTH_URL);
    expect(health.headers['x-emuforge-session']).toBe(TOKEN_1);
    expect(health.init.credentials).toBe('omit');
    expect(health.init.cache).toBe('no-store');
    expect(engine.requests.filter((r) => r.url.includes(TOKEN_1))).toEqual([]);
    expect(row('Engine').status).toBe('Connected');
  });

  it('sends the same token on later checks, with no new session while the engine accepts it', async () => {
    renderApp('/');
    await advance();
    await advance(5_000);
    await advance(5_000);
    expect(engine.healths).toHaveLength(3);
    expect(engine.sessions).toHaveLength(1);
    expect(engine.healths.map((h) => h.headers['x-emuforge-session'])).toEqual([TOKEN_1, TOKEN_1, TOKEN_1]);
  });

  it.each(['SessionInvalid', 'SessionRequired'])(
    'answers a 401 %s with one new session and one retry with the new token, whose 200 shows "Connected"',
    async (code) => {
      engine.sessionAnswers = [
        { status: 200, json: { token: TOKEN_1 } },
        { status: 200, json: { token: TOKEN_2 } },
      ];
      renderApp('/');
      await advance();
      expect(row('Engine').status).toBe('Connected');
      engine.answerHealth(engineRefusal(401, code), connected());
      await advance(5_000);
      expect(engineRoutes()).toEqual([
        '/__emuforge/session',
        '/__emuforge/health',
        '/__emuforge/health',
        '/__emuforge/session',
        '/__emuforge/health',
      ]);
      expect(engine.healths.map((h) => h.headers['x-emuforge-session'])).toEqual([TOKEN_1, TOKEN_1, TOKEN_2]);
      expect(row('Engine').status).toBe('Connected');
      expect(row('Emulator').status).toBe('Connected');
    },
  );

  it('shows "Error" with SessionInvalid when the retried request is refused again, and asks no more in that check', async () => {
    engine.sessionAnswers = [
      { status: 200, json: { token: TOKEN_1 } },
      { status: 200, json: { token: TOKEN_2 } },
    ];
    engine.healthAnswers = [engineRefusal(401, 'SessionInvalid'), engineRefusal(401, 'SessionInvalid'), connected()];
    renderApp('/');
    await advance();
    expect(engine.healths).toHaveLength(2);
    expect(engine.sessions).toHaveLength(2);
    expect(row('Engine').status).toBe('Error');
    expect(alertText()).toContain('Engine error: SessionInvalid');
    // Nothing more until the next check, 5 seconds later.
    await advance(4_999);
    expect(engine.healths).toHaveLength(2);
    expect(engine.sessions).toHaveLength(2);
  });
});

describe('engine client: session failures', () => {
  it('shows "Unreachable" and sends no health request when the session request fails at the network level', async () => {
    engine.sessionAnswers = [{ network: true }];
    renderApp('/');
    await advance();
    expect(row('Engine').status).toBe('Unreachable');
    expect(engine.healths).toEqual([]);
  });

  it('shows "Unreachable" and sends no health request when the check reaches 5 seconds waiting for the session', async () => {
    engine.sessionAnswers = [{ hang: true }];
    renderApp('/');
    await advance(5_000);
    expect(row('Engine').status).toBe('Unreachable');
    expect(engine.healths).toEqual([]);
    expect(present(engine.sessions[0], 'the session request').aborted()).toBe(true);
  });

  it.each([
    ['200 with a body that has no token', { status: 200, json: { session: 'x' } }, 'HTTP status 200'],
    ['403 OriginNotAllowed', engineRefusal(403, 'OriginNotAllowed'), 'Engine error: OriginNotAllowed'],
  ])(
    'a session answer %s: "Error" with the code, or the HTTP status, and no health request',
    async (_n, answer, shown) => {
      engine.sessionAnswers = [answer];
      renderApp('/');
      await advance();
      expect(row('Engine').status).toBe('Error');
      expect(alertText()).toContain(shown);
      expect(engine.healths).toEqual([]);
    },
  );
});

describe('engine client: engine port', () => {
  // The page reads its configuration once per load; each case loads the app afresh.
  async function renderFresh() {
    vi.resetModules();
    const kit = await import('../../test/home-test-kit');
    const view = kit.renderApp('/');
    await kit.advance();
    return view;
  }

  it('sends every engine request to the port Studio’s server gives, 8400', async () => {
    engine.configPort = 8400;
    const view = await renderFresh();
    const engineRequests = engine.requests.filter((r) => r.path.startsWith('/__emuforge/'));
    expect(engineRequests.length).toBeGreaterThanOrEqual(2);
    expect(engineRequests.map((r) => r.origin)).toEqual(engineRequests.map(() => 'http://127.0.0.1:8400'));
    view.unmount();
  });

  it('sends every engine request to 127.0.0.1:8297 when Studio’s server gives none', async () => {
    engine.configPort = undefined;
    const view = await renderFresh();
    const engineRequests = engine.requests.filter((r) => r.path.startsWith('/__emuforge/'));
    expect(engineRequests.length).toBeGreaterThanOrEqual(2);
    expect(engineRequests.map((r) => r.origin)).toEqual(engineRequests.map(() => 'http://127.0.0.1:8297'));
    view.unmount();
  });
});

describe('engine client: the target and when a check started (issue 486, s1)', () => {
  /** One check of a client of the fake engine, started at `start` and answered `delayMs` later. */
  async function checkAt(start: number): Promise<CheckResult> {
    vi.setSystemTime(start);
    const client = createEngineClient(8297);
    const pending = client.check();
    await vi.advanceTimersByTimeAsync(1_000);
    return pending;
  }

  it('a health answer 200 naming the target local: connected, with target local and the time its check started', async () => {
    engine.healthAnswers = [{ ...connectedTo('local', 9411), delayMs: 400 }];
    const result = await checkAt(1_000_000);
    expect(result).toMatchObject({
      kind: 'connected',
      target: 'local',
      startedAt: 1_000_000,
      checkedAt: 1_000_400,
      emulator: { port: 9411, endpoint: 'https://127.0.0.1:9411' },
    });
    expect(targetOf(result)).toBe('local');
    expect(startedAtOf(result)).toBe(1_000_000);
  });

  it('a health answer 503 not started naming the target second: not started, with target second', async () => {
    engine.healthAnswers = [emulatorDownOn('second', 9302, 'there are no emulator files for port 9302')];
    const result = await checkAt(2_000_000);
    expect(result).toMatchObject({
      kind: 'emulator-unreachable',
      target: 'second',
      reason: 'not_started',
      message: 'there are no emulator files for port 9302',
      emulator: { port: 9302 },
      startedAt: 2_000_000,
    });
  });

  it.each([
    ['no target', connected(9411)],
    [
      'an empty target',
      {
        status: 200,
        json: { target: '', emulator: { port: 9411, endpoint: 'https://127.0.0.1:9411', reachable: true } },
      },
    ],
    [
      'a numeric target',
      {
        status: 200,
        json: { target: 7, emulator: { port: 9411, endpoint: 'https://127.0.0.1:9411', reachable: true } },
      },
    ],
    [
      'a target that is an object',
      {
        status: 200,
        json: { target: { name: 'x' }, emulator: { port: 9411, endpoint: 'https://127.0.0.1:9411', reachable: true } },
      },
    ],
  ])('a health answer 200 with %s: the result as before this issue, with no target', async (_n, answer) => {
    engine.healthAnswers = [answer];
    const result = await checkAt(3_000_000);
    expect(result).toEqual({
      kind: 'connected',
      checkedAt: 3_000_000,
      startedAt: 3_000_000,
      emulator: { port: 9411, endpoint: 'https://127.0.0.1:9411' },
    });
    expect('target' in result).toBe(false);
    expect(targetOf(result)).toBeUndefined();
  });

  it('a health answer 503 with no target: not started as before, with no target', async () => {
    engine.healthAnswers = [emulatorDown('not_started', 9302)];
    const result = await checkAt(3_500_000);
    expect(result.kind).toBe('emulator-unreachable');
    expect('target' in result).toBe(false);
  });

  it.each([
    ['connected', connectedTo('local'), 'connected'],
    ['emulator not answering', emulatorDownOn('local'), 'emulator-unreachable'],
    ['engine not answering (network)', { network: true } as const, 'engine-unreachable'],
    ['engine not answering (time limit)', { hang: true } as const, 'engine-unreachable'],
    ['engine error', engineRefusal(500, 'Internal'), 'engine-error'],
  ])('a result %s carries the time its check started', async (_n, answer, kind) => {
    engine.healthAnswers = [answer];
    vi.setSystemTime(4_000_000);
    const pending = createEngineClient(8297).check();
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    expect(result.kind).toBe(kind);
    expect(result.startedAt).toBe(4_000_000);
  });

  it('a result built without startedAt counts as started at its checkedAt', () => {
    expect(startedAtOf({ kind: 'engine-unreachable', checkedAt: 77, lastEmulatorPort: undefined })).toBe(77);
  });
});
