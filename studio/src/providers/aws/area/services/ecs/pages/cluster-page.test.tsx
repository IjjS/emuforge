import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import AwsArea from '../../../index';
import * as api from '../api';
import { useCreateCluster } from '../queries';
import * as services from '../service-api';
import * as tasks from '../task-api';

// S3 rendered inside the area's layout, with the calls of `api.ts`, `service-api.ts` and `task-api.ts` answered by
// the case (their own tests prove the calls, `api.test.ts` among them that an `INACTIVE` cluster is read as not
// found). "Create cluster" (S2) and "Run task" (S6) are other units' screens: here a stand-in at each route hands its
// result over to S3 as that screen does, through the area's flash, "Create cluster" by s1's own hook.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getCluster: vi.fn(), listClusters: vi.fn(), createCluster: vi.fn(), deleteCluster: vi.fn() };
});
vi.mock('../task-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../task-api')>();
  return { ...real, listTasks: vi.fn() };
});
vi.mock('../service-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../service-api')>();
  return { ...real, listServices: vi.fn() };
});

function CreateStandIn() {
  const flash = usePageFlash();
  const create = useCreateCluster('http://127.0.0.1:8315');
  return (
    <button
      type="button"
      onClick={() => {
        void create('dev', new AbortController().signal).then(() => {
          flash.handOver('/aws/ecs/clusters/cluster/dev', [{ type: 'success', content: 'Cluster dev created.' }]);
        });
      }}
    >
      Create
    </button>
  );
}

vi.mock('../pages/create-cluster-page', () => ({ CreateClusterPage: CreateStandIn }));

function RunStandIn() {
  const flash = usePageFlash();
  const client = useQueryClient();
  return (
    <button
      type="button"
      onClick={() => {
        void client.invalidateQueries({ queryKey: ['aws', 'ecs', 'cluster-tasks', 'dev'] });
        void client.invalidateQueries({ queryKey: ['aws', 'ecs', 'cluster', 'dev'] });
        flash.handOver('/aws/ecs/clusters/cluster/dev', [{ type: 'success', content: '3 tasks started.' }]);
      }}
    >
      Run
    </button>
  );
}

vi.mock('../run-screens', async () => {
  const format = await import('../format');
  return {
    RUN_SCREENS: [
      {
        paths: [format.RUN_TASK_PATTERN],
        title: 'Run task',
        crumbs: [{ text: 'Run task' }],
        navigation: format.CLUSTERS_NAVIGATION,
        Page: RunStandIn,
      },
    ],
  };
});

// TanStack Query hands its notifications to React on a 0 ms timer; here it notifies in a microtask.
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

