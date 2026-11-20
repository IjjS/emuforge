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

// S9 rendered inside the area's layout, with the calls of `definition-api.ts` answered by the case
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

const ARN = 'arn:aws:ecs:us-east-1:000000000000:task-definition/web:2';

function revision(changes: Partial<api.Revision> = {}): api.Revision {
  return {
    family: 'web',
    revision: 2,
    arn: ARN,
    status: 'ACTIVE',
    networkMode: 'awsvpc',
    compatibilities: ['EC2', 'FARGATE'],
    cpu: '256',
    memory: '512',
    executionRoleArn: 'arn:aws:iam::000000000000:role/exec',
    taskRoleArn: 'arn:aws:iam::000000000000:role/task',
    registeredAt: new Date('2026-11-20T05:15:03.000Z'),
    containers: [
      {
        name: 'app',
        image: 'busybox',
        essential: true,
        command: ['sh', '-c', 'echo a; sleep 1'],
        ports: [{ containerPort: 80, protocol: 'tcp' }],
        logGroup: '/ecs/web',
      },
      { name: 'side', image: 'nginx', essential: false, ports: [] },
    ],
    answer: { family: 'web', revision: 2, taskDefinitionArn: ARN },
    ...changes,
  };
}

const PAGE = createWrapper(document.body);
const PATH = '/aws/ecs/task-definitions/family/web/revision/2';
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The summary's values, by label. */
function summary(): Record<string, string> {
  const pairs = PAGE.findKeyValuePairs();
  expect(pairs).not.toBeNull();
  return Object.fromEntries(
    (pairs?.findItems() ?? []).map((item) => [
      text(item.findLabel()?.getElement() as HTMLElement),
      text(item.findValue()?.getElement() as HTMLElement),
    ]),
  );
}

function containerRows(): string[][] {
  const table = PAGE.findTable();
  expect(table).not.toBeNull();
  return (table?.findRows() ?? []).map((row) => [...row.getElement().querySelectorAll('td, th')].map(text));
}

// ---------------------------------------------------------------------------------------------------------------

