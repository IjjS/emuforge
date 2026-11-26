import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import {
  aws,
  boxText,
  expectEmpty,
  expectModalAlert,
  flash,
  modal as openModal,
  modalAlert,
  modalButton,
  modalInput,
  rowLink,
  rowRadio,
  tableByHeading,
  waitForLink,
} from '../../../../../../test/logs-test-utils';
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

const streamTable = () => tableByHeading('Log streams');

it('creates and deletes the exact stream name through the registered log group page', async () => {
  const stream = 'a b/[$LATEST] second';
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
  await expectEmpty(streamTable, 'No log streams');
  const create = screen.getByRole('button', { name: 'Create log stream' });
  const remove = screen.getByRole('button', { name: 'Delete log stream' });
  expect(remove).toBeVisible();
  fireEvent.click(create);
  const creating = await openModal('Create log stream');
  const createName = modalInput(creating, 'Log stream name');
  fireEvent.change(createName, { target: { value: stream } });
  expect(createName).toHaveValue(stream);
  fireEvent.click(modalButton(creating, 'Create log stream'));
  expect(await waitForLink(streamTable, stream)).toBeVisible();
  expect(createLogStream).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, stream, expect.any(AbortSignal));
  const notification = createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.getElement();
  expect(notification).toHaveTextContent(`Log stream ${stream} created.`);

  fireEvent.click(rowRadio(streamTable(), stream));
  fireEvent.click(remove);
  const deleting = await openModal(`Delete log stream ${stream}?`);
  const confirmName = modalInput(deleting, "To confirm, type the log stream's name.");
  fireEvent.change(confirmName, { target: { value: stream.toLowerCase() } });
  expect(modalButton(deleting, 'Delete')).toBeDisabled();
  fireEvent.change(confirmName, { target: { value: stream } });
  expect(confirmName).toHaveValue(stream);
  fireEvent.click(modalButton(deleting, 'Delete'));
  await expectEmpty(streamTable, 'No log streams');
  await waitFor(() =>
    expect(createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.getElement()).toHaveTextContent(
      `Log stream ${stream} deleted.`,
    ),
  );
  expect(deleteLogStream).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, stream, expect.any(AbortSignal));
  expect(rowLink(streamTable(), stream) ?? null).not.toBeInTheDocument();
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
    if (!creating) fireEvent.click(await waitFor(() => rowRadio(streamTable(), stream)));
    fireEvent.click(await screen.findByRole('button', { name: creating ? 'Create log stream' : 'Delete log stream' }));
    return await openModal(creating ? 'Create log stream' : `Delete log stream ${stream}?`);
  };
  if (creating) await expectEmpty(streamTable, 'No log streams');
  else await waitForLink(streamTable, stream);

  fireEvent.click(screen.getByRole('button', { name: 'Edit retention' }));
  const retention = await openModal('Edit retention');
  const select = retention.findContent().findSelect();
  if (select === null) throw new Error('Retention select not found.');
  act(() => select.openDropdown());
  act(() => select.selectOptionByValue('30'));
  fireEvent.click(modalButton(retention, 'Save'));
  await waitFor(() => expect(getLogGroup).toHaveBeenCalledTimes(2));

  const dialog = await openStreamDialog();
  const field = modalInput(dialog, creating ? 'Log stream name' : "To confirm, type the log stream's name.");
  const action = creating ? 'Create log stream' : 'Delete';
  fireEvent.change(field, { target: { value: stream } });
  fireEvent.click(modalButton(dialog, action));
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
  await waitFor(() => expect(boxText(aws(), 'GroupReadFailed', 'code')).toBeVisible());
  expect(aws().findTable()?.getElement() ?? null).not.toBeInTheDocument();
  expect(field).toBeVisible();
  expect(field).toHaveValue(stream);
  expect(signal?.aborted).toBe(false);

  if (unavailable) {
    await act(async () => write.reject(new RequestError({ kind: 'not-implemented', operation })));
    await expectModalAlert(dialog, 'Not implemented by the emulator');
    fireEvent.click(modalButton(dialog, 'Cancel'));
  } else {
    vi.mocked(listLogStreams).mockResolvedValue({ items: [{ logStreamName: stream }] });
    await act(async () => write.resolve(undefined));
    await waitFor(() => {
      expect(flash()?.getElement()).toBeVisible();
      expect(flash()?.getElement()).toHaveTextContent(/created\./);
    });
  }
  expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  if (unavailable) {
    const reopened = await openStreamDialog();
    expect(modalAlert(reopened)?.findContent().getElement()).toHaveTextContent(`501 Not Implemented for ${operation}`);
    expect(modalButton(reopened, action)).toBeDisabled();
    expect(send).toHaveBeenCalledTimes(1);
  } else {
    expect(await waitForLink(streamTable, stream)).toBeVisible();
  }
});
