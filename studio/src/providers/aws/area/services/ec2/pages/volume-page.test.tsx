import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as instances from '../api';
import { EC2_KEYS } from '../queries';
import * as api from '../volume-api';
import { VOLUME_KEYS, useVolumeListing } from '../volume-queries';

vi.mock('../volume-api', async (original) => ({
  ...(await original<typeof api>()),
  getVolume: vi.fn(),
  attachVolume: vi.fn(),
  detachVolume: vi.fn(),
  deleteVolume: vi.fn(),
  listVolumes: vi.fn(),
}));

vi.mock('../api', async (original) => ({
  ...(await original<typeof instances>()),
  listInstances: vi.fn(),
}));

// S2 wires the production routes. Register the detail and a listing observer in the area for this unit.
vi.mock('../screens', async () => {
  const [{ VolumePage }, { INSTANCES_NAVIGATION }, paths] = await Promise.all([
    import('./volume-page'),
    import('../navigation'),
    import('../volume-format'),
  ]);
  return {
    SCREENS: [
      {
        paths: [paths.VOLUME_PATTERN],
        title: 'Volume',
        crumbs: [{ text: 'Volumes', href: paths.VOLUMES_PATH }, { text: 'Volume' }],
        navigation: INSTANCES_NAVIGATION,
        Page: VolumePage,
      },
      {
        paths: [paths.VOLUMES_PATH],
        title: 'Volumes',
        crumbs: [{ text: 'Volumes' }],
        navigation: INSTANCES_NAVIGATION,
        Page: TestVolumeList,
      },
    ],
  };
});

const ID = 'vol-42';
const TARGET = { instanceId: 'i-42', device: '/dev/sdf' };
const PATH = '/aws/ec2/volumes';
const ENDPOINT = 'http://127.0.0.1:8311';
const connection: AreaConnection = {
  engineOrigin: ENDPOINT,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9311, endpoint: 'https://127.0.0.1:9311' } },
};
const available: api.VolumeRead = {
  found: true,
  volume: { id: ID, size: 8, type: 'gp2', zone: 'us-east-1a', state: 'available', attachments: [] },
};
const attached: api.VolumeRead = {
  found: true,
  volume: { ...available.volume, state: 'in-use', attachments: [{ ...TARGET, state: 'attached' }] },
};
const missing: api.VolumeRead = { found: false };

function instance(id: string, zone: string, state: string): instances.Instance {
  return { id, zone, state, tags: [], groups: [], volumes: [] };
}

function refuse(operation: string, code: string, message: string) {
  return new RequestError({ kind: 'other', operation, code, message });
}

