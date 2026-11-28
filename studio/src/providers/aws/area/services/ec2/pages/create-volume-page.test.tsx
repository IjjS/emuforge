import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { kmsKeyChoices } from '../../../components/kms-key-choices';
import AwsArea from '../../../index';
import { listAvailabilityZones } from '../../../lib/ec2-availability-zones';
import { createVolume, getVolume, listVolumeSnapshots, listVolumes } from '../volume-api';
import { VOLUME_KEYS } from '../volume-queries';

vi.mock('../../../lib/ec2-availability-zones', async (original) => ({
  ...(await original<typeof import('../../../lib/ec2-availability-zones')>()),
  listAvailabilityZones: vi.fn(),
}));

vi.mock('../volume-api', async (original) => ({
  ...(await original<typeof import('../volume-api')>()),
  createVolume: vi.fn(),
  getVolume: vi.fn(),
  listVolumes: vi.fn(),
  listVolumeSnapshots: vi.fn(),
}));

vi.mock('../../../components/kms-key-choices', () => ({ kmsKeyChoices: vi.fn() }));

const endpoint = 'http://127.0.0.1:8311';
const list = '/aws/ec2/volumes';
const id = 'vol-created';
const zones: [string, string] = ['us-east-1b', 'us-east-1a'];
const connection: AreaConnection = {
  engineOrigin: endpoint,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9311, endpoint: 'https://127.0.0.1:9311' } },
};
const page = createWrapper(document.body);

function ListingObserver() {
  const query = useQuery({
    queryKey: [...VOLUME_KEYS.list, 'observer'],
    queryFn: ({ signal }) => listVolumes(endpoint, undefined, signal),
  });
  return <span>{query.isFetching ? 'Refreshing the list' : 'List current'}</span>;
}

