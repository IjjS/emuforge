import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteApi, type DeleteApiTarget } from '../api-delete-api';
import { DeleteApiDialog } from './delete-api-dialog';

vi.mock('../api-delete-api', async (original) => ({
  ...(await original<typeof import('../api-delete-api')>()),
  deleteApi: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:9681';
const rest = { id: 'api-1', kind: 'REST', name: 'Payroll API' } as const;
const http = { id: 'api-2', kind: 'HTTP', name: 'Events API' } as const;
const onDeleted = vi.fn();
const onDismiss = vi.fn();

beforeEach(() => vi.resetAllMocks());

function InArea({ api }: { api: DeleteApiTarget }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteApiDialog api={api} endpoint={endpoint} onDeleted={onDeleted} onDismiss={onDismiss} />
      </AreaRootContext>
    </div>
  );
}

async function open(api: DeleteApiTarget) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InArea api={api} />
    </QueryClientProvider>,
  );
  const modal = await waitFor(() => {
    const wrapper = createWrapper(document.body).findModal();
    assert(wrapper);
    return wrapper;
  });
  const field = modal.findContent().findFormField();
  const input = field?.findControl()?.findInput()?.findNativeInput();
  assert(input);
  const footer = modal.findFooter();
  assert(footer);
  const [cancel, confirm] = footer.findAllButtons().map((button) => button.getElement());
  assert(cancel);
  assert(confirm);
  expect(cancel).toHaveTextContent('Cancel');
  expect(confirm).toHaveTextContent('Delete');
  return {
    modal,
    input: input.getElement(),
    confirm,
    cancel,
    findAlert: () =>
      waitFor(() => {
        const alert = modal.findContent().findAlert();
        assert(alert);
        return alert.getElement();
      }),
  };
}

it('names the API and enables Delete only for the exact name', async () => {
  const { modal, input, confirm } = await open(rest);
  expect(modal.findHeader().getElement()).toHaveTextContent(`Delete API ${rest.name}?`);
  expect(modal.findContent().getElement()).toHaveTextContent(
    'This removes the API with its resources, methods, routes and stages from the local emulator. It cannot be undone.',
  );
  expect(confirm).toBeDisabled();
  for (const value of ['payroll API', 'Payroll API ', 'Payroll']) {
    fireEvent.change(input, { target: { value } });
    expect(confirm).toBeDisabled();
  }
  expect(deleteApi).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: rest.name } });
  expect(confirm).toBeEnabled();
});

it.each([
  [rest, 'DeleteRestApi'],
  [http, 'DeleteApi'],
] as const)('shows the name and reason of a refused %s deletion and retains the typed name', async (api, operation) => {
  vi.mocked(deleteApi).mockRejectedValue(
    new RequestError({ kind: 'other', operation, code: 'NotFoundException', message: 'Invalid API identifier.' }),
  );
  const { input, confirm, findAlert } = await open(api);
  fireEvent.change(input, { target: { value: api.name } });
  fireEvent.click(confirm);
  const alert = await findAlert();
  expect(alert).toHaveTextContent(operation);
  expect(alert).toHaveTextContent('NotFoundException');
  expect(alert).toHaveTextContent('Invalid API identifier.');
  expect(input).toHaveValue(api.name);
  expect(confirm).toBeEnabled();
  expect(onDeleted).not.toHaveBeenCalled();
});

it.each([
  [rest, 'DeleteRestApi'],
  [http, 'DeleteApi'],
] as const)('shows a 501 for %s and leaves Delete unavailable', async (api, operation) => {
  vi.mocked(deleteApi).mockRejectedValue(new RequestError({ kind: 'not-implemented', operation }));
  const { input, confirm, cancel, findAlert } = await open(api);
  fireEvent.change(input, { target: { value: api.name } });
  fireEvent.click(confirm);
  const alert = await findAlert();
  expect(alert).toHaveTextContent('Not implemented by the emulator');
  expect(alert).toHaveTextContent(operation);
  expect(confirm).toBeDisabled();
  expect(input).toHaveValue(api.name);
  expect(onDeleted).not.toHaveBeenCalled();
  fireEvent.click(cancel);
  expect(onDismiss).toHaveBeenCalledOnce();
});
