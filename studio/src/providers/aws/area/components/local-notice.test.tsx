import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../lib/engine/engine-client';
import type { AreaConnection } from './emulator-line';
import type { PageResources } from './page-resources';

const ENGINE_ORIGIN = 'http://127.0.0.1:8297';
const ABOUT = 'About the local emulator';
const NOTICE = 'Local emulator notice';
const CLOSE = 'Close the local emulator notice';
const STANDALONE = 'EmuForge Studio is a stand-alone local tool, not an AWS feature.';

/** The connection Studio hands the area, as a test sets it; each change re-renders as Studio's frame does. */
class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: ENGINE_ORIGIN };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  answer(result: CheckResult) {
    this.value = { result, engineOrigin: ENGINE_ORIGIN };
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

function endpoint(port: number): string {
  return `https://127.0.0.1:${String(port)}`;
}

function connected(port = 9411): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port, endpoint: endpoint(port) } };
}

function emulatorDown(reason: string, port = 9411): CheckResult {
  return {
    kind: 'emulator-unreachable',
    checkedAt: Date.now(),
    emulator: { port, endpoint: endpoint(port) },
    reason,
    message: 'the engine says why',
  };
}

let connection: Connection;
/** The notice's module, evaluated afresh for each case, as on a fresh load of the document. */
let notices: typeof import('./local-notice');

beforeEach(async () => {
  connection = new Connection();
  vi.resetModules();
  notices = await import('./local-notice');
});

/** The emulator line and the notice as the area's frame puts them, for a page that names `resources`. */
function Frame({ resources }: { resources: PageResources }) {
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  return (
    <>
      <notices.EmulatorLineAndNotice connection={current} resources={resources} />
      <h1>The page</h1>
    </>
  );
}

function open(resources: PageResources = { word: 'buckets' }) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio's Home</p> },
      { path: '/aws/*', element: <Frame resources={resources} /> },
    ],
    { initialEntries: ['/aws/s3/buckets'] },
  );
  return render(<RouterProvider router={router} />);
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function notice(): HTMLElement | null {
  return screen.queryByRole('region', { name: NOTICE });
}

function about(): HTMLElement {
  return screen.getByRole('button', { name: ABOUT });
}

function close(): HTMLElement {
  return within(notice() as HTMLElement).getByRole('button', { name: CLOSE });
}

function noticeHeading(): string {
  return text(within(notice() as HTMLElement).getByText(/^These .+ are in your local emulator$/));
}

/** What both storages hold, key by key. */
function storages(): [string, string | null][] {
  return [localStorage, sessionStorage].flatMap((storage) =>
    Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? '';
      return [key, storage.getItem(key)] as [string, string | null];
    }),
  );
}

describe('the local-emulator notice', () => {
  it('connected, resources "buckets": the heading and the body with the endpoint', () => {
    connection.value = { result: connected(9411), engineOrigin: ENGINE_ORIGIN };
    open({ word: 'buckets' });

    expect(noticeHeading()).toBe('These buckets are in your local emulator');
    expect(text(notice())).toContain(
      `They are in the emulator at ${endpoint(9411)}, not in an AWS account. ${STANDALONE}`,
    );
  });

  it.each([
    ['checking', undefined],
    ['not started', emulatorDown('not_started')],
    ['not answering', emulatorDown('timeout')],
    ['engine not answering', { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: 9411 } as CheckResult],
    ['engine error', { kind: 'engine-error', checkedAt: 0, status: 403, code: 'OriginNotAllowed' } as CheckResult],
  ])('%s: the same heading and the body without an endpoint or a port', (_name, result) => {
    connection.value = { result, engineOrigin: ENGINE_ORIGIN };
    open({ word: 'buckets' });

    expect(noticeHeading()).toBe('These buckets are in your local emulator');
    expect(text(notice())).toContain(`They are not in an AWS account. ${STANDALONE}`);
    expect(text(notice())).not.toContain('https://');
    expect(text(notice())).not.toContain('9411');
  });

  it('open: a region named "Local emulator notice" with its close control; "About the local emulator" says expanded', () => {
    open();

    expect(notice()).not.toBeNull();
    expect(close()).toBeInTheDocument();
    expect(about()).toHaveAttribute('aria-expanded', 'true');
    expect(about()).toHaveAttribute('aria-controls', notice()?.id);
  });

  it('the close control chosen: the notice is gone, focus on the (i) control, collapsed, nothing stored', () => {
    localStorage.setItem('emuforge.studio.language', 'de');
    const before = storages();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    open();

    act(() => {
      fireEvent.click(close());
    });

    expect(notice()).toBeNull();
    expect(document.activeElement).toBe(about());
    expect(about()).toHaveAttribute('aria-expanded', 'false');
    // `aria-controls` names only an element that is on the page.
    expect(about()).not.toHaveAttribute('aria-controls');
    expect(storages()).toEqual(before);
    expect(setItem).not.toHaveBeenCalled();
    localStorage.clear();
  });

  it('"About the local emulator" chosen while closed: the notice is shown and focus is on it', () => {
    open();
    act(() => {
      fireEvent.click(close());
    });

    act(() => {
      fireEvent.click(about());
    });

    expect(notice()).not.toBeNull();
    expect(notice()).toContainElement(document.activeElement as HTMLElement);
    // On the notice's content, not on its close control.
    expect(document.activeElement).not.toBe(close());
    expect(document.activeElement).toHaveTextContent('These buckets are in your local emulator');
    expect(about()).toHaveAttribute('aria-expanded', 'true');
  });

  it('"About the local emulator" chosen while open: the notice is gone and the control stays', () => {
    open();

    act(() => {
      fireEvent.click(about());
    });

    expect(notice()).toBeNull();
    expect(about()).toBeInTheDocument();
    expect(about()).toHaveAttribute('aria-expanded', 'false');
  });

  it('"About the local emulator" chosen five times from closed: shown after 1, 3, 5, gone after 2, 4, never two', () => {
    open();
    act(() => {
      fireEvent.click(close());
    });

    const shown: boolean[] = [];
    for (let press = 0; press < 5; press += 1) {
      act(() => {
        fireEvent.click(about());
      });
      expect(screen.queryAllByRole('region', { name: NOTICE }).length).toBeLessThanOrEqual(1);
      shown.push(notice() !== null);
    }

    expect(shown).toEqual([true, false, true, false, true]);
    expect(about()).toBeInTheDocument();
  });

  it('opened with the keyboard: Tab from the notice reaches its close control, and Enter there closes it', async () => {
    const user = userEvent.setup();
    open();
    await user.click(close());
    expect(notice()).toBeNull();

    about().focus();
    await user.keyboard('{Enter}');
    expect(notice()).toContainElement(document.activeElement as HTMLElement);

    await user.tab();
    expect(document.activeElement).toBe(close());

    await user.keyboard('{Enter}');
    expect(notice()).toBeNull();
    expect(document.activeElement).toBe(about());
  });

  it('connected, then not started while open: the notice stays open and its body loses the endpoint', () => {
    connection.value = { result: connected(9411), engineOrigin: ENGINE_ORIGIN };
    open();
    expect(text(notice())).toContain(`They are in the emulator at ${endpoint(9411)}, not in an AWS account.`);

    connection.answer(emulatorDown('not_started'));

    expect(notice()).not.toBeNull();
    expect(text(notice())).toContain(`They are not in an AWS account. ${STANDALONE}`);
    expect(text(notice())).not.toContain('https://');
  });
});
