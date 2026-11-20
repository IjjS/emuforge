import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import * as clusterApi from '../cluster-api';

// S7 rendered inside the area's layout, with the calls of `cluster-api.ts` answered by the case
// (`cluster-api.test.ts` proves the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listInstances: vi.fn(), getInstance: vi.fn(), actOnInstance: vi.fn() };
});

vi.mock('../cluster-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../cluster-api')>();
  return {
    ...real,
    listClusters: vi.fn(),
    getCluster: vi.fn(),
    listMembers: vi.fn(),
    deleteCluster: vi.fn(),
    addInstance: vi.fn(),
  };
});

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

const EMULATOR = { port: 9573, endpoint: 'https://127.0.0.1:9573' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8573';

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

function open(path = '/aws/rds') {
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
// The cluster and readers.

const CLUSTER: clusterApi.DbCluster = {
  id: 'app-aur',
  status: 'available',
  engine: 'aurora-postgresql',
  engineVersion: '16.4',
  port: 5432,
  securityGroups: [],
  members: [],
  deletionProtection: false,
  tags: [],
};

function found(changes: Partial<clusterApi.DbCluster> = {}): clusterApi.ClusterRead {
  return { found: true, cluster: { ...CLUSTER, ...changes } };
}

const PAGE = createWrapper(document.body);
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

const PATH = '/aws/rds/clusters/cluster/app-aur/add-instance';
const CLUSTER_PATH = '/aws/rds/clusters/cluster/app-aur';

function field(label: string) {
  const found = PAGE.findAllFormFields().find((item) => text(item.findLabel()?.getElement() as Element) === label);
  expect(found, label).toBeDefined();
  return found as NonNullable<typeof found>;
}

function input(label: string): HTMLInputElement {
  return field(label).findControl()?.getElement().querySelector('input') as HTMLInputElement;
}

function type(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } });
}

function submit(): HTMLElement {
  return PAGE.findForm()?.findActions()?.findButton('[type="submit"]')?.getElement() as HTMLElement;
}

/** The failure shown above the form's buttons. */
function formAlert(): string {
  const form = PAGE.findForm();
  const alert = form === null ? null : createWrapper(form.getElement()).findAlert();
  return alert === null ? '' : text(alert.getElement());
}

function flashes(type?: 'success' | 'error' | 'info'): string[] {
  const bar = PAGE.findFlashbar();
  const items = bar === null ? [] : type === undefined ? bar.findItems() : bar.findItemsByType(type);
  return items.map((item) => text(item.getElement()));
}

async function formShown() {
  await screen.findByText('DB instance identifier');
}

/** S6's reads, for a case that leads there. */
function answerCluster() {
  vi.mocked(clusterApi.getCluster).mockResolvedValue(found());
  vi.mocked(clusterApi.listMembers).mockResolvedValue([]);
}

// ---------------------------------------------------------------------------------------------------------------

