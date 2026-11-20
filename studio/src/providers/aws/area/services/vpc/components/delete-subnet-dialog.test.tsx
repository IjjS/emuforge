import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../subnet-changes-api';
import { DeleteSubnetDialog, type SubnetTarget } from './delete-subnet-dialog';

// The dialog sends `DeleteSubnet` itself; the call of `subnet-changes-api.ts` is answered by the case.

vi.mock('../subnet-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../subnet-changes-api')>();
  return { ...real, deleteSubnet: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8575';

let onDeleted: ReturnType<typeof vi.fn<(subnet: SubnetTarget) => void>>;

function InArea({ target }: { target: SubnetTarget }) {
  const root = useRef<HTMLDivElement>(null);
  const [subnet, setSubnet] = useState<SubnetTarget | undefined>(target);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteSubnetDialog
          subnet={subnet}
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={(deleted) => {
            onDeleted(deleted);
            setSubnet(undefined);
          }}
          onDismiss={() => {
            setSubnet(undefined);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function open(target: SubnetTarget = { id: 'subnet-1', label: 'app' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InArea target={target} />
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

const SENTENCE =
  'is deleted from the local emulator. This cannot be undone. The emulator refuses while something is in the subnet, such as an instance or a NAT gateway.';

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
});

describe('"Delete subnet?"', () => {
  it('names the subnet and says the emulator refuses while something is in it; "Delete" acts only once delete is typed', async () => {
    vi.mocked(api.deleteSubnet).mockResolvedValue(undefined);
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete subnet?');
    expect(text(dialog)).toContain(`app ${SENTENCE}`);
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Delete' } });
    fireEvent.click(confirm);
    expect(api.deleteSubnet).not.toHaveBeenCalled();
    confirmWith(dialog);
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith({ id: 'subnet-1', label: 'app' });
    });
    expect(vi.mocked(api.deleteSubnet).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'subnet-1']);
  });

  it('names a subnet without a name by its ID', async () => {
    open({ id: 'subnet-2', label: 'subnet-2' });
    expect(text(await screen.findByRole('dialog'))).toContain(`subnet-2 ${SENTENCE}`);
  });

  it('"Cancel" closes it and nothing is sent', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.deleteSubnet).not.toHaveBeenCalled();
  });

  it('a refusal → the dialog stays open and shows the emulator\'s code and message; "Cancel" then closes it', async () => {
    vi.mocked(api.deleteSubnet).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteSubnet',
        code: 'DependencyViolation',
        message: "The subnet 'subnet-1' has dependencies and cannot be deleted.",
      }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The subnet 'subnet-1' has dependencies and cannot be deleted.");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('a 501 → "not implemented by the emulator" with DeleteSubnet, in the dialog', async () => {
    vi.mocked(api.deleteSubnet).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DeleteSubnet' }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toMatch(/Not implemented by the emulator/i);
    expect(text(alert)).toContain('DeleteSubnet');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
