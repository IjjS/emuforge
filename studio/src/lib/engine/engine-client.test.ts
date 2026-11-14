import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advance,
  connected,
  engineRefusal,
  FakeEngine,
  present,
  renderApp,
  row,
  connectionAlert,
  TOKEN_1,
  TOKEN_2,
} from '../../features/home/home-test-kit';

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
  return (connectionAlert().getElement().textContent ?? '').replace(/\s+/g, ' ').trim();
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
    const kit = await import('../../features/home/home-test-kit');
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
