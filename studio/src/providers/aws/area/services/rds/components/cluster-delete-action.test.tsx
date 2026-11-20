import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { ClusterDeleteAction, type ClusterDeleteActionProps } from './cluster-delete-action';

/** The control inside an area's root, where the area's modals render. */
function InArea(props: ClusterDeleteActionProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <ClusterDeleteAction {...props} />
      </AreaRootContext>
    </div>
  );
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

const FREE = { id: 'app-aur', status: 'available', memberCount: 0, deletionProtection: false };

describe("a DB cluster's Delete control", () => {
  it('none given → unavailable; a free cluster → the dialog, and onDelete once the word is typed', async () => {
    const onDelete = vi.fn();
    const { rerender } = render(<InArea cluster={undefined} pending={false} onDelete={onDelete} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Delete' }))).toBe(true);
    rerender(<InArea cluster={FREE} pending={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('app-aur');
  });

  it('a member → unavailable and nothing opens; while pending → unavailable', () => {
    const onDelete = vi.fn();
    const { rerender } = render(<InArea cluster={{ ...FREE, memberCount: 1 }} pending={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<InArea cluster={FREE} pending onDelete={onDelete} />);
    expect(isDisabled(screen.getByRole('button', { name: 'Delete' }))).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
