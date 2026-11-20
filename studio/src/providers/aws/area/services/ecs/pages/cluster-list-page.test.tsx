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
import * as api from '../api';

// S1 rendered inside the area's layout, with the calls of `api.ts` answered by the case (`api.test.ts` proves the
// calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listClusters: vi.fn(), getCluster: vi.fn(), deleteCluster: vi.fn() };
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
  vi.mocked(api.getCluster).mockResolvedValue({ found: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = '/aws/ecs/clusters') {
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
// Clusters and readers.

function cluster(name: string, changes: Partial<api.Cluster> = {}): api.Cluster {
  return {
    name,
    arn: `arn:aws:ecs:us-east-1:000000000000:cluster/${name}`,
    status: 'ACTIVE',
    activeServices: 1,
    runningTasks: 2,
    pendingTasks: 0,
    ...changes,
  };
}

/** `listClusters` answering each request from `pages`, by its token (`''` for none). */
function answer(pages: Record<string, api.ClusterPage>) {
  vi.mocked(api.listClusters).mockImplementation((_endpoint, token) =>
    Promise.resolve(pages[token ?? ''] ?? { clusters: [] }),
  );
}

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function rows(): string[][] {
  return (table().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => !/selection-control/.test(cell.className) && cell.querySelector('input') === null)
      .map(text),
  );
}

async function expectRows(expected: string[][]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

function action(name: string): HTMLElement {
  return within(table().getElement()).getByRole('button', { name });
}

const counter = () => text(table().findHeaderSlot()?.findHeader()?.findCounter()?.getElement() as HTMLElement);

async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const DEV = cluster('dev');
const BUSY = cluster('busy', { status: 'PROVISIONING', activeServices: 0, runningTasks: 5, pendingTasks: 1 });

// ---------------------------------------------------------------------------------------------------------------

describe('the clusters list', () => {
  it("clusters read → the five columns of R4, each name a link to its page, the counter the page's number", async () => {
    answer({ '': { clusters: [DEV, BUSY, { name: 'bare', status: '' }] } });
    const router = open();
    await expectRows([
      ['dev', 'Active', '1', '2', '0'],
      ['busy', 'Provisioning', '0', '5', '1'],
      ['bare', '-', '-', '-', '-'],
    ]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'Name',
      'Status',
      'Services',
      'Running tasks',
      'Pending tasks',
    ]);
    expect(counter()).toBe('(3)');
    expect(screen.getByRole('heading', { level: 1, name: /Clusters/ })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'dev' });
    expect(link).toHaveAttribute('href', '/aws/ecs/clusters/cluster/dev');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters/cluster/dev');
    });
  });

  it('at /aws/ecs too, with no redirect', async () => {
    answer({ '': { clusters: [DEV] } });
    const router = open('/aws/ecs');
    await expectRows([['dev', 'Active', '1', '2', '0']]);
    expect(router.state.location.pathname).toBe('/aws/ecs');
  });

  it('no cluster → "No clusters", its sentence and "Create cluster"', async () => {
    answer({});
    const router = open();
    expect(await screen.findByText('No clusters')).toBeInTheDocument();
    expect(
      screen.getByText('Create a cluster, or make one with the AWS CLI or an IaC tool pointed at the local emulator.'),
    ).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Create cluster' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters/create');
    });
  });

  it("a failed read → the area's failure state with a retry that reads again", async () => {
    vi.mocked(api.listClusters).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'ListClusters', code: 'InternalError', message: 'broke' }),
    );
    open();
    const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
    await waitFor(() => {
      expect(slot().textContent).toMatch(/InternalError.*broke/);
    });
    const calls = vi.mocked(api.listClusters).mock.calls.length;
    answer({ '': { clusters: [DEV] } });
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await expectRows([['dev', 'Active', '1', '2', '0']]);
    expect(vi.mocked(api.listClusters).mock.calls.length).toBe(calls + 1);
  });

  it('a next page → asked with the token the first page answered; "Refresh" reads the current page again', async () => {
    answer({ '': { clusters: [DEV], nextToken: 'tok-2' }, 'tok-2': { clusters: [BUSY] } });
    open();
    await expectRows([['dev', 'Active', '1', '2', '0']]);
    expect(counter()).toBe('(1+)');
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([['busy', 'Provisioning', '0', '5', '1']]);
    expect(vi.mocked(api.listClusters).mock.calls.at(-1)?.slice(0, 2)).toEqual([ENGINE, 'tok-2']);
    const calls = vi.mocked(api.listClusters).mock.calls.length;
    fireEvent.click(action('Refresh'));
    await waitFor(() => {
      expect(vi.mocked(api.listClusters).mock.calls.length).toBe(calls + 1);
    });
    expect(vi.mocked(api.listClusters).mock.calls.at(-1)?.slice(0, 2)).toEqual([ENGINE, 'tok-2']);
    await expectRows([['busy', 'Provisioning', '0', '5', '1']]);
  });

  it('one cluster selected, "Delete" confirmed and answered → "Cluster {name} deleted." and the list read again', async () => {
    answer({ '': { clusters: [DEV, BUSY] } });
    vi.mocked(api.deleteCluster).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('radio', { name: 'dev' }));
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    answer({ '': { clusters: [BUSY] } });
    const calls = vi.mocked(api.listClusters).mock.calls.length;
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'dev' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Cluster dev deleted.')).toBeInTheDocument();
    await expectRows([['busy', 'Provisioning', '0', '5', '1']]);
    expect(vi.mocked(api.listClusters).mock.calls.length).toBeGreaterThan(calls);
    expect(vi.mocked(api.deleteCluster).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'dev']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('(order) the list read answers before the delete is handled, and again after → the flash shown once and stays', async () => {
    answer({ '': { clusters: [DEV, BUSY] } });
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('radio', { name: 'dev' }));
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    answer({ '': { clusters: [BUSY] } });
    // The delete's answer is handled only after the list's read it started has answered.
    let finish: () => void = () => undefined;
    vi.mocked(api.deleteCluster).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'dev' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await settled();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await settled();
    await expectRows([['busy', 'Provisioning', '0', '5', '1']]);
    expect(screen.getAllByText('Cluster dev deleted.')).toHaveLength(1);
    // A later read of the list.
    fireEvent.click(action('Refresh'));
    await settled();
    await expectRows([['busy', 'Provisioning', '0', '5', '1']]);
    expect(screen.getAllByText('Cluster dev deleted.')).toHaveLength(1);
  });

  it('the page names "clusters" to the area\'s frame', async () => {
    answer({});
    open();
    expect(await screen.findByText('These clusters are in your local emulator')).toBeInTheDocument();
  });
});
