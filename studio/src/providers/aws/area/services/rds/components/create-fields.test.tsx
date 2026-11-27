import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import * as area from '../../../components/security-group-choices';
import type { SecurityGroupChoice } from '../../../components/security-group-choices';
import * as api from '../choices-api';
import type { EngineVersionChoice, SubnetGroupChoice } from '../choices-api';
import { useDefaultVersions } from '../choices-queries';
import {
  DatabaseNameField,
  EngineField,
  EngineVersionField,
  IdentifierField,
  MasterPasswordField,
  MasterUserNameField,
  SecurityGroupsField,
  StorageField,
  SubnetGroupField,
} from './create-fields';

// The fields of the two create forms in a stand-in form, the readers of `choices-api.ts` and the area's security
// groups answered by the case (their own tests prove the calls).

vi.mock('../choices-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../choices-api')>();
  return { ...real, listEngineVersionChoices: vi.fn(), listSubnetGroupChoices: vi.fn(), readDefaultVersion: vi.fn() };
});

// The area's source reads through its own module's reader, which a mock of the module cannot reach from inside it;
// the source the field is given is the area's own, with its reader answered by the case.
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

const ENGINE = 'http://127.0.0.1:8398';
const CONNECTION: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9398, endpoint: 'https://127.0.0.1:9398' } },
  engineOrigin: ENGINE,
};

interface Errors {
  identifier?: string;
  storage?: string;
  user?: string;
  password?: string;
  dbName?: string;
}

function Fields({
  errors = {},
  engine = 'postgres',
  what = 'the DB instance',
}: {
  errors?: Errors;
  engine?: string;
  what?: string;
}) {
  const [version, setVersion] = useState<EngineVersionChoice>();
  const [subnetGroup, setSubnetGroup] = useState<SubnetGroupChoice>();
  const [groups, setGroups] = useState<SecurityGroupChoice[]>([]);
  const [values, setValues] = useState({
    identifier: '',
    storage: '',
    user: '',
    password: '',
    dbName: '',
  });
  const set = (key: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  return (
    <>
      <IdentifierField
        label="DB instance identifier"
        value={values.identifier}
        error={errors.identifier}
        onChange={set('identifier')}
      />
      <EngineVersionField engine={engine} connection={CONNECTION} value={version} onChange={setVersion} />
      <StorageField value={values.storage} error={errors.storage} onChange={set('storage')} />
      <MasterUserNameField engine={engine} value={values.user} error={errors.user} onChange={set('user')} />
      <MasterPasswordField what={what} value={values.password} error={errors.password} onChange={set('password')} />
      <DatabaseNameField value={values.dbName} error={errors.dbName} onChange={set('dbName')} />
      <SubnetGroupField connection={CONNECTION} value={subnetGroup} onChange={setSubnetGroup} />
      <SecurityGroupsField connection={CONNECTION} value={groups} onChange={setGroups} />
    </>
  );
}

function open(props: Parameters<typeof Fields>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Fields {...props} />
    </QueryClientProvider>,
  );
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (found === undefined) {
    throw new Error(`no field ${label}`);
  }
  return found;
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

const failed = (operation: string) =>
  new RequestError({ kind: 'other', operation, code: 'InternalError', message: 'boom' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listEngineVersionChoices).mockResolvedValue({
    choices: [{ version: '18.3', description: 'PostgreSQL 18.3-R1' }],
  });
  vi.mocked(api.listSubnetGroupChoices).mockResolvedValue({
    choices: [{ name: 'default', description: 'default', vpcId: 'vpc-d' }],
  });
  readGroups.mockResolvedValue({
    choices: [
      { id: 'sg-1', name: 'default', vpcId: 'vpc-d' },
      { id: 'sg-2', name: 'web', vpcId: 'vpc-x' },
    ],
  });
});

