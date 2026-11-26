import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { listLogStreams } from '../stream-api';
import { GroupStreams } from './group-streams';

vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));

it('mounts the listing for the given group and reads it by name', async () => {
  const engineOrigin = 'http://127.0.0.1:8310';
  const group = '/app#Group';
  const read = vi.mocked(listLogStreams).mockResolvedValueOnce({ items: [{ logStreamName: 'first stream' }] });
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <GroupStreams group={group} connection={{ engineOrigin, result: undefined }} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('link', { name: 'first stream' })).toBeVisible();
  expect(read).toHaveBeenCalledWith(engineOrigin, group, '', undefined, expect.any(AbortSignal));
});
