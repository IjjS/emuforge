import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

function move(direction: 'next' | 'previous') {
  const pagination = createWrapper(document.body).findPagination();
  const button = direction === 'next' ? pagination?.findNextPageButton() : pagination?.findPreviousPageButton();
  act(() => button?.click());
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

    expect(screen.getByText('Loading volumes')).toBeInTheDocument();
    expect(await screen.findByText('No volumes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create volume' })).toHaveAttribute('href', '/aws/ec2/volumes/create');
  });

  it('uses the returned token, links the rows and goes back from the last page', async () => {
    pages();
    open();

    const id = await screen.findByRole('link', { name: first.id });
    expect(id).toHaveAttribute('href', '/aws/ec2/volumes/volume/vol-first');
    const rows = createWrapper(document.body).findTable()?.findRows();
    expect(rows?.map((row) => row.findCells().map((cell) => cell.getElement().textContent))).toEqual([
      [first.id, '8 GiB', 'gp2', 'us-east-1a', 'available'],
    ]);

    move('next');
    expect(await screen.findByRole('link', { name: second.id })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: first.id })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveAttribute('aria-disabled', 'true');
    move('previous');
    expect(await screen.findByRole('link', { name: first.id })).toBeInTheDocument();
    expect(vi.mocked(listVolumes).mock.calls.map(([, token]) => token)).toEqual([undefined, 'next-token', undefined]);
  });

  it('refreshes page one after an external change while viewing page two', async () => {
    pages();
    open();
    await screen.findByRole('link', { name: first.id });
    move('next');
    await screen.findByRole('link', { name: second.id });

    vi.mocked(listVolumes).mockResolvedValueOnce({ items: [{ ...first, id: 'vol-external' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('link', { name: 'vol-external' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: second.id })).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveAttribute('aria-disabled', 'true');
    expect(listVolumes).toHaveBeenLastCalledWith(endpoint, undefined, expect.any(AbortSignal));
  });

  it('replaces a failed read with returned rows on Retry', async () => {
    vi.mocked(listVolumes)
      .mockRejectedValueOnce(new RequestError({ kind: 'other', operation: 'DescribeVolumes', code: 'InternalError' }))
      .mockResolvedValueOnce({ items: [first] });
    open();

    expect(await screen.findByText(/InternalError/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: first.id })).toBeInTheDocument();
    expect(screen.queryByText(/InternalError/)).toBeNull();
  });

  it('shows the area’s not-implemented state on a 501', async () => {
    vi.mocked(listVolumes).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DescribeVolumes' }),
    );
    open();
    expect(await screen.findByText('Not implemented by the emulator')).toBeInTheDocument();
    expect(screen.getByText(/DescribeVolumes/)).toBeInTheDocument();
  });
});