const EMULATOR = { port: 9315, endpoint: 'https://127.0.0.1:9315' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8315';

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

const PATH = '/aws/ecs/clusters/cluster/dev';

function open(path = PATH) {
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

// ---------------------------------------------------------------------------------------------------------------
// A cluster, its services and tasks, and readers.

const CLUSTER_ARN = 'arn:aws:ecs:us-east-1:000000000000:cluster/dev';

function cluster(changes: Partial<api.Cluster> = {}): api.ClusterRead {
  return {
    found: true,
    cluster: {
      name: 'dev',
      arn: CLUSTER_ARN,
      status: 'ACTIVE',
      activeServices: 1,
      runningTasks: 1,
      pendingTasks: 0,
      ...changes,
    },
  };
}

function service(changes: Partial<services.Service> = {}): services.Service {
  return {
    name: 'api',
    arn: 'arn:aws:ecs:us-east-1:000000000000:service/dev/api',
    status: 'ACTIVE',
    desired: 1,
    running: 1,
    pending: 0,
    definition: { family: 'web', revision: 3 },
    launchType: 'FARGATE',
    deployments: [],
    events: [],
    ...changes,
  };
}

function task(id: string, changes: Partial<tasks.Task> = {}): tasks.Task {
  return {
    id,
    arn: `arn:aws:ecs:us-east-1:000000000000:task/dev/${id}`,
    lastStatus: 'STOPPED',
    containers: [],
    ...changes,
  };
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function pairs(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const group of PAGE.findAllKeyValuePairs()) {
    for (const item of group.findItems()) {
      result[text(item.findLabel()?.getElement())] = text(item.findValue()?.getElement());
    }
  }
  return result;
}

/** The summary, once the cluster is shown. */
const details = () => screen.findByRole('heading', { name: 'Cluster details' });

/** A promise the case answers itself. */
function held<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
  vi.mocked(api.getCluster).mockImplementation(() => Promise.resolve(cluster()));
  vi.mocked(api.listClusters).mockResolvedValue({ clusters: [] });
  vi.mocked(api.createCluster).mockResolvedValue(undefined);
  vi.mocked(services.listServices).mockImplementation(() => Promise.resolve({ services: [service()] }));
  vi.mocked(tasks.listTasks).mockImplementation(() => Promise.resolve({ tasks: [] }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function deleteFromThePage() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete cluster' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'dev' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  return dialog;
}

const flashTexts = () => (PAGE.findFlashbar()?.findItems() ?? []).map((item) => text(item.getElement()));

describe('S3, a cluster', () => {
  it('a cluster → h1 its name, the summary with the ARN copied, "Services" and "Tasks", and the actions', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'dev' })).toBeInTheDocument();
    await details();
    expect(pairs()['ARN']).toContain(CLUSTER_ARN);
    expect(pairs()).toMatchObject({
      Status: 'Active',
      'Active services': '1',
      'Running tasks': '1',
      'Pending tasks': '0',
    });
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /^Services/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Tasks/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete cluster' })).toBeInTheDocument();
    const runs = screen.getAllByRole('link', { name: 'Run task' });
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run).toHaveAttribute('href', '/aws/ecs/clusters/cluster/dev/tasks/run');
    }
  });

  it('while its tasks table is followed → the summary is read again with it and shows the new counts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(tasks.listTasks).mockImplementation(() =>
      Promise.resolve({ tasks: [task('abc', { lastStatus: 'PROVISIONING' })] }),
    );
    vi.mocked(api.getCluster)
      .mockImplementationOnce(() => Promise.resolve(cluster({ runningTasks: 0, pendingTasks: 1 })))
      .mockImplementation(() => Promise.resolve(cluster({ runningTasks: 1, pendingTasks: 0 })));
    open();
    await details();
    await screen.findByRole('link', { name: 'abc' });
    expect(pairs()['Pending tasks']).toBe('1');
    expect(api.getCluster).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => {
      expect(pairs()['Running tasks']).toBe('1');
    });
    expect(pairs()['Pending tasks']).toBe('0');
    expect(vi.mocked(api.getCluster).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('while its services table is followed → the summary is read again with it and shows the new counts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(services.listServices).mockImplementation(() =>
      Promise.resolve({ services: [service({ desired: 2, running: 1 })] }),
    );
    vi.mocked(api.getCluster)
      .mockImplementationOnce(() => Promise.resolve(cluster({ runningTasks: 1 })))
      .mockImplementation(() => Promise.resolve(cluster({ runningTasks: 2 })));
    open();
    await details();
    await screen.findByRole('link', { name: 'api' });
    expect(pairs()['Running tasks']).toBe('1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => {
      expect(pairs()['Running tasks']).toBe('2');
    });
    expect(vi.mocked(services.listServices).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('"Delete cluster" confirmed and answered → the list page with the flash "Cluster dev deleted."', async () => {
    vi.mocked(api.deleteCluster).mockResolvedValue(undefined);
    const { router } = open();
    await details();
    await deleteFromThePage();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/clusters');
    });
    expect(await screen.findByText('Cluster dev deleted.')).toBeInTheDocument();
    expect(vi.mocked(api.deleteCluster).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'dev']);
  });

  for (const order of ['the read first', 'the delete first'] as const) {
    it(`(order) after the delete, ${order} → the list page with the flash, no not-found state hiding it`, async () => {
      const removal = held<undefined>();
      vi.mocked(api.deleteCluster).mockReturnValue(removal.promise);
      const { router, client } = open();
      await details();
      await deleteFromThePage();
      await waitFor(() => {
        expect(api.deleteCluster).toHaveBeenCalledTimes(1);
      });
      vi.mocked(api.getCluster).mockImplementation(() => Promise.resolve({ found: false }));
      if (order === 'the read first') {
        await act(async () => {
          await client.invalidateQueries({ queryKey: ['aws', 'ecs', 'cluster', 'dev'] });
        });
        await act(async () => {
          removal.resolve(undefined);
          await removal.promise;
        });
      } else {
        await act(async () => {
          removal.resolve(undefined);
          await removal.promise;
        });
      }
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/ecs/clusters');
      });
      expect(await screen.findByText('Cluster dev deleted.')).toBeInTheDocument();
      expect(screen.getAllByText('Cluster dev deleted.')).toHaveLength(1);
      expect(screen.queryByText(/^No cluster named/)).not.toBeInTheDocument();
    });
  }

  for (const order of ['the old MISSING first', 'the new ACTIVE first'] as const) {
    it(`(order) opened as a create leaves it, ${order} → the flash once, never "No cluster named dev"`, async () => {
      vi.mocked(api.getCluster).mockResolvedValueOnce({ found: false });
      const { router } = open();
      expect(await screen.findByText('No cluster named dev')).toBeInTheDocument();
      // A read of the cluster still out when the page is left.
      const old = held<api.ClusterRead>();
      vi.mocked(api.getCluster).mockReturnValueOnce(old.promise);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => {
        expect(api.getCluster).toHaveBeenCalledTimes(2);
      });
      await act(async () => {
        await router.navigate('/aws/ecs/clusters/create');
      });
      // The create's own check of the name, then the new page's read.
      const fresh = held<api.ClusterRead>();
      vi.mocked(api.getCluster).mockResolvedValueOnce({ found: false }).mockReturnValueOnce(fresh.promise);
      fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(PATH);
      });
      await waitFor(() => {
        expect(api.getCluster).toHaveBeenCalledTimes(4);
      });
      const answers = [
        () => {
          old.resolve({ found: false });
          return old.promise;
        },
        () => {
          fresh.resolve(cluster());
          return fresh.promise;
        },
      ];
      if (order === 'the new ACTIVE first') answers.reverse();
      for (const answer of answers) {
        await act(async () => {
          await answer();
        });
        expect(screen.queryByText(/^No cluster named/)).not.toBeInTheDocument();
      }
      await details();
      expect(screen.getAllByText('Cluster dev created.')).toHaveLength(1);
      expect(screen.queryByText(/^No cluster named/)).not.toBeInTheDocument();
    });
  }

  for (const order of ['the cluster first', 'the tasks first'] as const) {
    it(`(order) opened as a run of three tasks leaves it, ${order} → the flash once, no not-found state`, async () => {
      const { client } = open('/aws/ecs/clusters/cluster/dev/tasks/run');
      const first = held<tasks.TaskPage>();
      vi.mocked(tasks.listTasks).mockReturnValueOnce(first.promise);
      fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
      await details();
      await waitFor(() => {
        expect(tasks.listTasks).toHaveBeenCalledTimes(1);
      });
      const again = held<api.ClusterRead>();
      vi.mocked(api.getCluster).mockReturnValueOnce(again.promise);
      await act(async () => {
        void client.invalidateQueries({ queryKey: ['aws', 'ecs', 'cluster', 'dev'] });
        await Promise.resolve();
      });
      const answers = [
        () => {
          again.resolve(cluster({ runningTasks: 3 }));
          return again.promise;
        },
        () => {
          first.resolve({ tasks: [task('a'), task('b'), task('c')] });
          return first.promise;
        },
      ];
      if (order === 'the tasks first') answers.reverse();
      for (const answer of answers) {
        await act(async () => {
          await answer();
        });
      }
      await screen.findByRole('link', { name: 'c' });
      await waitFor(() => {
        expect(pairs()['Running tasks']).toBe('3');
      });
      expect(screen.getAllByText('3 tasks started.')).toHaveLength(1);
      expect(screen.queryByText(/^No cluster named/)).not.toBeInTheDocument();
    });
  }

  it('"Refresh" → the cluster, its services and its tasks are read again', async () => {
    open();
    await details();
    await screen.findByRole('link', { name: 'api' });
    await screen.findByText('No running tasks');
    const counts = () => [
      vi.mocked(api.getCluster).mock.calls.length,
      vi.mocked(services.listServices).mock.calls.length,
      vi.mocked(tasks.listTasks).mock.calls.length,
    ];
    expect(counts()).toEqual([1, 1, 1]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(counts()).toEqual([2, 2, 2]);
    });
  });

  it('a refused delete → the dialog stays with the refusal, the page behind it unchanged', async () => {
    vi.mocked(api.deleteCluster).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteCluster',
        code: 'ClusterContainsServicesException',
        message: 'The Cluster cannot be deleted while Services are active.',
      }),
    );
    const { router } = open();
    await details();
    await screen.findByRole('link', { name: 'api' });
    const before = pairs();
    const reads = vi.mocked(api.getCluster).mock.calls.length;
    const dialog = await deleteFromThePage();
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('The emulator did not delete the cluster.');
    expect(text(alert)).toContain('ClusterContainsServicesException');
    expect(text(alert)).toContain('The Cluster cannot be deleted while Services are active.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATH);
    expect(pairs()).toEqual(before);
    expect(vi.mocked(api.getCluster).mock.calls.length).toBe(reads);
    expect(flashTexts()).toEqual([]);
  });

  // `getCluster` answers both a failure `MISSING` and an `INACTIVE` cluster as not found (`api.test.ts`).
  for (const answer of ['MISSING', 'INACTIVE'] as const) {
    it(`the cluster ${answer} → "No cluster named dev", its sentence and the link "Clusters"; neither table is read`, async () => {
      vi.mocked(api.getCluster).mockResolvedValue({ found: false });
      open();
      expect(await screen.findByText('No cluster named dev')).toBeInTheDocument();
      expect(screen.getByText('The local emulator has no active cluster of this name.')).toBeInTheDocument();
      const links = screen.getAllByRole('link', { name: 'Clusters' });
      expect(links.some((link) => link.getAttribute('href') === '/aws/ecs/clusters')).toBe(true);
      expect(services.listServices).not.toHaveBeenCalled();
      expect(tasks.listTasks).not.toHaveBeenCalled();
    });
  }

  it('the page names "services and tasks" to the frame', async () => {
    open();
    await details();
    expect(screen.getByText('These services and tasks are in your local emulator')).toBeInTheDocument();
  });
});
