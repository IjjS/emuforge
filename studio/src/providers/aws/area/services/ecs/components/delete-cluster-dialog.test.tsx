import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../api';
import { DeleteClusterDialog } from './delete-cluster-dialog';

// The dialog sends `DeleteCluster` itself; the call of `api.ts` is answered by the case.

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, deleteCluster: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8310';
const BODY =
  'The cluster is removed from the local emulator. The emulator refuses while the cluster has an active service or a task that is not stopped.';

let onDeleted: ReturnType<typeof vi.fn<(name: string) => void>>;

/** The dialog inside an area's root, opened for `dev` by an opener that closes it only on "Cancel". */
function InArea() {
  const root = useRef<HTMLDivElement>(null);
  const [cluster, setCluster] = useState<string | undefined>('dev');
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteClusterDialog
          cluster={cluster}
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={onDeleted}
          onDismiss={() => {
            setCluster(undefined);
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
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'dev' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
});

describe('"Delete cluster {name}?"', () => {
  it('open for a cluster → its header, the body of R4, and "Delete" unavailable until the name is typed exactly', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete cluster dev?');
    expect(text(dialog)).toContain(BODY);
    const field = within(dialog).getByRole('textbox');
    const button = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(button)).toBe(true);
    fireEvent.change(field, { target: { value: 'de' } });
    expect(isDisabled(button)).toBe(true);
    fireEvent.change(field, { target: { value: 'Dev' } });
    expect(isDisabled(button)).toBe(true);
    fireEvent.change(field, { target: { value: 'dev' } });
    expect(isDisabled(button)).toBe(false);
  });

  it('confirmed and answered → the dialog is no longer shown, and its opener is told once of the cluster', async () => {
    vi.mocked(api.deleteCluster).mockResolvedValue(undefined);
    open();
    confirm(await screen.findByRole('dialog'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith('dev');
    expect(vi.mocked(api.deleteCluster).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'dev']);
  });

  it('refused with ClusterContainsTasksException → stays open with the sentence, code and message; no delete told', async () => {
    vi.mocked(api.deleteCluster).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DeleteCluster',
        code: 'ClusterContainsTasksException',
        message: 'The Cluster cannot be deleted while Tasks are active.',
      }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirm(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(text(alert)).toContain('The emulator did not delete the cluster.');
    expect(text(alert)).toContain('ClusterContainsTasksException');
    expect(text(alert)).toContain('The Cluster cannot be deleted while Tasks are active.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('while the request is out → neither button acts', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(api.deleteCluster).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    confirm(dialog);
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => {
      expect(isDisabled(cancel)).toBe(true);
    });
    fireEvent.click(cancel);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(api.deleteCluster).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledTimes(1);
    });
  });

  it('"Cancel" before confirming → the dialog is no longer shown and nothing is sent', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'dev' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(api.deleteCluster).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