function unimplemented(operation: string) {
  return new RequestError({ kind: 'not-implemented', operation });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function TestVolumeList() {
  const list = useVolumeListing(ENDPOINT);
  return (
    <>
      <h1>Volumes</h1>
      <p>{list.items === undefined ? 'Loading volumes' : 'List refreshed'}</p>
    </>
  );
}

function Area({ observe }: { observe: boolean }) {
  const { pathname } = useLocation();
  const [visit, setVisit] = useState({ path: pathname, count: 0 });
  if (pathname !== visit.path) setVisit({ path: pathname, count: visit.count + 1 });
  return (
    <>
      {observe && <RefreshObservers />}
      <AwsArea
        headerSelector="#top-bar"
        onPageTitle={() => undefined}
        onContentTarget={() => undefined}
        routeChanges={visit.count}
        connection={connection}
      />
    </>
  );
}

function RefreshObservers() {
  const list = useQuery({
    queryKey: [...VOLUME_KEYS.list, 'observer'],
    queryFn: ({ signal }) => api.listVolumes(ENDPOINT, undefined, signal),
  });
  const listInstances = useQuery({
    queryKey: [...EC2_KEYS.instances(), 'observer'],
    queryFn: ({ signal }) => instances.listInstances(ENDPOINT, {}, undefined, signal),
  });
  return <span>{list.isFetching || listInstances.isFetching ? 'Refreshing lists' : 'Lists current'}</span>;
}

function open(observe = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area observe={observe} /> }], {
    initialEntries: [`${PATH}/volume/${ID}`],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const page = createWrapper(document.body);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.mocked(api.getVolume).mockResolvedValue(available);
  vi.mocked(api.attachVolume).mockResolvedValue(undefined);
  vi.mocked(api.detachVolume).mockResolvedValue(undefined);
  vi.mocked(api.deleteVolume).mockResolvedValue(undefined);
  vi.mocked(api.listVolumes).mockResolvedValue({ items: [] });
  vi.mocked(instances.listInstances).mockResolvedValue({
    instances: [instance(TARGET.instanceId, 'us-east-1a', 'running')],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function button(name: string) {
  return screen.getByRole('button', { name });
}

async function openDialog(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
  return within(await screen.findByRole('dialog'));
}

function instanceSelect() {
  const select = page.findSelect();
  if (select == null) throw new Error('Missing instance selector');
  return select;
}

function openChoices() {
  const select = instanceSelect();
  act(() => {
    select.openDropdown();
  });
  return select.findDropdown();
}

function selectInstance(id: string) {
  act(() => {
    instanceSelect().selectOptionByValue(id);
  });
}

async function chooseInstance(id = TARGET.instanceId) {
  const dropdown = openChoices();
  await waitFor(() => {
    expect(dropdown.findOptionByValue(id)).not.toBeNull();
  });
  selectInstance(id);
}

async function fillAttachDialog() {
  const dialog = await openDialog('Attach volume');
  await chooseInstance();
  fireEvent.change(dialog.getByRole('textbox', { name: 'Device name' }), { target: { value: TARGET.device } });
  return dialog;
}

function confirmDelete(dialog: ReturnType<typeof within>) {
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: ID } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete volume' }));
}

describe('volume detail', () => {
  it('shows the ID, returned volume values and linked attachment', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    open();
    expect(screen.getByRole('heading', { level: 1, name: ID })).toBeVisible();
    await screen.findByRole('heading', { name: 'Volume details' });
    const details = page
      .findKeyValuePairs()
      ?.findItems()
      .map((item) => [item.findLabel()?.getElement().textContent, item.findValue()?.getElement().textContent]);
    expect(details).toEqual([
      ['Volume ID', ID],
      ['Size', '8 GiB'],
      ['Type', 'gp2'],
      ['Availability Zone', 'us-east-1a'],
      ['State', 'in-use'],
    ]);
    for (const value of [TARGET.device, 'attached']) {
      expect(screen.getByText(value, { exact: true })).toBeVisible();
    }
    expect(screen.getByRole('link', { name: TARGET.instanceId })).toHaveAttribute(
      'href',
      `/aws/ec2/instances/instance/${TARGET.instanceId}`,
    );
  });

  it('links back to volumes for a missing ID', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(missing);
    open();
    expect(await screen.findByText('Volume not found')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View volumes' })).toHaveAttribute('href', PATH);
  });

  it('replaces a failed read with details on Retry', async () => {
    vi.mocked(api.getVolume).mockRejectedValueOnce(refuse('DescribeVolumes', 'InvalidParameterValue', 'Cannot read.'));
    open();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('InvalidParameterValue')).toBeVisible();
    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'Volume details' })).toBeVisible();
    expect(screen.queryByText('InvalidParameterValue')).toBeNull();
  });

  it('shows a detail 501 as unimplemented', async () => {
    vi.mocked(api.getVolume).mockRejectedValue(unimplemented('DescribeVolumes'));
    open();
    expect(await screen.findAllByText('Not implemented by the emulator')).not.toHaveLength(0);
    expect(screen.getByText(/501 Not Implemented for DescribeVolumes/)).toBeVisible();
  });
});

