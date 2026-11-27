import type { OrderableDBInstanceOption } from '@aws-sdk/client-rds';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import type { ZonesRead } from '../../../components/use-availability-zones';
import * as api from '../choices-api';
import type { ChoiceRead } from '../choices-queries';
import {
  DeletionProtectionField,
  EncryptStorageField,
  InstanceClassField,
  IopsField,
  KeyField,
  MultiAzField,
  StorageTypeField,
  UpgradeVersionField,
  ZoneField,
  ZonesField,
} from './choice-fields';

vi.mock('../choices-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../choices-api')>()),
  listEngineVersionChoices: vi.fn(),
  readUpgradeTargets: vi.fn(),
}));

const CONNECTION: AreaConnection = {
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9398, endpoint: 'https://127.0.0.1:9398' } },
  engineOrigin: 'http://127.0.0.1:8398',
};

const fixture = [
  { DBInstanceClass: 'db.first', StorageType: 'gp2', MinStorageSize: 20, MaxStorageSize: 65536 },
  {
    DBInstanceClass: 'db.first',
    StorageType: 'io1',
    MinStorageSize: 100,
    MaxStorageSize: 65536,
    MinIopsPerDbInstance: 1000,
    MaxIopsPerDbInstance: 10000,
  },
  { DBInstanceClass: 'db.second', StorageType: 'gp2', MinStorageSize: 20, MaxStorageSize: 65536 },
];

const onChange = vi.fn();
const retry = vi.fn();
const blank = { connection: CONNECTION, value: undefined, onChange };
const rows: ChoiceRead<OrderableDBInstanceOption[]> = {
  data: fixture,
  loading: false,
  failure: undefined,
  retry,
};
const zones = ['us-east-1b', 'us-east-1c'];
const zoneRead: ZonesRead = {
  zones: ['us-east-1a', ...zones],
  zoneDetails: [
    { name: 'us-east-1a', id: 'use1-az1' },
    { name: 'us-east-1b', id: 'use1-az2' },
    { name: 'us-east-1c', id: 'use1-az3' },
  ],
  loading: false,
  failure: undefined,
  retry,
};

const notImplemented = (operation: string) => ({ kind: 'not-implemented', operation }) as const;
const listOperation = 'DescribeOrderableDBInstanceOptions';
const versionOperation = 'DescribeDBEngineVersions';

function open(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Frame({ children: contents }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>{contents}</QueryClientProvider>
      </MemoryRouter>
    );
  }
  return render(children, { wrapper: Frame });
}

function select() {
  const found = createWrapper(document.body).findSelect();
  if (found === null) throw new Error('No select');
  return found;
}

const option = (value: string) => select().findDropdown().findOptionByValue(value);
const optionDescription = (value: string) => option(value)?.findDescription()?.getElement();
const trigger = () => select().findTrigger().getElement();

function expectOptions(values: readonly string[], fixedLabel?: string) {
  const expected = values.map((value) => {
    const item = option(value);
    expect(item?.findLabel().getElement()).toHaveTextContent(value === '' ? (fixedLabel ?? '') : value);
    return item?.getElement();
  });
  expect(
    select()
      .findDropdown()
      .findOptions()
      .map((item) => item.getElement()),
  ).toEqual(expected);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.readUpgradeTargets).mockResolvedValue([
    { version: '16.13', major: false },
    { version: '16.5', major: false },
    { version: '17.9', major: true },
  ]);
  vi.mocked(api.listEngineVersionChoices).mockResolvedValue({ choices: [{ version: '16.13' }, { version: '17.9' }] });
});

