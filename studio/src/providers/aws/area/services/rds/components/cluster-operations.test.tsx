import type { OrderableDBInstanceOption } from '@aws-sdk/client-rds';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import type { DbInstance } from '../api';
import * as choices from '../choices-api';
import * as api from '../cluster-api';
import { ClusterOperationControls } from './cluster-operations';

vi.mock('../choices-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../choices-api')>()),
  findSubnetGroup: vi.fn(),
  readOrderableRows: vi.fn(),
  readUpgradeTargets: vi.fn(),
  listEngineVersionChoices: vi.fn(),
}));

vi.mock('../cluster-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cluster-api')>()),
  getCluster: vi.fn(),
  listMembers: vi.fn(),
}));

const CONNECTION: AreaConnection = {
  engineOrigin: 'http://127.0.0.1:8461',
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9461, endpoint: 'https://127.0.0.1:9461' } },
};
const CLUSTER: api.DbCluster = {
  id: 'cluster-one',
  status: 'available',
  engine: 'aurora-postgresql',
  engineVersion: '16.4',
  subnetGroup: 'default',
  securityGroups: ['sg-old'],
  storageType: 'aurora',
  backupRetentionPeriod: 7,
  deletionProtection: true,
  members: [
    { id: 'writer', writer: true },
    { id: 'reader', writer: false },
  ],
  tags: [],
};
const WRITER_ONLY = CLUSTER.members.filter(({ writer }) => writer);
const ROWS = [{ StorageType: 'aurora', MinStorageSize: 1, MaxStorageSize: 100 }, { StorageType: 'aurora-iopt1' }];
const TARGET = { version: '17.4', major: true };
const onSubmit = vi.fn();
const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  if (new URL(request.url).pathname === '/__emuforge/session') {
    return new Response(JSON.stringify({ token: 'test-cluster-operations' }));
  }
  const form = new URLSearchParams(await request.text());
  ec2Requests.push(Object.fromEntries(form));
  if (form.get('Action') === 'DescribeVpcs') {
    return new Response(
      '<DescribeVpcsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><vpcSet><item><vpcId>vpc-default</vpcId><isDefault>true</isDefault></item></vpcSet></DescribeVpcsResponse>',
      { headers: { 'content-type': 'text/xml' } },
    );
  }
  const group = (id: string, name: string, vpc: string) =>
    `<item><groupId>${id}</groupId><groupName>${name}</groupName><vpcId>${vpc}</vpcId></item>`;
  const groups =
    form.get('Filter.1.Name') === 'group-id'
      ? group('sg-old', 'old-group', 'vpc-one')
      : [
          { id: 'sg-new', name: 'new-group', vpc: 'vpc-one' },
          { id: 'sg-default', name: 'default-group', vpc: 'vpc-default' },
        ]
          .filter(({ vpc }) => form.get('Filter.1.Name') === 'vpc-id' && form.get('Filter.1.Value.1') === vpc)
          .map(({ id, name, vpc }) => group(id, name, vpc))
          .join('');
  return new Response(
    `<DescribeSecurityGroupsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><securityGroupInfo>${groups}</securityGroupInfo></DescribeSecurityGroupsResponse>`,
    { headers: { 'content-type': 'text/xml' } },
  );
});
const ec2Requests: Record<string, string>[] = [];
const WRAPPER = createWrapper(document.body);
const ROWS_OPERATION = 'DescribeOrderableDBInstanceOptions';

function instance(id: string): DbInstance {
  return {
    id,
    status: 'available',
    instanceClass: 'db.r6g.large',
    zone: 'us-east-1a',
    tags: [],
    securityGroups: [],
    parameterGroups: [],
    deletionProtection: false,
  };
}

function found(members: api.DbCluster['members']) {
  return { found: true, cluster: { ...CLUSTER, members } } as const;
}

beforeEach(() => {
  vi.resetAllMocks();
  ec2Requests.length = 0;
  vi.stubGlobal('fetch', fetchRequest);
  onSubmit.mockResolvedValue('discard-draft');
  vi.mocked(api.getCluster).mockResolvedValue(found(CLUSTER.members));
  vi.mocked(api.listMembers).mockResolvedValue([instance('writer'), instance('reader')]);
  vi.mocked(choices.findSubnetGroup).mockResolvedValue({ name: 'default', vpcId: 'vpc-one', zones: ['us-east-1a'] });
  vi.mocked(choices.readOrderableRows).mockResolvedValue(ROWS);
  vi.mocked(choices.readUpgradeTargets).mockResolvedValue([TARGET]);
  vi.mocked(choices.listEngineVersionChoices).mockResolvedValue({ choices: [{ version: '13.15' }, TARGET] });
});

