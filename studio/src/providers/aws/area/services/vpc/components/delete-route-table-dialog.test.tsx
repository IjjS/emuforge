import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../route-table-changes-api';
import { DeleteRouteTableDialog, type RouteTableTarget } from './delete-route-table-dialog';

// The dialog sends `DeleteRouteTable` itself; the call of `route-table-changes-api.ts` is answered by the case.

vi.mock('../route-table-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../route-table-changes-api')>();
  return { ...real, deleteRouteTable: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8574';

let onDeleted: ReturnType<typeof vi.fn<(table: RouteTableTarget) => void>>;

function InArea({ target }: { target: RouteTableTarget }) {
  const root = useRef<HTMLDivElement>(null);
  const [table, setTable] = useState<RouteTableTarget | undefined>(target);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteRouteTableDialog
          table={table}
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={(deleted) => {
            onDeleted(deleted);
            setTable(undefined);
          }}
          onDismiss={() => {
            setTable(undefined);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function open(target: RouteTableTarget = { id: 'rtb-1', label: 'app' }) {
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
  'is deleted from the local emulator with its routes. This cannot be undone. The emulator refuses while a subnet is associated with it.';

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
});

describe('"Delete route table?"', () => {
  it('names the table by its name, says it is deleted with its routes and that the emulator refuses while a subnet is associated with it; "Delete" acts only once delete is typed', async () => {
    vi.mocked(api.deleteRouteTable).mockResolvedValue(undefined);
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete route table?');
    expect(text(dialog)).toContain(`app ${SENTENCE}`);
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Delete' } });
    fireEvent.click(confirm);
    expect(api.deleteRouteTable).not.toHaveBeenCalled();
    confirmWith(dialog);
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith({ id: 'rtb-1', label: 'app' });
    });
    expect(vi.mocked(api.deleteRouteTable).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'rtb-1']);
  });

  it('names a table without a name by its ID', async () => {
    open({ id: 'rtb-2', label: 'rtb-2' });
    expect(text(await screen.findByRole('dialog'))).toContain(`rtb-2 ${SENTENCE}`);
  });

  it('"Cancel" closes it and nothing is sent', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.deleteRouteTable).not.toHaveBeenCalled();
  });

  it('a refusal → the dialog stays open and shows the emulator\'s code and message; "Cancel" then closes it', async () => {
    vi.mocked(api.deleteRouteTable).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteRouteTable',
        code: 'DependencyViolation',
        message: "The routeTable 'rtb-1' has dependencies and cannot be deleted.",
      }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The routeTable 'rtb-1' has dependencies and cannot be deleted.");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('a 501 → "not implemented by the emulator" with DeleteRouteTable, in the dialog', async () => {
    vi.mocked(api.deleteRouteTable).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DeleteRouteTable' }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toMatch(/Not implemented by the emulator/i);
    expect(text(alert)).toContain('DeleteRouteTable');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