describe('the orderable class and storage fields', () => {
  const classField = (read: typeof rows) => (
    <InstanceClassField {...blank} engine="postgres" version="18.3" rows={read} />
  );

  it('deduplicates class options and filters them by typed text', () => {
    open(classField(rows));
    select().openDropdown();
    expectOptions(['db.first', 'db.second']);
    expect(optionDescription('db.first')).toHaveTextContent('Storage: gp2, io1');
    expect(optionDescription('db.second')).toHaveTextContent('Storage: gp2');
    select().findFilteringInput()?.setInputValue('second');
    expectOptions(['db.second']);
  });

  it('shows a contextual empty message', () => {
    open(classField({ ...rows, data: [] }));
    select().openDropdown();
    expect(select().findDropdown().getElement()).toHaveTextContent('The emulator lists no class for postgres 18.3.');
  });

  it('shows checking and a failure with retry, without offering a class', () => {
    const view = open(classField({ ...rows, data: undefined, loading: true }));
    expect(screen.getByText('Checking DB instance class')).toBeVisible();
    expect(trigger()).toBeDisabled();
    view.rerender(
      classField({
        ...rows,
        data: undefined,
        failure: { kind: 'other', operation: listOperation, code: 'InternalError' },
      }),
    );
    expect(screen.getByText('The DB instance class could not be read')).toBeVisible();
    expect(trigger()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each([listOperation, versionOperation])('shows %s 501 at the class field', (operation) => {
    const fromDefault = operation === versionOperation;
    open(
      <InstanceClassField
        {...blank}
        engine="postgres"
        version={fromDefault ? undefined : '18.3'}
        defaultFailure={fromDefault ? notImplemented(operation) : undefined}
        rows={{ ...rows, data: undefined, failure: fromDefault ? undefined : notImplemented(operation) }}
      />,
    );
    expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(new RegExp(`501 Not Implemented for ${operation}`))).toBeVisible();
    expect(trigger()).toBeDisabled();
  });

  it('locks storage type until a class is chosen and describes only that class’s types', () => {
    const view = open(<StorageTypeField {...blank} mode="instance-create" rows={rows} />);
    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveTextContent('Choose DB instance class first');
    view.rerender(<StorageTypeField {...blank} mode="instance-create" rows={rows} instanceClass="db.first" />);
    expect(trigger()).toHaveAccessibleDescription('The emulator creates gp2 storage.');
    select().openDropdown();
    expectOptions(['', 'gp2', 'io1'], 'Chosen by the emulator');
    expect(optionDescription('')).toHaveTextContent('The emulator creates gp2 storage.');
    expect(optionDescription('gp2')).toHaveTextContent('20 to 65536 GiB');
    expect(optionDescription('io1')).toHaveTextContent('100 to 65536 GiB, 1000 to 10000 IOPS');
  });

  it.each([
    ['cluster-create', 'Chosen by the emulator', 'The emulator records no storage type for the cluster.'],
    ['cluster-modify', 'Not set', 'The cluster has no storage type.'],
  ] as const)('offers the distinct cluster types on %s', (mode, label, description) => {
    const read = {
      ...rows,
      data: [
        { DBInstanceClass: 'db.first', StorageType: 'aurora', MinStorageSize: 10, MaxStorageSize: 100 },
        { DBInstanceClass: 'db.second', StorageType: 'aurora' },
        { DBInstanceClass: 'db.first', StorageType: 'aurora-iopt1' },
      ],
    };
    open(<StorageTypeField {...blank} mode={mode} rows={read} />);
    expect(trigger()).toHaveAccessibleDescription(description);
    select().openDropdown();
    expectOptions(['', 'aurora', 'aurora-iopt1'], label);
    expect(optionDescription('aurora')).toHaveTextContent('10 to 100 GiB');
  });

  it('shows the fixed storage explanation as field help and in the open option', () => {
    const description = 'The emulator records no storage type for the cluster.';
    const view = open(<StorageTypeField {...blank} mode="cluster-create" rows={rows} />);
    expect(trigger()).toHaveTextContent('Chosen by the emulator');
    expect(trigger()).not.toHaveTextContent(description);
    expect(trigger()).toHaveAccessibleDescription(description);
    expect(screen.getByText(description)).toBeVisible();

    select().openDropdown();
    expect(optionDescription('')).toHaveTextContent(description);
    select().closeDropdown();

    view.rerender(<StorageTypeField {...blank} mode="cluster-create" rows={rows} value="gp2" />);
    expect(trigger()).toHaveTextContent('20 to 65536 GiB');
    expect(screen.queryByText(description)).not.toBeInTheDocument();
  });

  it.each([listOperation, versionOperation])('keeps the create preset alone after a %s 501', (operation) => {
    const fromDefault = operation === versionOperation;
    open(
      <StorageTypeField
        {...blank}
        mode="cluster-create"
        defaultFailure={fromDefault ? notImplemented(operation) : undefined}
        rows={{ ...rows, data: undefined, failure: fromDefault ? undefined : notImplemented(operation) }}
      />,
    );
    expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(new RegExp(`501 Not Implemented for ${operation}`))).toBeVisible();
    select().openDropdown();
    expectOptions([''], 'Chosen by the emulator');
  });
});

describe('engine upgrades and zones', () => {
  it('offers Keep and only existing upgrade targets with their major or minor description', async () => {
    open(<UpgradeVersionField {...blank} engine="postgres" version="16.4" />);
    expect(trigger()).toHaveTextContent('Keep 16.4');
    expect(trigger()).toHaveTextContent('No version is sent.');
    select().openDropdown();
    await waitFor(() => expectOptions(['', '16.13', '17.9'], 'Keep 16.4'));
    expect(optionDescription('')).toHaveTextContent('No version is sent.');
    expect(optionDescription('16.13')).toHaveTextContent('Minor upgrade');
    expect(optionDescription('17.9')).toHaveTextContent('Major upgrade');
  });

  it.each(['targets', 'versions'])('keeps the current version after a 501 reading %s', async (read) => {
    const failure = new RequestError(notImplemented(versionOperation));
    if (read === 'targets') vi.mocked(api.readUpgradeTargets).mockRejectedValueOnce(failure);
    else vi.mocked(api.listEngineVersionChoices).mockRejectedValueOnce(failure);
    open(<UpgradeVersionField {...blank} engine="postgres" version="16.4" />);
    select().openDropdown();
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for DescribeDBEngineVersions/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent('Keep 16.4');
    expect(option('')?.findLabel().getElement()).toHaveTextContent('Keep 16.4');
  });

  it('keeps No preference after a zone 501', () => {
    open(
      <ZoneField
        {...blank}
        zones={zones}
        zoneRead={{ ...zoneRead, failure: notImplemented('DescribeAvailabilityZones') }}
      />,
    );
    expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for DescribeAvailabilityZones/)).toBeVisible();
    expect(trigger()).toHaveTextContent('No preference');
    select().openDropdown();
    expectOptions(['', ...zones], 'No preference');
    expect(option('us-east-1b')?.findDescription()).toBeNull();
  });

  it('lists only subnet group zones with IDs and displays No preference when disabled', () => {
    const view = open(<ZoneField {...blank} zones={zones} zoneRead={zoneRead} />);
    expect(trigger()).toHaveAccessibleDescription(
      "No zone is sent. The emulator reports a zone of its own, which may be none of the subnet group's.",
    );
    select().openDropdown();
    expectOptions(['', ...zones], 'No preference');
    expect(optionDescription('us-east-1b')).toHaveTextContent('use1-az2');
    select().closeDropdown();
    view.rerender(<ZoneField {...blank} value="us-east-1b" zones={zones} zoneRead={zoneRead} disabled />);
    expect(trigger()).toBeDisabled();
    expect(trigger()).toHaveTextContent('No preference');
  });

  it('shows the No preference explanation as field help and in the open option', () => {
    const description =
      "No zone is sent. The emulator reports a zone of its own, which may be none of the subnet group's.";
    const view = open(<ZoneField {...blank} zones={zones} zoneRead={zoneRead} />);
    expect(trigger()).toHaveTextContent('No preference');
    expect(trigger()).not.toHaveTextContent(description);
    expect(trigger()).toHaveAccessibleDescription(description);
    expect(screen.getByText(description)).toBeVisible();

    select().openDropdown();
    expect(optionDescription('')).toHaveTextContent(description);
    select().closeDropdown();

    view.rerender(<ZoneField {...blank} zones={zones} zoneRead={zoneRead} value="us-east-1b" />);
    expect(trigger()).toHaveTextContent('use1-az2');
    expect(screen.queryByText(description)).not.toBeInTheDocument();
  });

  it('offers the subnet group zones in the multiselect and starts with none', () => {
    open(<ZonesField connection={CONNECTION} zones={zones} zoneRead={zoneRead} value={[]} onChange={onChange} />);
    const field = createWrapper(document.body).findMultiselect();
    expect(field?.findTokens()).toHaveLength(0);
    field?.openDropdown();
    const dropdown = field?.findDropdown();
    expect(dropdown?.findOptions()).toHaveLength(zones.length);
    for (const zone of zones) {
      expect(dropdown?.findOptionByValue(zone)?.findLabel().getElement()).toHaveTextContent(zone);
    }
  });
});

