import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../service-change-api';
import { DeleteServiceDialog } from './delete-service-dialog';

// The dialog sends `DeleteService` itself; the call of `service-change-api.ts` is answered by the case.

vi.mock('../service-change-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../service-change-api')>();
  return { ...real, deleteService: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8321';
const BODY =
  'The service is deleted in the local emulator: it is no longer listed in its cluster, and its tasks are stopped.';

let onDeleted: ReturnType<typeof vi.fn<(name: string) => void>>;
let onFailed: ReturnType<typeof vi.fn<(name: string, failure: RequestFailure) => void>>;

/** The dialog inside an area's root, opened for `api` by an opener that closes it only on "Cancel". */
function InArea() {
  const root = useRef<HTMLDivElement>(null);
  const [service, setService] = useState<string | undefined>('api');
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteServiceDialog
          service={service}
          cluster="dev"
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={onDeleted}
          onFailed={onFailed}
          onDismiss={() => {
            setService(undefined);
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

function confirm(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'api' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
  onFailed = vi.fn();
});

describe('"Delete service {name}?"', () => {
  it('open → header "Delete service api?", the body of R4, "Delete" unavailable until the name is typed exactly', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete service api?');
    expect(text(dialog)).toContain(BODY);
    const field = within(dialog).getByRole('textbox');
    const button = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(button)).toBe(true);
    fireEvent.change(field, { target: { value: 'ap' } });
    expect(isDisabled(button)).toBe(true);
    fireEvent.change(field, { target: { value: 'API' } });
    expect(isDisabled(button)).toBe(true);
    fireEvent.change(field, { target: { value: 'api' } });
    expect(isDisabled(button)).toBe(false);
  });

  it('confirmed and answered → the dialog is no longer shown and its opener is told once that the service was deleted', async () => {
    vi.mocked(api.deleteService).mockResolvedValue(undefined);
    open();
    confirm(await screen.findByRole('dialog'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith('api');
    expect(onFailed).not.toHaveBeenCalled();
    expect(vi.mocked(api.deleteService).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'dev', 'api']);
  });

  it('confirmed and refused → the dialog is no longer shown and its opener is told once of the failure, with its code and message', async () => {
    vi.mocked(api.deleteService).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteService',
        code: 'ServiceNotFoundException',
        message: 'Service not found.',
      }),
    );
    open();
    confirm(await screen.findByRole('dialog'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith('api', {
      kind: 'other',
      operation: 'DeleteService',
      code: 'ServiceNotFoundException',
      message: 'Service not found.',
    });
  });
});
