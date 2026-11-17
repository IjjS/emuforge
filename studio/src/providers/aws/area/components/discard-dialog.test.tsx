import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../area-root';
import { DiscardDialog, type DiscardAnswer } from './discard-dialog';

const HEADING = 'Discard what you entered?';

/** A form's "Cancel" that opens the dialog, inside the area's root, as a create form of the area holds it. */
function Form({ onAnswer, tick }: { onAnswer: (answer: DiscardAnswer) => void; tick: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div ref={root} data-testid="area-root" data-tick={tick}>
      <AreaRootContext value={root}>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Cancel
        </button>
        <DiscardDialog
          visible={open}
          onAnswer={(answer) => {
            setOpen(false);
            onAnswer(answer);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

async function openDialog() {
  const onAnswer = vi.fn<(answer: DiscardAnswer) => void>();
  const view = render(<Form onAnswer={onAnswer} tick={0} />);
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  act(() => {
    cancel.focus();
  });
  fireEvent.click(cancel);
  const dialog = await screen.findByRole('dialog');
  // Cloudscape moves focus into the dialog once it is shown.
  await waitFor(() => {
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  return { onAnswer, dialog, cancel, rerender: view.rerender };
}

async function expectClosed() {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

describe('DiscardDialog, what "Cancel" opens on a form that holds something', () => {
  it('opened: the heading, the text, "Keep editing", "Discard" and a close control named "Close"', async () => {
    const { dialog } = await openDialog();

    expect(within(dialog).getByText(HEADING)).toBeInTheDocument();
    expect(within(dialog).getByText('What you entered on this page is not kept.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button')).toHaveLength(3);
  });

  it.each([
    [
      '"Keep editing"',
      (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' })),
    ],
    ['Esc', () => fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 })],
    ['"Close"', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))],
  ])('%s: reports "keep" once and never "discard"; focus back on "Cancel"', async (_name, answer) => {
    const { onAnswer, dialog, cancel } = await openDialog();

    answer(dialog);
    await expectClosed();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('keep');
    await waitFor(() => {
      expect(document.activeElement).toBe(cancel);
    });
  });

  it('"Discard": reports "discard" once', async () => {
    const { onAnswer, dialog } = await openDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await expectClosed();

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith('discard');
  });

  it("opened inside the area: the dialog is rendered inside the area's root", async () => {
    const { dialog } = await openDialog();

    expect(screen.getByTestId('area-root')).toContainElement(dialog);
  });

  it('the form re-rendered while it is open: the same dialog, focus where it was', async () => {
    const { onAnswer, dialog, rerender } = await openDialog();
    const focused = document.activeElement;

    rerender(<Form onAnswer={onAnswer} tick={1} />);
    await act(() => Promise.resolve());

    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(dialog.isConnected).toBe(true);
    expect(document.activeElement).toBe(focused);
  });

  it('Tab from "Discard" and Shift+Tab from the first control: focus stays inside the dialog', async () => {
    const user = userEvent.setup();
    const { dialog } = await openDialog();
    const controls = within(dialog).getAllByRole('button');
    const first = controls[0] as HTMLElement;
    const discard = within(dialog).getByRole('button', { name: 'Discard' });

    act(() => {
      discard.focus();
    });
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    act(() => {
      first.focus();
    });
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
