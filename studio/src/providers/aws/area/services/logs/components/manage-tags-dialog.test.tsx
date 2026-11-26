import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  flash,
  aws,
  buttonIn,
  requiredElement,
  tableByHeading,
  modal as openModal,
  modalButton,
  modalAlert,
  expectModalBox,
  expectModalAlert,
  modalTextInputs,
  modalInputByValue,
  type Modal,
} from '../logs-test-utils.test';
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
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
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

function tagRows() {
  const table = createWrapper(document.body)
    .findAllTables()
    .find(
      (candidate) => candidate.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Tags',
    );
  return table
    ?.findRows()
    .map((_, index) => [
      table.findBodyCell(index + 1, 1)?.getElement().textContent,
      table.findBodyCell(index + 1, 2)?.getElement().textContent,
    ]);
}

async function waitForInitialTags() {
  await waitFor(() =>
    expect(tagRows()).toEqual([
      ['a', 'one'],
      ['b', 'two'],
    ]),
  );
}

async function open() {
  const action = await waitFor(() =>
    requiredElement(buttonIn(tableByHeading('Tags')?.findHeaderSlot(), 'Manage tags')),
  );
  await waitFor(() => expect(action).toBeEnabled());
  fireEvent.click(action);
  const dialog = await openModal('Manage tags');
  const element = dialog.getElement();
  return { element, dialog, save: modalButton(dialog, 'Save') };
}

function addTag(dialog: Modal, key: string, value: string) {
  fireEvent.click(modalButton(dialog, 'Add tag'));
  const inputs = modalTextInputs(dialog);
  const keyInput = inputs.at(-2);
  const valueInput = inputs.at(-1);
  if (keyInput === undefined || valueInput === undefined) throw new Error('Tag fields were not found.');
  fireEvent.change(keyInput, { target: { value: key } });
  fireEvent.change(valueInput, { target: { value } });
}

function replaceA(dialog: Modal) {
  fireEvent.click(modalButton(dialog, 'Remove tag a'));
  addTag(dialog, 'c', 'refused');
}

function expectDraftKept(dialog: Modal) {
  expect(modalTextInputs(dialog).map((input) => input.value)).toEqual(['b', 'two', 'c', 'refused']);
}

it('opens with current tags, closes without requests for an unchanged save, and validates edits before sending', async () => {
  const sent = writes();
  renderGroup();
  await waitForInitialTags();
  const unchanged = await open();
  expect(modalInputByValue(unchanged.dialog, 'one')).toBeVisible();
  expect(modalInputByValue(unchanged.dialog, 'two')).toBeVisible();
  fireEvent.click(unchanged.save);
  expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();

  const { dialog, save } = await open();
  addTag(dialog, 'aws:reserved', '');
  fireEvent.click(save);
  const error = dialog
    .findContent()
    .findAllFormFields()
    .find((field) => field.findError())
    ?.findError()
    ?.getElement();
  expect(error).toBeVisible();
  expect(error).toHaveTextContent('A tag key cannot start with aws:.');
  expect(sent).toEqual([]);
});

it('keeps the draft and stops before the tag call when untag is refused', async () => {
  const sent = writes([400]);
  renderGroup();
  await waitForInitialTags();
  const { dialog, save } = await open();
  replaceA(dialog);
  fireEvent.click(save);
  await expectModalAlert(dialog, 'UntagLogGroup failed');
  expect(modalAlert(dialog)?.findContent().getElement()).toHaveTextContent('Value refused.');
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
  await waitForInitialTags();
  const { dialog, save } = await open();
  replaceA(dialog);
  fireEvent.click(save);

  await expectModalAlert(dialog, 'TagLogGroup failed');
  expect(modalAlert(dialog)?.findContent().getElement()).toHaveTextContent('Value refused.');
  const warning = dialog.findContent().findAllAlerts()[1]?.findContent().getElement();
  expect(warning).toBeVisible();
  expect(warning).toHaveTextContent('The tags removed in this save are already removed.');
  const loading = dialog.findContent().findStatusIndicator()?.getElement();
  expect(loading).toBeVisible();
  expect(loading).toHaveTextContent('Loading tags');
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
  await waitFor(() => expectModalBox(dialog, 'ListTagsLogGroup'));
  expectModalBox(dialog, 'ReadFailed');
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(sent).toHaveLength(2);
  expectDraftKept(dialog);

  fireEvent.click(modalButton(dialog, 'Retry'));
  expect(save).toBeDisabled();
  await act(async () => retry.resolve({ b: 'two' }));
  await waitFor(() => expect(save).toBeEnabled());
  expectDraftKept(dialog);
  expect(tagRows()).toEqual([['b', 'two']]);

  fireEvent.change(modalInputByValue(dialog, 'refused'), { target: { value: 'fixed' } });
  fireEvent.click(save);
  await waitFor(() => expect(flash()?.getElement()).toHaveTextContent(`Tags of ${name} saved.`));
  expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
  await waitFor(() =>
    expect(tagRows()).toEqual([
      ['b', 'two'],
      ['c', 'fixed'],
    ]),
  );
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
    await waitForInitialTags();
    const first = await open();
    replaceA(first.dialog);
    fireEvent.click(first.save);
    await expectModalAlert(first.dialog, 'Not implemented by the emulator');
    expect(modalAlert(first.dialog)?.findContent().getElement()).toHaveTextContent(operation);
    expect(first.save).toBeDisabled();
    expectDraftKept(first.dialog);
    expect(sent).toHaveLength(statuses.length);
    if (operation === 'TagLogGroup') {
      const warning = first.dialog.findContent().findAllAlerts()[1]?.findContent().getElement();
      expect(warning).toBeVisible();
      expect(warning).toHaveTextContent('The tags removed in this save are already removed.');
      await waitFor(() => expect(tagRows()).toEqual([['b', 'two']]));
    }
    fireEvent.click(modalButton(first.dialog, 'Cancel'));

    const reopened = await open();
    expect(reopened.save).toBeDisabled();
    expect(modalAlert(reopened.dialog)?.findContent().getElement()).toHaveTextContent(operation);
    fireEvent.click(reopened.save);
    expect(sent).toHaveLength(statuses.length);
    if (operation === 'UntagLogGroup') {
      fireEvent.click(modalButton(reopened.dialog, 'Remove tag a'));
      expect(reopened.save).toBeDisabled();
      expect(modalAlert(reopened.dialog)?.findContent().getElement()).toHaveTextContent(operation);
      addTag(reopened.dialog, 'a', 'one');
      fireEvent.change(modalInputByValue(reopened.dialog, 'two'), { target: { value } });
    } else {
      addTag(reopened.dialog, 'c', 'updated');
      expect(reopened.save).toBeDisabled();
      expect(modalAlert(reopened.dialog)?.findContent().getElement()).toHaveTextContent(operation);
      fireEvent.click(modalButton(reopened.dialog, 'Remove tag c'));
      fireEvent.click(modalButton(reopened.dialog, 'Remove tag b'));
    }
    expect(reopened.save).toBeEnabled();
    fireEvent.click(reopened.save);
    await waitFor(() => expect(sent.at(-1)?.operation).toBe(permitted));
    expect(sent).toHaveLength(statuses.length + 1);
    await waitFor(() => expect(reopened.element).not.toBeInTheDocument());
  },
);
