import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult, type PageFlash } from '../../../components/page-flash';
import AwsArea from '../../../index';
import * as api from '../api';
import { ECS_KEYS } from '../queries';
import { CreateClusterPage } from './create-cluster-page';

// S2 rendered inside the area's layout, with the calls of `api.ts` answered by the case (`api.test.ts` proves the
// calls against a fake engine). The area shows a handed-over result only on a screen's page, and the cluster's page
// (S3) is a later unit's, so the cases of a create's result render the page alone, under a flash that records what
// it is handed and leads to its address.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listClusters: vi.fn(), getCluster: vi.fn(), createCluster: vi.fn() };
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

const EMULATOR = { port: 9313, endpoint: 'https://127.0.0.1:9313' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8313';

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

function open(path = CREATE_PATH) {
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
  return { router, client };
}

/** The page alone at its address, its flash recording what it is handed. */
function openPage() {
  const handed: [string, FlashResult][] = [];
  const router = createMemoryRouter(
    [
      { path: CREATE_PATH, element: <PageAlone /> },
      { path: '/aws/ecs/clusters/cluster/:cluster', element: <p>The cluster&apos;s page</p> },
    ],
    { initialEntries: [CREATE_PATH] },
  );
  const flash: PageFlash = {
    show: () => undefined,
    handOver: (to, result) => {
      handed.push([to, result]);
      void router.navigate(to);
    },
  };
  function PageAlone() {
    return (
      <PageFlashContext value={flash}>
        <CreateClusterPage connection={connection.value} params={{}} />
      </PageFlashContext>
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client, handed };
}

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const CREATE_PATH = '/aws/ecs/clusters/create';
const RULE = '1 to 255 characters: letters, digits, hyphens and underscores.';

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field() {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === 'Cluster name');
  if (found === undefined) {
    throw new Error('no field Cluster name');
  }
  return found;
}

function input(): HTMLInputElement {
  const found = field().getElement().querySelector('input');
  if (found === null) {
    throw new Error('no input');
  }
  return found;
}

function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}

const errorText = () => text(field().findError()?.getElement());
const submitButton = () => screen.getByRole('button', { name: 'Create cluster' });

function submit() {
  fireEvent.click(submitButton());
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create cluster' })).toBeInTheDocument();
  });
}

function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

const ACTIVE: api.ClusterRead = { found: true, cluster: { name: 'dev', status: 'ACTIVE' } };

beforeEach(() => {
  vi.mocked(api.createCluster).mockResolvedValue(undefined);
  vi.mocked(api.listClusters).mockResolvedValue({ clusters: [] });
});

describe('Create cluster', () => {
  it('the form at start → the field "Cluster name" with its constraint text', async () => {
    open();
    await opened();
    expect(input().value).toBe('');
    expect(text(field().findConstraint()?.getElement())).toBe(RULE);
  });

  it('empty, "a b" and 256 characters → their messages and nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(errorText()).toBe('Enter a cluster name.');
    type('a b');
    submit();
    expect(errorText()).toBe('Use 1 to 255 letters, digits, hyphens and underscores.');
    type('a'.repeat(256));
    submit();
    expect(errorText()).toBe('Use 1 to 255 letters, digits, hyphens and underscores.');
    expect(api.getCluster).not.toHaveBeenCalled();
    expect(api.createCluster).not.toHaveBeenCalled();
  });

  it('a name the emulator describes as ACTIVE → "A cluster named {name} already exists." and no CreateCluster', async () => {
    vi.mocked(api.getCluster).mockResolvedValue(ACTIVE);
    const { router } = open();
    await opened();
    type('dev');
    submit();
    expect(await screen.findByText('A cluster named dev already exists.')).toBeInTheDocument();
    expect(errorText()).toBe('A cluster named dev already exists.');
    expect(vi.mocked(api.getCluster).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'dev']);
    expect(api.createCluster).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(CREATE_PATH);
  });

  for (const [kind, read] of [
    ['MISSING', { found: false }],
    ['INACTIVE', { found: false }],
  ] as const) {
    it(`a name the emulator answers as ${kind} → CreateCluster, then the cluster's page with "Cluster {name} created."`, async () => {
      vi.mocked(api.getCluster).mockResolvedValue(read);
      const { router, handed } = openPage();
      await opened();
      type('dev');
      submit();
      expect(await screen.findByText("The cluster's page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters/cluster/dev');
      expect(vi.mocked(api.createCluster).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'dev']);
      expect(handed).toEqual([
        ['/aws/ecs/clusters/cluster/dev', [{ type: 'success', content: 'Cluster dev created.' }]],
      ]);
    });
  }

  it("after a create is answered → that cluster's page address with the flash set, and nothing held under its read", async () => {
    vi.mocked(api.getCluster).mockResolvedValue({ found: false });
    const { router, client, handed } = openPage();
    // A not-found held from before: the cluster's page opened by its address earlier.
    client.setQueryData([...ECS_KEYS.cluster('my_cluster-1'), ENGINE, 99, 0], { found: false });
    await opened();
    type('my_cluster-1');
    submit();
    expect(await screen.findByText("The cluster's page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/aws/ecs/clusters/cluster/my_cluster-1');
    expect(handed).toEqual([
      ['/aws/ecs/clusters/cluster/my_cluster-1', [{ type: 'success', content: 'Cluster my_cluster-1 created.' }]],
    ]);
    expect(client.getQueryCache().findAll({ queryKey: ECS_KEYS.cluster('my_cluster-1') })).toEqual([]);
  });

  it('CreateCluster refused → the form stays with the code and message, the name kept', async () => {
    vi.mocked(api.getCluster).mockResolvedValue({ found: false });
    vi.mocked(api.createCluster).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'CreateCluster',
        code: 'InvalidParameterException',
        message: 'Cluster name is invalid',
      }),
    );
    const { router } = open();
    await opened();
    type('dev');
    submit();
    expect(await screen.findByText('InvalidParameterException')).toBeInTheDocument();
    expect(alertText()).toContain('Cluster name is invalid');
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(input().value).toBe('dev');
  });

  it('while the request is out → "Create cluster" is disabled and focus stays', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(api.getCluster).mockResolvedValue({ found: false });
    vi.mocked(api.createCluster).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { router } = open();
    await opened();
    type('dev');
    const button = submitButton();
    button.focus();
    submit();
    await waitFor(() => {
      expect(api.createCluster).toHaveBeenCalledTimes(1);
    });
    expect(isDisabled(submitButton())).toBe(true);
    expect(document.activeElement).toBe(submitButton());
    fireEvent.click(submitButton());
    fireEvent.submit(submitButton().closest('form') as HTMLFormElement);
    expect(api.createCluster).toHaveBeenCalledTimes(1);
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters/cluster/dev');
    });
  });

  it('"Cancel" with nothing typed → leaves to the list', async () => {
    const { router } = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" with a name typed → the discard dialog; "Keep editing" keeps the name, "Discard" leaves', async () => {
    const { router } = open();
    await opened();
    type('dev');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(input().value).toBe('dev');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters');
    });
    expect(api.createCluster).not.toHaveBeenCalled();
  });

  it('the page names "clusters" to the area\'s frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These clusters are in your local emulator')).toBeInTheDocument();
  });
});
