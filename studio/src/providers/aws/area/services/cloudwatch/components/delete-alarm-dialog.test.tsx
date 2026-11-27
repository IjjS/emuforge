import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteAlarm } from '../delete-api';
import { DeleteAlarmDialog } from './delete-alarm-dialog';

vi.mock('../delete-api', async (load) => ({
  ...(await load<typeof import('../delete-api')>()),
  deleteAlarm: vi.fn(),
}));

const remove = vi.mocked(deleteAlarm);
const endpoint = 'http://127.0.0.1:8310';
const name = 'local-alarm';
const dependent = new RequestError({
  kind: 'other',
  operation: 'DeleteAlarms',
  code: 'ValidationError',
  message: 'A composite alarm depends on this alarm.',
});
const unimplemented = new RequestError({ kind: 'not-implemented', operation: 'DeleteAlarms' });

beforeEach(() => remove.mockReset().mockResolvedValue(undefined));

function open(alarmName = name) {
  const deleted = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          {visible && (
            <DeleteAlarmDialog
              endpoint={endpoint}
              name={alarmName}
              unavailable={unavailable}
              onUnavailable={() => setUnavailable(true)}
              onDeleted={deleted}
              onDismiss={() => setVisible(false)}
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
  const modal = await screen.findByRole('dialog');
  const dialog = within(modal);
  return {
    modal,
    dialog,
    field: dialog.getByRole('textbox', { name: 'To confirm, type delete.' }),
    action: dialog.getByRole('button', { name: 'Delete' }),
    cancel: dialog.getByRole('button', { name: 'Cancel' }),
    close: dialog.getByRole('button', { name: 'Close dialog' }),
  };
}

function type(field: HTMLElement, value = 'delete') {
  fireEvent.change(field, { target: { value } });
}

function escape(field: HTMLElement) {
  fireEvent.keyDown(field, { key: 'Escape', code: 'Escape', keyCode: 27 });
}

it('names the alarm, explains the deletion, and requires the exact word delete', async () => {
  open();
  const { modal, dialog, field, action } = await controls();
  expect(modal).toHaveAccessibleName(`Delete alarm ${name}?`);
  expect(dialog.getByText('The alarm is removed from your local emulator. This cannot be undone.')).toBeVisible();
  expect(action).toBeDisabled();
  for (const value of ['Delete', ' delete', 'delete ']) {
    type(field, value);
    expect(action).toBeDisabled();
  }
  type(field);
  expect(action).toBeEnabled();
  expect(remove).not.toHaveBeenCalled();
});

it('keeps repeated spaces and a line feed in the name element', async () => {
  const exactName = 'alarm with  spaces\nand a new line';
  open(exactName);
  const { modal } = await controls();
  const element = modal.querySelector('.aws-area-value-name');
  expect(element?.textContent).toBe(exactName);
  expect(element?.parentElement).toHaveStyle({ whiteSpace: 'pre-wrap' });
});

it('reports a successful deletion once', async () => {
  const deleted = open();
  const { field, action } = await controls();
  type(field);
  await act(async () => fireEvent.click(action));
  expect(remove).toHaveBeenCalledExactlyOnceWith(endpoint, name, expect.any(AbortSignal));
  expect(deleted).toHaveBeenCalledExactlyOnceWith(name);
});

it.each([
  ['refusal', dependent, 'DeleteAlarms failed'],
  ['501', unimplemented, 'Not implemented by the emulator'],
] as const)('shows a %s in the open confirmation', async (_, error, header) => {
  remove.mockRejectedValueOnce(error);
  const deleted = open();
  const { dialog, field, action } = await controls();
  type(field);
  fireEvent.click(action);
  expect(await dialog.findByText(header)).toBeVisible();
  expect(field).toHaveValue('delete');
  expect(deleted).not.toHaveBeenCalled();
  if (error === dependent) {
    expect(dialog.getByText(/A composite alarm depends on this alarm/)).toBeVisible();
    expect(action).toBeEnabled();
    await act(async () => fireEvent.click(action));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(deleted).toHaveBeenCalledExactlyOnceWith(name);
  } else {
    expect(dialog.getByText(/501 Not Implemented for DeleteAlarms/)).toBeVisible();
    expect(action).toBeDisabled();
  }
});

it.each([
  [dependent, 'Cancel'],
  [dependent, 'Escape'],
  [dependent, 'Close dialog'],
  [unimplemented, 'Cancel'],
  [unimplemented, 'Escape'],
  [unimplemented, 'Close dialog'],
] as const)('allows dismissal of %s with %s', async (error, method) => {
  remove.mockRejectedValueOnce(error);
  const deleted = open();
  const { dialog, field, action } = await controls();
  type(field);
  fireEvent.click(action);
  await dialog.findByText(error === dependent ? 'DeleteAlarms failed' : 'Not implemented by the emulator');
  if (method === 'Escape') escape(field);
  else fireEvent.click(dialog.getByRole('button', { name: method }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(deleted).not.toHaveBeenCalled();
});

it('ignores confirmation and all dismissal controls while the request is pending', async () => {
  let finish!: () => void;
  remove.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const deleted = open();
  const { modal, field, action, cancel, close } = await controls();
  type(field);
  fireEvent.click(action);
  expect(action).toBeDisabled();
  expect(cancel).toBeDisabled();
  fireEvent.click(action);
  fireEvent.click(cancel);
  fireEvent.click(close);
  escape(field);
  expect(modal).toBeVisible();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(deleted).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(deleted).toHaveBeenCalledExactlyOnceWith(name);
});
