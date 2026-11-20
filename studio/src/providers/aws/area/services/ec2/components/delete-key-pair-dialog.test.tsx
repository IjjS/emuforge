import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { DeleteKeyPairDialog, type DeleteKeyPairDialogProps } from './delete-key-pair-dialog';

/** The dialog inside an area's root, where the area's modals render. */
function InArea(props: DeleteKeyPairDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteKeyPairDialog {...props} />
      </AreaRootContext>
    </div>
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

describe('"Delete key pair?"', () => {
  it('names the key pair and says an instance keeps the name; "Delete" acts only once delete is typed; "Cancel" closes, nothing sent', async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(<InArea visible name="dev key" pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />);
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete key pair?');
    expect(text(dialog)).toContain(
      'dev key is deleted from the local emulator. This cannot be undone. An instance that names it keeps the name.',
    );
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    const field = within(dialog).getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Delete' } });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.change(field, { target: { value: 'delete' } });
    expect(isDisabled(confirm)).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
