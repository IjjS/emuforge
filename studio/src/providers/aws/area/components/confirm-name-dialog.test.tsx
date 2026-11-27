import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';

import { AreaRootContext } from '../area-root';
import { ConfirmNameDialog } from './confirm-name-dialog';

const aws = () => createWrapper(document.body);
const name = '/app#Name';

function renderDialog({ pending = false, unavailable }: { pending?: boolean; unavailable?: string } = {}) {
  const confirmed = vi.fn();
  const dismissed = vi.fn();

  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(true);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <button onClick={() => setVisible(true)}>Open confirmation</button>
          <ConfirmNameDialog
            visible={visible}
            header="Confirm removal"
            body="This removes the resource."
            label="Type its name."
            name={name}
            action="Remove"
            pending={pending}
            unavailable={unavailable}
            onConfirm={confirmed}
            onDismiss={() => {
              dismissed();
              setVisible(false);
            }}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }

  render(<Area />);
  return { confirmed, dismissed };
}

async function controls() {
  return waitFor(() => {
    const dialog = aws().findModal();
    if (!dialog?.isVisible()) throw new Error('Expected an open modal');
    expect(dialog.getElement()).toHaveAccessibleName('Confirm removal');
    const field = dialog.findContent().findInput()?.findNativeInput().getElement();
    const [cancel, action] = dialog.findFooter()?.findAllButtons() ?? [];
    if (!field || !action || !cancel) throw new Error('Expected the confirmation controls');
    expect(field).toHaveAccessibleName('Type its name.');
    expect(action.getElement()).toHaveAccessibleName('Remove');
    expect(cancel.getElement()).toHaveAccessibleName('Cancel');
    return {
      dialog,
      field,
      action: action.getElement(),
      cancel: cancel.getElement(),
      close: dialog.findDismissButton().getElement(),
    };
  });
}

it('renders the supplied copy and accepts only the exact name', async () => {
  const { confirmed } = renderDialog();
  const { dialog, field, action } = await controls();
  expect(
    dialog
      .findContent()
      .findAllBoxes()
      .map((box) => box.getElement().textContent),
  ).toContain('This removes the resource.');
  expect(action).toBeDisabled();
  for (const value of [name.toLowerCase(), ` ${name}`, `${name} `]) {
    fireEvent.change(field, { target: { value } });
    expect(action).toBeDisabled();
  }
  fireEvent.change(field, { target: { value: name } });
  expect(action).toBeEnabled();
  fireEvent.click(action);
  expect(confirmed).toHaveBeenCalledTimes(1);
  fireEvent.change(field, { target: { value: name.slice(0, -1) } });
  expect(action).toBeDisabled();
});

it('blocks the action and dismissal while pending', async () => {
  const { confirmed, dismissed } = renderDialog({ pending: true });
  const { field, action, cancel, close } = await controls();
  expect(action).toBeDisabled();
  expect(cancel).toBeDisabled();
  fireEvent.click(action);
  fireEvent.click(cancel);
  fireEvent.click(close);
  fireEvent.keyDown(field, { key: 'Escape', code: 'Escape', keyCode: 27 });
  expect(confirmed).not.toHaveBeenCalled();
  expect(dismissed).not.toHaveBeenCalled();
  expect(aws().findModal()?.getElement()).toBeVisible();
});

it.each(['cancel', 'escape', 'close'] as const)(
  'allows %s dismissal while unavailable and resets the field',
  async (via) => {
    const { confirmed, dismissed } = renderDialog({ unavailable: 'Removal is unavailable.' });
    const { dialog, field, action, cancel, close } = await controls();
    expect(dialog.findContent().getElement()).toBeVisible();
    expect(dialog.findContent().getElement()).toHaveTextContent('Removal is unavailable.');
    fireEvent.change(field, { target: { value: name } });
    expect(action).toBeDisabled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(confirmed).not.toHaveBeenCalled();
    if (via === 'escape') {
      fireEvent.keyDown(field, { key: 'Escape', code: 'Escape', keyCode: 27 });
    } else {
      fireEvent.click(via === 'cancel' ? cancel : close);
    }
    expect(dismissed).toHaveBeenCalledOnce();
    expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    expect((await controls()).field).toHaveValue('');
  },
);
