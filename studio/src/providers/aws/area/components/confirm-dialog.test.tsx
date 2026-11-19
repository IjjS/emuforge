import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../area-root';
import { ConfirmDialog } from './confirm-dialog';

// The area's typed-word confirmation dialog (test-criteria.md, issue 496, "Unit s1 —
// providers/aws/area/components/confirm-dialog.test.tsx").

interface Handlers {
  onConfirm: () => void;
  onDismiss: () => void;
}

function Page({ pending, visible = true, onConfirm, onDismiss }: Handlers & { pending: boolean; visible?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <ConfirmDialog
          visible={visible}
          header="Delete 2 items from orders?"
          body="They are deleted from your local emulator. This cannot be undone."
          word="delete"
          action="Delete"
          pending={pending}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      </AreaRootContext>
    </div>
  );
}

async function open(pending = false) {
  const handlers = { onConfirm: vi.fn(), onDismiss: vi.fn() };
  const view = render(<Page pending={pending} {...handlers} />);
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  const field = within(dialog).getByRole('textbox');
  const confirm = within(dialog).getByRole('button', { name: 'Delete' });
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  return { ...handlers, dialog, field, confirm, cancel, rerender: view.rerender };
}

function type(field: HTMLElement, text: string) {
  fireEvent.change(field, { target: { value: text } });
}

function isDisabled(button: HTMLElement): boolean {
  return button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
}

function pressEsc() {
  fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });
}

describe('ConfirmDialog, a removal confirmed by a typed word', () => {
  it('shows its header, its body and asks for the word', async () => {
    const { dialog } = await open();

    expect(within(dialog).getByText('Delete 2 items from orders?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('They are deleted from your local emulator. This cannot be undone.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('To confirm, type “delete” in the field.')).toBeInTheDocument();
  });

  it.each([[''], ['delet'], ['Delete'], ['delete '], [' delete'], ['deleted']])(
    'the field holding %j: the confirm button does not act, by click or Enter',
    async (text) => {
      const { onConfirm, field, confirm } = await open();

      type(field, text);
      expect(isDisabled(confirm)).toBe(true);
      fireEvent.click(confirm);
      fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 13 });

      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it('the field holding the word exactly: the confirm button acts once, and Enter in the field acts', async () => {
    const { onConfirm, onDismiss, field, confirm } = await open();

    type(field, 'delete');
    expect(isDisabled(confirm)).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('"Cancel" closes it without acting, even with the word typed', async () => {
    const { onConfirm, onDismiss, field, cancel } = await open();

    type(field, 'delete');
    fireEvent.click(cancel);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc closes it without acting, even with the word typed', async () => {
    const { onConfirm, onDismiss, field } = await open();

    type(field, 'delete');
    act(() => {
      field.focus();
    });
    pressEsc();

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('while pending: neither button acts, Esc and Enter do nothing, and the dialog stays', async () => {
    const { onConfirm, onDismiss, field, confirm, cancel, rerender } = await open();
    type(field, 'delete');

    rerender(<Page pending onConfirm={onConfirm} onDismiss={onDismiss} />);

    expect(isDisabled(confirm)).toBe(true);
    expect(isDisabled(cancel)).toBe(true);
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 13 });
    pressEsc();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('not visible: nothing is rendered; shown again, its field starts empty', async () => {
    const handlers = { onConfirm: vi.fn(), onDismiss: vi.fn() };
    const view = render(<Page pending={false} {...handlers} />);
    type(await screen.findByRole('textbox'), 'delete');

    view.rerender(<Page pending={false} visible={false} {...handlers} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    view.rerender(<Page pending={false} {...handlers} />);
    expect(await screen.findByRole('textbox')).toHaveValue('');
  });
});
