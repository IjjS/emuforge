import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../gateway-changes-api';
import { DeleteGatewayDialog, type GatewayTarget } from './delete-gateway-dialog';

// The dialog sends `DeleteInternetGateway` itself; the call of `gateway-changes-api.ts` is answered by the case.

vi.mock('../gateway-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gateway-changes-api')>();
  return { ...real, deleteInternetGateway: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8574';

let onDeleted: ReturnType<typeof vi.fn<(gateway: GatewayTarget) => void>>;

function InArea({ target }: { target: GatewayTarget }) {
  const root = useRef<HTMLDivElement>(null);
  const [gateway, setGateway] = useState<GatewayTarget | undefined>(target);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteGatewayDialog
          gateway={gateway}
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={(deleted) => {
            onDeleted(deleted);
            setGateway(undefined);
          }}
          onDismiss={() => {
            setGateway(undefined);
          }}
        />
      </AreaRootContext>
    </div>
  );
}

function open(target: GatewayTarget = { id: 'igw-1', label: 'edge' }) {
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

const SENTENCE = 'is deleted from the local emulator. This cannot be undone.';

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
});

describe('"Delete internet gateway?"', () => {
  it('reads "Delete internet gateway?" and names the gateway by its name; "Delete" acts only once delete is typed', async () => {
    vi.mocked(api.deleteInternetGateway).mockResolvedValue(undefined);
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete internet gateway?');
    expect(text(dialog)).toContain(`edge ${SENTENCE}`);
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Delete' } });
    fireEvent.click(confirm);
    expect(api.deleteInternetGateway).not.toHaveBeenCalled();
    confirmWith(dialog);
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith({ id: 'igw-1', label: 'edge' });
    });
    expect(vi.mocked(api.deleteInternetGateway).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'igw-1']);
  });

  it('names a gateway without a name by its ID', async () => {
    open({ id: 'igw-2', label: 'igw-2' });
    expect(text(await screen.findByRole('dialog'))).toContain(`igw-2 ${SENTENCE}`);
  });

  it('"Cancel" closes it and nothing is sent', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.deleteInternetGateway).not.toHaveBeenCalled();
  });

  it('a refusal → the dialog stays open and shows the emulator\'s code and message; "Cancel" then closes it', async () => {
    vi.mocked(api.deleteInternetGateway).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteInternetGateway',
        code: 'DependencyViolation',
        message: "The internetGateway 'igw-1' has dependencies and cannot be deleted.",
      }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('DependencyViolation');
    expect(text(alert)).toContain("The internetGateway 'igw-1' has dependencies and cannot be deleted.");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('a 501 → "not implemented by the emulator" with DeleteInternetGateway, in the dialog', async () => {
    vi.mocked(api.deleteInternetGateway).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'DeleteInternetGateway' }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirmWith(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toMatch(/Not implemented by the emulator/i);
    expect(text(alert)).toContain('DeleteInternetGateway');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
