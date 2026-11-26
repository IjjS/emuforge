import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { areaPage } from '../../../area-page';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import { getLogGroup, listLogGroupTags } from '../api';
import { listLogStreams } from '../stream-api';
import { createLogStream, deleteLogStream } from '../stream-change-api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getLogGroup: vi.fn(),
  listLogGroupTags: vi.fn(),
}));
vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));
vi.mock('../stream-change-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-change-api')>()),
  createLogStream: vi.fn(),
  deleteLogStream: vi.fn(),
}));

it('creates and deletes a stream through the registered log group page', async () => {
  const path = '/aws/logs/log-groups/group/%2Fapp%23Group';
  const group = '/app#Group';
  const stream = 'a b/[$LATEST]';
  const engineOrigin = 'http://127.0.0.1:8310';
  const route = areaPage(path);
  if (route.kind !== 'screen') throw new Error('The log group screen is not registered.');
  const {
    params,
    screen: { Page },
  } = route;

  vi.mocked(getLogGroup).mockResolvedValue({ kind: 'found', group: { logGroupName: group } });
  vi.mocked(listLogGroupTags).mockResolvedValue({});
  const streams = new Set<string>();
  vi.mocked(listLogStreams).mockImplementation(async () => ({
    items: [...streams].map((logStreamName) => ({ logStreamName })),
  }));
  vi.mocked(createLogStream).mockImplementation(async (_endpoint, _group, name) => {
    streams.add(name);
  });
  vi.mocked(deleteLogStream).mockImplementation(async (_endpoint, _group, name) => {
    streams.delete(name);
  });

  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const flash = useAreaFlash(path, 0, true);
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={flash.pageFlash}>
          <div ref={root}>
            {flash.shown && <AreaFlash result={flash.shown} onDismiss={flash.dismiss} onAnnounce={flash.announce} />}
            <Page connection={{ engineOrigin, result: undefined }} params={params} />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }

  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient()}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(await screen.findByText('No log streams')).toBeVisible();
  const create = screen.getByRole('button', { name: 'Create log stream' });
  const remove = screen.getByRole('button', { name: 'Delete log stream' });
  expect(remove).toBeVisible();
  fireEvent.click(create);
  const creating = within(await screen.findByRole('dialog', { name: 'Create log stream' }));
  fireEvent.change(creating.getByRole('textbox', { name: 'Log stream name' }), { target: { value: stream } });
  fireEvent.click(creating.getByRole('button', { name: 'Create log stream' }));
  expect(await screen.findByRole('link', { name: stream })).toBeVisible();
  expect(createLogStream).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, stream, expect.any(AbortSignal));
  const flash = createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.getElement();
  expect(flash).toHaveTextContent(`Log stream ${stream} created.`);

  fireEvent.click(screen.getByRole('radio', { name: stream }));
  fireEvent.click(remove);
  const deleting = within(await screen.findByRole('dialog', { name: `Delete log stream ${stream}?` }));
  fireEvent.change(deleting.getByRole('textbox', { name: "To confirm, type the log stream's name." }), {
    target: { value: stream },
  });
  fireEvent.click(deleting.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('No log streams')).toBeVisible();
  await waitFor(() =>
    expect(createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.getElement()).toHaveTextContent(
      `Log stream ${stream} deleted.`,
    ),
  );
  expect(deleteLogStream).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, stream, expect.any(AbortSignal));
  expect(screen.queryByRole('link', { name: stream })).not.toBeInTheDocument();
});
