import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type BoundFunctions,
  type queries,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import { getLogGroup, listLogGroupTags } from '../api';
import { logGroupPath } from '../format';
import { listLogStreams } from '../stream-api';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  getLogGroup: vi.fn(),
  listLogGroupTags: vi.fn(),
}));
vi.mock('../stream-api', async (original) => ({
  ...(await original<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8310';
const name = '/app#Group';
const listTags = vi.mocked(listLogGroupTags);
const initial = { a: 'one', b: 'two' };
const headers = { 'content-type': 'application/x-amz-json-1.1' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getLogGroup).mockResolvedValue({ kind: 'found', group: { logGroupName: name } });
  vi.mocked(listLogStreams).mockResolvedValue({ items: [] });
  listTags.mockResolvedValue(initial);
});

afterEach(() => vi.unstubAllGlobals());

function writes(statuses: number[] = []) {
  const sent: { operation: string | undefined; tags: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token' }), { headers });
    }
    const body = (await request.json()) as { tags: unknown };
    const operation = request.headers.get('x-amz-target')?.split('.')[1];
    sent.push({ operation, tags: body.tags });
    const status = statuses[sent.length - 1] ?? 200;
    return new Response(
      status === 200 ? '{}' : JSON.stringify({ __type: 'InvalidParameterException', message: 'Value refused.' }),
      { status, headers },
    );
  });
  return sent;
}

