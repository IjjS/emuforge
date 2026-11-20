import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../definition-api';

// S8 rendered inside the area's layout, with the calls of `definition-api.ts` answered by the case
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
// Revisions and readers.

const row = (revision: number, family = 'web'): api.RevisionRow => ({
  value: `${family}:${String(revision)}`,
  family,
  revision,
});

/**
 * `listRevisions` answering each request from `pages`, by its status and its token (`ACTIVE|` for the first page);
 * a read of `maxResults` 1 answers the first row of that status's first page.
 */
function answer(pages: Record<string, api.DefinitionPage<api.RevisionRow>>) {
  vi.mocked(api.listRevisions).mockImplementation((_endpoint, _family, status, token, _signal, maxResults) => {
    const page = pages[`${status}|${token ?? ''}`] ?? { items: [] };
    return Promise.resolve(maxResults === 1 ? { items: page.items.slice(0, 1) } : page);
  });
}

const calls = () => vi.mocked(api.listRevisions).mock.calls;
const pageCalls = () => calls().filter((call) => call[5] === undefined);
const newestCalls = () => calls().filter((call) => call[5] === 1);

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function rows(): string[] {
  return (table().findRows() ?? []).map((tableRow) => text(tableRow.getElement()));
}

async function expectRows(expected: string[]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

const PATH = '/aws/ecs/task-definitions/family/web';

function register(): HTMLElement {
  const found = [...document.querySelectorAll('a, button')].filter((element) =>
    text(element).startsWith('Register new revision'),
  );
  expect(found).toHaveLength(1);
  return found[0] as HTMLElement;
}

function chooseStatus(value: string) {
  const select = table().findFilterSlot()?.findSelect();
  expect(select).not.toBeNull();
  select?.openDropdown();
  select?.selectOptionByValue(value);
}

// ---------------------------------------------------------------------------------------------------------------

describe("a family's page", () => {
  it('revisions read → newest first, each a link to its page', async () => {
    answer({ 'ACTIVE|': { items: [row(3), row(2)] } });
    const router = open(PATH);
    await expectRows(['web:3', 'web:2']);
    expect(pageCalls()[0]?.slice(1, 4)).toEqual(['web', 'ACTIVE', undefined]);
    expect(screen.getByRole('heading', { level: 1, name: 'web' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'web:3' });
    expect(link).toHaveAttribute('href', '/aws/ecs/task-definitions/family/web/revision/3');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/family/web/revision/3');
    });
  });

  it('"Inactive" chosen by value → read with status INACTIVE; empty → "No inactive revisions"', async () => {
    answer({ 'ACTIVE|': { items: [row(2)] } });
    open(PATH);
    await expectRows(['web:2']);
    chooseStatus('INACTIVE');
    await waitFor(() => {
      expect(pageCalls().at(-1)?.slice(1, 4)).toEqual(['web', 'INACTIVE', undefined]);
    });
    expect(await screen.findByText('No inactive revisions')).toBeInTheDocument();
  });

  it('"Active" empty while an inactive revision exists → "No active revisions"', async () => {
    answer({ 'INACTIVE|': { items: [row(1)] } });
    open(PATH);
    expect(await screen.findByText('No active revisions')).toBeInTheDocument();
    expect(newestCalls().map((call) => call[2])).toContain('INACTIVE');
    expect(screen.queryByText('No family named web')).not.toBeInTheDocument();
  });

  it('"Refresh" → the current page is read again, with its token', async () => {
    answer({ 'ACTIVE|': { items: [row(3)], nextToken: 'tok-2' }, 'ACTIVE|tok-2': { items: [row(2)] } });
    open(PATH);
    await expectRows(['web:3']);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows(['web:2']);
    const before = pageCalls().length;
    answer({ 'ACTIVE|': { items: [row(3)], nextToken: 'tok-2' }, 'ACTIVE|tok-2': { items: [row(2), row(1)] } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await expectRows(['web:2', 'web:1']);
    expect(pageCalls().length).toBe(before + 1);
    expect(pageCalls().at(-1)?.slice(1, 4)).toEqual(['web', 'ACTIVE', 'tok-2']);
  });

  it('"Register new revision" → the register address with from the newest active revision; none → unavailable with its reason', async () => {
    answer({ 'ACTIVE|': { items: [row(3), row(2)] } });
    const router = open(PATH);
    await expectRows(['web:3', 'web:2']);
    await waitFor(() => {
      expect(register()).toHaveAttribute('href', '/aws/ecs/task-definitions/register?from=web%3A3');
    });
    fireEvent.click(register());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/register');
    });
    expect(router.state.location.search).toBe('?from=web%3A3');
  });

  it('no active revision → "Register new revision" unavailable with "The family has no active revision."', async () => {
    answer({ 'INACTIVE|': { items: [row(1)] } });
    open(PATH);
    expect(await screen.findByText('No active revisions')).toBeInTheDocument();
    const button = register();
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('href');
    // The reason is the button's own description, which its tooltip shows.
    expect(text(button)).toContain('The family has no active revision.');
  });

  it('no revision of either status → "No family named {family}" with a link to the list', async () => {
    answer({});
    const router = open(PATH);
    expect(await screen.findByText('No family named web')).toBeInTheDocument();
    expect(screen.getByText('The local emulator has no task definition of this family.')).toBeInTheDocument();
    const state = screen.getByText('No family named web').parentElement?.parentElement as HTMLElement;
    fireEvent.click(within(state).getByRole('link', { name: 'Task definitions' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions');
    });
  });

  it('"Inactive" shown, and a later page of "Active" shown → from the newest active revision, read by itself with maxResults 1', async () => {
    answer({
      'ACTIVE|': { items: [row(5), row(4)], nextToken: 'tok-2' },
      'ACTIVE|tok-2': { items: [row(3)] },
      'INACTIVE|': { items: [row(1)] },
    });
    open(PATH);
    await expectRows(['web:5', 'web:4']);
    expect(newestCalls()).toHaveLength(0);

    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows(['web:3']);
    await waitFor(() => {
      expect(newestCalls().at(-1)?.slice(1, 4)).toEqual(['web', 'ACTIVE', undefined]);
    });
    await waitFor(() => {
      expect(register()).toHaveAttribute('href', '/aws/ecs/task-definitions/register?from=web%3A5');
    });

    chooseStatus('INACTIVE');
    await expectRows(['web:1']);
    await waitFor(() => {
      expect(register()).toHaveAttribute('href', '/aws/ecs/task-definitions/register?from=web%3A5');
    });
    expect(newestCalls().every((call) => call[2] === 'ACTIVE')).toBe(true);
  });

  it('the Status select keeps its own width, in a horizontal row, not stretched across the container', async () => {
    answer({ 'ACTIVE|': { items: [row(1)] } });
    open(PATH);
    await expectRows(['web:1']);
    const filterRow = table().findFilterSlot()?.findSpaceBetween();
    expect(filterRow).not.toBeNull();
    expect(createWrapper(filterRow?.getElement()).findSelect()).not.toBeNull();
  });

  it('the page names "task definitions" to the frame', async () => {
    answer({ 'ACTIVE|': { items: [row(1)] } });
    open(PATH);
    expect(await screen.findByText('These task definitions are in your local emulator')).toBeInTheDocument();
  });

  it("a failed read → the area's failure state with a retry", async () => {
    vi.mocked(api.listRevisions).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'ListTaskDefinitions', code: 'InternalError', message: 'broke' }),
    );
    open(PATH);
    const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
    await waitFor(() => {
      expect(slot().textContent).toMatch(/InternalError.*broke/);
    });
    answer({ 'ACTIVE|': { items: [row(1)] } });
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await expectRows(['web:1']);
  });
});
