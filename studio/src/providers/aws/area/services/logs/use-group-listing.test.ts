import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { TokenPage } from '../../components/use-token-listing';
import { listLogGroups } from './api';
import { useGroupListing } from './use-group-listing';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listLogGroups: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8306';
const groups = (name: string) => [{ logGroupName: name }];
const read = vi.mocked(listLogGroups);

beforeEach(() => read.mockReset());

function renderListing() {
  const client = new QueryClient();
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client, children });
  }
  return renderHook(({ pattern }) => useGroupListing(endpoint, pattern), {
    initialProps: { pattern: 'initial' },
    wrapper,
  });
}

async function goToSecond() {
  const second = deferred<TokenPage<LogGroup>>();
  read.mockResolvedValueOnce({ items: groups('first'), next: 'second' }).mockReturnValueOnce(second.promise);
  const listing = renderListing();
  await waitFor(() => expect(listing.result.current.items).toEqual(groups('first')));
  act(() => listing.result.current.goToPage(2));
  await waitFor(() => expect(read).toHaveBeenLastCalledWith(endpoint, 'initial', 'second', expect.any(AbortSignal)));
  return { ...listing, second };
}

it('keeps the previous groups and page number while the next page is loading', async () => {
  const { result, second } = await goToSecond();
  expect(result.current).toMatchObject({ items: groups('first'), currentPage: 1, loading: true });
  await act(async () => second.resolve({ items: groups('second') }));
  await waitFor(() =>
    expect(result.current).toMatchObject({ items: groups('second'), currentPage: 2, loading: false, endedHere: false }),
  );
});

it('keeps and caps the previous page while rereading it and once it answers with the same token', async () => {
  const previous = deferred<TokenPage<LogGroup>>();
  const { result, second } = await goToSecond();
  read.mockReturnValueOnce(previous.promise);
  await act(async () => second.resolve({ items: [] }));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(read).toHaveBeenLastCalledWith(endpoint, 'initial', undefined, expect.any(AbortSignal));
  const ended = { currentPage: 1, pagesCount: 1, endedHere: true, openEnd: false };
  expect(result.current).toMatchObject({ ...ended, items: groups('first'), loading: true });
  await act(async () => previous.resolve({ items: groups('first again'), next: 'second' }));
  await waitFor(() => expect(result.current).toMatchObject({ ...ended, items: groups('first again'), loading: false }));
});

it('starts a new filter at page one with its own open end', async () => {
  const { rerender, result, second } = await goToSecond();
  read.mockResolvedValueOnce({ items: groups('first'), next: 'second' });
  await act(async () => second.resolve({ items: [] }));
  await waitFor(() => expect(result.current).toMatchObject({ endedHere: true, loading: false }));
  read.mockResolvedValueOnce({ items: groups('another'), next: 'another-second' });
  rerender({ pattern: 'another' });
  expect(result.current.endedHere).toBe(false);
  await waitFor(() =>
    expect(result.current).toMatchObject({
      items: groups('another'),
      currentPage: 1,
      openEnd: true,
      endedHere: false,
    }),
  );
});
