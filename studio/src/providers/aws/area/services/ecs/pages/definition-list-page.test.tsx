import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../definition-api';

// S7 rendered inside the area's layout, with the calls of `definition-api.ts` answered by the case
// (`definition-api.test.ts` proves the calls against a fake engine).

vi.mock('../definition-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../definition-api')>();
  return { ...real, listFamilies: vi.fn(), listRevisions: vi.fn(), getRevision: vi.fn() };
});

// TanStack Query hands its notifications to React on a 0 ms timer; here it notifies in a microtask, so `settled()`
// below comes after every notification by order alone.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;
}

const EMULATOR = { port: 9312, endpoint: 'https://127.0.0.1:9312' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8312';

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// Families and readers.

/** `listFamilies` answering each request from `pages`, by its prefix and its token (`''` for none). */
function answer(pages: Record<string, api.DefinitionPage<string>>) {
  vi.mocked(api.listFamilies).mockImplementation((_endpoint, prefix, token) =>
    Promise.resolve(pages[`${prefix}|${token ?? ''}`] ?? { items: [] }),
  );
}

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function rows(): string[] {
  return (table().findRows() ?? []).map((row) => text(row.getElement()));
}

async function expectRows(expected: string[]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

const counter = () => text(table().findHeaderSlot()?.findHeader()?.findCounter()?.getElement() as HTMLElement);
const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
const PATH = '/aws/ecs/task-definitions';

async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('the task definitions list', () => {
  it("families read → each a link to its page; the counter the page's number", async () => {
    answer({ '|': { items: ['web', 'worker'] } });
    const router = open(PATH);
    await expectRows(['web', 'worker']);
    expect(counter()).toBe('(2)');
    expect(screen.getByRole('heading', { level: 1, name: /Task definitions/ })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'web' });
    expect(link).toHaveAttribute('href', '/aws/ecs/task-definitions/family/web');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/family/web');
    });
  });

  it('a typed prefix, once settled → read with familyPrefix from the first page; no match → its state, and "Clear filter" empties the field and reads again', async () => {
    answer({ '|': { items: ['web'], nextToken: 'tok-2' }, '|tok-2': { items: ['worker'] } });
    open(PATH);
    await expectRows(['web']);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows(['worker']);

    const input = table().findTextFilter()?.findInput().findNativeInput().getElement() as HTMLInputElement;
    expect(input).toHaveAttribute('aria-label', 'Family name starts with');
    fireEvent.change(input, { target: { value: 'zz' } });
    await waitFor(() => {
      expect(vi.mocked(api.listFamilies).mock.calls.at(-1)?.slice(0, 3)).toEqual([ENGINE, 'zz', undefined]);
    });
    expect(await screen.findByText('No families match')).toBeInTheDocument();
    expect(text(slot())).toContain("No active family's name starts with zz.");
    const calls = vi.mocked(api.listFamilies).mock.calls.length;
    fireEvent.click(within(slot()).getByRole('button', { name: 'Clear filter' }));
    await expectRows(['web']);
    expect(input.value).toBe('');
    expect(vi.mocked(api.listFamilies).mock.calls.length).toBeGreaterThan(calls);
    expect(vi.mocked(api.listFamilies).mock.calls.at(-1)?.slice(0, 3)).toEqual([ENGINE, '', undefined]);
  });

  it('no family → "No task definitions", its sentence and "Register task definition"', async () => {
    answer({});
    const router = open(PATH);
    expect(await screen.findByText('No task definitions')).toBeInTheDocument();
    expect(
      screen.getByText('Register one, or make one with the AWS CLI or an IaC tool pointed at the local emulator.'),
    ).toBeInTheDocument();
    fireEvent.click(within(slot()).getByRole('link', { name: 'Register task definition' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/register');
    });
  });

  it('a failed read → the area\'s failure state with a retry; the page names "task definitions" to the frame', async () => {
    vi.mocked(api.listFamilies).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'ListTaskDefinitionFamilies',
        code: 'InternalError',
        message: 'broke',
      }),
    );
    open(PATH);
    expect(await screen.findByText('These task definitions are in your local emulator')).toBeInTheDocument();
    await waitFor(() => {
      expect(slot().textContent).toMatch(/InternalError.*broke/);
    });
    const calls = vi.mocked(api.listFamilies).mock.calls.length;
    answer({ '|': { items: ['web'] } });
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await expectRows(['web']);
    expect(vi.mocked(api.listFamilies).mock.calls.length).toBe(calls + 1);
  });

  it('"Refresh" → the current page is read again, with its token', async () => {
    answer({ '|': { items: ['web'], nextToken: 'tok-2' }, '|tok-2': { items: ['worker'] } });
    open(PATH);
    await expectRows(['web']);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows(['worker']);
    await settled();
    const calls = vi.mocked(api.listFamilies).mock.calls.length;
    answer({ '|': { items: ['web'], nextToken: 'tok-2' }, '|tok-2': { items: ['worker', 'zeta'] } });
    fireEvent.click(within(table().getElement()).getByRole('button', { name: 'Refresh' }));
    await expectRows(['worker', 'zeta']);
    expect(vi.mocked(api.listFamilies).mock.calls.length).toBe(calls + 1);
    expect(vi.mocked(api.listFamilies).mock.calls.at(-1)?.slice(0, 3)).toEqual([ENGINE, '', 'tok-2']);
  });
});