function renderGroup() {
  render(
    <MemoryRouter initialEntries={[logGroupPath(name)]}>
      <QueryClientProvider client={new QueryClient()}>
        <AreaLayout
          connection={{ engineOrigin: endpoint, result: undefined }}
          headerSelector="#studio-header"
          onContentTarget={vi.fn()}
          onPageTitle={vi.fn()}
          routeChanges={0}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function open() {
  const action = screen.getByRole('button', { name: 'Manage tags' });
  await waitFor(() => expect(action).toBeEnabled());
  fireEvent.click(action);
  const element = await screen.findByRole('dialog', { name: 'Manage tags' });
  const dialog = within(element);
  return { element, dialog, save: dialog.getByRole('button', { name: 'Save' }) };
}

function addTag(dialog: BoundFunctions<typeof queries>, key: string, value: string) {
  fireEvent.click(dialog.getByRole('button', { name: 'Add tag' }));
  const inputs = dialog.getAllByRole('textbox');
  const keyInput = inputs.at(-2);
  const valueInput = inputs.at(-1);
  if (keyInput === undefined || valueInput === undefined) throw new Error('Tag fields were not found.');
  fireEvent.change(keyInput, { target: { value: key } });
  fireEvent.change(valueInput, { target: { value } });
}

function replaceA(dialog: BoundFunctions<typeof queries>) {
  fireEvent.click(dialog.getByRole('button', { name: 'Remove tag a' }));
  addTag(dialog, 'c', 'refused');
}

function expectDraftKept(dialog: BoundFunctions<typeof queries>) {
  expect(dialog.getAllByRole('textbox').map((input) => (input as HTMLInputElement).value)).toEqual([
    'b',
    'two',
    'c',
    'refused',
  ]);
}

it('opens with current tags, closes without requests for an unchanged save, and validates edits before sending', async () => {
  const sent = writes();
  renderGroup();
  await screen.findByText('one');
  const unchanged = await open();
  expect(unchanged.dialog.getByDisplayValue('one')).toBeVisible();
  expect(unchanged.dialog.getByDisplayValue('two')).toBeVisible();
  fireEvent.click(unchanged.save);
  expect(screen.queryByRole('dialog', { name: 'Manage tags' })).not.toBeInTheDocument();

  const { dialog, save } = await open();
  addTag(dialog, 'aws:reserved', '');
  fireEvent.click(save);
  expect(dialog.getByText('A tag key cannot start with aws:.')).toBeVisible();
  expect(sent).toEqual([]);
});

it('keeps the draft and stops before the tag call when untag is refused', async () => {
  const sent = writes([400]);
  renderGroup();
  await screen.findByText('one');
  const { dialog, save } = await open();
  replaceA(dialog);
  fireEvent.click(save);
  expect(await dialog.findByText('UntagLogGroup failed')).toBeVisible();
  expect(dialog.getByRole('alert')).toHaveTextContent('Value refused.');
  expectDraftKept(dialog);
  expect(sent).toEqual([{ operation: 'UntagLogGroup', tags: ['a'] }]);
  expect(listTags).toHaveBeenCalledTimes(1);
});

it('blocks save after a partial write until a retry reads fresh tags, then saves only the remaining change', async () => {
  const sent = writes([200, 400, 200]);
  const tagRead = deferred<Record<string, string>>();
  const retry = deferred<Record<string, string>>();
  listTags
    .mockResolvedValueOnce(initial)
    .mockReturnValueOnce(tagRead.promise)
    .mockReturnValueOnce(retry.promise)
    .mockResolvedValue({ b: 'two', c: 'fixed' });
  renderGroup();
  await screen.findByText('one');
  const { dialog, save } = await open();
  replaceA(dialog);
  fireEvent.click(save);

  expect(await dialog.findByText('TagLogGroup failed')).toBeVisible();
  expect(dialog.getByRole('alert')).toHaveTextContent('Value refused.');
  expect(dialog.getByText('The tags removed in this save are already removed.')).toBeVisible();
  expect(dialog.getByText('Loading tags')).toBeVisible();
  expect(save).toBeDisabled();
  expectDraftKept(dialog);

  await act(async () =>
    tagRead.reject(
      new RequestError({
        kind: 'other',
        operation: 'ListTagsLogGroup',
        code: 'ReadFailed',
        message: 'Try again.',
      }),
    ),
  );
  expect(await dialog.findByText('ListTagsLogGroup')).toBeVisible();
  expect(dialog.getByText('ReadFailed')).toBeVisible();
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(sent).toHaveLength(2);
  expectDraftKept(dialog);

  fireEvent.click(dialog.getByRole('button', { name: 'Retry' }));
  expect(save).toBeDisabled();
  await act(async () => retry.resolve({ b: 'two' }));
  await waitFor(() => expect(save).toBeEnabled());
  expectDraftKept(dialog);
  const table = document.querySelector('table');
  expect(table).toHaveTextContent('two');
  expect(table).not.toHaveTextContent('one');
  expect(table).not.toHaveTextContent('refused');

  fireEvent.change(dialog.getByDisplayValue('refused'), { target: { value: 'fixed' } });
  fireEvent.click(save);
  const notifications = await screen.findByRole('list', { name: 'Notifications' });
  expect(notifications).toHaveTextContent(`Tags of ${name} saved.`);
  expect(screen.queryByRole('dialog', { name: 'Manage tags' })).not.toBeInTheDocument();
  expect(await screen.findByText('fixed')).toBeVisible();
  expect(sent).toEqual([
    { operation: 'UntagLogGroup', tags: ['a'] },
    { operation: 'TagLogGroup', tags: { c: 'refused' } },
    { operation: 'TagLogGroup', tags: { c: 'fixed' } },
  ]);
});

it.each([
  ['UntagLogGroup', [501], initial, 'TagLogGroup', 'updated'],
  ['TagLogGroup', [200, 501], { b: 'two' }, 'UntagLogGroup', undefined],
] as const)(
  'remembers a 501 for %s across openings and permits the other tag operation',
  async (operation, statuses, after, permitted, value) => {
    const sent = writes([...statuses]);
    listTags.mockResolvedValueOnce(initial).mockResolvedValue(after);
    renderGroup();
    await screen.findByText('one');
    const first = await open();
    replaceA(first.dialog);
    fireEvent.click(first.save);
    expect(await first.dialog.findByText('Not implemented by the emulator')).toBeVisible();
    expect(first.dialog.getByRole('alert')).toHaveTextContent(operation);
    expect(first.save).toBeDisabled();
    expectDraftKept(first.dialog);
    expect(sent).toHaveLength(statuses.length);
    if (operation === 'TagLogGroup') {
      expect(first.dialog.getByText('The tags removed in this save are already removed.')).toBeVisible();
      await waitFor(() => expect(document.querySelector('table')).toHaveTextContent('two'));
      expect(document.querySelector('table')).not.toHaveTextContent('one');
    }
    fireEvent.click(first.dialog.getByRole('button', { name: 'Cancel' }));

    const reopened = await open();
    expect(reopened.save).toBeDisabled();
    expect(reopened.dialog.getByRole('alert')).toHaveTextContent(operation);
    fireEvent.click(reopened.save);
    expect(sent).toHaveLength(statuses.length);
    if (operation === 'UntagLogGroup') {
      fireEvent.click(reopened.dialog.getByRole('button', { name: 'Remove tag a' }));
      expect(reopened.save).toBeDisabled();
      expect(reopened.dialog.getByRole('alert')).toHaveTextContent(operation);
      addTag(reopened.dialog, 'a', 'one');
      fireEvent.change(reopened.dialog.getByDisplayValue('two'), { target: { value } });
    } else {
      addTag(reopened.dialog, 'c', 'updated');
      expect(reopened.save).toBeDisabled();
      expect(reopened.dialog.getByRole('alert')).toHaveTextContent(operation);
      fireEvent.click(reopened.dialog.getByRole('button', { name: 'Remove tag c' }));
      fireEvent.click(reopened.dialog.getByRole('button', { name: 'Remove tag b' }));
    }
    expect(reopened.save).toBeEnabled();
    fireEvent.click(reopened.save);
    await waitFor(() => expect(sent.at(-1)?.operation).toBe(permitted));
    expect(sent).toHaveLength(statuses.length + 1);
    await waitFor(() => expect(reopened.element).not.toBeInTheDocument());
  },
);