afterEach(() => vi.unstubAllGlobals());

function InArea({ cluster }: { cluster: api.DbCluster }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <ClusterOperationControls
          cluster={cluster}
          connection={CONNECTION}
          pending={false}
          reading={false}
          unavailable={new Set()}
          onSubmit={onSubmit}
        />
      </AreaRootContext>
    </div>
  );
}

function renderControls(cluster = CLUSTER) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <InArea cluster={cluster} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function open(action: 'modify' | 'failover') {
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  const item = WRAPPER.findButtonDropdown()?.findItemById(action);
  if (item == null) throw new Error(`Missing ${action} action`);
  fireEvent.click(item.getElement());
  return within(await screen.findByRole('dialog'));
}

function field(label: string) {
  const match = WRAPPER.findModal()
    ?.findContent()
    .findAllFormFields()
    .find((item) => item.findLabel()?.getElement().textContent === label);
  if (match === undefined) throw new Error(`Missing ${label} field`);
  return match;
}

function select(label: string) {
  const match = createWrapper(field(label).getElement()).findSelect();
  if (match === null) throw new Error(`Missing ${label} select`);
  return match;
}

function securityGroups() {
  const groups = createWrapper(field('Security groups').getElement()).findMultiselect();
  if (groups === null) throw new Error('Missing security groups');
  return groups;
}

async function pick(label: string, value: string) {
  const picker = select(label);
  const trigger = picker.findTrigger().getElement();
  await waitFor(() => {
    expect(trigger).toBeEnabled();
    expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
  });
  picker.openDropdown();
  await waitFor(() => expect(picker.findDropdown().findOptionByValue(value), `${label}: ${value}`).not.toBeNull());
  picker.selectOptionByValue(value);
}

