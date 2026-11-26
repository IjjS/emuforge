import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assert, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteResource } from '../rest-change-api';
import { DeleteResourceDialog } from './delete-resource-dialog';

vi.mock('../rest-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const operation = 'DeleteResource';

async function open() {
  const root = { current: null };
  const user = userEvent.setup();
  const onDeleted = vi.fn();
  render(
    <AreaRootContext value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <DeleteResourceDialog
            endpoint={endpoint}
            apiId="api-1"
            resourceId="orders"
            path="/orders"
            onDeleted={onDeleted}
            onDismiss={vi.fn()}
          />
        </QueryClientProvider>
      </div>
    </AreaRootContext>,
  );
  const modal = await waitFor(() => {
    const modal = createWrapper(document.body).findModal();
    assert(modal);
    return modal;
  });
  expect(modal.findHeader().getElement()).toHaveTextContent('Delete resource /orders?');
  const content = modal.findContent();
  const input = content.findFormField()?.findControl()?.findInput()?.findNativeInput();
  const footer = modal.findFooter();
  assert(input && footer);
  return {
    user,
    onDeleted,
    content,
    input: input.getElement(),
    submit: within(footer.getElement()).getByRole('button', { name: 'Delete' }),
  };
}

it('explains the deletion and enables it only on an exact confirmation', async () => {
  const { content, input, submit, user } = await open();
  expect(content.getElement()).toHaveTextContent(
    'This also removes the resources and methods below it. It cannot be undone.',
  );
  expect(submit).toBeDisabled();
  await user.type(input, '/ORDERS');
  expect(submit).toBeDisabled();
  await user.clear(input);
  await user.type(input, '/orders');
  expect(submit).toBeEnabled();
});

it.each<[RequestFailure, string]>([
  [{ operation, kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ operation, kind: 'access-denied', message: 'Policy denies this action.' }, 'Policy denies this action.'],
  [{ operation, kind: 'other', code: 'NotFoundException', message: 'It is gone.' }, 'It is gone.'],
  [{ operation, kind: 'emulator-did-not-answer', message: 'Timed out.' }, 'Timed out.'],
  [{ operation, kind: 'engine-did-not-answer' }, 'did not answer'],
])('keeps the dialog and the confirmation on a failed delete (%j)', async (failure, message) => {
  vi.mocked(deleteResource).mockRejectedValueOnce(new RequestError(failure));
  const { content, input, submit, user, onDeleted } = await open();
  await user.type(input, '/orders');
  await user.click(submit);
  await waitFor(() => {
    const alert = content.findAlert()?.getElement();
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent(operation);
  });
  expect(input).toHaveValue('/orders');
  expect(onDeleted).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') expect(submit).toBeDisabled();
  else expect(submit).toBeEnabled();
});
