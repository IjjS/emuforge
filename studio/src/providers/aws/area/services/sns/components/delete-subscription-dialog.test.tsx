import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { DeleteSubscriptionDialog, type DeleteSubscriptionDialogProps } from './delete-subscription-dialog';

/** The dialog inside an area's root, where the area's modals render. */
function InArea(props: DeleteSubscriptionDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteSubscriptionDialog {...props} />
      </AreaRootContext>
    </div>
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

describe('"Delete subscription?"', () => {
  it('names the endpoint and the topic and says the policy is left; "Delete" acts only once delete is typed', async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <InArea
        visible
        endpointName="jobs"
        topicName="orders"
        pending={false}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete subscription?');
    expect(text(dialog)).toContain(
      'The subscription of jobs to orders is deleted. The policy of the queue or the function is left as it is.',
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
});
