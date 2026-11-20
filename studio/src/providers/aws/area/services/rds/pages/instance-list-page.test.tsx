import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import * as api from '../api';

// S1 rendered inside the area's layout, with the calls of `api.ts` answered by the case (`api.test.ts` proves the
// calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listInstances: vi.fn(), getInstance: vi.fn(), actOnInstance: vi.fn() };
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
// DB instances and readers.

const CREATED = new Date('2026-11-20T01:02:03.000Z');
const created = creationDateText(CREATED);

function instance(id: string, status: string, changes: Partial<api.DbInstance> = {}): api.DbInstance {
  return {
    id,
    status,
    engine: 'postgres',
    engineVersion: '18.3',
    instanceClass: 'db.t3.micro',
    address: '0.0.0.0',
    port: 41000,
    createdAt: CREATED,
    parameterGroups: [],
    securityGroups: [],
    deletionProtection: false,
    tags: [],
    ...changes,
  };
}

/** `listInstances` answering each request from `pages`, by its marker (`''` for none). */
function answer(pages: Record<string, api.InstancePage>) {
  vi.mocked(api.listInstances).mockImplementation((_endpoint, marker) =>
    Promise.resolve(pages[marker ?? ''] ?? { instances: [] }),
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

/** A control of the table's header (outside any dialog). */
function action(name: string): HTMLElement {
  return within(table().getElement()).getByRole('button', { name });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function reasonOf(element: Element): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

function selectRow(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

function flashes(type?: 'success' | 'error' | 'info'): string[] {
  const bar = PAGE.findFlashbar();
  const items = bar === null ? [] : type === undefined ? bar.findItems() : bar.findItemsByType(type);
  return items.map((item) => text(item.getElement()));
}

async function confirmDelete() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

const ROW_1 = ['app-db', 'available', 'postgres 18.3', 'db.t3.micro', '-', '41000', created];

// ---------------------------------------------------------------------------------------------------------------

describe('the DB instances list', () => {
  it('a row per instance with its values; links to the instance and to a member\'s cluster; "-" outside a cluster and for an absent port', async () => {
    answer({
      '': {
        instances: [
          instance('app-db', 'available'),
          instance('aur-1-w', 'creating', {
            engine: 'aurora-postgresql',
            engineVersion: '16.4',
            instanceClass: 'db.r6g.large',
            clusterId: 'aur-1',
            port: 42000,
          }),
          {
            id: 'bare',
            status: 'stopped',
            parameterGroups: [],
            securityGroups: [],
            deletionProtection: false,
            tags: [],
          },
        ],
      },
    });
    const router = open('/aws/rds');
    await expectRows([
      ROW_1,
      ['aur-1-w', 'creating', 'aurora-postgresql 16.4', 'db.r6g.large', 'aur-1', '42000', created],
      ['bare', 'stopped', '-', '-', '-', '-', '-'],
    ]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'DB identifier',
      'Status',
      'Engine',
      'Class',
      'DB cluster',
      'Port',
      'Created',
    ]);
    expect(screen.getByRole('link', { name: 'aur-1' })).toHaveAttribute('href', '/aws/rds/clusters/cluster/aur-1');
    const link = screen.getByRole('link', { name: 'app-db' });
    expect(link).toHaveAttribute('href', '/aws/rds/instances/instance/app-db');
    vi.mocked(api.getInstance).mockResolvedValue({ found: false });
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances/instance/app-db');
    });
  });

  it('none → "No DB instances" with "Create DB instance", which leads to the create address', async () => {
    answer({});
    const router = open('/aws/rds/instances');
    await waitFor(() => {
      expect(screen.getByText('No DB instances')).toBeInTheDocument();
    });
    expect(screen.getByText('The emulator holds no DB instance yet.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Create DB instance' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances/create');
    });
  });

  it('loading → "Loading DB instances"', async () => {
    vi.mocked(api.listInstances).mockImplementation(() => new Promise(() => undefined));
    open();
    await waitFor(() => {
      expect(screen.getByText('Loading DB instances')).toBeInTheDocument();
    });
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeDBInstances' },
      /Not implemented by the emulator.*DescribeDBInstances/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeDBInstances', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeDBInstances', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeDBInstances' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeDBInstances', code: 'InternalFailure', message: 'broke' },
      /InternalFailure.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeDBInstances', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.listInstances).mockRejectedValue(new RequestError(failure));
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listInstances).mock.calls.length;
      answer({ '': { instances: [instance('app-db', 'available')] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([ROW_1]);
      expect(vi.mocked(api.listInstances).mock.calls.length).toBe(calls + 1);
    });
  }

  it('the next page asks with the marker; "previous" shows the page before', async () => {
    answer({
      '': { instances: [instance('app-db', 'available')], marker: 'm-2' },
      'm-2': { instances: [instance('zz-db', 'stopped')] },
    });
    open();
    await expectRows([ROW_1]);
    expect(vi.mocked(api.listInstances).mock.calls.at(-1)?.[1]).toBeUndefined();
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await waitFor(() => {
      expect(rows()[0]?.[0]).toBe('zz-db');
    });
    expect(vi.mocked(api.listInstances).mock.calls.at(-1)?.[1]).toBe('m-2');
    fireEvent.click(table().findPagination()?.findPreviousPageButton().getElement() as HTMLElement);
    await expectRows([ROW_1]);
  });

  it('a row selected → the actions are that instance\'s; "Refresh" reads the page again and keeps the selection', async () => {
    answer({ '': { instances: [instance('app-db', 'available'), instance('old-db', 'stopped')] } });
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(reasonOf(action('Start'))).toBe('Select one DB instance.');
    selectRow('old-db');
    expect(isDisabled(action('Start'))).toBe(false);
    expect(reasonOf(action('Stop'))).toBe('Only an available DB instance can be stopped.');
    selectRow('app-db');
    expect(isDisabled(action('Stop'))).toBe(false);
    expect(reasonOf(action('Start'))).toBe('Only a stopped DB instance can be started.');

    const calls = vi.mocked(api.listInstances).mock.calls.length;
    fireEvent.click(action('Refresh'));
    await waitFor(() => {
      expect(vi.mocked(api.listInstances).mock.calls.length).toBe(calls + 1);
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(screen.getByRole('radio', { name: 'app-db' })).toBeChecked();
    expect(isDisabled(action('Stop'))).toBe(false);
  });

  for (const [name, status, operation, result] of [
    ['Start', 'stopped', 'start', 'Starting app-db'],
    ['Stop', 'available', 'stop', 'Stopping app-db'],
    ['Reboot', 'available', 'reboot', 'Rebooting app-db'],
  ] as const) {
    it(`"${name}" on the selected row → sent with its identifier, "${result}" as a success; in flight the four unavailable`, async () => {
      answer({ '': { instances: [instance('app-db', status)] } });
      let settle: (() => void) | undefined;
      vi.mocked(api.actOnInstance).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      );
      open();
      await waitFor(() => {
        expect(rows()).toHaveLength(1);
      });
      selectRow('app-db');
      fireEvent.click(action(name));
      await waitFor(() => {
        expect(api.actOnInstance).toHaveBeenCalledTimes(1);
      });
      expect(vi.mocked(api.actOnInstance).mock.calls[0]?.slice(1, 3)).toEqual([operation, 'app-db']);
      for (const control of ['Start', 'Stop', 'Reboot', 'Delete']) {
        expect(isDisabled(action(control)), control).toBe(true);
      }
      fireEvent.click(action(name));
      expect(api.actOnInstance).toHaveBeenCalledTimes(1);
      act(() => {
        settle?.();
      });
      await waitFor(() => {
        expect(flashes('success')).toEqual([result]);
      });
    });
  }

  it('"Delete" confirmed → the delete is sent, "Deleting {id}" shown on this page and the list read again', async () => {
    answer({ '': { instances: [instance('app-db', 'available')] } });
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    const router = open();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    selectRow('app-db');
    const calls = vi.mocked(api.listInstances).mock.calls.length;
    answer({});
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(flashes('success')).toEqual(['Deleting app-db']);
    });
    expect(vi.mocked(api.actOnInstance).mock.calls[0]?.slice(1, 3)).toEqual(['delete', 'app-db']);
    expect(vi.mocked(api.listInstances).mock.calls.length).toBeGreaterThan(calls);
    expect(router.state.location.pathname).toBe('/aws/rds');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  for (const [name, status, operation] of [
    ['Start', 'stopped', 'StartDBInstance'],
    ['Stop', 'available', 'StopDBInstance'],
    ['Reboot', 'available', 'RebootDBInstance'],
    ['Delete', 'available', 'DeleteDBInstance'],
  ] as const) {
    it(`a refusal of "${name}" → the emulator's code and message in the flash, the dialog closed, the row as it was; a 501 → not implemented`, async () => {
      answer({ '': { instances: [instance('app-db', status)] } });
      vi.mocked(api.actOnInstance).mockRejectedValue(
        new RequestError({
          kind: 'other',
          operation,
          code: 'InvalidDBInstanceState',
          message: 'Instance app-db is not in available state.',
        }),
      );
      open();
      await waitFor(() => {
        expect(rows()).toHaveLength(1);
      });
      selectRow('app-db');
      const press = async () => {
        fireEvent.click(action(name));
        if (name === 'Delete') {
          await confirmDelete();
        }
      };
      await press();
      await waitFor(() => {
        expect(flashes('error')).toHaveLength(1);
      });
      expect(flashes('error')[0]).toContain('InvalidDBInstanceState');
      expect(flashes('error')[0]).toContain('Instance app-db is not in available state.');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(rows()[0]?.[1]).toBe(status);

      vi.mocked(api.actOnInstance).mockRejectedValue(new RequestError({ kind: 'not-implemented', operation }));
      await waitFor(() => {
        expect(isDisabled(action(name))).toBe(false);
      });
      await press();
      await waitFor(() => {
        expect(flashes().join(' ')).toMatch(new RegExp(`Not implemented by the emulator.*${operation}`));
      });
    });
  }

  it('"Create DB instance" leads to the create address; the notice names "DB instances"', async () => {
    answer({ '': { instances: [instance('app-db', 'available')] } });
    const router = open();
    expect(await screen.findByText('These DB instances are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /DB instances/ })).toBeInTheDocument();
    fireEvent.click(within(table().getElement()).getByRole('link', { name: 'Create DB instance' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances/create');
    });
  });

  it('after an action, the reads that follow answering the later one first → the screen settles on the newest', async () => {
    const reads: { resolve: (page: api.InstancePage) => void }[] = [];
    vi.mocked(api.listInstances).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ instances: [instance('app-db', 'available')] });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    selectRow('app-db');
    fireEvent.click(action('Reboot'));
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await waitFor(() => {
      expect(isDisabled(action('Reboot'))).toBe(false);
    });
    fireEvent.click(action('Reboot'));
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve({ instances: [instance('app-db', 'available', { port: 2 })] });
    });
    await waitFor(() => {
      expect(rows()[0]?.[5]).toBe('2');
    });
    act(() => {
      reads[1]?.resolve({ instances: [instance('app-db', 'rebooting', { port: 1 })] });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(rows()[0]?.[1]).toBe('available');
    expect(rows()[0]?.[5]).toBe('2');
  });

  for (const order of ['before', 'after'] as const) {
    it(`after a delete, the list answering without the instance ${order} the delete's result → "Deleting {id}" shown`, async () => {
      const reads: { resolve: (page: api.InstancePage) => void }[] = [];
      vi.mocked(api.listInstances).mockImplementation(
        () =>
          new Promise((resolve) => {
            reads.push({ resolve });
          }),
      );
      let settle: (() => void) | undefined;
      vi.mocked(api.actOnInstance).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      );
      open();
      await waitFor(() => {
        expect(reads).toHaveLength(1);
      });
      act(() => {
        reads[0]?.resolve({ instances: [instance('app-db', 'available'), instance('other', 'available')] });
      });
      await waitFor(() => {
        expect(rows()).toHaveLength(2);
      });
      selectRow('app-db');
      fireEvent.click(action('Delete'));
      await confirmDelete();
      await waitFor(() => {
        expect(api.actOnInstance).toHaveBeenCalledTimes(1);
      });
      if (order === 'before') {
        // Another read (the 3-second one, a refresh) answers without the instance while the delete is in flight.
        fireEvent.click(action('Refresh'));
        await waitFor(() => {
          expect(reads).toHaveLength(2);
        });
        act(() => {
          reads[1]?.resolve({ instances: [instance('other', 'available')] });
        });
        await waitFor(() => {
          expect(rows()).toHaveLength(1);
        });
      }
      act(() => {
        settle?.();
      });
      if (order === 'after') {
        await waitFor(() => {
          expect(reads.length).toBeGreaterThan(1);
        });
        act(() => {
          reads[reads.length - 1]?.resolve({ instances: [instance('other', 'available')] });
        });
        await waitFor(() => {
          expect(rows()).toHaveLength(1);
        });
      }
      await waitFor(() => {
        expect(flashes('success')).toEqual(['Deleting app-db']);
      });
    });
  }
});
