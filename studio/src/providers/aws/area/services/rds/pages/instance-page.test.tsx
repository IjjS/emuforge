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
import { MODIFY_INSTANCE, modifyInstance } from '../modify-api';
import { useInstanceListing } from '../queries';

// S3 rendered inside the area's layout, with the calls of `api.ts` answered by the case (`api.test.ts` proves the
// calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    listInstances: vi.fn(),
    getInstance: vi.fn(),
    actOnInstance: vi.fn(),
    getClusterSignIn: vi.fn(),
  };
});

vi.mock('../modify-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modify-api')>()),
  modifyInstance: vi.fn(),
}));

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

function ActiveInstanceListing() {
  useInstanceListing(ENGINE);
  return null;
}

function open(path = '/aws/rds', watchList = false) {
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
      {watchList && <ActiveInstanceListing />}
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------
// DB instances and readers.

// ---------------------------------------------------------------------------------------------------------------
// DB instances and readers.

const CREATED = new Date('2026-11-20T01:02:03.000Z');

const FULL: api.DbInstance = {
  id: 'app-db',
  status: 'available',
  engine: 'postgres',
  engineVersion: '18.3',
  instanceClass: 'db.t3.micro',
  address: '0.0.0.0',
  port: 41234,
  createdAt: CREATED,
  masterUsername: 'admin1',
  dbName: 'app',
  allocatedStorage: 20,
  storageType: 'gp2',
  zone: 'us-east-1a',
  arn: 'arn:aws:rds:us-east-1:000000000000:db:app-db',
  resourceId: 'db-ABC123',
  parameterGroups: ['default.postgres18'],
  subnetGroup: { name: 'default', vpcId: 'vpc-1', subnets: ['subnet-1', 'subnet-2'] },
  securityGroups: [{ id: 'sg-1', status: 'active' }],
  deletionProtection: false,
  tags: [{ key: 'env', value: 'dev' }],
};

function found(changes: Partial<api.DbInstance> = {}): api.InstanceRead {
  return { found: true, instance: { ...FULL, ...changes } };
}

const PAGE = createWrapper(document.body);
const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The key-value pairs of the section `section` as label → value. */
function pairsOf(section: string): Record<string, string> {
  const group = PAGE.findAllKeyValuePairs().find((pairs) =>
    [pairs.getElement(), ...pairs.getElement().querySelectorAll('[aria-label]')].some(
      (element) => element.getAttribute('aria-label') === section,
    ),
  );
  expect(group, section).toBeDefined();
  const result: Record<string, string> = {};
  for (const item of group?.findItems() ?? []) {
    result[text(item.findLabel()?.getElement() as Element)] = text(item.findValue()?.getElement() as Element);
  }
  return result;
}

function control(name: string): HTMLElement {
  return screen
    .getAllByRole('button', { name })
    .find((element) => element.closest('[role="dialog"]') === null) as HTMLElement;
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

const PATH = '/aws/rds/instances/instance/app-db';

function instanceSection(section: 'connection' | 'details') {
  const sections = PAGE.findContentLayout()?.findContent().findAllContainers();
  return sections?.[section === 'connection' ? 0 : 1];
}

async function loaded() {
  await waitFor(() => {
    expect(instanceSection('details')?.findHeader()?.getElement()).toHaveTextContent(/^DB instance details$/);
  });
}

function masterUserNamePairValue() {
  const pair = instanceSection('connection')?.findContent().findKeyValuePairs()?.findItems()[2];
  expect(pair?.findLabel()?.getElement()).toHaveTextContent(/^Master user name$/);
  return pair?.findValue();
}

async function expectMasterUserName(username: string) {
  await waitFor(() => {
    const displayed = masterUserNamePairValue()?.findCopyToClipboard()?.findDisplayedText()?.getElement();
    expect(displayed?.textContent).toBe(username);
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('a DB instance', () => {
  it('an available instance with every value → its heading, the four sections with their labels and values, the copy controls', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    open(PATH);
    await loaded();
    expect(text(screen.getByRole('heading', { level: 1 }))).toBe('app-db');
    expect(vi.mocked(api.getInstance).mock.calls[0]?.[1]).toBe('app-db');
    const content = PAGE.findContentLayout()?.getElement() as HTMLElement;
    const headings = within(content).getAllByRole('heading', { level: 2 }).map(text);
    expect(headings).toEqual(['Connection', 'DB instance details', 'Network', 'Tags']);
    expect(
      screen.getByText(
        'The endpoint and the sign-in values as the emulator reports them. The API does not return the master password.',
      ),
    ).toBeInTheDocument();
    expect(pairsOf('Connection')).toEqual({
      'Endpoint address': '0.0.0.0',
      Port: '41234',
      'Master user name': 'admin1',
      'Database name': 'app',
    });
    expect(pairsOf('DB instance identifiers')).toEqual({
      ARN: 'arn:aws:rds:us-east-1:000000000000:db:app-db',
      'Resource ID': 'db-ABC123',
    });
    expect(pairsOf('DB instance details')).toEqual({
      'DB identifier': 'app-db',
      Status: 'available',
      Engine: 'postgres 18.3',
      Class: 'db.t3.micro',
      'Allocated storage': '20 GiB',
      'Storage type': 'gp2',
      'DB cluster': '-',
      'Availability Zone': 'us-east-1a',
      Created: creationDateText(CREATED),
      'Parameter group': 'default.postgres18',
      'Deletion protection': 'Off',
    });
    expect(pairsOf('Network')).toEqual({
      'DB subnet group': 'default',
      'VPC ID': 'vpc-1',
      Subnets: 'subnet-1subnet-2',
      'Security groups': 'sg-1active',
    });
    expect(screen.getByText('subnet-2')).toBeInTheDocument();
    for (const label of ['Endpoint address', 'Port', 'Master user name', 'Database name', 'ARN', 'Resource ID']) {
      expect(screen.getByRole('button', { name: `Copy ${label}` }), label).toBeInTheDocument();
    }
    const tags = PAGE.findTable();
    expect((tags?.findRows() ?? []).map((row) => [...row.getElement().querySelectorAll('td, th')].map(text))).toEqual([
      ['env', 'dev'],
    ]);
  });

  it('without a master user name, database name or storage → "-" with no copy control; no group → "No security groups"; no tag → "No tags"', async () => {
    const bare = { ...FULL, securityGroups: [], tags: [] } as Partial<api.DbInstance>;
    delete bare.masterUsername;
    delete bare.dbName;
    delete bare.allocatedStorage;
    vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: bare as api.DbInstance });
    open(PATH);
    await loaded();
    expect(pairsOf('Connection')['Master user name']).toBe('-');
    expect(pairsOf('Connection')['Database name']).toBe('-');
    expect(pairsOf('DB instance details')['Allocated storage']).toBe('-');
    expect(screen.queryByRole('button', { name: 'Copy Master user name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy Database name' })).toBeNull();
    expect(pairsOf('Network')['Security groups']).toBe('No security groups');
    expect(screen.getByText('No tags')).toBeInTheDocument();
  });

  it.each(['postgres', 'mysql', 'mariadb'])('copies the Compose host endpoint of a %s instance', async (engine) => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      vi.mocked(api.getInstance).mockResolvedValue(found({ engine, port: 28162 }));
      open(PATH);
      await loaded();

      expect(pairsOf('Connection')['Endpoint address']).toBe('0.0.0.0');
      expect(pairsOf('Connection')['Port']).toBe('28162');
      expect(
        screen.getByText((_, element) => element?.textContent === '127.0.0.1:28162', {
          selector: '.aws-area-value-address',
        }),
      ).toBeVisible();
      expect(
        screen.getByText(/runs in Docker Compose with database ports published.*machine running Compose/),
      ).toBeInTheDocument();
      expect(writeText).not.toHaveBeenCalled();
      const button = screen.getByRole('button', { name: 'Copy Compose host endpoint' });
      const copy = PAGE.findAllCopyToClipboards().find((control) => control.findCopyButton().getElement() === button);
      fireEvent.click(button);
      await waitFor(() => {
        expect(copy?.findStatusText({ popoverRenderWithPortal: false })?.getElement()).toHaveTextContent(
          /^Compose host endpoint copied$/,
        );
      });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('127.0.0.1:28162');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['aurora-postgresql', 'aurora-mysql'])(
    'shows the %s member port while cluster sign-in loads',
    async (engine) => {
      const member = { ...FULL, engine, clusterId: 'aur-1', port: 28165 };
      delete member.masterUsername;
      delete member.dbName;
      vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: member });
      vi.mocked(api.getClusterSignIn).mockImplementation(() => new Promise(() => undefined));
      open(PATH);
      await loaded();

      await waitFor(() => expect(api.getClusterSignIn).toHaveBeenCalled());
      expect(pairsOf('Connection')['Master user name']).toBe('-');
      expect(pairsOf('Connection')['Database name']).toBe('-');
      expect(
        screen.getByText((_, element) => element?.textContent === '127.0.0.1:28165', {
          selector: '.aws-area-value-address',
        }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Copy Compose host endpoint' })).toBeInTheDocument();
    },
  );

  it('keeps the reported endpoint fields of a metadata-only Aurora instance', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found({ engine: 'aurora-postgresql', port: 5432 }));
    open(PATH);
    await loaded();

    expect(pairsOf('Connection')['Endpoint address']).toBe('0.0.0.0');
    expect(pairsOf('Connection')['Port']).toBe('5432');
    expect(screen.queryByRole('button', { name: 'Copy Compose host endpoint' })).toBeNull();
  });

  it('a cluster\'s member → "DB cluster" links to the cluster\'s page; outside a cluster "-"', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found({ clusterId: 'aur-1', engine: 'aurora-postgresql' }));
    open(PATH);
    await loaded();
    expect(screen.getByRole('link', { name: 'aur-1' })).toHaveAttribute('href', '/aws/rds/clusters/cluster/aur-1');
  });

  it('links from the Aurora lifecycle guidance to the member’s cluster', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found({ clusterId: 'aur-1', engine: 'aurora-postgresql' }));
    const router = open(PATH);
    await loaded();

    const link = screen.getByRole('link', { name: 'Open DB cluster' });
    expect(link.closest('a')?.parentElement).toHaveTextContent(
      'An Aurora DB instance starts and stops only with its DB cluster.',
    );
    expect(link).toHaveAttribute('href', '/aws/rds/clusters/cluster/aur-1');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters/cluster/aur-1');
    });
  });

  it('a member without its own master user name and database name → its cluster\'s, each copyable, "From DB cluster {id}" to its page', async () => {
    const member = { ...FULL, clusterId: 'aur-1', engine: 'aurora-postgresql' } as Partial<api.DbInstance>;
    delete member.masterUsername;
    delete member.dbName;
    vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: member as api.DbInstance });
    vi.mocked(api.getClusterSignIn).mockResolvedValue({ masterUsername: 'clusteradmin', databaseName: 'cdb' });
    open(PATH);
    await loaded();
    await waitFor(() => {
      expect(pairsOf('Connection')['Master user name']).toBe('clusteradminFrom DB cluster aur-1');
    });
    expect(pairsOf('Connection')['Database name']).toBe('cdbFrom DB cluster aur-1');
    expect(vi.mocked(api.getClusterSignIn).mock.calls[0]?.[1]).toBe('aur-1');
    expect(screen.getByRole('button', { name: 'Copy Master user name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Database name' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'DB cluster aur-1' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/aws/rds/clusters/cluster/aur-1');
    }
  });

  for (const [what, settle] of [
    ['while the cluster read is out', () => new Promise<api.ClusterSignIn>(() => undefined)],
    [
      'when it fails',
      () => Promise.reject(new RequestError({ kind: 'other', operation: 'DescribeDBClusters', code: 'Boom' })),
    ],
    ['when the cluster has no such value', () => Promise.resolve({})],
  ] as const) {
    it(`a member's sign-in values ${what} → "-" with no copy control, the rest of the page shown`, async () => {
      const member = { ...FULL, clusterId: 'aur-1' } as Partial<api.DbInstance>;
      delete member.masterUsername;
      delete member.dbName;
      vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: member as api.DbInstance });
      vi.mocked(api.getClusterSignIn).mockImplementation(settle);
      open(PATH);
      await loaded();
      await waitFor(() => {
        expect(api.getClusterSignIn).toHaveBeenCalled();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(pairsOf('Connection')['Master user name']).toBe('-');
      expect(pairsOf('Connection')['Database name']).toBe('-');
      expect(screen.queryByRole('button', { name: 'Copy Master user name' })).toBeNull();
      expect(screen.queryByText(/From DB cluster/)).toBeNull();
      expect(pairsOf('DB instance details').Status).toBe('available');
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
  }

  it('an instance outside a cluster, or a member with its own values, reads no cluster', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    open(PATH);
    await loaded();
    vi.mocked(api.getInstance).mockResolvedValue(found({ clusterId: 'aur-1' }));
    fireEvent.click(control('Refresh'));
    await waitFor(() => {
      expect(pairsOf('DB instance details')['DB cluster']).toBe('aur-1');
    });
    expect(api.getClusterSignIn).not.toHaveBeenCalled();
    expect(pairsOf('Connection')['Master user name']).toBe('admin1');
  });

  it('deletion protection "On" → "Changed with ModifyDBInstance." and "Delete" unavailable with its reason; "Off" → neither', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found({ deletionProtection: true }));
    open(PATH);
    await loaded();
    expect(pairsOf('DB instance details')['Deletion protection']).toBe('OnChanged with ModifyDBInstance.');
    expect(isDisabled(control('Delete'))).toBe(true);
    expect(reasonOf(control('Delete'))).toBe('Deletion protection is on.');
  });

  it('deletion protection "Off" → no sentence and "Delete" available', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    open(PATH);
    await loaded();
    expect(screen.queryByText('Changed with ModifyDBInstance.')).toBeNull();
    expect(isDisabled(control('Delete'))).toBe(false);
  });

  it('DBInstanceNotFound → "DB instance not found" with "View DB instances", and no section or action', async () => {
    vi.mocked(api.getInstance).mockResolvedValue({ found: false });
    const router = open('/aws/rds/instances/instance/gone');
    expect(await screen.findByText('DB instance not found')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no DB instance with this identifier.')).toBeInTheDocument();
    expect(screen.queryByText('Connection')).toBeNull();
    for (const name of ['Start', 'Stop', 'Reboot', 'Delete']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    answerList();
    fireEvent.click(screen.getByRole('link', { name: 'View DB instances' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances');
    });
  });

  it('loading → "Loading DB instance"', async () => {
    vi.mocked(api.getInstance).mockImplementation(() => new Promise(() => undefined));
    open(PATH);
    expect(await screen.findByText('Loading DB instance')).toBeInTheDocument();
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
      vi.mocked(api.getInstance).mockRejectedValue(new RequestError(failure));
      open(PATH);
      await waitFor(() => {
        expect(text(PAGE.findContentLayout()?.getElement() as Element)).toMatch(shown);
      });
      expect(isDisabled(modifyButton())).toBe(true);
      expect(reasonOf(modifyButton())).toBe('Refresh the DB instance before modifying it.');
      vi.mocked(api.getInstance).mockResolvedValue(found());
      const calls = vi.mocked(api.getInstance).mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await loaded();
      expect(vi.mocked(api.getInstance).mock.calls.length).toBe(calls + 1);
    });
  }

  it('the header\'s actions are the instance\'s; "Refresh" reads the instance again', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found({ status: 'stopped' }));
    open(PATH);
    await loaded();
    expect(isDisabled(control('Start'))).toBe(false);
    expect(reasonOf(control('Stop'))).toBe('Only an available DB instance can be stopped.');
    expect(reasonOf(control('Reboot'))).toBe('Only an available DB instance can be rebooted.');
    expect(screen.queryByText('Select one DB instance.')).toBeNull();
    const calls = vi.mocked(api.getInstance).mock.calls.length;
    vi.mocked(api.getInstance).mockResolvedValue(found());
    fireEvent.click(control('Refresh'));
    await waitFor(() => {
      expect(vi.mocked(api.getInstance).mock.calls.length).toBe(calls + 1);
    });
    await waitFor(() => {
      expect(isDisabled(control('Stop'))).toBe(false);
    });
  });

  for (const [name, status, operation, result, code] of [
    ['Start', 'stopped', 'StartDBInstance', 'Starting app-db', 'InvalidDBInstanceState'],
    ['Stop', 'available', 'StopDBInstance', 'Stopping app-db', 'InvalidDBInstanceState'],
    ['Reboot', 'available', 'RebootDBInstance', 'Rebooting app-db', 'DBInstanceNotFound'],
  ] as const) {
    it(`"${name}" → sent, "${result}" as a success; a refusal → the code and message in the flash; a 501 → not implemented`, async () => {
      vi.mocked(api.getInstance).mockResolvedValue(found({ status }));
      vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
      open(PATH);
      await loaded();
      fireEvent.click(control(name));
      await waitFor(() => {
        expect(flashes('success')).toEqual([result]);
      });
      expect(vi.mocked(api.actOnInstance).mock.calls[0]?.slice(1, 3)).toEqual([name.toLowerCase(), 'app-db']);

      vi.mocked(api.actOnInstance).mockRejectedValue(
        new RequestError({ kind: 'other', operation, code, message: 'Refused as it came.' }),
      );
      await waitFor(() => {
        expect(isDisabled(control(name))).toBe(false);
      });
      fireEvent.click(control(name));
      await waitFor(() => {
        expect(flashes('error')).toHaveLength(1);
      });
      expect(flashes('error')[0]).toContain(code);
      expect(flashes('error')[0]).toContain('Refused as it came.');
      expect(pairsOf('DB instance details').Status).toBe(status);

      vi.mocked(api.actOnInstance).mockRejectedValue(new RequestError({ kind: 'not-implemented', operation }));
      await waitFor(() => {
        expect(isDisabled(control(name))).toBe(false);
      });
      fireEvent.click(control(name));
      await waitFor(() => {
        expect(flashes().join(' ')).toMatch(new RegExp(`Not implemented by the emulator.*${operation}`));
      });
    });
  }

  it('"Delete" confirmed and answered → the instances list with "Deleting {id}"', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    answerList();
    const router = open(PATH);
    await loaded();
    fireEvent.click(control('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances');
    });
    await waitFor(() => {
      expect(flashes('success')).toEqual(['Deleting app-db']);
    });
    expect(vi.mocked(api.actOnInstance).mock.calls[0]?.slice(1, 3)).toEqual(['delete', 'app-db']);
  });

  it('a refusal of "Delete" → the failure in the flash, the dialog closed, the page as it was', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    vi.mocked(api.actOnInstance).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteDBInstance',
        code: 'InvalidParameterCombination',
        message: 'Cannot delete protected DB Instance, please disable deletion protection and try again.',
      }),
    );
    const router = open(PATH);
    await loaded();
    fireEvent.click(control('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(flashes('error')).toHaveLength(1);
    });
    expect(flashes('error')[0]).toContain('InvalidParameterCombination');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe(PATH);
    await loaded();
  });

  it('the page names its resources "DB instances" to the frame', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    open(PATH);
    expect(await screen.findByText('These DB instances are in your local emulator')).toBeInTheDocument();
  });

  for (const order of ['before', 'after'] as const) {
    it(`after a delete, the read answering "not found" ${order} the delete's answer → the list opens with "Deleting {id}"`, async () => {
      const reads: { resolve: (read: api.InstanceRead) => void }[] = [];
      vi.mocked(api.getInstance).mockImplementation(
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
      answerList();
      const router = open(PATH);
      await waitFor(() => {
        expect(reads).toHaveLength(1);
      });
      act(() => {
        reads[0]?.resolve(found());
      });
      await loaded();
      fireEvent.click(control('Delete'));
      await confirmDelete();
      await waitFor(() => {
        expect(api.actOnInstance).toHaveBeenCalledTimes(1);
      });
      if (order === 'before') {
        fireEvent.click(control('Refresh'));
        await waitFor(() => {
          expect(reads).toHaveLength(2);
        });
        act(() => {
          reads[1]?.resolve({ found: false });
        });
        await screen.findByText('DB instance not found');
      }
      act(() => {
        settle?.();
      });
      if (order === 'after') {
        await waitFor(() => {
          expect(reads.length).toBeGreaterThan(1);
        });
        act(() => {
          reads[reads.length - 1]?.resolve({ found: false });
        });
      }
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/rds/instances');
      });
      await waitFor(() => {
        expect(flashes('success')).toEqual(['Deleting app-db']);
      });
      expect(screen.queryByText('DB instance not found')).toBeNull();
    });
  }

  it('after "Stop", the reads that follow answering the later one first → the page settles on the newest', async () => {
    const reads: { resolve: (read: api.InstanceRead) => void }[] = [];
    vi.mocked(api.getInstance).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    open(PATH);
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve(found());
    });
    await loaded();
    fireEvent.click(control('Stop'));
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await waitFor(() => {
      expect(isDisabled(control('Refresh'))).toBe(false);
    });
    fireEvent.click(control('Refresh'));
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve(found({ status: 'stopped' }));
    });
    await waitFor(() => {
      expect(pairsOf('DB instance details').Status).toBe('stopped');
    });
    act(() => {
      reads[1]?.resolve(found({ status: 'stopping' }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(pairsOf('DB instance details').Status).toBe('stopped');
  });

  it("a tag's value that holds markup is shown as text; no password and no field named for one", async () => {
    vi.mocked(api.getInstance).mockResolvedValue(
      found({ tags: [{ key: 'x', value: '<img src=x onerror=alert(1)>' }] }),
    );
    const { container } = { container: document.body };
    open(PATH);
    await loaded();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    for (const term of screen.queryAllByText(/password/i)) {
      expect(text(term)).toBe(
        'The endpoint and the sign-in values as the emulator reports them. The API does not return the master password.',
      );
    }
    expect(screen.queryByText(/\*\*\*\*/)).toBeNull();
  });
});

