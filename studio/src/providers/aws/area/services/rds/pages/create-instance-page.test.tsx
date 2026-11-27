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
import * as api from '../api';
import * as choices from '../choices-api';
import * as creating from '../create-api';

// S2 rendered inside the area's layout, with the calls of `choices-api.ts`, `create-api.ts`, the area's security
// groups and, for the instance's page the create leads to, `api.ts` answered by the case (their own tests prove the
// calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listInstances: vi.fn(), getInstance: vi.fn(), actOnInstance: vi.fn() };
});

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
  vi.restoreAllMocks();
});

const CREATE_PATH = '/aws/rds/instances/create';

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
  postgres: [
    { version: '18.3', description: 'PostgreSQL 18.3-R1' },
    { version: '17.7', description: 'PostgreSQL 17.7-R1' },
  ],
  mysql: [{ version: '8.4.7', description: 'MySQL 8.4.7' }],
  mariadb: [{ version: '11.4.8', description: 'MariaDB 11.4.8' }],
};

function instance(id: string): api.InstanceRead {
  return {
    found: true,
    instance: {
      id,
      status: 'creating',
      engine: 'postgres',
      parameterGroups: [],
      securityGroups: [],
      deletionProtection: false,
      tags: [],
    },
  };
}

const SUBNET_GROUPS = [
  { name: 'default', description: 'default', vpcId: 'vpc-d', zones: ['us-east-1a'] },
  { name: 'other', description: 'another group', vpcId: 'vpc-x', zones: ['us-east-1b'] },
];

const ROWS = [
  { DBInstanceClass: 'db.t3.micro', StorageType: 'gp2' },
  { DBInstanceClass: 'db.t3.small', StorageType: 'gp2' },
  {
    DBInstanceClass: 'db.t3.small',
    StorageType: 'io1',
    MinStorageSize: 100,
    MaxStorageSize: 65536,
    MinIopsPerDbInstance: 1000,
    MaxIopsPerDbInstance: 64000,
  },
];

