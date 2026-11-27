import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import type * as area from '../../../components/security-group-choices';
import AwsArea from '../../../index';
import * as choices from '../choices-api';
import * as creating from '../create-api';

// S5 rendered inside the area's layout, with the calls of `choices-api.ts`, `create-api.ts` and the area's security
// groups answered by the case (their own tests prove the calls against a fake engine), and the cluster's page the
// create leads to stood in for below.

vi.mock('../choices-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../choices-api')>();
  return {
    ...real,
    listEngineVersionChoices: vi.fn(),
    listSubnetGroupChoices: vi.fn(),
    findSubnetGroup: vi.fn(),
    readDefaultVpcId: vi.fn(),
    readDefaultVersion: vi.fn(),
    readOrderableRows: vi.fn(),
  };
});

vi.mock('../../../lib/ec2-availability-zones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ec2-availability-zones')>()),
  listAvailabilityZones: async () => ['us-east-1a', 'us-east-1b'],
}));

const KEY_ARN = 'arn:aws:kms:us-east-1:000000000000:key/create-test';
vi.mock('../../../components/kms-key-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../components/kms-key-choices')>();
  return {
    ...real,
    kmsKeyChoices: (endpoint: string | undefined) => ({
      ...real.kmsKeyChoices(endpoint),
      read: async () => ({ items: [{ id: 'create-test', arn: KEY_ARN, aliases: ['alias/create-test'] }] }),
    }),
  };
});

vi.mock('../create-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../create-api')>();
  return { ...real, createInstance: vi.fn(), createCluster: vi.fn() };
});

// The area's source reads through its own module's reader, which a mock of the module cannot reach from inside it;
// the form is given the area's own source, with its reader answered by the case.
const readGroups = vi.fn<typeof area.listSecurityGroupChoices>();
vi.mock('../choices-queries', async (importOriginal) => {
  const real = await importOriginal<typeof import('../choices-queries')>();
  const { securityGroupChoices } = await vi.importActual<typeof import('../../../components/security-group-choices')>(
    '../../../components/security-group-choices',
  );
  return {
    ...real,
    groupChoices: (endpoint: string | undefined, vpcId?: string) => ({
      ...securityGroupChoices(endpoint, vpcId),
      read: async (at: string, text: string, token: string | undefined, signal: AbortSignal) => {
        const page = await readGroups(at, { name: text, ...(vpcId === undefined ? {} : { vpcId }) }, token, signal);
        return page.nextToken === undefined ? { items: page.choices } : { items: page.choices, next: page.nextToken };
      },
    }),
  };
});

