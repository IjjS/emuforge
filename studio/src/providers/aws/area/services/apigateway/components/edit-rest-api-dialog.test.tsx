import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { updateRestApi } from '../rest-change-api';
import { EditRestApiDialog } from './edit-rest-api-dialog';

vi.mock('../rest-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const operation = 'UpdateRestApi';
const current = { name: 'Orders', description: 'Old description' };

async function open() {
  const root = { current: null };
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(
    <AreaRootContext value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <EditRestApiDialog
            apiId="api-1"
            endpoint={endpoint}
            current={current}
            onSaved={onSaved}
            onDismiss={vi.fn()}
          />
        </QueryClientProvider>
      </div>
    </AreaRootContext>,
  );
  const dialog = within(await screen.findByRole('dialog', { name: 'Edit API' }));
  return {
    dialog,
    user,
    onSaved,
    name: dialog.getByRole('textbox', { name: 'Name' }),
    description: dialog.getByRole('textbox', { name: 'Description' }),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
}

it('fills the current fields, gives the name rule and disables an unchanged save', async () => {
  const { dialog, name, description, save } = await open();
  expect(name).toHaveValue(current.name);
  expect(description).toHaveValue(current.description);
  expect(dialog.getByText('1 to 512 characters.')).toBeVisible();
  expect(save).toBeDisabled();
});

it.each<[RequestFailure, string]>([
  [{ operation, kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ operation, kind: 'access-denied', message: 'Policy denies this action.' }, 'Policy denies this action.'],
  [{ operation, kind: 'other', code: 'BadRequestException', message: 'Name refused.' }, 'Name refused.'],
  [{ operation, kind: 'emulator-did-not-answer', message: 'Timed out.' }, 'Timed out.'],
  [{ operation, kind: 'engine-did-not-answer' }, 'did not answer'],
])('keeps the dialog and fields on a rejected save (%j)', async (failure, message) => {
  vi.mocked(updateRestApi).mockRejectedValueOnce(new RequestError(failure));
  const { dialog, user, name, description, save, onSaved } = await open();
  await user.clear(name);
  await user.type(name, 'New orders');
  await user.click(save);
  expect(await dialog.findByRole('alert')).toHaveTextContent(message);
  expect(dialog.getByRole('alert')).toHaveTextContent(operation);
  expect(name).toHaveValue('New orders');
  expect(description).toHaveValue(current.description);
  expect(onSaved).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') expect(save).toBeDisabled();
  else expect(save).toBeEnabled();
});
