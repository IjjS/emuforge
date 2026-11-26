import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { areaPage } from '../../../area-page';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import { getLogGroup, listLogGroupTags, OPERATIONS, type LogGroupRead } from '../api';
import { putRetentionPolicy } from '../group-create-api';
import { listLogStreams } from '../stream-api';
import { CREATE_LOG_STREAM, createLogStream, DELETE_LOG_STREAM, deleteLogStream } from '../stream-change-api';

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

vi.mock('../group-create-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../group-create-api')>()),
  putRetentionPolicy: vi.fn(),
}));

const path = '/aws/logs/log-groups/group/%2Fapp%23Group';
const group = '/app#Group';
const engineOrigin = 'http://127.0.0.1:8310';
const found = { kind: 'found', group: { logGroupName: group, retentionInDays: 7 } } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getLogGroup).mockResolvedValue(found);
  vi.mocked(listLogGroupTags).mockResolvedValue({});
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function renderGroupPage() {
  const route = areaPage(path);
  if (route.kind !== 'screen') throw new Error('The log group screen is not registered.');
  const {
    params,
    screen: { Page },
  } = route;

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
}

it('creates and deletes the exact multiline name through the registered log group page', async () => {
  const stream = 'a b/[$LATEST]\nsecond';
  const streamLabel = /a b\/\[\$LATEST\]\s*second/;
  const user = userEvent.setup();
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

  renderGroupPage();
  expect(await screen.findByText('No log streams')).toBeVisible();
  const create = screen.getByRole('button', { name: 'Create log stream' });
  const remove = screen.getByRole('button', { name: 'Delete log stream' });
  expect(remove).toBeVisible();
  fireEvent.click(create);
  const creating = within(await screen.findByRole('dialog', { name: 'Create log stream' }));
  const createName = creating.getByRole('textbox', { name: 'Log stream name' });
  await user.type(createName, 'a b/[[$LATEST]{Enter}second');
  expect(createName).toHaveValue(stream);
  fireEvent.click(creating.getByRole('button', { name: 'Create log stream' }));
  expect(await screen.findByRole('link', { name: streamLabel })).toBeVisible();
  expect(createLogStream).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, stream, expect.any(AbortSignal));
  const flash = createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.getElement();
  expect(flash).toHaveTextContent(`Log stream ${stream.replace('\n', ' ')} created.`);

  fireEvent.click(screen.getByRole('radio', { name: streamLabel }));
  fireEvent.click(remove);
  const deleting = within(
    await screen.findByRole('dialog', { name: /Delete log stream a b\/\[\$LATEST\]\s*second\?/ }),
  );
  const confirmName = deleting.getByRole('textbox', { name: "To confirm, type the log stream's name." });
  await user.type(confirmName, 'a b/[[$LATEST] second');
  expect(deleting.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await user.clear(confirmName);
  await user.type(confirmName, 'a b/[[$LATEST]{Enter}second');
  expect(confirmName).toHaveValue(stream);
  fireEvent.click(deleting.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('No log streams')).toBeVisible();
  await waitFor(() =>
    expect(createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.getElement()).toHaveTextContent(
      `Log stream ${stream.replace('\n', ' ')} deleted.`,
    ),
  );
  expect(deleteLogStream).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, stream, expect.any(AbortSignal));
  expect(screen.queryByRole('link', { name: streamLabel })).not.toBeInTheDocument();
});

it.each([
  { outcome: 'creation succeeds', operation: CREATE_LOG_STREAM, unavailable: false },
  { outcome: 'creation answers 501', operation: CREATE_LOG_STREAM, unavailable: true },
  { outcome: 'deletion answers 501', operation: DELETE_LOG_STREAM, unavailable: true },
])('keeps the stream write through a failed group refresh when $outcome', async ({ operation, unavailable }) => {
  const stream = 'stream';
  const creating = operation === CREATE_LOG_STREAM;
  const read = deferred<LogGroupRead>();
  const write = deferred<undefined>();
  const send = vi.mocked(creating ? createLogStream : deleteLogStream);
  vi.mocked(getLogGroup).mockResolvedValueOnce(found).mockReturnValueOnce(read.promise);
  vi.mocked(listLogStreams).mockResolvedValue({ items: creating ? [] : [{ logStreamName: stream }] });
  vi.mocked(putRetentionPolicy).mockResolvedValue({ $metadata: {} });
  send.mockReturnValueOnce(write.promise);
  renderGroupPage();

  const openStreamDialog = async () => {
    if (!creating) fireEvent.click(await screen.findByRole('radio', { name: stream }));
    fireEvent.click(await screen.findByRole('button', { name: creating ? 'Create log stream' : 'Delete log stream' }));
    return within(
      await screen.findByRole('dialog', { name: creating ? 'Create log stream' : `Delete log stream ${stream}?` }),
    );
  };
  if (creating) await screen.findByText('No log streams');
  else await screen.findByRole('link', { name: stream });

  fireEvent.click(screen.getByRole('button', { name: 'Edit retention' }));
  const retention = await screen.findByRole('dialog', { name: 'Edit retention' });
  const select = createWrapper(retention).findSelect();
  if (select === null) throw new Error('Retention select not found.');
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue('30'));
  fireEvent.click(within(retention).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(getLogGroup).toHaveBeenCalledTimes(2));

  const dialog = await openStreamDialog();
  const field = dialog.getByRole('textbox', {
    name: creating ? 'Log stream name' : "To confirm, type the log stream's name.",
  });
  const action = creating ? 'Create log stream' : 'Delete';
  fireEvent.change(field, { target: { value: stream } });
  fireEvent.click(dialog.getByRole('button', { name: action }));
  expect(send).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, stream, expect.any(AbortSignal));
  const signal = send.mock.calls[0]?.[3];

  await act(async () =>
    read.reject(
      new RequestError({
        kind: 'other',
        operation: OPERATIONS.describeLogGroups,
        code: 'GroupReadFailed',
        message: 'Could not refresh.',
      }),
    ),
  );
  expect(await screen.findByText('GroupReadFailed')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(field).toBeVisible();
  expect(field).toHaveValue(stream);
  expect(signal?.aborted).toBe(false);

  if (unavailable) {
    await act(async () => write.reject(new RequestError({ kind: 'not-implemented', operation })));
    expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  } else {
    vi.mocked(listLogStreams).mockResolvedValue({ items: [{ logStreamName: stream }] });
    await act(async () => write.resolve(undefined));
    expect(await screen.findByText(/created\./)).toBeVisible();
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  if (unavailable) {
    const reopened = await openStreamDialog();
    expect(reopened.getByRole('alert')).toHaveTextContent(`501 Not Implemented for ${operation}`);
    expect(reopened.getByRole('button', { name: action })).toBeDisabled();
    expect(send).toHaveBeenCalledTimes(1);
  } else {
    expect(await screen.findByRole('link', { name: stream })).toBeVisible();
  }
});
