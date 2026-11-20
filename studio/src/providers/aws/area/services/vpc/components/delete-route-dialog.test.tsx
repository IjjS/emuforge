import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import * as api from '../route-changes-api';
import { DeleteRouteDialog, type RouteTarget } from './delete-route-dialog';

// The dialog sends `DeleteRoute` itself; the call of `route-changes-api.ts` is answered by the case.

vi.mock('../route-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../route-changes-api')>();
  return { ...real, deleteRoute: vi.fn() };
});

const ENGINE = 'http://127.0.0.1:8575';
const ROUTE: RouteTarget = { routeTableId: 'rtb-1', tableLabel: 'app', destination: '0.0.0.0/0', target: 'igw-1' };

let onDeleted: ReturnType<typeof vi.fn<(route: RouteTarget) => void>>;
let onFailed: ReturnType<typeof vi.fn<(route: RouteTarget, failure: RequestFailure) => void>>;

function InArea() {
  const root = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState<RouteTarget | undefined>(ROUTE);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <DeleteRouteDialog
          route={route}
          connection={{ result: undefined, engineOrigin: ENGINE }}
          onDeleted={(deleted) => {
            onDeleted(deleted);
            setRoute(undefined);
          }}
          onFailed={(failed, failure) => {
            onFailed(failed, failure);
            setRoute(undefined);
          }}
          onDismiss={() => {
            setRoute(undefined);
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

beforeEach(() => {
  vi.clearAllMocks();
  onDeleted = vi.fn();
  onFailed = vi.fn();
});

describe('"Delete route?"', () => {
  it('names the route by its destination and target, and the table; "Delete" acts only once delete is typed', async () => {
    vi.mocked(api.deleteRoute).mockResolvedValue(undefined);
    open();
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Delete route?');
    expect(text(dialog)).toContain('The route 0.0.0.0/0 to igw-1 is removed from app.');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.click(confirm);
    expect(api.deleteRoute).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledWith(ROUTE);
    });
    expect(vi.mocked(api.deleteRoute).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'rtb-1', '0.0.0.0/0']);
  });

  it('"Cancel" closes it and nothing is sent', async () => {
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.deleteRoute).not.toHaveBeenCalled();
  });

  it('a failure is handed to the page with its code and message', async () => {
    vi.mocked(api.deleteRoute).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DeleteRoute', code: 'InvalidRoute.NotFound', message: 'gone' }),
    );
    open();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(onFailed).toHaveBeenCalledWith(ROUTE, {
        kind: 'other',
        operation: 'DeleteRoute',
        code: 'InvalidRoute.NotFound',
        message: 'gone',
      });
    });
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
