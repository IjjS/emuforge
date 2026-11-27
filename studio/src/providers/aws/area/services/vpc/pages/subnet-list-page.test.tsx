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
import * as changes from '../subnet-changes-api';

// S4 rendered inside the area's layout, with the calls of `api.ts` and `subnet-changes-api.ts` answered by the case
// (`api.test.ts` and `subnet-changes-api.test.ts` prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listSubnets: vi.fn() };
});

vi.mock('../subnet-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../subnet-changes-api')>();
  return { ...real, deleteSubnet: vi.fn() };
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

const EMULATOR = { port: 9576, endpoint: 'https://127.0.0.1:9576' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8576';

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

function open(path = '/aws/vpc/subnets') {
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
// Subnets and readers.

function subnet(id: string, name: string | undefined, changes: Partial<api.Subnet> = {}): api.Subnet {
  return {
    id,
    state: 'available',
    vpcId: 'vpc-a',
    cidr: '10.0.1.0/24',
    zone: 'us-east-1a',
    freeAddresses: 251,
    isDefault: false,
    publicAddresses: false,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
    ...changes,
  };
}

/** `listSubnets` answering each request from `pages`, by its name and its token (`''` for none). */
function answer(pages: Record<string, api.Page<api.Subnet>>) {
  vi.mocked(api.listSubnets).mockImplementation((_endpoint, filters, token) =>
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

const lastCall = () => vi.mocked(api.listSubnets).mock.calls.at(-1);

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

async function confirmDelete() {
  const shown = await dialog();
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

const APP = subnet('subnet-a', 'app');
const BARE = subnet('subnet-d', undefined, {
  vpcId: 'vpc-d',
  cidr: '172.31.0.0/20',
  zone: 'us-east-1b',
  freeAddresses: 4091,
});
const APP_ROW = ['app', 'subnet-a', 'vpc-a', '10.0.1.0/24', 'us-east-1a', '251'];
const BARE_ROW = ['-', 'subnet-d', 'vpc-d', '172.31.0.0/20', 'us-east-1b', '4091'];

/** Lets every answer already given settle (order, not time; see EC2's list test). */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('the subnet list', () => {
  it('distinguishes Name tags with repeated spaces in the row, selection control and dialogs', async () => {
    const singleSpace = subnet('subnet-b', 'p664 a b');
    const doubleSpace = subnet('subnet-c', 'p664 a  b');
    const identity = String.raw`p664 a\u0020\u0020b`;
    const drawnName = `p664 a  b (${identity})`;
    const exactText = { normalizer: (value: string) => value };
    answer({ '|': { items: [singleSpace, doubleSpace, BARE] } });
    open();

    const selectedName = await screen.findByRole('radio', { name: identity });
    expect(screen.getByRole('radio', { name: 'p664 a b' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: BARE.id })).toBeInTheDocument();
    expect(rows()).toContainEqual(BARE_ROW);
    const name = screen.getByText('p664 a  b', exactText);
    expect(name.closest('tr')).toBe(selectedName.closest('tr'));
    expect(name.parentElement?.textContent).toBe(drawnName);

    selectRow(identity);
    fireEvent.click(action('Delete'));
    const deletion = await screen.findByRole('dialog', { name: 'Delete subnet?' });
    expect(within(deletion).getByText('p664 a  b', exactText).parentElement?.textContent).toBe(drawnName);
    expect(text(deletion)).toContain('is deleted from the local emulator');
  });

  it('a row per subnet with name, subnet ID (to its page), VPC ID (to the VPC), IPv4 CIDR, Availability Zone and free addresses', async () => {
    answer({ '|': { items: [APP, BARE] } });
    const router = open();
    await expectRows([APP_ROW, BARE_ROW]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'Name',
      'Subnet ID',
      'VPC ID',
      'IPv4 CIDR',
      'Availability Zone',
      'Free IPv4 addresses',
    ]);
    expect(screen.getByRole('link', { name: 'vpc-a' })).toHaveAttribute('href', '/aws/vpc/vpcs/vpc/vpc-a');
    const link = screen.getByRole('link', { name: 'subnet-a' });
    expect(link).toHaveAttribute('href', '/aws/vpc/subnets/subnet/subnet-a');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets/subnet/subnet-a');
    });
  });

  it('none, no filter → "No subnets" / "The emulator holds no subnet." with "Create subnet", which leads to the create address', async () => {
    answer({});
    const router = open();
    expect(await screen.findByText('No subnets')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no subnet.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Create subnet' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets/create');
    });
    expect(router.state.location.search).toBe('');
  });

  it('none with a filter → "No subnets match" with "Clear filter", which empties it', async () => {
    answer({ '|': { items: [APP] } });
    open();
    await expectRows([APP_ROW]);
    PAGE.findTextFilter()?.findInput().setInputValue('zzz');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'zzz' }, undefined]);
    });
    expect(await screen.findByText('No subnets match')).toBeInTheDocument();
    expect(screen.queryByText('No subnets')).toBeNull();
    fireEvent.click(
      within(table().findEmptySlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Clear filter' }),
    );
    await expectRows([APP_ROW]);
    expect(lastCall()?.slice(1, 3)).toEqual([{}, undefined]);
    expect(PAGE.findTextFilter()?.findInput().getInputValue()).toBe('');
  });

  it("the table's description is the name filter's", async () => {
    answer({ '|': { items: [APP] } });
    open();
    expect(await screen.findByText('The name filter matches the Name tag and is case-sensitive.')).toBeInTheDocument();
    expect(PAGE.findTextFilter()?.findInput().findNativeInput().getElement()).toHaveAttribute(
      'placeholder',
      'Find by name',
    );
  });

  it('loading → "Loading subnets"', async () => {
    vi.mocked(api.listSubnets).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading subnets')).toBeInTheDocument();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeSubnets' },
      /Not implemented by the emulator.*DescribeSubnets/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeSubnets', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeSubnets', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeSubnets' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeSubnets', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeSubnets', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.listSubnets).mockRejectedValue(new RequestError(failure));
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listSubnets).mock.calls.length;
      answer({ '|': { items: [APP] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([APP_ROW]);
      expect(vi.mocked(api.listSubnets).mock.calls.length).toBe(calls + 1);
    });
  }

  it('a text in "Find by name" → asked from the first page; the next page asks with the token', async () => {
    answer({
      '|': { items: [APP], nextToken: 'tok-1' },
      'ap|': { items: [APP], nextToken: 'tok-ap' },
      'ap|tok-ap': { items: [subnet('subnet-b', 'apple')] },
    });
    open();
    await expectRows([APP_ROW]);
    PAGE.findTextFilter()?.findInput().setInputValue('ap');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'ap' }, undefined]);
    });
    await expectRows([APP_ROW]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([['apple', 'subnet-b', 'vpc-a', '10.0.1.0/24', 'us-east-1a', '251']]);
    expect(lastCall()?.slice(1, 3)).toEqual([{ name: 'ap' }, 'tok-ap']);
  });

  it('"Refresh" reads the page again', async () => {
    answer({ '|': { items: [APP] } });
    open();
    await expectRows([APP_ROW]);
    const calls = vi.mocked(api.listSubnets).mock.calls.length;
    answer({ '|': { items: [APP, BARE] } });
    fireEvent.click(action('Refresh'));
    await expectRows([APP_ROW, BARE_ROW]);
    expect(vi.mocked(api.listSubnets).mock.calls.length).toBe(calls + 1);
  });

  it('no row selected → "Delete" unavailable with "Select one subnet."', async () => {
    answer({ '|': { items: [APP, BARE] } });
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toBe('Select one subnet.');
    selectRow('app');
    expect(isDisabled(action('Delete'))).toBe(false);
  });

  it('selected and confirmed → deleted, "Deleted subnet {name or id}" shown, the list read again', async () => {
    answer({ '|': { items: [APP, BARE] } });
    vi.mocked(changes.deleteSubnet).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('app');
    fireEvent.click(action('Delete'));
    expect(text(await dialog())).toContain('app is deleted from the local emulator.');
    const calls = vi.mocked(api.listSubnets).mock.calls.length;
    answer({ '|': { items: [BARE] } });
    await confirmDelete();
    expect(await screen.findByText('Deleted subnet app')).toBeInTheDocument();
    expect(vi.mocked(changes.deleteSubnet).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'subnet-a']);
    await expectRows([BARE_ROW]);
    expect(vi.mocked(api.listSubnets).mock.calls.length).toBeGreaterThan(calls);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    selectRow('subnet-d');
    fireEvent.click(action('Delete'));
    answer({});
    await confirmDelete();
    expect(await screen.findByText('Deleted subnet subnet-d')).toBeInTheDocument();
  });

  it('a refusal → the dialog stays with it and the row stays', async () => {
    answer({ '|': { items: [APP] } });
    vi.mocked(changes.deleteSubnet).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteSubnet',
        code: 'DependencyViolation',
        message: "The subnet 'subnet-a' has dependencies and cannot be deleted.",
      }),
    );
    open();
    await expectRows([APP_ROW]);
    const calls = vi.mocked(api.listSubnets).mock.calls.length;
    selectRow('app');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    const shown = await dialog();
    const alert = await within(shown).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The subnet 'subnet-a' has dependencies and cannot be deleted.");
    await settled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(rows()).toEqual([APP_ROW]);
    expect(vi.mocked(api.listSubnets).mock.calls.length).toBe(calls);
    expect(screen.queryByText(/Deleted subnet/)).toBeNull();
  });

  it('"Create subnet" leads to the create address with no VPC; the page names its resources "subnets"', async () => {
    answer({ '|': { items: [APP] } });
    const router = open();
    expect(await screen.findByText('These subnets are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Subnets/ })).toBeInTheDocument();
    fireEvent.click(within(table().getElement()).getByRole('link', { name: 'Create subnet' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/subnets/create');
    });
    expect(router.state.location.search).toBe('');
  });

  it('after a delete, the reads that follow answering the later one first → the screen settles on the newest, without the deleted subnet', async () => {
    const other = subnet('subnet-b', 'api');
    const reads: { resolve: (page: api.Page<api.Subnet>) => void }[] = [];
    vi.mocked(api.listSubnets).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(changes.deleteSubnet).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ items: [APP, other, BARE] });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    selectRow('app');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await screen.findByText('Deleted subnet app');
    selectRow('api');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve({ items: [BARE] });
    });
    await expectRows([BARE_ROW]);
    act(() => {
      reads[1]?.resolve({ items: [other, BARE] });
    });
    await settled();
    expect(rows()).toEqual([BARE_ROW]);
    expect(screen.getByText('Deleted subnet api')).toBeInTheDocument();
  });
});
