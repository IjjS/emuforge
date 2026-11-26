import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { readRestResources } from '../rest-api';
import { createResource } from '../rest-change-api';
import { CreateResourceDialog } from './create-resource-dialog';

vi.mock('../rest-api', { spy: true });
vi.mock('../rest-change-api', { spy: true });

const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connected: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const disconnected: AreaConnection = {
  engineOrigin,
  result: {
    kind: 'emulator-unreachable',
    checkedAt: 1,
    reason: 'not_started',
    message: 'Emulator is stopped.',
    emulator: { port: 9682, endpoint },
  },
};
const rootResource = { id: 'root', path: '/' };
const orders = { id: 'orders', path: '/orders' };
const read = vi.mocked(readRestResources);
const create = vi.mocked(createResource);

beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue({ items: [rootResource, orders] });
});

async function open(connection = connected) {
  const root = { current: null };
  const user = userEvent.setup();
  const onCreated = vi.fn();
  render(
    <MemoryRouter>
      <AreaRootContext value={root}>
        <div ref={root}>
          <QueryClientProvider client={new QueryClient()}>
            <CreateResourceDialog
              apiId="api-1"
              root={rootResource}
              connection={connection}
              onCreated={onCreated}
              onDismiss={vi.fn()}
            />
          </QueryClientProvider>
        </div>
      </AreaRootContext>
    </MemoryRouter>,
  );
  const modal = await screen.findByRole('dialog', { name: 'Create resource' });
  const dialog = within(modal);
  const select = createWrapper(modal).findSelect();
  if (!select) throw new Error('Missing parent choice');
  return {
    user,
    onCreated,
    dialog,
    select,
    input: dialog.getByRole('textbox', { name: 'Path part' }),
    submit: dialog.getByRole('button', { name: 'Create resource' }),
  };
}

it('shows the path rule and root, then reads the parent options by ID when opened', async () => {
  const { user, select, dialog } = await open();
  expect(select.findTrigger().getElement()).toHaveTextContent('/');
  expect(dialog.getByText(/Use letters, digits, periods/)).toBeVisible();
  expect(read).not.toHaveBeenCalled();
  await user.click(select.findTrigger().getElement());
  await waitFor(() => {
    expect(select.findDropdown().findOptionByValue('root')?.getElement()).toHaveTextContent('/ID root');
    expect(select.findDropdown().findOptionByValue('orders')?.getElement()).toHaveTextContent('/ordersID orders');
  });
  expect(read).toHaveBeenCalledWith(engineOrigin, 'api-1', undefined, expect.any(AbortSignal));
});

it('loads another page and creates under the parent from that page', async () => {
  read.mockResolvedValueOnce({ items: [rootResource], next: 'position-2' }).mockResolvedValueOnce({ items: [orders] });
  create.mockResolvedValueOnce({ path: '/orders/child', $metadata: {} });
  const { user, select, input, submit, onCreated } = await open();
  await user.click(select.findTrigger().getElement());
  const dropdown = select.findDropdown();
  await user.click(await within(dropdown.getElement()).findByRole('button', { name: 'Load more' }));
  const option = await waitFor(() => {
    const option = dropdown.findOptionByValue('orders');
    if (!option) throw new Error('Missing parent from the second page');
    return option;
  });
  await user.click(option.getElement());
  expect(read).toHaveBeenNthCalledWith(2, engineOrigin, 'api-1', 'position-2', expect.any(AbortSignal));
  await user.type(input, 'child');
  await user.click(submit);
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/orders/child'));
  expect(create).toHaveBeenCalledWith(engineOrigin, 'api-1', 'orders', 'child', expect.any(AbortSignal));
});

it.each<[RequestFailure, AreaConnection, string]>([
  [
    { kind: 'not-implemented', operation: 'GetResources' },
    connected,
    'The emulator answered 501 Not Implemented for GetResources, so Studio cannot show the resources.',
  ],
  [
    { kind: 'other', operation: 'GetResources', code: 'Refused', message: 'The read was refused.' },
    disconnected,
    'GetResources: Refused: The read was refused.',
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetResources', message: 'Timed out.' },
    connected,
    'GetResources got no answer from the emulator. Timed out.',
  ],
  [{ kind: 'engine-did-not-answer', operation: 'GetResources' }, connected, 'GetResources got no answer.'],
])('shows and retries a failed parent choice read in the dialog (%j)', async (failure, connection, message) => {
  read.mockRejectedValueOnce(new RequestError(failure));
  const { user, select, dialog } = await open(connection);
  await user.click(select.findTrigger().getElement());
  expect(await dialog.findByText(message, { exact: false })).toBeInTheDocument();
  if (failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') {
    const expected =
      failure.kind === 'engine-did-not-answer'
        ? `The EmuForge engine at ${engineOrigin} is not answering`
        : `Not answering at ${endpoint}`;
    expect(
      dialog.getByText(
        (_, element) =>
          element?.textContent === expected && ![...element.children].some((child) => child.textContent === expected),
      ),
    ).toBeVisible();
    expect(dialog.getByRole('link', { name: 'Connection status' })).toBeVisible();
  }
  const retry = dialog
    .getAllByRole('button', { name: 'Retry' })
    .find((button) => !select.findDropdown().getElement().contains(button));
  if (!retry) throw new Error('Missing retry below the choice');
  await user.click(retry);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(dialog.queryByText(message, { exact: false })).not.toBeInTheDocument());
});

const operation = 'CreateResource';
it.each<[RequestFailure, string]>([
  [{ operation, kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ operation, kind: 'access-denied', message: 'Policy denies this action.' }, 'Policy denies this action.'],
  [{ operation, kind: 'other', code: 'ConflictException', message: 'A sibling exists.' }, 'A sibling exists.'],
  [{ operation, kind: 'emulator-did-not-answer', message: 'Timed out.' }, 'Timed out.'],
  [{ operation, kind: 'engine-did-not-answer' }, 'did not answer'],
])('keeps the dialog and fields on a failed creation (%j)', async (failure, message) => {
  create.mockRejectedValueOnce(new RequestError(failure));
  const { dialog, user, input, select, submit, onCreated } = await open();
  await user.type(input, 'child');
  await user.click(submit);
  expect(await dialog.findByRole('alert')).toHaveTextContent(message);
  expect(dialog.getByRole('alert')).toHaveTextContent(operation);
  expect(input).toHaveValue('child');
  expect(select.findTrigger().getElement()).toHaveTextContent('/');
  expect(onCreated).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') expect(submit).toBeDisabled();
  else expect(submit).toBeEnabled();
});