function Area({ observe }: { observe: boolean }) {
  const { pathname } = useLocation();
  const [visit, setVisit] = useState({ pathname, count: 0 });
  if (pathname !== visit.pathname) setVisit({ pathname, count: visit.count + 1 });
  return (
    <>
      {observe && <ListingObserver />}
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

function open(observe = false) {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area observe={observe} /> }], {
    initialEntries: [`${list}/create`],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function select() {
  const control = field('zone').findControl()?.findSelect();
  if (control == null) throw new Error('Missing Availability Zone selector');
  return control;
}

async function openZoneChoices(zone: string) {
  const field = select();
  act(() => field.openDropdown());
  const dropdown = field.findDropdown();
  await waitFor(() => expect(dropdown.findOptionByValue(zone)).not.toBeNull());
  return dropdown;
}

async function chooseZone(zone = zones[0]) {
  if (zone === undefined) throw new Error('Missing test zone');
  await openZoneChoices(zone);
  act(() => select().selectOptionByValue(zone));
}

function field(name: string) {
  const label = name === 'zone' ? 'Availability Zone' : name === 'size' ? 'Size (GiB)' : name;
  const wrapper = page
    .findForm()
    ?.findContent()
    ?.findAllFormFields()
    .find((candidate) => candidate.findLabel()?.getElement().textContent?.startsWith(label));
  if (wrapper === undefined) throw new Error(`Missing ${label} field`);
  expect(wrapper.findLabel()?.getElement()).toHaveTextContent(label);
  return wrapper;
}

function choice(name: string) {
  const select = field(name).findControl()?.findSelect();
  if (select == null) throw new Error(`Missing select for ${name}`);
  return select;
}

async function choose(name: string, value: string) {
  const select = choice(name);
  act(() => select.openDropdown());
  await waitFor(() => expect(select.findDropdown().findOptionByValue(value)).not.toBeNull());
  act(() => select.selectOptionByValue(value));
}

function enter(name: string, value: string) {
  const input = field(name).findControl()?.findInput();
  if (input == null) throw new Error(`Missing input for ${name}`);
  act(() => input.setInputValue(value));
}

function sizeInput() {
  const input = field('size').findControl()?.findInput();
  if (input == null) throw new Error('Missing size input');
  return input;
}

function formAction(name: 'Cancel' | 'Create volume') {
  const index = name === 'Cancel' ? 0 : 1;
  const action = page.findForm()?.findActions()?.findAllButtons()[index];
  if (action === undefined) throw new Error(`Missing ${name} form button`);
  expect(action.getElement()).toHaveAccessibleName(name);
  return action;
}

const fillSize = (value: string) => act(() => sizeInput().setInputValue(value));
const submit = () => act(() => formAction('Create volume').click());
const cancel = () => act(() => formAction('Cancel').click());

function creationAlert() {
  return page
    .findAllAlerts()
    .find((candidate) => candidate.getElement().closest('[aria-label="Local emulator notice"]') === null);
}

function zoneReadFailure() {
  return page
    .findAllBoxes()
    .map((box) => createWrapper(box.getElement()))
    .find((box) => box.findStatusIndicator() !== null && box.findButton() !== null);
}

function expectListHeading() {
  const heading = page.findTable()?.findHeaderSlot()?.findHeader()?.findHeadingText().getElement();
  expect(heading?.closest('h1')).toBeVisible();
  expect(heading).toHaveTextContent(/^Volumes$/);
}

async function answerDiscard(answer: 'Keep editing' | 'Discard') {
  await waitFor(() =>
    expect(page.findModal()?.findHeader().getElement()).toHaveTextContent('Discard what you entered?'),
  );
  const index = answer === 'Keep editing' ? 0 : 1;
  const button = page.findModal()?.findFooter()?.findAllButtons()[index];
  if (button === undefined) throw new Error(`Missing discard dialog action ${answer}`);
  expect(button.getElement()).toHaveAccessibleName(answer);
  act(() => button.click());
}

function deferred<T>() {
  let resolve!: (answer: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function expectCreatedVolume() {
  const result = page.findFlashbar()?.findItemsByType('success')[0]?.findContent()?.getElement();
  expect(result).toHaveTextContent(`Volume ${id} created.`);
  const details = page.findKeyValuePairs()?.findItems();
  expect(
    details?.map((item) => [item.findLabel()?.getElement().textContent, item.findValue()?.getElement().textContent]),
  ).toEqual([
    ['Volume ID', id],
    ['Size', '8 GiB'],
    ['Type', 'gp2'],
    ['Availability Zone', 'us-east-1b'],
    ['State', 'available'],
  ]);
}

function expectVolumeHeading() {
  const heading = page.findContentLayout()?.findHeader()?.findHeader()?.findHeadingText().getElement();
  expect(heading?.closest('h1')).toBeVisible();
  expect(heading?.textContent).toBe(id);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.mocked(listAvailabilityZones).mockImplementation(async (_endpoint, _signal, details) => {
    details?.([
      { name: 'us-east-1b', id: 'use1-az2' },
      { name: 'us-east-1a', id: 'use1-az1' },
    ]);
    return zones;
  });
  vi.mocked(listVolumeSnapshots).mockResolvedValue({
    items: [
      { id: 'snap-3', size: 3, state: 'completed', volumeId: 'vol-1', description: 'Base image' },
      { id: 'snap-large', size: 2000 },
    ],
  });
  vi.mocked(kmsKeyChoices).mockReturnValue({
    key: ['test-kms'],
    endpoint,
    operation: 'ListKeys',
    readAgainOnOpen: true,
    read: async () => ({ items: [{ id: 'key-1', arn: 'arn:key-1', aliases: ['alias/volume-key'] }] }),
    optionOf: (key) => ({ value: key.arn, label: key.aliases[0] ?? key.id }),
  });
  vi.mocked(createVolume).mockResolvedValue(id);
  vi.mocked(listVolumes).mockResolvedValue({ items: [] });
  vi.mocked(getVolume).mockResolvedValue({
    found: true,
    volume: { id, size: 8, zone: 'us-east-1b', type: 'gp2', state: 'available', attachments: [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('create volume', () => {
  it('opens on gp2; describes each type and zone and shows the type’s size range', async () => {
    open();
    const type = choice('Volume type');
    expect(type.findTrigger().getElement()).toHaveTextContent('gp2');
    expect(field('size').findConstraint()?.getElement()).toHaveTextContent('Enter a whole number from 1 to 16384.');
    act(() => type.openDropdown());
    const dropdown = type.findDropdown();
    const descriptions = [
      ['standard', '1 to 1024 GiB. IOPS and throughput cannot be set.'],
      ['gp2', '1 to 16384 GiB. IOPS and throughput cannot be set.'],
      ['gp3', '1 to 65536 GiB. 3000 IOPS and 125 MiB/s unless you set them.'],
      ['io1', '4 to 16384 GiB. IOPS must be set.'],
      ['io2', '4 to 65536 GiB. IOPS must be set.'],
      ['st1', '125 to 16384 GiB. IOPS and throughput cannot be set.'],
      ['sc1', '125 to 16384 GiB. IOPS and throughput cannot be set.'],
    ] as const;
    expect(dropdown.findOptions().length).toBe(descriptions.length);
    for (const [value, description] of descriptions) {
      const option = dropdown.findOptionByValue(value);
      expect(option?.findLabel().getElement().textContent).toBe(value);
      expect(option?.findDescription()?.getElement().textContent).toBe(description);
    }
    act(() => type.closeDropdown());
    const zone = await openZoneChoices('us-east-1b');
    expect(zone.findOptionByValue('us-east-1b')?.getElement()).toHaveTextContent('use1-az2');
  });

  it('changes the IOPS and throughput fields with the volume type and drops hidden entries', async () => {
    open();
    await choose('Volume type', 'io1');
    expect(field('IOPS').findLabel()?.getElement()).toHaveTextContent(/^IOPS$/);
    expect(field('IOPS').findConstraint()?.getElement()).toHaveTextContent('100 to 64000');
    await choose('Volume type', 'gp3');
    expect(field('IOPS').findLabel()?.getElement()).toHaveTextContent('IOPS - optional');
    expect(field('Throughput (MiB/s)').findLabel()?.getElement()).toHaveTextContent('Throughput (MiB/s) - optional');
    enter('IOPS', '4000');
    enter('Throughput (MiB/s)', '250');
    await choose('Volume type', 'sc1');
    expect(screen.queryByText(/^IOPS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Throughput/)).not.toBeInTheDocument();
    await choose('Volume type', 'gp3');
    expect(field('IOPS').findControl()?.findInput()?.getInputValue()).toBe('');
    expect(field('Throughput (MiB/s)').findControl()?.findInput()?.getInputValue()).toBe('');
  });

  it('describes the empty and inherited snapshot choices and shows why a small snapshot needs a size', async () => {
    open();
    const snapshot = choice('Snapshot');
    expect(field('Snapshot').findLabel()?.getElement()).toHaveTextContent('Snapshot - optional');
    expect(snapshot.findTrigger().getElement()).toHaveTextContent('No snapshot');
    expect(snapshot.findTrigger().getElement()).toHaveTextContent('The volume starts empty.');
    await choose('Snapshot', 'snap-3');
    expect(field('size').findConstraint()?.getElement()).toHaveTextContent("Leave empty to use the snapshot's 3 GiB.");
    await choose('Volume type', 'sc1');
    expect(field('size').findConstraint()?.getElement()).toHaveTextContent(
      "The snapshot's 3 GiB is under sc1's minimum: enter a size.",
    );
  });

  it('explains encryption and preselects the described default key option', () => {
    open();
    const encryption = screen.getByRole('checkbox', { name: 'Encrypt the volume' });
    expect(encryption).toHaveAccessibleDescription('The emulator reports the volume as encrypted.');
    fireEvent.click(encryption);
    const key = within(choice('KMS key').findTrigger().getElement());
    expect(key.getByText('Chosen by the emulator')).toBeVisible();
    expect(key.getByText('No key is sent. The emulator reports the volume as encrypted, with no key.')).toBeVisible();
  });

  it('blocks a snapshot larger than the selected type and accepts it after a compatible type is chosen', async () => {
    open();
    await chooseZone();
    await choose('Volume type', 'standard');
    await choose('Snapshot', 'snap-large');
    expect(field('Volume type').findError()?.getElement()).toHaveTextContent(
      "The snapshot's 2000 GiB is over standard's maximum: choose another volume type.",
    );
    submit();
    expect(createVolume).not.toHaveBeenCalled();
    await choose('Volume type', 'gp2');
    expect(field('Volume type').findError()).toBeNull();
    submit();
    await waitFor(expectVolumeHeading);
    expect(createVolume).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      { zone: zones[0], type: 'gp2', snapshotId: 'snap-large' },
      expect.any(AbortSignal),
    );
  });

  it('shows the snapshot read’s 501 in the field', async () => {
    vi.mocked(listVolumeSnapshots).mockRejectedValueOnce(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeSnapshots' }),
    );
    open();
    act(() => choice('Snapshot').openDropdown());
    expect(await screen.findByText(/501 Not Implemented for DescribeSnapshots/)).toBeVisible();
  });

  it('submits all chosen settings once and keeps them after refusal', async () => {
    vi.mocked(createVolume).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation: 'CreateVolume', code: 'InvalidSnapshot.NotFound' }),
    );
    open();
    await chooseZone();
    await choose('Volume type', 'gp3');
    await choose('Snapshot', 'snap-3');
    enter('size', '8');
    enter('IOPS', '4000');
    enter('Throughput (MiB/s)', '250');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Encrypt the volume' }));
    await choose('KMS key', 'arn:key-1');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    enter('Key', 'team');
    enter('Value - optional', 'core');
    submit();
    expect(await screen.findByText(/InvalidSnapshot.NotFound/)).toBeVisible();
    expect(createVolume).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      {
        zone: zones[0],
        type: 'gp3',
        snapshotId: 'snap-3',
        size: 8,
        iops: 4000,
        throughput: 250,
        encrypted: true,
        kmsKeyId: 'arn:key-1',
        tags: [{ key: 'team', value: 'core' }],
      },
      expect.any(AbortSignal),
    );
    for (const [name, selected] of [
      ['zone', zones[0]],
      ['Volume type', 'gp3'],
      ['Snapshot', 'snap-3'],
      ['KMS key', 'alias/volume-key'],
    ] as const) {
      expect(choice(name).findTrigger().getElement()).toHaveTextContent(selected);
    }
    for (const [name, value] of [
      ['size', '8'],
      ['IOPS', '4000'],
      ['Throughput (MiB/s)', '250'],
      ['Key', 'team'],
      ['Value - optional', 'core'],
    ] as const) {
      expect(field(name).findControl()?.findInput()?.getInputValue()).toBe(value);
    }
    expect(screen.getByRole('checkbox', { name: 'Encrypt the volume' })).toBeChecked();
  });

  it('requires a zone after choices load even when the size is valid', async () => {
    open();
    select().findTrigger().getElement().focus();
    await openZoneChoices('us-east-1b');
    act(() => select().closeDropdown());
    expect(select().findTrigger().getElement()).toHaveAttribute('aria-expanded', 'false');
    expect(select().findPlaceholder()?.getElement()).toHaveTextContent('Choose an Availability Zone');

    fillSize('8');
    submit();
    expect(field('zone').findError()?.getElement()).toHaveTextContent('Choose an Availability Zone.');
    expect(field('size').findError()).toBeNull();
    expect(createVolume).not.toHaveBeenCalled();
  });

  it('requires a whole size between 1 and 16384 GiB when a zone is selected', async () => {
    open();
    await chooseZone();
    for (const size of ['', '1.5', '0', '16385']) {
      fillSize(size);
      submit();
      expect(field('size').findError()?.getElement()).toHaveTextContent(
        size === '' ? 'Enter a size.' : 'Enter a whole number from 1 to 16384 for gp2.',
      );
      expect(createVolume).not.toHaveBeenCalled();
    }
  });

  it.each([1, 16384])('accepts the allowed boundary of %s GiB', async (size) => {
    open();
    await chooseZone();
    fillSize(String(size));
    submit();
    await waitFor(expectVolumeHeading);
    expect(createVolume).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      { zone: zones[0], size, type: 'gp2' },
      expect.any(AbortSignal),
    );
  });

  it('shows a 501 at Availability Zone and leaves the required zone unavailable', async () => {
    vi.mocked(listAvailabilityZones).mockRejectedValueOnce(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeAvailabilityZones' }),
    );
    open();
    await screen.findByText('Not implemented by the emulator');
    const zone = field('zone');
    expect(zone.findConstraint()?.getElement().textContent).toContain('Not implemented by the emulator');
    expect(zone.findConstraint()?.getElement().textContent).toContain(
      'The emulator answered 501 Not Implemented for DescribeAvailabilityZones',
    );
    expect(select().isDisabled()).toBe(true);
    expect(formAction('Create volume').getElement().hasAttribute('disabled')).toBe(true);
    expect(screen.queryAllByRole('button', { name: 'Retry' }).length).toBe(0);
  });

  it('retries a failed zone read and offers the returned choices in order', async () => {
    vi.mocked(listAvailabilityZones).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation: 'DescribeAvailabilityZones', code: 'InternalError' }),
    );
    open();
    await waitFor(() => expect(zoneReadFailure()?.getElement()).toHaveTextContent('InternalError'));
    expect(zoneReadFailure()?.getElement()).toHaveTextContent('The Availability Zones could not be read');
    const retry = zoneReadFailure()?.findButton();
    if (retry == null) throw new Error('Missing availability zone retry action');
    expect(retry.getElement()).toHaveAccessibleName('Retry');
    act(() => retry.click());

    const dropdown = await openZoneChoices('us-east-1b');
    expect(dropdown.findOptions().map((option) => option.findLabel().getElement().textContent)).toEqual(zones);
    act(() => select().selectOptionByValue('us-east-1a'));
    expect(zoneReadFailure()).toBeUndefined();
    expect(select().findTrigger().getElement()).toHaveTextContent('us-east-1a');
  });

  it('shows the emulator refusal and preserves the form values', async () => {
    vi.mocked(createVolume).mockRejectedValueOnce(
      new RequestError({
        kind: 'other',
        operation: 'CreateVolume',
        code: 'InvalidParameterValue',
        message: 'The requested zone is invalid.',
      }),
    );
    open();
    await chooseZone();
    fillSize('8');
    submit();

    await waitFor(() =>
      expect(creationAlert()?.findHeader()?.getElement()).toHaveTextContent('Creating volume failed'),
    );
    const refusal = creationAlert()?.findContent().getElement();
    expect(refusal).toHaveTextContent('InvalidParameterValue');
    expect(refusal).toHaveTextContent('The requested zone is invalid.');
    expect(select().findTrigger().getElement()).toHaveTextContent('us-east-1b');
    expect(sizeInput().getInputValue()).toBe('8');
    expect(formAction('Create volume').getElement()).toBeEnabled();
  });

  it('keeps success and the volume details visible after the slower list refresh completes', async () => {
    const router = open(true);
    await screen.findByText('List current');
    const refresh = deferred<Awaited<ReturnType<typeof listVolumes>>>();
    vi.mocked(listVolumes).mockReturnValueOnce(refresh.promise);
    await chooseZone();
    fillSize('8');
    submit();

    await waitFor(expectVolumeHeading);
    expect(router.state.location.pathname).toBe(`${list}/volume/${id}`);
    expect(screen.getByText('Refreshing the list')).toBeInTheDocument();
    await waitFor(expectCreatedVolume);
    expect(getVolume).toHaveBeenCalledWith(endpoint, id, expect.any(AbortSignal));

    refresh.resolve({ items: [{ id, size: 8, attachments: [] }] });
    await screen.findByText('List current');
    expectCreatedVolume();
  });

  it('prevents cancellation while CreateVolume is awaiting a reply', async () => {
    const submission = deferred<string>();
    vi.mocked(createVolume).mockReturnValueOnce(submission.promise);
    const router = open();
    await chooseZone();
    fillSize('8');
    submit();

    expect(createVolume).toHaveBeenCalledTimes(1);
    expect(formAction('Cancel').getElement()).toBeDisabled();
    cancel();
    expect(page.findModal()).toBeNull();
    expect(router.state.location.pathname).toBe(`${list}/create`);

    submission.resolve(id);
    await waitFor(expectCreatedVolume);
    expect(router.state.location.pathname).toBe(`${list}/volume/${id}`);
  });

  it('returns to the list on clean cancel without submitting', async () => {
    const router = open();
    cancel();
    await waitFor(expectListHeading);
    expect(router.state.location.pathname).toBe(list);
    expect(createVolume).not.toHaveBeenCalled();
  });

  it('keeps both edits or discards them after confirmation', async () => {
    const router = open();
    await chooseZone();
    fillSize('8');
    cancel();
    await answerDiscard('Keep editing');
    await waitFor(() => expect(page.findModal()).toBeNull());
    expect(select().findTrigger().getElement()).toHaveTextContent('us-east-1b');
    expect(sizeInput().getInputValue()).toBe('8');
    expect(formAction('Cancel').getElement()).toHaveFocus();
    cancel();
    await answerDiscard('Discard');
    await waitFor(expectListHeading);
    expect(router.state.location.pathname).toBe(list);
    expect(createVolume).not.toHaveBeenCalled();
  });

  it('keeps CreateVolume unavailable after a 501 and allows cancellation', async () => {
    vi.mocked(createVolume).mockRejectedValueOnce(
      new RequestError({ kind: 'not-implemented', operation: 'CreateVolume' }),
    );
    open();
    await chooseZone();
    fillSize('8');
    submit();
    await waitFor(() =>
      expect(creationAlert()?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
    );
    expect(creationAlert()?.findContent().getElement()).toHaveTextContent('501 Not Implemented for CreateVolume');
    expect(formAction('Create volume').getElement()).toBeDisabled();
    cancel();
    await answerDiscard('Discard');
    await waitFor(expectListHeading);
    expect(createVolume).toHaveBeenCalledTimes(1);
  });
});
