import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
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
const page = createWrapper();
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
  const modal = await waitFor(() => {
    const dialog = page.findModal();
    if (!dialog?.isVisible()) throw new Error('Delete confirmation is missing');
    return dialog;
  });
  const field = modal.findContent().findInput()?.findNativeInput().getElement();
  const buttons = modal.findFooter()?.findAllButtons();
  const action = buttons?.find((button) => button.findTextRegion()?.getElement().textContent === 'Delete');
  const cancel = buttons?.find((button) => button.findTextRegion()?.getElement().textContent === 'Cancel');
  if (!field || !action || !cancel) throw new Error('Delete confirmation controls are missing');
  return {
    modal,
    field,
    action: action.getElement(),
    cancel: cancel.getElement(),
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
  const { modal, field, action } = await controls();
  expect(modal.getElement()).toHaveAccessibleName(`Delete alarm ${name}?`);
  const body = modal.findContent().findBox()?.getElement();
  expect(body).toBeVisible();
  expect(body?.textContent).toBe('The alarm is removed from your local emulator. This cannot be undone.');
  expect(field).toHaveAccessibleName('To confirm, type delete.');
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
  const element = modal.findHeader().find('.aws-area-value-name')?.getElement();
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
  const { modal, field, action } = await controls();
  type(field);
  fireEvent.click(action);
  const alert = await waitFor(() => {
    const feedback = modal.findContent().findAlert();
    if (!feedback) throw new Error('Delete confirmation alert is missing');
    return feedback;
  });
  const heading = alert.findHeader()?.getElement();
  const content = alert.findContent().getElement();
  expect(heading).toBeVisible();
  expect(heading?.textContent).toBe(header);
  expect(alert.getElement().contains(document.activeElement)).toBe(true);
  expect(content).toBeVisible();
  expect(field).toHaveValue('delete');
  expect(deleted).not.toHaveBeenCalled();
  if (error === dependent) {
    expect(content).toHaveTextContent('A composite alarm depends on this alarm.');
    expect(action).toBeEnabled();
    await act(async () => fireEvent.click(action));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(deleted).toHaveBeenCalledExactlyOnceWith(name);
  } else {
    expect(content).toHaveTextContent('501 Not Implemented for DeleteAlarms');
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
  const { modal, field, action, cancel } = await controls();
  type(field);
  fireEvent.click(action);
  const header = error === dependent ? 'DeleteAlarms failed' : 'Not implemented by the emulator';
  await waitFor(() => expect(modal.findContent().findAlert()?.findHeader()?.getElement().textContent).toBe(header));
  if (method === 'Escape') escape(field);
  else fireEvent.click(method === 'Cancel' ? cancel : modal.findDismissButton().getElement());
  expect(page.findModal()).toBeNull();
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
  const { modal, field, action, cancel } = await controls();
  type(field);
  action.focus();
  fireEvent.click(action);
  expect(action).toHaveAttribute('aria-disabled', 'true');
  expect(action).not.toBeDisabled();
  expect(action).toHaveFocus();
  expect(cancel).toBeDisabled();
  expect(modal.findDismissButton()).toBeNull();
  fireEvent.click(action);
  fireEvent.click(cancel);
  escape(action);
  expect(modal.getElement()).toBeVisible();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(deleted).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(deleted).toHaveBeenCalledExactlyOnceWith(name);
});
