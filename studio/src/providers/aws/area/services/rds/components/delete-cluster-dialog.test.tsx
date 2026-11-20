import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { DeleteClusterDialog, type DeleteClusterDialogProps } from './delete-cluster-dialog';

/** The dialog inside an area's root, where the area's modals render. */
function InArea(props: DeleteClusterDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteClusterDialog {...props} />
      </AreaRootContext>
    </div>
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

describe('"Delete DB cluster?"', () => {
  it('names the cluster; "Delete" acts only once delete is typed; "Cancel" closes and sends nothing', async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(<InArea visible id="app-aur" pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />);
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete DB cluster?');
    expect(text(dialog)).toContain(
      'app-aur is deleted from the local emulator with no final snapshot. This cannot be undone.',
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
