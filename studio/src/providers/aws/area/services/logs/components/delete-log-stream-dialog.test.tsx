import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
import { DELETE_LOG_STREAM, deleteLogStream } from '../stream-change-api';
import { DeleteLogStreamDialog } from './delete-log-stream-dialog';

vi.mock('../stream-change-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-change-api')>()),
  deleteLogStream: vi.fn(),
}));

const remove = vi.mocked(deleteLogStream);
const name = 'a b/[$LATEST]';

beforeEach(() => remove.mockReset());
afterEach(() => vi.unstubAllGlobals());

async function renderDialog(streamName = name) {
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
              name={streamName}
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
  const dialog = await openModal(/^Delete log stream /);
  const element = dialog.getElement();
  return {
    dialog,
    element,
    field: modalInput(dialog, "To confirm, type the log stream's name."),
    action: modalButton(dialog, 'Delete'),
    deleted,
  };
}

it('describes what is deleted and requires the exact stream name', async () => {
  const { dialog, element, field, action } = await renderDialog();
  expect(element).toHaveAccessibleName('Delete log stream a b/[$LATEST]?');
  expectModalBox(dialog, 'Its log events are removed from your local emulator. This cannot be undone.');
  expect(action).toBeDisabled();
  fireEvent.change(field, { target: { value: name.toLowerCase() } });
  expect(action).toBeDisabled();
  fireEvent.change(field, { target: { value: name } });
  expect(action).toBeEnabled();
  expect(remove).not.toHaveBeenCalled();
});

it('shows stored line breaks in the title and copies the original name exactly', async () => {
  const stored = 'first\rsecond\r\n\rthird\n';
  const displayed = 'first\nsecond\n\nthird\n';
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { dialog } = await renderDialog(stored);

  const titleName = dialog.findHeader().find('span[style]')?.getElement();
  expect(titleName?.textContent).toBe(displayed);
  expect(titleName).toBeVisible();
  expect(titleName).toHaveStyle({ whiteSpace: 'pre-wrap' });
  const copy = dialog.findContent().findCopyToClipboard();
  expect(copy?.findCopyButton().getElement()).toHaveAccessibleName('Copy log stream name');
  copy?.findCopyButton().click();

  await waitFor(() => {
    const status = copy?.findStatusText({ popoverRenderWithPortal: false })?.getElement();
    expect(status).toBeVisible();
    expect(status).toHaveTextContent('Log stream name copied');
  });
  expect(writeText).toHaveBeenCalledExactlyOnceWith(stored);
  expect(remove).not.toHaveBeenCalled();
});

it.each(['\r', '\n', '\r\n'])('accepts the entered line break %# and deletes the stored name', async (lineBreak) => {
  const stored = 'first\rsecond\nthird\r\nfourth';
  remove.mockResolvedValueOnce(undefined);
  const { field, action, deleted } = await renderDialog(stored);

  for (const wrong of [
    'first second\nthird\nfourth',
    'first\n\nsecond\nthird\nfourth',
    'First\nsecond\nthird\nfourth',
  ]) {
    fireEvent.change(field, { target: { value: wrong } });
    expect(action).toBeDisabled();
  }
  expect(remove).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: ['first', 'second', 'third', 'fourth'].join(lineBreak) } });
  expect(action).toBeEnabled();
  fireEvent.click(action);

  expect(remove).toHaveBeenCalledExactlyOnceWith(
    'http://127.0.0.1:8310',
    '/app#Group',
    stored,
    expect.any(AbortSignal),
  );
  await waitFor(() => expect(deleted).toHaveBeenCalledExactlyOnceWith(stored));
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
  await expectModalAlert(dialog, 'DeleteLogStream failed');
  expect(modalAlert(dialog)?.findContent().getElement()).toHaveTextContent(
    'ResourceNotFoundException: The stream is missing.',
  );
  expect(field).toHaveValue(name);
  expect(action).toBeEnabled();
  expect(deleted).not.toHaveBeenCalled();
});

it.each(['Cancel', 'Escape', 'Close dialog'])('lets %s dismiss the confirmation after a 501', async (close) => {
  remove.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: DELETE_LOG_STREAM }));
  const { dialog, field, action, deleted } = await renderDialog();
  fireEvent.change(field, { target: { value: name } });
  fireEvent.click(action);
  await expectModalAlert(dialog, 'Not implemented by the emulator');
  expect(modalAlert(dialog)?.findContent().getElement()).toHaveTextContent('501 Not Implemented for DeleteLogStream');
  expect(field).toHaveValue(name);
  expect(action).toBeDisabled();
  if (close === 'Escape') {
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape', keyCode: 27 });
  } else {
    fireEvent.click(modalButton(dialog, close));
  }
  expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(deleted).not.toHaveBeenCalled();
});