describe('attach volume', () => {
  it('pages through instance choices with IDs, zones and states and requires a choice and device', async () => {
    vi.mocked(instances.listInstances)
      .mockResolvedValueOnce({ instances: [instance('i-first', 'us-east-1a', 'running')], nextToken: 'second' })
      .mockResolvedValueOnce({ instances: [instance('i-second', 'us-east-1b', 'stopped')] });
    open();
    const dialog = await openDialog('Attach volume');
    const submit = dialog.getByRole('button', { name: 'Attach volume' });
    const device = dialog.getByRole('textbox', { name: 'Device name' });
    expect(submit).toBeDisabled();
    fireEvent.change(device, { target: { value: TARGET.device } });
    expect(submit).toBeDisabled();

    const dropdown = openChoices();
    await waitFor(() => {
      expect(dropdown.findOptionByValue('i-first')?.getElement()).toHaveTextContent(/i-first.*us-east-1a.*running/);
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(dropdown.findOptionByValue('i-second')?.getElement()).toHaveTextContent(/i-second.*us-east-1b.*stopped/);
    });
    expect(instances.listInstances).toHaveBeenLastCalledWith(ENDPOINT, {}, 'second', expect.any(AbortSignal));
    fireEvent.change(device, { target: { value: '   ' } });
    selectInstance('i-second');
    expect(submit).toBeDisabled();
    fireEvent.change(device, { target: { value: TARGET.device } });
    expect(submit).toBeEnabled();
    expect(api.attachVolume).not.toHaveBeenCalled();
  });

  it('keeps a failed attachment usable and shows the emulator refusal', async () => {
    vi.mocked(instances.listInstances).mockResolvedValue({
      instances: [instance(TARGET.instanceId, 'us-east-1a', 'terminated')],
    });
    vi.mocked(api.attachVolume).mockRejectedValue(
      refuse('AttachVolume', 'IncorrectInstanceState', 'The instance is terminated.'),
    );
    open();
    const dialog = await fillAttachDialog();
    const submit = dialog.getByRole('button', { name: 'Attach volume' });
    fireEvent.click(submit);
    expect(await dialog.findByText('IncorrectInstanceState')).toBeVisible();
    expect(dialog.getByText(/The instance is terminated\./)).toBeVisible();
    expect(dialog.getByRole('textbox', { name: 'Device name' })).toHaveValue(TARGET.device);
    expect(submit).toBeEnabled();
  });

  // Bound: Allow one real three-second poll plus dialog and query rendering on a busy runner.
  it('preserves the acknowledgment and polls past an unchanged detail while other reads are held', async () => {
    const list = deferred<{ items: api.Volume[] }>();
    const instanceList = deferred<instances.InstancePage>();
    open(true);
    await screen.findByText('Lists current');
    const dialog = await fillAttachDialog();
    vi.mocked(api.getVolume).mockResolvedValueOnce(available).mockResolvedValue(attached);
    vi.mocked(api.listVolumes).mockReturnValue(list.promise);
    vi.mocked(instances.listInstances).mockReturnValue(instanceList.promise);

    fireEvent.click(dialog.getByRole('button', { name: 'Attach volume' }));
    const acknowledgment = `Attachment requested for ${ID}.`;
    expect(await screen.findByText(acknowledgment, { exact: true })).toBeVisible();
    await waitFor(() => {
      expect(api.getVolume).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('available')).toBeVisible();
    expect(screen.getByText('Refreshing lists')).toBeVisible();
    expect(await screen.findByRole('link', { name: TARGET.instanceId }, { timeout: 4500 })).toBeVisible();
    expect(screen.getByText(acknowledgment, { exact: true })).toBeVisible();
    list.resolve({ items: [] });
    instanceList.resolve({ instances: [] });
    expect(await screen.findByText('Lists current')).toBeVisible();
    expect(screen.getByText(acknowledgment, { exact: true })).toBeVisible();
  }, 7000);

  it('retries a failed instance choice read and offers fresh results', async () => {
    vi.mocked(instances.listInstances).mockRejectedValueOnce(
      refuse('DescribeInstances', 'InvalidParameterValue', 'Could not list instances.'),
    );
    open();
    const dialog = await openDialog('Attach volume');
    const dropdown = openChoices();
    fireEvent.click(await dialog.findByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(dropdown.findOptionByValue(TARGET.instanceId)).not.toBeNull();
    });
    selectInstance(TARGET.instanceId);
    expect(instanceSelect().findTrigger().getElement()).toHaveTextContent(TARGET.instanceId);
  });

  it('names AttachVolume on 501 and keeps the action unavailable after dismissal', async () => {
    vi.mocked(api.attachVolume).mockRejectedValue(unimplemented('AttachVolume'));
    open();
    const dialog = await fillAttachDialog();
    const submit = dialog.getByRole('button', { name: 'Attach volume' });
    fireEvent.click(submit);
    expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
    expect(dialog.getByText(/501 Not Implemented for AttachVolume/)).toBeVisible();
    expect(submit).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(button('Attach volume')).toBeDisabled();
    expect(button('Delete volume')).toBeEnabled();
  });
});

describe('detach volume', () => {
  it('identifies the attachment and preserves the acknowledgment while detail finishes last', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    const detail = deferred<api.VolumeRead>();
    open(true);
    await screen.findByText('Lists current');
    const dialog = await openDialog('Detach volume');
    for (const value of [ID, TARGET.instanceId, TARGET.device]) expect(dialog.getByText(value)).toBeVisible();
    vi.mocked(api.getVolume).mockReturnValue(detail.promise);
    fireEvent.click(dialog.getByRole('button', { name: 'Detach volume' }));
    const acknowledgment = `Detachment requested for ${ID}.`;
    expect(await screen.findByText(acknowledgment, { exact: true })).toBeVisible();
    await waitFor(() => {
      expect(api.listVolumes).toHaveBeenCalledTimes(2);
      expect(api.getVolume).toHaveBeenCalledTimes(2);
      expect(instances.listInstances).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('Lists current')).toBeVisible();
    expect(screen.getByText('attached')).toBeVisible();
    expect(api.detachVolume).toHaveBeenCalledWith(ENDPOINT, ID, TARGET, expect.any(AbortSignal));
    detail.resolve(available);
    expect(await screen.findByText('No attachments')).toBeVisible();
    expect(screen.getByText('available')).toBeVisible();
    expect(screen.getByText(acknowledgment, { exact: true })).toBeVisible();
  });

  it('displays IncorrectState for a refusal after an external detach', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    vi.mocked(api.detachVolume).mockRejectedValue(
      refuse('DetachVolume', 'IncorrectState', 'The volume is already available.'),
    );
    open();
    const dialog = await openDialog('Detach volume');
    const submit = dialog.getByRole('button', { name: 'Detach volume' });
    fireEvent.click(submit);
    expect(await dialog.findByText('IncorrectState')).toBeVisible();
    expect(dialog.getByText(/The volume is already available\./)).toBeVisible();
    expect(submit).toBeEnabled();
    expect(screen.queryByText(/Detachment requested/)).toBeNull();
  });

  it('cancels without changing the attachment', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    open();
    const dialog = await openDialog('Detach volume');
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('link', { name: TARGET.instanceId })).toBeVisible();
    expect(api.detachVolume).not.toHaveBeenCalled();
  });

  it('names DetachVolume on 501 and disables the visible action after dismissal', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    vi.mocked(api.detachVolume).mockRejectedValue(unimplemented('DetachVolume'));
    open();
    const dialog = await openDialog('Detach volume');
    fireEvent.click(dialog.getByRole('button', { name: 'Detach volume' }));
    expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
    expect(dialog.getByText(/501 Not Implemented for DetachVolume/)).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(button('Detach volume')).toBeDisabled();
  });
});