describe('IOPS, encryption and protection', () => {
  it('shows IOPS only for io1 and io2 with their range', () => {
    const field = (type: string) => (
      <IopsField value="" onChange={onChange} storageType={{ type, minIops: 1000, maxIops: 10000 }} />
    );
    const view = open(field('gp3'));
    expect(screen.queryByLabelText('Provisioned IOPS')).not.toBeInTheDocument();
    for (const type of ['io1', 'io2']) {
      view.rerender(field(type));
      expect(screen.getByLabelText('Provisioned IOPS')).toBeVisible();
      expect(screen.getByText('1000 to 10000.')).toBeVisible();
    }
  });

  it('explains the effects of Multi-AZ, encryption and protection for both resource kinds', () => {
    const toggle = { checked: false, onChange };
    const view = open(
      <>
        <MultiAzField {...toggle} />
        <EncryptStorageField {...toggle} />
        <DeletionProtectionField {...toggle} />
      </>,
    );
    for (const name of ['Multi-AZ', 'Encrypt storage', 'Deletion protection']) {
      expect(screen.getByRole('checkbox', { name })).toBeEnabled();
    }
    expect(
      screen.getByText('The emulator reports a second zone for the instance. A zone cannot be chosen with it.'),
    ).toBeVisible();
    expect(screen.getByText('The emulator records the storage as encrypted with the chosen key.')).toBeVisible();
    expect(screen.getByText('While it is on, the emulator refuses to delete the DB instance.')).toBeVisible();
    view.rerender(<DeletionProtectionField {...toggle} cluster />);
    expect(screen.getByText('While it is on, the emulator refuses to delete the DB cluster.')).toBeVisible();
  });

  it('shows the key only with encryption and describes its preset or a missing starting key', () => {
    const view = open(<KeyField {...blank} encrypted={false} />);
    expect(screen.queryByText('KMS key')).not.toBeInTheDocument();
    view.rerender(<KeyField {...blank} encrypted />);
    expect(trigger()).toHaveTextContent('Chosen by the emulator');
    expect(trigger()).toHaveTextContent('No key is sent. The emulator uses the key of its alias alias/aws/rds.');
    view.rerender(<KeyField {...blank} encrypted restore />);
    expect(trigger()).toHaveTextContent("Keep the snapshot's encryption");
    expect(trigger()).toHaveTextContent('No key is sent.');
    view.rerender(
      <KeyField {...blank} encrypted restore missing value={{ id: 'key-old', arn: 'arn:key:old', aliases: [] }} />,
    );
    expect(trigger()).toHaveTextContent('key-old');
    expect(trigger()).toHaveTextContent("Not in the emulator's list");
  });
});
