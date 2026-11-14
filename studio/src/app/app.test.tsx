import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advance, connected, FakeEngine, present, row } from '../features/home/home-test-kit';
import { App } from './app';

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
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Studio in the browser', () => {
  it('stores nothing in localStorage, sessionStorage, cookies or IndexedDB across Home, a service and not found', async () => {
    const { container } = render(<App />);
    await advance();
    expect(row('Engine').status).toBe('Connected');
    expect(row('Emulator').status).toBe('Connected');

    const s3 = present(createWrapper(container).findSideNavigation()?.findLinkByHref('/s3'), 'the S3 link');
    fireEvent.click(s3.getElement());
    await advance();
    expect(screen.getByRole('heading', { level: 1, name: 'Amazon Simple Storage Service' })).toBeInTheDocument();

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
