import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { DeleteQueueDialog, type DeleteQueueDialogProps } from './delete-queue-dialog';

// The dialog of "Delete" of a queue (issue 490, test-criteria.md, "Unit s1"), inside the area's root as a page of the
// area holds it.

const BODY = 'The queue and every message in it are deleted from the local emulator. This cannot be undone.';

function InArea(props: DeleteQueueDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteQueueDialog {...props} />
      </AreaRootContext>
    </div>
  );
}

function open(overrides: Partial<DeleteQueueDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onDismiss = vi.fn();
  const props: DeleteQueueDialogProps = {
    visible: true,
    name: 'orders',
    sources: [],
    pending: false,
    onConfirm,
    onDismiss,
    ...overrides,
  };
  const view = render(<InArea {...props} />);
  return { ...view, props, onConfirm, onDismiss };
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function deleteButton(dialog: HTMLElement): HTMLButtonElement {
  return within(dialog).getByRole('button', { name: 'Delete' });
}

describe('the delete dialog of a queue', () => {
  it('opened for orders: "Delete orders?", the body, "Delete" disabled until delete is typed', async () => {
    const { onConfirm } = open();
    const dialog = await screen.findByRole('dialog');

    expect(text(dialog)).toContain('Delete orders?');
    expect(text(dialog)).toContain(BODY);
    expect(text(dialog)).toContain('To confirm, type “delete” in the field.');
    expect(deleteButton(dialog).disabled).toBe(true);

    const field = within(dialog).getByRole('textbox');
    fireEvent.change(field, { target: { value: 'delet' } });
    expect(deleteButton(dialog).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'delete' } });
    expect(deleteButton(dialog).disabled).toBe(false);

    fireEvent.click(deleteButton(dialog));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('with sources a, b: the sentence that names them; with none, or sources unknown: no such sentence', async () => {
    const sentence = 'It is the dead-letter queue of a, b. Their redrive policies keep naming it.';
    const first = open({ sources: ['a', 'b'] });
    expect(text(await screen.findByRole('dialog'))).toContain(sentence);
    first.unmount();

    const second = open({ sources: [] });
    const none = await screen.findByRole('dialog');
    expect(text(none)).not.toContain('dead-letter queue of');
    expect(text(none)).toContain(BODY);
    second.unmount();

    open({ sources: undefined });
    const unknown = await screen.findByRole('dialog');
    expect(text(unknown)).not.toContain('dead-letter queue of');
    expect(text(unknown)).toContain(BODY);
  });

  it('pending: neither button acts and the dialog stays', async () => {
    const { onConfirm, onDismiss } = open({ pending: true });
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(deleteButton(dialog));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
