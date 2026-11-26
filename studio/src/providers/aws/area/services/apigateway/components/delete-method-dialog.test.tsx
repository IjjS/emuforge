import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteMethod } from '../rest-change-api';
import { DeleteMethodDialog } from './delete-method-dialog';

vi.mock('../rest-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const operation = 'DeleteMethod';

async function open() {
  const root = { current: null };
  const user = userEvent.setup();
  const onDeleted = vi.fn();
  render(
    <AreaRootContext value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <DeleteMethodDialog
            endpoint={endpoint}
            apiId="api-1"
            resourceId="orders"
            path="/orders"
            method="GET"
            onDeleted={onDeleted}
            onDismiss={vi.fn()}
          />
        </QueryClientProvider>
      </div>
    </AreaRootContext>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Delete method GET /orders?' });
  return {
    user,
    onDeleted,
    dialog,
    input: within(dialog).getByRole('textbox'),
    submit: within(dialog).getByRole('button', { name: 'Delete' }),
  };
}

it('explains the deletion and enables it only on an exact confirmation', async () => {
  const { dialog, input, submit, user } = await open();
  expect(within(dialog).getByText('It cannot be undone.')).toBeVisible();
  expect(submit).toBeDisabled();
  await user.type(input, 'DELETE');
  expect(submit).toBeDisabled();
  await user.clear(input);
  await user.type(input, 'delete');
  expect(submit).toBeEnabled();
});

it.each<[RequestFailure, string]>([
  [{ operation, kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ operation, kind: 'access-denied', message: 'Policy denies this action.' }, 'Policy denies this action.'],
  [{ operation, kind: 'other', code: 'NotFoundException', message: 'It is gone.' }, 'It is gone.'],
  [{ operation, kind: 'emulator-did-not-answer', message: 'Timed out.' }, 'Timed out.'],
  [{ operation, kind: 'engine-did-not-answer' }, 'did not answer'],
])('keeps the dialog and the confirmation on a failed delete (%j)', async (failure, message) => {
  vi.mocked(deleteMethod).mockRejectedValueOnce(new RequestError(failure));
  const { dialog, input, submit, user, onDeleted } = await open();
  await user.type(input, 'delete');
  await user.click(submit);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  expect(within(dialog).getByRole('alert')).toHaveTextContent(operation);
  expect(input).toHaveValue('delete');
  expect(onDeleted).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') expect(submit).toBeDisabled();
  else expect(submit).toBeEnabled();
});
