import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { DELETE_LOG_STREAM, deleteLogStream } from '../stream-change-api';
import { DeleteLogStreamDialog } from './delete-log-stream-dialog';

vi.mock('../stream-change-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-change-api')>()),
  deleteLogStream: vi.fn(),
}));

const remove = vi.mocked(deleteLogStream);
const name = 'a b/[$LATEST]';

beforeEach(() => remove.mockReset());

async function renderDialog() {
  const deleted = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          {open && (
            <DeleteLogStreamDialog
              endpoint="http://127.0.0.1:8310"
              group="/app#Group"
              name={name}
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
  const element = await screen.findByRole('dialog', { name: `Delete log stream ${name}?` });
  const dialog = within(element);
  return {
    dialog,
    field: dialog.getByRole('textbox', { name: "To confirm, type the log stream's name." }),
    action: dialog.getByRole('button', { name: 'Delete' }),
    deleted,
  };
}

it('describes what is deleted and requires the exact stream name', async () => {
  const { dialog, field, action } = await renderDialog();
  expect(dialog.getByText('Its log events are removed from your local emulator. This cannot be undone.')).toBeVisible();
  expect(action).toBeDisabled();
  fireEvent.change(field, { target: { value: name.toLowerCase() } });
  expect(action).toBeDisabled();
  fireEvent.change(field, { target: { value: name } });
  expect(action).toBeEnabled();
  expect(remove).not.toHaveBeenCalled();
});

it('keeps the open confirmation and explains the refusal', async () => {
  remove.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: DELETE_LOG_STREAM,
      code: 'ResourceNotFoundException',
      message: 'The stream is missing.',
    }),
  );
  const { dialog, field, action, deleted } = await renderDialog();
  fireEvent.change(field, { target: { value: name } });
  fireEvent.click(action);
  expect(await dialog.findByText('DeleteLogStream failed')).toBeVisible();
  expect(dialog.getByRole('alert')).toHaveTextContent('ResourceNotFoundException: The stream is missing.');
  expect(field).toHaveValue(name);
  expect(action).toBeEnabled();
  expect(deleted).not.toHaveBeenCalled();
});

it.each(['Cancel', 'Escape', 'Close dialog'])('lets %s dismiss the confirmation after a 501', async (close) => {
  remove.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: DELETE_LOG_STREAM }));
  const { dialog, field, action, deleted } = await renderDialog();
  fireEvent.change(field, { target: { value: name } });
  fireEvent.click(action);
  expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
  expect(dialog.getByRole('alert')).toHaveTextContent('501 Not Implemented for DeleteLogStream');
  expect(field).toHaveValue(name);
  expect(action).toBeDisabled();
  if (close === 'Escape') {
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape', keyCode: 27 });
  } else {
    fireEvent.click(dialog.getByRole('button', { name: close }));
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(deleted).not.toHaveBeenCalled();
});
