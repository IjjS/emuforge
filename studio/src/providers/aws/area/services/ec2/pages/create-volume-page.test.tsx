import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { listAvailabilityZones } from '../../../lib/ec2-availability-zones';
import { createVolume, getVolume, listVolumes } from '../volume-api';
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
}));

const endpoint = 'http://127.0.0.1:8311';
const list = '/aws/ec2/volumes';
const id = 'vol-created';
const zones = ['us-east-1b', 'us-east-1a'];
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

function field(name: 'zone' | 'size') {
  const index = name === 'zone' ? 0 : 1;
  const label = name === 'zone' ? 'Availability Zone' : 'Size (GiB)';
  const wrapper = page.findForm()?.findContent()?.findAllFormFields()[index];
  if (wrapper === undefined) throw new Error(`Missing ${label} field`);
  expect(wrapper.findLabel()?.getElement()).toHaveTextContent(label);
  return wrapper;
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
  return page.findAllBoxes().find((box) => box.findStatusIndicator() !== null && box.findButton() !== null);
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
  vi.mocked(listAvailabilityZones).mockResolvedValue(zones);
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
      expect(field('size').findError()?.getElement()).toHaveTextContent('Enter a whole number from 1 to 16384.');
      expect(createVolume).not.toHaveBeenCalled();
    }
  });

  it.each([1, 16384])('accepts the allowed boundary of %s GiB', async (size) => {
    open();
    await chooseZone();
    fillSize(String(size));
    submit();
    await waitFor(expectVolumeHeading);
    expect(createVolume).toHaveBeenCalledExactlyOnceWith(endpoint, { zone: zones[0], size }, expect.any(AbortSignal));
  });

  it('retries a failed zone read and offers the returned choices in order', async () => {
    vi.mocked(listAvailabilityZones).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation: 'DescribeAvailabilityZones', code: 'InternalError' }),
    );
    open();
    await waitFor(() => expect(zoneReadFailure()?.getElement()).toHaveTextContent('InternalError'));
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
