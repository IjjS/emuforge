import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';

import { AreaRootContext } from '../area-root';
import { AreaModal } from './area-modal';

function Area() {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} data-testid="area-root">
      <AreaRootContext value={root}>
        <AreaModal visible header="Delete bucket" closeAriaLabel="Close modal">
          Nothing is deleted.
        </AreaModal>
      </AreaRootContext>
    </div>
  );
}

describe('AreaModal', () => {
  it("renders the dialog inside the area's root, not under document.body directly", async () => {
    const { unmount } = render(<Area />);

    const dialog = await screen.findByRole('dialog');
    const root = screen.getByTestId('area-root');
    expect(root).toContainElement(dialog);
    expect([...document.body.children].every((child) => !child.contains(dialog) || child.contains(root))).toBe(true);

    unmount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
