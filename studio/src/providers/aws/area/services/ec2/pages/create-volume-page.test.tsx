import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  const field = createWrapper(document.body).findSelect();
  if (field == null) throw new Error('Missing Availability Zone selector');
  return field;
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

const sizeField = () => screen.getByRole('textbox', { name: 'Size (GiB)' });
const fillSize = (value: string) => fireEvent.change(sizeField(), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create volume' }));
const cancel = () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

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
  it('requires a zone and a whole size between 1 and 16384 GiB', async () => {
    open();
    submit();
    expect(screen.getByText('Choose an Availability Zone.', { exact: true })).toBeInTheDocument();
    expect(sizeField()).toHaveAttribute('aria-invalid', 'true');
    await chooseZone();
    for (const size of ['', '1.5', '0', '16385']) {
      fillSize(size);
      submit();
      expect(sizeField()).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getAllByText('Enter a whole number from 1 to 16384.')).toHaveLength(2);
      expect(createVolume).not.toHaveBeenCalled();
    }
  });

  it.each([1, 16384])('accepts the allowed boundary of %s GiB', async (size) => {
    open();
    await chooseZone();
    fillSize(String(size));
    submit();
    expect(await screen.findByRole('heading', { level: 1, name: id })).toBeInTheDocument();
    expect(createVolume).toHaveBeenCalledExactlyOnceWith(endpoint, { zone: zones[0], size }, expect.any(AbortSignal));
  });

  it('retries a failed zone read and offers the returned choices in order', async () => {
    vi.mocked(listAvailabilityZones).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation: 'DescribeAvailabilityZones', code: 'InternalError' }),
    );
    open();
    await screen.findByText(/InternalError/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    const dropdown = await openZoneChoices('us-east-1b');
    expect(dropdown.findOptions().map((option) => option.findLabel().getElement().textContent)).toEqual(zones);
    act(() => select().selectOptionByValue('us-east-1a'));
    expect(screen.queryByText(/InternalError/)).toBeNull();
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

    expect(await screen.findByText('InvalidParameterValue')).toBeInTheDocument();
    expect(screen.getByText(/The requested zone is invalid/)).toBeInTheDocument();
    expect(select().findTrigger().getElement()).toHaveTextContent('us-east-1b');
    expect(sizeField()).toHaveValue('8');
    expect(screen.getByRole('button', { name: 'Create volume' })).toBeEnabled();
  });

  it('hands success to the returned detail page while the list is still refreshing', async () => {
    const router = open(true);
    await screen.findByText('List current');
    vi.mocked(listVolumes).mockImplementationOnce(
      (_endpoint, _token, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        ),
    );
    await chooseZone();
    fillSize('8');
    submit();

    expect(await screen.findByRole('heading', { level: 1, name: id })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${list}/volume/${id}`);
    expect(screen.getByText(`Volume ${id} created.`)).toBeInTheDocument();
    expect(screen.getByText('Refreshing the list')).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Volume details' });
    const details = createWrapper(document.body).findKeyValuePairs()?.findItems();
    const size = details?.find((item) => item.findLabel()?.getElement().textContent === 'Size');
    expect(size?.findValue()?.getElement()).toHaveTextContent('8 GiB');
    expect(getVolume).toHaveBeenCalledWith(endpoint, id, expect.any(AbortSignal));
  });

  it('returns to the list on clean cancel without submitting', async () => {
    const router = open();
    cancel();
    await screen.findByRole('heading', { level: 1, name: 'Volumes' });
    expect(router.state.location.pathname).toBe(list);
    expect(createVolume).not.toHaveBeenCalled();
  });

  it('keeps both edits or discards them after confirmation', async () => {
    const router = open();
    await chooseZone();
    fillSize('8');
    cancel();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Discard what you entered?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(select().findTrigger().getElement()).toHaveTextContent('us-east-1b');
    expect(sizeField()).toHaveValue('8');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    cancel();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await screen.findByRole('heading', { level: 1, name: 'Volumes' });
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
    expect(await screen.findByText('Not implemented by the emulator')).toBeInTheDocument();
    expect(screen.getByText(/501 Not Implemented for CreateVolume/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create volume' })).toBeDisabled();
    cancel();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await screen.findByRole('heading', { level: 1, name: 'Volumes' });
    expect(createVolume).toHaveBeenCalledTimes(1);
  });
});
