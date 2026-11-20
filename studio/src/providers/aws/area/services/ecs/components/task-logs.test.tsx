import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { creationDateText } from '../../../components/format-date';
import * as logs from '../logs-api';
import type { Task } from '../task-api';
import { TaskLogs } from './task-logs';

// The log part over `logs-api.ts`, whose calls the case answers (`logs-api.test.ts` proves the calls).

vi.mock('../logs-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../logs-api')>();
  return { ...real, getContainerLogs: vi.fn(), getLogLines: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8313';
const CONNECTION = { result: undefined, engineOrigin: ENGINE };
const LOG = { group: '/ecs/web', stream: 'web/app/abc' };
const T1 = new Date('2026-11-20T01:00:00.000Z');
const T2 = new Date('2026-11-20T01:00:01.000Z');

function task(lastStatus: string): Task {
  return {
    id: 'abc',
    arn: 'arn:aws:ecs:us-east-1:0:task/dev/abc',
    lastStatus,
    definitionArn: 'arn:aws:ecs:us-east-1:0:task-definition/web:3',
    containers: [{ name: 'app' }],
  };
}

function open(first: Task) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (current: Task) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskLogs connection={CONNECTION} cluster="dev" task={current} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view(first));
  return (next: Task) => {
    rerender(view(next));
  };
}

const lineTexts = () =>
  Array.from(screen.queryByRole('log')?.children ?? []).map((line) => (line.textContent ?? '').trim());

const tokens = () => vi.mocked(logs.getLogLines).mock.calls.map((call) => call[2]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logs.getContainerLogs).mockResolvedValue([{ container: 'app', log: LOG }]);
});