beforeEach(() => {
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
  vi.mocked(creating.createInstance).mockImplementation((_at, values) =>
    Promise.resolve(values.identifier.toLowerCase()),
  );
  vi.mocked(api.getInstance).mockImplementation((_at, id) => Promise.resolve(instance(id)));
  vi.mocked(api.listInstances).mockResolvedValue({ instances: [] });
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
  fireEvent.click(screen.getByRole('button', { name: 'Create DB instance' }));
}

async function opened() {
  await screen.findByRole('heading', { level: 1, name: 'Create DB instance' });
  await waitFor(() => {
    expect(screen.queryByText('Checking DB instance class')).not.toBeInTheDocument();
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
function fillRequired(identifier = 'app-db') {
  type('DB instance identifier', identifier);
  type('Master user name', 'admin1');
  type('Master password', PASSWORD);
}

describe('Create DB instance', () => {
  it('opens with an empty identifier, PostgreSQL, the emulator\'s default, db.t3.micro, 20, empty sign-in and database name, "Chosen by the emulator" and no group', async () => {
    open();
    await opened();
    expect(inputOf('DB instance identifier').value).toBe('');
    const postgres = engineRadio('postgres');
    const mysql = engineRadio('mysql');
    const mariadb = engineRadio('mariadb');
    expect(postgres).toBeChecked();
    expect(mysql).not.toBeChecked();
    expect(mariadb).not.toBeChecked();
    expect(postgres).toHaveAccessibleName('PostgreSQL');
    expect(mysql).toHaveAccessibleName('MySQL');
    expect(mariadb).toHaveAccessibleName('MariaDB');
    expect(postgres).toHaveAccessibleDescription("PostgreSQL. The emulator's default version is 18.3.");
    expect(mysql).toHaveAccessibleDescription("MySQL. The emulator's default version is 8.4.7.");
    expect(mariadb).toHaveAccessibleDescription("MariaDB. The emulator's default version is 11.4.8.");
    expect(
      engines()
        .findButtons()
        .map((button) => button.findNativeInput().getElement()),
    ).toEqual([postgres, mysql, mariadb]);
    expect(triggerOf('Engine version - optional')).toContain("The emulator's default");
    expect(triggerOf('DB instance class')).toContain('db.t3.micro');
    expect(choices.readOrderableRows).toHaveBeenCalledWith(ENGINE, 'postgres', '18.3', expect.any(AbortSignal));
    expect(inputOf('Allocated storage (GiB)').value).toBe('20');
    expect(inputOf('Master user name').value).toBe('');
    expect(inputOf('Master password').value).toBe('');
    expect(inputOf('Database name - optional').value).toBe('');
    expect(triggerOf('DB subnet group - optional')).toContain('Chosen by the emulator');
    expect(groupsField().findTokens()).toEqual([]);
    expect(text(groupsField().findTrigger().getElement())).toContain('Choose security groups');
    expect(choices.listEngineVersionChoices).not.toHaveBeenCalled();
  });

  it("MySQL or MariaDB → the user name's constraint reads 16; a version chosen, then another engine → the default again and the new engine's versions", async () => {
    open();
    await opened();
    const constraint = () => text(field('Master user name').findConstraint()?.getElement());
    expect(constraint()).toBe('1 to 63 letters and digits, beginning with a letter.');
    chooseEngine('mysql');
    expect(constraint()).toBe('1 to 16 letters and digits, beginning with a letter.');
    chooseEngine('mariadb');
    expect(constraint()).toBe('1 to 16 letters and digits, beginning with a letter.');
    chooseEngine('postgres');
    expect(constraint()).toBe('1 to 63 letters and digits, beginning with a letter.');

    await choose('Engine version - optional', '17.7');
    expect(triggerOf('Engine version - optional')).toContain('17.7');
    chooseEngine('mysql');
    expect(triggerOf('Engine version - optional')).toContain("The emulator's default");
    selectIn('Engine version - optional').openDropdown();
    await waitFor(() => {
      expectShownVersions('8.4.7');
    });
    expect(vi.mocked(choices.listEngineVersionChoices).mock.lastCall?.[1]).toBe('mysql');
  });

  it('"Create DB instance" with a fault → its message at the field and nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(text(field('DB instance identifier').findError()?.getElement())).toBe('Enter an identifier.');
    expect(text(field('Master user name').findError()?.getElement())).toBe('Enter a master user name.');
    expect(text(field('Master password').findError()?.getElement())).toBe('Enter a master password.');
    expect(document.activeElement).toBe(inputOf('DB instance identifier'));

    fillRequired('1abc');
    type('Allocated storage (GiB)', '19');
    type('Database name - optional', 'a-b');
    submit();
    expect(text(field('DB instance identifier').findError()?.getElement())).toBe('An identifier begins with a letter.');
    expect(text(field('Allocated storage (GiB)').findError()?.getElement())).toBe(
      'The storage is a whole number from 20 to 65536.',
    );
    expect(text(field('Database name - optional').findError()?.getElement())).toBe(
      'A database name can hold letters, digits and underscores only.',
    );
    expect(field('Master password').findError()).toBeNull();
    expect(creating.createInstance).not.toHaveBeenCalled();
  });

  it('every field filled → one CreateDBInstance with those values; the instance\'s page at the answer\'s identifier with "Creating DB instance {id}"', async () => {
    const router = open();
    await opened();
    type('DB instance identifier', 'App-DB');
    chooseEngine('mysql');
    await choose('Engine version - optional', '8.4.7');
    await choose('DB instance class', 'db.t3.small');
    await choose('Storage type', 'io1');
    type('Allocated storage (GiB)', '100');
    type('Provisioned IOPS', '3000');
    type('Master user name', 'admin1');
    type('Master password', PASSWORD);
    type('Database name - optional', 'app_db1');
    await choose('DB subnet group - optional', 'default');
    await chooseGroup('sg-1');
    await chooseGroup('sg-2');
    await choose('Availability Zone', 'us-east-1a');
    toggle('Encrypt storage');
    await choose('KMS key', KEY_ARN);
    toggle('Deletion protection');
    addTag('project', 'studio');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Creating DB instance app-db')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/aws/rds/instances/instance/app-db');
    expect(creating.createInstance).toHaveBeenCalledTimes(1);
    expect(vi.mocked(creating.createInstance).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      {
        identifier: 'App-DB',
        engine: 'mysql',
        engineVersion: '8.4.7',
        instanceClass: 'db.t3.small',
        allocatedStorage: 100,
        masterUsername: 'admin1',
        masterPassword: PASSWORD,
        dbName: 'app_db1',
        subnetGroupName: 'default',
        securityGroupIds: ['sg-1', 'sg-2'],
        availabilityZone: 'us-east-1a',
        storageType: 'io1',
        iops: 3000,
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
      expect(creating.createInstance).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(creating.createInstance).mock.calls[0]?.[1]).toEqual({
      identifier: 'app-db',
      engine: 'postgres',
      instanceClass: 'db.t3.micro',
      allocatedStorage: 20,
      masterUsername: 'admin1',
      masterPassword: PASSWORD,
    });
  });

  it('after a create the password is in no address, no storage entry, no console message and not in the result handed over', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    localStorage.clear();
    sessionStorage.clear();
    const router = open();
    await opened();
    fillRequired();
    submit();
    await waitFor(() => {
      expect(screen.getByText('Creating DB instance app-db')).toBeInTheDocument();
    });
    const { pathname, search, hash, state } = router.state.location;
    expect(`${pathname}${search}${hash}${JSON.stringify(state ?? null)}`).not.toContain(PASSWORD);
    expect(window.location.href).not.toContain(PASSWORD);
    const stored = [localStorage, sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, n) => {
        const key = storage.key(n) ?? '';
        return `${key}=${storage.getItem(key) ?? ''}`;
      }),
    );
    expect(stored.join('\n')).not.toContain(PASSWORD);
    expect(logged.map((each) => String(each)).join('\n')).not.toContain(PASSWORD);
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    const message = 'DB instance already exists';
    vi.mocked(creating.createInstance).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateDBInstance', code: 'DBInstanceAlreadyExists', message }),
    );
    const router = open();
    await opened();
    fillRequired();
    chooseEngine('mariadb');
    type('Database name - optional', 'app');
    await choose('DB subnet group - optional', 'default');
    await choose('DB instance class', 'db.t3.small');
    await choose('Storage type', 'io1');
    type('Allocated storage (GiB)', '100');
    type('Provisioned IOPS', '3000');
    await choose('Availability Zone', 'us-east-1a');
    await chooseGroup('sg-1');
    toggle('Encrypt storage');
    await choose('KMS key', KEY_ARN);
    toggle('Deletion protection');
    addTag('project', 'studio');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('DBInstanceAlreadyExists');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('DB instance identifier').value).toBe('app-db');
    expect(inputOf('Master user name').value).toBe('admin1');
    expect(inputOf('Master password').value).toBe(PASSWORD);
    expect(inputOf('Database name - optional').value).toBe('app');
    expect(chosenEngine('mariadb')).toBe(true);
    expect(triggerOf('DB subnet group - optional')).toContain('default');
    expect(triggerOf('DB instance class')).toContain('db.t3.small');
    expect(triggerOf('Storage type')).toContain('io1');
    expect(inputOf('Allocated storage (GiB)')).toHaveValue('100');
    expect(inputOf('Provisioned IOPS')).toHaveValue('3000');
    expect(triggerOf('Availability Zone')).toContain('us-east-1a');
    expect(groupsField().findTokens()).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Encrypt storage' })).toBeChecked();
    expect(triggerOf('KMS key')).toContain('alias/create-test');
    expect(screen.getByRole('checkbox', { name: 'Deletion protection' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveValue('project');
    expect(screen.getByRole('textbox', { name: 'Value - optional' })).toHaveValue('studio');
  });

  it('a 501 → "not implemented by the emulator" with CreateDBInstance', async () => {
    vi.mocked(creating.createInstance).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateDBInstance' }),
    );
    open();
    await opened();
    fillRequired();
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateDBInstance');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(creating.createInstance).mockImplementation(
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
    expect(creating.createInstance).toHaveBeenCalledTimes(1);
    act(() => {
      finish('app-db');
    });
    await waitFor(() => {
      expect(screen.getByText('Creating DB instance app-db')).toBeInTheDocument();
    });
  });

  for (const order of ['the instance first', 'the lists first'] as const) {
    it(`after the create is answered, its reads answering in another order (${order}) → the instance's page with "Creating DB instance {id}"`, async () => {
      const answers: { instance?: () => void; list?: () => void } = {};
      vi.mocked(api.getInstance).mockImplementation(
        (_at, id) =>
          new Promise((resolve) => {
            answers.instance = () => {
              resolve(instance(id));
            };
          }),
      );
      vi.mocked(api.listInstances).mockImplementation(
        () =>
          new Promise((resolve) => {
            answers.list = () => {
              resolve({ instances: [] });
            };
          }),
      );
      const router = open('/aws/rds/instances');
      await waitFor(() => {
        expect(api.listInstances).toHaveBeenCalled();
      });
      act(() => {
        answers.list?.();
      });
      await act(() => router.navigate(CREATE_PATH));
      await opened();
      fillRequired();
      submit();
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/rds/instances/instance/app-db');
      });
      await waitFor(() => {
        expect(answers.instance).toBeDefined();
      });
      if (order === 'the instance first') {
        act(() => {
          answers.instance?.();
        });
        act(() => {
          answers.list?.();
        });
      } else {
        act(() => {
          answers.list?.();
        });
        act(() => {
          answers.instance?.();
        });
      }
      await waitFor(() => {
        expect(screen.getByText('Creating DB instance app-db')).toBeInTheDocument();
      });
      expect(screen.getByRole('heading', { level: 1, name: 'app-db' })).toBeInTheDocument();
    });
  }

  it('keeps a class across engines that offer it and clears it when the next engine does not', async () => {
    vi.mocked(choices.readOrderableRows).mockImplementation(async (_at, engine) =>
      engine === 'mariadb' ? ROWS.filter((row) => row.DBInstanceClass !== 'db.t3.micro') : ROWS,
    );
    open();
    await opened();
    chooseEngine('mysql');
    await opened();
    expect(triggerOf('DB instance class')).toContain('db.t3.micro');
    chooseEngine('mariadb');
    await opened();
    expect(triggerOf('DB instance class')).toBe('Choose a class');
  });

  it('blocks submit while an explicit version’s orderable rows are pending', async () => {
    let finish!: (rows: typeof ROWS) => void;
    vi.mocked(choices.readOrderableRows).mockImplementation(async (_at, _engine, version) =>
      version === '17.7'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : ROWS,
    );
    open();
    await opened();
    fillRequired();
    await choose('Engine version - optional', '17.7');
    await screen.findByText('Checking DB instance class');
    await waitFor(() =>
      expect(choices.readOrderableRows).toHaveBeenCalledWith(ENGINE, 'postgres', '17.7', expect.any(AbortSignal)),
    );
    submit();
    expect(creating.createInstance).not.toHaveBeenCalled();
    act(() => finish(ROWS));
    await opened();
    submit();
    expect(creating.createInstance).toHaveBeenCalledTimes(1);
  });

  it('drops an earlier engine’s late rows', async () => {
    let finish!: (rows: typeof ROWS) => void;
    vi.mocked(choices.readOrderableRows).mockImplementation(async (_at, engine) =>
      engine === 'postgres'
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : ROWS.slice(0, 1),
    );
    open();
    await screen.findByText('Checking DB instance class');
    await waitFor(() =>
      expect(choices.readOrderableRows).toHaveBeenCalledWith(ENGINE, 'postgres', '18.3', expect.any(AbortSignal)),
    );
    chooseEngine('mysql');
    await opened();
    await act(async () => finish(ROWS));
    const select = selectIn('DB instance class');
    select.openDropdown();
    expect(select.findDropdown().findOptionByValue('db.t3.micro')).not.toBeNull();
    expect(select.findDropdown().findOptionByValue('db.t3.small')).toBeNull();
  });

  it('resets to emulator storage when the next class lacks the selected type', async () => {
    open();
    await opened();
    await choose('DB instance class', 'db.t3.small');
    await choose('Storage type', 'io1');
    await choose('DB instance class', 'db.t3.micro');
    expect(triggerOf('Storage type')).toContain('Chosen by the emulator');
    expect(screen.queryByText('Provisioned IOPS')).not.toBeInTheDocument();
  });

  it('takes default placement from the group’s subnets, clearing incompatible groups and zone when it changes', async () => {
    open();
    await opened();
    await chooseGroup('sg-1');
    await choose('Availability Zone', 'us-east-1a');
    expect(readGroups).toHaveBeenLastCalledWith(
      ENGINE,
      { name: '', vpcId: 'vpc-d' },
      undefined,
      expect.any(AbortSignal),
    );
    expect(choices.readDefaultVpcId).not.toHaveBeenCalled();

    await choose('DB subnet group - optional', 'other');
    expect(groupsField().findTokens()).toEqual([]);
    expect(triggerOf('Availability Zone')).toContain('No preference');
    await chooseGroup('sg-3');
    expect(readGroups).toHaveBeenLastCalledWith(
      ENGINE,
      { name: '', vpcId: 'vpc-x' },
      undefined,
      expect.any(AbortSignal),
    );
    await choose('Availability Zone', 'us-east-1b');
  });

  it('Multi-AZ clears and disables the zone and sends MultiAZ alone', async () => {
    open();
    await opened();
    fillRequired();
    await choose('Availability Zone', 'us-east-1a');
    toggle('Multi-AZ');
    expect(selectIn('Availability Zone').findTrigger().getElement()).toBeDisabled();
    expect(triggerOf('Availability Zone')).toContain('No preference');
    submit();
    expect(creating.createInstance).toHaveBeenCalledTimes(1);
    const request = vi.mocked(creating.createInstance).mock.calls[0]?.[1];
    expect(request?.multiAz).toBe(true);
    expect(request).not.toHaveProperty('availabilityZone');
  });

  it('opens without a class if the initial rows lack it and focuses the missing field on submit', async () => {
    vi.mocked(choices.readOrderableRows).mockResolvedValue(ROWS.slice(1));
    open();
    await opened();
    expect(triggerOf('DB instance class')).toBe('Choose a class');
    fillRequired();
    submit();
    expect(screen.getByText('Choose a class.')).toBeInTheDocument();
    expect(selectIn('DB instance class').findTrigger().getElement()).toHaveFocus();
    expect(creating.createInstance).not.toHaveBeenCalled();
  });

  it('reports both insufficient size and missing IOPS on io1', async () => {
    open();
    await opened();
    fillRequired();
    await choose('DB instance class', 'db.t3.small');
    await choose('Storage type', 'io1');
    submit();
    expect(text(field('Allocated storage (GiB)').findError()?.getElement())).toContain(
      'The storage is a whole number from 100 to 65536 for io1.',
    );
    expect(screen.getByText('Enter the IOPS.')).toBeInTheDocument();
    expect(creating.createInstance).not.toHaveBeenCalled();
  });

  it('reports a tag without a key and asks before discarding added tags', async () => {
    open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument());
    fillRequired();
    fireEvent.change(screen.getByRole('textbox', { name: 'Value - optional' }), { target: { value: 'dev' } });
    submit();
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveAccessibleDescription('Enter a key.');
    expect(creating.createInstance).not.toHaveBeenCalled();
  });

  it('a choice list that failed to load does not keep the form from being sent', async () => {
    vi.mocked(choices.listSubnetGroupChoices).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DescribeDBSubnetGroups', code: 'InternalError', message: 'boom' }),
    );
    open();
    await opened();
    selectIn('DB subnet group - optional').openDropdown();
    await waitFor(() => {
      expect(text(selectIn('DB subnet group - optional').findDropdown().getElement())).toContain(
        'The DB subnet groups could not be loaded',
      );
    });
    fillRequired();
    submit();
    await waitFor(() => {
      expect(creating.createInstance).toHaveBeenCalledTimes(1);
    });
  });

  it('"Cancel" with nothing entered → the instances list at once', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await opened();
    type('DB instance identifier', 'app-db');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('DB instance identifier').value).toBe('app-db');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/rds/instances');
    });
    expect(creating.createInstance).not.toHaveBeenCalled();
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
    const zone = selectIn('Availability Zone');
    zone.openDropdown();
    const dropdown = zone.findDropdown();
    expect(dropdown.findOptions()).toHaveLength(1);
    expect(text(dropdown.findOptionByValue('')?.findLabel().getElement())).toBe('No preference');
    zone.closeDropdown();
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
        for (const label of ['Security groups - optional', 'Availability Zone']) {
          expect(text(field(label).getElement())).toContain(`501 Not Implemented for ${operation}`);
        }
      });
      expect(groupsField().findTrigger().getElement()).toBeDisabled();
      expect(selectIn('Availability Zone').findTrigger().getElement()).toBeDisabled();
      fillRequired();
      submit();
      expect(creating.createInstance).toHaveBeenCalledTimes(1);
      const request = vi.mocked(creating.createInstance).mock.calls[0]?.[1];
      expect(request).not.toHaveProperty('securityGroupIds');
      expect(request).not.toHaveProperty('availabilityZone');
    },
  );

  it('the page names its resources "DB instances" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These DB instances are in your local emulator')).toBeInTheDocument();
  });
});
