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
import * as api from '../group-api';

// S4 rendered inside the area's layout, with the calls of `group-api.ts` answered by the case (`group-api.test.ts`
// proves the calls against a fake engine).

vi.mock('../group-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../group-api')>();
  return {
    ...real,
    listSecurityGroups: vi.fn(),
    getSecurityGroup: vi.fn(),
    listSecurityGroupRules: vi.fn(),
    deleteSecurityGroup: vi.fn(),
    deleteSecurityGroupRule: vi.fn(),
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

const EMULATOR = { port: 9309, endpoint: 'https://127.0.0.1:9309' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8309';

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

function open(path = '/aws/ec2') {
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
// Groups and readers.

function group(id: string, name: string, changes: Partial<api.SecurityGroup> = {}): api.SecurityGroup {
  return { id, name, description: `${name} servers`, vpcId: 'vpc-1', ...changes };
}

/** `listSecurityGroups` answering each request from `pages`, by its name and its token (`''` for none). */
function answer(pages: Record<string, api.GroupPage>) {
  vi.mocked(api.listSecurityGroups).mockImplementation((_endpoint, name, token) =>
    Promise.resolve(pages[`${name}|${token ?? ''}`] ?? { groups: [] }),
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

const lastCall = () => vi.mocked(api.listSecurityGroups).mock.calls.at(-1);

function dialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

async function confirmDelete() {
  const shown = await dialog();
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

const WEB = group('sg-a', 'web');
const DEFAULT = group('sg-d', 'default', { description: 'default VPC security group' });

/**
 * Lets every answer already given settle: React's work, and TanStack Query's notifications, which it batches on a
 * zero-delay timer. A timer set after theirs runs after them, so this waits for order, not for an amount of time.
 */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('the security groups list', () => {
  it("a row per group with name, group ID, VPC ID and description; the name links to the group's page", async () => {
    answer({ '|': { groups: [WEB, DEFAULT, { id: 'sg-x', name: 'bare' }] } });
    const router = open('/aws/ec2/security-groups');
    await expectRows([
      ['web', 'sg-a', 'vpc-1', 'web servers'],
      ['default', 'sg-d', 'vpc-1', 'default VPC security group'],
      ['bare', 'sg-x', '-', '-'],
    ]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'Name',
      'Group ID',
      'VPC ID',
      'Description',
    ]);
    const link = screen.getByRole('link', { name: 'web' });
    expect(link).toHaveAttribute('href', '/aws/ec2/security-groups/group/sg-a');
    vi.mocked(api.getSecurityGroup).mockResolvedValue({ found: false });
    vi.mocked(api.listSecurityGroupRules).mockResolvedValue({ rules: [] });
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups/group/sg-a');
    });
  });

  it('none, no filter → "No security groups" with "Create security group", which leads to the create address', async () => {
    answer({});
    const router = open('/aws/ec2/security-groups');
    expect(await screen.findByText('No security groups')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no security group.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Create security group' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups/create');
    });
  });

  it('none with a filter → "No security groups match" with "Clear filter", which empties it', async () => {
    answer({ '|': { groups: [WEB] } });
    open('/aws/ec2/security-groups');
    await expectRows([['web', 'sg-a', 'vpc-1', 'web servers']]);
    PAGE.findTextFilter()?.findInput().setInputValue('zzz');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual(['zzz', undefined]);
    });
    expect(await screen.findByText('No security groups match')).toBeInTheDocument();
    expect(screen.queryByText('No security groups')).toBeNull();
    fireEvent.click(
      within(table().findEmptySlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Clear filter' }),
    );
    await expectRows([['web', 'sg-a', 'vpc-1', 'web servers']]);
    expect(lastCall()?.slice(1, 3)).toEqual(['', undefined]);
    expect(PAGE.findTextFilter()?.findInput().getInputValue()).toBe('');
  });

  it('a further page that comes back empty → "No more security groups", and the page before can be gone back to', async () => {
    answer({ '|': { groups: [WEB], nextToken: 'tok-last' }, '|tok-last': { groups: [] } });
    open('/aws/ec2/security-groups');
    await expectRows([['web', 'sg-a', 'vpc-1', 'web servers']]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    expect(await screen.findByText('No more security groups')).toBeInTheDocument();
    expect(lastCall()?.slice(1, 3)).toEqual(['', 'tok-last']);
    expect(screen.queryByText('No security groups')).toBeNull();
    fireEvent.click(table().findPagination()?.findPreviousPageButton().getElement() as HTMLElement);
    await expectRows([['web', 'sg-a', 'vpc-1', 'web servers']]);
  });

  it('loading → "Loading security groups"', async () => {
    vi.mocked(api.listSecurityGroups).mockImplementation(() => new Promise(() => undefined));
    open('/aws/ec2/security-groups');
    expect(await screen.findByText('Loading security groups')).toBeInTheDocument();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeSecurityGroups' },
      /Not implemented by the emulator.*DescribeSecurityGroups/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeSecurityGroups', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeSecurityGroups', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeSecurityGroups' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeSecurityGroups', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeSecurityGroups', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.listSecurityGroups).mockRejectedValue(new RequestError(failure));
      open('/aws/ec2/security-groups');
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listSecurityGroups).mock.calls.length;
      answer({ '|': { groups: [WEB] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([['web', 'sg-a', 'vpc-1', 'web servers']]);
      expect(vi.mocked(api.listSecurityGroups).mock.calls.length).toBe(calls + 1);
    });
  }

  it('no row selected → "Delete" unavailable with "Select one security group."; default selected → its reason', async () => {
    answer({ '|': { groups: [WEB, DEFAULT] } });
    open('/aws/ec2/security-groups');
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toBe('Select one security group.');
    selectRow('default');
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toBe('The default security group cannot be deleted.');
    selectRow('web');
    expect(isDisabled(action('Delete'))).toBe(false);
  });

  it('"Delete" confirmed → the group is deleted, "Deleted security group {name}" is shown and the list read again', async () => {
    answer({ '|': { groups: [WEB, DEFAULT] } });
    vi.mocked(api.deleteSecurityGroup).mockResolvedValue(undefined);
    open('/aws/ec2/security-groups');
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('web');
    fireEvent.click(action('Delete'));
    expect(text(await dialog())).toContain('web is deleted from the local emulator.');
    const calls = vi.mocked(api.listSecurityGroups).mock.calls.length;
    answer({ '|': { groups: [DEFAULT] } });
    await confirmDelete();
    expect(await screen.findByText('Deleted security group web')).toBeInTheDocument();
    expect(vi.mocked(api.deleteSecurityGroup).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'sg-a']);
    await expectRows([['default', 'sg-d', 'vpc-1', 'default VPC security group']]);
    expect(vi.mocked(api.listSecurityGroups).mock.calls.length).toBeGreaterThan(calls);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('the page names its resources "security groups" to the frame', async () => {
    answer({ '|': { groups: [WEB] } });
    open('/aws/ec2/security-groups');
    expect(await screen.findByText('These security groups are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Security groups/ })).toBeInTheDocument();
  });

  it('after a delete, the reads that follow answering the later one first → the screen settles on the newest, without the deleted group', async () => {
    const other = group('sg-b', 'api');
    const reads: { resolve: (page: api.GroupPage) => void }[] = [];
    vi.mocked(api.listSecurityGroups).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(api.deleteSecurityGroup).mockResolvedValue(undefined);
    open('/aws/ec2/security-groups');
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ groups: [WEB, other, DEFAULT] });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    selectRow('web');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await screen.findByText('Deleted security group web');
    selectRow('api');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve({ groups: [DEFAULT] });
    });
    await expectRows([['default', 'sg-d', 'vpc-1', 'default VPC security group']]);
    act(() => {
      reads[1]?.resolve({ groups: [other, DEFAULT] });
    });
    await settled();
    expect(rows()).toEqual([['default', 'sg-d', 'vpc-1', 'default VPC security group']]);
  });
});
