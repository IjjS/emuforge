import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { TerminateDialog, type TerminateDialogProps } from './terminate-dialog';

/** The dialog inside an area's root, where the area's modals render. */
function InArea(props: TerminateDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <TerminateDialog {...props} />
      </AreaRootContext>
    </div>
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

describe('"Terminate instance?"', () => {
  it('names the instance; "Terminate" acts only once terminate is typed; "Cancel" closes and sends nothing', async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(<InArea visible label="web" pending={false} onConfirm={onConfirm} onDismiss={onDismiss} />);
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Terminate instance?');
    expect(text(dialog)).toContain('web is terminated in the local emulator. This cannot be undone.');
    const confirm = within(dialog).getByRole('button', { name: 'Terminate' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    const field = within(dialog).getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Terminate' } });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.change(field, { target: { value: 'terminate' } });
    expect(isDisabled(confirm)).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('draws the Name tag with both spaces and its identity in the confirmation sentence', () => {
    const name = 'dev  instance';
    const identity = 'dev\\u0020\\u0020instance';
    render(<InArea visible label={name} pending={false} onConfirm={vi.fn()} onDismiss={vi.fn()} />);
    const modal = createWrapper(document.body).findModal();
    if (!modal) throw new Error('Missing termination dialog');
    expect(modal.getElement()).toHaveAccessibleName('Terminate instance?');
    const sentence = modal.findContent().find('p')?.getElement();
    expect(sentence?.querySelector('[aria-hidden="true"]')?.textContent).toBe(`${name} (${identity})`);
    expect(sentence?.textContent).toContain(' is terminated in the local emulator. This cannot be undone.');
  });

  it('an instance without a name is named by its ID', async () => {
    render(<InArea visible label="i-0abc" pending={false} onConfirm={vi.fn()} onDismiss={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('i-0abc is terminated in the local emulator. This cannot be undone.');
  });
});
