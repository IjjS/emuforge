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

function pageHeader() {
  return page.findContentLayout()?.findHeader()?.findHeader();
}

function detailContainer() {
  return page.findContentLayout()?.findContent().findContainer();
}

function detailHeading() {
  return detailContainer()?.findHeader()?.findHeader()?.findHeadingText().getElement();
}

function detailStatus() {
  return detailContainer()?.findContent().findStatusIndicator()?.getElement();
}

function detailMessage() {
  return detailContainer()?.findContent().findBox()?.findBox()?.getElement();
}

function expectAvailable() {
  const state = detailContainer()?.findContent().findKeyValuePairs()?.findItems()[4];
  const value = state?.findValue()?.getElement();
  expect(state?.findLabel()?.getElement()).toHaveTextContent('State');
  expect(value).toBeVisible();
  expect(value?.textContent).toBe('available');
}

function button(name: 'Attach volume' | 'Delete volume') {
  const index = name === 'Attach volume' ? 1 : 2;
  const control = pageHeader()?.findActions()?.findAllButtons()[index]?.getElement();
  if (control === undefined) throw new Error(`Missing ${name} action`);
  expect(control).toHaveAccessibleName(name);
  return control;
}

function attachmentCell(column: number) {
  return page.findTable()?.findBodyCell(1, column)?.getElement();
}

function attachmentLink() {
  const cell = attachmentCell(1);
  return cell === undefined ? undefined : createWrapper(cell).findLink()?.getElement();
}

function detachButton() {
  const control = page.findTable()?.findBodyCell(1, 1)?.findButton()?.getElement();
  if (control === undefined) throw new Error('Missing attachment action');
  expect(control).toHaveAccessibleName('Detach volume');
  return control;
}

async function openDialog(name: 'Attach volume' | 'Detach volume' | 'Delete volume') {
  const trigger = await waitFor(() => (name === 'Detach volume' ? detachButton() : button(name)));
  fireEvent.click(trigger);
  const modal = await waitFor(() => {
    const wrapper = page.findModal();
    if (wrapper === null || !wrapper.isVisible()) throw new Error('Missing open volume dialog');
    return wrapper;
  });
  const content = modal.findContent();
  return {
    content,
    input: () => {
      const input = content.findInput()?.findNativeInput().getElement();
      if (input === undefined) throw new Error('Missing volume dialog input');
      return input;
    },
    button: (label: typeof name | 'Cancel') => {
      const control = modal.findFooter()?.findAllButtons()[label === 'Cancel' ? 0 : 1]?.getElement();
      if (control === undefined) throw new Error('Missing volume dialog action');
      expect(control).toHaveAccessibleName(label);
      return control;
    },
  };
}

async function expectDialogAlert(dialog: Awaited<ReturnType<typeof openDialog>>, message: string, header?: string) {
  await waitFor(() => {
    const alert = dialog.content.findAlert();
    const body = alert?.findContent().getElement();
    expect(body).toBeVisible();
    expect(body).toHaveTextContent(message);
    if (header !== undefined) {
      const title = alert?.findHeader()?.getElement();
      expect(title).toBeVisible();
      expect(title).toHaveTextContent(header);
    }
  });
}

function instanceSelect() {
  const select = page.findModal()?.findContent().findSelect();
  if (select == null) throw new Error('Missing instance selector in the attach dialog');
  return select;
}

function flashItem(type: 'success' | 'info') {
  return page.findFlashbar()?.findItemsByType(type)[0];
}

function expectAcknowledgment(text: string) {
  const content = flashItem('success')?.findContent()?.getElement();
  expect(content).toBeVisible();
  expect(content?.textContent).toBe(text);
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
  const device = dialog.input();
  expect(device).toHaveAccessibleName('Device name');
  fireEvent.change(device, { target: { value: TARGET.device } });
  return dialog;
}

function confirmDelete(dialog: Awaited<ReturnType<typeof openDialog>>) {
  fireEvent.change(dialog.input(), { target: { value: ID } });
  fireEvent.click(dialog.button('Delete volume'));
}