/** S1's list, for a case that leads there. */
function answerList() {
  vi.mocked(api.listInstances).mockResolvedValue({ instances: [] });
}

type ModifyDialog = NonNullable<ReturnType<typeof PAGE.findModal>>;

function modifyButton() {
  const button = PAGE.findButton('#rds-modify-instance')?.getElement();
  expect(button).toHaveTextContent('Modify');
  return button as HTMLButtonElement;
}

async function openModify() {
  await loaded();
  fireEvent.click(modifyButton());
  return waitFor(() => {
    const modal = PAGE.findModal();
    expect(modal?.findHeader().getElement()).toHaveTextContent('Modify DB instance');
    return modal as ModifyDialog;
  });
}

const MODIFY_FIELD_LABELS = {
  identifier: 'DB instance identifier',
  class: 'DB instance class',
  storage: 'Allocated storage (GiB)',
  password: 'New master password',
} as const;
type ModifyField = keyof typeof MODIFY_FIELD_LABELS;

function modifyInput(dialog: ModifyDialog, field: ModifyField) {
  const content = dialog.findContent();
  const selector = `#rds-modify-field-${field}`;
  const wrapper = content.findFormField(selector) ?? content.find(selector)?.findFormField();
  expect(wrapper?.findLabel()?.getElement().textContent?.trim()).toBe(MODIFY_FIELD_LABELS[field]);
  const input = wrapper?.findControl()?.findInput()?.findNativeInput().getElement();
  if (input === undefined) throw new Error(`Missing input: ${field}`);
  return input;
}