describe('"Logs"', () => {
  it("a container with lines → each line's time and message as text, in the order read, under its group and stream", async () => {
    vi.mocked(logs.getLogLines).mockResolvedValue({
      lines: [
        { time: T1, message: 'first' },
        { time: T2, message: 'second' },
      ],
      nextToken: 'f/2',
    });
    open(task('STOPPED'));
    await waitFor(() => {
      expect(lineTexts()).toEqual([`${creationDateText(T1)} first`, `${creationDateText(T2)} second`]);
    });
    expect(screen.getByText('Log group /ecs/web, stream web/app/abc')).toBeInTheDocument();
    expect(vi.mocked(logs.getContainerLogs).mock.calls[0]?.slice(0, 3)).toEqual([
      ENGINE,
      'arn:aws:ecs:us-east-1:0:task-definition/web:3',
      'abc',
    ]);
    expect(vi.mocked(logs.getLogLines).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, LOG, undefined]);
  });

  it('a message that holds markup or a URL → shown as that text; no element and no link is made of it', async () => {
    vi.mocked(logs.getLogLines).mockResolvedValue({
      lines: [{ time: T1, message: '<b>x</b> see https://example.com/a' }],
    });
    open(task('STOPPED'));
    await waitFor(() => {
      expect(lineTexts()).toEqual([`${creationDateText(T1)} <b>x</b> see https://example.com/a`]);
    });
    const log = screen.getByRole('log');
    expect(log.querySelector('b')).toBeNull();
    expect(log.querySelector('a')).toBeNull();
  });

  it('"Load newer lines" → reads with the last forward token and appends; an answer with no new event keeps what is shown', async () => {
    vi.mocked(logs.getLogLines)
      .mockResolvedValueOnce({ lines: [{ time: T1, message: 'first' }], nextToken: 'f/1' })
      .mockResolvedValueOnce({ lines: [{ time: T2, message: 'second' }], nextToken: 'f/2' })
      .mockResolvedValueOnce({ lines: [], nextToken: 'f/2' });
    open(task('STOPPED'));
    await waitFor(() => {
      expect(lineTexts()).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load newer lines' }));
    await waitFor(() => {
      expect(lineTexts()).toEqual([`${creationDateText(T1)} first`, `${creationDateText(T2)} second`]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load newer lines' }));
    await waitFor(() => {
      expect(logs.getLogLines).toHaveBeenCalledTimes(3);
    });
    expect(tokens()).toEqual([undefined, 'f/1', 'f/2']);
    expect(lineTexts()).toEqual([`${creationDateText(T1)} first`, `${creationDateText(T2)} second`]);
  });

  it('no event, and a stream that is not there → "No log yet" and "This container has no log line."', async () => {
    vi.mocked(logs.getContainerLogs).mockResolvedValue([
      { container: 'app', log: LOG },
      { container: 'side', log: { group: '/ecs/web', stream: 'web/side/abc' } },
    ]);
    // An empty stream answers its token; a stream that is not there answers neither line nor token.
    vi.mocked(logs.getLogLines).mockImplementation((_at, log) =>
      Promise.resolve(log.stream === LOG.stream ? { lines: [], nextToken: 'f/0' } : { lines: [] }),
    );
    open(task('STOPPED'));
    await waitFor(() => {
      expect(screen.getAllByText('No log yet')).toHaveLength(2);
    });
    expect(screen.getAllByText('This container has no log line.')).toHaveLength(2);
  });

  it('no awslogs configuration → "No log for this container" and its sentence; a definition not read → that part alone fails', async () => {
    vi.mocked(logs.getContainerLogs).mockResolvedValueOnce([{ container: 'plain' }]);
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TaskLogs connection={CONNECTION} cluster="dev" task={task('STOPPED')} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('No log for this container');
    expect(document.body.textContent).toContain(
      'Its task definition has no awslogs log configuration with a stream prefix.',
    );
    expect(logs.getLogLines).not.toHaveBeenCalled();
    unmount();

    vi.mocked(logs.getContainerLogs).mockRejectedValueOnce(
      new RequestError({
        kind: 'other',
        operation: 'DescribeTaskDefinition',
        code: 'ClientException',
        message: 'Unable to describe task definition.',
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <p>The page&apos;s other part</p>
          <TaskLogs connection={CONNECTION} cluster="dev" task={task('STOPPED')} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('The task definition could not be read');
    expect(screen.getByText('Unable to describe task definition.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText("The page's other part")).toBeInTheDocument();
  });

  it('"No log yet" while followed, then lines: after a stream not there from the head, after an empty answer from its token', async () => {
    vi.mocked(logs.getContainerLogs).mockResolvedValue([
      { container: 'app', log: LOG },
      { container: 'side', log: { group: '/ecs/web', stream: 'web/side/abc' } },
    ]);
    vi.mocked(logs.getLogLines).mockImplementation((_at, log, token) => {
      if (log.stream === LOG.stream) {
        // Empty at first, with a token; then a line from that token.
        return Promise.resolve(
          token === undefined ? { lines: [], nextToken: 'f/0' } : { lines: [{ time: T1, message: 'a' }], nextToken: 'f/1' },
        );
      }
      // Not there at first; then a line from the head.
      const calls = vi.mocked(logs.getLogLines).mock.calls.filter((call) => call[1].stream !== LOG.stream).length;
      return Promise.resolve(calls === 1 ? { lines: [] } : { lines: [{ time: T2, message: 'b' }], nextToken: 's/1' });
    });
    const readAgain = open(task('RUNNING'));
    await waitFor(() => {
      expect(screen.getAllByText('No log yet')).toHaveLength(2);
    });
    readAgain(task('RUNNING'));
    await waitFor(() => {
      expect(screen.queryByText('No log yet')).not.toBeInTheDocument();
    });
    const calls = vi.mocked(logs.getLogLines).mock.calls;
    expect(calls.filter((call) => call[1].stream === LOG.stream).map((call) => call[2])).toEqual([undefined, 'f/0']);
    expect(calls.filter((call) => call[1].stream !== LOG.stream).map((call) => call[2])).toEqual([
      undefined,
      undefined,
    ]);
    const shown = screen.getAllByRole('log').map((log) => (log.textContent ?? '').trim());
    expect(shown).toEqual([`${creationDateText(T1)} a`, `${creationDateText(T2)} b`]);
  });

  it('while followed, a new read of the task reads on from the token; once STOPPED once more and not again', async () => {
    let n = 0;
    vi.mocked(logs.getLogLines).mockImplementation(() => {
      n += 1;
      return Promise.resolve({ lines: [{ time: T1, message: `line ${String(n)}` }], nextToken: `f/${String(n)}` });
    });
    const readAgain = open(task('PROVISIONING'));
    await waitFor(() => {
      expect(lineTexts()).toHaveLength(1);
    });
    readAgain(task('RUNNING'));
    await waitFor(() => {
      expect(lineTexts()).toHaveLength(2);
    });
    readAgain(task('STOPPED'));
    await waitFor(() => {
      expect(lineTexts()).toHaveLength(3);
    });
    readAgain(task('STOPPED'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(logs.getLogLines).toHaveBeenCalledTimes(3);
    expect(tokens()).toEqual([undefined, 'f/1', 'f/2']);
    expect(lineTexts().map((line) => line.split(' ').slice(-2).join(' '))).toEqual(['line 1', 'line 2', 'line 3']);
  });
});