describe('volume detail', () => {
  it('shows the ID, returned volume values and linked attachment', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    open();
    const heading = pageHeader()?.findHeadingText().getElement();
    expect(heading).toBeVisible();
    expect(heading?.textContent).toBe(ID);
    expect(heading?.closest('h1')).toBeVisible();
    await waitFor(() => {
      expect(detailHeading()).toBeVisible();
      expect(detailHeading()?.textContent).toBe('Volume details');
    });
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
    const device = attachmentCell(2);
    const state = attachmentCell(3);
    expect(device).toBeVisible();
    expect(device?.textContent).toBe(TARGET.device);
    expect(state).toBeVisible();
    expect(state?.textContent).toBe('attached');
    const link = attachmentLink();
    expect(link).toBeVisible();
    expect(link).toHaveAccessibleName(TARGET.instanceId);
    expect(link).toHaveAttribute('href', `/aws/ec2/instances/instance/${TARGET.instanceId}`);
  });

  it('links back to volumes for a missing ID', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(missing);
    open();
    await waitFor(() => {
      expect(detailMessage()).toBeVisible();
      expect(detailMessage()?.textContent).toBe('Volume not found');
    });
    const link = detailContainer()?.findContent().findLink()?.getElement();
    expect(link).toHaveAccessibleName('View volumes');
    expect(link).toHaveAttribute('href', PATH);
  });

  it('replaces a failed read with details on Retry', async () => {
    vi.mocked(api.getVolume).mockRejectedValueOnce(refuse('DescribeVolumes', 'InvalidParameterValue', 'Cannot read.'));
    open();
    await waitFor(() => {
      expect(detailMessage()).toBeVisible();
      expect(detailMessage()).toHaveTextContent('InvalidParameterValue');
    });
    const retry = detailContainer()?.findContent().findButton()?.getElement();
    if (retry === undefined) throw new Error('Missing detail retry action');
    expect(retry).toHaveAccessibleName('Retry');
    fireEvent.click(retry);
    await waitFor(() => {
      expect(detailHeading()).toBeVisible();
      expect(detailHeading()?.textContent).toBe('Volume details');
    });
    expect(detailContainer()?.findContent().getElement()).not.toHaveTextContent('InvalidParameterValue');
  });

  it('shows a detail 501 as unimplemented', async () => {
    vi.mocked(api.getVolume).mockRejectedValue(unimplemented('DescribeVolumes'));
    open();
    await waitFor(() => {
      expect(detailStatus()).toBeVisible();
      expect(detailStatus()).toHaveTextContent('Not implemented by the emulator');
      expect(detailMessage()).toBeVisible();
      expect(detailMessage()).toHaveTextContent('501 Not Implemented for DescribeVolumes');
    });
  });
});

