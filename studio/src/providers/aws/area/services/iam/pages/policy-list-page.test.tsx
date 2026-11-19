import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import type { IamFailure, PageRequest, Policy, PolicyRead, PolicyScope } from '../api';

// Test criteria, "Unit s5 — providers/aws/area/services/iam/pages/policy-list-page.test.tsx" (issue 535). The page is
// rendered inside the area's layout, as Studio's frame renders it, with IAM's calls answered by the case.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listPolicies: vi.fn(), getPolicy: vi.fn(), deletePolicy: vi.fn() };
});

const listPolicies = vi.mocked(api.listPolicies);
const getPolicy = vi.mocked(api.getPolicy);
const deletePolicy = vi.mocked(api.deletePolicy);

const ACCOUNT = '000000000000';

function local(name: string, attachmentCount = 0): Policy {
  return {
    name,
    arn: `arn:aws:iam::${ACCOUNT}:policy/${name}`,
    type: 'Customer managed',
    attachmentCount,
    updateDate: new Date('2026-11-18T10:20:30Z'),
  };
}

function awsManaged(name: string): Policy {
  return { name, arn: `arn:aws:iam::aws:policy/${name}`, type: 'AWS managed', attachmentCount: 0 };
}

/** The policies each scope holds, in the emulator's order; the marker is the index of the next one. */
let held: Record<PolicyScope, Policy[]>;

function answerFromHeld() {
  listPolicies.mockImplementation((_endpoint: string, page: PageRequest, _signal: AbortSignal, scope?: PolicyScope) => {
    const all = held[scope ?? 'All'].filter((policy) =>
      page.filter === undefined ? true : policy.name.toLowerCase().includes(page.filter.toLowerCase()),
    );
    const from = Number(page.from?.marker ?? '0');
    const items = all.slice(from, from + page.pageSize);
    const next = from + page.pageSize < all.length ? { marker: String(from + page.pageSize) } : undefined;
    return Promise.resolve(next === undefined ? { policies: items } : { policies: items, next });
  });
}

function refuse(failure: IamFailure) {
  listPolicies.mockImplementation(() => Promise.reject(new api.IamError(failure)));
}

const EMULATOR_PORT = 9313;
const EMULATOR_ENDPOINT = `https://127.0.0.1:${String(EMULATOR_PORT)}`;

function connectedResult(): CheckResult {
  return { kind: 'connected', checkedAt: Date.now(), emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT } };
}

let nextPort = 9150;
let connection: AreaConnection;

