import { fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { DeleteRuleDialog, type DeleteRuleDialogProps } from './delete-rule-dialog';

/** The dialog inside an area's root, where the area's modals render. */
function InArea(props: DeleteRuleDialogProps) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteRuleDialog {...props} />
      </AreaRootContext>
    </div>
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

describe('"Delete rule?"', () => {
  it('names the rule by its direction, protocol, ports and source, and the group; "Delete" acts only once delete is typed', async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <InArea
        rule={{
          id: 'sgr-1',
          egress: false,
          protocol: 'tcp',
          fromPort: 22,
          toPort: 22,
          peer: { kind: 'ipv4', value: '10.0.0.0/8' },
        }}
        groupName="web"
        pending={false}
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete rule?');
    expect(text(dialog)).toContain('The inbound rule TCP 22 10.0.0.0/8 is removed from web.');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
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
  });

  it('an outbound rule to a group is named so', async () => {
    render(
      <InArea
        rule={{
          id: 'sgr-2',
          egress: true,
          protocol: 'udp',
          fromPort: 5000,
          toPort: 5010,
          peer: { kind: 'group', value: 'sg-b' },
        }}
        groupName="api"
        pending={false}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('The outbound rule UDP 5000 - 5010 sg-b is removed from api.');
  });

  it('no rule → no dialog', () => {
    render(<InArea rule={undefined} groupName="web" pending={false} onConfirm={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
