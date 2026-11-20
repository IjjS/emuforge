import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import * as choices from '../definition-choices';
import * as services from '../service-api';
import * as changes from '../service-change-api';
import * as tasks from '../task-api';

// S4 rendered inside the area's layout, with the calls of `api.ts`, `service-api.ts`, `task-api.ts` and
// `service-change-api.ts` answered by the case (their own tests prove the calls). The cluster's page (S3), which a
// delete leads to, is the real one over the same answered calls.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getCluster: vi.fn(), listClusters: vi.fn() };
});
vi.mock('../task-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../task-api')>();
  return { ...real, listTasks: vi.fn() };
});
vi.mock('../service-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../service-api')>();
  return { ...real, listServices: vi.fn(), getService: vi.fn() };
});
vi.mock('../service-change-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../service-change-api')>();
  return { ...real, updateService: vi.fn(), deleteService: vi.fn() };
});
vi.mock('../definition-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../definition-choices')>();
  return { ...real, listRevisionChoices: vi.fn(), revisionChoices: vi.fn(real.revisionChoices) };
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

const EMULATOR = { port: 9328, endpoint: 'https://127.0.0.1:9328' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8328';

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let routeChanges = seen.changes;
  if (seen.pathname !== pathname) {
    routeChanges += 1;
    setSeen({ pathname, changes: routeChanges });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={routeChanges}
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

const PATH = '/aws/ecs/clusters/cluster/dev/services/service/api';
const CLUSTER_PATH = '/aws/ecs/clusters/cluster/dev';

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
// A cluster, a service and its tasks, and readers.

const SERVICE_ARN = 'arn:aws:ecs:us-east-1:000000000000:service/dev/api';
const CLUSTER: api.ClusterRead = { found: true, cluster: { name: 'dev', status: 'ACTIVE' } };

function service(changes: Partial<services.Service> = {}): services.Service {
  return {
    name: 'api',
    arn: SERVICE_ARN,
    status: 'ACTIVE',
    desired: 1,
    running: 1,
    pending: 0,
    definitionArn: 'arn:aws:ecs:us-east-1:000000000000:task-definition/web:3',
    definition: { family: 'web', revision: 3 },
    launchType: 'FARGATE',
    createdAt: new Date('2026-11-20T10:00:00Z'),
    network: { subnets: ['subnet-a', 'subnet-b'], securityGroups: ['sg-1'], assignPublicIp: 'ENABLED' },
    deployments: [
      {
        id: 'ecs-svc/111',
        status: 'PRIMARY',
        rolloutState: 'COMPLETED',
        definition: { family: 'web', revision: 3 },
        desired: 1,
        running: 1,
        pending: 0,
        failed: 0,
      },
    ],
    events: [
      { id: 'e2', createdAt: new Date('2026-11-20T10:05:00Z'), message: 'has reached a steady state.' },
      { id: 'e1', createdAt: new Date('2026-11-20T10:01:00Z'), message: 'has started 1 tasks.' },
    ],
    ...changes,
  };
}

const found = (read: services.Service): services.ServiceRead => ({ found: true, service: read });

function task(id: string, changes: Partial<tasks.Task> = {}): tasks.Task {
  return {
    id,
    arn: `arn:aws:ecs:us-east-1:000000000000:task/dev/${id}`,
    lastStatus: 'RUNNING',
    group: 'service:api',
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

/** The table under the heading `name`. */
function table(name: RegExp) {
  const found = PAGE.findAllTables().find((each) => name.test(text(each.findHeaderSlot()?.getElement())));
  if (found === undefined) {
    throw new Error(`no table ${String(name)}`);
  }
  return found;
}

const headers = (name: RegExp) =>
  table(name)
    .findColumnHeaders()
    .map((header) => text(header.getElement()));
const rows = (name: RegExp) =>
  table(name)
    .findRows()
    .map((row) => text(row.getElement()));

/** The summary, once the service is shown. */
const details = () => screen.findByRole('heading', { name: 'Service details' });

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** A promise the case answers itself. */
function held<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flashTexts = () => (PAGE.findFlashbar()?.findItems() ?? []).map((item) => text(item.getElement()));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
  vi.mocked(api.getCluster).mockImplementation(() => Promise.resolve(CLUSTER));
  vi.mocked(api.listClusters).mockResolvedValue({ clusters: [] });
  vi.mocked(services.getService).mockImplementation(() => Promise.resolve(found(service())));
  vi.mocked(services.listServices).mockImplementation(() => Promise.resolve({ services: [] }));
  vi.mocked(tasks.listTasks).mockImplementation(() => Promise.resolve({ tasks: [] }));
  vi.mocked(choices.listRevisionChoices).mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function updateFromThePage() {
  fireEvent.click(screen.getByRole('button', { name: 'Update service' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
  return dialog;
}

async function deleteFromThePage() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete service' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'api' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  return dialog;
}

describe('S4, a service', () => {
  it('a service → h1 its name, the summary of R4, the deployments table, the events newest first, its tasks table without "Group"', async () => {
    // `getService` gives the events newest first (`service-api.test.ts`); the page keeps that order.
    vi.mocked(tasks.listTasks).mockResolvedValue({ tasks: [task('abc')] });
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'api' })).toBeInTheDocument();
    await details();
    const summary = pairs();
    expect(summary['ARN']).toContain(SERVICE_ARN);
    expect(summary).toMatchObject({
      Status: 'Active',
      'Desired tasks': '1',
      'Running tasks': '1',
      'Pending tasks': '0',
      'Task definition': 'web:3',
      'Launch type': 'FARGATE',
      Subnets: 'subnet-a, subnet-b',
      'Security groups': 'sg-1',
      'Public IP': 'Enabled',
    });
    expect(summary['Created at']).not.toBe('-');
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    const definition = screen.getAllByRole('link', { name: 'web:3' });
    expect(definition[0]).toHaveAttribute('href', '/aws/ecs/task-definitions/family/web/revision/3');
    expect(headers(/^Deployments/)).toEqual([
      'ID',
      'Status',
      'Rollout',
      'Task definition',
      'Desired',
      'Running',
      'Pending',
      'Failed tasks',
      'Updated at',
    ]);
    expect(rows(/^Deployments/)[0]).toContain('ecs-svc/111');
    expect(rows(/^Deployments/)[0]).toContain('Completed');
    expect(headers(/^Events/)).toEqual(['Time', 'Message']);
    const events = rows(/^Events/);
    expect(events).toHaveLength(2);
    expect(events[0]).toContain('has reached a steady state.');
    expect(events[1]).toContain('has started 1 tasks.');
    await screen.findByRole('link', { name: 'abc' });
    expect(headers(/^Tasks/)).not.toContain('Group');
    expect(vi.mocked(tasks.listTasks).mock.calls[0]?.[2]).toMatchObject({ desiredStatus: 'RUNNING', service: 'api' });
    expect(vi.mocked(services.getService).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'dev', 'api']);
  });

  it("the Deployments \"ID\" column holds a deployment's id on one line → its minWidth is the id's width plus the cell's padding", async () => {
    open();
    await details();
    const id = table(/^Deployments/)
      .findColumnHeaders()
      .find((header) => text(header.getElement()) === 'ID');
    expect(id?.getElement().style.minWidth).toBe('calc(26ch + 24px)');
  });

  it('no event → "No events yet"', async () => {
    vi.mocked(services.getService).mockImplementation(() => Promise.resolve(found(service({ events: [] }))));
    open();
    await details();
    expect(screen.getByText('No events yet')).toBeInTheDocument();
  });

  it('while its tasks table is followed → the service is read again with it, and the summary shows the new counts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(tasks.listTasks).mockImplementation(() => Promise.resolve({ tasks: [task('abc')] }));
    // The service itself is steady, so only the table's following reads it again.
    vi.mocked(services.getService)
      .mockImplementationOnce(() => Promise.resolve(found(service({ desired: 1, running: 1 }))))
      .mockImplementation(() => Promise.resolve(found(service({ desired: 2, running: 2 }))));
    open();
    await details();
    await screen.findByRole('link', { name: 'abc' });
    expect(pairs()['Running tasks']).toBe('1');
    expect(services.getService).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => {
      expect(pairs()['Running tasks']).toBe('2');
    });
    expect(pairs()['Desired tasks']).toBe('2');
    expect(vi.mocked(services.getService).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  for (const status of ['DRAINING', 'INACTIVE'] as const) {
    it(`status ${status} → shown with that status, "Update service" and "Delete service" unavailable with "The service is not active."`, async () => {
      vi.mocked(services.getService).mockImplementation(() => Promise.resolve(found(service({ status }))));
      open();
      await details();
      expect(pairs()['Status']).toBe(status === 'DRAINING' ? 'Draining' : 'Inactive');
      for (const name of ['Update service', 'Delete service']) {
        const button = screen.getByRole('button', { name });
        expect(isDisabled(button)).toBe(true);
        fireEvent.focus(button);
        expect((await screen.findAllByText('The service is not active.')).length).toBeGreaterThan(0);
        fireEvent.click(button);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }
    });
  }

  it('"Update" answered → the flash "Service api updated." and the service is read again', async () => {
    vi.mocked(changes.updateService).mockResolvedValue(undefined);
    open();
    await details();
    const reads = vi.mocked(services.getService).mock.calls.length;
    await updateFromThePage();
    expect(await screen.findByText('Service api updated.')).toBeInTheDocument();
    await waitFor(() => {
      expect(vi.mocked(services.getService).mock.calls.length).toBeGreaterThan(reads);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(changes.updateService).mock.calls[0]?.slice(0, 4)).toEqual([
      ENGINE,
      'dev',
      'api',
      { desiredCount: 1 },
    ]);
  });

  for (const order of ['the service first', 'the tasks first'] as const) {
    it(`(order) after an update, ${order} → the flash "Service api updated." is shown once`, async () => {
      vi.mocked(changes.updateService).mockResolvedValue(undefined);
      vi.mocked(tasks.listTasks).mockImplementation(() => Promise.resolve({ tasks: [task('abc')] }));
      open();
      await details();
      await screen.findByRole('link', { name: 'abc' });
      const serviceRead = held<services.ServiceRead>();
      const tasksRead = held<tasks.TaskPage>();
      // A later read of the service, as the table's read in place asks for, answers the updated service too.
      vi.mocked(services.getService)
        .mockImplementation(() => Promise.resolve(found(service({ desired: 2, running: 1 }))))
        .mockReturnValueOnce(serviceRead.promise);
      vi.mocked(tasks.listTasks).mockReturnValueOnce(tasksRead.promise);
      const serviceCalls = vi.mocked(services.getService).mock.calls.length;
      const taskCalls = vi.mocked(tasks.listTasks).mock.calls.length;
      await updateFromThePage();
      await waitFor(() => {
        expect(vi.mocked(services.getService).mock.calls.length).toBe(serviceCalls + 1);
      });
      await waitFor(() => {
        expect(vi.mocked(tasks.listTasks).mock.calls.length).toBe(taskCalls + 1);
      });
      const answers = [
        () => {
          serviceRead.resolve(found(service({ desired: 2, running: 1 })));
          return serviceRead.promise;
        },
        () => {
          tasksRead.resolve({ tasks: [task('abc'), task('def')] });
          return tasksRead.promise;
        },
      ];
      if (order === 'the tasks first') answers.reverse();
      for (const answer of answers) {
        await act(async () => {
          await answer();
        });
      }
      await screen.findByRole('link', { name: 'def' });
      await waitFor(() => {
        expect(pairs()['Desired tasks']).toBe('2');
      });
      expect(screen.getAllByText('Service api updated.')).toHaveLength(1);
      expect(flashTexts()).toEqual(['Service api updated.']);
    });
  }

  it('"Refresh" → the service, its cluster and its tasks are read again', async () => {
    open();
    await details();
    await screen.findByText('No running tasks');
    const counts = () => [
      vi.mocked(api.getCluster).mock.calls.length,
      vi.mocked(services.getService).mock.calls.length,
      vi.mocked(tasks.listTasks).mock.calls.length,
    ];
    expect(counts()).toEqual([1, 1, 1]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(counts()).toEqual([2, 2, 2]);
    });
  });

  it('"Delete service" answered → the cluster\'s page with the flash "Service api deleted."', async () => {
    vi.mocked(changes.deleteService).mockResolvedValue(undefined);
    const { router } = open();
    await details();
    await deleteFromThePage();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
    expect(await screen.findByText('Service api deleted.')).toBeInTheDocument();
    expect(vi.mocked(changes.deleteService).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'dev', 'api']);
  });

  it("(order) after that delete, the service's own read answers DRAINING before the delete's answer → the cluster's page still opens with the flash", async () => {
    const removal = held<undefined>();
    vi.mocked(changes.deleteService).mockReturnValue(removal.promise);
    const { router, client } = open();
    await details();
    await deleteFromThePage();
    await waitFor(() => {
      expect(changes.deleteService).toHaveBeenCalledTimes(1);
    });
    vi.mocked(services.getService).mockImplementation(() => Promise.resolve(found(service({ status: 'DRAINING' }))));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['aws', 'ecs', 'cluster-services', 'dev'] });
    });
    await waitFor(() => {
      expect(pairs()['Status']).toBe('Draining');
    });
    await act(async () => {
      removal.resolve(undefined);
      await removal.promise;
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
    expect(await screen.findByText('Service api deleted.')).toBeInTheDocument();
    expect(screen.getAllByText('Service api deleted.')).toHaveLength(1);
  });

  it('a refused delete → the flash "The emulator did not delete service api." with the code and message', async () => {
    vi.mocked(changes.deleteService).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteService',
        code: 'ServiceNotFoundException',
        message: 'Service not found.',
      }),
    );
    const { router } = open();
    await details();
    await deleteFromThePage();
    expect(await screen.findByText('The emulator did not delete service api.')).toBeInTheDocument();
    const [item] = flashTexts();
    expect(item).toContain('ServiceNotFoundException');
    expect(item).toContain('Service not found.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATH);
  });

  it('the service MISSING → "No service named api" with a link to the cluster\'s page; the cluster not found → the cluster\'s not-found state', async () => {
    vi.mocked(services.getService).mockImplementation(() => Promise.resolve({ found: false }));
    open();
    expect(await screen.findByText('No service named api')).toBeInTheDocument();
    expect(screen.getByText('Cluster dev of the local emulator has no service of this name.')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'dev' });
    expect(links.some((link) => link.getAttribute('href') === CLUSTER_PATH)).toBe(true);
    cleanup();

    vi.mocked(services.getService).mockClear();
    vi.mocked(tasks.listTasks).mockClear();
    vi.mocked(api.getCluster).mockImplementation(() => Promise.resolve({ found: false }));
    open();
    expect(await screen.findByText('No cluster named dev')).toBeInTheDocument();
    expect(screen.getByText('The local emulator has no active cluster of this name.')).toBeInTheDocument();
    const clusters = screen.getAllByRole('link', { name: 'Clusters' });
    expect(clusters.some((link) => link.getAttribute('href') === '/aws/ecs/clusters')).toBe(true);
    expect(services.getService).not.toHaveBeenCalled();
    expect(tasks.listTasks).not.toHaveBeenCalled();
  });

  it('the page names "services and tasks" to the frame', async () => {
    open();
    await details();
    expect(screen.getByText('These services and tasks are in your local emulator')).toBeInTheDocument();
  });
});
