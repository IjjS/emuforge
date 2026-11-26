import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import { readRestApi } from '../rest-api';
import { updateRestApi } from '../rest-change-api';
import { refreshRestApi, useRestApi } from '../rest-queries';
import { creationDateText } from '../../../components/format-date';
import { RestDetails } from './rest-details';

vi.mock('../rest-api', { spy: true });
vi.mock('../rest-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';

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
  expect(screen.getByText(api.name)).toBeInTheDocument();
  expect(screen.getByText(api.id)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy ID' })).toBeEnabled();
  expect(screen.getByText(api.description)).toBeInTheDocument();
  for (const value of ['Regional, Private', creationDateText(api.createdDate)]) {
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === value && ![...element.children].some((child) => child.textContent === value),
      ),
    ).toBeInTheDocument();
  }

  rerender(
    <RestDetails
      api={{ name: api.name, createdDate: api.createdDate, endpointConfiguration: { types: ['PRIVATE'] } }}
      apiId="api-1"
      endpoint={endpoint}
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.queryByText(api.description)).not.toBeInTheDocument();
  expect(screen.getByText('-')).toBeInTheDocument();
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
          <DetailsWithRead />
        </div>
      </AreaRootContext>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  const edit = within(await screen.findByRole('dialog', { name: 'Edit API' }));
  for (const [field, text] of [
    ['Name', saved.name],
    ['Description', saved.description],
  ] as const) {
    const input = edit.getByRole('textbox', { name: field });
    await user.clear(input);
    await user.type(input, text);
  }
  return { save: () => user.click(edit.getByRole('button', { name: 'Save' })), client };
}

function expectSaved() {
  expect(screen.queryByRole('dialog', { name: 'Edit API' })).not.toBeInTheDocument();
  expect(screen.getByText(saved.name)).toBeVisible();
  expect(screen.getByText(saved.description)).toBeVisible();
  expect(
    screen.getByText('updated.', { exact: false }).closest('[role="status"]') ??
      screen.getByText('updated.', { exact: false }),
  ).toBeVisible();
}

it('closes the edit and shows the flash and new fields from the refreshed API', async () => {
  const { save } = await openEdit();
  reader.mockResolvedValueOnce(saved);
  await save();
  await waitFor(expectSaved);
  expect(reader).toHaveBeenCalledTimes(2);
});

it('keeps the new fields and flash when a read started before the save answers last', async () => {
  const { client, save } = await openEdit();
  let answerEarlier!: (value: typeof beforeEdit) => void;
  const earlier = new Promise<typeof beforeEdit>((resolve) => {
    answerEarlier = resolve;
  });
  reader.mockReturnValueOnce(earlier).mockResolvedValueOnce(saved);
  act(() => {
    void refreshRestApi(client, 'api-1');
  });
  await waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
  await save();
  await waitFor(expectSaved);
  expect(reader).toHaveBeenCalledTimes(3);
  expect(reader.mock.calls[1]?.[2].aborted).toBe(true);
  await act(async () => answerEarlier(beforeEdit));
  expectSaved();
  expect(screen.queryByText(beforeEdit.name)).not.toBeInTheDocument();
});
