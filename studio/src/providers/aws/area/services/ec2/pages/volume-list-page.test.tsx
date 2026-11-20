import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { listVolumes, type Volume } from '../volume-api';
import { VolumeListPage } from './volume-list-page';

vi.mock('../volume-api', async (original) => ({
  ...(await original<typeof import('../volume-api')>()),
  listVolumes: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8311';
const first: Volume = {
  id: 'vol-first',
  size: 8,
  type: 'gp2',
  zone: 'us-east-1a',
  state: 'available',
  attachments: [],
};
const second: Volume = { ...first, id: 'vol-second' };

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <VolumeListPage connection={{ engineOrigin: endpoint, result: undefined }} params={{}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function table() {
  const wrapper = createWrapper(document.body).findTable();
  if (wrapper === null) throw new Error('Missing volume table');
  return wrapper;
}

function header() {
  const actions = table().findHeaderSlot();
  if (actions === null) throw new Error('Missing volume table header');
  return within(actions.getElement());
}

function emptySlot() {
  return table().findEmptySlot()?.getElement();
}

function volumeLink() {
  const cell = table().findBodyCell(1, 1);
  return cell == null ? undefined : createWrapper(cell.getElement()).findLink()?.getElement();
}

async function expectVolume(id: string) {
  await waitFor(() => {
    expect(volumeLink()).toHaveTextContent(id);
    expect(volumeLink()).toHaveAttribute('href', `/aws/ec2/volumes/volume/${id}`);
  });
}

function pageButton(direction: 'next' | 'previous') {
  const pagination = table().findPagination();
  if (pagination === null) throw new Error('Missing volume pagination');
  return direction === 'next' ? pagination.findNextPageButton() : pagination.findPreviousPageButton();
}

function move(direction: 'next' | 'previous') {
  act(() => pageButton(direction).click());
}

function pages() {
  vi.mocked(listVolumes).mockImplementation((_endpoint, token) =>
    Promise.resolve(token === undefined ? { items: [first], next: 'next-token' } : { items: [second] }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('volume list', () => {
  it('shows loading, then an empty list with a create link', async () => {
    vi.mocked(listVolumes).mockResolvedValue({ items: [] });
    open();

    expect(table().findLoadingText()?.getElement()).toHaveTextContent('Loading volumes');
    await waitFor(() => expect(emptySlot()).toHaveTextContent('No volumes'));
    expect(header().getByRole('link', { name: 'Create volume' })).toHaveAttribute('href', '/aws/ec2/volumes/create');
  });

  it('uses the returned token, links the rows and goes back from the last page', async () => {
    pages();
    open();

    await expectVolume(first.id);
    expect(
      table()
        .findRows()
        .map((row) => row.findAll('th, td').map((cell) => cell.getElement().textContent)),
    ).toEqual([[first.id, 'available', '8 GiB', 'gp2', 'us-east-1a']]);

    move('next');
    await expectVolume(second.id);
    expect(table().findRows()).toHaveLength(1);
    expect(pageButton('next').getElement()).toHaveAttribute('aria-disabled', 'true');
    move('previous');
    await expectVolume(first.id);
    expect(vi.mocked(listVolumes).mock.calls.map(([, token]) => token)).toEqual([undefined, 'next-token', undefined]);
  });

  it('refreshes page one after an external change while viewing page two', async () => {
    pages();
    open();
    await expectVolume(first.id);
    move('next');
    await expectVolume(second.id);

    vi.mocked(listVolumes).mockResolvedValueOnce({ items: [{ ...first, id: 'vol-external' }] });
    act(() => header().getByRole('button', { name: 'Refresh' }).click());

    await expectVolume('vol-external');
    expect(table().findRows()).toHaveLength(1);
    expect(pageButton('previous').getElement()).toHaveAttribute('aria-disabled', 'true');
    expect(listVolumes).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
  });

  it('replaces a failed read with returned rows on Retry', async () => {
    vi.mocked(listVolumes)
      .mockRejectedValueOnce(new RequestError({ kind: 'other', operation: 'DescribeVolumes', code: 'InternalError' }))
      .mockResolvedValueOnce({ items: [first] });
    open();

    await waitFor(() => expect(emptySlot()).toHaveTextContent('InternalError'));
    const empty = emptySlot();
    if (empty === undefined) throw new Error('Missing volume read failure');
    act(() => within(empty).getByRole('button', { name: 'Retry' }).click());
    await expectVolume(first.id);
    expect(emptySlot()).toBeUndefined();
  });

  it('shows the area’s not-implemented state on a 501', async () => {
    vi.mocked(listVolumes).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeVolumes' }),
    );
    open();
    await waitFor(() => expect(emptySlot()).toHaveTextContent('Not implemented by the emulator'));
    expect(emptySlot()).toHaveTextContent('DescribeVolumes');
  });
});
