import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';

import { RequestError, requestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { usePageSignal } from '../../../components/use-token-listing';
import { CREATE_TAGS, DELETE_TAGS, changeInstanceContent } from '../instance-content-api';
import { useInstanceContentChange } from '../instance-content-queries';
import { InstanceTagEditor } from './instance-tag-editor';

vi.mock('../instance-content-api', async (original) => ({
  ...(await original<typeof import('../instance-content-api')>()),
  changeInstanceContent: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8362';
const ID = 'i-tags';
const TAG = { key: 'Name', value: 'dev' };
const TAGS = [TAG, { key: 'env', value: 'test' }];

const PAGE = createWrapper(document.body);

function Editor() {
  const writes = useInstanceContentChange(ENGINE, ID, usePageSignal());
  return <InstanceTagEditor endpoint={ENGINE} tags={TAGS} writes={writes} />;
}

function showTags() {
  vi.resetAllMocks();
  vi.mocked(changeInstanceContent).mockResolvedValue(undefined);
  const show = vi.fn<(items: FlashResult) => void>();
  function Fixture() {
    const root = useRef<HTMLDivElement>(null);
    const [flash, setFlash] = useState<FlashResult>();
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider
          value={{
            show: (items) => {
              show(items);
              setFlash(items);
            },
            handOver: vi.fn(),
          }}
        >
          <div ref={root}>
            <Flashbar items={flash ?? []} />
            <Editor />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Fixture />
    </QueryClientProvider>,
  );
  return show;
}

function action(name: string) {
  const table = PAGE.findTable();
  const button =
    name === 'Add tag'
      ? table?.findHeaderSlot()?.findButton()
      : table?.findBodyCell(1, 1)?.findAllButtons()[name === 'Edit tag' ? 0 : 1];
  if (button == null) throw new Error(`Missing tag action ${name}`);
  expect(button.getElement()).toHaveAccessibleName(name === 'Add tag' ? name : `${name} ${TAG.key}`);
  return button.getElement();
}

async function open(name: string) {
  fireEvent.click(action(name));
  return waitFor(() => {
    const modal = PAGE.findModal();
    expect(modal?.findHeader().getElement()).toHaveTextContent(name);
    if (modal === null) throw new Error('Missing tag dialog');
    return modal.getElement();
  });
}

function field(dialog: HTMLElement, label: string) {
  const forms = createWrapper(dialog).findAllFormFields();
  const input = forms[label === 'Key' ? 0 : 1]?.findControl()?.findInput()?.findNativeInput().getElement();
  if (input === undefined || input === null) throw new Error(`Missing input ${label}`);
  return input;
}

function enter(dialog: HTMLElement, label: string, value: string) {
  fireEvent.change(field(dialog, label), { target: { value } });
}

function save(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: 'Save changes' });
}

function submit(dialog: HTMLElement, name: string) {
  if (name === 'Delete tag') {
    const input = createWrapper(dialog).findInput()?.findNativeInput().getElement();
    if (!input) throw new Error('Missing delete confirmation');
    fireEvent.change(input, { target: { value: 'delete' } });
  }
  fireEvent.click(within(dialog).getByRole('button', { name: name === 'Delete tag' ? name : 'Save changes' }));
}

function deny(operation: string, code: string, message: string, status: number) {
  vi.mocked(changeInstanceContent).mockRejectedValueOnce(
    new RequestError(
      requestFailure(operation, { Code: code, message, $fault: 'client', $metadata: { httpStatusCode: status } }),
    ),
  );
}

it('saves the empty value for just the existing key', async () => {
  const show = showTags();
  const dialog = await open('Edit tag');
  expect(PAGE.findModal()?.findContent().getElement()).toHaveTextContent(TAG.key);
  expect(save(dialog)).toBeDisabled();
  enter(dialog, 'Value', 'changed');
  expect(save(dialog)).toBeEnabled();
  enter(dialog, 'Value', TAG.value);
  expect(save(dialog)).toBeDisabled();
  enter(dialog, 'Value', '');
  expect(save(dialog)).toBeEnabled();
  submit(dialog, 'Edit tag');
  await waitFor(() => expect(show).toHaveBeenCalledWith([{ type: 'success', content: 'Tag updated.' }]));
  expect(changeInstanceContent).toHaveBeenCalledExactlyOnceWith(
    ENGINE,
    ID,
    { kind: 'put-tag', tag: { key: TAG.key, value: '' } },
    expect.any(AbortSignal),
  );
});

it('cancels a deletion and leaves the key and value in the table', async () => {
  showTags();
  const dialog = await open('Delete tag');
  expect(PAGE.findModal()?.findContent().getElement()).toHaveTextContent(TAG.key);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(PAGE.findTable()?.findBodyCell(1, 1)?.getElement()).toHaveTextContent(TAG.key);
  expect(PAGE.findTable()?.findBodyCell(1, 2)?.getElement()).toHaveTextContent(TAG.value);
  expect(changeInstanceContent).not.toHaveBeenCalled();
});

it.each([
  ['Edit tag', CREATE_TAGS, 'InvalidParameterValue', 'This tag key is reserved.', 400],
  ['Delete tag', DELETE_TAGS, 'AccessDeniedException', 'The instance tag is protected.', 403],
])('shows the original refusal for %s', async (name, operation, code, message, status) => {
  const show = showTags();
  deny(operation, code, message, status);
  const dialog = await open(name);
  if (name === 'Edit tag') enter(dialog, 'Value', 'updated draft');
  submit(dialog, name);
  const alert = await within(dialog).findByRole('alert');
  expect(alert).toHaveTextContent(`${code}: ${message}`);
  if (name === 'Edit tag') expect(field(dialog, 'Value')).toHaveValue('updated draft');
  else expect(createWrapper(dialog).findInput()?.findNativeInput().getElement()).toHaveValue('delete');
  expect(show).toHaveBeenCalledTimes(1);
  expect(show).toHaveBeenCalledWith([
    expect.objectContaining({ type: 'error', content: expect.stringContaining(`${code}: ${message}`) }),
  ]);
  expect(PAGE.findFlashbar()?.findItemsByType('success') ?? []).toHaveLength(0);
});

it.each([
  ['Add tag', CREATE_TAGS],
  ['Edit tag', CREATE_TAGS],
  ['Delete tag', DELETE_TAGS],
])('keeps %s unavailable after a 501 from %s', async (name, operation) => {
  const show = showTags();
  deny(operation, 'NotImplemented', 'Tag operation unavailable.', 501);
  const dialog = await open(name);
  if (name === 'Add tag') enter(dialog, 'Key', 'new-key');
  if (name === 'Edit tag') enter(dialog, 'Value', 'updated draft');
  submit(dialog, name);
  await waitFor(() => {
    const flash = PAGE.findFlashbar()?.findItemsByType('info')[0];
    expect(flash?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
    expect(flash?.findContent()?.getElement()).toHaveTextContent(
      `${name}. The emulator answered 501 Not Implemented for ${operation}. Tag operation unavailable.`,
    );
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(action(name)).toBeVisible();
  expect(action(name)).toHaveAttribute('aria-disabled', 'true');
  expect(show).toHaveBeenCalledTimes(1);
  expect(show).toHaveBeenCalledWith([expect.objectContaining({ type: 'info' })]);
});

it('keeps an existing key out of Add and preserves the draft while the key is corrected', async () => {
  const show = showTags();
  const dialog = await open('Add tag');
  enter(dialog, 'Key', TAG.key);
  expect(createWrapper(dialog).findFormField()?.findError()?.getElement()).toHaveTextContent(
    'This key already exists. Use Edit tag in its row to change the value.',
  );
  expect(save(dialog)).toBeDisabled();
  fireEvent.click(save(dialog));
  expect(changeInstanceContent).not.toHaveBeenCalled();

  deny(CREATE_TAGS, 'InvalidParameterValue', 'This tag key is reserved.', 400);
  enter(dialog, 'Key', 'aws:probe');
  enter(dialog, 'Value', 'draft');
  fireEvent.click(save(dialog));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'InvalidParameterValue: This tag key is reserved.',
  );
  expect(field(dialog, 'Key')).toHaveValue('aws:probe');
  expect(field(dialog, 'Value')).toHaveValue('draft');
  enter(dialog, 'Key', 'purpose');
  fireEvent.click(save(dialog));
  await waitFor(() => expect(show).toHaveBeenLastCalledWith([{ type: 'success', content: 'Tag added.' }]));
  expect(changeInstanceContent).toHaveBeenLastCalledWith(
    ENGINE,
    ID,
    { kind: 'put-tag', tag: { key: 'purpose', value: 'draft' } },
    expect.any(AbortSignal),
  );
});