describe('attach volume', () => {
  it('pages through instance choices with IDs, zones and states and requires a choice and device', async () => {
    vi.mocked(instances.listInstances)
      .mockResolvedValueOnce({ instances: [instance('i-first', 'us-east-1a', 'running')], nextToken: 'second' })
      .mockResolvedValueOnce({ instances: [instance('i-second', 'us-east-1b', 'stopped')] });
    open();
    const dialog = await openDialog('Attach volume');
    const submit = dialog.button('Attach volume');
    const device = dialog.input();
    expect(device).toHaveAccessibleName('Device name');
    expect(submit).toBeDisabled();
    fireEvent.change(device, { target: { value: TARGET.device } });
    expect(submit).toBeDisabled();

    const dropdown = openChoices();
    const zone = dialog.content.findFormField()?.findDescription()?.getElement();
    expect(zone).toBeVisible();
    expect(zone).toHaveTextContent('Choose an instance in us-east-1a, the volume’s Availability Zone.');
    await waitFor(() => {
      expect(dropdown.findOptionByValue('i-first')?.getElement()).toHaveTextContent(/i-first.*us-east-1a.*running/);
    });
    const more = instanceSelect().findDropdownFooter()?.findButton()?.getElement();
    if (more === undefined) throw new Error('Missing instance chooser load-more action');
    expect(more).toHaveAccessibleName('Load more');
    fireEvent.click(more);
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
    const submit = dialog.button('Attach volume');
    fireEvent.click(submit);
    await expectDialogAlert(dialog, 'IncorrectInstanceState: The instance is terminated.');
    expect(dialog.input()).toHaveValue(TARGET.device);
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

    fireEvent.click(dialog.button('Attach volume'));
    const acknowledgment = `Attachment requested for ${ID}.`;
    await waitFor(() => expectAcknowledgment(acknowledgment));
    await waitFor(() => {
      expect(api.getVolume).toHaveBeenCalledTimes(2);
    });
    expectAvailable();
    expect(screen.getByText('Refreshing lists')).toBeVisible();
    await waitFor(
      () => {
        expect(attachmentLink()).toBeVisible();
        expect(attachmentLink()).toHaveAccessibleName(TARGET.instanceId);
      },
      { timeout: 4500 },
    );
    expectAcknowledgment(acknowledgment);
    list.resolve({ items: [] });
    instanceList.resolve({ instances: [] });
    expect(await screen.findByText('Lists current')).toBeVisible();
    expectAcknowledgment(acknowledgment);
  }, 7000);

  it('retries a failed instance choice read and offers fresh results', async () => {
    vi.mocked(instances.listInstances).mockRejectedValueOnce(
      refuse('DescribeInstances', 'InvalidParameterValue', 'Could not list instances.'),
    );
    open();
    await openDialog('Attach volume');
    const dropdown = openChoices();
    const retry = await waitFor(() => {
      const element = instanceSelect().findErrorRecoveryButton()?.getElement();
      expect(element).toHaveAccessibleName('Retry');
      if (element === undefined) throw new Error('Missing instance chooser retry button');
      return element;
    });
    fireEvent.click(retry);
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
    const submit = dialog.button('Attach volume');
    fireEvent.click(submit);
    await expectDialogAlert(dialog, '501 Not Implemented for AttachVolume', 'Not implemented by the emulator');
    expect(submit).toBeDisabled();
    fireEvent.click(dialog.button('Cancel'));
    await waitFor(() => {
      expect(page.findModal()).toBeNull();
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
    const pairs = dialog.content.findKeyValuePairs()?.findItems();
    expect(pairs?.map((pair) => pair.findLabel()?.getElement().textContent)).toEqual([
      'Volume ID',
      'Instance ID',
      'Device',
    ]);
    for (const [index, value] of [ID, TARGET.instanceId, TARGET.device].entries()) {
      const shown = pairs?.[index]?.findValue()?.getElement();
      expect(shown).toBeVisible();
      expect(shown?.textContent).toBe(value);
    }
    vi.mocked(api.getVolume).mockReturnValue(detail.promise);
    fireEvent.click(dialog.button('Detach volume'));
    const acknowledgment = `Detachment requested for ${ID}.`;
    await waitFor(() => expectAcknowledgment(acknowledgment));
    await waitFor(() => {
      expect(api.listVolumes).toHaveBeenCalledTimes(2);
      expect(api.getVolume).toHaveBeenCalledTimes(2);
      expect(instances.listInstances).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('Lists current')).toBeVisible();
    expect(attachmentCell(3)).toBeVisible();
    expect(attachmentCell(3)?.textContent).toBe('attached');
    expect(api.detachVolume).toHaveBeenCalledWith(ENDPOINT, ID, TARGET, expect.any(AbortSignal));
    detail.resolve(available);
    await waitFor(() => {
      const empty = page.findTable()?.findEmptySlot()?.getElement();
      expect(empty).toBeVisible();
      expect(empty).toHaveTextContent('No attachments');
    });
    expectAvailable();
    expectAcknowledgment(acknowledgment);
  });

  it('displays IncorrectState for a refusal after an external detach', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    vi.mocked(api.detachVolume).mockRejectedValue(
      refuse('DetachVolume', 'IncorrectState', 'The volume is already available.'),
    );
    open();
    const dialog = await openDialog('Detach volume');
    const submit = dialog.button('Detach volume');
    fireEvent.click(submit);
    await expectDialogAlert(dialog, 'IncorrectState: The volume is already available.');
    expect(submit).toBeEnabled();
    expect(flashItem('success')).toBeUndefined();
  });

  it('cancels without changing the attachment', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    open();
    const dialog = await openDialog('Detach volume');
    fireEvent.click(dialog.button('Cancel'));
    await waitFor(() => {
      expect(page.findModal()).toBeNull();
    });
    expect(attachmentLink()).toBeVisible();
    expect(attachmentLink()).toHaveAccessibleName(TARGET.instanceId);
    expect(api.detachVolume).not.toHaveBeenCalled();
  });

  it('names DetachVolume on 501 and disables the visible action after dismissal', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    vi.mocked(api.detachVolume).mockRejectedValue(unimplemented('DetachVolume'));
    open();
    const dialog = await openDialog('Detach volume');
    fireEvent.click(dialog.button('Detach volume'));
    await expectDialogAlert(dialog, '501 Not Implemented for DetachVolume', 'Not implemented by the emulator');
    fireEvent.click(dialog.button('Cancel'));
    await waitFor(() => {
      expect(page.findModal()).toBeNull();
    });
    expect(detachButton()).toBeDisabled();
  });
});