describe('delete volume', () => {
  it('requires the exact volume ID and sends nothing on cancel', async () => {
    open();
    const dialog = await openDialog('Delete volume');
    expect(dialog.getByText(/Type the volume ID to confirm/)).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Delete volume' });
    const input = dialog.getByRole('textbox');
    for (const value of ['', 'vol-4', 'vol-43']) {
      fireEvent.change(input, { target: { value } });
      expect(submit).toBeDisabled();
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    fireEvent.change(input, { target: { value: ID } });
    expect(submit).toBeEnabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.deleteVolume).not.toHaveBeenCalled();
  });

  it('hands over the success while a missing detail returns ahead of the refreshed list', async () => {
    const list = deferred<{ items: api.Volume[] }>();
    open();
    const dialog = await openDialog('Delete volume');
    vi.mocked(api.getVolume).mockResolvedValue(missing);
    vi.mocked(api.listVolumes).mockReturnValue(list.promise);
    confirmDelete(dialog);

    expect(await screen.findByRole('heading', { level: 1, name: 'Volumes' })).toBeVisible();
    await waitFor(() => {
      expect(api.getVolume).toHaveReturnedTimes(2);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const acknowledgment = `Volume ${ID} deleted.`;
    expect(screen.getByText(acknowledgment, { exact: true })).toBeVisible();
    expect(screen.getByText('Loading volumes')).toBeVisible();
    list.resolve({ items: [] });
    expect(await screen.findByText('List refreshed')).toBeVisible();
    expect(screen.getByText(acknowledgment, { exact: true })).toBeVisible();
    expect(api.deleteVolume).toHaveBeenCalledWith(ENDPOINT, ID, expect.any(AbortSignal));
  });

  it('shows VolumeInUse and keeps the typed confirmation usable', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    vi.mocked(api.deleteVolume).mockRejectedValue(refuse('DeleteVolume', 'VolumeInUse', 'The volume is attached.'));
    open();
    const dialog = await openDialog('Delete volume');
    confirmDelete(dialog);
    expect(await dialog.findByText('VolumeInUse')).toBeVisible();
    expect(dialog.getByText(/The volume is attached\./)).toBeVisible();
    expect(dialog.getByRole('textbox')).toHaveValue(ID);
    expect(dialog.getByRole('button', { name: 'Delete volume' })).toBeEnabled();
  });

  it('closes confirmation on 501, disables the trigger for pointer and keyboard, and allows return', async () => {
    vi.mocked(api.deleteVolume).mockRejectedValue(unimplemented('DeleteVolume'));
    const router = open();
    const dialog = await openDialog('Delete volume');
    confirmDelete(dialog);
    expect(await screen.findAllByText('Not implemented by the emulator')).not.toHaveLength(0);
    expect(screen.getByText('The emulator answered 501 Not Implemented for DeleteVolume.')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    const trigger = button('Delete volume');
    expect(trigger).toBeDisabled();
    const user = userEvent.setup();
    await user.click(trigger);
    trigger.focus();
    await user.keyboard('{Enter} ');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.deleteVolume).toHaveBeenCalledTimes(1);

    fireEvent.click(button('Dismiss'));
    expect(screen.queryByText(/501 Not Implemented for DeleteVolume/)).toBeNull();
    await act(async () => {
      const crumbs = page.findBreadcrumbGroup();
      if (crumbs === null) throw new Error('Missing breadcrumbs');
      fireEvent.click(within(crumbs.getElement()).getByRole('link', { name: 'Volumes' }));
    });
    expect(router.state.location.pathname).toBe(PATH);
  });
});
