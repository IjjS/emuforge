import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advance,
  commandsIn,
  connected,
  connectionNotice,
  FakeEngine,
  noticeText,
  openPageAt,
  row,
  type FakeAnswer,
} from '../../test/home-test-kit';

// Home when Studio's server names the channel `/__engine` in `/config.json` (issue 503), and when it names none. The
// page reads its configuration once, so each case loads the app afresh: a new page with its own `/config.json`.

const PAGE = 'https://name.test:8296';
const BASE = `${PAGE}/__engine`;

let engine: FakeEngine;
let restore: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  engine.configPort = 8400;
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  restore();
  restore = () => undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Opens Home of a page loaded afresh, the health requests answered in order, and lets the first check complete. */
async function openHome(...answers: FakeAnswer[]) {
  engine.healthAnswers = answers;
  vi.resetModules();
  const { routes } = await import('../../app/routes');
  const { Providers } = await import('../../app/providers');
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  await advance();
}

describe('Home: through Studio’s port', () => {
  beforeEach(() => {
    restore = openPageAt(`${PAGE}/`);
    engine.configPath = '/__engine';
  });

  it('a completed check shows the connection as connected; every request went to the page’s origin, none to 127.0.0.1:8400', async () => {
    await openHome(connected());

    expect(row('Engine').status).toBe('Connected');
    expect(row('Emulator').status).toBe('Connected');
    expect(engine.sessions.map((r) => r.url)).toEqual([`${BASE}/__emuforge/session`]);
    expect(engine.healths.map((r) => r.url)).toEqual([`${BASE}/__emuforge/health`]);
    for (const request of engine.requests) {
      expect(request.origin).toBe(PAGE);
    }
    expect(engine.requests.filter((r) => r.url.startsWith('http://127.0.0.1:'))).toEqual([]);
  });

  it('when the engine does not answer, the text that names the engine’s address names <page origin>/__engine', async () => {
    await openHome({ network: true });

    expect(row('Engine')).toMatchObject({ status: 'Unreachable', text: expect.stringContaining(BASE) as string });
    expect(noticeText()).toContain(`Studio gets no answer it can read from the engine at ${BASE}.`);
    expect(noticeText()).not.toContain('http://127.0.0.1:8400');
  });

  it('the start command names --port 8400, as today', async () => {
    await openHome({ network: true });

    expect(commandsIn(connectionNotice())).toEqual([
      ['cargo run \\', '  -p emuforge -- serve \\', '  --port 8400 \\', '  --studio-port 8296'],
    ]);
  });
});

describe('Home: without enginePath', () => {
  it('sends the requests of today to http://127.0.0.1:8400, and names that address', async () => {
    await openHome({ network: true });

    expect(engine.sessions.map((r) => r.url)).toEqual(['http://127.0.0.1:8400/__emuforge/session']);
    expect(engine.healths.map((r) => r.url)).toEqual(['http://127.0.0.1:8400/__emuforge/health']);
    expect(row('Engine')).toMatchObject({
      status: 'Unreachable',
      text: expect.stringContaining('http://127.0.0.1:8400') as string,
    });
    expect(noticeText()).toContain('Studio gets no answer it can read from the engine at http://127.0.0.1:8400.');
    expect(commandsIn(connectionNotice())[0]).toContain('  --port 8400 \\');
  });

  it('a completed check: connected, with the requests at http://127.0.0.1:8400', async () => {
    await openHome(connected());

    expect(row('Engine').status).toBe('Connected');
    expect(engine.healths.map((r) => r.origin)).toEqual(['http://127.0.0.1:8400']);
  });
});
