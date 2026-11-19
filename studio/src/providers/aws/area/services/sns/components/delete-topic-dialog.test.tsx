import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { DeleteTopicDialog, type DeleteTopicDialogProps } from './delete-topic-dialog';

/** The dialog inside an area's root, where the area's modals render. */
function InArea(props: DeleteTopicDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteTopicDialog {...props} />
      </AreaRootContext>
    </div>
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

describe('"Delete topic?"', () => {
  it('names the topic and its subscriptions; "Delete" acts only once delete is typed; "Cancel" sends nothing', async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(<InArea visible name="orders" pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />);
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete topic?');
    expect(text(dialog)).toContain(
      'orders and its subscriptions are deleted from the local emulator. This cannot be undone.',
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
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('hidden → nothing rendered', () => {
    render(<InArea visible={false} name="orders" pending={false} onConfirm={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
