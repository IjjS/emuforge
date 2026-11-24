import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { RequestError, requestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import type { Instance } from '../api';
import { changeInstanceContent, getInstanceUserData, type InstanceUserData } from '../instance-content-api';
import { InstanceUserDataEditor } from './instance-user-data-editor';

vi.mock('../instance-content-api', async (original) => ({
  ...(await original<typeof import('../instance-content-api')>()),
  changeInstanceContent: vi.fn(),
  getInstanceUserData: vi.fn(),
}));

const ENDPOINT = 'http://127.0.0.1:8363';
const CONNECTION: AreaConnection = {
  engineOrigin: ENDPOINT,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9363, endpoint: 'https://127.0.0.1:9363' } },
};
const INSTANCE: Instance = { id: 'i-user-data', state: 'stopped', groups: [], volumes: [], tags: [] };
const LABEL = 'Edit user data';
const READ = 'DescribeInstanceAttribute';
const WRITE = 'ModifyInstanceAttribute';

function showEditor(value: InstanceUserData = { kind: 'text', text: 'first\nsecond\n' }) {
  vi.resetAllMocks();
  vi.mocked(getInstanceUserData).mockResolvedValue(value);
  vi.mocked(changeInstanceContent).mockResolvedValue(undefined);
  function Fixture() {
    const root = useRef<HTMLDivElement>(null);
    const [flash, setFlash] = useState<FlashResult>();
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={{ show: setFlash, handOver: vi.fn() }}>
          <div ref={root}>
            <Flashbar items={flash ?? []} />
            <InstanceUserDataEditor instance={INSTANCE} connection={CONNECTION} />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Fixture />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function refusal(operation: string, code: string, message: string, status: number) {
  return new RequestError(
    requestFailure(operation, { Code: code, message, $fault: 'client', $metadata: { httpStatusCode: status } }),
  );
}

async function open() {
  fireEvent.click(screen.getByRole('button', { name: LABEL }));
  return screen.findByRole('dialog', { name: LABEL });
}

function field(dialog: HTMLElement) {
  return createWrapper(dialog).findTextarea()?.findNativeTextarea().getElement();
}

async function loadedField(dialog: HTMLElement) {
  return waitFor(() => {
    const textarea = field(dialog);
    if (!textarea) throw new Error('Missing user data field');
    return textarea;
  });
}

function save(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: 'Save changes' });
}

it('allows Retry after a failed read and enables saving a change once the actual value arrives', async () => {
  showEditor();
  vi.mocked(getInstanceUserData).mockRejectedValueOnce(
    refusal(READ, 'InternalError', 'The current value could not be read.', 500),
  );
  const dialog = await open();
  expect(await within(dialog).findByText(/The current value could not be read\./)).toBeVisible();
  expect(within(dialog).getByText('InternalError')).toBeVisible();
  expect(field(dialog)).toBeUndefined();
  expect(save(dialog)).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
  const textarea = await loadedField(dialog);
  expect(textarea).toHaveValue('first\nsecond\n');
  expect(save(dialog)).toBeDisabled();
  fireEvent.change(textarea, { target: { value: 'after retry' } });
  expect(save(dialog)).toBeEnabled();
  expect(changeInstanceContent).not.toHaveBeenCalled();
});

it('explains why binary user data cannot be edited and prevents saving it', async () => {
  showEditor({ kind: 'binary' });
  const dialog = await open();
  expect(await within(dialog).findByText('The existing user data cannot be edited as UTF-8 text.')).toBeVisible();
  expect(field(dialog)).toBeUndefined();
  expect(save(dialog)).toBeDisabled();
  fireEvent.click(save(dialog));
  expect(changeInstanceContent).not.toHaveBeenCalled();
});

it('cancels edits to multiline text and reads the original content on reopening', async () => {
  showEditor();
  const dialog = await open();
  const textarea = await loadedField(dialog);
  expect(textarea).toHaveValue('first\nsecond\n');
  fireEvent.change(textarea, { target: { value: 'new first\nnew second' } });
  expect(textarea).toHaveValue('new first\nnew second');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await loadedField(await open())).toHaveValue('first\nsecond\n');
  expect(getInstanceUserData).toHaveBeenCalledTimes(2);
  expect(changeInstanceContent).not.toHaveBeenCalled();
});

