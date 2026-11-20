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
import * as api from '../group-api';

// S6 rendered inside the area's layout, with the calls of `group-api.ts` answered by the case (`group-api.test.ts`
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

// ---------------------------------------------------------------------------------------------------------------
// A group, its rules and readers.

const GROUP: api.SecurityGroup = {
  id: 'sg-a',
  name: 'web',
  description: 'Web servers',
  vpcId: 'vpc-1',
  arn: 'arn:aws:ec2:us-east-1:000000000000:security-group/sg-a',
};

const IN_RANGE: api.SecurityGroupRule = {
  id: 'sgr-1',
  egress: false,
  protocol: 'tcp',
  fromPort: 8000,
  toPort: 8100,
  peer: { kind: 'ipv4', value: '10.1.0.0/16' },
  description: 'api',
};
const IN_GROUP: api.SecurityGroupRule = {
  id: 'sgr-2',
  egress: false,
  protocol: '-1',
  fromPort: -1,
  toPort: -1,
  peer: { kind: 'group', value: 'sg-b' },
};
const OUT_ALL: api.SecurityGroupRule = {
  id: 'sgr-3',
  egress: true,
  protocol: '-1',
  fromPort: -1,
  toPort: -1,
  peer: { kind: 'ipv4', value: '0.0.0.0/0' },
};

const ROW_RANGE = ['Inbound', 'TCP', '8000 - 8100', '10.1.0.0/16', 'api', 'sgr-1'];
const ROW_GROUP = ['Inbound', 'All', 'All', 'sg-b', '-', 'sgr-2'];
const ROW_OUT = ['Outbound', 'All', 'All', '0.0.0.0/0', '-', 'sgr-3'];

const PATH = '/aws/ec2/security-groups/group/sg-a';

function groupIs(read: api.GroupRead) {
  vi.mocked(api.getSecurityGroup).mockResolvedValue(read);
}

/** `listSecurityGroupRules` answering each request from `pages`, by its group and token (`''` for none). */
function rulesAre(pages: Record<string, api.RulePage>) {
  vi.mocked(api.listSecurityGroupRules).mockImplementation((_endpoint, groupId, token) =>
    Promise.resolve(pages[`${groupId}|${token ?? ''}`] ?? { rules: [] }),
  );
}

function headerDelete(): HTMLElement {
  return screen.getByRole('button', { name: 'Delete group' });
}

/** The rules' "Delete". */
function ruleDelete(): HTMLElement {
  return action('Delete rule');
}

async function confirmDelete() {
  const shown = await screen.findByRole('dialog');
  fireEvent.change(within(shown).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(shown).getByRole('button', { name: 'Delete' }));
}

beforeEach(() => {
  vi.mocked(api.listSecurityGroups).mockResolvedValue({ groups: [] });
});

