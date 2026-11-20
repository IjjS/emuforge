import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import * as api from '../task-api';
import { TasksTable, type TasksTableProps } from './tasks-table';

// The table over `task-api.ts`, whose calls the case answers (`task-api.test.ts` proves the calls).

vi.mock('../task-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../task-api')>();
  return { ...real, listTasks: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8312';
const CONNECTION = { result: undefined, engineOrigin: ENGINE };

function task(id: string, extra: Partial<api.Task> = {}): api.Task {
  return {
    id,
    arn: `arn:aws:ecs:us-east-1:0:task/dev/${id}`,
    lastStatus: 'RUNNING',
    definitionArn: 'arn:aws:ecs:us-east-1:0:task-definition/web:3',
    definition: { family: 'web', revision: 3 },
    group: 'family:web',
    stopCode: 'UserInitiated',
    containers: [],
    ...extra,
  };
}

function open(props: Partial<TasksTableProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TasksTable connection={CONNECTION} cluster="dev" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return createWrapper(document.body);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

function choose(wrapper: ReturnType<typeof createWrapper>, value: string) {
  act(() => {
    wrapper.findSelect()?.openDropdown();
  });
  act(() => {
    wrapper.findSelect()?.selectOptionByValue(value);
  });
}

const headers = (wrapper: ReturnType<typeof createWrapper>) =>
  (wrapper.findTable()?.findColumnHeaders() ?? []).map((header) => header.getElement().textContent);

describe('the tasks table', () => {
  it('tasks read → the columns of R4, each id a link to the task, each definition to its revision; a service has no "Group"', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [task('abc')] });
    const wrapper = open();
    const link = await screen.findByRole('link', { name: 'abc' });
    expect(link).toHaveAttribute('href', '/aws/ecs/clusters/cluster/dev/tasks/task/abc');
    expect(screen.getByRole('link', { name: 'web:3' })).toHaveAttribute(
      'href',
      '/aws/ecs/task-definitions/family/web/revision/3',
    );
    expect(headers(wrapper)).toEqual(['Task', 'Last status', 'Task definition', 'Group', 'Started at', 'Stop code']);
    const row = wrapper.findTable()?.findRows()[0]?.getElement();
    expect(row?.textContent).toContain('family:web');
    expect(row?.textContent).toContain('Running');
    expect(row?.textContent).toContain('UserInitiated');
  });

  it('the Group column keeps a group whole: a min width of 28ch', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [task('abc')] });
    const wrapper = open();
    await screen.findByRole('link', { name: 'abc' });
    const group = (wrapper.findTable()?.findColumnHeaders() ?? []).find(
      (header) => header.getElement().textContent === 'Group',
    );
    expect(group?.getElement().style.minWidth).toBe('28ch');
  });

  it('the Task column keeps a 32-character task id on one line with its padding: 32ch + 48px', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [task('abc')] });
    const wrapper = open();
    await screen.findByRole('link', { name: 'abc' });
    const column = (wrapper.findTable()?.findColumnHeaders() ?? []).find(
      (header) => header.getElement().textContent === 'Task',
    );
    expect(column?.getElement().style.minWidth).toBe('calc(32ch + 48px)');
  });

  it('the Started at column keeps a date to two lines: 21ch + 48px', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [task('abc')] });
    const wrapper = open();
    await screen.findByRole('link', { name: 'abc' });
    const column = (wrapper.findTable()?.findColumnHeaders() ?? []).find(
      (header) => header.getElement().textContent === 'Started at',
    );
    expect(column?.getElement().style.minWidth).toBe('calc(21ch + 48px)');
  });

  it('a service\'s table → no "Group" column, and the list is read by the service', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [task('abc')] });
    const wrapper = open({ service: 'api' });
    await screen.findByRole('link', { name: 'abc' });
    expect(headers(wrapper)).toEqual(['Task', 'Last status', 'Task definition', 'Started at', 'Stop code']);
    expect(vi.mocked(api.listTasks).mock.calls[0]?.[2]).toEqual({ desiredStatus: 'RUNNING', service: 'api' });
  });

  it('"Stopped" chosen by its value → the list is read with desiredStatus STOPPED from its first page', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [task('abc')], nextToken: 'tok-1' });
    const wrapper = open();
    await screen.findByRole('link', { name: 'abc' });
    act(() => {
      wrapper.findTable()?.findPagination()?.findNextPageButton().click();
    });
    await waitFor(() => {
      expect(api.listTasks).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(api.listTasks).mock.calls[1]?.[3]).toBe('tok-1');
    choose(wrapper, 'STOPPED');
    await waitFor(() => {
      expect(api.listTasks).toHaveBeenCalledTimes(3);
    });
    const last = vi.mocked(api.listTasks).mock.calls[2];
    expect(last?.[2]).toEqual({ desiredStatus: 'STOPPED' });
    expect(last?.[3]).toBeUndefined();
  });

  it('"Running" with a task → read again after 3 seconds and the page told of each such read, not of the first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onFollowedRead = vi.fn();
    vi.mocked(api.listTasks).mockImplementation(() => Promise.resolve({ tasks: [task('abc')] }));
    open({ onFollowedRead });
    await screen.findByRole('link', { name: 'abc' });
    expect(api.listTasks).toHaveBeenCalledTimes(1);
    expect(onFollowedRead).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => {
      expect(onFollowedRead).toHaveBeenCalledTimes(1);
    });
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => {
      expect(onFollowedRead).toHaveBeenCalledTimes(2);
    });
  });

  it('under "Stopped", or empty under "Running" → not read again and nothing told', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onFollowedRead = vi.fn();
    vi.mocked(api.listTasks).mockImplementation((_at, _cluster, filters) =>
      Promise.resolve({ tasks: filters.desiredStatus === 'STOPPED' ? [task('old', { lastStatus: 'STOPPED' })] : [] }),
    );
    const wrapper = open({ onFollowedRead });
    await screen.findByText('No running tasks');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(api.listTasks).toHaveBeenCalledTimes(1);
    choose(wrapper, 'STOPPED');
    await screen.findByRole('link', { name: 'old' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    expect(onFollowedRead).not.toHaveBeenCalled();
  });

  it('empty under "Running" → "No running tasks" with "Run task" when given its address; under "Stopped" → "No stopped tasks"', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    const wrapper = open({ runHref: '/aws/ecs/clusters/cluster/dev/tasks/run' });
    await screen.findByText('No running tasks');
    expect(screen.getByRole('link', { name: 'Run task' })).toHaveAttribute(
      'href',
      '/aws/ecs/clusters/cluster/dev/tasks/run',
    );
    choose(wrapper, 'STOPPED');
    await screen.findByText('No stopped tasks');
    expect(screen.queryByRole('link', { name: 'Run task' })).not.toBeInTheDocument();
  });

  it('empty under "Running" without the run address → no "Run task"', async () => {
    vi.mocked(api.listTasks).mockResolvedValue({ tasks: [] });
    open();
    await screen.findByText('No running tasks');
    expect(screen.queryByRole('link', { name: 'Run task' })).not.toBeInTheDocument();
  });

  it('a failed read → the failure state with a retry', async () => {
    vi.mocked(api.listTasks)
      .mockRejectedValueOnce(
        new RequestError({ kind: 'other', operation: 'ListTasks', code: 'ClusterNotFoundException', message: 'gone' }),
      )
      .mockResolvedValue({ tasks: [task('abc')] });
    open();
    await screen.findByText('The task list could not be read');
    expect(screen.getByText('ClusterNotFoundException')).toBeInTheDocument();
    act(() => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });
    await screen.findByRole('link', { name: 'abc' });
  });
});