function Area() {
  const { pathname } = useLocation();
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={pathname.length}
      connection={connection}
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
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('no network in this test')));
  vi.stubGlobal('matchMedia', matchMedia);
  nextPort += 1;
  connection = { result: connectedResult(), engineOrigin: engineEndpoint(nextPort) };
  held = {
    Local: [local('p-alpha', 1), local('p-beta')],
    AWS: [awsManaged('AWSLambdaBasicExecutionRole'), awsManaged('ReadOnlyAccess')],
    All: [],
  };
  held.All = [...held.Local, ...held.AWS];
  listPolicies.mockReset();
  getPolicy.mockReset();
  deletePolicy.mockReset();
  answerFromHeld();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = '/aws/iam/policies') {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

function rows(): string[][] {
  return (table().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .slice(1)
      .map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
}

async function expectNames(names: string[]) {
  await waitFor(() => {
    expect(rows().map((row) => row[0])).toEqual(names);
  });
}

function scopeSelect() {
  const select = PAGE.findSelect();
  expect(select).not.toBeNull();
  return select as NonNullable<typeof select>;
}

const SCOPE_VALUES: Record<string, PolicyScope> = {
  'Customer managed': 'Local',
  'AWS managed': 'AWS',
  'All types': 'All',
};

function chooseScope(label: string) {
  const select = scopeSelect();
  act(() => {
    select.openDropdown();
  });
  act(() => {
    select.selectOptionByValue(SCOPE_VALUES[label] ?? label);
  });
}

function scopes(): (PolicyScope | undefined)[] {
  return listPolicies.mock.calls.map((call) => call[3]);
}

/** What the page's polite announcements say. */
function announced(): string[] {
  return [...document.querySelectorAll('.aws-area-announcer')].map((region) => region.textContent ?? '');
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

function emptySlot(): HTMLElement {
  const slot = table().findEmptySlot();
  expect(slot).not.toBeNull();
  return slot?.getElement() as HTMLElement;
}

function filter(text: string) {
  const input = PAGE.findTextFilter()?.findInput();
  expect(input).toBeDefined();
  act(() => {
    input?.setInputValue(text);
  });
  fireEvent.keyDown(input?.getElement() as HTMLElement, { key: 'Enter' });
}

function selectRow(name: string) {
  const index = rows().findIndex((row) => row[0] === name);
  expect(index).toBeGreaterThanOrEqual(0);
  act(() => {
    table()
      .findRowSelectionArea(index + 1)
      ?.click();
  });
}

function found(policy: Policy, entities: { kind: 'role' | 'user' | 'group'; name: string }[] = []): PolicyRead {
  return {
    kind: 'found',
    policy: { name: policy.name, arn: policy.arn, type: policy.type, defaultVersionId: 'v1' },
    versions: { kind: 'read', items: [{ id: 'v1', isDefault: true }] },
    entities: { kind: 'read', items: entities },
  };
}

describe('the policy list', () => {
  it('opens on "Customer managed" and shows the columns name (a link to its page), type, attached entities and last change', async () => {
    open();

    expect(await screen.findByRole('heading', { level: 1, name: /Policies/ }, { timeout: 10_000 })).toBeTruthy();
    await expectNames(['p-alpha', 'p-beta']);
    expect(scopes()).toEqual(['Local']);
    expect(scopeSelect().findTrigger().getElement().textContent).toContain('Customer managed');
    const headers = (table().findColumnHeaders() ?? []).map((header) => header.getElement().textContent?.trim());
    expect(headers.slice(-4)).toEqual(['Policy name', 'Type', 'Attached entities', 'Last changed']);
    expect(rows()[0]).toEqual(['p-alpha', 'Customer managed', '1', '2026-11-18 10:20:30 UTC']);
    expect(rows()[1]?.[2]).toBe('0');
    const link = within(table().getElement()).getByRole('link', { name: 'p-alpha' });
    expect(link).toHaveAttribute(
      'href',
      `/aws/iam/policies/details?arn=${encodeURIComponent(`arn:aws:iam::${ACCOUNT}:policy/p-alpha`)}`,
    );
  });

  it('asks for the scope of each choice of "Policy type" and starts at its first page', async () => {
    held.AWS = Array.from({ length: 25 }, (_, index) => awsManaged(`Aws${String(index).padStart(2, '0')}`));
    open();
    await expectNames(['p-alpha', 'p-beta']);

    chooseScope('AWS managed');
    await waitFor(() => {
      expect(rows()).toHaveLength(20);
    });
    expect(rows()[0]?.[1]).toBe('AWS managed');
    act(() => {
      PAGE.findPagination()?.findNextPageButton().click();
    });
    await expectNames(['Aws20', 'Aws21', 'Aws22', 'Aws23', 'Aws24']);
    expect(listPolicies.mock.calls.at(-1)?.[1].from).toEqual({ marker: '20' });

    chooseScope('All types');
    await waitFor(() => {
      expect(scopes().at(-1)).toBe('All');
    });
    expect(listPolicies.mock.calls.at(-1)?.[1].from).toBeUndefined();
    expect(PAGE.findPagination()?.findCurrentPage().getElement().textContent).toBe('1');

    chooseScope('Customer managed');
    await waitFor(() => {
      expect(scopes().at(-1)).toBe('Local');
    });
    await expectNames(['p-alpha', 'p-beta']);
  });

  it('filters by part of a name, as the role list does', async () => {
    open();
    await expectNames(['p-alpha', 'p-beta']);

    filter('alp');
    await expectNames(['p-alpha']);
    expect(listPolicies.mock.calls.at(-1)?.[1].filter).toBe('alp');
    expect(PAGE.findTextFilter()?.findResultsCount()?.getElement().textContent).toBe('1 match');
  });

  it('pages by the marker, as the role list does', async () => {
    held.Local = Array.from({ length: 23 }, (_, index) => local(`p-${String(index).padStart(2, '0')}`));
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(20);
    });
    act(() => {
      PAGE.findPagination()?.findNextPageButton().click();
    });
    await expectNames(['p-20', 'p-21', 'p-22']);
    act(() => {
      PAGE.findPagination()?.findPreviousPageButton().click();
    });
    await waitFor(() => {
      expect(rows()[0]?.[0]).toBe('p-00');
    });
  });

  it('reads again on "Refresh policies" and reports "Policies refreshed"', async () => {
    open();
    await expectNames(['p-alpha', 'p-beta']);
    held.Local = [...held.Local, local('p-late')];

    fireEvent.click(button('Refresh policies'));
    await expectNames(['p-alpha', 'p-beta', 'p-late']);
    await waitFor(() => {
      expect(announced()).toContain('Policies refreshed');
    });
  });

  it('says "No customer managed policies" with its sentence and "Create policy" when the emulator holds none', async () => {
    held.Local = [];
    const router = open();

    await waitFor(() => {
      expect(emptySlot().textContent).toContain('No customer managed policies');
    });
    expect(emptySlot().textContent).toContain(
      'This emulator holds no customer managed policies. It starts without any each time it restarts. Create one here, or with any tool pointed at the emulator.',
    );
    fireEvent.click(within(emptySlot()).getByRole('button', { name: 'Create policy' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/iam/policies/create');
    });
  });

  it('shows the role list’s no-match state when no name matches', async () => {
    open();
    await expectNames(['p-alpha', 'p-beta']);

    filter('zzz');
    await waitFor(() => {
      expect(emptySlot().textContent).toContain('No matches');
    });
    expect(emptySlot().textContent).toContain('No policy name contains “zzz”.');
    fireEvent.click(within(emptySlot()).getByRole('button', { name: 'Clear filter' }));
    await expectNames(['p-alpha', 'p-beta']);
  });

  it('says "Loading policies" while the list is read', async () => {
    listPolicies.mockImplementation(() => new Promise(() => undefined));
    open();

    await waitFor(() => {
      expect(table().findLoadingText()?.getElement().textContent).toBe('Loading policies');
    });
  });

  it.each<[string, IamFailure, string]>([
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'ListPolicies' },
      'The emulator answered 501 Not Implemented for ListPolicies, so Studio cannot show the policy list.',
    ],
    [
      'access denied',
      { kind: 'access-denied', operation: 'ListPolicies', message: 'not allowed' },
      'ListPolicies was refused: not allowed',
    ],
    [
      'the emulator did not answer',
      { kind: 'emulator-did-not-answer', operation: 'ListPolicies', message: 'timed out' },
      'The emulator did not answer',
    ],
    ['the engine did not answer', { kind: 'engine-did-not-answer', operation: 'ListPolicies' }, 'did not answer'],
    [
      'any other failure',
      { kind: 'other', operation: 'ListPolicies', code: 'ServiceFailure', message: 'broken' },
      'The policy list could not be read',
    ],
  ])('shows %s with its retry', async (_name, failure, text) => {
    refuse(failure);
    open();

    await waitFor(() => {
      expect(emptySlot().textContent).toContain(text);
    });
    answerFromHeld();
    fireEvent.click(within(emptySlot()).getByRole('button', { name: 'Retry' }));
    await expectNames(['p-alpha', 'p-beta']);
  });

  it('shows the connection’s state when the emulator is not started, with its retry', async () => {
    connection = {
      ...connection,
      result: {
        kind: 'emulator-unreachable',
        checkedAt: Date.now(),
        emulator: { port: EMULATOR_PORT, endpoint: EMULATOR_ENDPOINT },
        reason: 'not_started',
        message: '',
      },
    };
    refuse({ kind: 'engine-did-not-answer', operation: 'ListPolicies' });
    open();

    await waitFor(() => {
      expect(emptySlot().textContent).toContain(`Not started on port ${String(EMULATOR_PORT)}`);
    });
    expect(emptySlot().textContent).toContain('The policy list could not be read.');
    expect(within(emptySlot()).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps "Delete" unavailable with no row chosen, and for an AWS managed policy with its reason', async () => {
    open();
    await expectNames(['p-alpha', 'p-beta']);
    expect(button('Delete')).toHaveAttribute('aria-disabled', 'true');

    chooseScope('AWS managed');
    await expectNames(['AWSLambdaBasicExecutionRole', 'ReadOnlyAccess']);
    selectRow('AWSLambdaBasicExecutionRole');
    await waitFor(() => {
      expect(button('Delete')).toHaveAttribute('aria-disabled', 'true');
    });
    fireEvent.focus(button('Delete'));
    expect((await screen.findAllByText('An AWS managed policy cannot be deleted.')).length).toBeGreaterThan(0);
    fireEvent.click(button('Delete'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the delete dialog for a customer managed policy; a success reads the list again and reports it', async () => {
    const alpha = held.Local[0] as Policy;
    getPolicy.mockResolvedValue(found(alpha, [{ kind: 'role', name: 'p-r' }]));
    deletePolicy.mockImplementation(() => {
      held.Local = held.Local.filter((policy) => policy.name !== 'p-alpha');
      return Promise.resolve({ kind: 'deleted', detachedRoles: ['p-r'] });
    });
    open();
    await expectNames(['p-alpha', 'p-beta']);

    selectRow('p-alpha');
    fireEvent.click(button('Delete'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete p-alpha?')).toBeTruthy();
    await waitFor(() => {
      expect(dialog.textContent).toContain('It is first detached from 1 entity: p-r (Role).');
    });
    const reads = listPolicies.mock.calls.length;

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Policy p-alpha deleted.')).toBeTruthy();
    expect(deletePolicy).toHaveBeenCalledTimes(1);
    expect(deletePolicy.mock.calls[0]?.[1]).toBe(alpha.arn);
    await expectNames(['p-beta']);
    expect(listPolicies.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names "policies" for the local-emulator notice', async () => {
    open();
    await expectNames(['p-alpha', 'p-beta']);

    expect(document.body.textContent).toContain('These policies are in your local emulator');
  });
});