it('keeps the original refusal and multiline draft when the instance was started externally', async () => {
  showEditor();
  vi.mocked(changeInstanceContent).mockRejectedValueOnce(
    refusal(WRITE, 'IncorrectInstanceState', 'The instance is running.', 400),
  );
  const dialog = await open();
  const draft = 'replacement\nsecond line\n';
  const textarea = await loadedField(dialog);
  fireEvent.change(textarea, { target: { value: draft } });
  fireEvent.click(save(dialog));
  const message = 'IncorrectInstanceState: The instance is running.';
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  expect(createWrapper(document.body).findFlashbar()?.getElement()).toHaveTextContent(message);
  expect(textarea).toHaveValue(draft);
  expect(screen.queryByText('User data updated.')).toBeNull();

  fireEvent.change(textarea, { target: { value: draft + 'corrected' } });
  fireEvent.click(save(dialog));
  expect(await screen.findByText('User data updated.')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(changeInstanceContent).toHaveBeenLastCalledWith(
    ENDPOINT,
    INSTANCE.id,
    { kind: 'user-data', text: draft + 'corrected' },
    expect.any(AbortSignal),
  );
});

it.each([READ, WRITE])('keeps the edit action visible and unavailable after a 501 from %s', async (operation) => {
  showEditor();
  const denied = refusal(operation, 'NotImplemented', 'User data operation unavailable.', 501);
  if (operation === READ) vi.mocked(getInstanceUserData).mockRejectedValueOnce(denied);
  else vi.mocked(changeInstanceContent).mockRejectedValueOnce(denied);
  const dialog = await open();
  if (operation === WRITE) {
    fireEvent.change(await loadedField(dialog), { target: { value: 'new content' } });
    fireEvent.click(save(dialog));
  }
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(new RegExp(`501 Not Implemented for ${operation}`))).toBeVisible();
  expect(screen.getByText(/User data operation unavailable\./)).toBeVisible();
  const edit = screen.getByRole('button', { name: LABEL });
  expect(edit).toBeVisible();
  expect(edit).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['x\r\ny\rz\n', '\uFEFF한글\n'])('opens %j as reversible JSON and rejects invalid input', async (text) => {
  showEditor({ kind: 'text', text });
  const dialog = await open();
  const textarea = await loadedField(dialog);
  expect(within(dialog).getByText(/Use a JSON string to preserve line endings and leading BOM/)).toBeVisible();
  expect(JSON.parse(textarea.value)).toBe(text);
  expect(textarea.value).toBe(JSON.stringify(text).replace(/^"\uFEFF/u, '"\\uFEFF'));
  for (const invalid of ['{"not":"a string"}', '"unterminated', '"\\uD800"']) {
    fireEvent.change(textarea, { target: { value: invalid } });
    expect(within(dialog).getByText('Enter a valid JSON string with valid Unicode characters.')).toBeVisible();
    expect(save(dialog)).toBeDisabled();
  }
  expect(changeInstanceContent).not.toHaveBeenCalled();
});

it('can enter exact line endings in JSON mode and clear the data with an empty field', async () => {
  showEditor({ kind: 'text', text: '' });
  let dialog = await open();
  let textarea = await loadedField(dialog);
  expect(textarea).toHaveValue('');
  expect(save(dialog)).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit as JSON string' }));
  expect(textarea).toHaveValue('""');
  expect(save(dialog)).toBeDisabled();
  fireEvent.change(textarea, { target: { value: '"A\\r\\nB\\rC 😃"' } });
  fireEvent.click(save(dialog));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(changeInstanceContent).toHaveBeenLastCalledWith(
    ENDPOINT,
    INSTANCE.id,
    { kind: 'user-data', text: 'A\r\nB\rC 😃' },
    expect.any(AbortSignal),
  );

  vi.mocked(getInstanceUserData).mockResolvedValueOnce({ kind: 'text', text: 'A\r\nB\rC 😃' });
  dialog = await open();
  textarea = await loadedField(dialog);
  expect(textarea).toHaveValue('"A\\r\\nB\\rC 😃"');
  expect(save(dialog)).toBeDisabled();
  fireEvent.change(textarea, { target: { value: ' "A\\r\\nB\\rC 😃" ' } });
  expect(save(dialog)).toBeDisabled();
  fireEvent.change(textarea, { target: { value: '' } });
  fireEvent.click(save(dialog));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(changeInstanceContent).toHaveBeenLastCalledWith(
    ENDPOINT,
    INSTANCE.id,
    { kind: 'user-data', text: '' },
    expect.any(AbortSignal),
  );
});
