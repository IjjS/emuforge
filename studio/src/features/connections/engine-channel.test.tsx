import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advance, FakeEngine, openPageAt, type FakeTarget } from '../../test/home-test-kit';

// The connections page when Studio's server names the channel `/__engine` in `/config.json` (issue 503), and when it
// names none. The page reads its configuration once, so each case loads the app afresh: a new page.

const PAGE = 'https://name.test:8296';
const LOCAL: FakeTarget = { name: 'local', endpoint: 'https://127.0.0.1:9301' };
const SECOND: FakeTarget = { name: 'second', endpoint: 'https://127.0.0.1:9302' };

let engine: FakeEngine;
let restore: () => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  engine.configPort = 8400;
  engine.targets = [LOCAL, SECOND];
  engine.active = 'local';
  vi.stubGlobal('fetch', engine.fetch);
});

afterEach(() => {
  restore();
  restore = () => undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Opens `/connections` of a page loaded afresh, and lets what it starts on load complete. */
async function openPage() {
  vi.resetModules();
  const { routes } = await import('../../app/routes');
  const { Providers } = await import('../../app/providers');
  const router = createMemoryRouter(routes, { initialEntries: ['/connections'] });
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  await advance();
}

function rowNames(): string[] {
  return [...document.querySelectorAll('li.st-record')].map((row) => row.querySelector('code')?.textContent ?? '');
}

describe('the connections page: through Studio’s port', () => {
  beforeEach(() => {
    restore = openPageAt(`${PAGE}/connections`);
    engine.configPath = '/__engine';
  });

  it('lists the targets from requests to <page origin>/__engine/__emuforge/targets, none to 127.0.0.1', async () => {
    await openPage();

    expect(rowNames()).toEqual(['local', 'second']);
    expect(engine.targetRequests('list').map((r) => r.url)).toEqual([`${PAGE}/__engine/__emuforge/targets`]);
    expect(engine.targetRequests('info').map((r) => r.url)).toEqual([
      `${PAGE}/__engine/__emuforge/targets/local`,
      `${PAGE}/__engine/__emuforge/targets/second`,
    ]);
    expect(engine.requests.filter((r) => r.url.startsWith('http://127.0.0.1:'))).toEqual([]);
  });
});

describe('the connections page: without enginePath', () => {
  it('lists the targets from requests to http://127.0.0.1:8400/__emuforge/targets, as today', async () => {
    await openPage();

    expect(rowNames()).toEqual(['local', 'second']);
    expect(engine.targetRequests('list').map((r) => r.url)).toEqual(['http://127.0.0.1:8400/__emuforge/targets']);
    expect(engine.targetRequests('info').map((r) => r.origin)).toEqual([
      'http://127.0.0.1:8400',
      'http://127.0.0.1:8400',
    ]);
  });
});
