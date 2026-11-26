import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { assert, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import { readRestApi } from '../rest-api';
import { updateRestApi } from '../rest-change-api';
import { refreshRestApi, useRestApi } from '../rest-queries';
import { RestDetails } from './rest-details';

vi.mock('../rest-api', { spy: true });
vi.mock('../rest-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';

const page = createWrapper(document.body);

function detail(label: string) {
  const item = page
    .findKeyValuePairs()
    ?.findItems()
    .find((item) => item.findLabel()?.getElement().textContent === label);
  const value = item?.findValue()?.getElement();
  assert(value);
  return value;
}

it('shows the name, copyable ID, description, endpoint types and creation time', () => {
  const api = {
    id: 'api-1',
    name: 'Orders',
    description: 'Order records',
    endpointConfiguration: { types: ['REGIONAL', 'PRIVATE'] as const },
    createdDate: new Date('2026-11-26T12:00:00Z'),
  };
  const { rerender } = render(
    <RestDetails
      api={{ ...api, endpointConfiguration: { types: [...api.endpointConfiguration.types] } }}
      apiId="api-1"
      endpoint={endpoint}
      onRefresh={vi.fn()}
    />,
  );
  expect(detail('Name')).toHaveTextContent(api.name);
  expect(detail('ID')).toHaveTextContent(api.id);
  const copy = createWrapper(detail('ID')).findCopyToClipboard()?.findCopyButton().getElement();
  expect(copy).toBeEnabled();
  expect(copy).toHaveAccessibleName('Copy ID');
  expect(detail('Description')).toHaveTextContent(api.description);
  expect(detail('Endpoint type')).toHaveTextContent('Regional, Private');
  expect(detail('Creation time')).toHaveTextContent(creationDateText(api.createdDate));

  rerender(
    <RestDetails
      api={{ name: api.name, createdDate: api.createdDate, endpointConfiguration: { types: ['PRIVATE'] } }}
      apiId="api-1"
      endpoint={endpoint}
      onRefresh={vi.fn()}
    />,
  );
  expect(detail('Description')).toHaveTextContent(/^-$/);
});

const beforeEdit = { name: 'Orders', description: 'Original orders' };
const saved = { name: 'New orders', description: 'Current orders' };
const reader = vi.mocked(readRestApi);

function DetailsWithRead() {
  const api = useRestApi('api-1', endpoint);
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/rest/api-1', 0, true);
  return (
    <PageFlashContext value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      {api.data && <RestDetails api={api.data} apiId="api-1" endpoint={endpoint} onRefresh={() => {}} />}
    </PageFlashContext>
  );
}

async function openEdit() {
  const client = new QueryClient();
  const root = { current: null };
  const user = userEvent.setup();
  reader.mockReset().mockResolvedValueOnce(beforeEdit);
  vi.mocked(updateRestApi).mockResolvedValueOnce({ ...saved, $metadata: {} });
  render(
    <QueryClientProvider client={client}>
      <AreaRootContext value={root}>
        <div ref={root}>
          <MemoryRouter>
            <DetailsWithRead />
          </MemoryRouter>
        </div>
      </AreaRootContext>
    </QueryClientProvider>,
  );
  const edit = await waitFor(() => {
    const button = page.findHeader()?.findActions()?.findAllButtons()[1]?.getElement();
    assert(button);
    expect(button).toHaveTextContent('Edit');
    return button;
  });
  await user.click(edit);
  const modal = await waitFor(() => {
    const modal = page.findModal();
    assert(modal);
    return modal;
  });
  expect(modal.findHeader().getElement()).toHaveTextContent('Edit API');
  const [nameField, descriptionField] = modal.findContent().findAllFormFields();
  const name = nameField?.findControl()?.findInput()?.findNativeInput();
  const description = descriptionField?.findControl()?.findTextarea()?.findNativeTextarea();
  const footer = modal.findFooter();
  const save = footer?.findAllButtons().at(-1)?.getElement();
  assert(name && description && save);
  expect(save).toHaveTextContent('Save');
  for (const [input, text] of [
    [name.getElement(), saved.name],
    [description.getElement(), saved.description],
  ] as const) {
    await user.clear(input);
    await user.type(input, text);
  }
  return { save: () => user.click(save), client };
}

function expectSaveResult() {
  expect(page.findModal()).toBeNull();
  const flash = page.findFlashbar()?.findItemsByType('success')[0]?.getElement();
  expect(flash).toBeVisible();
  expect(flash).toHaveTextContent(`API ${saved.name} updated.`);
}

function expectSaved() {
  expectSaveResult();
  expect(detail('Name')).toHaveTextContent(saved.name);
  expect(detail('Description')).toHaveTextContent(saved.description);
}

it('closes the edit and shows the flash and new fields from the refreshed API', async () => {
  const { save } = await openEdit();
  const feedbackAtRead = vi.fn();
  reader.mockImplementationOnce(async () => {
    const flash = page.findFlashbar()?.findItemsByType('success')[0]?.getElement();
    const flashVisible = flash?.isConnected === true && getComputedStyle(flash).visibility === 'visible';
    feedbackAtRead(flash?.textContent, flashVisible, Boolean(page.findModal()?.isVisible()));
    return saved;
  });
  await save();
  await waitFor(expectSaved);
  expect(reader).toHaveBeenCalledTimes(2);
  expect(feedbackAtRead).toHaveBeenCalledExactlyOnceWith(`API ${saved.name} updated.`, true, false);
});

function deferred() {
  let answer!: (value: typeof beforeEdit) => void;
  const promise = new Promise<typeof beforeEdit>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

it.each(['earlier read first', 'save read first'])('keeps the new fields and flash when %s answers', async (order) => {
  const { client, save } = await openEdit();
  const earlier = deferred();
  const afterSave = deferred();
  reader.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(afterSave.promise);
  act(() => {
    void refreshRestApi(client, 'api-1');
  });
  await waitFor(() => expect(reader).toHaveBeenCalledTimes(2));

  await save();
  await waitFor(() => expect(reader).toHaveBeenCalledTimes(3));
  expect(reader.mock.calls[1]?.[2].aborted).toBe(true);

  if (order === 'earlier read first') {
    await act(async () => earlier.answer(beforeEdit));
    await act(async () => afterSave.answer(saved));
    await waitFor(expectSaved);
  } else {
    await act(async () => afterSave.answer(saved));
    await waitFor(expectSaved);
    await act(async () => earlier.answer(beforeEdit));
    expectSaved();
  }
});
