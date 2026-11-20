import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { PartDialog } from './part-dialog';

let onConfirm: ReturnType<typeof vi.fn<() => void>>;

function InArea({ pending = false }: { pending?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <PartDialog
          visible={visible}
          header="Detach internet gateway?"
          body="gw is detached from vpc-1."
          action="Detach"
          pending={pending}
          onConfirm={onConfirm}
          onDismiss={() => {
            setVisible(false);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

beforeEach(() => {
  onConfirm = vi.fn();
});

describe('the dialog confirmed with its button', () => {
  it('shows its header and body and acts on its button with no word typed', async () => {
    render(<InArea />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Detach internet gateway?');
    expect(dialog.textContent).toContain('gw is detached from vpc-1.');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Detach' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('"Cancel" closes it and nothing is sent', async () => {
    render(<InArea />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc closes it and nothing is sent', async () => {
    render(<InArea />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('the close control closes it and nothing is sent', async () => {
    render(<InArea />);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('while the request is in flight neither button acts', async () => {
    render(<InArea pending />);
    const dialog = await screen.findByRole('dialog');
    const action = within(dialog).getByRole('button', { name: 'Detach' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(isDisabled(action)).toBe(true);
    expect(isDisabled(cancel)).toBe(true);
    fireEvent.click(action);
    fireEvent.click(cancel);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
