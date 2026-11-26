import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { updateV2Api } from '../v2-route-change-api';
import { EditV2ApiDialog } from './edit-v2-api-dialog';

vi.mock('../v2-route-change-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const operation = 'UpdateApi';
const current = { name: 'Orders', description: 'Old description' };

async function open() {
  const root = { current: null };
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(
    <AreaRootContext value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <EditV2ApiDialog apiId="api-1" endpoint={endpoint} current={current} onSaved={onSaved} onDismiss={vi.fn()} />
        </QueryClientProvider>
      </div>
    </AreaRootContext>,
  );
  const ui = createWrapper(document.body);
  const modal = await waitFor(() => {
    const dialog = ui.findModal();
    if (!dialog?.isVisible()) throw new Error('Dialog is not visible');
    return dialog;
  });
  const footer = modal.findFooter();
  const save = footer && createWrapper(footer.getElement()).findAllButtons()[1]?.getElement();
  if (!save) throw new Error('Missing Save button');
  expect(save).toHaveTextContent('Save');
  expect(modal.findHeader().getElement()).toHaveTextContent('Edit API');
  const [nameField, descriptionField] = createWrapper(modal.findContent().getElement()).findAllFormFields();
  if (!nameField || !descriptionField) throw new Error('Missing API edit fields');
  const name = createWrapper(nameField.getElement()).findInput();
  const description = createWrapper(descriptionField.getElement()).findTextarea();
  if (!name || !description) throw new Error('Missing API edit controls');
  return {
    modal,
    user,
    onSaved,
    nameField,
    name: name.findNativeInput().getElement(),
    description: description.findNativeTextarea().getElement(),
    save,
  };
}

it('fills the current fields, gives the name rule and disables an unchanged save', async () => {
  const { nameField, name, description, save } = await open();
  expect(name).toHaveValue(current.name);
  expect(description).toHaveValue(current.description);
  expect(nameField.findConstraint()?.getElement()).toHaveTextContent('1 to 128 characters.');
  expect(save).toBeDisabled();
});

it.each<[RequestFailure, string]>([
  [{ operation, kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ operation, kind: 'access-denied', message: 'Policy denies this action.' }, 'Policy denies this action.'],
  [{ operation, kind: 'other', code: 'BadRequestException', message: 'Name refused.' }, 'Name refused.'],
  [{ operation, kind: 'emulator-did-not-answer', message: 'Timed out.' }, 'Timed out.'],
  [{ operation, kind: 'engine-did-not-answer' }, 'did not answer'],
])('keeps the dialog and fields on a rejected save (%j)', async (failure, message) => {
  vi.mocked(updateV2Api).mockRejectedValueOnce(new RequestError(failure));
  const { modal, user, name, description, save, onSaved } = await open();
  await user.clear(name);
  await user.type(name, 'New orders');
  await user.click(save);
  await waitFor(() => {
    const alert = createWrapper(modal.findContent().getElement()).findAlert()?.getElement();
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveTextContent(operation);
  });
  expect(name).toHaveValue('New orders');
  expect(description).toHaveValue(current.description);
  expect(onSaved).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') expect(save).toBeDisabled();
  else expect(save).toBeEnabled();
});
