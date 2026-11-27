import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as security from '../../../components/security-group-choices';
import type { DbInstance } from '../api';
import * as choices from '../choices-api';
import * as clusters from '../cluster-api';
import type { FlashItem } from '../../../components/page-flash';
import { ModifyInstanceDialog } from './modify-instance-dialog';

vi.mock('../choices-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../choices-api')>()),
  readOrderableRows: vi.fn(),
  readUpgradeTargets: vi.fn(),
  listEngineVersionChoices: vi.fn(),
  listSubnetGroupChoices: vi.fn(),
  readDefaultVpcId: vi.fn(),
}));

vi.mock('../cluster-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cluster-api')>()),
  getCluster: vi.fn(),
}));

vi.mock('../../../components/security-group-choices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../components/security-group-choices')>()),
  readSecurityGroupsById: vi.fn(),
}));

vi.mock('../choices-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../choices-queries')>()),
  groupChoices: (endpoint: string | undefined, vpcId: string | undefined) => ({
    ...security.securityGroupChoices(endpoint, vpcId),
    read: async () => ({ items: GROUPS.filter((group) => group.vpcId === vpcId) }),
  }),
}));

const CONNECTION = { engineOrigin: 'http://127.0.0.1:8398', result: undefined };
const SUBNETS = [
  { name: 'default', vpcId: 'vpc-a', zones: ['us-east-1a'] },
  { name: 'second', vpcId: 'vpc-b', zones: ['us-east-1b'] },
  { name: 'third', vpcId: 'vpc-c', zones: ['us-east-1c'] },
];
const GROUPS = [
  { id: 'sg-a', name: 'Group A', vpcId: 'vpc-a' },
  { id: 'sg-b', name: 'Group B', vpcId: 'vpc-b' },
  { id: 'sg-c', name: 'Group C', vpcId: 'vpc-c' },
  { id: 'sg-a1', name: 'Group A1', vpcId: 'vpc-a' },
  { id: 'sg-a2', name: 'Group A2', vpcId: 'vpc-a' },
];
const ROWS = [
  { DBInstanceClass: 'db.t3.micro', StorageType: 'gp2', MinStorageSize: 20, MaxStorageSize: 65536 },
  {
    DBInstanceClass: 'db.t3.micro',
    StorageType: 'io1',
    MinStorageSize: 100,
    MaxStorageSize: 65536,
    MinIopsPerDbInstance: 1000,
    MaxIopsPerDbInstance: 10000,
    MinIopsPerGib: 0.5,
    MaxIopsPerGib: 50,
  },
  { DBInstanceClass: 'db.t3.small', StorageType: 'gp2' },
  { DBInstanceClass: 'db.other', StorageType: 'gp3' },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(choices.readOrderableRows).mockResolvedValue(ROWS);
  vi.mocked(choices.readUpgradeTargets).mockResolvedValue([
    { version: '16.13', major: false },
    { version: '16.5', major: false },
    { version: '17.9', major: true },
  ]);
  vi.mocked(choices.listEngineVersionChoices).mockResolvedValue({
    choices: [{ version: '16.13' }, { version: '17.9' }],
  });
  vi.mocked(choices.listSubnetGroupChoices).mockResolvedValue({ choices: SUBNETS });
  vi.mocked(security.readSecurityGroupsById).mockImplementation(async (_at, ids) =>
    GROUPS.filter(({ id }) => ids.includes(id)),
  );
});

const INSTANCE: DbInstance = {
  id: 'app-db',
  status: 'available',
  engine: 'postgres',
  engineVersion: '16.4',
  instanceClass: 'db.t3.micro',
  allocatedStorage: 20,
  storageType: 'gp2',
  multiAz: true,
  subnetGroup: { name: 'default', vpcId: 'vpc-a', subnets: ['subnet-a'] },
  deletionProtection: true,
  parameterGroups: [],
  securityGroups: [],
  tags: [],
};

const MODIFY_FIELD_LABELS = {
  identifier: 'DB instance identifier',
  class: 'DB instance class',
  storage: 'Allocated storage (GiB)',
  password: 'New master password',
} as const;
const PAGE = createWrapper(document.body);
const RENAME_GUIDANCE =
  'After saving, the old identifier will stop resolving. Studio will open the renamed DB instance.';
type Field = keyof typeof MODIFY_FIELD_LABELS;

