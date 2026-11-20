import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import * as changes from '../gateway-changes-api';

// S12 rendered inside the area's layout, with the calls of `api.ts` and `gateway-changes-api.ts` answered by the
// case (`api.test.ts` and `gateway-changes-api.test.ts` prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listInternetGateways: vi.fn() };
});

vi.mock('../gateway-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gateway-changes-api')>();
  return { ...real, detachInternetGateway: vi.fn(), deleteInternetGateway: vi.fn() };
});

// TanStack Query hands its notifications to React on a 0 ms timer; here it notifies in a microtask, as
// `src/test/home-test-kit.tsx` does, so `settled()` below comes after every notification by order alone.
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

const EMULATOR = { port: 9574, endpoint: 'https://127.0.0.1:9574' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8574';

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

function open(path = '/aws/vpc/internet-gateways') {
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
// Gateways and readers.

function gateway(id: string, name: string | undefined, vpcId?: string): api.InternetGateway {
  return {
    id,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
    ...(vpcId === undefined ? {} : { vpcId }),
  };
}

/** `listInternetGateways` answering each request from `pages`, by its name and its token (`''` for none). */
function answer(pages: Record<string, api.Page<api.InternetGateway>>) {
  vi.mocked(api.listInternetGateways).mockImplementation((_endpoint, filters, token) =>
    Promise.resolve(pages[`${filters.name ?? ''}|${token ?? ''}`] ?? { items: [] }),
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

function action(name: string): HTMLElement {
  const header = table().findHeaderSlot()?.getElement() as HTMLElement;
  const found = within(header).queryByRole('button', { name }) ?? within(header).queryByRole('link', { name });
  expect(found, name).not.toBeNull();
  return found as HTMLElement;
}

function isDisabled(element: Element): boolean {
  return (
    (element as HTMLButtonElement).disabled ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.querySelector('[aria-disabled="true"]') !== null
  );
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

const lastCall = () => vi.mocked(api.listInternetGateways).mock.calls.at(-1);

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

async function confirmDelete() {
  const shown = await dialog();
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

async function confirmDetach() {
  const shown = await dialog();
  fireEvent.click(within(shown).getByRole('button', { name: 'Detach' }));
}

const EDGE = gateway('igw-a', 'edge', 'vpc-a');
const SPARE = gateway('igw-s', undefined);
const EDGE_ROW = ['edge', 'igw-a', 'Attached', 'vpc-a'];
const SPARE_ROW = ['-', 'igw-s', 'Detached', '-'];

/** Lets every answer already given settle (order, not time; see EC2's list test). */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('the internet gateway list', () => {
  it('a row per gateway with name, internet gateway ID, "Attached" or "Detached", and the VPC ID (to the VPC) or "-"', async () => {
    answer({ '|': { items: [EDGE, SPARE] } });
    const router = open();
    await expectRows([EDGE_ROW, SPARE_ROW]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'Name',
      'Internet gateway ID',
      'State',
      'VPC ID',
    ]);
    const link = screen.getByRole('link', { name: 'vpc-a' });
    expect(link).toHaveAttribute('href', '/aws/vpc/vpcs/vpc/vpc-a');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/vpcs/vpc/vpc-a');
    });
  });

  it('none, no filter → "No internet gateways" / "The emulator holds no internet gateway." with "Create internet gateway"', async () => {
    answer({});
    const router = open();
    expect(await screen.findByText('No internet gateways')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no internet gateway.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Create internet gateway' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/internet-gateways/create');
    });
  });

  it('none with a filter → "No internet gateways match" with "Clear filter", which empties it', async () => {
    answer({ '|': { items: [EDGE] } });
    open();
    await expectRows([EDGE_ROW]);
    PAGE.findTextFilter()?.findInput().setInputValue('zzz');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'zzz' }, undefined]);
    });
    expect(await screen.findByText('No internet gateways match')).toBeInTheDocument();
    expect(screen.queryByText('No internet gateways')).toBeNull();
    fireEvent.click(
      within(table().findEmptySlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Clear filter' }),
    );
    await expectRows([EDGE_ROW]);
    expect(lastCall()?.slice(1, 3)).toEqual([{}, undefined]);
    expect(PAGE.findTextFilter()?.findInput().getInputValue()).toBe('');
  });

  it("the table's description is the name filter's", async () => {
    answer({ '|': { items: [EDGE] } });
    open();
    expect(await screen.findByText('The name filter matches the Name tag and is case-sensitive.')).toBeInTheDocument();
    expect(PAGE.findTextFilter()?.findInput().findNativeInput().getElement()).toHaveAttribute(
      'placeholder',
      'Find by name',
    );
  });

  it('loading → "Loading internet gateways"', async () => {
    vi.mocked(api.listInternetGateways).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading internet gateways')).toBeInTheDocument();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeInternetGateways' },
      /Not implemented by the emulator.*DescribeInternetGateways/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeInternetGateways', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeInternetGateways', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeInternetGateways' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeInternetGateways', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeInternetGateways', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.listInternetGateways).mockRejectedValue(new RequestError(failure));
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listInternetGateways).mock.calls.length;
      answer({ '|': { items: [EDGE] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([EDGE_ROW]);
      expect(vi.mocked(api.listInternetGateways).mock.calls.length).toBe(calls + 1);
    });
  }

  it('a text in "Find by name" → asked from the first page; the next page asks with the token', async () => {
    answer({
      '|': { items: [EDGE], nextToken: 'tok-1' },
      'ed|': { items: [EDGE], nextToken: 'tok-ed' },
      'ed|tok-ed': { items: [gateway('igw-b', 'edge-2')] },
    });
    open();
    await expectRows([EDGE_ROW]);
    PAGE.findTextFilter()?.findInput().setInputValue('ed');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'ed' }, undefined]);
    });
    await expectRows([EDGE_ROW]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([['edge-2', 'igw-b', 'Detached', '-']]);
    expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'ed' }, 'tok-ed']);
  });

  it('"Refresh" reads the page again', async () => {
    answer({ '|': { items: [EDGE] } });
    open();
    await expectRows([EDGE_ROW]);
    const calls = vi.mocked(api.listInternetGateways).mock.calls.length;
    answer({ '|': { items: [EDGE, SPARE] } });
    fireEvent.click(action('Refresh'));
    await expectRows([EDGE_ROW, SPARE_ROW]);
    expect(vi.mocked(api.listInternetGateways).mock.calls.length).toBe(calls + 1);
  });

  it('no row selected → "Attach", "Detach", "Delete" unavailable with "Select one internet gateway."; attached → "Attach" and "Delete" unavailable with their reasons; detached → "Detach" unavailable', async () => {
    answer({ '|': { items: [EDGE, SPARE] } });
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    for (const name of ['Attach', 'Detach', 'Delete']) {
      expect(isDisabled(action(name)), name).toBe(true);
      expect(reasonOf(action(name)), name).toBe('Select one internet gateway.');
    }
    selectRow('edge');
    expect(isDisabled(action('Attach'))).toBe(true);
    expect(reasonOf(action('Attach'))).toBe('This gateway is already attached.');
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toBe('Detach the gateway before deleting it.');
    expect(isDisabled(action('Detach'))).toBe(false);
    selectRow('igw-s');
    expect(isDisabled(action('Detach'))).toBe(true);
    expect(reasonOf(action('Detach'))).toBe('This gateway is not attached.');
    expect(isDisabled(action('Attach'))).toBe(false);
    expect(isDisabled(action('Delete'))).toBe(false);
  });

  it('"Attach" leads to the selected gateway\'s attach address; "Create internet gateway" to the create address', async () => {
    answer({ '|': { items: [EDGE, SPARE] } });
    const router = open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('igw-s');
    fireEvent.click(action('Attach'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/internet-gateways/gateway/igw-s/attach');
    });
    await act(async () => {
      await router.navigate('/aws/vpc/internet-gateways');
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(action('Create internet gateway'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/internet-gateways/create');
    });
  });

  it('"Detach" → "Detach internet gateway?" naming the gateway and its VPC; confirmed → sent with both IDs, "Detached {id} from {vpc id}" and the list read again', async () => {
    answer({ '|': { items: [EDGE, SPARE] } });
    vi.mocked(changes.detachInternetGateway).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('edge');
    fireEvent.click(action('Detach'));
    const shown = await dialog();
    expect(text(shown)).toContain('Detach internet gateway?');
    expect(text(shown)).toContain(
      'edge is detached from vpc-a. Routes that lead to it stay in their route tables and turn to blackhole.',
    );
    const calls = vi.mocked(api.listInternetGateways).mock.calls.length;
    answer({ '|': { items: [gateway('igw-a', 'edge'), SPARE] } });
    await confirmDetach();
    expect(await screen.findByText('Detached igw-a from vpc-a')).toBeInTheDocument();
    expect(vi.mocked(changes.detachInternetGateway).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'igw-a', 'vpc-a']);
    await expectRows([['edge', 'igw-a', 'Detached', '-'], SPARE_ROW]);
    expect(vi.mocked(api.listInternetGateways).mock.calls.length).toBeGreaterThan(calls);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a failed detach → the failure in the flash, the dialog closed and the row as it was', async () => {
    answer({ '|': { items: [EDGE] } });
    vi.mocked(changes.detachInternetGateway).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DetachInternetGateway',
        code: 'Gateway.NotAttached',
        message: 'resource igw-a is not attached to network vpc-a',
      }),
    );
    open();
    await expectRows([EDGE_ROW]);
    const calls = vi.mocked(api.listInternetGateways).mock.calls.length;
    selectRow('edge');
    fireEvent.click(action('Detach'));
    await confirmDetach();
    expect(await screen.findByText(/Gateway\.NotAttached/)).toBeInTheDocument();
    expect(screen.getByText(/resource igw-a is not attached to network vpc-a/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await settled();
    expect(rows()).toEqual([EDGE_ROW]);
    expect(vi.mocked(api.listInternetGateways).mock.calls.length).toBe(calls);
  });

  it('"Delete" confirmed → deleted, "Deleted internet gateway {name or id}" shown and the list read again', async () => {
    const named = gateway('igw-n', 'old');
    answer({ '|': { items: [named, SPARE] } });
    vi.mocked(changes.deleteInternetGateway).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('old');
    fireEvent.click(action('Delete'));
    const shown = await dialog();
    expect(text(shown)).toContain('Delete internet gateway?');
    expect(text(shown)).toContain('old is deleted from the local emulator. This cannot be undone.');
    const calls = vi.mocked(api.listInternetGateways).mock.calls.length;
    answer({ '|': { items: [SPARE] } });
    await confirmDelete();
    expect(await screen.findByText('Deleted internet gateway old')).toBeInTheDocument();
    expect(vi.mocked(changes.deleteInternetGateway).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'igw-n']);
    await expectRows([SPARE_ROW]);
    expect(vi.mocked(api.listInternetGateways).mock.calls.length).toBeGreaterThan(calls);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    selectRow('igw-s');
    fireEvent.click(action('Delete'));
    answer({});
    await confirmDelete();
    expect(await screen.findByText('Deleted internet gateway igw-s')).toBeInTheDocument();
  });

  it('a refused delete → the dialog stays with the refusal and the row stays', async () => {
    answer({ '|': { items: [SPARE] } });
    vi.mocked(changes.deleteInternetGateway).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteInternetGateway',
        code: 'DependencyViolation',
        message: "The internetGateway 'igw-s' has dependencies and cannot be deleted.",
      }),
    );
    open();
    await expectRows([SPARE_ROW]);
    const calls = vi.mocked(api.listInternetGateways).mock.calls.length;
    selectRow('igw-s');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    const shown = await dialog();
    const alert = await within(shown).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The internetGateway 'igw-s' has dependencies and cannot be deleted.");
    await settled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(rows()).toEqual([SPARE_ROW]);
    expect(vi.mocked(api.listInternetGateways).mock.calls.length).toBe(calls);
    expect(screen.queryByText(/Deleted internet gateway/)).toBeNull();
  });

  it('the page names its resources "internet gateways" to the frame', async () => {
    answer({ '|': { items: [EDGE] } });
    open();
    expect(await screen.findByText('These internet gateways are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Internet gateways/ })).toBeInTheDocument();
  });

  it('after a detach then a delete, the reads that follow answering the later one first → the screen settles on the newest, and the result is still shown', async () => {
    const other = gateway('igw-o', 'other');
    const reads: { resolve: (page: api.Page<api.InternetGateway>) => void }[] = [];
    vi.mocked(api.listInternetGateways).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(changes.detachInternetGateway).mockResolvedValue(undefined);
    vi.mocked(changes.deleteInternetGateway).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ items: [EDGE, other] });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('edge');
    fireEvent.click(action('Detach'));
    await confirmDetach();
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await screen.findByText('Detached igw-a from vpc-a');
    selectRow('other');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    const detached = ['edge', 'igw-a', 'Detached', '-'];
    act(() => {
      reads[2]?.resolve({ items: [gateway('igw-a', 'edge')] });
    });
    await expectRows([detached]);
    act(() => {
      reads[1]?.resolve({ items: [gateway('igw-a', 'edge'), other] });
    });
    await settled();
    expect(rows()).toEqual([detached]);
    expect(screen.getByText('Deleted internet gateway other')).toBeInTheDocument();
  });
});
