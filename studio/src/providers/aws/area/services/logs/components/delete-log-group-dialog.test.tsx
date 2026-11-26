import { act, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import {
  aws,
  modal as openModal,
  modalInput,
  modalButton,
  modalAlert,
  expectModalBox,
  expectModalAlert,
} from '../logs-test-utils.test';
import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteLogGroup } from '../group-delete-api';
import { DeleteLogGroupDialog } from './delete-log-group-dialog';

vi.mock('../group-delete-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../group-delete-api')>()),
  deleteLogGroup: vi.fn(),
}));

const remove = vi.mocked(deleteLogGroup);
const endpoint = 'http://127.0.0.1:8308';
const name = '/app#Cold';

beforeEach(() => remove.mockReset());

function renderDialog(protectedFromDeletion = false) {
  const deleted = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          {open && (
            <DeleteLogGroupDialog
              endpoint={endpoint}
              name={name}
              protectedFromDeletion={protectedFromDeletion}
              unavailable={unavailable}
              onUnavailable={() => setUnavailable(true)}
              onDeleted={deleted}
              onDismiss={() => setOpen(false)}
            />
          )}
        </div>
      </AreaRootContext.Provider>
    );
  }

  render(<Area />);
  return deleted;
}

async function controls() {
  const dialog = await openModal(`Delete log group ${name}?`);
  return {
    dialog,
    field: modalInput(dialog, "To confirm, type the log group's name."),
    action: modalButton(dialog, 'Delete'),
    cancel: modalButton(dialog, 'Cancel'),
  };
}

function type(field: HTMLElement, value = name) {
  fireEvent.change(field, { target: { value } });
}

it('names the group, describes the deletion and requires its exact name', async () => {
  renderDialog();
  const { dialog, field, action } = await controls();
  expectModalBox(dialog, 'Its log streams and log events are removed from your local emulator. This cannot be undone.');
  expect(action).toBeDisabled();
  type(field, name.toLowerCase());
  expect(action).toBeDisabled();
  type(field);
  expect(action).toBeEnabled();
  expect(remove).not.toHaveBeenCalled();
});

it('explains deletion protection and lets Cancel close without a request', async () => {
  renderDialog(true);
  const { dialog, field, action, cancel } = await controls();
  const warning = modalAlert(dialog)?.findContent().getElement();
  expect(warning).toBeVisible();
  expect(warning).toHaveTextContent('Deletion protection is on. Turn it off before deleting this log group.');
  type(field);
  expect(action).toBeDisabled();
  fireEvent.click(cancel);
  expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
});

it('keeps the typed name and shows a refusal in the open dialog', async () => {
  remove.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: 'DeleteLogGroup',
      code: 'InvalidParameterException',
      message: 'LogGroup has delete protection enabled.',
    }),
  );
  const deleted = renderDialog();
  const { dialog, field, action } = await controls();
  type(field);
  fireEvent.click(action);
  await expectModalAlert(dialog, 'DeleteLogGroup failed');
  expect(modalAlert(dialog)?.findContent().getElement()).toHaveTextContent('LogGroup has delete protection enabled.');
  expect(field).toHaveValue(name);
  expect(action).toBeEnabled();
  expect(deleted).not.toHaveBeenCalled();
});

it('blocks the buttons until the delete answers', async () => {
  let finish!: () => void;
  remove.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const deleted = renderDialog();
  const { field, action, cancel } = await controls();
  type(field);
  fireEvent.click(action);
  expect(action).toBeDisabled();
  expect(cancel).toBeDisabled();
  fireEvent.click(action);
  fireEvent.click(cancel);
  expect(aws().findModal()?.getElement()).toBeVisible();
  expect(remove).toHaveBeenCalledExactlyOnceWith(endpoint, name, expect.any(AbortSignal));
  expect(deleted).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(deleted).toHaveBeenCalledExactlyOnceWith(name);
});
