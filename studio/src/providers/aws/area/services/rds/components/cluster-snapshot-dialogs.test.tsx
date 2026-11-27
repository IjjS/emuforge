import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { kmsKeyChoices } from '../../../components/kms-key-choices';
import { PageFlashContext } from '../../../components/page-flash';
import { listSecurityGroupChoices } from '../../../components/security-group-choices';
import { listAvailabilityZones } from '../../../lib/ec2-availability-zones';
import { findSubnetGroup, listSubnetGroupChoices, readDefaultVpcId } from '../choices-api';
import { createClusterSnapshot } from '../cluster-snapshot-api';
import { RestoreSnapshotDialog, TakeSnapshotAction } from './cluster-snapshot-dialogs';

vi.mock('../cluster-snapshot-api', async (original) => ({
  ...(await original<typeof import('../cluster-snapshot-api')>()),
  createClusterSnapshot: vi.fn(),
}));
vi.mock('../choices-api', async (original) => ({
  ...(await original<typeof import('../choices-api')>()),
  findSubnetGroup: vi.fn(),
  listSubnetGroupChoices: vi.fn(),
  readDefaultVpcId: vi.fn(),
}));
vi.mock('../../../components/security-group-choices', async (original) => {
  const actual = await original<typeof import('../../../components/security-group-choices')>();
  return {
    ...actual,
    listSecurityGroupChoices: vi.fn(),
    securityGroupChoices: (...args: Parameters<typeof actual.securityGroupChoices>) => ({
      ...actual.securityGroupChoices(...args),
      read: async (
        ...[at, name, marker, signal]: Parameters<ReturnType<typeof actual.securityGroupChoices>['read']>
      ) => {
        const { choices } = await listSecurityGroupChoices(at, { vpcId: args[1], name }, marker, signal);
        return { items: choices };
      },
    }),
  };
});
vi.mock('../../../components/kms-key-choices', async (original) => {
  const actual = await original<typeof import('../../../components/kms-key-choices')>();
  return {
    ...actual,
    kmsKeyChoices: vi.fn((endpoint: string | undefined) => ({
      ...actual.kmsKeyChoices(endpoint),
      read: async () => ({ items: [KEY] }),
    })),
  };
});
vi.mock('../../../lib/ec2-availability-zones', async (original) => ({
  ...(await original<typeof import('../../../lib/ec2-availability-zones')>()),
  listAvailabilityZones: vi.fn(),
}));

const ENDPOINT = 'http://127.0.0.1:8399';
const CONNECTION: AreaConnection = { engineOrigin: ENDPOINT, result: undefined };
const DEFAULT = { name: 'default', vpcId: 'vpc-default', zones: ['us-east-1a'] };
const BLUE = { name: 'blue-network', vpcId: 'vpc-blue', zones: ['us-east-1b', 'us-east-1c'] };
const GREEN = { name: 'green-network', vpcId: 'vpc-green', zones: ['us-east-1c', 'us-east-1d'] };
const GROUP = { id: 'sg-blue', name: 'blue-group', vpcId: BLUE.vpcId };
const KEY = { id: 'key-id', arn: 'arn:aws:kms:us-east-1:000000000000:key/key-id', aliases: ['alias/restore'] };
const show = vi.fn();
const handOver = vi.fn();

function open(content: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Frame() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <PageFlashContext value={{ show, handOver }}>
            <div ref={root}>
              <AreaRootContext value={root}>{content}</AreaRootContext>
            </div>
          </PageFlashContext>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }
  return render(<Frame />);
}

async function openRestore() {
  const submit = vi.fn();
  open(
    <RestoreSnapshotDialog
      connection={CONNECTION}
      initial={undefined}
      target="source-snap"
      pending={false}
      onDismiss={vi.fn()}
      onSubmit={submit}
    />,
  );
  const dialog = within(await screen.findByRole('dialog'));
  return { dialog, submit };
}

function change(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function modalField(label: string) {
  const field = createWrapper(screen.getByRole('dialog'))
    .findAllFormFields()
    .find((entry) => entry.findLabel()?.getElement().textContent === label);
  if (field === undefined) throw new Error(`Missing field ${label}.`);
  return createWrapper(field.getElement());
}

function selectIn(label: string) {
  const select = modalField(label).findSelect();
  if (select === null) throw new Error(`Missing select for ${label}.`);
  return select;
}

function multiselectIn(label: string) {
  const select = modalField(label).findMultiselect();
  if (select === null) throw new Error(`Missing multiselect for ${label}.`);
  return select;
}

const SUBNET_GROUP = 'DB subnet group - optional';
const SECURITY_GROUPS = 'Security groups - optional';
const ZONES = 'Availability Zones';

async function choose(label: string, value: string) {
  const field = label === SECURITY_GROUPS || label === ZONES ? multiselectIn(label) : selectIn(label);
  await waitFor(() => expect(field.findTrigger().getElement()).toBeEnabled());
  field.openDropdown();
  await waitFor(() => expect(field.findDropdown().findOptionByValue(value)).not.toBeNull());
  field.selectOptionByValue(value);
  if (label === SECURITY_GROUPS || label === ZONES) field.closeDropdown();
}

function unsupported(operation: string) {
  return new RequestError({ kind: 'not-implemented', operation });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClusterSnapshot).mockReset();
  vi.mocked(findSubnetGroup)
    .mockReset()
    .mockImplementation(async (_endpoint, name) => [DEFAULT, BLUE, GREEN].find((group) => group.name === name));
  vi.mocked(listSubnetGroupChoices).mockResolvedValue({ choices: [DEFAULT, BLUE, GREEN] });
  vi.mocked(readDefaultVpcId).mockReset().mockResolvedValue(DEFAULT.vpcId);
  vi.mocked(listSecurityGroupChoices).mockImplementation(async (_endpoint, { vpcId }) => ({
    choices: vpcId === BLUE.vpcId ? [GROUP] : [{ id: 'sg-local', name: 'local-group', ...(vpcId && { vpcId }) }],
  }));
  vi.mocked(listAvailabilityZones).mockResolvedValue(['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1d']);
});

