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
import * as logs from '../logs-api';
import * as tasks from '../task-api';

// S5 rendered inside the area's layout, with the calls of `api.ts`, `task-api.ts` and `logs-api.ts` answered by the
// case (their own tests prove the calls). "Run task" (S6) is another unit's: here a stand-in at its route hands its
// result over to S5 as S6 does, through the area's flash.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getCluster: vi.fn() };
});
vi.mock('../task-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../task-api')>();
  return { ...real, getTask: vi.fn(), stopTask: vi.fn(), listTasks: vi.fn() };
});
vi.mock('../logs-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../logs-api')>();
  return { ...real, getContainerLogs: vi.fn(), getLogLines: vi.fn() };
});

function RunStandIn() {
  const flash = usePageFlash();
  const client = useQueryClient();
  return (
    <button
      type="button"
      onClick={() => {
        void client.invalidateQueries({ queryKey: ['aws', 'ecs', 'cluster', 'dev'] });
        flash.handOver('/aws/ecs/clusters/cluster/dev/tasks/task/abc', [
          { type: 'success', content: 'Task abc started.' },
        ]);
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

const EMULATOR = { port: 9314, endpoint: 'https://127.0.0.1:9314' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8314';

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

const PATH = '/aws/ecs/clusters/cluster/dev/tasks/task/abc';

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
// A cluster, a task and readers.

const CLUSTER: api.Cluster = {
  name: 'dev',
  arn: 'arn:aws:ecs:us-east-1:000000000000:cluster/dev',
  status: 'ACTIVE',
  activeServices: 0,
  runningTasks: 1,
  pendingTasks: 0,
};

const TASK_ARN = 'arn:aws:ecs:us-east-1:000000000000:task/dev/abc';

function task(changes: Partial<tasks.Task> = {}): tasks.Task {
  return {
    id: 'abc',
    arn: TASK_ARN,
    lastStatus: 'RUNNING',
    desiredStatus: 'RUNNING',
    definitionArn: 'arn:aws:ecs:us-east-1:000000000000:task-definition/web:3',
    definition: { family: 'web', revision: 3 },
    group: 'family:web',
    launchType: 'FARGATE',
    startedBy: 'emuforge',
    cpu: '256',
    memory: '512',
    privateIp: '10.0.0.7',
    subnet: 'subnet-1',
    networkInterface: 'eni-1',
    containers: [
      { name: 'app', image: 'busybox:1', status: 'RUNNING' },
      { name: 'side', image: 'busybox:1', status: 'STOPPED', exitCode: 0, reason: 'done' },
    ],
    ...changes,
  };
}

const found = (value: tasks.Task): tasks.TaskRead => ({ found: true, task: value });

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

/** The summary, once the task is shown. */
const details = () => screen.findByRole('heading', { name: 'Task details' });

function action(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
  vi.mocked(api.getCluster).mockResolvedValue({ found: true, cluster: CLUSTER });
  vi.mocked(tasks.getTask).mockImplementation(() => Promise.resolve(found(task({ lastStatus: 'STOPPED' }))));
  vi.mocked(logs.getContainerLogs).mockResolvedValue([
    { container: 'app', log: { group: '/ecs/web', stream: 'web/app/abc' } },
    { container: 'side' },
  ]);
  vi.mocked(logs.getLogLines).mockResolvedValue({ lines: [{ message: 'hello' }], nextToken: 'f/1' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function stopFromThePage() {
  fireEvent.click(action('Stop task'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Stop task' }));
}

describe('S5, a task', () => {
  it('a running task → h1 "Task abc", the summary of R4 with the ARN copied, the containers table, a log part per container', async () => {
    vi.mocked(tasks.getTask).mockImplementation(() => Promise.resolve(found(task())));
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Task abc' })).toBeInTheDocument();
    await details();
    expect(pairs()['ARN']).toContain(TASK_ARN);
    expect(pairs()).toMatchObject({
      'Last status': 'Running',
      'Desired status': 'Running',
      'Task definition': 'web:3',
      Group: 'family:web',
      'Launch type': 'FARGATE',
      'Started by': 'emuforge',
      CPU: '256',
      Memory: '512',
      'Created at': '-',
      'Started at': '-',
      'Stopped at': '-',
      'Stop code': '-',
      'Stopped reason': '-',
      'Private IP': '10.0.0.7',
      Subnet: 'subnet-1',
      'Network interface': 'eni-1',
    });
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'web:3' })).toHaveAttribute(
      'href',
      '/aws/ecs/task-definitions/family/web/revision/3',
    );
    expect(screen.getByRole('heading', { name: 'Containers' })).toBeInTheDocument();
    const rows = PAGE.findAllTables()
      .flatMap((table) => table.findRows())
      .map((row) => text(row.getElement()));
    expect(rows).toEqual([
      expect.stringContaining('app'),
      expect.stringMatching(/side.*STOPPED|side.*Stopped.*0.*done/),
    ]);
    expect(await screen.findByRole('heading', { name: 'Log of app' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log of side' })).toBeInTheDocument();
  });

  it('a task of a service → "Group" is a link to the service\'s page', async () => {
    vi.mocked(tasks.getTask).mockImplementation(() =>
      Promise.resolve(found(task({ group: 'service:api', lastStatus: 'STOPPED' }))),
    );
    open();
    const link = await screen.findByRole('link', { name: 'service:api' });
    expect(link).toHaveAttribute('href', '/aws/ecs/clusters/cluster/dev/services/service/api');
  });

  it('desired status STOPPED → "Stop task" unavailable with "The task is already stopped or stopping."', async () => {
    vi.mocked(tasks.getTask).mockImplementation(() =>
      Promise.resolve(found(task({ desiredStatus: 'STOPPED', lastStatus: 'DEACTIVATING' }))),
    );
    open();
    await details();
    const button = action('Stop task');
    expect(isDisabled(button)).toBe(true);
    fireEvent.focus(button);
    expect((await screen.findAllByText('The task is already stopped or stopping.')).length).toBeGreaterThan(0);
  });

  it('"Stop task" confirmed and answered → the flash "Stopping task abc." and the task is read again', async () => {
    vi.mocked(tasks.getTask).mockImplementation(() => Promise.resolve(found(task({ lastStatus: 'STOPPED' }))));
    vi.mocked(tasks.stopTask).mockResolvedValue(undefined);
    open();
    await details();
    const before = vi.mocked(tasks.getTask).mock.calls.length;
    await stopFromThePage();
    expect(await screen.findByText('Stopping task abc.')).toBeInTheDocument();
    await waitFor(() => {
      expect(vi.mocked(tasks.getTask).mock.calls.length).toBeGreaterThan(before);
    });
    expect(vi.mocked(tasks.stopTask).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'dev', 'abc']);
  });

  for (const order of ['the read first', 'the stop first'] as const) {
    it(`(order) after a stop, ${order} → the flash "Stopping task abc." is shown once`, async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let status = 'RUNNING';
      vi.mocked(tasks.getTask).mockImplementation(() =>
        Promise.resolve(
          found(task({ lastStatus: status, desiredStatus: status === 'RUNNING' ? 'RUNNING' : 'STOPPED' })),
        ),
      );
      const stop = held<undefined>();
      vi.mocked(tasks.stopTask).mockReturnValue(stop.promise);
      open();
      await details();
      await stopFromThePage();
      await waitFor(() => {
        expect(tasks.stopTask).toHaveBeenCalledTimes(1);
      });
      status = 'STOPPED';
      if (order === 'the read first') {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_100);
        });
        await waitFor(() => {
          expect(pairs()['Last status']).toBe('Stopped');
        });
        await act(async () => {
          stop.resolve(undefined);
          await stop.promise;
        });
      } else {
        await act(async () => {
          stop.resolve(undefined);
          await stop.promise;
        });
        await waitFor(() => {
          expect(pairs()['Last status']).toBe('Stopped');
        });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });
      expect(screen.getAllByText('Stopping task abc.')).toHaveLength(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  }

  for (const order of ['the cluster first', 'the task first'] as const) {
    it(`(order) opened as a run of one task leaves it, ${order} → the flash once, and no not-found state`, async () => {
      const { client } = open('/aws/ecs/clusters/cluster/dev/tasks/run');
      fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
      const first = held<tasks.TaskRead>();
      vi.mocked(tasks.getTask).mockReturnValueOnce(first.promise);
      await screen.findByRole('heading', { level: 1, name: 'Task abc' });
      await waitFor(() => {
        expect(tasks.getTask).toHaveBeenCalledTimes(1);
      });
      const again = held<api.ClusterRead>();
      vi.mocked(api.getCluster).mockReturnValueOnce(again.promise);
      await act(async () => {
        void client.invalidateQueries({ queryKey: ['aws', 'ecs', 'cluster', 'dev'] });
        await Promise.resolve();
      });
      if (order === 'the cluster first') {
        await act(async () => {
          again.resolve({ found: true, cluster: CLUSTER });
          await again.promise;
        });
        await act(async () => {
          first.resolve(found(task({ lastStatus: 'STOPPED' })));
          await first.promise;
        });
      } else {
        await act(async () => {
          first.resolve(found(task({ lastStatus: 'STOPPED' })));
          await first.promise;
        });
        await act(async () => {
          again.resolve({ found: true, cluster: CLUSTER });
          await again.promise;
        });
      }
      await details();
      expect(screen.getAllByText('Task abc started.')).toHaveLength(1);
      expect(screen.queryByText(/^No cluster named/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^No task/)).not.toBeInTheDocument();
    });
  }

  it('a followed read that answers STOPPED → the last status changes in place and no flash is shown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(tasks.getTask)
      .mockImplementationOnce(() => Promise.resolve(found(task())))
      .mockImplementation(() =>
        Promise.resolve(found(task({ lastStatus: 'STOPPED', stopCode: 'EssentialContainerExited' }))),
      );
    open();
    const summary = await details();
    expect(pairs()['Last status']).toBe('Running');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => {
      expect(pairs()['Last status']).toBe('Stopped');
    });
    expect(screen.getByRole('heading', { name: 'Task details' })).toBe(summary);
    expect(pairs()['Stop code']).toBe('EssentialContainerExited');
    expect(PAGE.findFlashbar()?.findItems() ?? []).toHaveLength(0);
  });

  it('"Refresh" → the task, its cluster and its logs are read again', async () => {
    open();
    await screen.findByRole('heading', { name: 'Log of app' });
    await waitFor(() => {
      expect(logs.getLogLines).toHaveBeenCalledTimes(1);
    });
    const counts = () => [
      vi.mocked(api.getCluster).mock.calls.length,
      vi.mocked(tasks.getTask).mock.calls.length,
      vi.mocked(logs.getContainerLogs).mock.calls.length,
      vi.mocked(logs.getLogLines).mock.calls.length,
    ];
    expect(counts()).toEqual([1, 1, 1, 1]);
    fireEvent.click(action('Refresh'));
    await waitFor(() => {
      expect(counts()).toEqual([2, 2, 2, 2]);
    });
  });

  it('a refused stop → the flash "The emulator did not stop task abc." with the code and message', async () => {
    vi.mocked(tasks.stopTask).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'StopTask',
        code: 'InvalidParameterException',
        message: 'The referenced task was not found',
      }),
    );
    vi.mocked(tasks.getTask).mockImplementation(() => Promise.resolve(found(task({ lastStatus: 'STOPPED' }))));
    open();
    await details();
    await stopFromThePage();
    expect(await screen.findByText('The emulator did not stop task abc.')).toBeInTheDocument();
    const item = text(PAGE.findFlashbar()?.findItems()[0]?.getElement());
    expect(item).toContain('InvalidParameterException');
    expect(item).toContain('The referenced task was not found');
  });

  it('the task MISSING → "No task abc" with a link to the cluster\'s page', async () => {
    vi.mocked(tasks.getTask).mockResolvedValue({ found: false });
    open();
    expect(await screen.findByText('No task abc')).toBeInTheDocument();
    expect(screen.getByText('Cluster dev of the local emulator has no task of this ID.')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'dev' });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/aws/ecs/clusters/cluster/dev');
    }
  });

  it("the cluster not found → the cluster's not-found state and no task read", async () => {
    vi.mocked(api.getCluster).mockResolvedValue({ found: false });
    open();
    expect(await screen.findByText('No cluster named dev')).toBeInTheDocument();
    expect(screen.getByText('The local emulator has no active cluster of this name.')).toBeInTheDocument();
    expect(tasks.getTask).not.toHaveBeenCalled();
  });

  it('a failed read of the task → the failure state with a retry; the page names "services and tasks"', async () => {
    vi.mocked(tasks.getTask)
      .mockRejectedValueOnce(
        new RequestError({ kind: 'other', operation: 'DescribeTasks', code: 'ServerException', message: 'boom' }),
      )
      .mockImplementation(() => Promise.resolve(found(task({ lastStatus: 'STOPPED' }))));
    open();
    expect((await screen.findAllByText('The task could not be read')).length).toBeGreaterThan(0);
    expect(screen.getByText('These services and tasks are in your local emulator')).toBeInTheDocument();
    fireEvent.click(action('Retry'));
    await details();
  });
});