function open(instance = INSTANCE, refusal?: FlashItem) {
  const onSave = vi.fn();
  function InArea() {
    const root = useRef<HTMLDivElement>(null);
    const [editing, setEditing] = useState(true);
    const [failure, setFailure] = useState<FlashItem>();
    return (
      <div ref={root}>
        <AreaRootContext value={root}>
          <button onClick={() => setEditing(true)}>Modify</button>
          {editing && (
            <ModifyInstanceDialog
              instance={instance}
              connection={CONNECTION}
              pending={false}
              failure={failure}
              onSave={(edits) => {
                onSave(edits);
                setFailure(refusal);
              }}
              onDismiss={() => setEditing(false)}
            />
          )}
        </AreaRootContext>
      </div>
    );
  }
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <InArea />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onSave;
}

async function opened() {
  await waitFor(() => {
    expect(PAGE.findModal()?.findHeader().getElement()).toHaveTextContent('Modify DB instance');
  });
}

function formField(field: Field) {
  const content = PAGE.findModal()?.findContent();
  const selector = `#rds-modify-field-${field}`;
  const wrapper = content?.findFormField(selector) ?? content?.find(selector)?.findFormField();
  if (wrapper != null) {
    expect(wrapper.findLabel()?.getElement().textContent?.trim()).toBe(MODIFY_FIELD_LABELS[field]);
  }
  return wrapper ?? undefined;
}

function input(field: Field) {
  const input = formField(field)?.findControl()?.findInput()?.findNativeInput().getElement();
  if (input === undefined) throw new Error(`Missing input: ${field}`);
  return input;
}

function change(field: Field, value: string) {
  fireEvent.change(input(field), { target: { value } });
}

function protection() {
  return screen.getByRole('checkbox', { name: 'Deletion protection' });
}

function field(label: string) {
  const found = PAGE.findAllFormFields().find((entry) => entry.findLabel()?.getElement().textContent === label);
  if (found === undefined) throw new Error(`Missing field: ${label}`);
  return found;
}

function waitForFieldError(label: string, message: string) {
  return waitFor(
    () => expect(field(label).findError()?.getElement()).toHaveTextContent(message),
    // Cloudscape's scoped selector temporarily adds an attribute to the field on every lookup.
    { mutationObserverOptions: { subtree: true, childList: true, characterData: true } },
  );
}

function select(label: string) {
  const found = field(label).findControl()?.findSelect();
  if (found == null) throw new Error(`Missing select: ${label}`);
  return found;
}

function trigger(label: string) {
  return select(label).findTrigger().getElement();
}

async function choose(label: string, value: string) {
  await waitFor(() => expect(trigger(label)).toBeEnabled());
  select(label).openDropdown();
  await waitFor(() => {
    const option = select(label).findDropdown().findOptionByValue(value);
    expect(option).not.toBeNull();
  });
  select(label).selectOptionByValue(value);
}

function groupField() {
  const found = field('Security groups').findControl()?.findMultiselect();
  if (found == null) throw new Error('Missing security groups');
  return found;
}

function groupAnnouncements() {
  return within(field('Security groups').getElement())
    .queryAllByRole('status')
    .map((status) => status.textContent);
}

function groupNames() {
  return groupField()
    .findTokens()
    .map((item) => item.findLabel().getElement().textContent);
}

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function unavailable(operation: string, kind: 'other' | 'not-implemented') {
  return new RequestError(kind === 'other' ? { operation, kind, code: 'Unavailable' } : { operation, kind });
}

function save() {
  const button = PAGE.findModal()?.findFooter()?.findButton('#rds-modify-save')?.getElement();
  expect(button).toHaveTextContent('Save changes');
  return button as HTMLButtonElement;
}

function renameGuidance() {
  return formField('identifier')?.findDescription()?.getElement();
}