describe('Snapshot creation', () => {
  async function takeSnapshot() {
    fireEvent.click(screen.getByRole('button', { name: 'Take snapshot' }));
    return within(await screen.findByRole('dialog'));
  }

  it('shows the identifier and tags and focuses the missing key without sending a request', async () => {
    open(<TakeSnapshotAction endpoint={ENDPOINT} sourceId="source-db" disabled={false} />);
    const dialog = await takeSnapshot();
    change(dialog.getByRole('textbox', { name: 'DB cluster snapshot identifier' }), 'new-snap');
    expect(dialog.getByText('Tags - optional')).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: 'Add tag' }));
    change(dialog.getByRole('textbox', { name: /Value/ }), 'orphan-value');
    fireEvent.click(dialog.getByRole('button', { name: 'Take snapshot' }));
    expect(dialog.getByText('Enter a key.')).toBeVisible();
    expect(dialog.getByRole('textbox', { name: 'Key' })).toHaveFocus();
    expect(createClusterSnapshot).not.toHaveBeenCalled();
  });

  it('reopens a refused creation with the identifier and tag rows', async () => {
    vi.mocked(createClusterSnapshot).mockRejectedValueOnce(
      new RequestError({
        kind: 'other',
        operation: 'CreateDBClusterSnapshot',
        code: 'DBClusterSnapshotAlreadyExistsFault',
      }),
    );
    open(<TakeSnapshotAction endpoint={ENDPOINT} sourceId="source-db" disabled={false} />);
    const dialog = await takeSnapshot();
    change(dialog.getByRole('textbox', { name: 'DB cluster snapshot identifier' }), 'new-snap');
    fireEvent.click(dialog.getByRole('button', { name: 'Add tag' }));
    change(dialog.getByRole('textbox', { name: 'Key' }), 'kept');
    change(dialog.getByRole('textbox', { name: /Value/ }), 'yes');
    fireEvent.click(dialog.getByRole('button', { name: 'Take snapshot' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(createClusterSnapshot).toHaveBeenCalledWith(ENDPOINT, 'source-db', 'new-snap', expect.any(AbortSignal), [
      { key: 'kept', value: 'yes' },
    ]);
    expect(show).toHaveBeenCalledTimes(1);
    const retry = await takeSnapshot();
    expect(retry.getByRole('textbox', { name: 'DB cluster snapshot identifier' })).toHaveValue('new-snap');
    expect(retry.getByRole('textbox', { name: 'Key' })).toHaveValue('kept');
    expect(retry.getByRole('textbox', { name: /Value/ })).toHaveValue('yes');
  });
});

describe('Snapshot restoration', () => {
  it('shows the restore fields and explains the subnet group and encryption defaults', async () => {
    const { dialog } = await openRestore();
    expect(dialog.getByRole('textbox', { name: 'DB cluster identifier' })).toHaveValue('');
    const subnetGroup = selectIn(SUBNET_GROUP).findTrigger().getElement();
    expect(subnetGroup).toHaveTextContent('Chosen by the emulator');
    expect(subnetGroup).toHaveTextContent('The emulator puts the cluster in its subnet group named default.');
    expect(multiselectIn(SECURITY_GROUPS).findTrigger().getElement()).toBeVisible();
    expect(multiselectIn(ZONES).findTrigger().getElement()).toBeVisible();
    const key = selectIn('KMS key').findTrigger().getElement();
    expect(key).toHaveTextContent("Keep the snapshot's encryption");
    expect(key).toHaveTextContent('No key is sent.');
    expect(dialog.getByRole('checkbox', { name: 'Deletion protection' })).not.toBeChecked();
    expect(dialog.getByText('Tags - optional')).toBeVisible();
  });

  it('reads groups in the chosen VPC and clears only the groups and zones the next subnet group lacks', async () => {
    await openRestore();
    await choose(SUBNET_GROUP, BLUE.name);
    await choose(SECURITY_GROUPS, GROUP.id);
    expect(listSecurityGroupChoices).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ vpcId: BLUE.vpcId }),
      undefined,
      expect.any(AbortSignal),
    );

    const zones = multiselectIn(ZONES);
    zones.openDropdown();
    expect(zones.findDropdown().findOptionByValue('us-east-1a')).toBeNull();
    zones.selectOptionByValue('us-east-1b');
    zones.selectOptionByValue('us-east-1c');
    zones.closeDropdown();
    expect(multiselectIn(SECURITY_GROUPS).findTokens()).toHaveLength(1);
    expect(zones.findTokens()).toHaveLength(2);

    await choose(SUBNET_GROUP, GREEN.name);
    await waitFor(() => {
      expect(multiselectIn(SECURITY_GROUPS).findTokens()).toHaveLength(0);
      const zones = multiselectIn(ZONES).findTokens();
      expect(zones).toHaveLength(1);
      expect(zones?.[0]?.getElement()).toHaveTextContent('us-east-1c');
    });
    await choose(SECURITY_GROUPS, 'sg-local');
    expect(listSecurityGroupChoices).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ vpcId: GREEN.vpcId }),
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('hands the selected fields and key ARN to the page', async () => {
    const { dialog, submit } = await openRestore();
    change(dialog.getByRole('textbox', { name: 'DB cluster identifier' }), 'restored');
    await choose(SUBNET_GROUP, BLUE.name);
    await choose(SECURITY_GROUPS, GROUP.id);
    await choose(ZONES, 'us-east-1b');
    await choose('KMS key', KEY.arn);
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Deletion protection' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Add tag' }));
    change(dialog.getByRole('textbox', { name: 'Key' }), 'from');
    change(dialog.getByRole('textbox', { name: /Value/ }), 'snapshot');
    fireEvent.click(dialog.getByRole('button', { name: 'Restore' }));

    expect(kmsKeyChoices).toHaveBeenCalledWith(ENDPOINT);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ key: KEY }), {
      identifier: 'restored',
      subnetGroupName: BLUE.name,
      securityGroupIds: [GROUP.id],
      zones: ['us-east-1b'],
      kmsKeyArn: KEY.arn,
      deletionProtection: true,
      tags: [{ key: 'from', value: 'snapshot' }],
    });
  });

  it.each([false, true])(
    'uses the default VPC without offering zones when default is empty (explicit=%s)',
    async (explicit) => {
      const empty = { name: 'default', vpcId: 'vpc-old' };
      vi.mocked(findSubnetGroup).mockResolvedValue(empty);
      vi.mocked(listSubnetGroupChoices).mockResolvedValue({ choices: [empty] });
      await openRestore();
      if (explicit) await choose(SUBNET_GROUP, 'default');
      await choose(SECURITY_GROUPS, 'sg-local');
      expect(readDefaultVpcId).toHaveBeenCalledWith(ENDPOINT, expect.any(AbortSignal));
      expect(listSecurityGroupChoices).toHaveBeenCalledWith(
        ENDPOINT,
        expect.objectContaining({ vpcId: DEFAULT.vpcId }),
        undefined,
        expect.any(AbortSignal),
      );
      const zones = multiselectIn(ZONES);
      zones.openDropdown();
      expect(zones.findDropdown().findOptions()).toEqual([]);
    },
  );

  it.each([
    ['DescribeDBSubnetGroups', false],
    ['DescribeDBSubnetGroups', true],
    ['DescribeVpcs', false],
  ])('shows a 501 from %s on both network fields and still restores (explicit=%s)', async (operation, explicit) => {
    if (operation === 'DescribeDBSubnetGroups') {
      vi.mocked(findSubnetGroup).mockRejectedValue(unsupported(operation));
    } else {
      vi.mocked(findSubnetGroup).mockResolvedValue({ name: 'default', vpcId: 'vpc-old' });
      vi.mocked(readDefaultVpcId).mockRejectedValue(unsupported(operation));
    }

    const { dialog, submit } = await openRestore();
    if (explicit) {
      await choose(SUBNET_GROUP, BLUE.name);
      await waitFor(() => expect(findSubnetGroup).toHaveBeenCalledWith(ENDPOINT, BLUE.name, expect.any(AbortSignal)));
    }
    await waitFor(() => {
      expect(dialog.getAllByText('Not implemented by the emulator')).toHaveLength(2);
      expect(dialog.getAllByText(new RegExp('501 Not Implemented for ' + operation))).toHaveLength(2);
    });
    expect(multiselectIn(SECURITY_GROUPS).findTrigger().getElement()).toBeDisabled();
    expect(listSecurityGroupChoices).not.toHaveBeenCalled();
    const zones = multiselectIn(ZONES);
    zones.openDropdown();
    expect(zones.findDropdown().findOptions()).toEqual([]);

    change(dialog.getByRole('textbox', { name: 'DB cluster identifier' }), 'restored');
    fireEvent.click(dialog.getByRole('button', { name: 'Restore' }));
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      explicit ? { identifier: 'restored', subnetGroupName: BLUE.name } : { identifier: 'restored' },
    );
  });
});