function deferredRows() {
  let resolve!: (rows: OrderableDBInstanceOption[]) => void;
  const promise = new Promise<OrderableDBInstanceOption[]>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe('modify a DB cluster', () => {
  it('explains what deletion protection does on the cluster', async () => {
    renderControls();
    const modal = await open('modify');
    expect(modal.getByRole('checkbox', { name: 'Deletion protection' })).toHaveAccessibleDescription(
      'While it is on, the emulator refuses to delete the DB cluster.',
    );
  });

  it('starts on the cluster values, reads starting groups by ID, and disables an unchanged save', async () => {
    renderControls();
    const modal = await open('modify');
    expect(modal.getByRole('textbox', { name: 'DB cluster identifier' })).toHaveValue('cluster-one');
    expect(modal.getByRole('textbox', { name: 'Backup retention period (days)' })).toHaveValue('7');
    expect(modal.getByRole('checkbox', { name: 'Deletion protection' })).toBeChecked();
    expect(select('Engine version').findTrigger().getElement()).toHaveTextContent('Keep 16.4');
    expect(select('Storage type').findTrigger().getElement()).toHaveTextContent('aurora');
    expect(await modal.findByText('old-group')).toBeInTheDocument();
    expect(ec2Requests).toContainEqual(
      expect.objectContaining({
        'Filter.1.Name': 'group-id',
        'Filter.1.Value.1': 'sg-old',
      }),
    );
    expect(modal.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it.each([
    {
      scenario: 'an empty default row',
      subnetGroup: { name: 'default', vpcId: 'vpc-absent' },
      vpc: 'vpc-default',
      offered: 'sg-default',
      excluded: 'sg-new',
      defaultLookup: true,
    },
    {
      scenario: 'a populated row',
      subnetGroup: { name: 'app-subnets', vpcId: 'vpc-one', zones: ['us-east-1a'] },
      vpc: 'vpc-one',
      offered: 'sg-new',
      excluded: 'sg-default',
      defaultLookup: false,
    },
  ])('offers groups from $vpc for $scenario', async ({ subnetGroup, vpc, offered, excluded, defaultLookup }) => {
    vi.mocked(choices.findSubnetGroup).mockResolvedValue(subnetGroup);
    renderControls({ ...CLUSTER, subnetGroup: subnetGroup.name });
    await open('modify');

    const picker = securityGroups();
    const trigger = picker.findTrigger().getElement();
    await waitFor(() => {
      expect(trigger).toBeEnabled();
      expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
    });
    picker.openDropdown();
    const dropdown = picker.findDropdown();
    await waitFor(() => expect(dropdown.findOptionByValue(offered)).not.toBeNull());
    expect(dropdown.findOptionByValue(excluded)).toBeNull();
    expect(ec2Requests.filter((request) => request['Filter.1.Name'] === 'vpc-id')).toEqual([
      expect.objectContaining({ Action: 'DescribeSecurityGroups', 'Filter.1.Value.1': vpc }),
    ]);
    expect(ec2Requests.filter((request) => request.Action === 'DescribeVpcs')).toEqual(
      defaultLookup ? [expect.objectContaining({ 'Filter.1.Name': 'is-default', 'Filter.1.Value.1': 'true' })] : [],
    );
  });

  it('shows Not set when no storage type was reported and omits it when saving another field', async () => {
    const cluster = { ...CLUSTER };
    delete cluster.storageType;
    renderControls(cluster);
    const modal = await open('modify');
    expect(select('Storage type').findTrigger().getElement()).toHaveTextContent('Not set');
    expect(modal.getByText('The cluster has no storage type.')).toBeInTheDocument();
    fireEvent.click(modal.getByRole('checkbox', { name: 'Deletion protection' }));
    fireEvent.click(modal.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith('cluster-one', { kind: 'modify', changes: { deletionProtection: false } });
  });

  it('offers only upgrade targets and holds a version whose rows require a different storage type', async () => {
    vi.mocked(choices.readOrderableRows).mockImplementation(async (_at, _engine, version) =>
      version === TARGET.version ? [{ StorageType: 'aurora-iopt1' }] : ROWS,
    );
    renderControls();
    const modal = await open('modify');
    const versions = select('Engine version');
    versions.openDropdown();
    await waitFor(() => expect(versions.findDropdown().findOptionByValue(TARGET.version)).not.toBeNull());
    expect(versions.findDropdown().findOptionByValue('13.15')).toBeNull();
    versions.selectOptionByValue(TARGET.version);
    expect(await modal.findByText('Choose a storage type for 17.4')).toBeInTheDocument();
    expect(modal.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('keeps the starting version options when the target rows arrive after switching back', async () => {
    const late = deferredRows();
    vi.mocked(choices.readOrderableRows).mockImplementation((_at, _engine, version) =>
      version === TARGET.version ? late.promise : Promise.resolve(ROWS),
    );
    renderControls();
    await open('modify');
    await pick('Engine version', TARGET.version);
    await waitFor(() =>
      expect(choices.readOrderableRows).toHaveBeenCalledWith(
        CONNECTION.engineOrigin,
        CLUSTER.engine,
        TARGET.version,
        expect.any(AbortSignal),
      ),
    );
    await pick('Engine version', '');
    await act(async () => late.resolve([{ StorageType: 'aurora-iopt1' }]));
    await waitFor(() => expect(select('Storage type').findTrigger().getElement()).toBeEnabled());
    expect(select('Storage type').findTrigger().getElement()).toHaveTextContent('aurora');
    select('Storage type').openDropdown();
    expect(select('Storage type').findDropdown().findOptionByValue('aurora')).not.toBeNull();
  });

  it.each(['error', '501'] as const)(
    'allows protection alone during a storage rows %s but holds a version change',
    async (kind) => {
      vi.mocked(choices.readOrderableRows).mockRejectedValue(
        new RequestError(
          kind === '501'
            ? { kind: 'not-implemented', operation: ROWS_OPERATION }
            : { kind: 'other', operation: ROWS_OPERATION, code: 'RowsUnavailable' },
        ),
      );
      renderControls();
      const modal = await open('modify');
      const storage = within(field('Storage type').getElement());
      await waitFor(() =>
        expect(field('Storage type').getElement()).toHaveTextContent(
          kind === '501' ? ROWS_OPERATION : 'RowsUnavailable',
        ),
      );
      expect(select('Storage type').findTrigger().getElement()).toHaveTextContent('aurora');
      if (kind === '501') expect(storage.getByText('Not implemented by the emulator')).toBeInTheDocument();
      else expect(storage.getByRole('button', { name: 'Retry' })).toBeEnabled();
      fireEvent.click(modal.getByRole('checkbox', { name: 'Deletion protection' }));
      const save = modal.getByRole('button', { name: 'Save changes' });
      expect(save).toBeEnabled();
      await pick('Engine version', TARGET.version);
      expect(save).toBeDisabled();
      await pick('Engine version', '');
      fireEvent.click(save);
      expect(onSubmit).toHaveBeenCalledWith('cluster-one', { kind: 'modify', changes: { deletionProtection: false } });
    },
  );

  it.each(['error', '501'] as const)(
    'shows the group lookup %s with the starting group still selected',
    async (kind) => {
      fetchRequest.mockImplementation(async (input, init) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        if (new URL(request.url).pathname === '/__emuforge/session') {
          return new Response(JSON.stringify({ token: 'test-cluster-operations' }));
        }
        return new Response('', { status: kind === '501' ? 501 : 400 });
      });
      renderControls();
      const modal = await open('modify');
      expect(modal.getAllByText('sg-old').length).toBeGreaterThan(0);
      if (kind === '501') {
        expect(await modal.findByText(/501 Not Implemented for DescribeSecurityGroups/)).toBeInTheDocument();
      } else {
        expect(await modal.findByRole('button', { name: 'Retry' })).toBeEnabled();
      }
    },
  );

  it('reopens a refused modify with the identifier, version, groups and storage type sent', async () => {
    onSubmit.mockResolvedValue('retain-draft');
    renderControls();
    const modal = await open('modify');
    fireEvent.change(modal.getByRole('textbox', { name: 'DB cluster identifier' }), { target: { value: 'renamed' } });
    await pick('Engine version', TARGET.version);
    await pick('Storage type', 'aurora-iopt1');

    const groups = securityGroups();
    await waitFor(() => expect(groups.findTrigger().getElement()).toBeEnabled());
    groups.openDropdown();
    await waitFor(() => expect(groups.findDropdown().findOptionByValue('sg-new')).not.toBeNull());
    groups.selectOptionByValue('sg-new');
    groups.closeDropdown();
    fireEvent.click(modal.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSubmit).toHaveBeenCalledWith('cluster-one', {
      kind: 'modify',
      changes: {
        newIdentifier: 'renamed',
        version: TARGET,
        storageType: 'aurora-iopt1',
        securityGroupIds: ['sg-old', 'sg-new'],
      },
    });

    const reopened = await open('modify');
    expect(reopened.getByRole('textbox', { name: 'DB cluster identifier' })).toHaveValue('renamed');
    expect(select('Engine version').findTrigger().getElement()).toHaveTextContent(TARGET.version);
    expect(select('Storage type').findTrigger().getElement()).toHaveTextContent('aurora-iopt1');
    expect(reopened.getAllByText('sg-new').length).toBeGreaterThan(0);
  });
});

describe('fail over a DB cluster', () => {
  const target = () => select('Target DB instance');
  const option = (id: string) => target().findDropdown().findOptionByValue(id);

  it('rereads both sources each time the picker opens and describes the latest readers', async () => {
    renderControls();
    await open('failover');
    await waitFor(() => expect(api.getCluster).toHaveBeenCalledTimes(1));
    target().openDropdown();
    await waitFor(() => expect(option('reader')?.getElement()).toHaveTextContent('db.r6g.large · us-east-1a'));
    expect(option('writer')).toBeNull();
    target().closeDropdown();

    vi.mocked(api.getCluster).mockResolvedValue(
      found([
        { id: 'writer', writer: false },
        { id: 'reader', writer: true },
        { id: 'new-reader', writer: false },
      ]),
    );
    vi.mocked(api.listMembers).mockResolvedValue([instance('writer'), instance('reader'), instance('new-reader')]);
    target().openDropdown();
    await waitFor(() => expect(option('new-reader')).not.toBeNull());
    expect(option('reader')).toBeNull();
    expect(option('writer')).not.toBeNull();
    expect(api.getCluster).toHaveBeenCalledTimes(3);
    expect(api.listMembers).toHaveBeenCalledTimes(3);
  });

  it('clears a selected reader promoted outside Studio and requires a reader from the refreshed list', async () => {
    renderControls();
    const modal = await open('failover');
    const submit = modal.getByRole('button', { name: 'Fail over' });
    await pick('Target DB instance', 'reader');
    expect(submit).toBeEnabled();

    vi.mocked(api.getCluster).mockResolvedValue(
      found([
        { id: 'writer', writer: false },
        { id: 'reader', writer: true },
      ]),
    );
    const picker = target();
    picker.openDropdown();
    const message = 'reader is no longer a reader of this DB cluster.';
    expect(await modal.findByText(message)).toBeVisible();
    expect(picker.findTrigger().getElement()).toHaveTextContent('Select a reader DB instance');
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    await waitFor(() => expect(option('writer')).not.toBeNull());
    picker.selectOptionByValue('writer');
    expect(modal.queryByText(message)).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('cluster-one', { kind: 'failover', target: 'writer' });
  });

  it('holds failover when the picker closes before its latest reader check answers', async () => {
    renderControls();
    const modal = await open('failover');
    const submit = modal.getByRole('button', { name: 'Fail over' });
    await pick('Target DB instance', 'reader');
    expect(submit).toBeEnabled();

    const promoted = found([
      { id: 'writer', writer: false },
      { id: 'reader', writer: true },
    ]);
    let answer!: (result: typeof promoted) => void;
    const refresh = new Promise<typeof promoted>((resolve) => {
      answer = resolve;
    });
    const getCluster = vi.mocked(api.getCluster);
    getCluster.mockReturnValueOnce(refresh);

    const picker = target();
    picker.openDropdown();
    await waitFor(() => expect(getCluster).toHaveBeenCalledTimes(3));
    expect(submit).toBeDisabled();
    picker.closeDropdown();
    await act(async () => answer(promoted));
    expect(await modal.findByText('reader is no longer a reader of this DB cluster.')).toBeVisible();
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the pending check after the picker closes and restores failover for a verified reader', async () => {
    renderControls();
    const modal = await open('failover');
    const submit = modal.getByRole('button', { name: 'Fail over' });
    await pick('Target DB instance', 'reader');
    expect(submit).toBeEnabled();

    const readers = found(CLUSTER.members);
    let answer!: (result: typeof readers) => void;
    const refresh = new Promise<typeof readers>((resolve) => {
      answer = resolve;
    });
    const getCluster = vi.mocked(api.getCluster);
    getCluster.mockReturnValueOnce(refresh);

    const picker = target();
    picker.openDropdown();
    await waitFor(() => expect(getCluster).toHaveBeenCalledTimes(3));
    picker.closeDropdown();
    expect(picker.findTrigger().getElement()).toHaveAttribute('aria-expanded', 'false');
    expect(picker.findTrigger().getElement()).toHaveTextContent('reader');
    expect(modal.getByText('Loading DB instances')).toBeVisible();
    expect(submit).toBeDisabled();

    await act(async () => answer(readers));
    await waitFor(() => expect(submit).toBeEnabled());
    expect(modal.queryByText('Loading DB instances')).not.toBeInTheDocument();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('cluster-one', { kind: 'failover', target: 'reader' });
  });

  it('reports a 501 from the members read at the target and holds the action', async () => {
    vi.mocked(api.listMembers).mockRejectedValue(
      new RequestError({
        kind: 'not-implemented',
        operation: 'DescribeDBInstances',
      }),
    );
    renderControls();
    const modal = await open('failover');
    expect(await modal.findByText(/501 Not Implemented for DescribeDBInstances/)).toBeInTheDocument();
    expect(modal.getByRole('button', { name: 'Fail over' })).toBeDisabled();
  });

  it('offers and submits an externally added reader even if the page saw only the writer', async () => {
    renderControls({ ...CLUSTER, members: WRITER_ONLY });
    const modal = await open('failover');
    await pick('Target DB instance', 'reader');
    fireEvent.click(modal.getByRole('button', { name: 'Fail over' }));
    expect(onSubmit).toHaveBeenCalledWith('cluster-one', { kind: 'failover', target: 'reader' });
  });

  it('shows the reason when there is no reader, then offers a reader after reopening the target', async () => {
    vi.mocked(api.getCluster).mockResolvedValue(found(WRITER_ONLY));
    renderControls({ ...CLUSTER, members: WRITER_ONLY });
    const modal = await open('failover');
    expect(await modal.findByText('Failover requires a reader DB instance in this cluster.')).toBeInTheDocument();
    target().openDropdown();
    await waitFor(() => expect(target().findDropdown().findOptions()).toEqual([]));
    expect(modal.getByRole('button', { name: 'Fail over' })).toBeDisabled();
    target().closeDropdown();
    vi.mocked(api.getCluster).mockResolvedValue(found(CLUSTER.members));
    await pick('Target DB instance', 'reader');
    expect(modal.getByRole('button', { name: 'Fail over' })).toBeEnabled();
  });
});
