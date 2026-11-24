import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';

import { RequestError, requestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { CREATE_TAGS, DELETE_TAGS, changeInstanceContent } from '../instance-content-api';
import { InstanceTagEditor } from './instance-tag-editor';

vi.mock('../instance-content-api', async (original) => ({
  ...(await original<typeof import('../instance-content-api')>()),
  changeInstanceContent: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8362';
const ID = 'i-tags';
const TAG = { key: 'Name', value: 'dev' };
const TAGS = [TAG, { key: 'env', value: 'test' }];

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
            <InstanceTagEditor id={ID} endpoint={ENGINE} tags={TAGS} />
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
  if (name === 'Add tag') return screen.getByRole('button', { name });
  return within(screen.getByRole('row', { name: /^Name / })).getByRole('button', { name });
}

async function open(name: string) {
  fireEvent.click(action(name));
  return screen.findByRole('dialog', { name });
}

function enter(dialog: HTMLElement, label: string, value: string) {
  const input = createWrapper(dialog)
    .findAllFormFields()
    .find((field) => field.findLabel()?.getElement().textContent === label)
    ?.findControl()
    ?.findInput()
    ?.findNativeInput()
    .getElement();
  if (input === undefined || input === null) throw new Error(`Missing input ${label}`);
  fireEvent.change(input, { target: { value } });
}

function submit(dialog: HTMLElement, name: string) {
  if (name === 'Delete tag') {
    const input = createWrapper(dialog).findInput()?.findNativeInput().getElement();
    if (!input) throw new Error('Missing delete confirmation');
    fireEvent.change(input, { target: { value: 'delete' } });
  }
  if (name === 'Add tag') enter(dialog, 'Key', TAG.key);
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
  expect(within(dialog).getByText(TAG.key)).toBeVisible();
  enter(dialog, 'Value', '');
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
  expect(within(dialog).getByText(TAG.key)).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('row', { name: /^Name dev / })).toBeVisible();
  expect(changeInstanceContent).not.toHaveBeenCalled();
});

it.each([
  ['Edit tag', CREATE_TAGS, 'InvalidParameterValue', 'This tag key is reserved.', 400],
  ['Delete tag', DELETE_TAGS, 'AccessDeniedException', 'The instance tag is protected.', 403],
])('shows the original refusal for %s', async (name, operation, code, message, status) => {
  const show = showTags();
  deny(operation, code, message, status);
  submit(await open(name), name);
  expect(await screen.findByText(new RegExp(`${code}: ${message}`))).toBeVisible();
  expect(show).toHaveBeenCalledTimes(1);
  expect(show).toHaveBeenCalledWith([expect.objectContaining({ type: 'error' })]);
});

it.each([
  ['Add tag', CREATE_TAGS],
  ['Edit tag', CREATE_TAGS],
  ['Delete tag', DELETE_TAGS],
])('keeps %s unavailable after a 501 from %s', async (name, operation) => {
  const show = showTags();
  deny(operation, 'NotImplemented', 'Tag operation unavailable.', 501);
  submit(await open(name), name);
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(
    screen.getByText(`${name}. The emulator answered 501 Not Implemented for ${operation}. Tag operation unavailable.`),
  ).toBeVisible();
  expect(action(name)).toBeVisible();
  expect(action(name)).toHaveAttribute('aria-disabled', 'true');
  expect(show).toHaveBeenCalledTimes(1);
  expect(show).toHaveBeenCalledWith([expect.objectContaining({ type: 'info' })]);
});