describe("a revision's page", () => {
  it('a revision → h1 "{family}:{revision}", the summary with the ARN copyable, the containers and the JSON with "Copy JSON"', async () => {
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision() });
    open(PATH);
    expect(await screen.findByText('Task definition details')).toBeInTheDocument();
    expect(api.getRevision).toHaveBeenCalledWith(ENGINE, 'web', 2, expect.any(AbortSignal));
    expect(screen.getByRole('heading', { level: 1, name: 'web:2' })).toBeInTheDocument();
    const values = summary();
    expect(Object.keys(values)).toEqual([
      'ARN',
      'Status',
      'Network mode',
      'Compatibilities',
      'CPU',
      'Memory',
      'Execution role',
      'Task role',
      'Registered at',
    ]);
    expect(values).toMatchObject({
      ARN: ARN,
      Status: 'Active',
      'Network mode': 'awsvpc',
      Compatibilities: 'EC2, FARGATE',
      CPU: '256',
      Memory: '512',
      'Execution role': 'arn:aws:iam::000000000000:role/exec',
      'Task role': 'arn:aws:iam::000000000000:role/task',
    });
    expect(values['Registered at']).toMatch(/2026/);
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();

    expect(containerRows()).toEqual([
      ['app', 'busybox', 'Yes', 'sh -c echo a; sleep 1', '80/tcp', '/ecs/web'],
      ['side', 'nginx', 'No', '-', '-', '-'],
    ]);
    expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeInTheDocument();
    const json = [...document.querySelectorAll('.aws-area-value-text')].find(
      (element) => element.textContent === JSON.stringify(revision().answer, null, 2),
    );
    expect(json).toBeDefined();
  });

  it('a revision without roles, CPU or memory → each "-"', async () => {
    const bare = revision();
    delete bare.executionRoleArn;
    delete bare.taskRoleArn;
    delete bare.cpu;
    delete bare.memory;
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: bare });
    open(PATH);
    expect(await screen.findByText('Task definition details')).toBeInTheDocument();
    expect(summary()).toMatchObject({ CPU: '-', Memory: '-', 'Execution role': '-', 'Task role': '-' });
  });

  it('"Register new revision" → the register address with from this revision', async () => {
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision() });
    const router = open(PATH);
    expect(await screen.findByText('Task definition details')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Register new revision' });
    expect(link).toHaveAttribute('href', '/aws/ecs/task-definitions/register?from=web%3A2');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/register');
    });
    expect(router.state.location.search).toBe('?from=web%3A2');
  });

  it('"Refresh" → the revision is read again', async () => {
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision() });
    open(PATH);
    expect(await screen.findByText('Task definition details')).toBeInTheDocument();
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision({ status: 'INACTIVE' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(summary()['Status']).toBe('Inactive');
    });
    expect(api.getRevision).toHaveBeenCalledTimes(2);
  });

  it('not found → "No revision {family}:{revision}" with a link to the family\'s page', async () => {
    vi.mocked(api.getRevision).mockResolvedValue({ found: false });
    const router = open(PATH);
    expect(await screen.findByText('No revision web:2')).toBeInTheDocument();
    expect(screen.getByText('The local emulator has no such task definition.')).toBeInTheDocument();
    const state = screen.getByText('No revision web:2').parentElement?.parentElement as HTMLElement;
    const link = within(state).getByRole('link', { name: 'web' });
    expect(link).toHaveAttribute('href', '/aws/ecs/task-definitions/family/web');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ecs/task-definitions/family/web');
    });
  });

  it("a failed read → the area's failure state with a retry", async () => {
    vi.mocked(api.getRevision).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DescribeTaskDefinition', code: 'InternalError', message: 'broke' }),
    );
    open(PATH);
    expect(await screen.findByText(/broke/)).toBeInTheDocument();
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision() });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Task definition details')).toBeInTheDocument();
  });

  it('the Containers table fits its container at 1280: Name, an address part for Image and a line for Command', async () => {
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision() });
    open(PATH);
    expect(await screen.findByText('Task definition details')).toBeInTheDocument();
    const widths = Object.fromEntries(
      (PAGE.findTable()?.findColumnHeaders() ?? []).map((header) => [
        text(header.getElement()),
        header.getElement().style.minWidth,
      ]),
    );
    expect(widths['Name']).toBe('calc(24ch + 40px)');
    expect(widths['Image']).toBe('calc(13ch + 40px)');
    expect(widths['Command']).toBe('calc(25ch - 40px)');
  });

  it('the Containers table keeps the room of a 24-character name, so web-api-sidecar-proxy-v2 stays whole', async () => {
    const name = 'web-api-sidecar-proxy-v2';
    expect(name).toHaveLength(24);
    vi.mocked(api.getRevision).mockResolvedValue({
      found: true,
      revision: revision({ containers: [{ name, image: 'busybox', essential: true, ports: [] }] }),
    });
    open(PATH);
    expect(await screen.findByText(name)).toBeInTheDocument();
    const header = (PAGE.findTable()?.findColumnHeaders() ?? []).find((column) => text(column.getElement()) === 'Name');
    expect(header?.getElement().style.minWidth).toBe('calc(24ch + 40px)');
    expect(screen.getByText(name)).toHaveClass('aws-area-value-name');
  });

  it('the Containers table keeps the room of a log group part, so /ecs/web-api breaks only after a slash', async () => {
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision() });
    open(PATH);
    expect(await screen.findByText('Task definition details')).toBeInTheDocument();
    const header = (PAGE.findTable()?.findColumnHeaders() ?? []).find(
      (column) => text(column.getElement()) === 'Log group',
    );
    expect(header?.getElement().style.minWidth).toBe('20ch');
  });

  it('the page names "task definitions" to the frame', async () => {
    vi.mocked(api.getRevision).mockResolvedValue({ found: true, revision: revision() });
    open(PATH);
    expect(await screen.findByText('These task definitions are in your local emulator')).toBeInTheDocument();
  });
});