// The cluster's page (S6) is unit s3's: the case stands in for it with a page of its own at S6's address, whose two
// reads, the cluster and the cluster lists, are answered by the case in the order it chooses.
const s6 = vi.hoisted(() => ({
  answers: [] as { of: 'cluster' | 'lists'; answer: () => void }[],
}));
vi.mock('../cluster-screens', async () => {
  const { useQuery } = await import('@tanstack/react-query');
  const { createElement } = await import('react');
  const { RDS_KEYS } = await vi.importActual<typeof import('../queries')>('../queries');
  const { CLUSTERS_NAVIGATION } = await vi.importActual<typeof import('../navigation')>('../navigation');
  const held = (of: 'cluster' | 'lists') =>
    new Promise<string>((resolve) => {
      s6.answers.push({
        of,
        answer: () => {
          resolve(of);
        },
      });
    });
  function StandInClusterPage({ params }: { params: Record<string, string | undefined> }) {
    const cluster = useQuery({ queryKey: RDS_KEYS.cluster(params.id), queryFn: () => held('cluster') });
    const lists = useQuery({ queryKey: RDS_KEYS.clusters(), queryFn: () => held('lists') });
    return createElement(
      'div',
      null,
      createElement('h1', null, params.id),
      createElement('p', null, `cluster ${cluster.data ?? 'pending'}, lists ${lists.data ?? 'pending'}`),
    );
  }
  return {
    CLUSTER_SCREENS: [
      {
        paths: ['/aws/rds/clusters/cluster/{id}'],
        title: ({ id }: { id?: string }) => id ?? '',
        crumbs: [{ text: 'DB clusters', href: '/aws/rds/clusters' }],
        navigation: CLUSTERS_NAVIGATION,
        Page: StandInClusterPage,
      },
    ],
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

const EMULATOR = { port: 9575, endpoint: 'https://127.0.0.1:9575' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8575';

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
  vi.restoreAllMocks();
});

const CREATE_PATH = '/aws/rds/clusters/create';

function open(path = CREATE_PATH) {
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
// What the emulator holds, as the readers answer it.

const PASSWORD = 'pa55-Word!x';

const VERSIONS: Record<string, choices.EngineVersionChoice[]> = {
  'aurora-postgresql': [
    { version: '16.4', description: 'Aurora PostgreSQL 16.4' },
    { version: '15.8', description: 'Aurora PostgreSQL 15.8' },
  ],
  'aurora-mysql': [{ version: '8.0.mysql_aurora.3.08.0', description: 'Aurora MySQL 3.08.0' }],
};

const SUBNET_GROUPS = [
  { name: 'default', description: 'default', vpcId: 'vpc-d', zones: ['us-east-1a'] },
  { name: 'other', description: 'another group', vpcId: 'vpc-x', zones: ['us-east-1b'] },
];

const ROWS = [{ StorageType: 'aurora' }, { StorageType: 'aurora-iopt1' }];

beforeEach(() => {
  s6.answers.length = 0;
  vi.mocked(choices.listEngineVersionChoices).mockImplementation((_at, engine) =>
    Promise.resolve({ choices: VERSIONS[engine] ?? [] }),
  );
  vi.mocked(choices.readDefaultVersion).mockImplementation(async (_at, engine) => VERSIONS[engine]?.[0]?.version);
  vi.mocked(choices.readOrderableRows).mockResolvedValue(ROWS);
  vi.mocked(choices.listSubnetGroupChoices).mockResolvedValue({ choices: SUBNET_GROUPS });
  vi.mocked(choices.findSubnetGroup).mockImplementation(async (at, name, signal) => {
    const page = await choices.listSubnetGroupChoices(at, undefined, signal);
    return page.choices.find((group) => group.name === name);
  });
  vi.mocked(choices.readDefaultVpcId).mockResolvedValue('vpc-d');
  const groups = [
    { id: 'sg-1', name: 'default', vpcId: 'vpc-d' },
    { id: 'sg-2', name: 'web', vpcId: 'vpc-d' },
    { id: 'sg-3', name: 'other', vpcId: 'vpc-x' },
  ];
  readGroups.mockImplementation(async (_at, { vpcId }) => ({
    choices: groups.filter((group) => group.vpcId === vpcId),
  }));
  vi.mocked(creating.createCluster).mockImplementation((_at, values) =>
    Promise.resolve(values.identifier.toLowerCase()),
  );
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (found === undefined) {
    throw new Error(`no field ${label}`);
  }
  return found;
}

function inputOf(label: string): HTMLInputElement {
  const input = field(label).getElement().querySelector('input');
  if (input === null) {
    throw new Error(`no input in ${label}`);
  }
  return input;
}

function type(label: string, value: string) {
  fireEvent.change(inputOf(label), { target: { value } });
}

function selectIn(label: string) {
  const found = createWrapper(field(label).getElement()).findSelect();
  if (found === null) {
    throw new Error(`no select in ${label}`);
  }
  return found;
}

function groupsField() {
  const found = createWrapper(field('Security groups - optional').getElement()).findMultiselect();
  if (found === null) {
    throw new Error('no multiselect');
  }
  return found;
}

function zonesField() {
  const found = createWrapper(field('Availability Zones').getElement()).findMultiselect();
  if (found === null) throw new Error('no Availability Zones multiselect');
  return found;
}

async function chooseZone(zone: string) {
  const zones = zonesField();
  zones.openDropdown();
  await waitFor(() => expect(zones.findDropdown().findOptionByValue(zone)).not.toBeNull());
  zones.selectOptionByValue(zone);
  zones.closeDropdown();
}

function engines() {
  const found = createWrapper(field('Engine').getElement()).findRadioGroup();
  if (found === null) {
    throw new Error('no engines');
  }
  return found;
}

function engineRadio(value: string) {
  const radio = engines().findInputByValue(value)?.getElement();
  if (radio === undefined) {
    throw new Error(`no engine radio for ${value}`);
  }
  return radio;
}

function chosenEngine(value: string) {
  return engineRadio(value).checked;
}

function chooseEngine(value: string) {
  engines().findInputByValue(value)?.click();
}

function triggerOf(label: string): string {
  return text(selectIn(label).findTrigger().getElement());
}

async function choose(label: string, value: string) {
  const select = selectIn(label);
  select.openDropdown();
  await waitFor(() => {
    expect(select.findDropdown().findOptionByValue(value)).not.toBeNull();
  });
  select.selectOptionByValue(value);
}

async function chooseGroup(value: string) {
  const groups = groupsField();
  groups.openDropdown();
  await waitFor(() => {
    expect(groups.findDropdown().findOptionByValue(value)).not.toBeNull();
  });
  groups.selectOptionByValue(value);
  groups.closeDropdown();
}

function expectShownVersions(version: string) {
  const dropdown = selectIn('Engine version - optional').findDropdown();
  const defaultOption = dropdown.findOptionByValue('');
  const versionOption = dropdown.findOptionByValue(version);
  expect(text(defaultOption?.findLabel().getElement())).toBe("The emulator's default");
  expect(text(versionOption?.findLabel().getElement())).toBe(version);
  expect(dropdown.findOptions()?.map((option) => option.getElement())).toEqual([
    defaultOption?.getElement(),
    versionOption?.getElement(),
  ]);
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create DB cluster' }));
}

async function opened() {
  await screen.findByRole('heading', { level: 1, name: 'Create DB cluster' });
  await waitFor(() => {
    expect(screen.queryByText('Checking Storage type')).not.toBeInTheDocument();
  });
}

function toggle(label: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: label }));
}

function addTag(key: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Key' }), { target: { value: key } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Value - optional' }), { target: { value } });
}