function update(dialog: ModifyDialog, field: ModifyField, value: string) {
  fireEvent.change(modifyInput(dialog, field), { target: { value } });
}

function footerButton(dialog: ModifyDialog, action: 'save' | 'cancel') {
  const button = dialog.findFooter()?.findButton(`#rds-modify-${action}`)?.getElement();
  expect(button).toHaveTextContent(action === 'save' ? 'Save changes' : 'Cancel');
  return button as HTMLButtonElement;
}

function saveChanges(dialog: ModifyDialog) {
  const button = footerButton(dialog, 'save');
  fireEvent.click(button);
  return button;
}

async function waitForModificationFlash(expected: string) {
  await waitFor(() => {
    const content = PAGE.findFlashbar()?.findItemsByType('success')[0]?.findContent()?.getElement();
    expect(content).toHaveTextContent(expected);
  });
}

function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function refused(failure: Omit<Extract<RequestFailure, { kind: 'other' }>, 'operation' | 'kind'>) {
  return new RequestError({ kind: 'other', operation: MODIFY_INSTANCE, ...failure });
}

const UPDATED_ID = 'returned-db';
const UPDATED_PATH = '/aws/rds/instances/instance/returned-db';

describe('modifying a DB instance', () => {
  it('keeps Refresh and Modify visible with the compact lifecycle menu on a narrow viewport', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      ...matchMedia(query),
      matches: query === '(width < 688px)',
    }));
    vi.mocked(api.getInstance).mockResolvedValue(found());
    open(PATH);
    await loaded();
    expect(control('Refresh')).toBeEnabled();
    expect(modifyButton()).toBeEnabled();
    const actions = PAGE.findContentLayout()
      ?.findHeader()
      ?.findHeader()
      ?.findActions()
      ?.findButtonDropdown()
      ?.findNativeButton()
      .getElement();
    expect(actions).toHaveAccessibleName('Actions');
    expect(actions).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('U10 is unavailable during transition', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found({ status: 'modifying' }));
    open(PATH);
    await loaded();
    expect(isDisabled(modifyButton())).toBe(true);
    expect(reasonOf(modifyButton())).toBe('Only an available DB instance can be modified.');
  });

  it('U10 enables Modify when available and prevents another save while pending', async () => {
    const pending = held<string>();
    const postSave = held<api.InstanceRead>();
    vi.mocked(modifyInstance).mockReturnValue(pending.promise);
    vi.mocked(api.getInstance).mockResolvedValueOnce(found()).mockReturnValue(postSave.promise);
    open(PATH);
    await loaded();
    expect(modifyButton()).toBeEnabled();
    const dialog = await openModify();
    update(dialog, 'class', 'db.t3.small');
    const save = saveChanges(dialog);
    expect(isDisabled(save)).toBe(true);
    expect(isDisabled(modifyButton())).toBe(true);
    expect(reasonOf(modifyButton())).toBe('Wait for the current DB instance action to finish.');
    fireEvent.click(save);
    fireEvent.click(footerButton(dialog, 'cancel'));
    expect(dialog.getElement()).toBeInTheDocument();
    expect(modifyInstance).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      'app-db',
      { instanceClass: 'db.t3.small' },
      expect.any(AbortSignal),
    );
    pending.resolve('app-db');
    await waitForModificationFlash('Modifying app-db.');
    await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(2));
    expect(isDisabled(modifyButton())).toBe(true);
    expect(reasonOf(modifyButton())).toBe('Wait for the updated DB instance details.');
    expect(PAGE.findModal()).toBeNull();
    await act(async () => postSave.resolve(found({ instanceClass: 'db.t3.small' })));
    await loaded();
    expect(pairsOf('DB instance details').Class).toBe('db.t3.small');
    expect(modifyButton()).toBeEnabled();
  });

  // Bound: The real three-second status poll needs time for the dialog, ordered reads, and final render.
  it.each(['before', 'after'] as const)(
    'U11 keeps the result with the list answering %s the detail and polls until available',
    async (order) => {
      const list = held<api.InstancePage>();
      const preSave = held<api.InstanceRead>();
      const postSave = held<api.InstanceRead>();
      const save = held<string>();
      vi.mocked(api.listInstances)
        .mockResolvedValue({ instances: [] })
        .mockReturnValueOnce(Promise.resolve({ instances: [] }))
        .mockReturnValueOnce(list.promise);
      vi.mocked(api.getInstance)
        .mockResolvedValue(found({ instanceClass: 'db.t3.small', allocatedStorage: 30, deletionProtection: false }))
        .mockResolvedValueOnce(found({ deletionProtection: true }))
        .mockReturnValueOnce(preSave.promise)
        .mockReturnValueOnce(postSave.promise);
      vi.mocked(modifyInstance).mockReturnValue(save.promise);
      const router = open(PATH, true);
      const dialog = await openModify();
      update(dialog, 'class', 'db.t3.small');
      update(dialog, 'storage', '30');
      const protection = dialog.findContent().findCheckbox();
      expect(protection?.findLabel().getElement()).toHaveTextContent('Deletion protection');
      fireEvent.click(protection?.findNativeInput().getElement() as HTMLInputElement);
      saveChanges(dialog);
      fireEvent.click(control('Refresh'));
      await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(2));
      const preSaveSignal = vi.mocked(api.getInstance).mock.calls[1]?.[2];
      await act(async () => save.resolve('app-db'));
      await waitForModificationFlash('Modifying app-db.');
      await waitFor(() => expect(api.listInstances).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(3));
      expect(preSaveSignal?.aborted).toBe(true);
      expect(isDisabled(modifyButton())).toBe(true);

      if (order === 'before') {
        await act(async () => list.resolve({ instances: [] }));
        await act(async () => preSave.resolve(found({ deletionProtection: true })));
        expect(isDisabled(modifyButton())).toBe(true);
        expect(reasonOf(modifyButton())).toBe('Wait for the updated DB instance details.');
      }
      await act(async () => postSave.resolve(found({ status: 'modifying', deletionProtection: true })));
      await waitFor(() => expect(pairsOf('DB instance details').Status).toBe('modifying'));
      expect(pairsOf('DB instance details').Class).toBe('db.t3.micro');
      if (order === 'after') {
        await act(async () => list.resolve({ instances: [] }));
        await act(async () => preSave.resolve(found({ deletionProtection: true })));
        expect(pairsOf('DB instance details').Status).toBe('modifying');
      }
      expect(isDisabled(modifyButton())).toBe(true);
      expect(flashes('success')).toEqual(['Modifying app-db.']);

      await waitFor(() => expect(pairsOf('DB instance details').Class).toBe('db.t3.small'), { timeout: 4500 });
      expect(pairsOf('DB instance details')).toMatchObject({
        Status: 'available',
        'Allocated storage': '30 GiB',
        'Deletion protection': 'Off',
      });
      expect(isDisabled(control('Delete'))).toBe(false);
      expect(modifyButton()).toBeEnabled();
      expect(flashes('success')).toEqual(['Modifying app-db.']);
      expect(router.state.location.pathname).toBe(PATH);
    },
    9000,
  );

  it.each(['before', 'after'] as const)(
    'U12 keeps the renamed member and result when the old detail answers %s the list and cluster answers last',
    async (order) => {
      const oldRead = held<api.InstanceRead>();
      const destination = held<api.InstanceRead>();
      const list = held<api.InstancePage>();
      const cluster = held<api.ClusterSignIn>();
      const pending = held<string>();
      const member = { ...FULL, clusterId: 'aurora' };
      delete member.masterUsername;
      delete member.dbName;
      vi.mocked(api.getInstance)
        .mockImplementation((_endpoint, id) => (id === UPDATED_ID ? destination.promise : oldRead.promise))
        .mockResolvedValueOnce({ found: true, instance: member });
      vi.mocked(api.getClusterSignIn)
        .mockReturnValue(cluster.promise)
        .mockResolvedValueOnce({ masterUsername: 'old-admin' });
      vi.mocked(api.listInstances).mockReturnValue(list.promise).mockResolvedValueOnce({ instances: [] });
      vi.mocked(modifyInstance).mockReturnValue(pending.promise);
      const router = open(PATH, true);
      const dialog = await openModify();
      await expectMasterUserName('old-admin');
      update(dialog, 'identifier', 'requested-db');
      saveChanges(dialog);
      if (order === 'before') {
        fireEvent.click(control('Refresh'));
        await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(2));
        await act(async () => oldRead.resolve({ found: false }));
        await screen.findByText('DB instance not found');
      }
      await act(async () => pending.resolve(UPDATED_ID));
      await waitForModificationFlash('Modifying returned-db.');
      expect(router.state.location.pathname).toBe(UPDATED_PATH);
      await waitFor(() => expect(api.listInstances).toHaveBeenCalledTimes(2));
      expect(vi.mocked(api.getInstance).mock.calls.filter(([, id]) => id === 'app-db').length).toBeGreaterThan(1);
      await act(async () => list.resolve({ instances: [] }));
      if (order === 'after') await act(async () => oldRead.resolve({ found: false }));
      await act(async () =>
        destination.resolve({
          found: true,
          instance: { ...member, id: UPDATED_ID, instanceClass: 'db.r6g.xlarge' },
        }),
      );
      await loaded();
      expect(pairsOf('DB instance details')).toMatchObject({
        'DB identifier': UPDATED_ID,
        Class: 'db.r6g.xlarge',
        'DB cluster': 'aurora',
      });
      expect(masterUserNamePairValue()?.getElement()).toHaveTextContent(/^-$/);
      await act(async () => cluster.resolve({ masterUsername: 'new-admin' }));
      await expectMasterUserName('new-admin');
      expect(pairsOf('DB instance details')['DB identifier']).toBe(UPDATED_ID);
      expect(flashes('success')).toEqual(['Modifying returned-db.']);
      expect(screen.queryByText('DB instance not found')).toBeNull();
      expect(router.state.location.pathname).toBe(UPDATED_PATH);
    },
  );

  it.each([
    ['DBInstanceAlreadyExists', 'DB instance already exists', 'identifier', 'occupied-db', 'corrected-db'],
    ['InvalidParameterCombination', 'The class is unavailable', 'class', 'db.bad', 'db.t3.small'],
  ] as const)(
    'U13 shows %s on the original detail and lets the user correct or cancel',
    async (code, message, field, bad, good) => {
      vi.mocked(api.getInstance).mockResolvedValue(found());
      vi.mocked(modifyInstance).mockRejectedValue(refused({ code, message }));
      const router = open(PATH);
      const dialog = await openModify();
      update(dialog, field, bad);
      saveChanges(dialog);
      await waitFor(() =>
        expect(dialog.findContent().findAlert()?.findContent().getElement()).toHaveTextContent(message),
      );
      expect(router.state.location.pathname).toBe(PATH);
      update(dialog, field, good);
      saveChanges(dialog);
      expect(modifyInstance).toHaveBeenNthCalledWith(
        2,
        ENGINE,
        'app-db',
        field === 'identifier' ? { identifier: good } : { instanceClass: good },
        expect.any(AbortSignal),
      );
      await waitFor(() =>
        expect(dialog.findContent().findAlert()?.findContent().getElement()).toHaveTextContent(message),
      );
      fireEvent.click(footerButton(dialog, 'cancel'));
      expect(PAGE.findModal()).toBeNull();
      expect(router.state.location.pathname).toBe(PATH);
      expect(flashes('success')).toEqual([]);
    },
  );

  it('locks the submitted draft and hides Close while saving, then restores editing on refusal', async () => {
    const request = held<string>();
    vi.mocked(api.getInstance).mockResolvedValue(found({ deletionProtection: true }));
    vi.mocked(modifyInstance).mockReturnValue(request.promise);
    open(PATH);
    const dialog = await openModify();
    const edits = [
      ['identifier', 'renamed-db'],
      ['class', 'db.t3.small'],
      ['storage', '30'],
      ['password', 'Example-Only!580'],
    ] as const;
    for (const [field, value] of edits) update(dialog, field, value);
    const protection = dialog.findContent().findCheckbox()?.findNativeInput().getElement() as HTMLInputElement;
    fireEvent.click(protection);
    expect(dialog.findDismissButton().getElement()).toHaveAccessibleName('Close');
    const save = saveChanges(dialog);
    expect(modifyInstance).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      'app-db',
      {
        identifier: 'renamed-db',
        instanceClass: 'db.t3.small',
        allocatedStorage: 30,
        masterPassword: 'Example-Only!580',
        deletionProtection: false,
      },
      expect.any(AbortSignal),
    );

    expect(dialog.findDismissButton()).toBeNull();
    expect(footerButton(dialog, 'cancel')).toBeDisabled();
    expect(isDisabled(save)).toBe(true);
    expect(save).toHaveFocus();
    fireEvent.keyDown(save, { key: 'Escape', keyCode: 27 });
    expect(dialog.getElement()).toBeInTheDocument();
    for (const [field, value] of edits) {
      const input = modifyInput(dialog, field);
      expect(input).toBeDisabled();
      expect(input).toHaveValue(value);
    }
    expect(modifyInput(dialog, 'password')).toHaveAttribute('type', 'password');
    expect(protection).toBeDisabled();
    protection.click();
    expect(protection).not.toBeChecked();

    await act(async () =>
      request.reject(refused({ code: 'DBInstanceAlreadyExists', message: 'DB instance already exists' })),
    );
    expect(dialog.findContent().findAlert()?.findContent().getElement()).toHaveTextContent(
      'DB instance already exists',
    );
    for (const [field, value] of edits) {
      const input = modifyInput(dialog, field);
      expect(input).toBeEnabled();
      expect(input).toHaveValue(value);
    }
    expect(protection).toBeEnabled();
    fireEvent.click(protection);
    expect(protection).toBeChecked();
    update(dialog, 'identifier', 'corrected-db');
    expect(modifyInput(dialog, 'identifier')).toHaveValue('corrected-db');
    expect(footerButton(dialog, 'save')).toBeEnabled();
    const close = dialog.findDismissButton().getElement();
    expect(close).toHaveAccessibleName('Close');
    fireEvent.click(close);
    expect(PAGE.findModal()).toBeNull();
  });

  it('U14 refreshes the detail when the target disappears before Save', async () => {
    vi.mocked(api.getInstance).mockResolvedValueOnce(found()).mockResolvedValue({ found: false });
    vi.mocked(modifyInstance).mockRejectedValue(refused({ code: 'DBInstanceNotFound' }));
    open(PATH);
    const dialog = await openModify();
    update(dialog, 'class', 'db.t3.small');
    saveChanges(dialog);
    await screen.findByText('DB instance not found');
    expect(screen.getByRole('link', { name: 'View DB instances' })).toBeInTheDocument();
    expect(PAGE.findModal()).toBeNull();
    expect(flashes('success')).toEqual([]);
  });

  it('U15 names an unsupported operation and disables its action', async () => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    vi.mocked(modifyInstance).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: MODIFY_INSTANCE }),
    );
    open(PATH);
    const dialog = await openModify();
    update(dialog, 'class', 'db.t3.small');
    saveChanges(dialog);
    await waitFor(() => {
      const info = PAGE.findFlashbar()?.findItemsByType('info')[0];
      expect(info?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(info?.findContent()?.getElement()).toHaveTextContent(MODIFY_INSTANCE);
    });
    expect(PAGE.findModal()).toBeNull();
    expect(isDisabled(modifyButton())).toBe(true);
    expect(reasonOf(modifyButton())).toBe('The emulator does not implement ModifyDBInstance.');
  });

  it.each([
    [{ kind: 'access-denied', message: 'The policy refuses this modification' }, 'Access denied'],
    [
      { kind: 'emulator-did-not-answer', message: 'Reconnect the emulator and try again' },
      'The emulator did not answer',
    ],
    [{ kind: 'engine-did-not-answer' }, `The EmuForge engine at ${ENGINE} did not answer`],
  ] as const)('U16 shows the operation or connection failure (%o)', async (failure, heading) => {
    vi.mocked(api.getInstance).mockResolvedValue(found());
    vi.mocked(modifyInstance).mockRejectedValue(new RequestError({ operation: MODIFY_INSTANCE, ...failure }));
    open(PATH);
    const dialog = await openModify();
    update(dialog, 'class', 'db.t3.small');
    saveChanges(dialog);
    await waitFor(() => {
      const alert = dialog.findContent().findAlert();
      expect(text(alert?.findHeader()?.getElement() as Element)).toBe(heading);
      if ('message' in failure) expect(alert?.findContent().getElement()).toHaveTextContent(failure.message);
    });
    expect(flashes('success')).toEqual([]);
  });

  it('U17 ignores a late save response on departure', async () => {
    const pending = held<string>();
    vi.mocked(api.getInstance).mockResolvedValue(found());
    vi.mocked(modifyInstance).mockReturnValue(pending.promise);
    answerList();
    const router = open(PATH);
    const dialog = await openModify();
    update(dialog, 'identifier', 'requested-db');
    saveChanges(dialog);
    const signal = vi.mocked(modifyInstance).mock.calls[0]?.[3];
    await act(async () => {
      await router.navigate('/aws/rds/instances');
    });
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await act(async () => pending.resolve(UPDATED_ID));
    expect(router.state.location.pathname).toBe('/aws/rds/instances');
    expect(flashes()).toEqual([]);
  });

  it.each([true, false])('U18 keeps the submitted password private (accepted: %s)', async (accepted) => {
    const password = 'Example-Only!580';
    const sent: string[] = [];
    const xml = accepted
      ? '<ModifyDBInstanceResponse><ModifyDBInstanceResult><DBInstance><DBInstanceIdentifier>app-db</DBInstanceIdentifier></DBInstance></ModifyDBInstanceResult></ModifyDBInstanceResponse>'
      : `<ErrorResponse><Error><Code>InvalidParameterValue</Code><Message>MasterUserPassword rejected: ${password}, value ${password}</Message></Error></ErrorResponse>`;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === '/__emuforge/session') {
        return new Response(JSON.stringify({ token: 'emuforge-test-token-580' }));
      }
      const params = new URLSearchParams(await request.text());
      expect(params.get('Action')).toBe(MODIFY_INSTANCE);
      sent.push(params.get('MasterUserPassword') ?? '');
      return new Response(xml, { status: accepted ? 200 : 400, headers: { 'content-type': 'text/xml' } });
    });
    const real = await vi.importActual<typeof import('../modify-api')>('../modify-api');
    vi.mocked(modifyInstance).mockImplementation(real.modifyInstance);
    vi.mocked(api.getInstance).mockResolvedValue(found());
    const router = open(PATH);
    const dialog = await openModify();
    update(dialog, 'password', password);
    saveChanges(dialog);
    if (accepted) {
      await waitForModificationFlash('Modifying app-db.');
      expect(PAGE.findModal()).toBeNull();
    } else {
      await waitFor(() =>
        expect(dialog.findContent().findAlert()?.findContent().getElement()).toHaveTextContent(
          'MasterUserPassword rejected',
        ),
      );
      expect(flashes('success')).toEqual([]);
    }
    expect(sent).toEqual([password]);
    expect(document.body).not.toHaveTextContent(password);
    for (const region of document.querySelectorAll('[role="alert"], [aria-live]')) {
      expect(region).not.toHaveTextContent(password);
    }
    const { pathname, search, hash } = router.state.location;
    expect(`${pathname}${search}${hash}`).toBe(PATH);
    for (const storage of [localStorage, sessionStorage]) {
      expect(JSON.stringify(storage)).not.toContain(password);
    }
  });
});