/**
 * Lets every answer already given settle. TanStack Query here notifies in a microtask (the scheduler set above), so an
 * answer's whole chain (its read, the query's data, the notification, React's render) runs in microtasks; a timer
 * runs only once no microtask is left, so by then every such chain has reached the screen. Order, not time.
 */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe("a security group's page", () => {
  it('a group → its name as the heading; the details with copy controls for the group ID and the ARN', async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({});
    open(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: 'web' })).toBeInTheDocument();
    const pairs = PAGE.findKeyValuePairs();
    expect(pairs).not.toBeNull();
    const items = (pairs?.findItems() ?? []).map((item) => [
      text(item.findLabel()?.getElement() as HTMLElement),
      text(item.findValue()?.getElement() as HTMLElement),
    ]);
    expect(items).toEqual([
      ['Group ID', 'sg-a'],
      ['Name', 'web'],
      ['Description', 'Web servers'],
      ['VPC ID', 'vpc-1'],
      ['ARN', 'arn:aws:ec2:us-east-1:000000000000:security-group/sg-a'],
    ]);
    expect(screen.getByRole('button', { name: 'Copy Group ID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeInTheDocument();
    expect(vi.mocked(api.getSecurityGroup).mock.calls[0]?.[1]).toBe('sg-a');
  });

  it("rules → a row each; a group source links to that group's page, a range is text; the Rules description", async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({ 'sg-a|': { rules: [IN_RANGE, IN_GROUP, OUT_ALL] } });
    const router = open(PATH);
    await expectRows([ROW_RANGE, ROW_GROUP, ROW_OUT]);
    expect((table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1)).toEqual([
      'Direction',
      'Protocol',
      'Port range',
      'Source or destination',
      'Description',
      'Rule ID',
    ]);
    expect(screen.getByText('The inbound and outbound rules of this group.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '10.1.0.0/16' })).toBeNull();
    const link = screen.getByRole('link', { name: 'sg-b' });
    expect(link).toHaveAttribute('href', '/aws/ec2/security-groups/group/sg-b');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups/group/sg-b');
    });
  });

  it('no rule → "No rules" with "Add rule", which leads to the add-rule address', async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({});
    const router = open(PATH);
    expect(await screen.findByText('No rules')).toBeInTheDocument();
    expect(screen.getByText('This group has no rule.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Add rule' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups/group/sg-a/add-rule');
    });
  });

  it('the next page of rules asks with the token', async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({ 'sg-a|': { rules: [IN_RANGE], nextToken: 'r-2' }, 'sg-a|r-2': { rules: [OUT_ALL] } });
    open(PATH);
    await expectRows([ROW_RANGE]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([ROW_OUT]);
    expect(vi.mocked(api.listSecurityGroupRules).mock.calls.at(-1)?.slice(1, 3)).toEqual(['sg-a', 'r-2']);
  });

  it('InvalidGroup.NotFound → "Security group not found" with "View security groups", and no details, rules or actions', async () => {
    groupIs({ found: false });
    rulesAre({});
    const router = open('/aws/ec2/security-groups/group/sg-gone');
    expect(await screen.findByText('Security group not found')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no security group with this ID.')).toBeInTheDocument();
    expect(screen.queryByText('Security group details')).toBeNull();
    expect(PAGE.findTable()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete rule' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add rule' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'sg-gone' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'View security groups' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups');
    });
  });

  it('loading → "Loading security group"', async () => {
    vi.mocked(api.getSecurityGroup).mockImplementation(() => new Promise(() => undefined));
    rulesAre({});
    open(PATH);
    expect(await screen.findByText('Loading security group')).toBeInTheDocument();
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
    it(`a failed read of the group, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.getSecurityGroup).mockRejectedValue(new RequestError(failure));
      rulesAre({});
      open(PATH);
      await waitFor(() => {
        expect(text(document.body)).toMatch(shown);
      });
      expect(screen.queryByText('Security group details')).toBeNull();
      const calls = vi.mocked(api.getSecurityGroup).mock.calls.length;
      groupIs({ found: true, group: GROUP });
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Security group details')).toBeInTheDocument();
      expect(vi.mocked(api.getSecurityGroup).mock.calls.length).toBe(calls + 1);
    });
  }

  it('a failed read of the rules fails the "Rules" section alone, with its "Retry"', async () => {
    groupIs({ found: true, group: GROUP });
    vi.mocked(api.listSecurityGroupRules).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DescribeSecurityGroupRules', code: 'InternalError', message: 'x' }),
    );
    open(PATH);
    const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
    await waitFor(() => {
      expect(slot().textContent).toMatch(/The rules could not be read.*InternalError/);
    });
    expect(screen.getByText('Security group details')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'web' })).toBeInTheDocument();
    const groupReads = vi.mocked(api.getSecurityGroup).mock.calls.length;
    rulesAre({ 'sg-a|': { rules: [IN_RANGE] } });
    fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
    await expectRows([ROW_RANGE]);
    expect(vi.mocked(api.getSecurityGroup).mock.calls.length).toBe(groupReads);
  });

  it('a rule\'s "Delete rule": "Select one rule." until one is selected; confirmed → the revoke of its direction, "Deleted the rule {id}", the rules read again', async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({ 'sg-a|': { rules: [IN_RANGE, OUT_ALL] } });
    vi.mocked(api.deleteSecurityGroupRule).mockResolvedValue(undefined);
    open(PATH);
    await expectRows([ROW_RANGE, ROW_OUT]);
    expect(isDisabled(ruleDelete())).toBe(true);
    expect(reasonOf(ruleDelete())).toBe('Select one rule.');
    selectRow('sgr-3');
    expect(isDisabled(ruleDelete())).toBe(false);
    fireEvent.click(ruleDelete());
    expect(text(await screen.findByRole('dialog'))).toContain(
      'The outbound rule All All 0.0.0.0/0 is removed from web.',
    );
    const reads = vi.mocked(api.listSecurityGroupRules).mock.calls.length;
    rulesAre({ 'sg-a|': { rules: [IN_RANGE] } });
    await confirmDelete();
    expect(await screen.findByText('Deleted the rule sgr-3')).toBeInTheDocument();
    expect(vi.mocked(api.deleteSecurityGroupRule).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'sg-a', OUT_ALL]);
    await expectRows([ROW_RANGE]);
    expect(vi.mocked(api.listSecurityGroupRules).mock.calls.length).toBeGreaterThan(reads);
  });

  it("a rule's delete that fails → the failure in the flash, the dialog closed and the row stays", async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({ 'sg-a|': { rules: [IN_RANGE] } });
    vi.mocked(api.deleteSecurityGroupRule).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'RevokeSecurityGroupIngress',
        code: 'InvalidSecurityGroupRuleId.NotFound',
        message: 'gone',
      }),
    );
    open(PATH);
    await expectRows([ROW_RANGE]);
    selectRow('sgr-1');
    fireEvent.click(ruleDelete());
    await confirmDelete();
    expect(await screen.findByText(/InvalidSecurityGroupRuleId\.NotFound/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(rows()).toEqual([ROW_RANGE]);
  });

  it('the two buttons read "Delete group" (the header) and "Delete rule" (the Rules table)', async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({ 'sg-a|': { rules: [IN_RANGE] } });
    open(PATH);
    await expectRows([ROW_RANGE]);
    selectRow('sgr-1');
    expect(text(headerDelete())).toBe('Delete group');
    expect(text(ruleDelete())).toBe('Delete rule');
    expect(table().getElement().contains(headerDelete())).toBe(false);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('the header\'s "Delete group" confirmed → the groups list with "Deleted security group {name}"', async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({});
    vi.mocked(api.deleteSecurityGroup).mockResolvedValue(undefined);
    const router = open(PATH);
    await screen.findByText('Security group details');
    fireEvent.click(headerDelete());
    await confirmDelete();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups');
    });
    expect(await screen.findByText('Deleted security group web')).toBeInTheDocument();
    expect(vi.mocked(api.deleteSecurityGroup).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'sg-a']);
  });

  it('for the group default the header\'s "Delete group" is unavailable with its reason; "Refresh" reads the group and its rules again', async () => {
    groupIs({ found: true, group: { ...GROUP, id: 'sg-d', name: 'default' } });
    rulesAre({});
    open('/aws/ec2/security-groups/group/sg-d');
    await screen.findByText('Security group details');
    expect(isDisabled(headerDelete())).toBe(true);
    expect(reasonOf(headerDelete())).toBe('The default security group cannot be deleted.');
    await screen.findByText('No rules');
    const [groups, rules] = [
      vi.mocked(api.getSecurityGroup).mock.calls.length,
      vi.mocked(api.listSecurityGroupRules).mock.calls.length,
    ];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(vi.mocked(api.getSecurityGroup).mock.calls.length).toBe(groups + 1);
    });
    await waitFor(() => {
      expect(vi.mocked(api.listSecurityGroupRules).mock.calls.length).toBe(rules + 1);
    });
  });

  it('the page names its resources "security groups" to the frame', async () => {
    groupIs({ found: true, group: GROUP });
    rulesAre({});
    open(PATH);
    expect(await screen.findByText('These security groups are in your local emulator')).toBeInTheDocument();
  });

  it("after a rule's delete, the reads that follow answering the later one first → the screen settles on the newest, for the group and its rules", async () => {
    const groupReads: { resolve: (read: api.GroupRead) => void }[] = [];
    const ruleReads: { resolve: (page: api.RulePage) => void }[] = [];
    vi.mocked(api.getSecurityGroup).mockImplementation(
      () =>
        new Promise((resolve) => {
          groupReads.push({ resolve });
        }),
    );
    vi.mocked(api.listSecurityGroupRules).mockImplementation(
      () =>
        new Promise((resolve) => {
          ruleReads.push({ resolve });
        }),
    );
    vi.mocked(api.deleteSecurityGroupRule).mockResolvedValue(undefined);
    open(PATH);
    await waitFor(() => {
      expect(groupReads).toHaveLength(1);
      expect(ruleReads).toHaveLength(1);
    });
    act(() => {
      groupReads[0]?.resolve({ found: true, group: GROUP });
      ruleReads[0]?.resolve({ rules: [IN_RANGE, IN_GROUP, OUT_ALL] });
    });
    await expectRows([ROW_RANGE, ROW_GROUP, ROW_OUT]);
    selectRow('sgr-1');
    fireEvent.click(ruleDelete());
    await confirmDelete();
    // The rules after the delete (rules read 2); then "Refresh" twice: the group (reads 2 and 3) and the rules (reads
    // 3 and 4), two of each in flight at once.
    await waitFor(() => {
      expect(ruleReads).toHaveLength(2);
    });
    await screen.findByText('Deleted the rule sgr-1');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(groupReads).toHaveLength(2);
      expect(ruleReads).toHaveLength(3);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(groupReads).toHaveLength(3);
      expect(ruleReads).toHaveLength(4);
    });
    // The later ones answer first.
    act(() => {
      groupReads[2]?.resolve({ found: true, group: { ...GROUP, description: 'Newest' } });
      ruleReads[3]?.resolve({ rules: [OUT_ALL] });
    });
    await expectRows([ROW_OUT]);
    expect(screen.getByText('Newest')).toBeInTheDocument();
    // Then the earlier ones.
    act(() => {
      groupReads[1]?.resolve({ found: true, group: { ...GROUP, description: 'Oldest' } });
      ruleReads[2]?.resolve({ rules: [IN_RANGE, OUT_ALL] });
      ruleReads[1]?.resolve({ rules: [IN_GROUP, OUT_ALL] });
    });
    await settled();
    expect(rows()).toEqual([ROW_OUT]);
    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.queryByText('Oldest')).toBeNull();
  });
});