function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

/** The required fields filled, with a password made for the case. */
function fillRequired(identifier = 'aur-1') {
  type('DB cluster identifier', identifier);
  type('Master user name', 'admin1');
  type('Master password', PASSWORD);
}

describe('Create DB cluster', () => {
  it('opens with an empty identifier, Aurora PostgreSQL, the emulator\'s default, empty sign-in and database name, "Chosen by the emulator", no group and the page\'s description; no class, size or IOPS', async () => {
    open();
    await opened();
    expect(inputOf('DB cluster identifier').value).toBe('');
    const postgres = engineRadio('aurora-postgresql');
    const mysql = engineRadio('aurora-mysql');
    expect(postgres).toBeChecked();
    expect(mysql).not.toBeChecked();
    expect(postgres).toHaveAccessibleName('Aurora PostgreSQL');
    expect(mysql).toHaveAccessibleName('Aurora MySQL');
    expect(postgres).toHaveAccessibleDescription(
      "Aurora, PostgreSQL-compatible. The emulator's default version is 16.4.",
    );
    expect(mysql).toHaveAccessibleDescription(
      "Aurora, MySQL-compatible. The emulator's default version is 8.0.mysql_aurora.3.08.0.",
    );
    expect(
      engines()
        .findButtons()
        .map((button) => button.findNativeInput().getElement()),
    ).toEqual([postgres, mysql]);
    expect(triggerOf('Engine version - optional')).toContain("The emulator's default");
    expect(inputOf('Master user name').value).toBe('');
    expect(inputOf('Master password').value).toBe('');
    expect(text(field('Master password').findDescription()?.getElement())).toBe(
      'EmuForge Studio does not keep the password and the API does not return it: note it before you create the DB cluster.',
    );
    expect(inputOf('Database name - optional').value).toBe('');
    expect(triggerOf('DB subnet group - optional')).toContain('Chosen by the emulator');
    expect(groupsField().findTokens()).toEqual([]);
    expect(
      screen.getByText("Creates the cluster alone. Add its DB instances from the cluster's page."),
    ).toBeInTheDocument();
    const labels = PAGE.findAllFormFields().map((each) => text(each.findLabel()?.getElement()));
    expect(labels).not.toContain('DB instance class');
    expect(labels).not.toContain('Allocated storage (GiB)');
    expect(labels).not.toContain('Provisioned IOPS');
    expect(labels).toContain('Storage type');
    expect(choices.readOrderableRows).toHaveBeenCalledWith(
      ENGINE,
      'aurora-postgresql',
      '16.4',
      expect.any(AbortSignal),
    );
  });

  it("Aurora MySQL → the user name's constraint reads 16, and the versions offered are that engine's", async () => {
    open();
    await opened();
    const constraint = () => text(field('Master user name').findConstraint()?.getElement());
    expect(constraint()).toBe('1 to 63 letters and digits, beginning with a letter.');
    await choose('Engine version - optional', '15.8');
    chooseEngine('aurora-mysql');
    expect(constraint()).toBe('1 to 16 letters and digits, beginning with a letter.');
    expect(triggerOf('Engine version - optional')).toContain("The emulator's default");
    selectIn('Engine version - optional').openDropdown();
    await waitFor(() => {
      expectShownVersions('8.0.mysql_aurora.3.08.0');
    });
    expect(vi.mocked(choices.listEngineVersionChoices).mock.lastCall?.[1]).toBe('aurora-mysql');
  });

  it('"Create DB cluster" with a fault → its message at the field and nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(text(field('DB cluster identifier').findError()?.getElement())).toBe('Enter an identifier.');
    expect(text(field('Master user name').findError()?.getElement())).toBe('Enter a master user name.');
    expect(text(field('Master password').findError()?.getElement())).toBe('Enter a master password.');
    chooseEngine('aurora-mysql');
    fillRequired('aur--1');
    type('Master user name', 'a'.repeat(17));
    type('Master password', 'short');
    submit();
    expect(text(field('DB cluster identifier').findError()?.getElement())).toBe(
      'An identifier cannot have two hyphens in a row.',
    );
    expect(text(field('Master user name').findError()?.getElement())).toBe(
      'A master user name can have up to 16 characters.',
    );
    expect(text(field('Master password').findError()?.getElement())).toBe(
      'A master password has at least 8 characters.',
    );
    expect(creating.createCluster).not.toHaveBeenCalled();
  });

  it('every field filled → one CreateDBCluster with those values, the database name as DatabaseName; the cluster\'s page with "Creating DB cluster {id}"', async () => {
    const router = open();
    await opened();
    type('DB cluster identifier', 'Aur-1');
    chooseEngine('aurora-mysql');
    await choose('Engine version - optional', '8.0.mysql_aurora.3.08.0');
    type('Master user name', 'admin1');
    type('Master password', PASSWORD);
    type('Database name - optional', 'app');
    await choose('DB subnet group - optional', 'default');
    await chooseGroup('sg-1');
    await chooseGroup('sg-2');
    await chooseZone('us-east-1a');
    await choose('Storage type', 'aurora-iopt1');
    toggle('Encrypt storage');
    await choose('KMS key', KEY_ARN);
    toggle('Deletion protection');
    addTag('project', 'studio');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Creating DB cluster aur-1')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/aws/rds/clusters/cluster/aur-1');
    expect(creating.createCluster).toHaveBeenCalledTimes(1);
    expect(vi.mocked(creating.createCluster).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      {
        identifier: 'Aur-1',
        engine: 'aurora-mysql',
        engineVersion: '8.0.mysql_aurora.3.08.0',
        masterUsername: 'admin1',
        masterPassword: PASSWORD,
        databaseName: 'app',
        subnetGroupName: 'default',
        securityGroupIds: ['sg-1', 'sg-2'],
        availabilityZones: ['us-east-1a'],
        storageType: 'aurora-iopt1',
        encrypted: true,
        kmsKeyId: KEY_ARN,
        deletionProtection: true,
        tags: [{ key: 'project', value: 'studio' }],
      },
    ]);
  });

  it('the required fields only → sent with no version, database name, subnet group or security group', async () => {
    open();
    await opened();
    fillRequired();
    submit();
    await waitFor(() => {
      expect(creating.createCluster).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(creating.createCluster).mock.calls[0]?.[1]).toEqual({
      identifier: 'aur-1',
      engine: 'aurora-postgresql',
      masterUsername: 'admin1',
      masterPassword: PASSWORD,
    });
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    const message = 'DB cluster already exists';
    vi.mocked(creating.createCluster).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateDBCluster', code: 'DBClusterAlreadyExistsFault', message }),
    );
    const router = open();
    await opened();
    fillRequired();
    type('Database name - optional', 'app');
    await choose('DB subnet group - optional', 'default');
    await choose('Storage type', 'aurora-iopt1');
    await chooseZone('us-east-1a');
    await chooseGroup('sg-1');
    toggle('Encrypt storage');
    await choose('KMS key', KEY_ARN);
    toggle('Deletion protection');
    addTag('project', 'studio');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('DBClusterAlreadyExistsFault');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('DB cluster identifier').value).toBe('aur-1');
    expect(inputOf('Master user name').value).toBe('admin1');
    expect(inputOf('Master password').value).toBe(PASSWORD);
    expect(inputOf('Database name - optional').value).toBe('app');
    expect(triggerOf('DB subnet group - optional')).toContain('default');
    expect(triggerOf('Storage type')).toContain('aurora-iopt1');
    expect(text(zonesField().findTokens()[0]?.getElement())).toContain('us-east-1a');
    expect(groupsField().findTokens()).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Encrypt storage' })).toBeChecked();
    expect(triggerOf('KMS key')).toContain('alias/create-test');
    expect(screen.getByRole('checkbox', { name: 'Deletion protection' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveValue('project');
    expect(screen.getByRole('textbox', { name: 'Value - optional' })).toHaveValue('studio');
  });

  it('a 501 → "not implemented by the emulator" with CreateDBCluster', async () => {
    vi.mocked(creating.createCluster).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateDBCluster' }),
    );
    open();
    await opened();
    fillRequired();
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateDBCluster');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(creating.createCluster).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    fillRequired();
    submit();
    const button = await screen.findByRole('button', { name: 'Creating' });
    fireEvent.click(button);
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    expect(creating.createCluster).toHaveBeenCalledTimes(1);
    act(() => {
      finish('aur-1');
    });
    await waitFor(() => {
      expect(screen.getByText('Creating DB cluster aur-1')).toBeInTheDocument();
    });
  });

  for (const order of ['the cluster first', 'the lists first'] as const) {
    it(`after "Create DB cluster" is answered, the reads it starts answering in another order (${order}) → the cluster's page with "Creating DB cluster {id}"`, async () => {
      const router = open();
      await opened();
      fillRequired();
      submit();
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/rds/clusters/cluster/aur-1');
      });
      await waitFor(() => {
        expect(s6.answers.map((each) => each.of).sort()).toEqual(['cluster', 'lists']);
      });
      const first = order === 'the cluster first' ? 'cluster' : 'lists';
      for (const of of [first, first === 'cluster' ? 'lists' : 'cluster']) {
        act(() => {
          s6.answers.find((each) => each.of === of)?.answer();
        });
      }
      await waitFor(() => {
        expect(screen.getByText('cluster cluster, lists lists')).toBeInTheDocument();
      });
      expect(screen.getByText('Creating DB cluster aur-1')).toBeInTheDocument();
    });
  }

  it('"Cancel" with nothing entered → the clusters list at once; after an entry → the discard dialog', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();

    await act(() => router.navigate(CREATE_PATH));
    await opened();
    chooseEngine('aurora-mysql');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(chosenEngine('aurora-mysql')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/clusters');
    });
    expect(creating.createCluster).not.toHaveBeenCalled();
  });

  it('retains a storage type if the new catalogue has it, otherwise clears it and drops a late read', async () => {
    let finish!: (rows: typeof ROWS) => void;
    open();
    await opened();
    await choose('Storage type', 'aurora-iopt1');
    chooseEngine('aurora-mysql');
    await opened();
    expect(triggerOf('Storage type')).toContain('aurora-iopt1');

    vi.mocked(choices.readOrderableRows).mockImplementation(async (_at, engine) =>
      engine === 'aurora-postgresql'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : ROWS.slice(0, 1),
    );
    chooseEngine('aurora-postgresql');
    await screen.findByText('Checking Storage type');
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    chooseEngine('aurora-mysql');
    await opened();
    await act(async () => finish(ROWS));
    expect(triggerOf('Storage type')).toContain('Chosen by the emulator');
    const storage = selectIn('Storage type');
    storage.openDropdown();
    expect(storage.findDropdown().findOptionByValue('aurora')).not.toBeNull();
    expect(storage.findDropdown().findOptionByValue('aurora-iopt1')).toBeNull();
  });

  it('offers the chosen subnet group’s zones and drops a zone absent from the next group', async () => {
    open();
    await opened();
    await choose('DB subnet group - optional', 'other');
    await chooseZone('us-east-1b');
    expect(zonesField().findTokens()).toHaveLength(1);
    await choose('DB subnet group - optional', 'default');
    expect(zonesField().findTokens()).toHaveLength(0);
    await chooseZone('us-east-1a');
  });

  it('shows a 501 for the default version at Engine and Storage type and still sends the cluster', async () => {
    vi.mocked(choices.readDefaultVersion).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeDBEngineVersions' }),
    );
    open();
    await opened();
    for (const label of ['Engine', 'Storage type']) {
      expect(text(field(label).getElement())).toContain('501 Not Implemented for DescribeDBEngineVersions');
    }
    expect(triggerOf('Storage type')).toContain('Chosen by the emulator');
    expect(choices.readOrderableRows).not.toHaveBeenCalled();
    fillRequired();
    submit();
    expect(creating.createCluster).toHaveBeenCalledTimes(1);
    expect(vi.mocked(creating.createCluster).mock.calls[0]?.[1]).not.toHaveProperty('storageType');
  });

  it.each([false, true])('uses the default VPC for an empty default subnet group (explicit: %s)', async (explicit) => {
    vi.mocked(choices.listSubnetGroupChoices).mockResolvedValue({
      choices: [{ name: 'default', vpcId: 'vpc-unused' }],
    });
    open();
    await opened();
    if (explicit) await choose('DB subnet group - optional', 'default');
    await chooseGroup('sg-1');
    expect(choices.readDefaultVpcId).toHaveBeenCalledWith(ENGINE, expect.any(AbortSignal));
    expect(readGroups).toHaveBeenLastCalledWith(
      ENGINE,
      { name: '', vpcId: 'vpc-d' },
      undefined,
      expect.any(AbortSignal),
    );
    const zones = zonesField();
    zones.openDropdown();
    expect(zones.findDropdown().findOptions() ?? []).toEqual([]);
  });

  it.each(['DescribeDBSubnetGroups', 'DescribeVpcs'])(
    'shows %s 501 at both placement fields without blocking create',
    async (operation) => {
      const failure = new RequestError({ kind: 'not-implemented', operation });
      if (operation === 'DescribeDBSubnetGroups') {
        vi.mocked(choices.findSubnetGroup).mockRejectedValue(failure);
      } else {
        vi.mocked(choices.findSubnetGroup).mockResolvedValue({ name: 'default', vpcId: 'vpc-unused' });
        vi.mocked(choices.readDefaultVpcId).mockRejectedValue(failure);
      }
      open();
      await opened();
      await waitFor(() => {
        for (const label of ['Security groups - optional', 'Availability Zones']) {
          expect(text(field(label).getElement())).toContain(`501 Not Implemented for ${operation}`);
        }
      });
      expect(groupsField().findTrigger().getElement()).toBeDisabled();
      expect(zonesField().findTokens()).toEqual([]);
      zonesField().openDropdown();
      expect(zonesField().findDropdown().findOptions() ?? []).toEqual([]);
      fillRequired();
      submit();
      expect(creating.createCluster).toHaveBeenCalledTimes(1);
      const request = vi.mocked(creating.createCluster).mock.calls[0]?.[1];
      expect(request).not.toHaveProperty('securityGroupIds');
      expect(request).not.toHaveProperty('availabilityZones');
    },
  );

  it('the page names its resources "DB clusters" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These DB clusters are in your local emulator')).toBeInTheDocument();
  });
});
