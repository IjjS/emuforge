import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../group-api';
import { DeleteGroupDialog, type GroupTarget } from './delete-group-dialog';

// The dialog sends `DeleteSecurityGroup` itself; the call of `group-api.ts` is answered by the case.

vi.mock('../group-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../group-api')>();
  return { ...real, deleteSecurityGroup: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8309';
const GROUP: GroupTarget = { id: 'sg-a', name: 'web' };

let onDeleted: ReturnType<typeof vi.fn>;

/** The dialog inside an area's root, open until it is dismissed. */
function InArea() {
  const root = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState<GroupTarget | undefined>(GROUP);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteGroupDialog
          group={group}
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={(deleted) => {
            onDeleted(deleted);
            setGroup(undefined);
          }}
          onDismiss={() => {
            setGroup(undefined);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InArea />
    </QueryClientProvider>,
  );
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function confirmWith(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
});

describe('"Delete security group?"', () => {
  it('names the group and says the emulator refuses while it is in use; "Delete" acts only once delete is typed', async () => {
    vi.mocked(api.deleteSecurityGroup).mockResolvedValue(undefined);
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete security group?');
    expect(text(dialog)).toContain(
      "web is deleted from the local emulator. This cannot be undone. The emulator refuses while an instance or another group's rule uses it.",
    );
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Delete' } });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.click(confirm);
    expect(api.deleteSecurityGroup).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    expect(isDisabled(confirm)).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith(GROUP);
    });
    expect(vi.mocked(api.deleteSecurityGroup).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'sg-a']);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('"Cancel" closes it and sends nothing', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.deleteSecurityGroup).not.toHaveBeenCalled();
  });

  it("a refusal → the dialog stays open with the emulator's code and message; \"Cancel\" then closes it", async () => {
    vi.mocked(api.deleteSecurityGroup).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteSecurityGroup',
        code: 'DependencyViolation',
        message: 'resource sg-a has a dependent object',
      }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation: resource sg-a has a dependent object');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(onDeleted).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('a 501 → "not implemented by the emulator" with DeleteSecurityGroup, in the dialog', async () => {
    vi.mocked(api.deleteSecurityGroup).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DeleteSecurityGroup' }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toMatch(/Not implemented by the emulator/);
    expect(text(alert)).toContain('DeleteSecurityGroup');
    expect(screen.getByRole('dialog')).toBe(dialog);
  });
});