describe('Modify DB instance', () => {
  it('U1 opens a standalone instance with its settings and a fresh masked password', async () => {
    const onSave = open({
      ...INSTANCE,
      storageType: 'io1',
      allocatedStorage: 100,
      iops: 3000,
      securityGroups: [{ id: 'sg-a' }],
    });
    await opened();
    expect(input('identifier')).toHaveValue('app-db');
    expect(trigger('DB instance class')).toHaveTextContent('db.t3.micro');
    expect(input('storage')).toHaveValue('100');
    expect(trigger('Engine version')).toHaveTextContent('Keep 16.4');
    expect(trigger('Engine version')).toHaveTextContent('No version is sent.');
    expect(trigger('Storage type')).toHaveTextContent('io1');
    expect(field('Provisioned IOPS').findControl()?.findInput()?.findNativeInput().getElement()).toHaveValue('3000');
    expect(screen.getByRole('checkbox', { name: 'Multi-AZ' })).toBeChecked();
    expect(trigger('DB subnet group')).toHaveTextContent('default');
    await waitFor(() => expect(groupNames()).toEqual(['Group A']));
    expect(input('password')).toHaveAttribute('type', 'password');
    expect(input('password')).toHaveValue('');
    expect(formField('password')?.findDescription()?.getElement()).toHaveTextContent(
      'Leave blank to keep the current password.',
    );
    expect(protection()).toBeChecked();
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('U2 sends only the field changed and disables saving when reverted', async () => {
    const onSave = open();
    await opened();
    await waitFor(() => expect(trigger('DB instance class')).toBeEnabled());
    const edits = [
      ['identifier', 'new-db', 'app-db', { identifier: 'new-db' }],
      ['storage', '30', '20', { allocatedStorage: 30 }],
      ['password', 'DemoPass!234', '', { masterPassword: 'DemoPass!234' }],
    ] as const;
    for (const [label, value, original, expected] of edits) {
      change(label, value);
      expect(save()).toBeEnabled();
      fireEvent.click(save());
      expect(onSave).toHaveBeenLastCalledWith(expected);
      change(label, original);
      expect(save()).toBeDisabled();
    }
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenLastCalledWith({ deletionProtection: false });
    fireEvent.click(protection());
    expect(save()).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['identifier', '9bad', 'An identifier begins with a letter.', 'good-db'],
    ['storage', '25.5', '20 to 65536 GiB for gp2.', '30'],
    ['storage', '65537', '20 to 65536 GiB for gp2.', '30'],
    ['password', 'short', 'A master password has at least 8 characters.', 'DemoPass!234'],
  ] as const)('U3 blocks invalid %s (%s) and permits a correction', async (label, invalid, error, valid) => {
    const onSave = open();
    await opened();
    await waitFor(() => expect(trigger('DB instance class')).toBeEnabled());
    change(label, invalid);
    expect(formField(label)?.findError()?.getElement()).toHaveTextContent(error);
    expect(input(label)).toHaveAccessibleDescription(expect.stringContaining(error));
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();
    change(label, valid);
    expect(formField(label)?.findError()).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('U4 cancels the draft and opens with the original settings', async () => {
    const onSave = open();
    await opened();
    change('identifier', 'draft-db');
    await choose('DB instance class', 'db.t3.small');
    change('storage', '30');
    change('password', 'DemoPass!234');
    fireEvent.click(protection());
    const cancel = PAGE.findModal()?.findFooter()?.findButton('#rds-modify-cancel')?.getElement();
    expect(cancel).toHaveTextContent('Cancel');
    fireEvent.click(cancel as HTMLElement);
    expect(PAGE.findModal()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    await opened();
    expect(input('identifier')).toHaveValue('app-db');
    expect(trigger('DB instance class')).toHaveTextContent('db.t3.micro');
    expect(input('storage')).toHaveValue('20');
    expect(input('password')).toHaveValue('');
    expect(protection()).toBeChecked();
    expect(save()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('U5 offers only the settings owned by a cluster member', async () => {
    vi.mocked(clusters.getCluster).mockResolvedValue({
      found: true,
      cluster: {
        id: 'app-cluster',
        engineVersion: '17.4',
        status: 'available',
        members: [],
        securityGroups: [],
        deletionProtection: false,
        tags: [],
      },
    });
    vi.mocked(choices.readOrderableRows).mockResolvedValue([
      { DBInstanceClass: 'db.r6g.xlarge', StorageType: 'aurora' },
    ]);
    const onSave = open({ ...INSTANCE, engine: 'aurora-postgresql', clusterId: 'app-cluster' });
    await opened();
    expect(PAGE.findModal()?.findContent().find('#rds-modify-cluster-guidance')?.getElement()).toHaveTextContent(
      'The cluster manages storage and master credentials.',
    );
    expect(formField('storage')).toBeUndefined();
    expect(formField('password')).toBeUndefined();
    change('identifier', 'new-member');
    await choose('DB instance class', 'db.r6g.xlarge');
    expect(choices.readOrderableRows).toHaveBeenCalledExactlyOnceWith(
      CONNECTION.engineOrigin,
      'aurora-postgresql',
      '17.4',
      expect.any(AbortSignal),
    );
    expect(PAGE.findAllFormFields().map((entry) => entry.findLabel()?.getElement().textContent)).toEqual([
      'DB instance identifier',
      'DB instance class',
    ]);
    expect(screen.getAllByRole('checkbox')).toEqual([protection()]);
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      identifier: 'new-member',
      instanceClass: 'db.r6g.xlarge',
      deletionProtection: false,
    });
  });

  it('U6 allows an independent edit with unchanged legacy settings', async () => {
    const onSave = open({ ...INSTANCE, id: 'legacy_db', allocatedStorage: 5 });
    await opened();
    expect(input('identifier')).toHaveValue('legacy_db');
    expect(input('storage')).toHaveValue('5');
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
  });

  it('describes what happens to the old identifier only for a valid rename', async () => {
    open();
    await opened();
    expect(renameGuidance()).toBeUndefined();
    change('identifier', '9bad');
    expect(renameGuidance()).toBeUndefined();
    change('identifier', 'renamed-db');
    expect(renameGuidance()).toHaveTextContent(RENAME_GUIDANCE);
    expect(input('identifier')).toHaveAccessibleDescription(expect.stringContaining(RENAME_GUIDANCE));
    change('identifier', 'app-db');
    expect(renameGuidance()).toBeUndefined();
  });

  it('treats a case-only identifier edit as unchanged while allowing an independent edit', async () => {
    const onSave = open();
    await opened();
    change('identifier', 'APP-DB');
    expect(input('identifier')).toHaveValue('APP-DB');
    expect(renameGuidance()).toBeUndefined();
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();

    await choose('DB instance class', 'db.t3.small');
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ instanceClass: 'db.t3.small' });
    expect(renameGuidance()).toBeUndefined();
  });
});

describe('choices for a standalone DB instance', () => {
  it('offers only available upgrades and distinguishes major and minor targets', async () => {
    open();
    await opened();
    expect(choices.readUpgradeTargets).not.toHaveBeenCalled();
    select('Engine version').openDropdown();
    const dropdown = select('Engine version').findDropdown();
    await waitFor(() => expect(dropdown.findOptionByValue('17.9')?.getElement()).toHaveTextContent('Major upgrade'));
    expect(dropdown.findOptionByValue('16.13')?.getElement()).toHaveTextContent('Minor upgrade');
    expect(dropdown.findOptionByValue('16.5')).toBeNull();
  });

  it('keeps an eligible class, holds save for a cleared one, and restores a cleared class on Keep', async () => {
    vi.mocked(choices.readOrderableRows).mockImplementation(async (_at, _engine, version) =>
      version === '17.9' ? [{ DBInstanceClass: 'db.t3.small', StorageType: 'gp2' }] : ROWS,
    );
    const onSave = open();
    await opened();

    await choose('Engine version', '16.13');
    await waitFor(() => expect(save()).toBeEnabled());
    expect(trigger('DB instance class')).toHaveTextContent('db.t3.micro');
    fireEvent.click(save());
    expect(onSave).toHaveBeenLastCalledWith({ engineVersion: { version: '16.13', major: false } });

    await choose('Engine version', '17.9');
    await waitForFieldError('DB instance class', 'Choose a class for 17.9');
    expect(save()).toBeDisabled();
    await choose('Engine version', '');
    await waitFor(() => expect(trigger('DB instance class')).toHaveTextContent('db.t3.micro'));
    expect(trigger('Storage type')).toHaveTextContent('gp2');
    expect(save()).toBeDisabled();

    await choose('Engine version', '17.9');
    await waitForFieldError('DB instance class', 'Choose a class for 17.9');
    await choose('DB instance class', 'db.t3.small');
    expect(trigger('Storage type')).toHaveTextContent('gp2');
    expect(save()).toBeEnabled();
  });

  it('uses the starting version rows when an abandoned target answers last', async () => {
    const late = held<typeof ROWS>();
    vi.mocked(choices.readOrderableRows).mockImplementation((_at, _engine, version) =>
      version === '17.9' ? late.promise : Promise.resolve(ROWS),
    );
    open();
    await opened();
    await choose('Engine version', '17.9');
    await waitFor(() =>
      expect(choices.readOrderableRows).toHaveBeenCalledWith(
        CONNECTION.engineOrigin,
        'postgres',
        '17.9',
        expect.any(AbortSignal),
      ),
    );
    const signal = vi.mocked(choices.readOrderableRows).mock.calls.find((call) => call[2] === '17.9')?.[3];
    await choose('Engine version', '');
    await waitFor(() => expect(trigger('DB instance class')).toBeEnabled());
    expect(signal?.aborted).toBe(true);
    await act(async () => late.resolve([{ DBInstanceClass: 'db.late', StorageType: 'gp3' }]));
    select('DB instance class').openDropdown();
    expect(select('DB instance class').findDropdown().findOptionByValue('db.t3.micro')).not.toBeNull();
    expect(select('DB instance class').findDropdown().findOptionByValue('db.late')).toBeNull();
  });

  it('clears the storage type when the new class lacks it', async () => {
    open();
    await opened();
    await choose('DB instance class', 'db.other');
    expect(field('Storage type').findError()?.getElement()).toHaveTextContent('Choose a storage type for db.other');
    expect(save()).toBeDisabled();
  });

  it('restores the starting storage type after an interim choice and saves protection alone', async () => {
    const onSave = open();
    await opened();
    await choose('DB instance class', 'db.other');
    expect(field('Storage type').findError()?.getElement()).toHaveTextContent('Choose a storage type for db.other');
    await choose('Storage type', 'gp3');
    await choose('DB instance class', 'db.t3.micro');

    expect(select('Storage type').findTrigger().find('[data-value="gp2"]')).not.toBeNull();
    expect(save()).toBeDisabled();
    fireEvent.click(protection());
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
  });

  it.each([false, true])(
    'restores the starting class and storage type on version revert and saves protection alone (interim choices: %s)',
    async (replace) => {
      const startingRows = held<typeof ROWS>();
      vi.mocked(choices.readOrderableRows)
        .mockResolvedValueOnce(ROWS)
        .mockResolvedValueOnce([{ DBInstanceClass: 'db.upgrade', StorageType: 'gp3' }])
        .mockReturnValueOnce(startingRows.promise);
      const onSave = open();
      await opened();
      await waitFor(() => expect(trigger('DB instance class')).toBeEnabled());
      await choose('Engine version', '17.9');
      await waitForFieldError('DB instance class', 'Choose a class for 17.9');
      if (replace) {
        await choose('DB instance class', 'db.upgrade');
        await choose('Storage type', 'gp3');
      }
      await choose('Engine version', '');
      expect(trigger('DB instance class')).toBeDisabled();
      fireEvent.click(protection());
      if (replace) {
        expect(save()).toBeDisabled();
        await act(async () => startingRows.resolve(ROWS));
        await waitFor(() => expect(trigger('DB instance class')).toBeEnabled());
      }

      expect(select('DB instance class').findTrigger().find('[data-value="db.t3.micro"]')).not.toBeNull();
      expect(select('Storage type').findTrigger().find('[data-value="gp2"]')).not.toBeNull();
      expect(save()).toBeEnabled();
      fireEvent.click(save());
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
    },
  );

  it('restores cleared storage before the starting version rows answer and saves protection alone', async () => {
    const startingRows = held<typeof ROWS>();
    vi.mocked(choices.readOrderableRows)
      .mockResolvedValueOnce(ROWS)
      .mockResolvedValueOnce([{ DBInstanceClass: 'db.t3.micro', StorageType: 'gp3' }])
      .mockReturnValueOnce(startingRows.promise);
    const onSave = open();
    await opened();
    await waitFor(() => expect(trigger('DB instance class')).toBeEnabled());
    await choose('Engine version', '17.9');
    await waitForFieldError('Storage type', 'Choose a storage type for db.t3.micro');
    await choose('Engine version', '');

    const storageTrigger = select('Storage type').findTrigger();
    expect(storageTrigger.getElement()).toBeDisabled();
    expect(storageTrigger.find('[data-value="gp2"]')?.getElement()).not.toHaveTextContent("Not in the emulator's list");
    expect(storageTrigger.find('[data-value="gp2"]')).not.toBeNull();
    fireEvent.click(protection());
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
  });

  it('validates provisioned storage size, required IOPS and IOPS per GiB', async () => {
    const onSave = open();
    await opened();
    await choose('Storage type', 'io1');
    expect(field('Allocated storage (GiB)').findError()?.getElement()).toHaveTextContent('100 to 65536 GiB for io1.');
    expect(field('Provisioned IOPS').findError()?.getElement()).toHaveTextContent('Enter the IOPS.');
    expect(save()).toBeDisabled();
    change('storage', '100');
    const iops = field('Provisioned IOPS')
      .findControl()
      ?.findInput()
      ?.findNativeInput()
      .getElement() as HTMLInputElement;
    fireEvent.change(iops, { target: { value: '3000' } });
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenLastCalledWith({ storageType: 'io1', allocatedStorage: 100, iops: 3000 });
    change('storage', '20');
    expect(field('Provisioned IOPS').findError()?.getElement()).toHaveTextContent('10 to 1000 IOPS for 20 GiB.');
    expect(save()).toBeDisabled();
  });

  it('shows an unlisted starting class and allows saving protection alone with an out-of-range starting size', async () => {
    const onSave = open({ ...INSTANCE, instanceClass: 'db.legacy', allocatedStorage: 5 });
    await opened();
    await waitFor(() => expect(trigger('DB instance class')).toHaveTextContent("Not in the emulator's list"));
    expect(formField('storage')?.findError()).toBeNull();
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
  });

  it.each(['other', 'not-implemented'] as const)(
    'allows an independent save when the orderable read fails (%s)',
    async (kind) => {
      const operation = choices.CHOICE_OPERATIONS.describeOrderableDBInstanceOptions;
      vi.mocked(choices.readOrderableRows).mockRejectedValueOnce(unavailable(operation, kind));
      const onSave = open();
      await opened();
      const classField = field('DB instance class').getElement();
      if (kind === 'not-implemented') {
        await waitFor(() =>
          expect(field('DB instance class').findControl()?.findStatusIndicator()?.getElement()).toHaveTextContent(
            'Not implemented by the emulator',
          ),
        );
        expect(classField).toHaveTextContent(operation);
      } else {
        await screen.findByRole('button', { name: 'Retry' });
      }
      expect(trigger('DB instance class')).toHaveTextContent('db.t3.micro');
      expect(trigger('Storage type')).toHaveTextContent('gp2');
      fireEvent.click(protection());
      fireEvent.click(save());
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
      if (kind === 'other') {
        change('storage', '30');
        expect(save()).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(save()).toBeEnabled());
      }
    },
  );

  it('shows the refusal and retains the entered choices', async () => {
    const onSave = open(INSTANCE, { type: 'error', content: 'The update was refused' });
    await opened();
    await choose('Engine version', '16.13');
    await choose('DB instance class', 'db.t3.small');
    change('identifier', 'new-name');
    change('storage', '30');
    change('password', 'DemoPass!234');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Multi-AZ' }));
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledOnce();
    expect(PAGE.findModal()?.findContent().findAlert()?.findContent().getElement()).toHaveTextContent(
      'The update was refused',
    );
    expect(input('identifier')).toHaveValue('new-name');
    expect(input('storage')).toHaveValue('30');
    expect(input('password')).toHaveValue('DemoPass!234');
    expect(trigger('Engine version')).toHaveTextContent('16.13');
    expect(trigger('DB instance class')).toHaveTextContent('db.t3.small');
    expect(screen.getByRole('checkbox', { name: 'Multi-AZ' })).not.toBeChecked();
    expect(protection()).not.toBeChecked();
    expect(save()).toBeEnabled();
  });
});

describe('security groups on a standalone DB instance', () => {
  const mixedGroups = { ...INSTANCE, securityGroups: [{ id: 'sg-a' }, { id: 'sg-b' }] };
  const missingGroup = { ...INSTANCE, securityGroups: [{ id: 'sg-b' }, { id: 'sg-missing' }] };
  const emptySubnetGroup = { ...INSTANCE, subnetGroup: { name: 'default', vpcId: 'vpc-a', subnets: [] } };

  it('announces the subnet group VPC lookup and offers its groups in the open picker when it finishes', async () => {
    const pending = held<string>();
    vi.mocked(choices.readDefaultVpcId).mockReturnValueOnce(pending.promise);
    open(emptySubnetGroup);
    await opened();

    expect(trigger('DB subnet group')).toHaveTextContent('default');
    expect(groupAnnouncements()).toContain("Checking the DB subnet group's VPC");
    expect(groupField().findTrigger().getElement()).not.toHaveTextContent('Choose DB subnet group first');
    const groups = groupField();
    groups.openDropdown();
    expect(groups.findTrigger().getElement()).toHaveAttribute('aria-expanded', 'true');
    expect(groups.findDropdown().findOptionByValue('sg-b')).toBeNull();

    await act(async () => pending.resolve('vpc-b'));
    await waitFor(() => expect(groups.findDropdown().findOptionByValue('sg-b')).not.toBeNull());
    expect(groups.findDropdown().findOptionByValue('sg-a')).toBeNull();
    expect(groupAnnouncements()).not.toContain("Checking the DB subnet group's VPC");
  });

  it('keeps the placement lookup error and retries the lookup from the security groups field', async () => {
    vi.mocked(choices.readDefaultVpcId)
      .mockRejectedValueOnce(
        new RequestError({
          kind: 'other',
          operation: 'DescribeVpcs',
          code: 'Unavailable',
          message: 'VPC lookup failed',
        }),
      )
      .mockResolvedValueOnce('vpc-b');
    open(emptySubnetGroup);
    await opened();

    await waitFor(() =>
      expect(field('Security groups').findControl()?.findStatusIndicator()?.getElement()).toHaveTextContent(
        'The security groups could not be read',
      ),
    );
    expect(field('Security groups').findControl()?.getElement()).toHaveTextContent('VPC lookup failed');
    expect(groupField().findTrigger().getElement()).not.toHaveTextContent('Choose DB subnet group first');
    expect(groupField().findTrigger().getElement()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(groupField().findTrigger().getElement()).toBeEnabled());
    const groups = groupField();
    groups.openDropdown();
    await waitFor(() => expect(groups.findDropdown().findOptionByValue('sg-b')).not.toBeNull());
  });

  it('reads the starting ids and replaces them with names after the answer', async () => {
    const pending = held<security.SecurityGroupChoice[]>();
    vi.mocked(security.readSecurityGroupsById).mockReturnValueOnce(pending.promise);
    open(mixedGroups);
    await opened();
    expect(security.readSecurityGroupsById).toHaveBeenCalledExactlyOnceWith(
      CONNECTION.engineOrigin,
      ['sg-a', 'sg-b'],
      expect.any(AbortSignal),
    );
    expect(groupNames()).toEqual(['sg-a', 'sg-b']);
    expect(trigger('DB subnet group')).toHaveTextContent('default');
    expect(groupAnnouncements()).toContain("Checking the DB subnet group's VPC");
    expect(groupField().findTrigger().getElement()).not.toHaveTextContent('Choose DB subnet group first');
    await act(async () => pending.resolve(GROUPS.slice(0, 2)));
    await waitFor(() => expect(groupNames()).toEqual(['Group A', 'Group B']));
    expect(groupAnnouncements()).not.toContain("Checking the DB subnet group's VPC");
  });

  it('keeps groups by their own VPC when changing the subnet group', async () => {
    const onSave = open(mixedGroups);
    await opened();
    await waitFor(() => expect(groupNames()).toEqual(['Group A', 'Group B']));
    await choose('DB subnet group', 'second');
    expect(groupNames()).toEqual(['Group B']);
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ subnetGroup: 'second', securityGroupIds: ['sg-b'] });
  });

  it('requires a group of the new VPC and clears groups outside it', async () => {
    const onSave = open(missingGroup);
    await opened();
    await waitFor(() => expect(groupNames()).toEqual(['Group B', 'sg-missing']));
    await choose('DB subnet group', 'third');
    expect(groupNames()).toEqual([]);
    expect(field('Security groups').findError()?.getElement()).toHaveTextContent('Choose security groups of vpc-c');
    expect(save()).toBeDisabled();
    const groups = groupField();
    groups.openDropdown();
    await waitFor(() => expect(groups.findDropdown().findOptionByValue('sg-c')).not.toBeNull());
    expect(groups.findDropdown().findOptionByValue('sg-b')).toBeNull();
    groups.selectOptionByValue('sg-c');
    groups.closeDropdown();
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ subnetGroup: 'third', securityGroupIds: ['sg-c'] });
  });

  it('shows a missing id and only sends the held group on changing subnet groups', async () => {
    const onSave = open(missingGroup);
    await opened();
    await waitFor(() => expect(groupNames()).toEqual(['Group B', 'sg-missing']));
    expect(groupField().findToken(2)?.getElement()).toHaveTextContent("Not in the emulator's list");
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenLastCalledWith({ deletionProtection: false });
    fireEvent.click(protection());
    await choose('DB subnet group', 'second');
    expect(groupNames()).toEqual(['Group B']);
    fireEvent.click(save());
    expect(onSave).toHaveBeenLastCalledWith({ subnetGroup: 'second', securityGroupIds: ['sg-b'] });
  });

  it('restores the starting group after choosing a replacement in another VPC and reverting the subnet group', async () => {
    const onSave = open({ ...INSTANCE, securityGroups: [{ id: 'sg-a' }] });
    await opened();
    await waitFor(() => expect(groupNames()).toEqual(['Group A']));

    await choose('DB subnet group', 'second');
    expect(groupNames()).toEqual([]);
    expect(field('Security groups').findError()?.getElement()).toHaveTextContent('Choose security groups of vpc-b');
    expect(save()).toBeDisabled();

    const groups = groupField();
    groups.openDropdown();
    await waitFor(() => expect(groups.findDropdown().findOptionByValue('sg-b')).not.toBeNull());
    groups.selectOptionByValue('sg-b');
    groups.closeDropdown();
    expect(groupNames()).toEqual(['Group B']);
    expect(save()).toBeEnabled();

    await choose('DB subnet group', 'default');
    expect(groupNames()).toEqual(['Group A']);
    expect(field('Security groups').findError()).toBeNull();
    expect(save()).toBeDisabled();

    fireEvent.click(protection());
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
  });

  it('keeps an explicit group removal when the subnet group is reverted and saves the remaining group alone', async () => {
    const onSave = open({ ...INSTANCE, securityGroups: [{ id: 'sg-a1' }, { id: 'sg-a2' }] });
    await opened();
    const groups = groupField();
    await waitFor(() => expect(groups.findTrigger().getElement()).toBeEnabled());
    groups.openDropdown();
    const dropdown = groups.findDropdown();
    await waitFor(() => expect(dropdown.findOptionByValue('sg-a2')).not.toBeNull());
    groups.selectOptionByValue('sg-a2');
    groups.closeDropdown();
    expect(groups.findTokens()).toHaveLength(1);

    await choose('DB subnet group', 'second');
    expect(groupField().findTokens()).toHaveLength(0);
    await choose('DB subnet group', 'default');
    expect(groupField().findTokens()).toHaveLength(1);
    groups.openDropdown();
    await waitFor(() => {
      expect(dropdown.findOptionByValue('sg-a1')?.getElement().closest('[role="option"]')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(dropdown.findOptionByValue('sg-a2')?.getElement().closest('[role="option"]')).toHaveAttribute(
        'aria-selected',
        'false',
      );
    });
    groups.closeDropdown();
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ securityGroupIds: ['sg-a1'] });
  });

  it.each(['other', 'not-implemented'] as const)(
    'allows independent saves after a group read failure (%s)',
    async (kind) => {
      vi.mocked(security.readSecurityGroupsById).mockRejectedValueOnce(
        unavailable(security.DESCRIBE_SECURITY_GROUPS, kind),
      );
      const onSave = open(mixedGroups);
      await opened();
      if (kind === 'not-implemented') {
        await waitFor(() =>
          expect(field('Security groups').findControl()?.findStatusIndicator()?.getElement()).toHaveTextContent(
            'Not implemented by the emulator',
          ),
        );
        expect(field('Security groups').getElement()).toHaveTextContent(security.DESCRIBE_SECURITY_GROUPS);
      } else {
        await screen.findByRole('button', { name: 'Retry' });
      }
      expect(groupNames()).toEqual(['sg-a', 'sg-b']);
      fireEvent.click(protection());
      fireEvent.click(save());
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
      await choose('DB subnet group', 'second');
      expect(save()).toBeDisabled();
      if (kind === 'other') {
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(groupNames()).toEqual(['Group B']));
        expect(save()).toBeEnabled();
      }
    },
  );
});
