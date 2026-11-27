import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteEventBus } from '../bus-change-api';
import { DeleteEventBusDialog } from './delete-event-bus-dialog';

vi.mock('../bus-change-api', async (original) => ({
  ...(await original<typeof import('../bus-change-api')>()),
  deleteEventBus: vi.fn(),
}));

const drop = vi.mocked(deleteEventBus);
const name = 'Route';
const endpoint = 'http://127.0.0.1:8314';
const operation = 'DeleteEventBus';

beforeEach(() => drop.mockReset());

async function open() {
  const onDeleted = vi.fn();
  const onUnavailable = vi.fn();
  const onDismiss = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <DeleteEventBusDialog
            endpoint={endpoint}
            name={name}
            onDeleted={onDeleted}
            onUnavailable={onUnavailable}
            onDismiss={onDismiss}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(<Area />);
  const dialog = await waitFor(() => {
    const wrapper = createWrapper(container).findModal();
    if (!wrapper) throw new Error('Expected the delete dialog');
    return wrapper;
  });
  const [cancel, action] = dialog.findFooter()?.findAllButtons() ?? [];
  const field = dialog.findContent().findInput()?.findNativeInput().getElement();
  if (!cancel || !action || !field) throw new Error('Expected the delete controls');
  const confirm = () => {
    fireEvent.change(field, { target: { value: name } });
    fireEvent.click(action.getElement());
  };
  return { dialog, action, cancel, field, confirm, onDeleted, onUnavailable, onDismiss };
}

it('names the bus, explains deletion, and requires the exact typed name', async () => {
  const { dialog, action, field } = await open();
  expect(dialog.getElement()).toHaveAccessibleName('Delete event bus Route?');
  expect(dialog.findContent().getElement()).toHaveTextContent(
    'The event bus is removed from your local emulator. This cannot be undone.',
  );
  expect(field).toHaveAccessibleName("To confirm, type the event bus's name.");
  expect(action.getElement()).toBeDisabled();
  fireEvent.change(field, { target: { value: 'route' } });
  expect(action.getElement()).toBeDisabled();
  fireEvent.change(field, { target: { value: name } });
  expect(action.getElement()).toBeEnabled();
  expect(drop).not.toHaveBeenCalled();
});

it('keeps an emulator refusal in the open dialog', async () => {
  const message = "EventBus can't be deleted since it has rules.";
  drop.mockRejectedValueOnce(new RequestError({ kind: 'other', operation, code: 'ValidationException', message }));
  const { dialog, confirm, action, onDeleted } = await open();
  confirm();
  await waitFor(() => expect(dialog.findContent().getElement()).toHaveTextContent(operation));
  expect(dialog.findContent().getElement()).toHaveTextContent(message);
  expect(dialog.getElement()).toBeVisible();
  expect(action.getElement()).toBeEnabled();
  expect(onDeleted).not.toHaveBeenCalled();
});

it('explains a 501 in the open dialog and makes Delete unavailable', async () => {
  drop.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
  const { dialog, confirm, action, onUnavailable, onDeleted } = await open();
  confirm();
  await waitFor(() => expect(dialog.findContent().getElement()).toHaveTextContent('Not implemented by the emulator'));
  expect(dialog.findContent().getElement()).toHaveTextContent(operation);
  expect(action.getElement()).toBeDisabled();
  expect(onUnavailable).toHaveBeenCalledOnce();
  expect(onDeleted).not.toHaveBeenCalled();
});

it('ignores Cancel, Escape and repeated confirmation while deleting', async () => {
  drop.mockReturnValueOnce(new Promise(() => {}));
  const { dialog, action, cancel, confirm, onDismiss } = await open();
  confirm();
  expect(action.getElement()).toBeDisabled();
  expect(cancel.getElement()).toBeDisabled();
  fireEvent.click(action.getElement());
  fireEvent.click(cancel.getElement());
  fireEvent.keyDown(dialog.getElement(), { key: 'Escape' });
  expect(drop).toHaveBeenCalledExactlyOnceWith(endpoint, name, expect.any(AbortSignal));
  expect(onDismiss).not.toHaveBeenCalled();
});