describe('the create fields', () => {
  it('each field shows its label and its constraint text or description from the start', () => {
    open();
    expect(text(field('DB instance identifier').findConstraint()?.getElement())).toBe(
      '1 to 63 characters: letters, digits and hyphens. It begins with a letter, does not end with a hyphen and has no two hyphens in a row. Stored in lower case.',
    );
    expect(text(field('Allocated storage (GiB)').findConstraint()?.getElement())).toBe(
      'A whole number from 20 to 65536.',
    );
    expect(text(field('Master user name').findConstraint()?.getElement())).toBe(
      '1 to 63 letters and digits, beginning with a letter.',
    );
    expect(text(field('Master password').findConstraint()?.getElement())).toBe(
      '8 to 128 printable ASCII characters, without /, @, " and spaces.',
    );
    expect(text(field('Database name - optional').findConstraint()?.getElement())).toBe(
      '1 to 63 letters, digits and underscores, beginning with a letter.',
    );
    expect(field('Engine version - optional')).toBeDefined();
    expect(field('DB subnet group - optional')).toBeDefined();
    expect(field('Security groups - optional')).toBeDefined();
    for (const label of ['DB instance identifier', 'Master user name', 'Master password']) {
      expect(field(label).findError()).toBeNull();
    }
  });

  it("a failed check's message is shown at its field with the constraint text beside it", () => {
    open({
      errors: {
        identifier: 'An identifier begins with a letter.',
        storage: 'Enter the storage.',
        user: 'A master user name can have up to 16 characters.',
        password: 'A master password has at least 8 characters.',
        dbName: 'A database name begins with a letter.',
      },
      engine: 'mysql',
    });
    expect(text(field('DB instance identifier').findError()?.getElement())).toBe('An identifier begins with a letter.');
    expect(text(field('DB instance identifier').findConstraint()?.getElement())).toContain('Stored in lower case.');
    expect(text(field('Allocated storage (GiB)').findError()?.getElement())).toBe('Enter the storage.');
    expect(text(field('Allocated storage (GiB)').findConstraint()?.getElement())).toBe(
      'A whole number from 20 to 65536.',
    );
    expect(text(field('Master user name').findError()?.getElement())).toBe(
      'A master user name can have up to 16 characters.',
    );
    expect(text(field('Master user name').findConstraint()?.getElement())).toBe(
      '1 to 16 letters and digits, beginning with a letter.',
    );
    expect(text(field('Master password').findError()?.getElement())).toBe(
      'A master password has at least 8 characters.',
    );
    expect(text(field('Master password').findConstraint()?.getElement())).toContain('8 to 128');
    expect(text(field('Database name - optional').findError()?.getElement())).toBe(
      'A database name begins with a letter.',
    );
    expect(text(field('Database name - optional').findConstraint()?.getElement())).toContain('underscores');
  });

  it('the password is typed into a password field, and its description names what is being created', () => {
    const { unmount } = open();
    const input = field('Master password').getElement().querySelector('input:not([type="checkbox"])');
    expect(input?.getAttribute('type')).toBe('password');
    expect(text(field('Master password').findDescription()?.getElement())).toBe(
      'EmuForge Studio does not keep the password and the API does not return it: note it before you create the DB instance.',
    );
    unmount();
    open({ what: 'the DB cluster' });
    expect(text(field('Master password').findDescription()?.getElement())).toBe(
      'EmuForge Studio does not keep the password and the API does not return it: note it before you create the DB cluster.',
    );
  });

  it('"Show password" under the password switches it between a password field and text, starts off on each form, and is stored nowhere', () => {
    localStorage.clear();
    sessionStorage.clear();
    const first = open();
    const input = () => field('Master password').getElement().querySelector('input:not([type="checkbox"])');
    const toggle = () => {
      const found = createWrapper(field('Master password').getElement()).findCheckbox();
      if (found === null) {
        throw new Error('no checkbox');
      }
      return found;
    };
    expect(text(toggle().findLabel().getElement())).toBe('Show password');
    expect(toggle().findNativeInput().getElement().checked).toBe(false);
    expect(input()?.getAttribute('type')).toBe('password');
    fireEvent.change(input() as HTMLInputElement, { target: { value: 'pa55-Word!x' } });
    toggle().findNativeInput().click();
    expect(input()?.getAttribute('type')).toBe('text');
    expect((input() as HTMLInputElement).value).toBe('pa55-Word!x');
    toggle().findNativeInput().click();
    expect(input()?.getAttribute('type')).toBe('password');
    toggle().findNativeInput().click();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(window.location.href).not.toContain('pa55-Word!x');
    first.unmount();

    open({ what: 'the DB cluster' });
    expect(toggle().findNativeInput().getElement().checked).toBe(false);
    expect(input()?.getAttribute('type')).toBe('password');
  });

  it('"Engine version": the emulator\'s default at start and above the versions; loading, then the versions', async () => {
    let answer: (page: api.ChoicePage<EngineVersionChoice>) => void = () => undefined;
    vi.mocked(api.listEngineVersionChoices).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    open();
    const select = selectIn('Engine version - optional');
    expect(select.findTrigger().getElement()).toHaveTextContent("The emulator's default");
    expect(api.listEngineVersionChoices).not.toHaveBeenCalled();
    select.openDropdown();
    await waitFor(() => {
      expect(text(select.findDropdown().getElement())).toContain('Loading engine versions');
    });
    answer({ choices: [{ version: '18.3', description: 'PostgreSQL 18.3-R1' }] });
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('18.3')).not.toBeNull();
    });
    const dropdown = select.findDropdown();
    const defaultOption = dropdown.findOptionByValue('');
    const versionOption = dropdown.findOptionByValue('18.3');
    expect(dropdown.findOptions()).toHaveLength(2);
    if (defaultOption === null || versionOption === null) throw new Error('missing default or explicit version');
    expect(defaultOption.findLabel().getElement()).toHaveTextContent("The emulator's default");
    expect(versionOption.findLabel().getElement()).toHaveTextContent('18.3');
    expect(versionOption.findDescription()?.getElement()).toHaveTextContent('PostgreSQL 18.3-R1');
    expect(defaultOption.getElement().compareDocumentPosition(versionOption.getElement())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(vi.mocked(api.listEngineVersionChoices).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'postgres', undefined]);
  });

  it('"Engine version": none → "No engine versions"; a failed page → could not be loaded with "Retry"; "Load more" while a marker came', async () => {
    vi.mocked(api.listEngineVersionChoices).mockResolvedValueOnce({ choices: [] });
    const first = open();
    let select = selectIn('Engine version - optional');
    select.openDropdown();
    await waitFor(() => {
      expect(text(select.findDropdown().getElement())).toContain('No engine versions');
    });
    first.unmount();

    vi.mocked(api.listEngineVersionChoices).mockRejectedValueOnce(failed('DescribeDBEngineVersions'));
    const second = open();
    select = selectIn('Engine version - optional');
    select.openDropdown();
    await waitFor(() => {
      expect(text(select.findDropdown().getElement())).toContain('The engine versions could not be loaded');
    });
    expect(text(select.findDropdown().getElement())).toContain('Retry');
    second.unmount();

    vi.mocked(api.listEngineVersionChoices)
      .mockResolvedValueOnce({ choices: [{ version: '18.3' }], marker: 'v-2' })
      .mockResolvedValueOnce({ choices: [{ version: '17.7' }] });
    open();
    select = selectIn('Engine version - optional');
    select.openDropdown();
    const more = await waitFor(() => {
      const button = [...select.findDropdown().getElement().querySelectorAll('button')].find(
        (each) => text(each) === 'Load more',
      );
      expect(button).toBeDefined();
      return button as HTMLButtonElement;
    });
    more.click();
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('17.7')).not.toBeNull();
    });
    expect(vi.mocked(api.listEngineVersionChoices).mock.lastCall?.[2]).toBe('v-2');
  });

  it('"DB subnet group": "Chosen by the emulator" at start; its loading, empty and failed texts', async () => {
    let answer: (page: api.ChoicePage<SubnetGroupChoice>) => void = () => undefined;
    vi.mocked(api.listSubnetGroupChoices).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const first = open();
    let select = selectIn('DB subnet group - optional');
    expect(text(select.findTrigger().getElement())).toBe('Chosen by the emulator');
    select.openDropdown();
    await waitFor(() => {
      expect(text(select.findDropdown().getElement())).toContain('Loading DB subnet groups');
      expect(api.listSubnetGroupChoices).toHaveBeenCalledOnce();
    });
    answer({ choices: [{ name: 'default', description: 'the default group', vpcId: 'vpc-d' }] });
    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue('default')).not.toBeNull();
    });
    expect(text(select.findDropdown().findOptionByValue('default')?.getElement())).toContain('vpc-d');
    first.unmount();

    vi.mocked(api.listSubnetGroupChoices).mockResolvedValueOnce({ choices: [] });
    const second = open();
    select = selectIn('DB subnet group - optional');
    select.openDropdown();
    await waitFor(() => {
      expect(text(select.findDropdown().getElement())).toContain('No DB subnet groups');
    });
    second.unmount();

    vi.mocked(api.listSubnetGroupChoices).mockRejectedValueOnce(failed('DescribeDBSubnetGroups'));
    open();
    select = selectIn('DB subnet group - optional');
    select.openDropdown();
    await waitFor(() => {
      expect(text(select.findDropdown().getElement())).toContain('The DB subnet groups could not be loaded');
    });
    expect(text(select.findDropdown().getElement())).toContain('Retry');
  });

  it('"Security groups": the placeholder; several chosen, each removable; a typed text with none → "No security groups match"', async () => {
    open();
    const groups = groupsField();
    expect(text(groups.findTrigger().getElement())).toContain('Choose security groups');
    groups.openDropdown();
    await waitFor(() => {
      expect(groups.findDropdown().findOptionByValue('sg-2')).not.toBeNull();
    });
    groups.selectOptionByValue('sg-1');
    groups.selectOptionByValue('sg-2');
    groups.closeDropdown();
    const tokens = () => (groups.findTokens() ?? []).map((token) => text(token.findLabel().getElement()));
    expect(tokens()).toEqual([expect.stringContaining('default'), expect.stringContaining('web')]);
    groups.findToken(1)?.findDismiss().click();
    expect(tokens()).toEqual([expect.stringContaining('web')]);

    readGroups.mockResolvedValue({ choices: [] });
    groups.openDropdown();
    groups.findFilteringInput()?.setInputValue('zz');
    await waitFor(() => {
      expect(text(groups.findDropdown().getElement())).toContain('No security groups match');
    });
    expect(readGroups.mock.lastCall?.[1]).toEqual({ name: 'zz' });
  });

  it('"Security groups": its loading, empty and failed texts', async () => {
    readGroups.mockImplementationOnce(() => new Promise(() => undefined));
    const first = open();
    let groups = groupsField();
    groups.openDropdown();
    await waitFor(() => {
      expect(text(groups.findDropdown().getElement())).toContain('Loading security groups');
    });
    first.unmount();

    readGroups.mockResolvedValueOnce({ choices: [] });
    const second = open();
    groups = groupsField();
    groups.openDropdown();
    await waitFor(() => {
      expect(text(groups.findDropdown().getElement())).toContain('No security groups');
    });
    second.unmount();

    readGroups.mockRejectedValueOnce(failed('DescribeSecurityGroups'));
    open();
    groups = groupsField();
    groups.openDropdown();
    await waitFor(() => {
      expect(text(groups.findDropdown().getElement())).toContain('The security groups could not be loaded');
    });
    expect(text(groups.findDropdown().getElement())).toContain('Retry');
  });
});

