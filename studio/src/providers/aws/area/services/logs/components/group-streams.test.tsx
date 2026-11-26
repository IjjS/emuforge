import createWrapper from '@cloudscape-design/components/test-utils/dom';
import type { LogStream } from '@aws-sdk/client-cloudwatch-logs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import { listLogStreams } from '../stream-api';
import { CREATE_LOG_STREAM, createLogStream, DELETE_LOG_STREAM, deleteLogStream } from '../stream-change-api';
import { GroupStreams } from './group-streams';

vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));

vi.mock('../stream-change-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-change-api')>()),
  createLogStream: vi.fn(),
  deleteLogStream: vi.fn(),
}));

const engineOrigin = 'http://127.0.0.1:8310';
const group = '/app#Group';
const read = vi.mocked(listLogStreams);
const create = vi.mocked(createLogStream);
const remove = vi.mocked(deleteLogStream);

beforeEach(() => {
  read.mockReset();
  create.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
});

function renderGroupStreams() {
  const client = new QueryClient();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const flash = useAreaFlash('/aws/logs/log-groups/group/%2Fapp%23Group', 0, true);
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={flash.pageFlash}>
          <div ref={root}>
            {flash.shown && <AreaFlash result={flash.shown} onDismiss={flash.dismiss} onAnnounce={flash.announce} />}
            <GroupStreams group={group} connection={{ engineOrigin, result: undefined }} />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...rendered, client };
}

function page(...names: string[]): TokenPage<LogStream> {
  return { items: names.map((logStreamName) => ({ logStreamName })) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function opener(action: 'create' | 'delete') {
  return screen.getByRole('button', { name: action === 'create' ? 'Create log stream' : 'Delete log stream' });
}

async function open(action: 'create' | 'delete', name: string) {
  if (action === 'delete') fireEvent.click(screen.getByRole('radio', { name }));
  fireEvent.click(opener(action));
  const element = await screen.findByRole('dialog');
  const dialog = within(element);
  const field = dialog.getByRole('textbox');
  fireEvent.change(field, { target: { value: name } });
  return { dialog, submit: dialog.getByRole('button', { name: action === 'create' ? 'Create log stream' : 'Delete' }) };
}

async function expectResult(text: string) {
  await waitFor(() =>
    expect(createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.getElement()).toHaveTextContent(
      text,
    ),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

it('offers both actions, and after create and delete rereads the shown page', async () => {
  read
    .mockResolvedValueOnce({ ...page('first stream'), next: 'second' })
    .mockResolvedValueOnce(page('second stream'))
    .mockResolvedValueOnce(page('second stream', 'new stream'))
    .mockResolvedValueOnce(page('second stream'));
  renderGroupStreams();
  expect(opener('create')).toBeVisible();
  expect(opener('delete')).toHaveAttribute('aria-disabled', 'true');
  expect(await screen.findByRole('link', { name: 'first stream' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByRole('link', { name: 'second stream' });
  fireEvent.click((await open('create', 'new stream')).submit);
  await expectResult('Log stream new stream created.');
  expect(await screen.findByRole('link', { name: 'new stream' })).toBeVisible();
  expect(create).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, 'new stream', expect.any(AbortSignal));
  expect(read).toHaveBeenLastCalledWith(engineOrigin, group, '', 'second', expect.any(AbortSignal));

  fireEvent.click((await open('delete', 'new stream')).submit);
  await expectResult('Log stream new stream deleted.');
  await screen.findByRole('link', { name: 'second stream' });
  expect(screen.queryByRole('link', { name: 'new stream' })).not.toBeInTheDocument();
  expect(opener('delete')).toHaveAttribute('aria-disabled', 'true');
  expect(remove).toHaveBeenCalledExactlyOnceWith(engineOrigin, group, 'new stream', expect.any(AbortSignal));
  expect(read).toHaveBeenLastCalledWith(engineOrigin, group, '', 'second', expect.any(AbortSignal));
});

it.each([
  ['create', CREATE_LOG_STREAM, create],
  ['delete', DELETE_LOG_STREAM, remove],
] as const)(
  'keeps both controls after %s answers 501 and remembers which action was unavailable',
  async (action, operation, write) => {
    read.mockResolvedValue(page('stream'));
    write.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
    renderGroupStreams();
    await screen.findByRole('link', { name: 'stream' });

    const { dialog, submit } = await open(action, 'stream');
    fireEvent.click(submit);
    expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(opener('create')).toBeVisible();
    expect(opener('delete')).toBeVisible();
    const reopened = await open(action, 'stream');
    expect(reopened.dialog.getByRole('alert')).toHaveTextContent(operation);
    expect(reopened.submit).toBeDisabled();
    expect(write).toHaveBeenCalledTimes(1);
    fireEvent.click(reopened.dialog.getByRole('button', { name: 'Cancel' }));
    const other = await open(action === 'create' ? 'delete' : 'create', 'stream');
    expect(other.submit).toBeEnabled();
  },
);

it.each([
  ['create', 'old answer first'],
  ['create', 'fresh answer first'],
  ['create', 'fresh read fails'],
  ['delete', 'old answer first'],
  ['delete', 'fresh answer first'],
  ['delete', 'fresh read fails'],
] as const)('keeps a successful %s independent of listing results when %s', async (action, order) => {
  const before = deferred<TokenPage<LogStream>>();
  const after = deferred<TokenPage<LogStream>>();
  const written = deferred<undefined>();
  const isCreate = action === 'create';
  const name = isCreate ? 'created stream' : 'deleted stream';
  const original = isCreate ? page('kept') : page('kept', name);
  read.mockResolvedValueOnce(original).mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
  (isCreate ? create : remove).mockReturnValueOnce(written.promise);
  const { client } = renderGroupStreams();
  await screen.findByRole('link', { name: 'kept' });

  const { submit } = await open(action, name);
  // A background refetch keeps the shown rows while its newer answer is outstanding.
  act(() => {
    void client.refetchQueries({ type: 'active', queryKey: ['logs', 'streams'] });
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  fireEvent.click(submit);
  await act(async () => written.resolve(undefined));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));

  if (order === 'old answer first') {
    await act(async () => before.resolve(original));
  }
  if (order === 'fresh read fails') {
    await act(async () => {
      after.reject(new RequestError({ kind: 'other', operation: 'DescribeLogStreams', code: 'Read failed' }));
    });
  } else {
    await act(async () => after.resolve(isCreate ? page('fresh', name) : page('fresh')));
  }
  if (order === 'fresh answer first') {
    await screen.findByRole('link', { name: 'fresh' });
    await act(async () => {
      before.reject(new RequestError({ kind: 'other', operation: 'DescribeLogStreams', code: 'Late failure' }));
    });
  }
  if (order === 'fresh read fails') {
    await act(async () => before.resolve(original));
  }

  await expectResult(`Log stream ${name} ${isCreate ? 'created' : 'deleted'}.`);
  const table = within(screen.getByRole('table'));
  if (order === 'fresh read fails') {
    expect(await table.findByText('Read failed')).toBeVisible();
    expect(table.getByRole('button', { name: 'Retry' })).toBeVisible();
  } else {
    expect(await table.findByRole('link', { name: 'fresh' })).toBeVisible();
    expect(table.queryByText('Late failure')).not.toBeInTheDocument();
  }
  expect(table.queryByRole('link', { name: 'kept' })).not.toBeInTheDocument();
  if (!isCreate) expect(table.queryByRole('link', { name })).not.toBeInTheDocument();
});
