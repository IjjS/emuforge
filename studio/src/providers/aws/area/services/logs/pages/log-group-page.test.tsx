import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { areaPage, areaPageTitle } from '../../../area-page';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageResourcesContext } from '../../../components/page-resources';
import { screenCrumbs } from '../../../screen-paths';
import { getLogGroup, listLogGroupTags } from '../api';
import { listLogStreams } from '../stream-api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getLogGroup: vi.fn(),
  listLogGroupTags: vi.fn(),
}));
vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));

const operation = 'DescribeLogGroups';
const emulator = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const engineOrigin = 'http://127.0.0.1:8310';
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator,
  reason,
  message: '',
});
const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, connected, `501 Not Implemented for ${operation}`],
  [
    'access denied',
    { kind: 'access-denied', operation, message: 'policy refusal' },
    connected,
    `${operation} was refused: policy refusal`,
  ],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9310',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    `Not answering at ${emulator.endpoint}`,
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: emulator.port },
    `The EmuForge engine at ${engineOrigin} is not answering`,
  ],
  [
    'other refusal',
    { kind: 'other', operation, code: 'InvalidParameterException', message: 'request refused' },
    connected,
    'InvalidParameterException: request refused',
  ],
];

const group = '/app#Group';
const path = '/aws/logs/log-groups/group/%2Fapp%23Group';
const read = vi.mocked(getLogGroup);
const tags = vi.mocked(listLogGroupTags);
const streams = vi.mocked(listLogStreams);
const found = { kind: 'found', group: { logGroupName: group, logGroupClass: 'STANDARD' } } as const;

beforeEach(() => {
  read.mockReset();
  tags.mockReset().mockResolvedValue({ team: 'web' });
  streams.mockReset().mockResolvedValue({ items: [{ logStreamName: 'some-stream' }] });
});

function renderPage(result: AreaConnection['result'] = connected) {
  const route = areaPage(path);
  if (route.kind !== 'screen') throw new Error('The log group screen is not registered.');
  const {
    screen: { Page },
    params,
  } = route;
  const resources = vi.fn();
  const rendered = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <main>
            <Page connection={{ engineOrigin, result }} params={params} />
          </main>
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...rendered, resources, route };
}

it('opens the address by group name, uses it for the title and crumb, and shows the details and streams', async () => {
  read.mockResolvedValueOnce(found);
  const { route, resources } = renderPage();
  expect(areaPageTitle(route)).toBe(group);
  expect(screenCrumbs(route.screen, route.params, new URLSearchParams()).at(-1)).toEqual({ text: group });
  expect(screen.getByRole('heading', { level: 1, name: group })).toBeVisible();
  expect(resources).toHaveBeenCalledWith({ word: 'log streams' });
  expect(await screen.findByText('Standard')).toBeVisible();
  expect(await screen.findByText('web')).toBeVisible();
  expect(await screen.findByRole('link', { name: 'some-stream' })).toBeVisible();
  expect(read).toHaveBeenCalledWith(engineOrigin, group, expect.any(AbortSignal));
});

it('shows a not-found state in place of the details and streams when the group is absent', async () => {
  read.mockResolvedValueOnce({ kind: 'not-found' });
  renderPage();
  expect(await screen.findByText('Log group not found', { selector: 'strong' })).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(streams).not.toHaveBeenCalled();
  expect(tags).not.toHaveBeenCalled();
});

it.each(failures)('shows %s in the page and retries the group read', async (_label, failure, result, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(found);
  const { container } = renderPage(result);
  await waitFor(() => expect(container).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') expect(container).toHaveTextContent('Not implemented by the emulator');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('link', { name: 'some-stream' })).toBeVisible();
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(engineOrigin, group, expect.any(AbortSignal));
});

it('links Search log events to the events page with the group chosen', async () => {
  read.mockResolvedValueOnce(found);
  const { container } = renderPage();
  await screen.findByText('Standard');
  const search = container.querySelector('a[href^="/aws/logs/log-events?"]');
  expect(search).toHaveAccessibleName('Search log events');
  expect(search).toHaveAttribute('href', '/aws/logs/log-events?group=%2Fapp%23Group');
});
