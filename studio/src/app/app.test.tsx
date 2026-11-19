import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advance, connected, FakeEngine, present, row } from '../test/home-test-kit';
import { NO_SCREEN_SENTENCE, NO_SCREEN_SERVICE } from '../test/no-screen';
import { App } from './app';
import type { Provider, ProviderAreaProps } from './provider-list';

/** The AWS area's first import is real work (Cloudscape's modules), not a timer; a cold run takes a while. */
const AREA_LOAD = { timeout: 10_000, interval: 20 };

let engine: FakeEngine;
// The browser's IndexedDB, watched: jsdom has none, so the test gives the page one that records every use.
let indexedDb: {
  open: ReturnType<typeof vi.fn>;
  deleteDatabase: ReturnType<typeof vi.fn>;
  databases: () => Promise<[]>;
};

function clearCookies() {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  engine = new FakeEngine();
  engine.healthAnswers = [connected()];
  vi.stubGlobal('fetch', engine.fetch);
  indexedDb = { open: vi.fn(), deleteDatabase: vi.fn(), databases: () => Promise.resolve([]) };
  vi.stubGlobal('indexedDB', indexedDb);
  // The AWS area follows the operating system's scheme, which jsdom does not report: light here.
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A second provider, as one more entry of the providers list would add it (requirement R6.2). */
function TestArea({ onPageTitle }: ProviderAreaProps) {
  useEffect(() => {
    onPageTitle('Test area');
  }, [onPageTitle]);
  return <main>Test area</main>;
}

const TEST_PROVIDER: Provider = {
  name: 'Test Cloud',
  shortName: 'Test',
  segment: 'test',
  services: [{ label: 'Test Service', path: '/test/svc', hasScreen: false }],
  loadArea: () => Promise.resolve({ default: TestArea }),
};

describe('Studio with a second provider in the list', () => {
  afterEach(() => {
    vi.doUnmock('./provider-list');
    vi.resetModules();
  });

  it('shows it in the frame and on Home, renders its area under its segment, and keeps the AWS area as it was', async () => {
    vi.resetModules();
    vi.doMock('./provider-list', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./provider-list')>();
      return { ...actual, PROVIDERS: [...actual.PROVIDERS, TEST_PROVIDER] };
    });
    const { App: AppWithTest } = await import('./app');
    render(<AppWithTest />);
    await advance();

    const studio = screen.getByRole('navigation', { name: 'Studio' });
    expect(
      within(studio)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Home', 'Connections', 'AWS', 'Test']);
    const providers = screen.getByRole('region', { name: 'Providers (2)' });
    const entry = within(providers).getByRole('link', { name: 'Test Cloud' });
    expect(entry).toHaveAttribute('href', '/test');
    expect(within(providers).getByRole('link', { name: 'Test Service' })).toHaveAttribute('href', '/test/svc');

    fireEvent.click(within(providers).getByRole('link', { name: 'Test Service' }));
    await vi.waitFor(async () => {
      await advance();
      expect(screen.getByText('Test area')).toBeInTheDocument();
    }, AREA_LOAD);
    expect(window.location.pathname).toBe('/test/svc');
    // Inside Studio's frame: its banner is still above the area.
    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('link', { name: 'EmuForge Studio' }));
    expect(within(studio).getByRole('link', { name: 'Test' })).toHaveAttribute('aria-current', 'true');

    act(() => {
      window.history.pushState(null, '', NO_SCREEN_SERVICE.path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await vi.waitFor(async () => {
      await advance();
      expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN_SERVICE.label })).toBeInTheDocument();
    }, AREA_LOAD);
    expect(screen.getByText(NO_SCREEN_SENTENCE)).toBeInTheDocument();
  });
});

describe('Studio in the browser', () => {
  it('stores nothing in localStorage, sessionStorage, cookies or IndexedDB across Home, /aws, /aws/kinesis and not found', async () => {
    render(<App />);
    await advance();
    expect(row('Engine').status).toBe('Connected');
    expect(row('Emulator').status).toBe('Connected');

    const studio = screen.getByRole('navigation', { name: 'Studio' });
    fireEvent.click(within(studio).getByRole('link', { name: 'AWS' }));
    // The AWS area loads on its first opening; the import is real work, not a timer.
    const service = await vi.waitFor(async () => {
      await advance();
      return present(
        screen.queryAllByRole('link', { name: NO_SCREEN_SERVICE.label })[0],
        `a link to ${NO_SCREEN_SERVICE.label} in the AWS area`,
      );
    }, AREA_LOAD);
    expect(window.location.pathname).toBe('/aws');
    expect(screen.getByRole('heading', { level: 1, name: 'Amazon Web Services' })).toBeInTheDocument();

    fireEvent.click(service);
    await advance();
    expect(window.location.pathname).toBe(NO_SCREEN_SERVICE.path);
    expect(screen.getByRole('heading', { level: 1, name: NO_SCREEN_SERVICE.label })).toBeInTheDocument();

    act(() => {
      window.history.pushState(null, '', '/does-not-exist');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await advance();
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(indexedDb.open).not.toHaveBeenCalled();
    expect(indexedDb.deleteDatabase).not.toHaveBeenCalled();
  });
});