describe('RDS create field descriptions and placement', () => {
  const engines = [
    { value: 'postgres', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'mariadb', label: 'MariaDB' },
    { value: 'aurora-postgresql', label: 'Aurora PostgreSQL' },
    { value: 'aurora-mysql', label: 'Aurora MySQL' },
  ];
  const descriptions = new Map([
    ['postgres', 'PostgreSQL.'],
    ['mysql', 'MySQL.'],
    ['mariadb', 'MariaDB.'],
    ['aurora-postgresql', 'Aurora, PostgreSQL-compatible.'],
    ['aurora-mysql', 'Aurora, MySQL-compatible.'],
  ]);
  const defaults = { data: undefined, failure: undefined, retry: vi.fn(), loading: true };

  function engineOption(value: string) {
    const option = PAGE.findRadioGroup()
      ?.findButtons()
      .find((button) => button.findNativeInput().getElement().value === value);
    if (option === undefined) throw new Error(`no engine option ${value}`);
    return option;
  }

  it('describes the engines before the read and adds their default versions when they arrive', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <EngineField
        engines={engines}
        value="postgres"
        onChange={onChange}
        connection={CONNECTION}
        defaults={defaults}
      />,
    );
    for (const { value, label } of engines) {
      const option = engineOption(value);
      expect(option.findLabel().getElement()).toHaveTextContent(label);
      expect(option.findDescription()?.getElement().textContent).toBe(descriptions.get(value));
    }
    const versions = Object.fromEntries(engines.map(({ value }, index) => [value, String(index + 1)]));
    rerender(
      <EngineField
        engines={engines}
        value="postgres"
        onChange={onChange}
        connection={CONNECTION}
        defaults={{ ...defaults, loading: false, data: { versions, failures: {} } }}
      />,
    );
    for (const { value } of engines) {
      expect(engineOption(value).findDescription()?.getElement()).toHaveTextContent(
        `${descriptions.get(value)} The emulator's default version is ${versions[value]}.`,
      );
    }
  });

  it('shows a 501 at Engine and leaves every engine selectable with its base description', () => {
    const onChange = vi.fn();
    const failure = { kind: 'not-implemented', operation: 'DescribeDBEngineVersions' } as const;
    render(
      <MemoryRouter>
        <EngineField
          engines={engines}
          value="postgres"
          onChange={onChange}
          connection={CONNECTION}
          defaults={{ ...defaults, loading: false, data: { versions: {}, failures: { postgres: failure } } }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for DescribeDBEngineVersions/)).toBeVisible();
    for (const { value } of engines) {
      const option = engineOption(value);
      expect(option.findDescription()?.getElement().textContent).toBe(descriptions.get(value));
      expect(option.findNativeInput().getElement()).toBeEnabled();
    }
    engineOption('mysql').findNativeInput().click();
    expect(onChange).toHaveBeenCalledWith('mysql');
  });

  it('describes the fixed version while the default read is pending, after failure and after retry succeeds', async () => {
    const client = new QueryClient();
    const onChange = vi.fn();
    let rejectRead: (reason: RequestError) => void = () => undefined;
    vi.mocked(api.readDefaultVersion)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRead = reject;
          }),
      )
      .mockResolvedValueOnce('18.3');

    function VersionFields() {
      const read = useDefaultVersions(ENGINE, ['postgres']);
      return (
        <>
          <EngineField engines={engines} value="postgres" onChange={onChange} defaults={read} connection={CONNECTION} />
          <EngineVersionField
            engine="postgres"
            defaultVersion={read.data?.versions.postgres}
            connection={CONNECTION}
            value={undefined}
            onChange={onChange}
          />
        </>
      );
    }
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <VersionFields />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const select = selectIn('Engine version - optional');
    const description = () => select.findDropdown().findOptionByValue('')?.findDescription()?.getElement();
    const omission = 'The emulator uses its default version when none is sent.';
    select.openDropdown();
    await waitFor(() => expect(api.readDefaultVersion).toHaveBeenCalledOnce());
    expect(select.findDropdown().findOptionByValue('')?.findLabel().getElement()).toHaveTextContent(
      "The emulator's default",
    );
    expect(description()).toHaveTextContent(omission);
    rejectRead(failed('DescribeDBEngineVersions'));
    expect(await screen.findByText('The default engine versions could not be read')).toBeVisible();
    expect(description()).toHaveTextContent(omission);
    select.closeDropdown();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    select.openDropdown();
    await waitFor(() =>
      expect(description()).toHaveTextContent('18.3, the version the emulator creates when none is sent.'),
    );
  });

  it('describes each kind of default subnet group', () => {
    const client = new QueryClient();
    const onChange = vi.fn();
    const fields = (mode: 'instance' | 'cluster') => (
      <QueryClientProvider client={client}>
        <SubnetGroupField mode={mode} connection={CONNECTION} value={undefined} onChange={onChange} />
      </QueryClientProvider>
    );
    const { rerender } = render(fields('instance'));
    const select = selectIn('DB subnet group - optional');
    select.openDropdown();
    const description = () => select.findDropdown().findOptionByValue('')?.findDescription()?.getElement();
    expect(description()).toHaveTextContent('The emulator puts the instance in its subnet group named default.');
    rerender(fields('cluster'));
    expect(description()).toHaveTextContent('The emulator puts the cluster in its subnet group named default.');
  });

  it('locks security groups without a VPC and scopes the read and empty text when it arrives', async () => {
    const client = new QueryClient();
    const onChange = vi.fn();
    const fields = (data: string | undefined) => (
      <QueryClientProvider client={client}>
        <SecurityGroupsField
          connection={CONNECTION}
          value={[]}
          onChange={onChange}
          placement={{ data, failure: undefined, retry: vi.fn() }}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(fields(undefined));
    expect(groupsField().findTrigger().getElement()).toBeDisabled();
    expect(screen.getByText('Choose DB subnet group first')).toBeVisible();
    expect(readGroups).not.toHaveBeenCalled();
    readGroups.mockResolvedValueOnce({ choices: [] });
    rerender(fields('vpc-d'));
    groupsField().openDropdown();
    await waitFor(() =>
      expect(readGroups).toHaveBeenCalledWith(ENGINE, { vpcId: 'vpc-d', name: '' }, undefined, expect.any(AbortSignal)),
    );
    await waitFor(() =>
      expect(text(groupsField().findDropdown().getElement())).toContain('No security groups in vpc-d'),
    );
  });
});