describe('delete volume', () => {
  it('requires the exact volume ID and sends nothing on cancel', async () => {
    open();
    const dialog = await openDialog('Delete volume');
    const warning = dialog.content.findBox()?.getElement();
    expect(warning).toBeVisible();
    expect(warning).toHaveTextContent('Type the volume ID to confirm.');
    const submit = dialog.button('Delete volume');
    const input = dialog.input();
    for (const value of ['', 'vol-4', 'vol-43']) {
      fireEvent.change(input, { target: { value } });
      expect(submit).toBeDisabled();
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    fireEvent.change(input, { target: { value: ID } });
    expect(submit).toBeEnabled();
    fireEvent.click(dialog.button('Cancel'));
    await waitFor(() => {
      expect(page.findModal()).toBeNull();
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
    expect(page.findModal()).toBeNull();
    const acknowledgment = `Volume ${ID} deleted.`;
    expectAcknowledgment(acknowledgment);
    expect(screen.getByText('Loading volumes')).toBeVisible();
    list.resolve({ items: [] });
    expect(await screen.findByText('List refreshed')).toBeVisible();
    expectAcknowledgment(acknowledgment);
    expect(api.deleteVolume).toHaveBeenCalledWith(ENDPOINT, ID, expect.any(AbortSignal));
  });

  it('shows VolumeInUse and keeps the typed confirmation usable', async () => {
    vi.mocked(api.getVolume).mockResolvedValue(attached);
    vi.mocked(api.deleteVolume).mockRejectedValue(refuse('DeleteVolume', 'VolumeInUse', 'The volume is attached.'));
    open();
    const dialog = await openDialog('Delete volume');
    confirmDelete(dialog);
    await waitFor(() => {
      const warning = dialog.content.findBox();
      const status = warning?.findStatusIndicator()?.getElement();
      expect(status).toBeVisible();
      if (warning === null || warning === undefined) throw new Error('Missing delete confirmation warning');
      const alert = within(warning.getElement()).getByRole('alert');
      expect(alert).toBeVisible();
      expect(alert).toHaveTextContent('VolumeInUse: The volume is attached.');
    });
    expect(dialog.input()).toHaveValue(ID);
    expect(dialog.button('Delete volume')).toBeEnabled();
  });

  it('closes confirmation on 501, disables the trigger for pointer and keyboard, and allows return', async () => {
    vi.mocked(api.deleteVolume).mockRejectedValue(unimplemented('DeleteVolume'));
    const router = open();
    const dialog = await openDialog('Delete volume');
    confirmDelete(dialog);
    await waitFor(() => {
      const info = flashItem('info');
      const header = info?.findHeader()?.getElement();
      const content = info?.findContent()?.getElement();
      expect(header).toBeVisible();
      expect(header).toHaveTextContent('Not implemented by the emulator');
      expect(content).toBeVisible();
      expect(content).toHaveTextContent('The emulator answered 501 Not Implemented for DeleteVolume.');
    });
    expect(page.findModal()).toBeNull();
    const trigger = button('Delete volume');
    expect(trigger).toBeDisabled();
    const user = userEvent.setup();
    await user.click(trigger);
    trigger.focus();
    await user.keyboard('{Enter} ');
    expect(page.findModal()).toBeNull();
    expect(api.deleteVolume).toHaveBeenCalledTimes(1);

    const dismiss = flashItem('info')?.findDismissButton()?.getElement();
    if (dismiss === undefined) throw new Error('Missing DeleteVolume flash dismissal');
    expect(dismiss).toHaveAccessibleName('Dismiss');
    fireEvent.click(dismiss);
    expect(flashItem('info')).toBeUndefined();
    await act(async () => {
      const volumes = page.findBreadcrumbGroup()?.findBreadcrumbLink(4)?.getElement();
      if (volumes === undefined) throw new Error('Missing Volumes breadcrumb');
      expect(volumes).toHaveAccessibleName('Volumes');
      fireEvent.click(volumes);
    });
    expect(router.state.location.pathname).toBe(PATH);
  });
});