describe('"Add DB instance"', () => {
  it('opens with an empty identifier with its constraint text and the class db.r6g.large; the description names the cluster', async () => {
    answerCluster();
    open(PATH);
    await formShown();
    expect(input('DB instance identifier').value).toBe('');
    expect(text(field('DB instance identifier').findConstraint()?.getElement() as Element)).toBe(
      '1 to 63 characters: letters, digits and hyphens. It begins with a letter, does not end with a hyphen and has no two hyphens in a row. Stored in lower case.',
    );
    expect(input('DB instance class').value).toBe('db.r6g.large');
    expect(text(field('DB instance class').findDescription()?.getElement() as Element)).toBe(
      'As the API names it, for example db.t3.micro.',
    );
    expect(
      screen.getByText("Adds a DB instance to app-aur, with the cluster's engine and version."),
    ).toBeInTheDocument();
    expect(vi.mocked(clusterApi.getCluster).mock.calls[0]?.[1]).toBe('app-aur');
  });

  for (const [label, value, message] of [
    ['DB instance identifier', '1-db', 'An identifier begins with a letter.'],
    ['DB instance identifier', '', 'Enter an identifier.'],
    ['DB instance class', '', 'Enter a class.'],
  ] as const) {
    it(`a fault (${label} "${value}") → "${message}" at the field and nothing sent`, async () => {
      answerCluster();
      open(PATH);
      await formShown();
      if (label === 'DB instance class') {
        type('DB instance identifier', 'app-aur-1');
      }
      type(label, value);
      fireEvent.click(submit());
      await waitFor(() => {
        expect(text(field(label).findError()?.getElement() as Element)).toBe(message);
      });
      expect(clusterApi.addInstance).not.toHaveBeenCalled();
    });
  }

  it('"Add DB instance" → one CreateDBInstance with the cluster\'s engine and version; the cluster\'s page with "Creating DB instance {id}"', async () => {
    answerCluster();
    vi.mocked(clusterApi.addInstance).mockResolvedValue('app-aur-1');
    const router = open(PATH);
    await formShown();
    type('DB instance identifier', 'App-Aur-1');
    fireEvent.click(submit());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
    await waitFor(() => {
      expect(flashes('success')).toEqual(['Creating DB instance app-aur-1']);
    });
    expect(clusterApi.addInstance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(clusterApi.addInstance).mock.calls[0]?.[1]).toEqual({
      id: 'App-Aur-1',
      clusterId: 'app-aur',
      engine: 'aurora-postgresql',
      engineVersion: '16.4',
      instanceClass: 'db.r6g.large',
    });
  });

  it('a cluster of mysql (a Multi-AZ DB cluster) → the form is offered and sends that engine and version', async () => {
    vi.mocked(clusterApi.getCluster).mockResolvedValue(found({ engine: 'mysql', engineVersion: '8.0.40' }));
    vi.mocked(clusterApi.listMembers).mockResolvedValue([]);
    vi.mocked(clusterApi.addInstance).mockResolvedValue('maz-1');
    open(PATH);
    await formShown();
    type('DB instance identifier', 'maz-1');
    type('DB instance class', 'db.m5d.large');
    fireEvent.click(submit());
    await waitFor(() => {
      expect(clusterApi.addInstance).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(clusterApi.addInstance).mock.calls[0]?.[1]).toMatchObject({
      engine: 'mysql',
      engineVersion: '8.0.40',
      instanceClass: 'db.m5d.large',
    });
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    answerCluster();
    vi.mocked(clusterApi.addInstance).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'CreateDBInstance',
        code: 'InvalidParameterCombination',
        message: 'DB Instance class db.nosuch.large does not support this engine.',
      }),
    );
    const router = open(PATH);
    await formShown();
    type('DB instance identifier', 'app-aur-2');
    type('DB instance class', 'db.nosuch.large');
    fireEvent.click(submit());
    await waitFor(() => {
      expect(formAlert()).toMatch(/InvalidParameterCombination.*does not support this engine/);
    });
    expect(router.state.location.pathname).toBe(PATH);
    expect(input('DB instance identifier').value).toBe('app-aur-2');
    expect(input('DB instance class').value).toBe('db.nosuch.large');
  });

  it('a 501 → "not implemented by the emulator" with CreateDBInstance', async () => {
    answerCluster();
    vi.mocked(clusterApi.addInstance).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateDBInstance' }),
    );
    open(PATH);
    await formShown();
    type('DB instance identifier', 'app-aur-2');
    fireEvent.click(submit());
    await waitFor(() => {
      expect(formAlert()).toMatch(/Not implemented by the emulator.*CreateDBInstance/);
    });
  });

  it('while adding the button reads "Adding" and a second press sends nothing', async () => {
    answerCluster();
    vi.mocked(clusterApi.addInstance).mockImplementation(() => new Promise(() => undefined));
    open(PATH);
    await formShown();
    type('DB instance identifier', 'app-aur-2');
    fireEvent.click(submit());
    await waitFor(() => {
      expect(text(submit())).toBe('Adding');
    });
    fireEvent.click(submit());
    fireEvent.submit(submit().closest('form') as HTMLFormElement);
    expect(clusterApi.addInstance).toHaveBeenCalledTimes(1);
  });

  it('a cluster the emulator does not hold → "DB cluster not found" with "View DB clusters", and no form', async () => {
    vi.mocked(clusterApi.getCluster).mockResolvedValue({ found: false });
    open(PATH);
    await screen.findByText('DB cluster not found');
    expect(screen.getByText('The emulator holds no DB cluster with this identifier.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View DB clusters' })).toHaveAttribute('href', '/aws/rds/clusters');
    expect(screen.queryByText('DB instance identifier')).toBeNull();
    expect(PAGE.findForm()).toBeNull();
  });

  it('loading → "Loading DB cluster"', async () => {
    vi.mocked(clusterApi.getCluster).mockImplementation(() => new Promise(() => undefined));
    open(PATH);
    expect(await screen.findByText('Loading DB cluster')).toBeInTheDocument();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeDBClusters' },
      /Not implemented by the emulator.*DescribeDBClusters/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeDBClusters', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeDBClusters', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeDBClusters' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeDBClusters', code: 'InternalFailure', message: 'broke' },
      /InternalFailure.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeDBClusters', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read of the cluster, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(clusterApi.getCluster).mockRejectedValue(new RequestError(failure));
      open(PATH);
      const retry = await screen.findByRole('button', { name: 'Retry' });
      expect(text(PAGE.findContainer()?.getElement() as Element)).toMatch(shown);
      vi.mocked(clusterApi.getCluster).mockResolvedValue(found());
      const calls = vi.mocked(clusterApi.getCluster).mock.calls.length;
      fireEvent.click(retry);
      await formShown();
      expect(vi.mocked(clusterApi.getCluster).mock.calls.length).toBe(calls + 1);
    });
  }

  for (const order of ['in the order asked', 'the later one first'] as const) {
    it(`after "Add DB instance" is answered, the reads it starts answering ${order} → the cluster's page with the result`, async () => {
      const reads: { args: unknown[]; resolve: (read: clusterApi.ClusterRead) => void }[] = [];
      vi.mocked(clusterApi.getCluster).mockImplementation(
        (...args: unknown[]) =>
          new Promise((resolve) => {
            reads.push({ args, resolve });
          }),
      );
      const members: { resolve: (members: api.DbInstance[]) => void }[] = [];
      vi.mocked(clusterApi.listMembers).mockImplementation(
        () =>
          new Promise((resolve) => {
            members.push({ resolve });
          }),
      );
      vi.mocked(clusterApi.addInstance).mockResolvedValue('app-aur-1');
      const router = open(PATH);
      await waitFor(() => {
        expect(reads).toHaveLength(1);
      });
      act(() => {
        reads[0]?.resolve(found());
      });
      await formShown();
      type('DB instance identifier', 'app-aur-1');
      fireEvent.click(submit());
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(CLUSTER_PATH);
      });
      await waitFor(() => {
        expect(members.length).toBeGreaterThan(0);
      });
      const pending = reads.slice(1);
      const answered = order === 'in the order asked' ? pending : [...pending].reverse();
      act(() => {
        for (const read of answered) {
          read.resolve(found({ members: [{ id: 'app-aur-1', writer: true }] }));
        }
        for (const list of members) {
          list.resolve([
            {
              id: 'app-aur-1',
              status: 'creating',
              parameterGroups: [],
              securityGroups: [],
              deletionProtection: false,
              tags: [],
            },
          ]);
        }
      });
      await screen.findByText('DB cluster details');
      expect(flashes('success')).toEqual(['Creating DB instance app-aur-1']);
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
  }

  it('"Cancel" with nothing changed → the cluster\'s page at once; after a change → the discard dialog', async () => {
    answerCluster();
    const router = open(PATH);
    await formShown();
    type('DB instance class', 'db.r6g.xlarge');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Discard what you entered?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(input('DB instance class').value).toBe('db.r6g.xlarge');
    type('DB instance class', 'db.r6g.large');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
    expect(clusterApi.addInstance).not.toHaveBeenCalled();
  });

  it('"Discard" in the dialog → the cluster\'s page, nothing sent', async () => {
    answerCluster();
    const router = open(PATH);
    await formShown();
    type('DB instance identifier', 'x');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(CLUSTER_PATH);
    });
    expect(clusterApi.addInstance).not.toHaveBeenCalled();
  });

  it('the page names its resources "DB clusters" to the frame', async () => {
    answerCluster();
    open(PATH);
    expect(await screen.findByText('These DB clusters are in your local emulator')).toBeInTheDocument();
  });
});
