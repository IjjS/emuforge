import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../vpc-changes-api';
import { DeleteVpcDialog, type VpcTarget } from './delete-vpc-dialog';

// The dialog sends `DeleteVpc` itself; the call of `vpc-changes-api.ts` is answered by the case.

vi.mock('../vpc-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../vpc-changes-api')>();
  return { ...real, deleteVpc: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8574';

let onDeleted: ReturnType<typeof vi.fn<(vpc: VpcTarget) => void>>;

function InArea({ target }: { target: VpcTarget }) {
  const root = useRef<HTMLDivElement>(null);
  const [vpc, setVpc] = useState<VpcTarget | undefined>(target);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteVpcDialog
          vpc={vpc}
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={(deleted) => {
            onDeleted(deleted);
            setVpc(undefined);
          }}
          onDismiss={() => {
            setVpc(undefined);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function open(target: VpcTarget = { id: 'vpc-1', label: 'app' }) {
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
  'is deleted from the local emulator with its route tables. This cannot be undone. The emulator refuses while the VPC holds a subnet, an attached internet gateway or a security group other than default.';

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
});

describe('"Delete VPC?"', () => {
  it('names the VPC by its name and says what goes with it and what the emulator refuses; "Delete" acts only once delete is typed', async () => {
    vi.mocked(api.deleteVpc).mockResolvedValue(undefined);
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete VPC?');
    expect(text(dialog)).toContain(`app ${SENTENCE}`);
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Delete' } });
    fireEvent.click(confirm);
    expect(api.deleteVpc).not.toHaveBeenCalled();
    confirmWith(dialog);
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith({ id: 'vpc-1', label: 'app' });
    });
    expect(vi.mocked(api.deleteVpc).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'vpc-1']);
  });

  it('names a VPC without a name by its ID', async () => {
    open({ id: 'vpc-2', label: 'vpc-2' });
    expect(text(await screen.findByRole('dialog'))).toContain(`vpc-2 ${SENTENCE}`);
  });

  it('"Cancel" closes it and nothing is sent', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.deleteVpc).not.toHaveBeenCalled();
  });

  it('a refusal → the dialog stays open and shows the emulator\'s code and message; "Cancel" then closes it', async () => {
    vi.mocked(api.deleteVpc).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteVpc',
        code: 'DependencyViolation',
        message: "The vpc 'vpc-1' has dependencies and cannot be deleted.",
      }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The vpc 'vpc-1' has dependencies and cannot be deleted.");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('a 501 → "not implemented by the emulator" with DeleteVpc, in the dialog', async () => {
    vi.mocked(api.deleteVpc).mockRejectedValue(new RequestError({ kind: 'not-implemented', operation: 'DeleteVpc' }));
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toMatch(/Not implemented by the emulator/i);
    expect(text(alert)).toContain('DeleteVpc');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
